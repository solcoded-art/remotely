//! Account-service client. Mirrors `shared/account-service.mjs`, `src/lib/api.ts`
//! and `src/lib/auth-session.ts`; the wire format is unchanged.

use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use url::Url;

pub const PRODUCTION_SERVICE: &str = "https://enftify.com";
pub const LEGACY_PRODUCTION_SERVICE: &str = "https://remotely-marisol-workspace-k1zb.ongale.dev";

fn is_production(origin: &str) -> bool {
    origin == PRODUCTION_SERVICE || origin == LEGACY_PRODUCTION_SERVICE
}

/// True when both origins reach the same account service.
pub fn same_service(a: &str, b: &str) -> bool {
    a == b || (is_production(a) && is_production(b))
}

/// Where requests go: the legacy address is upgraded to production.
pub fn canonical_service(origin: &str) -> String {
    if origin == LEGACY_PRODUCTION_SERVICE { PRODUCTION_SERVICE.into() } else { origin.into() }
}

/// Key that sign-ins (and later device keys) are stored under. Production keeps
/// the key earlier releases used, matching `storageService()`.
pub fn storage_service(origin: &str) -> String {
    if is_production(origin) { LEGACY_PRODUCTION_SERVICE.into() } else { origin.into() }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

/// Validates an account server URL and returns its origin (`serviceURL()` in api.ts).
pub fn service_url(raw: &str) -> Result<String> {
    let url = Url::parse(raw.trim()).map_err(|_| anyhow!("Use the server origin, such as https://remote.example.com."))?;
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        bail!("Use the server origin, such as https://remote.example.com.");
    }
    let host = url.host_str().unwrap_or_default();
    let local = is_loopback(host) || host == "::1";
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        bail!("Use HTTPS for your account server. HTTP is allowed only on localhost.");
    }
    Ok(url.origin().ascii_serialization())
}

/// Extracts the token from an emailed sign-in link (`signInLinkToken()`).
pub fn sign_in_link_token(raw: &str, service: &str) -> Result<String> {
    let invalid_origin = || anyhow!("Use a sign-in link from this account server.");
    let url = Url::parse(raw.trim()).map_err(|_| invalid_origin())?;
    let service = service_url(service)?;
    if !same_service(&url.origin().ascii_serialization(), &service)
        || url.path() != "/"
        || url.query().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid_origin());
    }
    let token = url.fragment().and_then(|hash| hash.strip_prefix("sign-in=")).unwrap_or_default();
    if !(16..=256).contains(&token.len()) || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        bail!("This sign-in link is invalid. Request a new one.");
    }
    Ok(token.to_string())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct User {
    pub id: String,
    pub email: String,
}

/// `{ user, token, expires }` from `/api/auth/verify-link` and `/api/auth/session`.
#[derive(Clone, Debug, Deserialize)]
pub struct SessionReply {
    pub user: User,
    pub token: String,
    pub expires: i64,
}

#[derive(Clone, Debug)]
pub struct Auth {
    pub user: User,
    pub token: String,
    pub expires: i64,
    pub service: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub public_key: Option<serde_json::Value>,
}

