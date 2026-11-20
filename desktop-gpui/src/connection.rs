//! Desktop half of `src/lib/connection.ts`: health check, device enrollment,
//! `/ws` challenge/hello, signed envelopes, live device list, pairing
//! (invite → phone proof → Mac approval → grant) and revocation. Sessions
//! (approval, capture, WebRTC, input) live in `connection/session.rs`.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use anyhow::{anyhow, bail, Result};
use gpui::{Context, Task};
use serde_json::{json, Value};

use crate::{
    account::{self, storage_service, Auth, Device},
    identity::{Identity, Pin},
    signaling::{self, Event},
    store::now_ms,
    trust,
};

mod session;
pub use session::SessionStatus;

const INVITE_MS: i64 = 120_000;

#[derive(Clone, Copy, PartialEq)]
pub enum Status {
    Connecting,
    Ready,
    Offline,
}

#[derive(Clone)]
pub struct Invite {
    pub id: String,
    secret: String,
    pub expires: i64,
    pub link: String,
}

#[derive(Clone)]
pub struct PairRequest {
    pub id: String,
    pub peer_id: String,
    key: Value,
    pub name: String,
}

pub struct Connection {
    auth: Auth,
    identity: Option<Arc<Identity>>,
    pub device_id: String,
    pub status: Status,
    pub ready: bool,
    pub devices: Vec<Device>,
    pub pins: BTreeMap<String, Pin>,
    pub invite: Option<Invite>,
    opening_invite: Option<Invite>,
    pub pairing: Option<PairRequest>,
    pub pair_status: String,
    pub error: Option<String>,
    /// Setup checklist, approval prompt and the active session.
    pub desktop: session::Desktop,
    pub busy: bool,
    challenge: String,
    sequence: u64,
    socket: Option<async_channel::Sender<String>>,
    generation: u64,
    disposed: bool,
    reconnect_task: Option<Task<()>>,
    invite_task: Option<Task<()>>,
    tick_task: Option<Task<()>>,
    expiry_task: Option<Task<()>>,
}

fn s<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// The Mac's display name, like Electron's `os.hostname()` but friendlier.
fn computer_name() -> String {
    std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|name| name.trim().chars().take(73).collect::<String>())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "My Mac".into())
        + name_suffix(option_env!("MAC_REMOTE_CHANNEL"))
}

/// Development builds say so, to tell them apart from a release on the phone.
/// Release packages are built with `MAC_REMOTE_CHANNEL=release` (scripts/package-mac.sh).
fn name_suffix(channel: Option<&str>) -> &'static str {
    if channel == Some("release") { "" } else { " · GPUI" }
}

#[cfg(test)]
mod tests {
    #[test]
    fn release_builds_use_the_plain_mac_name() {
        assert_eq!(super::name_suffix(Some("release")), "");
        assert_eq!(super::name_suffix(None), " · GPUI");
        assert_eq!(super::name_suffix(Some("dev")), " · GPUI");
    }
}

