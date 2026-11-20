//! Remembered approvals, Mac side of `src/lib/remember.ts`. The Mac may let one
//! paired phone reconnect without a prompt for a limited time (≤ 3 days), but
//! only after the phone proves a fresh device unlock (Face ID, Touch ID or
//! passcode) with a passkey the Mac recorded. The Mac verifies every proof
//! itself and still signs each session approval; the service never decides.
//! `tests/fixtures/remember-vectors.json` (from `tests/remember-vectors.mjs`,
//! which runs the JavaScript checks) pins this port.

use std::collections::BTreeMap;

use anyhow::Result;
use p256::{
    ecdsa::{signature::Verifier, Signature, VerifyingKey},
    pkcs8::DecodePublicKey,
    PublicKey,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use crate::{store::now_ms, trust, vault};

pub const REMEMBER_MAX_MS: i64 = 3 * 24 * 60 * 60 * 1000;
/// Choices on the approval prompt (REMEMBER_OPTIONS).
pub const OPTIONS: [(&str, i64); 4] = [("Ask every time", 0), ("12 hours", 12 * 3_600_000), ("1 day", 24 * 3_600_000), ("3 days", REMEMBER_MAX_MS)];

/// What the phone signs with its passkey to reconnect.
pub fn unlock_text(user_id: &str, desktop_id: &str, controller_id: &str, controller_nonce: &str) -> String {
    trust::transcript("session-unlock", vec![user_id.into(), desktop_id.into(), controller_id.into(), controller_nonce.into()])
}

fn b64ish(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Proof of a fresh unlock sent with a connection request (all base64url).
#[derive(Clone, Debug)]
pub struct Unlock {
    pub credential_id: String,
    authenticator_data: String,
    client_data_json: String,
    signature: String,
}

impl Unlock {
    /// `isUnlock()`: four base64url strings of at most 2048 characters.
    pub fn parse(value: &Value) -> Option<Self> {
        let field = |name: &str| value.get(name).and_then(Value::as_str).filter(|s| b64ish(s, 2048)).map(String::from);
        Some(Self { credential_id: field("credentialId")?, authenticator_data: field("authenticatorData")?, client_data_json: field("clientDataJSON")?, signature: field("signature")? })
    }
}

/// A phone this Mac lets reconnect without a prompt until `until`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RememberedPhone {
    pub grant_id: String,
    pub credential_id: String,
    /// SPKI, base64url.
    pub public_key: String,
    /// The web origin the passkey belongs to; every unlock must match it.
    pub origin: String,
    pub until: i64,
}

/// The checks every WebAuthn response shares: type, challenge, origin, RP id hash, user present + verified.
fn check_ceremony(kind: &str, authenticator_data: &[u8], client_data_json: &[u8], challenge: &str, origin: &str) -> bool {
    let Ok(client) = serde_json::from_slice::<Value>(client_data_json) else { return false };
    if client.get("type").and_then(Value::as_str) != Some(kind)
        || client.get("challenge").and_then(Value::as_str) != Some(challenge)
        || client.get("origin").and_then(Value::as_str) != Some(origin)
    {
        return false;
    }
    let Some(host) = Url::parse(origin).ok().and_then(|u| u.host_str().map(String::from)) else { return false };
    authenticator_data.len() >= 37 && authenticator_data[..32] == Sha256::digest(host.as_bytes())[..] && authenticator_data[32] & 0x05 == 0x05
}

fn verifying_key(spki: &str) -> Option<VerifyingKey> {
    let key = PublicKey::from_public_key_der(&trust::unb64(spki).ok()?).ok()?;
    Some(VerifyingKey::from(key))
}

/// Verifies a passkey assertion against a recorded public key (`verifyUnlock`).
pub fn verify_unlock(public_key: &str, unlock: &Unlock, challenge: &str, origin: &str) -> bool {
    (|| -> Option<bool> {
        let data = trust::unb64(&unlock.authenticator_data).ok()?;
        let client = trust::unb64(&unlock.client_data_json).ok()?;
        if !check_ceremony("webauthn.get", &data, &client, challenge, origin) {
            return Some(false);
        }
        let key = verifying_key(public_key)?;
        // WebAuthn signatures are DER. Like WebCrypto, accept high-S values.
        let signature = Signature::from_der(&trust::unb64(&unlock.signature).ok()?).ok()?;
        let mut signed = data.clone();
        signed.extend_from_slice(&Sha256::digest(&client));
        Some(key.verify(&signed, &signature).is_ok() || signature.normalize_s().is_some_and(|low| key.verify(&signed, &low).is_ok()))
    })()
    .unwrap_or(false)
}

/// HTTPS, or localhost during development.
fn passkey_origin(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let origin = url.origin().ascii_serialization();
    (origin == value && (url.scheme() == "https" || url.host_str() == Some("localhost"))).then_some(origin)
}

/// Verifies the passkey a phone offers when remembering is turned on (`verifyUnlockKey`).
/// Returns the origin the passkey belongs to, or None.
pub fn verify_unlock_key(key: &Value, challenge: &str) -> Option<String> {
    let text = |name: &str| key.get(name).and_then(Value::as_str);
    let client = trust::unb64(text("clientDataJSON")?).ok()?;
    let origin = passkey_origin(serde_json::from_slice::<Value>(&client).ok()?.get("origin")?.as_str()?)?;
    let credential_id = text("credentialId")?;
    let public_key = text("publicKey")?;
    if !b64ish(credential_id, 2048) || !b64ish(public_key, 512) {
        return None;
    }
    verifying_key(public_key)?;
    let valid = match text("kind")? {
        "get" => {
            let unlock = Unlock { credential_id: credential_id.into(), authenticator_data: text("authenticatorData")?.into(), client_data_json: text("clientDataJSON")?.into(), signature: text("signature")?.into() };
            verify_unlock(public_key, &unlock, challenge, &origin)
        }
        // A new passkey: the session's data channel already authenticates the phone; check the ceremony.
        "create" => check_ceremony("webauthn.create", &trust::unb64(text("authenticatorData")?).ok()?, &client, challenge, &origin),
        _ => false,
    };
    valid.then_some(origin)
}

// ---------- Storage (Keychain vault, per account server and user) ----------

fn key(user_id: &str) -> String {
    format!("remembered:{user_id}")
}

/// Live records (expired or over-long ones are dropped).
pub fn load(account: &str, user_id: &str) -> Result<BTreeMap<String, RememberedPhone>> {
    vault::update(account, "remembered", |_| Ok(false), |record| {
        let saved: BTreeMap<String, RememberedPhone> = record.extra.get(&key(user_id)).and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default();
        let now = now_ms();
        Ok((saved.into_iter().filter(|(_, r)| r.until > now && r.until <= now + REMEMBER_MAX_MS).collect(), false))
    })
}

pub fn save(account: &str, user_id: &str, records: &BTreeMap<String, RememberedPhone>) -> Result<()> {
    let value = serde_json::to_value(records)?;
    vault::update(account, "remembered", |_| Ok(false), |record| {
        record.extra.insert(key(user_id), value);
        Ok(((), true))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_javascript_remember_checks() {
        let vectors: Value = serde_json::from_str(include_str!("../tests/fixtures/remember-vectors.json")).unwrap();
        let args: Vec<&str> = vectors["unlockText"]["args"].as_array().unwrap().iter().map(|a| a.as_str().unwrap()).collect();
        assert_eq!(unlock_text(args[0], args[1], args[2], args[3]), vectors["unlockText"]["text"].as_str().unwrap());
        let cases = vectors["cases"].as_array().unwrap();
        assert!(cases.len() >= 20);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let expected = &case["expected"];
            match case["kind"].as_str().unwrap() {
                "unlock" => {
                    let unlock = Unlock::parse(&case["unlock"]).expect(name);
                    let got = verify_unlock(case["publicKey"].as_str().unwrap(), &unlock, case["challenge"].as_str().unwrap(), case["origin"].as_str().unwrap());
                    assert_eq!(got, expected.as_bool().unwrap(), "{name}");
                }
                "isUnlock" => assert_eq!(Unlock::parse(&case["unlock"]).is_some(), expected.as_bool().unwrap(), "{name}"),
                "key" => {
                    let got = verify_unlock_key(&case["key"], case["challenge"].as_str().unwrap());
                    assert_eq!(got.as_deref(), expected.as_str(), "{name}");
                }
                other => panic!("unknown case kind {other}"),
            }
        }
    }
}
