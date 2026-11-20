//! Port of `shared/trust.mjs`: versioned, fixed-shape transcripts signed with
//! P-256 ECDSA (raw r‖s, base64url). Transcripts must equal JavaScript's
//! `JSON.stringify([...])` byte-for-byte; serde_json's `preserve_order` keeps
//! object keys in insertion order, and its string escaping matches
//! JSON.stringify for valid Unicode. `tests/fixtures/trust-vectors.json` (made by
//! `tests/trust-vectors.mjs`) pins this against the JavaScript implementation.

use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use p256::ecdsa::{signature::Signer, signature::Verifier, Signature, SigningKey, VerifyingKey};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const PROTOCOL: &str = "remotely-trust-v1";

pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Strict base64url decoding, like `unb64()`: canonical encodings only.
pub fn unb64(value: &str) -> Result<Vec<u8>> {
    if value.is_empty() || value.len() > 4096 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        bail!("Invalid encoding.");
    }
    let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| anyhow!("Invalid encoding."))?;
    if b64(&bytes) != value {
        bail!("Invalid encoding.");
    }
    Ok(bytes)
}

/// 32 random bytes, base64url.
pub fn nonce() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    b64(&bytes)
}

/// Validates a public P-256 JWK and returns it in canonical `{crv, kty, x, y}` form.
pub fn public_key(value: &Value) -> Result<Value> {
    let map = value.as_object().ok_or_else(|| anyhow!("A public P-256 device key is required."))?;
    let allowed = ["kty", "crv", "x", "y", "ext", "key_ops"];
    if map.get("kty").and_then(Value::as_str) != Some("EC")
        || map.get("crv").and_then(Value::as_str) != Some("P-256")
        || map.contains_key("d")
        || map.keys().any(|k| !allowed.contains(&k.as_str()))
    {
        bail!("A public P-256 device key is required.");
    }
    let x = map.get("x").and_then(Value::as_str).unwrap_or_default();
    let y = map.get("y").and_then(Value::as_str).unwrap_or_default();
    if unb64(x)?.len() != 32 || unb64(y)?.len() != 32 {
        bail!("Invalid device key.");
    }
    Ok(json!({ "crv": "P-256", "kty": "EC", "x": x, "y": y }))
}

/// `d_` + base64url(SHA-256(JSON of the canonical public key)).
pub fn key_id(key: &Value) -> Result<String> {
    let canonical = serde_json::to_string(&public_key(key)?)?;
    Ok(format!("d_{}", b64(&Sha256::digest(canonical.as_bytes()))))
}

pub fn transcript(purpose: &str, values: Vec<Value>) -> String {
    let mut items = vec![Value::from(PROTOCOL), Value::from(purpose)];
    items.extend(values);
    serde_json::to_string(&Value::Array(items)).expect("JSON values always serialise")
}

pub fn registration(challenge: &str, user_id: &str, id: &str, name: &str, kind: &str, key: &Value) -> Result<String> {
    Ok(transcript("register", vec![challenge.into(), user_id.into(), id.into(), name.into(), kind.into(), public_key(key)?]))
}
pub fn hello(challenge: &str, user_id: &str, device_id: &str) -> String {
    transcript("hello", vec![challenge.into(), user_id.into(), device_id.into()])
}
pub fn envelope(challenge: &str, user_id: &str, device_id: &str, seq: u64, data: &Value) -> String {
    transcript("message", vec![challenge.into(), user_id.into(), device_id.into(), seq.into(), data.clone()])
}
pub fn pairing(invite_id: &str, request_id: &str, user_id: &str, desktop_id: &str, controller_id: &str, key: &Value) -> Result<String> {
    Ok(transcript("pair", vec![invite_id.into(), request_id.into(), user_id.into(), desktop_id.into(), controller_id.into(), public_key(key)?]))
}
pub fn grant_text(grant: &Value) -> Result<String> {
    let field = |name: &str| -> Result<Value> {
        grant.get(name).filter(|v| v.is_string()).cloned().ok_or_else(|| anyhow!("Invalid grant."))
    };
    Ok(transcript(
        "grant",
        vec![
            field("id")?,
            field("userId")?,
            field("desktopId")?,
            field("controllerId")?,
            public_key(grant.get("desktopKey").unwrap_or(&Value::Null))?,
            public_key(grant.get("controllerKey").unwrap_or(&Value::Null))?,
            field("inviteId")?,
            field("requestId")?,
        ],
    ))
}
pub fn session_request(user_id: &str, grant_id: &str, desktop_id: &str, controller_id: &str, nonce: &str) -> String {
    transcript("session-request", vec![user_id.into(), grant_id.into(), desktop_id.into(), controller_id.into(), nonce.into()])
}
#[allow(dead_code)] // Signed when approving a session (milestone 3).
pub fn session_approval(session_id: &str, user_id: &str, grant_id: &str, desktop_id: &str, controller_id: &str, controller_nonce: &str, desktop_nonce: &str) -> String {
    transcript(
        "session-approval",
        vec![session_id.into(), user_id.into(), grant_id.into(), desktop_id.into(), controller_id.into(), controller_nonce.into(), desktop_nonce.into()],
    )
}
#[allow(dead_code)] // Used by WebRTC signaling in milestone 3.
pub fn signal_text(session_id: &str, grant_id: &str, sender_id: &str, seq: u64, signal: &Value, binding: &str) -> String {
    transcript("signal", vec![session_id.into(), grant_id.into(), sender_id.into(), binding.into(), seq.into(), signal.clone()])
}

