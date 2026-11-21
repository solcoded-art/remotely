//! The native input helper (`driver/mac_driver.swift`, built by
//! `npm run build:driver`) as a child process speaking JSON lines, exactly as in
//! `desktop/main.cjs`. Only commands from `commands::validate_command`, plus the
//! Mac's own `setDisplay`/`releaseAll`, are ever written to it.

use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

/// Pending command bytes allowed before input is refused (Electron's writableLength check).
const QUEUE_LIMIT: usize = 65536;

pub enum DriverEvent {
    /// A JSON reply from the driver (apps, icons, errors…).
    Output(Value),
    /// The driver exited or could not be written to.
    Stopped,
}

pub struct Driver {
    child: Option<Child>,
    sender: Option<std::sync::mpsc::SyncSender<String>>,
    pending: Arc<Mutex<usize>>,
    alive: Arc<Mutex<bool>>,
}

/// Where the helper lives: `MAC_REMOTE_DRIVER`, inside an app bundle's Resources,
/// or the repository's `bin/mac_driver` next to a cargo build.
pub fn locate() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("MAC_REMOTE_DRIVER") {
        return Some(PathBuf::from(path));
    }
    let exe = std::env::current_exe().ok()?;
    let mut candidates = vec![exe.parent()?.join("../Resources/mac_driver")];
    for ancestor in exe.ancestors().skip(1) {
        candidates.push(ancestor.join("bin/mac_driver"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

impl Driver {
    pub fn spawn(events: async_channel::Sender<DriverEvent>) -> Result<Self> {
        let path = locate().ok_or_else(|| anyhow!("Compile the input driver with npm run build:driver."))?;
        let mut child = Command::new(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| anyhow!("The input driver could not start. Run npm run build:driver."))?;
        let stdin: ChildStdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let alive = Arc::new(Mutex::new(true));
        let pending = Arc::new(Mutex::new(0usize));

        // Writer: a bounded queue so a stalled driver cannot grow memory without limit.
        let (sender, receiver) = std::sync::mpsc::sync_channel::<String>(1024);
        {
            let (alive, pending, events) = (alive.clone(), pending.clone(), events.clone());
            thread::spawn(move || {
                let mut stdin = stdin;
                for line in receiver {
                    let size = line.len();
                    let ok = stdin.write_all(line.as_bytes()).and_then(|()| stdin.flush()).is_ok();
                    *pending.lock().unwrap() -= size;
                    if !ok {
                        *alive.lock().unwrap() = false;
                        let _ = events.send_blocking(DriverEvent::Stopped);
                        break;
                    }
                }
            });
        }
        {
            let (alive, events) = (alive.clone(), events.clone());
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        if events.send_blocking(DriverEvent::Output(value)).is_err() {
                            break;
                        }
                    }
                }
                *alive.lock().unwrap() = false;
                let _ = events.send_blocking(DriverEvent::Stopped);
            });
        }
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[driver] {line}");
            }
        });
        Ok(Self { child: Some(child), sender: Some(sender), pending, alive })
    }

    pub fn ready(&self) -> bool {
        *self.alive.lock().unwrap()
    }

    pub fn write(&self, command: &Value) -> Result<()> {
        if !self.ready() {
            bail!("The input driver is unavailable. Restart the companion.");
        }
        let line = format!("{command}\n");
        {
            let mut pending = self.pending.lock().unwrap();
            if command["action"] != "releaseAll" && *pending > QUEUE_LIMIT {
                bail!("Input queue is busy.");
            }
            *pending += line.len();
        }
        let sender = self.sender.as_ref().ok_or_else(|| anyhow!("The input driver is unavailable."))?;
        sender.try_send(line).map_err(|_| anyhow!("Input queue is busy."))
    }

    /// Lifts any held mouse buttons. Called whenever a session ends.
    pub fn release(&self) {
        let _ = self.write(&json!({ "action": "releaseAll" }));
    }
}

impl Drop for Driver {
    fn drop(&mut self) {
        // Release held buttons, then close stdin so the driver exits after writing it;
        // kill it if it has not exited a second later.
        self.release();
        self.sender = None;
        if let Some(mut child) = self.child.take() {
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_secs(1));
                if !matches!(child.try_wait(), Ok(Some(_))) {
                    let _ = child.kill();
                }
                let _ = child.wait();
            });
        }
    }
}