/// An account-service failure with the HTTP status, when there was one.
#[derive(Debug)]
pub struct ApiError {
    pub status: Option<u16>,
    pub message: String,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for ApiError {}

impl ApiError {
    fn new(status: Option<u16>, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
    pub fn is_unauthorized(err: &anyhow::Error) -> bool {
        err.downcast_ref::<ApiError>().is_some_and(|e| e.status == Some(401))
    }
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .http_status_as_error(false)
        .user_agent(concat!("MacRemote-GPUI/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

/// One JSON request, like `request()` in api.ts. Native clients send no Origin header.
fn request<T: DeserializeOwned>(service: &str, route: &str, method: &str, token: Option<&str>, body: Option<serde_json::Value>) -> Result<T> {
    let url = format!("{service}{route}");
    let agent = agent();
    let auth = token.map(|t| format!("Bearer {t}"));
    let result = match (method, body) {
        ("GET", _) => {
            let mut req = agent.get(&url);
            if let Some(a) = &auth { req = req.header("Authorization", a); }
            req.call()
        }
        (_, body) => {
            let mut req = agent.post(&url);
            if let Some(a) = &auth { req = req.header("Authorization", a); }
            match body {
                Some(json) => req.send_json(&json),
                None => req.send_empty(),
            }
        }
    };
    let mut response = result.map_err(|err| match err {
        ureq::Error::Timeout(_) => ApiError::new(None, "The account server took too long to respond. Check your connection and try again."),
        _ => ApiError::new(None, "Unable to reach the account server. Check your internet connection and the account server URL, then try again."),
    })?;
    let status = response.status().as_u16();
    let text = response
        .body_mut()
        .with_config()
        .limit(1 << 20)
        .read_to_string()
        .map_err(|_| ApiError::new(Some(status), "The account server did not return JSON. Check its URL."))?;
    let data: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| ApiError::new(Some(status), "The account server did not return JSON. Check its URL."))?;
    if !(200..300).contains(&status) {
        let message = data.get("error").and_then(|v| v.as_str()).unwrap_or("The request failed.");
        return Err(ApiError::new(Some(status), message).into());
    }
    serde_json::from_value(data).map_err(|_| ApiError::new(Some(status), "The account server sent an unexpected reply.").into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthConfig {
    magic_link: Option<bool>,
}

/// Whether the server can send email sign-in links (`/api/auth/config`).
pub fn magic_link_available(service: &str) -> bool {
    request::<AuthConfig>(service, "/api/auth/config", "GET", None, None)
        .map(|c| c.magic_link == Some(true))
        .unwrap_or(false)
}

pub fn send_magic_link(service: &str, email: &str) -> Result<()> {
    request::<serde_json::Value>(service, "/api/auth/magic-link", "POST", None, Some(serde_json::json!({ "email": email })))?;
    Ok(())
}

pub fn verify_link(service: &str, token: &str, email: &str) -> Result<Auth> {
    let reply: SessionReply = request(service, "/api/auth/verify-link", "POST", None, Some(serde_json::json!({ "token": token, "email": email })))?;
    Ok(Auth { user: reply.user, token: reply.token, expires: reply.expires, service: service.into() })
}

pub fn restore(service: &str, token: &str) -> Result<Auth> {
    let reply: SessionReply = request(service, "/api/auth/session", "GET", Some(token), None)?;
    Ok(Auth { user: reply.user, token: reply.token, expires: reply.expires, service: service.into() })
}

#[derive(Deserialize)]
struct DevicesReply {
    devices: Vec<Device>,
}

pub fn devices(auth: &Auth) -> Result<Vec<Device>> {
    Ok(request::<DevicesReply>(&auth.service, "/api/devices", "GET", Some(&auth.token), None)?.devices)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    device_trust: Option<u32>,
}

/// The server must speak trusted-device protocol v1 (`/api/health`).
pub fn check_health(service: &str) -> Result<()> {
    let health: Health = request(service, "/api/health", "GET", None, None)?;
    if health.device_trust != Some(1) {
        bail!("This account server needs a trusted-device update. Use the matching server and Mac app.");
    }
    Ok(())
}

#[derive(Deserialize)]
struct Challenge {
    challenge: String,
}

pub fn device_challenge(auth: &Auth) -> Result<String> {
    Ok(request::<Challenge>(&auth.service, "/api/device-challenge", "POST", Some(&auth.token), Some(serde_json::json!({})))?.challenge)
}

/// `POST /api/devices` with the device and its signed registration transcript.
pub fn register_device(auth: &Auth, body: serde_json::Value) -> Result<()> {
    request::<serde_json::Value>(&auth.service, "/api/devices", "POST", Some(&auth.token), Some(body))?;
    Ok(())
}

/// Fresh STUN/TURN servers for one connection (`/api/ice`).
pub fn ice(auth: &Auth) -> Result<serde_json::Value> {
    request(&auth.service, "/api/ice", "GET", Some(&auth.token), None)
}

/// Signs out on the server. A 401 means the session was already gone.
pub fn logout(auth: &Auth) -> Result<()> {
    match request::<serde_json::Value>(&auth.service, "/api/auth/logout", "POST", Some(&auth.token), None) {
        Ok(_) => Ok(()),
        Err(err) if ApiError::is_unauthorized(&err) => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_urls() {
        assert_eq!(service_url("https://enftify.com").unwrap(), "https://enftify.com");
        assert_eq!(service_url("https://enftify.com/").unwrap(), "https://enftify.com");
        assert_eq!(service_url("http://localhost:3000").unwrap(), "http://localhost:3000");
        assert!(service_url("http://example.com").is_err());
        assert!(service_url("https://enftify.com/path").is_err());
        assert!(service_url("https://enftify.com/?q").is_err());
        assert!(service_url("https://u:p@enftify.com").is_err());
    }

    #[test]
    fn storage_keys_match_js() {
        assert_eq!(storage_service(PRODUCTION_SERVICE), LEGACY_PRODUCTION_SERVICE);
        assert_eq!(storage_service(LEGACY_PRODUCTION_SERVICE), LEGACY_PRODUCTION_SERVICE);
        assert_eq!(storage_service("http://localhost:3000"), "http://localhost:3000");
        assert_eq!(canonical_service(LEGACY_PRODUCTION_SERVICE), PRODUCTION_SERVICE);
    }

    #[test]
    fn sign_in_links() {
        let token = "abcdefghijklmnop_-123";
        assert_eq!(sign_in_link_token(&format!("https://enftify.com/#sign-in={token}"), PRODUCTION_SERVICE).unwrap(), token);
        assert_eq!(sign_in_link_token(&format!("{LEGACY_PRODUCTION_SERVICE}/#sign-in={token}"), PRODUCTION_SERVICE).unwrap(), token);
        assert!(sign_in_link_token(&format!("https://evil.example/#sign-in={token}"), PRODUCTION_SERVICE).is_err());
        assert!(sign_in_link_token(&format!("https://enftify.com/x#sign-in={token}"), PRODUCTION_SERVICE).is_err());
        assert!(sign_in_link_token("https://enftify.com/#sign-in=short", PRODUCTION_SERVICE).is_err());
        assert!(sign_in_link_token(&format!("https://enftify.com/?a=1#sign-in={token}"), PRODUCTION_SERVICE).is_err());
    }
}
