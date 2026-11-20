//! Device identity, like `desktop/identity.cjs`: one P-256 key per
//! (storage service, user), plus the trusted-phone pins, kept in the Keychain
//! vault (vault.rs). The private key never leaves this module. If the stored
//! record cannot be read or parsed, we fail closed instead of silently making a
//! new identity (which would break every pairing).

use std::{collections::BTreeMap, sync::Mutex};

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{account::service_url, trust, vault};

/// Where builds before the single-item vault kept the device key.
const LEGACY_SERVICE: &str = "app.enftify.macremote.gpui.device-key";
const UNREADABLE: &str = "Cannot unlock your device key. Restore Keychain access; your key was not replaced.";

/// A paired phone (`Pin` in src/lib/identity.ts).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub grant_id: String,
    pub key: Value,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    /// Private scalar `d`, base64url.
    key: String,
    pins: BTreeMap<String, Pin>,
}

pub struct Identity {
    account: String,
    user_id: String,
    key: trust::DeviceKey,
    pub id: String,
    pub public_key: Value,
    pins: Mutex<BTreeMap<String, Pin>>,
}

impl Identity {
    /// Loads or creates the identity for `[storage_service, user_id]` (the JS scope).
    pub fn load(storage_service: &str, user_id: &str) -> Result<Self> {
        if service_url(storage_service)? != storage_service || !(8..=80).contains(&user_id.len()) || !user_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            bail!("Invalid identity scope.");
        }
        let account = storage_service.to_string();
        let migration = format!("identity:{user_id}");
        let record = vault::update(
            &account,
            &migration,
            |vault_record| migrate(storage_service, user_id, vault_record),
            |vault_record| match vault_record.identities.get(user_id) {
                Some(value) => Ok((serde_json::from_value::<Record>(value.clone()).map_err(|_| anyhow!(UNREADABLE))?, false)),
                None => {
                    let record = Record { key: trust::DeviceKey::generate().d(), pins: BTreeMap::new() };
                    vault_record.identities.insert(user_id.to_string(), serde_json::to_value(&record)?);
                    Ok((record, true))
                }
            },
        )?;
        let key = trust::DeviceKey::from_d(&record.key).map_err(|_| anyhow!(UNREADABLE))?;
        let public_key = key.public_jwk();
        Ok(Self { account, user_id: user_id.to_string(), id: trust::key_id(&public_key)?, public_key, key, pins: Mutex::new(record.pins) })
    }

    pub fn sign(&self, message: &str) -> Result<String> {
        self.key.sign(message)
    }

    pub fn pins(&self) -> BTreeMap<String, Pin> {
        self.pins.lock().unwrap().clone()
    }

    /// Adds, replaces (`Some`) or removes (`None`) a trusted phone, persisting before returning.
    pub fn pin(&self, peer_id: &str, pin: Option<Pin>) -> Result<()> {
        if !peer_id.starts_with("d_") || peer_id.len() != 45 || pin.as_ref().is_some_and(|p| serde_json::to_string(p).map(|s| s.len()).unwrap_or(usize::MAX) > 3000) {
            bail!("Invalid trusted device.");
        }
        let mut pins = self.pins.lock().unwrap();
        let mut next = pins.clone();
        match pin {
            Some(pin) => next.insert(peer_id.into(), pin),
            None => next.remove(peer_id),
        };
        let record = serde_json::to_value(Record { key: self.key.d(), pins: next.clone() })?;
        vault::update(&self.account, &format!("identity:{}", self.user_id), |_| Ok(false), |vault_record| {
            vault_record.identities.insert(self.user_id.clone(), record);
            Ok(((), true))
        })?;
        *pins = next;
        Ok(())
    }
}

/// Folds a device key saved by an older build into the vault, so pairings survive.
/// An old key that exists but cannot be read is an error, never a new key.
fn migrate(storage_service: &str, user_id: &str, vault_record: &mut vault::Record) -> Result<bool> {
    if vault_record.identities.contains_key(user_id) {
        return Ok(false);
    }
    let scope = serde_json::to_string(&[storage_service, user_id])?;
    let Some(bytes) = vault::legacy(LEGACY_SERVICE, &hex(&Sha256::digest(scope.as_bytes())))? else { return Ok(false) };
    let record = serde_json::from_slice::<Record>(&bytes).map_err(|_| anyhow!(UNREADABLE))?;
    vault_record.identities.insert(user_id.to_string(), serde_json::to_value(record)?);
    Ok(true)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
