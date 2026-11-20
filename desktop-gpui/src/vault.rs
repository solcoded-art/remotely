//! All of Mac Remote's secrets for one account server live in a single Keychain
//! item (service `app.enftify.macremote.gpui`, account = storage service origin):
//! the sign-in token and, per user, the device key and paired phones. It is read
//! once per launch and cached; writes replace the whole item.
//!
//! Why one item: without an Apple Team ID, macOS's login keychain ties access to
//! the exact build, so after each rebuild every item asks again (two dialogs for
//! "Always Allow"). One item keeps that to a single prompt pair.
//!
//! Nothing falls back to plaintext. If the item exists but cannot be read or
//! parsed, callers get an error and nothing is regenerated, so a Keychain hiccup
//! can never silently replace the device key (which would break every pairing).

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Mutex, OnceLock},
};

use anyhow::{anyhow, bail, Result};
use security_framework::passwords::{get_generic_password, set_generic_password};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SERVICE: &str = "app.enftify.macremote.gpui";
/// errSecItemNotFound
pub const NOT_FOUND: i32 = -25300;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Record {
    /// `{ token, expires }`, or none when signed out.
    #[serde(default)]
    pub session: Option<Value>,
    /// User id → `{ key, pins }` (see identity.rs).
    #[serde(default)]
    pub identities: BTreeMap<String, Value>,
}

struct Cached {
    record: Record,
    /// Migrations from older builds already tried this launch ("session", "identity:<user>").
    migrated: BTreeSet<String>,
}

fn cache() -> &'static Mutex<BTreeMap<String, Cached>> {
    static CACHE: OnceLock<Mutex<BTreeMap<String, Cached>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn read(account: &str) -> Result<Record> {
    match get_generic_password(SERVICE, account) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| anyhow!("Cannot read Mac Remote’s Keychain data. Restore Keychain access; nothing was replaced.")),
        Err(err) if err.code() == NOT_FOUND => Ok(Record::default()),
        Err(_) => bail!("Mac Keychain is unavailable. Unlock it, allow Mac Remote GPUI, and try again."),
    }
}

/// Runs `f` on the account's record under one lock, saving if anything changed.
/// `migrate` (named by `migration`) runs once per launch before `f`, to fold in
/// data from older builds; it returns whether it changed the record.
pub fn update<R>(
    account: &str,
    migration: &str,
    migrate: impl FnOnce(&mut Record) -> Result<bool>,
    f: impl FnOnce(&mut Record) -> Result<(R, bool)>,
) -> Result<R> {
    let mut cache = cache().lock().unwrap();
    if !cache.contains_key(account) {
        cache.insert(account.to_string(), Cached { record: read(account)?, migrated: BTreeSet::new() });
    }
    let entry = cache.get_mut(account).expect("cached above");
    let mut next = entry.record.clone();
    let mut changed = false;
    if !entry.migrated.contains(migration) {
        changed |= migrate(&mut next)?;
    }
    let (result, f_changed) = f(&mut next)?;
    if changed || f_changed {
        set_generic_password(SERVICE, account, &serde_json::to_vec(&next)?).map_err(|_| anyhow!("Mac Keychain is unavailable. Unlock it and try again."))?;
        entry.record = next;
    }
    entry.migrated.insert(migration.to_string());
    Ok(result)
}

/// Reads an item written by builds before the single-item vault: `None` when it
/// does not exist, an error when it exists but could not be read (e.g. Deny).
pub fn legacy(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    match get_generic_password(service, account) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.code() == NOT_FOUND => Ok(None),
        Err(_) => bail!("Mac Keychain did not allow reading data saved by an earlier build. Allow Mac Remote GPUI and try again."),
    }
}