fn verifying_key(key: &Value) -> Result<VerifyingKey> {
    let key = public_key(key)?;
    let mut sec1 = vec![4u8];
    sec1.extend(unb64(key["x"].as_str().unwrap_or_default())?);
    sec1.extend(unb64(key["y"].as_str().unwrap_or_default())?);
    VerifyingKey::from_sec1_bytes(&sec1).map_err(|_| anyhow!("Invalid device key."))
}

/// Verifies a base64url r‖s ECDSA P-256/SHA-256 signature. Never panics; false on any problem.
pub fn verify(key: &Value, value: &str, signature: &str) -> bool {
    let Ok(bytes) = unb64(signature) else { return false };
    if bytes.len() != 64 {
        return false;
    }
    let (Ok(key), Ok(signature)) = (verifying_key(key), Signature::from_slice(&bytes)) else { return false };
    key.verify(value.as_bytes(), &signature).is_ok()
}

#[allow(dead_code)] // The phone side creates proofs; the Mac only verifies them.
pub fn proof(secret: &str, value: &str) -> Result<String> {
    let secret = unb64(secret)?;
    if secret.len() != 32 {
        bail!("Invalid pairing secret.");
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret)?;
    mac.update(value.as_bytes());
    Ok(b64(&mac.finalize().into_bytes()))
}

/// Constant-time HMAC-SHA-256 check of a pairing proof.
pub fn verify_proof(secret: &str, value: &str, signature: &str) -> bool {
    let (Ok(secret), Ok(signature)) = (unb64(secret), unb64(signature)) else { return false };
    if secret.len() != 32 {
        return false;
    }
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&secret) else { return false };
    mac.update(value.as_bytes());
    mac.verify_slice(&signature).is_ok()
}

/// A device's private key. Signs only `remotely-trust-v1` transcripts.
pub struct DeviceKey(SigningKey);

impl DeviceKey {
    pub fn generate() -> Self {
        Self(SigningKey::random(&mut OsRng))
    }
    /// From the 32-byte private scalar (JWK `d`), base64url.
    pub fn from_d(d: &str) -> Result<Self> {
        let bytes = unb64(d)?;
        Ok(Self(SigningKey::from_slice(&bytes).map_err(|_| anyhow!("Invalid device key."))?))
    }
    pub fn d(&self) -> String {
        b64(&self.0.to_bytes())
    }
    pub fn public_jwk(&self) -> Value {
        let point = self.0.verifying_key().to_encoded_point(false);
        json!({ "crv": "P-256", "kty": "EC", "x": b64(point.x().expect("uncompressed")), "y": b64(point.y().expect("uncompressed")) })
    }
    pub fn sign(&self, message: &str) -> Result<String> {
        if message.len() > 250_000 || !message.starts_with(&format!("[\"{PROTOCOL}\",")) {
            bail!("Invalid identity request.");
        }
        let signature: Signature = self.0.sign(message.as_bytes());
        Ok(b64(&signature.to_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vectors() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/trust-vectors.json")).unwrap()
    }
    fn s<'a>(v: &'a Value, name: &str) -> &'a str {
        v[name].as_str().unwrap()
    }

