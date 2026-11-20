//! The Mac's WebRTC peer (webrtc-rs), mirroring `createPeer()` in
//! src/lib/connection.ts: the Mac offers one H.264 video track plus the ordered
//! `mac-remote` data channel, trickles ICE, and takes the phone's answer. It runs
//! on its own Tokio runtime; the UI talks to it through channels. Signing of
//! SDP/ICE happens in `connection.rs`, never here.

use std::{
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Result};
use bytes::Bytes;
use rtc::{
    interceptor::Registry,
    media::Sample,
    media_stream::MediaStreamTrack,
    peer_connection::configuration::media_engine::MIME_TYPE_H264,
    rtp_transceiver::rtp_sender::{RTCPFeedback, RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind},
};
use serde_json::{json, Value};
use webrtc::{
    data_channel::{DataChannelEvent, RTCDataChannelInit},
    media_stream::{track_local::static_sample::TrackLocalStaticSample, track_local::TrackLocal},
    peer_connection::{
        register_default_interceptors, MediaEngine, PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceCandidateInit, RTCIceConnectionState, RTCIceGatheringState, RTCIceServer, RTCPeerConnectionIceEvent, RTCPeerConnectionState, RTCSessionDescription, SettingEngineBuilder,
    },
};

use crate::encoder::EncodedFrame;

/// Data-channel limits shared with the phone (connection.ts).
pub const MAX_MESSAGE_CHARS: usize = 32768;
pub const MAX_MESSAGES_PER_SECOND: u32 = 250;
const SEND_BUFFER_LIMIT: usize = 65536;
const H264_FMTP: &str = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f";

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("mac-remote-webrtc")
            .enable_all()
            .build()
            .expect("start the WebRTC runtime")
    })
}

pub enum PeerEvent {
    /// A signal for the phone: `{type:'offer', sdp}` or `{type:'ice', candidate}`.
    Signal(Value),
    State(RTCPeerConnectionState),
    ChannelOpen,
    ChannelMessage(String),
    ChannelClosed,
}

enum Command {
    Remote(Value),
    Send(String),
    Close,
}

/// Video frames from the encoder thread to the RTP writer.
#[derive(Clone)]
pub struct VideoSink {
    frames: tokio::sync::mpsc::Sender<EncodedFrame>,
}

impl VideoSink {
    /// Never blocks the encoder. False when the queue was full and the frame was
    /// dropped; the caller then asks for a keyframe so the picture recovers.
    pub fn push(&self, frame: EncodedFrame) -> bool {
        self.frames.try_send(frame).is_ok()
    }
}

pub struct Peer {
    commands: tokio::sync::mpsc::UnboundedSender<Command>,
}

#[derive(Clone)]
struct Handler {
    events: async_channel::Sender<PeerEvent>,
    mid: Arc<Mutex<String>>,
    /// The local ICE username fragment, which browsers expect on each candidate.
    ufrag: Arc<Mutex<Option<String>>>,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        let Ok(init) = event.candidate.to_json() else { return };
        crate::log::log(format!("local ICE candidate: {}", candidate_type(&init.candidate)));
        // webrtc-rs reports an empty mid; browsers need the bundled m-line's real mid.
        let mid = self.mid.lock().unwrap().clone();
        let ufrag = self.ufrag.lock().unwrap().clone();
        let candidate = json!({ "candidate": init.candidate, "sdpMid": mid, "sdpMLineIndex": 0, "usernameFragment": ufrag });
        let _ = self.events.send(PeerEvent::Signal(json!({ "type": "ice", "candidate": candidate }))).await;
    }
    async fn on_ice_connection_state_change(&self, state: RTCIceConnectionState) {
        crate::log::log(format!("ICE connection: {state}"));
    }
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        crate::log::log(format!("ICE gathering: {state}"));
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        let _ = self.events.send(PeerEvent::State(state)).await;
    }
}

