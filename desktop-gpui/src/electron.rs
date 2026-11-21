//! One-time import from the Electron Mac Remote app, so people switching to this
//! build keep their device key, paired phones and sign-in. Electron stores each
//! record in `~/Library/Application Support/Mac Remote/` encrypted with
//! `safeStorage` (Chromium "v10": PBKDF2-SHA1 of the Keychain password
//! "Mac Remote Safe Storage", AES-128-CBC). Reading that password shows one
//! Keychain prompt. File names are the same SHA-256 scopes this app uses.
//! `tests/fixtures/electron-vectors.json` was produced by real Electron.

use std::{fs, path::PathBuf, sync::OnceLock};

use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use anyhow::{anyhow, Result};
use p256::{pkcs8::DecodePrivateKey, SecretKey};
use security_framework::passwords::get_generic_password;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{trust, vault::NOT_FOUND};

/// Electron's `app.name`; its Keychain item is "<name> Safe Storage" / "<name> Key".
const APP_NAME: &str = "Mac Remote";

/// e2e builds only: a throwaway Electron app name, so tests never touch real data.
fn app_name() -> String {
    #[cfg(feature = "e2e")]
    if let Ok(name) = std::env::var("MAC_REMOTE_E2E_ELECTRON_NAME") {
        return name;
    }
    APP_NAME.into()
}

fn root() -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(root) = std::env::var_os("MAC_REMOTE_E2E_ELECTRON_ROOT") {
        return Some(PathBuf::from(root));
    }
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support").join(APP_NAME))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Decrypts one `safeStorage` blob with the Keychain password.
pub fn decrypt(password: &[u8], data: &[u8]) -> Result<Vec<u8>> {
    let body = data.strip_prefix(b"v10").ok_or_else(|| anyhow!("Unsupported Electron storage format."))?;
    let mut key = [0u8; 16];
    pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password, b"saltysalt", 1003, &mut key);
    cbc::Decryptor::<aes::Aes128>::new(&key.into(), &[b' '; 16].into())
        .decrypt_padded_vec_mut::<Pkcs7>(body)
        .map_err(|_| anyhow!("Electron data could not be decrypted."))
}

/// The "Mac Remote Safe Storage" password, read at most once per launch.
fn password() -> Result<&'static [u8]> {
    static PASSWORD: OnceLock<Result<Vec<u8>, String>> = OnceLock::new();
    PASSWORD
        .get_or_init(|| match get_generic_password(&format!("{} Safe Storage", app_name()), &format!("{} Key", app_name())) {
            Ok(bytes) => Ok(bytes),
            Err(err) if err.code() == NOT_FOUND => Err("Electron’s Keychain key is missing.".into()),
            Err(_) => Err("Allow access to “Mac Remote Safe Storage” to bring over your paired phones from the previous Mac Remote app.".into()),
        })
        .as_ref()
        .map(Vec::as_slice)
        .map_err(|message| anyhow!("{message}"))
}

/// The private scalar `d` (base64url) from Electron's PKCS#8 PEM key.
pub fn pem_to_d(pem: &str) -> Result<String> {
    let key = SecretKey::from_pkcs8_pem(pem).map_err(|_| anyhow!("Electron’s device key is not a P-256 key."))?;
    Ok(trust::b64(&key.to_bytes()))
}

/// Electron's device key and pins for `[storage_service, user_id]`, as this app's record
/// (`{ key, pins }`). `Ok(None)` when Electron never stored one; an error when it did
/// but it cannot be read, so the caller fails closed instead of making a new key.
pub fn device_record(storage_service: &str, user_id: &str) -> Result<Option<Value>> {
    let Some(root) = root() else { return Ok(None) };
    let scope = serde_json::to_string(&[storage_service, user_id])?;
    let file = root.join("device-keys").join(format!("{}.key", hex(&Sha256::digest(scope.as_bytes()))));
    let Ok(data) = fs::read(&file) else { return Ok(None) };
    let fail = |err: anyhow::Error| anyhow!("{err} Your paired phones were not changed. To start fresh instead, remove {}.", file.display());
    let plain = decrypt(password().map_err(fail)?, &data).map_err(fail)?;
    let record: Value = serde_json::from_slice(&plain).map_err(|_| fail(anyhow!("Electron’s device key is unreadable.")))?;
    let pem = record.get("privateKey").and_then(Value::as_str).ok_or_else(|| fail(anyhow!("Electron’s device key is missing.")))?;
    let d = pem_to_d(pem).map_err(fail)?;
    crate::log::log("imported the device key and paired phones from the Electron app");
    Ok(Some(serde_json::json!({ "key": d, "pins": record.get("pins").cloned().unwrap_or(serde_json::json!({})) })))
}

/// Electron's saved sign-in for a storage service, if any (errors just mean signing in again).
pub fn session(storage_service: &str) -> Option<Value> {
    let root = root()?;
    let file = root.join("auth-sessions").join(format!("{}.session", hex(&Sha256::digest(storage_service.as_bytes()))));
    let data = fs::read(file).ok()?;
    let plain = decrypt(password().ok()?, &data).ok()?;
    let value: Value = serde_json::from_slice(&plain).ok()?;
    value.get("token").and_then(Value::as_str)?;
    crate::log::log("imported the sign-in from the Electron app");
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};

    #[test]
    fn decrypts_real_electron_safe_storage() {
        let v: Value = serde_json::from_str(include_str!("../tests/fixtures/electron-vectors.json")).unwrap();
        let password = v["password"].as_str().unwrap().as_bytes();
        for kind in ["Async", "Sync"] {
            let data = STANDARD.decode(v[format!("ciphertext{kind}")].as_str().unwrap()).unwrap();
            let plain = decrypt(password, &data).unwrap();
            assert_eq!(String::from_utf8(plain).unwrap(), v[format!("plaintext{kind}")].as_str().unwrap(), "{kind}");
            assert!(decrypt(b"wrong password", &data).is_err() || decrypt(b"wrong password", &data).unwrap() != v[format!("plaintext{kind}")].as_str().unwrap().as_bytes());
        }
        assert!(decrypt(password, b"v11xxxxxxxxxxxxxxxx").is_err());
    }

    #[test]
    fn reads_electron_pkcs8_keys() {
        let v: Value = serde_json::from_str(include_str!("../tests/fixtures/electron-vectors.json")).unwrap();
        assert_eq!(pem_to_d(v["pkcs8Pem"].as_str().unwrap()).unwrap(), v["jwkD"].as_str().unwrap());
        assert!(pem_to_d("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n").is_err());
    }
}
