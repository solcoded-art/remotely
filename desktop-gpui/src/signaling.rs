//! `/ws` transport. A blocking tungstenite socket runs on its own thread and
//! talks to the UI through channels; all protocol logic (challenge, signed
//! envelopes, pairing) lives in `connection.rs`. Like the other native clients
//! it sends no Origin header, which the service accepts.

use std::{
    io::ErrorKind,
    net::{TcpStream, ToSocketAddrs},
    thread,
    time::Duration,
};

use async_channel::{Receiver, Sender, TryRecvError};
use tungstenite::{stream::MaybeTlsStream, Message};
use url::Url;

pub enum Event {
    Message(String),
    /// The socket closed; the close code when the server sent one (4000/4001 mean "do not reconnect").
    Closed(Option<u16>),
}

/// Connects to `url` on a new thread. Dropping/closing `outgoing` closes the socket.
pub fn spawn(url: String, outgoing: Receiver<String>, events: Sender<Event>) {
    thread::Builder::new()
        .name("mac-remote-signaling".into())
        .spawn(move || {
            let code = run(&url, &outgoing, &events);
            let _ = events.send_blocking(Event::Closed(code));
        })
        .expect("start signaling thread");
}

fn run(raw: &str, outgoing: &Receiver<String>, events: &Sender<Event>) -> Option<u16> {
    let url = Url::parse(raw).ok()?;
    let host = url.host_str()?.to_string();
    let port = url.port_or_known_default()?;
    let address = (host.as_str(), port).to_socket_addrs().ok()?.next()?;
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(10)).ok()?;
    stream.set_nodelay(true).ok();
    let (mut socket, _) = tungstenite::client_tls_with_config(raw, stream, None, None).ok()?;
    // Short reads let one thread interleave reading with writing queued messages.
    match socket.get_mut() {
        MaybeTlsStream::Plain(s) => s.set_read_timeout(Some(Duration::from_millis(50))).ok()?,
        MaybeTlsStream::Rustls(s) => s.sock.set_read_timeout(Some(Duration::from_millis(50))).ok()?,
        _ => return None,
    }
    loop {
        loop {
            match outgoing.try_recv() {
                Ok(text) => {
                    if socket.send(Message::text(text)).is_err() {
                        return None;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Closed) => {
                    let _ = socket.close(None);
                    let _ = socket.flush();
                    return Some(1000);
                }
            }
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                if events.send_blocking(Event::Message(text.to_string())).is_err() {
                    let _ = socket.close(None);
                    return Some(1000);
                }
            }
            Ok(Message::Close(frame)) => return Some(frame.map(|f| u16::from(f.code)).unwrap_or(1005)),
            Ok(_) => {}
            Err(tungstenite::Error::Io(err)) if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return None,
        }
    }
}