    #[test]
    fn transcripts_match_javascript_byte_for_byte() {
        let v = vectors();
        let key = &v["publicKey"];
        let id = key_id(key).unwrap();
        assert_eq!(id, s(&v, "keyId"));
        let t = &v["transcripts"];
        let (challenge, a, b) = (s(&v, "challenge"), s(&v, "nonceA"), s(&v, "nonceB"));
        assert_eq!(registration(challenge, "user-0001", &id, s(&v, "tricky"), "desktop", key).unwrap(), s(t, "registration"));
        assert_eq!(hello(challenge, "user-0001", &id), s(t, "hello"));
        assert_eq!(envelope(challenge, "user-0001", &id, 7, &v["data"]), s(t, "envelope"));
        assert_eq!(pairing("invite-0001", "request-0001", "user-0001", &id, "d_phone", key).unwrap(), s(t, "pairing"));
        assert_eq!(grant_text(&v["grant"]).unwrap(), s(t, "grant"));
        assert_eq!(session_request("user-0001", "grant-0001", &id, "d_phone", a), s(t, "sessionRequest"));
        assert_eq!(session_approval("session-0001", "user-0001", "grant-0001", &id, "d_phone", a, b), s(t, "sessionApproval"));
        assert_eq!(signal_text("session-0001", "grant-0001", &id, 3, &v["signal"], &format!("{a}.{b}")), s(t, "signal"));
        // A data object built in Rust serialises identically to the parsed fixture.
        let data = json!({ "type": "pair-open", "inviteId": "invite-0001", "expires": 1767225600000u64 });
        assert_eq!(envelope(challenge, "user-0001", &id, 7, &data), s(t, "envelope"));
    }

    #[test]
    fn verifies_javascript_signatures_and_rejects_changes() {
        let v = vectors();
        let key = &v["publicKey"];
        for (name, text) in v["transcripts"].as_object().unwrap() {
            let signature = s(&v["signatures"], name);
            assert!(verify(key, text.as_str().unwrap(), signature), "{name}");
            assert!(!verify(key, &format!("{} ", text.as_str().unwrap()), signature), "{name} changed");
        }
        assert!(!verify(key, "x", "not-a-signature"));
    }

    #[test]
    fn signs_like_webcrypto() {
        let v = vectors();
        let key = DeviceKey::from_d(s(&v, "privateKey")).unwrap();
        assert_eq!(key.public_jwk(), v["publicKey"]);
        let text = s(&v["transcripts"], "hello");
        let signature = key.sign(text).unwrap();
        assert_eq!(unb64(&signature).unwrap().len(), 64);
        // RFC 6979 signatures are deterministic. This exact value was checked with
        // `verify()` from shared/trust.mjs (WebCrypto), so the format is interoperable.
        assert_eq!(signature, "bUyhvhOQut_vG65sjKCEn46H_SEfTyEZTIBGfGGpSKKuShlGwCcA0dkypLKRyqiBAjscrDukau7WWITpjaYf8w");
        assert!(verify(&v["publicKey"], text, &signature));
        assert!(key.sign("not a transcript").is_err());
        let fresh = DeviceKey::generate();
        let again = DeviceKey::from_d(&fresh.d()).unwrap();
        assert_eq!(fresh.public_jwk(), again.public_jwk());
    }

    #[test]
    fn pairing_proofs_match() {
        let v = vectors();
        let text = s(&v["transcripts"], "pairing");
        assert_eq!(proof(s(&v, "secret"), text).unwrap(), s(&v, "proof"));
        assert!(verify_proof(s(&v, "secret"), text, s(&v, "proof")));
        assert!(!verify_proof(&nonce(), text, s(&v, "proof")));
        assert!(!verify_proof(s(&v, "secret"), &format!("{text} "), s(&v, "proof")));
    }

    #[test]
    fn public_key_rules() {
        let v = vectors();
        let mut private = v["publicKey"].clone();
        private["d"] = json!(s(&v, "privateKey"));
        assert!(public_key(&private).is_err());
        let mut other = v["publicKey"].clone();
        other["crv"] = json!("P-384");
        assert!(public_key(&other).is_err());
        let mut bad = v["publicKey"].clone();
        bad["x"] = json!("bad");
        assert!(public_key(&bad).is_err());
        assert!(unb64("AA==").is_err());
        assert!(unb64("AB").is_err()); // non-canonical trailing bits
    }
}