impl Connection {
    /// `test_mode` is only ever true in `e2e` builds (synthetic capture, no permission checks).
    pub fn new(auth: Auth, test_mode: bool, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            auth,
            identity: None,
            device_id: String::new(),
            status: Status::Connecting,
            ready: false,
            devices: Vec::new(),
            pins: BTreeMap::new(),
            invite: None,
            opening_invite: None,
            pairing: None,
            pair_status: String::new(),
            error: None,
            desktop: session::Desktop::default(),
            busy: false,
            challenge: String::new(),
            sequence: 0,
            socket: None,
            generation: 0,
            disposed: false,
            reconnect_task: None,
            invite_task: None,
            tick_task: None,
            expiry_task: None,
        };
        this.init_desktop(test_mode, cx);
        this.start(cx);
        this
    }

    fn report(&mut self, error: impl ToString, cx: &mut Context<Self>) {
        crate::log::log(format!("error: {}", error.to_string()));
        self.error = Some(error.to_string());
        cx.notify();
    }

    pub fn clear_error(&mut self, cx: &mut Context<Self>) {
        self.error = None;
        cx.notify();
    }


    /// Health check, device key, enrollment, then the account socket.
    fn start(&mut self, cx: &mut Context<Self>) {
        self.status = Status::Connecting;
        cx.notify();
        let auth = self.auth.clone();
        let existing = self.identity.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    account::check_health(&auth.service)?;
                    let identity = match existing {
                        Some(identity) => identity,
                        None => Arc::new(Identity::load(&storage_service(&auth.service), &auth.user.id)?),
                    };
                    let name = computer_name();
                    let challenge = account::device_challenge(&auth)?;
                    let signature = identity.sign(&trust::registration(&challenge, &auth.user.id, &identity.id, &name, "desktop", &identity.public_key)?)?;
                    account::register_device(
                        &auth,
                        json!({ "id": identity.id, "name": name, "kind": "desktop", "publicKey": identity.public_key, "challenge": challenge, "signature": signature }),
                    )?;
                    let devices = account::devices(&auth)?;
                    let remembered = crate::remember::load(&storage_service(&auth.service), &auth.user.id)?;
                    Ok::<_, anyhow::Error>((identity, devices, remembered))
                })
                .await;
            this.update(cx, |this, cx| match result {
                Ok((identity, devices, remembered)) => {
                    if this.disposed {
                        return;
                    }
                    this.desktop.remembered = remembered;
                    this.device_id = identity.id.clone();
                    this.pins = identity.pins();
                    this.identity = Some(identity);
                    this.devices = devices;
                    this.watch_expiry(cx);
                    this.open_socket(cx);
                }
                Err(err) => {
                    this.status = Status::Offline;
                    this.report(err, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    /// Browsers clamp long timers; we do not, but check hourly anyway in case the clock jumps.
    fn watch_expiry(&mut self, cx: &mut Context<Self>) {
        let expires = self.auth.expires;
        self.expiry_task = Some(cx.spawn(async move |this, cx| loop {
            let remaining = expires - now_ms();
            if remaining <= 0 {
                this.update(cx, |this, cx| {
                    this.report("Your login expired. Sign in again.", cx);
                    this.dispose(cx);
                })
                .ok();
                break;
            }
            cx.background_executor().timer(Duration::from_millis(remaining.min(3_600_000) as u64)).await;
        }));
    }

    /// Reconnect after an interruption (the "Retry connection" button).
    pub fn retry(&mut self, cx: &mut Context<Self>) {
        if self.disposed || self.socket.is_some() {
            return;
        }
        self.reconnect_task = None;
        self.error = None;
        if self.identity.is_some() && self.ready_to_open() {
            self.open_socket(cx);
        } else {
            self.start(cx);
        }
    }

    fn ready_to_open(&self) -> bool {
        self.auth.expires > now_ms()
    }

    pub fn refresh_devices(&mut self, cx: &mut Context<Self>) {
        let auth = self.auth.clone();
        cx.spawn(async move |this, cx| {
            let result = cx.background_executor().spawn(async move { account::devices(&auth) }).await;
            this.update(cx, |this, cx| match result {
                Ok(devices) => {
                    this.devices = devices;
                    cx.notify();
                }
                Err(err) => this.report(err, cx),
            })
            .ok();
        })
        .detach();
    }

    fn open_socket(&mut self, cx: &mut Context<Self>) {
        if self.disposed {
            return;
        }
        self.generation += 1;
        let generation = self.generation;
        self.ready = false;
        self.status = Status::Connecting;
        self.challenge.clear();
        self.sequence = 0;
        let mut url = url::Url::parse(&self.auth.service).expect("validated service origin");
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme).ok();
        url.set_path("/ws");
        let (out_tx, out_rx) = async_channel::unbounded();
        let (event_tx, event_rx) = async_channel::unbounded();
        signaling::spawn(url.to_string(), out_rx, event_tx);
        self.socket = Some(out_tx);
        cx.notify();
        cx.spawn(async move |this, cx| {
            while let Ok(event) = event_rx.recv().await {
                let alive = this.update(cx, |this, cx| this.on_event(generation, event, cx)).is_ok();
                if !alive {
                    break;
                }
            }
        })
        .detach();
    }

    fn on_event(&mut self, generation: u64, event: Event, cx: &mut Context<Self>) {
        if generation != self.generation || self.disposed {
            return;
        }
        match event {
            Event::Message(text) => {
                let result = serde_json::from_str::<Value>(&text).map_err(|_| anyhow!("Invalid message from the account service.")).and_then(|data| self.message(data, cx));
                if let Err(err) = result {
                    self.report(err, cx);
                }
            }
            Event::Closed(code) => {
                crate::log::log(format!("account socket closed ({code:?})"));
                self.socket = None;
                self.socket_closed(matches!(code, Some(4000) | Some(4001)) || self.disposed);
                self.clear_pairing();
                self.ready = false;
                self.status = Status::Offline;
                for device in &mut self.devices {
                    device.online = false;
                }
                if matches!(code, Some(4000) | Some(4001)) {
                    self.report("Device session closed. Sign in again.", cx);
                } else {
                    self.reconnect_task = Some(cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(Duration::from_secs(2)).await;
                        this.update(cx, |this, cx| {
                            if this.socket.is_none() && !this.disposed {
                                this.open_socket(cx);
                            }
                        })
                        .ok();
                    }));
                }
                cx.notify();
            }
        }
    }

    fn identity(&self) -> Result<Arc<Identity>> {
        self.identity.clone().ok_or_else(|| anyhow!("Your device key is not ready yet."))
    }

    fn raw_send(&self, value: &Value) -> Result<()> {
        let socket = self.socket.as_ref().ok_or_else(|| anyhow!("The account service is disconnected."))?;
        socket.try_send(value.to_string()).map_err(|_| anyhow!("The account service is disconnected."))
    }

    /// Sends `data` inside a signed, sequenced envelope bound to this socket's challenge.
    fn send(&mut self, data: Value) -> Result<()> {
        if self.challenge.is_empty() || self.socket.is_none() {
            bail!("The account service is disconnected.");
        }
        let identity = self.identity()?;
        self.sequence += 1;
        let signature = identity.sign(&trust::envelope(&self.challenge, &self.auth.user.id, &self.device_id, self.sequence, &data))?;
        self.raw_send(&json!({ "data": data, "seq": self.sequence, "signature": signature }))
    }

    fn message(&mut self, data: Value, cx: &mut Context<Self>) -> Result<()> {
        let kind = s(&data, "type").to_string();
        match kind.as_str() {
            "challenge" => {
                let challenge = s(&data, "challenge");
                if !self.challenge.is_empty() || trust::unb64(challenge).map(|b| b.len()).unwrap_or(0) != 32 {
                    bail!("Invalid device challenge.");
                }
                self.challenge = challenge.to_string();
                let identity = self.identity()?;
                let signature = identity.sign(&trust::hello(&self.challenge, &self.auth.user.id, &self.device_id))?;
                self.raw_send(&json!({ "type": "hello", "token": self.auth.token, "deviceId": self.device_id, "signature": signature }))?;
            }
            "ready" => {
                crate::log::log("account socket ready");
                self.ready = true;
                self.status = Status::Ready;
                self.error = None;
                self.after_reconnect(cx);
            }
            "devices" => {
                self.devices = serde_json::from_value(data.get("devices").cloned().unwrap_or(json!([]))).unwrap_or_default();
            }
            "error" => {
                let message = s(&data, "message");
                // The phone ended this session first (its channel closed when ours did); nothing to report.
                if message == "Session is unavailable." && self.desktop.session.is_none() && self.desktop.pending.is_none() {
                    return Ok(());
                }
                bail!("{}", if message.is_empty() { "Connection failed." } else { message });
            }
            "pair-opened" => {
                if self.opening_invite.as_ref().is_some_and(|i| i.id == s(&data, "inviteId")) {
                    self.invite = self.opening_invite.take();
                    self.pair_status = "Link ready. It expires in two minutes.".into();
                    self.start_tick(cx);
                }
            }
            "pair-request" => self.pair_request(&data)?,
            "paired" => self.paired(&data)?,
            "revoked" => self.revoked(s(&data, "grantId").to_string(), cx),
            "request" => self.session_request(&data, cx)?,
            "approved" => self.approved(&data, cx)?,
            "signal" => self.remote_signal(&data, cx)?,
            "ended" => self.ended(&data, cx),
            // Phone-side messages.
            _ => {}
        }
        cx.notify();
        Ok(())
    }

    // ---------- Pairing ----------

    fn clear_pairing(&mut self) {
        self.invite_task = None;
        self.tick_task = None;
        self.opening_invite = None;
        self.invite = None;
        self.pairing = None;
        self.pair_status.clear();
    }

    /// Keeps the expiry countdown moving while a link is shown.
    fn start_tick(&mut self, cx: &mut Context<Self>) {
        self.tick_task = Some(cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            if this.update(cx, |_, cx| cx.notify()).is_err() {
                break;
            }
        }));
    }

    /// Creates a one-use pairing link: `<service>/#pair=<base64url JSON>`, valid two minutes.
    pub fn create_invite(&mut self, cx: &mut Context<Self>) {
        let result = (|| -> Result<()> {
            if !self.ready {
                bail!("Open and sign in to the Mac app first.");
            }
            let identity = self.identity()?;
            self.clear_pairing();
            let (id, secret, expires) = (uuid(), trust::nonce(), now_ms() + INVITE_MS);
            let payload = json!({ "v": 1, "service": self.auth.service, "userId": self.auth.user.id, "desktopId": self.device_id, "key": identity.public_key, "id": id, "secret": secret, "expires": expires });
            let link = format!("{}/#pair={}", self.auth.service, trust::b64(payload.to_string().as_bytes()));
            self.send(json!({ "type": "pair-open", "inviteId": id, "expires": expires }))?;
            self.opening_invite = Some(Invite { id, secret, expires, link });
            self.pair_status = "Preparing your pairing link…".into();
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.invite_task = Some(cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(Duration::from_millis(INVITE_MS as u64)).await;
                    this.update(cx, |this, cx| {
                        this.clear_pairing();
                        this.pair_status = "Pairing link expired. Create a new link to try again.".into();
                        cx.notify();
                    })
                    .ok();
                }));
                cx.notify();
            }
            Err(err) => self.report(err, cx),
        }
    }

    /// The phone proved it holds this invite's secret. Anything wrong is declined silently.
    fn pair_request(&mut self, data: &Value) -> Result<()> {
        let request_id = s(data, "requestId").to_string();
        let peer_id = s(data, "peerId");
        let key = data.get("publicKey").cloned().unwrap_or(Value::Null);
        let valid = self.invite.as_ref().is_some_and(|invite| {
            invite.id == s(data, "inviteId")
                && invite.expires > now_ms()
                && trust::key_id(&key).is_ok_and(|id| id == peer_id)
                && trust::pairing(&invite.id, &request_id, &self.auth.user.id, &self.device_id, peer_id, &key)
                    .is_ok_and(|text| trust::verify_proof(&invite.secret, &text, s(data, "proof")))
        });
        if !valid || self.pairing.is_some() {
            return self.send(json!({ "type": "pair-decline", "requestId": request_id }));
        }
        let name: String = s(data, "name").chars().take(80).collect();
        self.pairing = Some(PairRequest { id: request_id, peer_id: peer_id.into(), key: trust::public_key(&key)?, name: if name.is_empty() { "Phone".into() } else { name } });
        crate::log::log("pairing request (proof verified)");
        if !self.desktop.test_mode {
            crate::platform::request_attention();
        }
        self.pair_status.clear();
        Ok(())
    }

    pub fn approve_pair(&mut self, cx: &mut Context<Self>) {
        let (Some(pending), Some(invite)) = (self.pairing.clone(), self.invite.clone()) else { return };
        if invite.expires <= now_ms() {
            self.report("Pairing link expired.", cx);
            return;
        }
        let Ok(identity) = self.identity() else { return };
        let grant = json!({
            "id": uuid(), "userId": self.auth.user.id, "desktopId": self.device_id, "controllerId": pending.peer_id,
            "desktopKey": identity.public_key, "controllerKey": pending.key, "inviteId": invite.id, "requestId": pending.id,
        });
        let pin = Pin { grant_id: s(&grant, "id").into(), key: pending.key.clone(), name: pending.name.clone() };
        self.busy = true;
        cx.notify();
        // Pin first (Keychain write), then sign and send, as in connection.ts.
        cx.spawn(async move |this, cx| {
            let peer = pending.peer_id.clone();
            let saved = {
                let identity = identity.clone();
                cx.background_executor().spawn(async move { identity.pin(&peer, Some(pin)) }).await
            };
            this.update(cx, |this, cx| {
                this.busy = false;
                let result = saved.and_then(|()| {
                    let signature = identity.sign(&trust::grant_text(&grant)?)?;
                    this.send(json!({ "type": "pair-approve", "requestId": pending.id, "grant": grant, "signature": signature }))
                });
                this.pins = identity.pins();
                match result {
                    Ok(()) => this.pairing = None,
                    Err(err) => this.error = Some(err.to_string()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn decline_pair(&mut self, cx: &mut Context<Self>) {
        let Some(pending) = self.pairing.take() else { return };
        if let Err(err) = self.send(json!({ "type": "pair-decline", "requestId": pending.id })) {
            self.error = Some(err.to_string());
        }
        cx.notify();
    }

    fn paired(&mut self, data: &Value) -> Result<()> {
        let grant = data.get("grant").cloned().unwrap_or(Value::Null);
        if s(&grant, "userId") != self.auth.user.id {
            bail!("Unexpected pairing account.");
        }
        let identity = self.identity()?;
        let pin = identity.pins().get(s(&grant, "controllerId")).cloned();
        let ok = pin.is_some_and(|p| p.grant_id == s(&grant, "id"))
            && s(&grant, "desktopId") == self.device_id
            && trust::grant_text(&grant).is_ok_and(|text| trust::verify(&identity.public_key, &text, s(data, "signature")));
        if !ok {
            bail!("Unexpected pairing approval.");
        }
        self.clear_pairing();
        self.pins = identity.pins();
        // A new grant starts without a remembered window.
        self.forget_remembered(Some(s(&grant, "controllerId")));
        self.pair_status = "Device paired. Every connection still needs approval on your Mac.".into();
        Ok(())
    }

    fn revoked(&mut self, grant_id: String, cx: &mut Context<Self>) {
        let Ok(identity) = self.identity() else { return };
        let peers: Vec<String> = identity.pins().into_iter().filter(|(_, pin)| pin.grant_id == grant_id).map(|(id, _)| id).collect();
        self.forget_remembered_grant(&grant_id);
        self.pair_status = "Device trust revoked. Pair again before connecting.".into();
        cx.spawn(async move |this, cx| {
            let result = {
                let identity = identity.clone();
                cx.background_executor().spawn(async move { peers.iter().try_for_each(|id| identity.pin(id, None)) }).await
            };
            this.update(cx, |this, cx| {
                this.pins = identity.pins();
                if let Err(err) = result {
                    this.error = Some(err.to_string());
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Removes the local pin first, then asks the service to delete the grant.
    pub fn revoke(&mut self, peer_id: String, cx: &mut Context<Self>) {
        let Ok(identity) = self.identity() else { return };
        let Some(pin) = identity.pins().get(&peer_id).cloned() else { return };
        self.forget_remembered(Some(&peer_id));
        self.busy = true;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let removed = {
                let identity = identity.clone();
                cx.background_executor().spawn(async move { identity.pin(&peer_id, None) }).await
            };
            this.update(cx, |this, cx| {
                this.busy = false;
                this.pins = identity.pins();
                let result = removed.and_then(|()| this.send(json!({ "type": "revoke", "grantId": pin.grant_id })));
                if let Err(err) = result {
                    this.error = Some(err.to_string());
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Stops reconnecting and closes the socket (sign-out or expiry).
    pub fn dispose(&mut self, cx: &mut Context<Self>) {
        self.end(cx);
        self.disposed = true;
        self.clear_pairing();
        self.reconnect_task = None;
        self.expiry_task = None;
        if let Some(socket) = self.socket.take() {
            socket.close();
        }
        self.ready = false;
        self.status = Status::Offline;
        cx.notify();
    }
}
