//! Plain session diagnostics (no tokens, keys or addresses), to help test against
//! a real phone. Written to stderr and always appended to
//! `~/Library/Logs/Mac Remote GPUI/session.log`, however the app was launched.

use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use crate::store::now_ms;

pub fn path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Logs/Mac Remote GPUI/session.log"))
}

fn file() -> &'static Mutex<Option<File>> {
    static FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();
    FILE.get_or_init(|| {
        let file = path().and_then(|path| {
            std::fs::create_dir_all(path.parent()?).ok()?;
            OpenOptions::new().create(true).append(true).open(path).ok()
        });
        Mutex::new(file)
    })
}

pub fn log(message: impl AsRef<str>) {
    let ms = now_ms().rem_euclid(86_400_000);
    let line = format!("[{:02}:{:02}:{:02}.{:03} UTC] {}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000, message.as_ref());
    eprintln!("{line}");
    if let Some(file) = file().lock().unwrap().as_mut() {
        let _ = writeln!(file, "{line}");
    }
}