/// `{ urls, username, credential }` entries from `/api/ice`.
pub fn ice_servers(value: &Value) -> Vec<RTCIceServer> {
    value
        .get("iceServers")
        .and_then(Value::as_array)
        .map(|servers| {
            servers
                .iter()
                .filter_map(|server| {
                    let urls = match server.get("urls")? {
                        Value::String(url) => vec![url.clone()],
                        Value::Array(urls) => urls.iter().filter_map(|u| u.as_str().map(String::from)).collect(),
                        _ => return None,
                    };
                    let text = |key: &str| server.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
                    Some(RTCIceServer { urls, username: text("username"), credential: text("credential") })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn codec() -> RTCRtpCodec {
    let feedback = |typ: &str, parameter: &str| RTCPFeedback { typ: typ.into(), parameter: parameter.into() };
    RTCRtpCodec {
        mime_type: MIME_TYPE_H264.to_owned(),
        clock_rate: 90000,
        channels: 0,
        sdp_fmtp_line: H264_FMTP.to_owned(),
        rtcp_feedback: vec![feedback("nack", ""), feedback("nack", "pli"), feedback("ccm", "fir")],
    }
}

impl Peer {
    /// Builds the peer connection, creates the offer and starts the event loop.
    /// The returned sink accepts encoded video as soon as the phone has answered.
    pub fn start(ice: Vec<RTCIceServer>, events: async_channel::Sender<PeerEvent>) -> Result<(Self, VideoSink)> {
        let (commands, mut command_rx) = tokio::sync::mpsc::unbounded_channel::<Command>();
        let (frames, mut frame_rx) = tokio::sync::mpsc::channel::<EncodedFrame>(8);
        let sink = VideoSink { frames };
        runtime().spawn(async move {
            if let Err(err) = run(ice, events.clone(), &mut command_rx, &mut frame_rx).await {
                crate::log::log(format!("webrtc error: {err}"));
                let _ = events.send(PeerEvent::State(RTCPeerConnectionState::Failed)).await;
            }
        });
        Ok((Self { commands }, sink))
    }

    /// The phone's answer or an ICE candidate (already verified by the caller).
    pub fn remote_signal(&self, signal: Value) {
        let _ = self.commands.send(Command::Remote(signal));
    }

    /// Sends a JSON text message if the channel is open and not backed up.
    pub fn send(&self, text: String) {
        let _ = self.commands.send(Command::Send(text));
    }

    pub fn close(&self) {
        let _ = self.commands.send(Command::Close);
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.close();
    }
}

async fn run(
    ice: Vec<RTCIceServer>,
    events: async_channel::Sender<PeerEvent>,
    commands: &mut tokio::sync::mpsc::UnboundedReceiver<Command>,
    frames: &mut tokio::sync::mpsc::Receiver<EncodedFrame>,
) -> Result<()> {
    let mut media = MediaEngine::default();
    let video = RTCRtpCodecParameters { rtp_codec: codec(), payload_type: 102, ..Default::default() };
    media.register_codec(video.clone(), RtpCodecKind::Video)?;
    let registry = register_default_interceptors(Registry::new(), &mut media)?;
    // Safari and Chrome hide host addresses behind mDNS names; resolve them for direct LAN links.
    let settings = SettingEngineBuilder::new()
        .with_multicast_dns_mode(rtc::ice::mdns::MulticastDnsMode::QueryOnly)
        .with_multicast_dns_timeout(Some(Duration::from_secs(5)))
        .build();
    let handler = Arc::new(Handler { events: events.clone(), mid: Arc::new(Mutex::new("0".into())), ufrag: Arc::new(Mutex::new(None)) });
    let pc = PeerConnectionBuilder::new()
        .with_configuration(RTCConfigurationBuilder::new().with_ice_servers(ice).build())
        .with_media_engine(media)
        .with_setting_engine(settings)
        .with_interceptor_registry(registry)
        .with_handler(handler.clone())
        .with_runtime(webrtc::runtime::default_runtime().ok_or_else(|| anyhow!("No WebRTC runtime."))?)
        .with_udp_addrs(vec!["0.0.0.0:0"])
        .build()
        .await?;

    let ssrc = rand_ssrc();
    let track = Arc::new(TrackLocalStaticSample::new(
        Instant::now(),
        MediaStreamTrack::new(
            "mac-remote-screen".into(),
            "mac-remote-video".into(),
            "Mac screen".into(),
            RtpCodecKind::Video,
            vec![RTCRtpEncodingParameters {
                rtp_coding_parameters: RTCRtpCodingParameters { ssrc: Some(ssrc), ..Default::default() },
                codec: video.rtp_codec.clone(),
                ..Default::default()
            }],
        ),
    )?);
    let sender = pc.add_track(Arc::clone(&track) as Arc<dyn TrackLocal>).await?;
    let channel = pc.create_data_channel("mac-remote", Some(RTCDataChannelInit { ordered: true, ..Default::default() })).await?;

    let offer = pc.create_offer(None).await?;
    // Record mid and ufrag before gathering starts, so every candidate carries them.
    if let Some(mid) = offer.sdp.lines().find_map(|line| line.strip_prefix("a=mid:")) {
        *handler.mid.lock().unwrap() = mid.trim().to_string();
    }
    if let Some(ufrag) = offer.sdp.lines().find_map(|line| line.strip_prefix("a=ice-ufrag:")) {
        *handler.ufrag.lock().unwrap() = Some(ufrag.trim().to_string());
    }
    pc.set_local_description(offer.clone()).await?;
    crate::log::log(format!("offer created ({} m-lines)", offer.sdp.matches("\nm=").count()));
    events.send(PeerEvent::Signal(json!({ "type": "offer", "sdp": offer.sdp }))).await?;

    let mut payload_type = None;
    let mut pending_candidates: Vec<RTCIceCandidateInit> = Vec::new();
    let mut answered = false;
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                None | Some(Command::Close) => break,
                Some(Command::Remote(signal)) => {
                    match signal.get("type").and_then(Value::as_str) {
                        Some("answer") => {
                            let sdp = signal.get("sdp").and_then(Value::as_str).unwrap_or_default().to_string();
                            let codecs: Vec<&str> = sdp.lines().filter_map(|l| l.strip_prefix("a=rtpmap:")).collect();
                            crate::log::log(format!("answer received; video codecs {codecs:?}"));
                            if let Err(err) = pc.set_remote_description(RTCSessionDescription::answer(sdp)?).await {
                                crate::log::log(format!("answer rejected: {err}"));
                                return Err(err.into());
                            }
                            answered = true;
                            for candidate in pending_candidates.drain(..) {
                                let _ = pc.add_ice_candidate(candidate).await;
                            }
                            payload_type = sender.get_parameters().await?.rtp_parameters.codecs.first().map(|c| c.payload_type);
                        }
                        Some("ice") => {
                            let c = signal.get("candidate").cloned().unwrap_or(Value::Null);
                            let candidate = RTCIceCandidateInit {
                                candidate: c.get("candidate").and_then(Value::as_str).unwrap_or_default().to_string(),
                                sdp_mid: c.get("sdpMid").and_then(Value::as_str).map(String::from),
                                sdp_mline_index: c.get("sdpMLineIndex").and_then(Value::as_u64).map(|i| i as u16),
                                username_fragment: c.get("usernameFragment").and_then(Value::as_str).map(String::from),
                                ..Default::default()
                            };
                            if candidate.candidate.is_empty() { continue; }
                            crate::log::log(format!("remote ICE candidate: {}", candidate_type(&candidate.candidate)));
                            if answered {
                                if let Err(err) = pc.add_ice_candidate(candidate).await { crate::log::log(format!("remote candidate rejected: {err}")); }
                            } else { pending_candidates.push(candidate); }
                        }
                        _ => {}
                    }
                }
                Some(Command::Send(text)) => {
                    // Like connection.ts sendData(): drop rather than queue when the phone is behind.
                    if channel.outstanding_bytes().await.unwrap_or(usize::MAX) <= SEND_BUFFER_LIMIT {
                        let _ = channel.send_text(&text).await;
                    }
                }
            },
            event = channel.poll() => match event {
                Some(DataChannelEvent::OnOpen) => { events.send(PeerEvent::ChannelOpen).await?; }
                Some(DataChannelEvent::OnMessage(message)) => {
                    // Binary or non-UTF-8 messages end the session (connection.ts does the same).
                    let text = if message.is_string { String::from_utf8(message.data.to_vec()).ok() } else { None };
                    match text {
                        Some(text) => events.send(PeerEvent::ChannelMessage(text)).await?,
                        None => { events.send(PeerEvent::ChannelClosed).await?; break; }
                    }
                }
                Some(DataChannelEvent::OnClose) | None => { events.send(PeerEvent::ChannelClosed).await?; break; }
                Some(_) => {}
            },
            frame = frames.recv() => {
                let Some(frame) = frame else { break };
                if let Some(pt) = payload_type {
                    let sample = Sample { data: Bytes::from(frame.data), duration: frame.duration, ..Sample::new(Instant::now()) };
                    let _ = track.sample_writer(ssrc, pt).write_sample(&sample).await;
                }
            }
        }
    }
    let _ = channel.close().await;
    let _ = pc.close().await;
    Ok(())
}

/// "host", "srflx", "relay" or "prflx", plus the protocol; never the address.
fn candidate_type(candidate: &str) -> String {
    let parts: Vec<&str> = candidate.split_whitespace().collect();
    let kind = parts.iter().position(|p| *p == "typ").and_then(|i| parts.get(i + 1)).copied().unwrap_or("?");
    let protocol = parts.get(2).copied().unwrap_or("?");
    let mdns = if candidate.contains(".local") { " (mDNS)" } else { "" };
    format!("{kind}/{}{mdns}", protocol.to_lowercase())
}

fn rand_ssrc() -> u32 {
    let mut bytes = [0u8; 4];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut bytes);
    u32::from_be_bytes(bytes) | 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ice_servers_from_the_account_service() {
        let servers = ice_servers(&json!({ "iceServers": [
            { "urls": "stun:stun.example.com:3478" },
            { "urls": ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:443"], "username": "1700000000:user", "credential": "secret" },
            { "nope": true },
        ] }));
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].urls, vec!["stun:stun.example.com:3478"]);
        assert_eq!(servers[1].urls.len(), 2);
        assert_eq!(servers[1].username, "1700000000:user");
    }
}
