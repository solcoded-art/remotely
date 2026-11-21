//! Test-only automation, compiled only with `--features e2e` (never in normal
//! or release builds). It lets `tests/e2e-pairing.mjs` drive the real app the
//! way its buttons do, against a local signaling service:
//!   env MAC_REMOTE_E2E_SERVER=http://127.0.0.1:<port>  (loopback only)
//!   env MAC_REMOTE_E2E_TOKEN=<session token>           (used instead of the Keychain login)
//!   stdin:  `invite` | `approve` | `decline` | `revoke <peerId>` | `displays` | `select <id>`
//!           | `allow [rememberMs]` | `deny` | `end` | `forget <peerId>` | `quit`
//!   stdout: one JSON state line per change, prefixed `E2E `.

use std::io::BufRead;

use gpui::{App, Entity};
use serde_json::json;

use crate::{account, app::MacRemote};

pub struct Config {
    pub server: String,
    pub token: String,
}

pub fn config() -> Option<Config> {
    let server = account::service_url(&std::env::var("MAC_REMOTE_E2E_SERVER").ok()?).ok()?;
    let host = url::Url::parse(&server).ok()?.host_str()?.to_string();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost") {
        eprintln!("e2e: refusing non-loopback server");
        return None;
    }
    Some(Config { server, token: std::env::var("MAC_REMOTE_E2E_TOKEN").ok()? })
}

pub fn attach(view: Entity<MacRemote>, cx: &mut App) {
    let (tx, rx) = async_channel::unbounded::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if tx.send_blocking(line).is_err() {
                break;
            }
        }
    });
    let mut last = String::new();
    cx.observe(&view, move |view, cx| {
        let Some(connection) = view.read(cx).connection_for_tests() else { return };
        let c = connection.read(cx);
        let state = json!({
            "ready": c.ready,
            "deviceId": c.device_id,
            "pins": c.pins.iter().map(|(id, pin)| json!({ "id": id, "grantId": pin.grant_id, "name": pin.name })).collect::<Vec<_>>(),
            "invite": c.invite.as_ref().map(|i| i.link.clone()),
            "pairing": c.pairing.as_ref().map(|p| p.peer_id.clone()),
            "pairStatus": c.pair_status,
            "setupReady": c.setup_ready(),
            "remembered": c.desktop.remembered.keys().cloned().collect::<Vec<_>>(),
            "unlocked": c.desktop.pending.as_ref().is_some_and(|p| p.unlocked),
            "displays": c.desktop.displays.iter().map(|d| d.id).collect::<Vec<_>>(),
            "pending": c.desktop.pending.as_ref().map(|p| p.peer_id.clone()),
            "session": c.desktop.session.as_ref().map(|s| s.peer_id.clone()),
            "sessionStatus": match c.desktop.session_status { Some(crate::connection::SessionStatus::Connected) => "connected", Some(_) => "negotiating", None => "none" },
            "error": c.error,
            "devices": c.devices.iter().map(|d| json!({ "id": d.id, "kind": d.kind, "online": d.online })).collect::<Vec<_>>(),
        })
        .to_string();
        if state != last {
            println!("E2E {state}");
            last = state;
        }
    })
    .detach();
    cx.spawn(async move |cx| {
        while let Ok(line) = rx.recv().await {
            let mut parts = line.split_whitespace();
            let command = parts.next().unwrap_or_default().to_string();
            let argument = parts.next().unwrap_or_default().to_string();
            if command == "quit" {
                cx.update(|cx| cx.quit()).ok();
                break;
            }
            view.update(cx, |view, cx| {
                let Some(connection) = view.connection_for_tests() else { return };
                connection.update(cx, |c, cx| match command.as_str() {
                    "invite" => c.create_invite(cx),
                    "approve" => c.approve_pair(cx),
                    "decline" => c.decline_pair(cx),
                    "revoke" => c.revoke(argument.clone(), cx),
                    "displays" => c.load_displays(cx),
                    "select" => c.select_display(argument.parse().unwrap_or(0), cx),
                    "allow" => c.approve(argument.parse().unwrap_or(0), cx),
                    "forget" => {
                        c.forget_remembered(Some(&argument));
                        cx.notify();
                    }
                    "deny" => c.decline(cx),
                    "end" => c.end(cx),
                    _ => eprintln!("e2e: unknown command {command}"),
                });
            })
            .ok();
        }
    })
    .detach();
}
