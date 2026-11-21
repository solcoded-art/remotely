//! Mac-side sessions (milestone 3), continuing `connection.rs`: the setup
//! checklist (permissions, input driver, display), the approval prompt,
//! capture → VideoToolbox → WebRTC, SDP/ICE signed per message and checked
//! against the paired phone's key, and the data channel feeding the input
//! driver through `validate_command`. Mirrors approve(), createPeer(),
//! signal(), setupChannel() and end() in src/lib/connection.ts and the
//! capture/approval boundary in desktop/main.cjs: nothing is captured and no
//! command reaches the driver until the person clicks Allow connection.

use std::{
    collections::{BTreeMap, HashMap},
    ffi::c_void,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Result};
use gpui::{Context, ScreenCaptureSource, ScreenCaptureStream, Task};
use serde_json::{json, Value};
use webrtc::peer_connection::RTCPeerConnectionState;

use super::{s, Connection};
use crate::{
    account,
    commands::validate_command,
    driver::{Driver, DriverEvent},
    encoder::{fit, Encoder},
    peer::{self, Peer, PeerEvent, VideoSink},
    platform,
    remember::{self, RememberedPhone, Unlock},
    store::now_ms,
    trust,
};

const NEGOTIATION_TIMEOUT: Duration = Duration::from_secs(25);
const FPS: u32 = 30;

#[derive(Clone)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub peer_id: String,
    pub grant_id: String,
    controller_nonce: String,
    desktop_nonce: Option<String>,
    /// The phone can prove a device unlock, so the Mac may offer to remember it.
    pub can_remember: bool,
    /// The Mac verified a remembered phone's unlock and is approving on its own.
    pub unlocked: bool,
}

/// The remembered window chosen at approval, waiting for the phone's passkey.
struct RememberPlan {
    session_id: String,
    controller_id: String,
    grant_id: String,
    until: i64,
    challenge: String,
}

#[derive(Clone, Copy, PartialEq)]
pub enum SessionStatus {
    Negotiating,
    Connected,
}

#[derive(Clone)]
pub struct DisplayInfo {
    pub id: u64,
    pub label: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub struct Desktop {
    /// Automated tests only (`e2e` feature): synthetic capture, no permission checks.
    pub test_mode: bool,
    pub accessibility: bool,
    pub screen: bool,
    pub driver_ready: bool,
    driver: Option<Driver>,
    pub displays: Vec<DisplayInfo>,
    sources: Vec<Rc<dyn ScreenCaptureSource>>,
    pub selected: Option<u64>,
    pub loading_displays: bool,
    pub setup_error: Option<String>,
    pub pending: Option<Session>,
    pub approving: bool,
    pub session: Option<Session>,
    pub session_status: Option<SessionStatus>,
    stale_session: Option<String>,
    encoder: Option<Arc<Encoder>>,
    video: Arc<Mutex<Option<VideoSink>>>,
    capture: Option<Box<dyn ScreenCaptureStream>>,
    synthetic: Option<Arc<AtomicBool>>,
    peer: Option<Peer>,
    peer_state: Option<RTCPeerConnectionState>,
    peer_generation: u64,
    signal_seq: u64,
    remote_seq: u64,
    window_start: Option<Instant>,
    window_count: u32,
    negotiation_task: Option<Task<()>>,
    /// Phones that may reconnect without a prompt (controller id → record).
    pub remembered: BTreeMap<String, RememberedPhone>,
    /// Unlock proofs are single use: controller nonce → expiry.
    used_unlocks: HashMap<String, i64>,
    remember_plan: Option<RememberPlan>,
    /// The window picked on the prompt for the approval in progress.
    approving_remember_ms: i64,
}

impl Connection {
    // ---------- Setup checklist ----------

