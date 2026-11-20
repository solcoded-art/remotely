//! Local persistence. The sign-in token lives only in the macOS Keychain (the
//! single vault item, see vault.rs), scoped by storage service like
//! `desktop/auth-session.cjs`; there is no plaintext fallback. The chosen server
//! origin (not a credential) is a plain preference.

use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    account::{service_url, storage_service},
    vault,
};

/// Where builds before the single-item vault kept the login.
const LEGACY_SESSION_SERVICE: &str = "app.enftify.macremote.gpui.session";

#[derive(Serialize, Deserialize)]
pub struct SavedSession {
    pub token: String,
    pub expires: i64,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn valid_token(token: &str) -> bool {
    (16..=128).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Keychain account for a server origin; production aliases share one entry.
pub fn account(origin: &str) -> Result<String> {
    if service_url(origin)? != origin {
        bail!("Invalid account server.");
    }
    Ok(storage_service(origin))
}

/// Folds a login saved by an older build into the vault (read once per launch).
/// A login that cannot be migrated just means signing in again.
fn migrate_session(account: &str, record: &mut vault::Record) -> Result<bool> {
    if record.session.is_some() {
        return Ok(false);
    }
    let Ok(Some(bytes)) = vault::legacy(LEGACY_SESSION_SERVICE, account) else { return Ok(false) };
    Ok(match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => {
            record.session = Some(value);
            true
        }
        Err(_) => false,
    })
}

pub fn save_session(origin: &str, token: &str, expires: i64) -> Result<()> {
    if !valid_token(token) || expires <= now_ms() {
        bail!("Invalid login session.");
    }
    let account = account(origin)?;
    let value = serde_json::to_value(SavedSession { token: token.into(), expires })?;
    vault::update(&account, "session", |r| migrate_session(&account, r), |record| {
        record.session = Some(value);
        Ok(((), true))
    })
    .map_err(|_| anyhow!("Unlock your Mac Keychain to remember this login."))
}

pub fn load_session(origin: &str) -> Result<Option<SavedSession>> {
    let account = account(origin)?;
    vault::update(&account, "session", |r| migrate_session(&account, r), |record| {
        let saved = record.session.clone().and_then(|value| serde_json::from_value::<SavedSession>(value).ok());
        match saved {
            Some(saved) if saved.expires > now_ms() && valid_token(&saved.token) => Ok((Some(saved), false)),
            Some(_) => {
                record.session = None;
                Ok((None, true))
            }
            None => Ok((None, false)),
        }
    })
    .map_err(|err| anyhow!("Cannot restore your login. {err}"))
}

pub fn clear_session(origin: &str) -> Result<()> {
    let account = account(origin)?;
    vault::update(&account, "session", |_| Ok(false), |record| {
        let changed = record.session.take().is_some();
        Ok(((), changed))
    })
    .map_err(|_| anyhow!("Cannot remove the saved login from your Keychain."))
}

fn preferences_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support/Mac Remote GPUI"))
}

/// The last account server used, or None for the default.
pub fn saved_server() -> Option<String> {
    let text = fs::read_to_string(preferences_dir()?.join("server")).ok()?;
    service_url(text.trim()).ok()
}

pub fn remember_server(origin: &str) {
    if let Some(dir) = preferences_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("server"), origin);
    }
}