    pub(super) fn init_desktop(&mut self, test_mode: bool, cx: &mut Context<Self>) {
        self.desktop.test_mode = test_mode;
        let (tx, rx) = async_channel::unbounded();
        match Driver::spawn(tx) {
            Ok(driver) => {
                self.desktop.driver = Some(driver);
                self.desktop.driver_ready = true;
            }
            Err(err) => self.desktop.setup_error = Some(err.to_string()),
        }
        cx.spawn(async move |this, cx| {
            while let Ok(event) = rx.recv().await {
                if this.update(cx, |this, cx| this.driver_event(event, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        self.check_permissions(false, cx);
    }

    /// Re-reads Accessibility and Screen Recording. `prompt` opens the Accessibility dialog.
    pub fn check_permissions(&mut self, prompt: bool, cx: &mut Context<Self>) {
        if self.desktop.test_mode {
            self.desktop.accessibility = true;
            self.desktop.screen = true;
        } else {
            self.desktop.accessibility = platform::accessibility_trusted(prompt);
            self.desktop.screen = platform::screen_recording_granted(false);
        }
        cx.notify();
    }

    /// The checklist is complete: only then may a request be allowed.
    pub fn setup_ready(&self) -> bool {
        let d = &self.desktop;
        self.ready && d.screen && d.accessibility && d.driver_ready && d.selected.is_some()
    }

    fn busy_with_session(&self) -> bool {
        self.desktop.session.is_some() || self.desktop.approving
    }

    /// Lists displays (this is what triggers macOS's Screen Recording prompt).
    pub fn load_displays(&mut self, cx: &mut Context<Self>) {
        if self.busy_with_session() {
            return;
        }
        self.desktop.setup_error = None;
        if self.desktop.test_mode {
            self.desktop.displays = vec![DisplayInfo { id: 1, label: "Test display".into(), width: 1280, height: 800 }];
            cx.notify();
            return;
        }
        self.desktop.screen = platform::screen_recording_granted(true);
        self.desktop.loading_displays = true;
        cx.notify();
        let sources = cx.screen_capture_sources();
        cx.spawn(async move |this, cx| {
            let result = sources.await;
            this.update(cx, |this, cx| {
                this.desktop.loading_displays = false;
                match result {
                    Ok(Ok(sources)) => {
                        this.desktop.displays = sources
                            .iter()
                            .filter_map(|source| source.metadata().ok())
                            .map(|meta| DisplayInfo {
                                id: meta.id,
                                label: meta.label.map(|l| l.to_string()).unwrap_or_else(|| format!("Display {}", meta.id)),
                                width: meta.resolution.width.0.max(0) as u32,
                                height: meta.resolution.height.0.max(0) as u32,
                            })
                            .collect();
                        this.desktop.sources = sources;
                        this.desktop.screen = platform::screen_recording_granted(false) || !this.desktop.displays.is_empty();
                        if this.desktop.selected.is_some_and(|id| !this.desktop.displays.iter().any(|d| d.id == id)) {
                            this.desktop.selected = None;
                        }
                    }
                    other => {
                        let detail = match other {
                            Err(_) => "listing was cancelled".to_string(),
                            Ok(Err(err)) => err.to_string(),
                            Ok(Ok(_)) => unreachable!(),
                        };
                        crate::log::log(format!("display listing failed: {detail}"));
                        this.desktop.setup_error = Some(
                            "macOS did not allow screen access. Enable Mac Remote in Privacy & Security → Screen & System Audio Recording, then quit and reopen it.".into(),
                        )
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn select_display(&mut self, id: u64, cx: &mut Context<Self>) {
        if self.busy_with_session() {
            self.report("End the current session before changing displays.", cx);
            return;
        }
        if !self.desktop.displays.iter().any(|d| d.id == id) {
            self.report("Display is no longer available.", cx);
            return;
        }
        self.desktop.selected = Some(id);
        if let Some(driver) = &self.desktop.driver {
            let _ = driver.write(&json!({ "action": "setDisplay", "displayId": id }));
        }
        cx.notify();
    }

    // ---------- Requests and approval ----------

    /// A paired phone asks to connect: check the pin and its signed request.
    pub(super) fn session_request(&mut self, data: &Value, cx: &mut Context<Self>) -> Result<()> {
        let session_id = s(data, "sessionId").to_string();
        let peer_id = s(data, "peerId").to_string();
        let nonce = s(data, "controllerNonce").to_string();
        let Some(pin) = self.pins.get(&peer_id).cloned().filter(|p| p.grant_id == s(data, "grantId")) else {
            self.send(json!({ "type": "end", "sessionId": session_id }))?;
            bail!("This device is not trusted. Pair it with your Mac first.");
        };
        if trust::unb64(&nonce).map(|b| b.len()).unwrap_or(0) != 32 {
            bail!("Invalid controller session challenge.");
        }
        let proven = trust::verify(&pin.key, &trust::session_request(&self.auth.user.id, &pin.grant_id, &self.device_id, &peer_id, &nonce), s(data, "requestSignature"));
        if !proven || self.desktop.session.is_some() || self.desktop.pending.is_some() {
            self.send(json!({ "type": "end", "sessionId": session_id }))?;
            bail!("The phone did not prove this connection request.");
        }
        crate::log::log(format!("connection request from {} (verified)", pin.name));
        let session = Session {
            id: session_id,
            name: pin.name,
            peer_id,
            grant_id: pin.grant_id,
            controller_nonce: nonce,
            desktop_nonce: None,
            can_remember: data.get("canRemember") == Some(&Value::Bool(true)),
            unlocked: false,
        };
        self.error = None;
        if self.verified_unlock(&session, data.get("unlock")) {
            crate::log::log(format!("{} proved a fresh unlock: approving without a prompt", session.name));
            self.desktop.pending = Some(Session { unlocked: true, ..session });
            self.approve(0, cx);
            return Ok(());
        }
        self.desktop.pending = Some(session);
        if !self.desktop.test_mode {
            platform::request_attention();
        }
        Ok(())
    }

    /// A remembered phone's unlock proof for this request. Each proof works once, and
    /// only while the setup checklist is complete.
    fn verified_unlock(&mut self, session: &Session, unlock: Option<&Value>) -> bool {
        let Some(unlock) = unlock.and_then(Unlock::parse) else { return false };
        if !self.setup_ready() {
            return false;
        }
        let now = now_ms();
        self.desktop.used_unlocks.retain(|_, expires| *expires > now);
        let Some(record) = self.desktop.remembered.get(&session.peer_id).filter(|r| r.grant_id == session.grant_id && r.until > now).cloned() else { return false };
        if unlock.credential_id != record.credential_id || self.desktop.used_unlocks.contains_key(&session.controller_nonce) {
            return false;
        }
        let challenge = trust::b64(remember::unlock_text(&self.auth.user.id, &self.device_id, &session.peer_id, &session.controller_nonce).as_bytes());
        if !remember::verify_unlock(&record.public_key, &unlock, &challenge, &record.origin) {
            crate::log::log("remembered unlock did not verify: asking instead");
            return false;
        }
        self.desktop.used_unlocks.insert(session.controller_nonce.clone(), record.until);
        true
    }

    /// Stops skipping approval for one phone, or every phone (sign-out).
    pub fn forget_remembered(&mut self, controller_id: Option<&str>) {
        let before = self.desktop.remembered.len();
        match controller_id {
            Some(id) => {
                self.desktop.remembered.remove(id);
            }
            None => self.desktop.remembered.clear(),
        }
        if self.desktop.remembered.len() != before {
            self.save_remembered();
        }
    }

    pub(super) fn forget_remembered_grant(&mut self, grant_id: &str) {
        let before = self.desktop.remembered.len();
        self.desktop.remembered.retain(|_, r| r.grant_id != grant_id);
        if self.desktop.remembered.len() != before {
            self.save_remembered();
        }
    }

    fn save_remembered(&mut self) {
        if let Err(err) = remember::save(&account::storage_service(&self.auth.service), &self.auth.user.id, &self.desktop.remembered) {
            self.error = Some(err.to_string());
        }
    }

    /// The phone answered the Mac's offer with its passkey: record it for the chosen window.
    fn remember_key(&mut self, key: Value) {
        let Some(plan) = self.desktop.remember_plan.take() else { return };
        let session = self.desktop.session.clone();
        if session.as_ref().is_none_or(|s| s.id != plan.session_id || s.peer_id != plan.controller_id) {
            return;
        }
        let Some(origin) = remember::verify_unlock_key(&key, &plan.challenge) else {
            crate::log::log("remember: the phone's passkey did not verify");
            self.send_data(&json!({ "action": "error", "error": "The Mac could not verify this phone’s unlock. Approval is still required." }));
            return;
        };
        let until = plan.until.min(now_ms() + remember::REMEMBER_MAX_MS);
        let record = RememberedPhone {
            grant_id: plan.grant_id,
            credential_id: s(&key, "credentialId").to_string(),
            public_key: s(&key, "publicKey").to_string(),
            origin,
            until,
        };
        self.desktop.remembered.insert(plan.controller_id, record);
        self.save_remembered();
        crate::log::log("remember: phone's passkey recorded");
        self.send_data(&json!({ "action": "remember-set", "until": until }));
    }

    /// Allow connection: sign the approval, start capture, then tell the service.
    /// `remember_ms` lets this phone reconnect without a prompt for that long (3 days at most).
    pub fn approve(&mut self, remember_ms: i64, cx: &mut Context<Self>) {
        let Some(pending) = self.desktop.pending.clone() else { return };
        if self.desktop.approving {
            return;
        }
        self.desktop.approving = true;
        self.desktop.approving_remember_ms = remember_ms;
        cx.notify();
        let prepared = (|| -> Result<(String, String, DisplayInfo)> {
            let pin = self.pins.get(&pending.peer_id).filter(|p| p.grant_id == pending.grant_id).ok_or_else(|| anyhow!("Device trust was revoked. Pair again before connecting."))?;
            let _ = pin;
            let display = self.desktop.selected.and_then(|id| self.desktop.displays.iter().find(|d| d.id == id)).cloned().ok_or_else(|| anyhow!("Select a display first."))?;
            if !self.desktop.test_mode && !platform::accessibility_trusted(false) {
                bail!("Enable Accessibility for Mac Remote in System Settings.");
            }
            if !self.desktop.driver.as_ref().is_some_and(Driver::ready) {
                bail!("Input driver is unavailable.");
            }
            let nonce = trust::nonce();
            let signature = self.identity()?.sign(&trust::session_approval(&pending.id, &self.auth.user.id, &pending.grant_id, &self.device_id, &pending.peer_id, &pending.controller_nonce, &nonce))?;
            Ok((nonce, signature, display))
        })();
        let (nonce, signature, display) = match prepared {
            Ok(values) => values,
            Err(err) => return self.fail_approval(&pending.id, "setup", err.to_string(), cx),
        };
        if let Some(p) = self.desktop.pending.as_mut() {
            p.desktop_nonce = Some(nonce.clone());
        }

        // Encoder first; frames are dropped until the phone has answered.
        let (width, height) = fit(display.width, display.height, 1920, 1080);
        let bitrate = (width * height * 3).clamp(1_500_000, 8_000_000);
        crate::log::log(format!("allowed: capturing {} ({}×{}) → H.264 {width}×{height} @ {} kbit/s", display.label, display.width, display.height, bitrate / 1000));
        let video = self.desktop.video.clone();
        let want_key = Arc::new(AtomicBool::new(false));
        let sink_key = want_key.clone();
        let encoder = match Encoder::new(width, height, FPS, bitrate, Box::new(move |frame| {
            if let Some(sink) = video.lock().unwrap().as_ref() {
                if !sink.push(frame) {
                    sink_key.store(true, Ordering::Relaxed);
                }
            }
        })) {
            Ok(encoder) => Arc::new(encoder),
            Err(err) => return self.fail_approval(&pending.id, "capture", format!("Screen capture failed: {err}"), cx),
        };
        self.desktop.encoder = Some(encoder.clone());

        if self.desktop.test_mode {
            let running = Arc::new(AtomicBool::new(true));
            self.desktop.synthetic = Some(running.clone());
            std::thread::spawn(move || {
                let mut frame = 0;
                while running.load(Ordering::Relaxed) {
                    if want_key.swap(false, Ordering::Relaxed) {
                        encoder.request_keyframe();
                    }
                    let _ = encoder.encode_test_pattern(frame);
                    frame += 1;
                    std::thread::sleep(Duration::from_millis(1000 / FPS as u64));
                }
            });
            self.finish_approval(&pending.id, nonce, signature, cx);
            return;
        }

        let Some(source) = self.desktop.sources.iter().find(|s| s.metadata().is_ok_and(|m| m.id == display.id)).cloned() else {
            return self.fail_approval(&pending.id, "setup", "Display is no longer available. Choose your display again.".into(), cx);
        };
        let stream = source.stream(
            cx.foreground_executor(),
            Box::new(move |frame| {
                if want_key.swap(false, Ordering::Relaxed) {
                    encoder.request_keyframe();
                }
                let _ = encoder.encode(frame.0.as_concrete_TypeRef() as *mut c_void);
            }),
        );
        let id = pending.id.clone();
        cx.spawn(async move |this, cx| {
            let result = stream.await;
            this.update(cx, |this, cx| {
                let still_pending = this.desktop.pending.as_ref().is_some_and(|p| p.id == id) && !this.disposed && this.ready;
                match result {
                    Ok(Ok(stream)) if still_pending => {
                        this.desktop.capture = Some(stream);
                        this.finish_approval(&id, nonce, signature, cx);
                    }
                    Ok(Ok(_)) => this.cleanup_media(),
                    _ => this.fail_approval(
                        &id,
                        "capture",
                        "macOS blocked screen sharing. Enable Mac Remote in Privacy & Security → Screen & System Audio Recording, quit and reopen Mac Remote, then choose your display again.".into(),
                        cx,
                    ),
                }
            })
            .ok();
        })
        .detach();
    }

    fn finish_approval(&mut self, id: &str, nonce: String, signature: String, cx: &mut Context<Self>) {
        let result = self.send(json!({ "type": "approve", "sessionId": id, "allowed": true, "desktopNonce": nonce, "approvalSignature": signature }));
        if let Err(err) = result {
            self.fail_approval(id, "capture", err.to_string(), cx);
            return;
        }
        // A remembered window starts at this approval. Reconnects within it never extend it.
        let ms = self.desktop.approving_remember_ms;
        self.desktop.remember_plan = self.desktop.pending.as_ref().filter(|p| ms > 0 && p.can_remember && !p.unlocked && p.id == id).map(|p| RememberPlan {
            session_id: p.id.clone(),
            controller_id: p.peer_id.clone(),
            grant_id: p.grant_id.clone(),
            until: now_ms() + ms.min(remember::REMEMBER_MAX_MS),
            challenge: trust::nonce(),
        });
        cx.notify();
    }

    fn fail_approval(&mut self, id: &str, stage: &str, message: String, cx: &mut Context<Self>) {
        crate::log::log(format!("approval failed at {stage}: {message}"));
        let _ = self.send(json!({ "type": "approve", "sessionId": id, "allowed": false, "failure": stage }));
        self.cleanup_media();
        self.desktop.pending = None;
        self.desktop.session = None;
        self.error = Some(message);
        cx.notify();
    }

    pub fn decline(&mut self, cx: &mut Context<Self>) {
        let Some(pending) = self.desktop.pending.clone() else { return };
        if let Err(err) = self.send(json!({ "type": "approve", "sessionId": pending.id, "allowed": false })) {
            self.report(err, cx);
        }
    }

    /// The service relays the Mac's own signed approval to both devices.
    pub(super) fn approved(&mut self, data: &Value, cx: &mut Context<Self>) -> Result<()> {
        if self.desktop.peer.is_some() {
            bail!("Unexpected repeated session approval.");
        }
        let pending = self.desktop.pending.clone().filter(|p| p.id == s(data, "sessionId")).ok_or_else(|| anyhow!("Unexpected session approval."))?;
        let nonce = s(data, "desktopNonce");
        let identity = self.identity()?;
        let pinned = self.pins.get(&pending.peer_id).is_some_and(|p| p.grant_id == pending.grant_id);
        let text = trust::session_approval(&pending.id, &self.auth.user.id, &pending.grant_id, &self.device_id, &pending.peer_id, &pending.controller_nonce, nonce);
        if !pinned || pending.desktop_nonce.as_deref() != Some(nonce) || !trust::verify(&identity.public_key, &text, s(data, "approvalSignature")) {
            bail!("Mac session approval could not be verified.");
        }
        self.desktop.session = Some(pending);
        self.desktop.pending = None;
        self.desktop.approving = false;
        self.desktop.session_status = Some(SessionStatus::Negotiating);
        self.create_peer(cx);
        Ok(())
    }

    // ---------- Peer ----------

    fn create_peer(&mut self, cx: &mut Context<Self>) {
        let Some(session_id) = self.desktop.session.as_ref().map(|s| s.id.clone()) else { return };
        self.desktop.peer_generation += 1;
        let generation = self.desktop.peer_generation;
        self.desktop.signal_seq = 0;
        self.desktop.remote_seq = 0;
        let auth = self.auth.clone();
        cx.spawn(async move |this, cx| {
            // TURN credentials are short-lived; fetch them for every connection.
            let ice = cx.background_executor().spawn(async move { account::ice(&auth) }).await;
            this.update(cx, |this, cx| {
                if this.desktop.session.as_ref().map(|s| s.id.as_str()) != Some(session_id.as_str()) || this.desktop.peer_generation != generation {
                    return;
                }
                let ice = match ice {
                    Ok(value) => {
                        let servers = peer::ice_servers(&value);
                        let kinds: Vec<&str> = servers.iter().flat_map(|s| s.urls.iter()).map(|u| u.split(':').next().unwrap_or("?")).collect();
                        crate::log::log(format!("approved; ICE servers: {kinds:?}"));
                        servers
                    }
                    Err(err) => return this.fail_session(err.to_string(), cx),
                };
                let (events, rx) = async_channel::unbounded();
                match Peer::start(ice, events) {
                    Ok((peer, sink)) => {
                        *this.desktop.video.lock().unwrap() = Some(sink);
                        this.desktop.peer = Some(peer);
                    }
                    Err(err) => return this.fail_session(err.to_string(), cx),
                }
                cx.spawn(async move |this, cx| {
                    while let Ok(event) = rx.recv().await {
                        let alive = this.update(cx, |this, cx| this.peer_event(generation, event, cx)).is_ok();
                        if !alive {
                            break;
                        }
                    }
                })
                .detach();
                this.desktop.negotiation_task = Some(cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(NEGOTIATION_TIMEOUT).await;
                    this.update(cx, |this, cx| {
                        if this.desktop.peer_generation == generation && this.desktop.session_status != Some(SessionStatus::Connected) {
                            this.fail_session("Connection timed out. Check the Mac permissions and both internet connections, then try again. See the setup guide if the devices are on different networks.".into(), cx);
                        }
                    })
                    .ok();
                }));
            })
            .ok();
        })
        .detach();
    }

    fn fail_session(&mut self, message: String, cx: &mut Context<Self>) {
        self.end(cx);
        self.report(message, cx);
    }

    fn peer_event(&mut self, generation: u64, event: PeerEvent, cx: &mut Context<Self>) {
        if generation != self.desktop.peer_generation || self.desktop.session.is_none() {
            return;
        }
        match event {
            PeerEvent::Signal(signal) => {
                if let Err(err) = self.send_signal(signal) {
                    self.fail_session(err.to_string(), cx);
                }
            }
            PeerEvent::State(state) => {
                crate::log::log(format!("peer connection: {state}"));
                self.desktop.peer_state = Some(state);
                match state {
                    RTCPeerConnectionState::Failed => self.fail_session(
                        "Could not connect to your phone. Check both devices’ internet connections and try again. If it keeps failing across networks, see the setup guide.".into(),
                        cx,
                    ),
                    RTCPeerConnectionState::Disconnected => self.desktop.session_status = Some(SessionStatus::Negotiating),
                    RTCPeerConnectionState::Connected => {
                        if let Some(encoder) = &self.desktop.encoder {
                            encoder.request_keyframe();
                        }
                    }
                    _ => {}
                }
            }
            PeerEvent::ChannelOpen => {
                crate::log::log("data channel open: session connected");
                self.desktop.negotiation_task = None;
                self.desktop.session_status = Some(SessionStatus::Connected);
                self.error = None;
                let offer = self.desktop.remember_plan.as_ref().filter(|p| self.desktop.session.as_ref().is_some_and(|s| s.id == p.session_id)).map(|p| json!({ "action": "remember-offer", "until": p.until, "challenge": p.challenge }));
                if let Some(offer) = offer {
                    self.send_data(&offer);
                }
                if let Some(encoder) = &self.desktop.encoder {
                    encoder.request_keyframe();
                }
            }
            PeerEvent::ChannelMessage(text) => self.channel_message(text, cx),
            PeerEvent::ChannelClosed => self.end(cx),
        }
        cx.notify();
    }

    /// Signs and sends the Mac's offer or ICE candidate, bound to both session nonces.
    fn send_signal(&mut self, signal: Value) -> Result<()> {
        let session = self.desktop.session.clone().ok_or_else(|| anyhow!("Session ended."))?;
        let binding = binding(&session)?;
        self.desktop.signal_seq += 1;
        let seq = self.desktop.signal_seq;
        let signature = self.identity()?.sign(&trust::signal_text(&session.id, &session.grant_id, &self.device_id, seq, &signal, &binding))?;
        self.send(json!({ "type": "signal", "sessionId": session.id, "signal": signal, "seq": seq, "signature": signature }))
    }

    /// The phone's answer or ICE, accepted only in order and signed by its pinned key.
    pub(super) fn remote_signal(&mut self, data: &Value, _cx: &mut Context<Self>) -> Result<()> {
        let Some(session) = self.desktop.session.clone().filter(|s| s.id == s_(data, "sessionId")) else { return Ok(()) };
        let signal = data.get("signal").cloned().unwrap_or(Value::Null);
        let seq = data.get("seq").and_then(Value::as_u64).unwrap_or(0);
        let pin = self.pins.get(&session.peer_id).filter(|p| p.grant_id == session.grant_id).cloned();
        let valid = pin.is_some_and(|pin| {
            seq == self.desktop.remote_seq + 1
                && binding(&session).is_ok_and(|b| trust::verify(&pin.key, &trust::signal_text(&session.id, &session.grant_id, &session.peer_id, seq, &signal, &b), s(data, "signature")))
        });
        if !valid {
            bail!("Peer identity verification failed. The connection was stopped.");
        }
        if s(&signal, "type") == "offer" {
            bail!("Unexpected peer negotiation role.");
        }
        self.desktop.remote_seq = seq;
        if let Some(peer) = &self.desktop.peer {
            peer.remote_signal(signal);
        }
        Ok(())
    }

    // ---------- Data channel and driver ----------

    fn channel_message(&mut self, text: String, cx: &mut Context<Self>) {
        if text.encode_utf16().count() > peer::MAX_MESSAGE_CHARS {
            return self.end(cx);
        }
        let now = Instant::now();
        if self.desktop.window_start.is_none_or(|start| now.duration_since(start) > Duration::from_secs(1)) {
            self.desktop.window_start = Some(now);
            self.desktop.window_count = 0;
        }
        self.desktop.window_count += 1;
        if self.desktop.window_count > peer::MAX_MESSAGES_PER_SECOND {
            self.fail_session("Remote sent too many commands.".into(), cx);
            return;
        }
        let Ok(command) = serde_json::from_str::<Value>(&text) else {
            self.report("Invalid control message.", cx);
            return;
        };
        // Remembering is between the two apps; it never reaches the input driver.
        if s(&command, "action") == "remember-key" {
            self.remember_key(command);
            return;
        }
        let result = validate_command(&command).and_then(|valid| {
            if self.desktop.session_status != Some(SessionStatus::Connected) {
                bail!("This session has not been approved.");
            }
            self.desktop.driver.as_ref().ok_or_else(|| anyhow!("The input driver is unavailable. Restart the companion."))?.write(&valid)
        });
        if let Err(err) = result {
            crate::log::log(format!("command {} refused: {err}", s(&command, "action")));
            self.send_data(&json!({ "action": "error", "error": err.to_string() }));
        }
    }

    fn send_data(&self, value: &Value) {
        if let Some(peer) = &self.desktop.peer {
            peer.send(value.to_string());
        }
    }

    fn driver_event(&mut self, event: DriverEvent, cx: &mut Context<Self>) {
        match event {
            DriverEvent::Output(value) => {
                if value.get("error").is_some_and(|e| !e.is_null()) || s(&value, "action") == "error" {
                    let message = value.get("error").and_then(Value::as_str).or(value.get("message").and_then(Value::as_str)).unwrap_or("The Mac could not complete this action.");
                    self.report(message.to_string(), cx);
                }
                if self.desktop.session_status == Some(SessionStatus::Connected) {
                    self.send_data(&value);
                }
            }
            DriverEvent::Stopped => {
                if self.desktop.driver_ready {
                    self.desktop.driver_ready = false;
                    self.report("Input driver stopped. Restart the companion.", cx);
                }
            }
        }
    }

    // ---------- Ending ----------

    /// The service ended the pending request or session.
    pub(super) fn ended(&mut self, data: &Value, cx: &mut Context<Self>) {
        let id = s(data, "sessionId");
        let ours = self.desktop.session.as_ref().is_some_and(|s| s.id == id) || self.desktop.pending.as_ref().is_some_and(|p| p.id == id);
        if !ours {
            return;
        }
        crate::log::log(format!("session ended by service: {}", s(data, "reason")));
        self.cleanup_media();
        self.desktop.session = None;
        self.desktop.pending = None;
        let reason = s(data, "reason");
        // "Mac declined" is this Mac's own choice; only the phone needs to be told.
        if !reason.is_empty() && reason != "Session ended" && reason != "Mac declined the connection" {
            self.error = Some(reason.to_string());
        }
        cx.notify();
    }

    /// End session: stop capture and input now, and tell the service (later if offline).
    pub fn end(&mut self, cx: &mut Context<Self>) {
        if self.desktop.session.is_some() || self.desktop.pending.is_some() {
            crate::log::log("session ended on this Mac");
        }
        let id = self.desktop.session.as_ref().map(|s| s.id.clone()).or(self.desktop.pending.as_ref().map(|p| p.id.clone()));
        if let Some(id) = id {
            if self.send(json!({ "type": "end", "sessionId": id })).is_err() {
                self.desktop.stale_session = Some(id);
            }
        }
        self.cleanup_media();
        self.desktop.session = None;
        self.desktop.pending = None;
        cx.notify();
    }

    /// Stops capture, encoder and peer, and lifts any held mouse buttons.
    pub(super) fn cleanup_media(&mut self) {
        let d = &mut self.desktop;
        d.negotiation_task = None;
        d.peer_generation += 1;
        if let Some(peer) = d.peer.take() {
            peer.close();
        }
        *d.video.lock().unwrap() = None;
        d.capture = None; // dropping the stream stops ScreenCaptureKit
        if let Some(running) = d.synthetic.take() {
            running.store(false, Ordering::Relaxed);
        }
        d.encoder = None;
        d.peer_state = None;
        d.session_status = None;
        d.approving = false;
        d.remember_plan = None;
        d.signal_seq = 0;
        d.remote_seq = 0;
        if let Some(driver) = &d.driver {
            driver.release();
        }
    }

    /// A live peer survives a signaling reconnect (the service holds the session briefly).
    pub(super) fn peer_alive(&self) -> bool {
        self.desktop.session.is_some()
            && self.desktop.peer.is_some()
            && !matches!(self.desktop.peer_state, Some(RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed))
    }

    /// Called on `ready` after a reconnect.
    pub(super) fn after_reconnect(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.desktop.stale_session.take() {
            let _ = self.send(json!({ "type": "end", "sessionId": id }));
        }
        if self.desktop.session.is_some() && !self.peer_alive() {
            self.end(cx);
        }
    }

    /// Called when the account socket closes.
    pub(super) fn socket_closed(&mut self, final_close: bool) {
        self.desktop.pending = None;
        self.desktop.approving = self.desktop.approving && self.desktop.session.is_some();
        if final_close || !self.peer_alive() {
            self.cleanup_media();
            self.desktop.session = None;
        }
    }
}

fn s_(value: &Value, key: &str) -> String {
    s(value, key).to_string()
}

fn binding(session: &Session) -> Result<String> {
    let desktop = session.desktop_nonce.as_ref().ok_or_else(|| anyhow!("Missing Mac session challenge."))?;
    Ok(format!("{}.{}", session.controller_nonce, desktop))
}
