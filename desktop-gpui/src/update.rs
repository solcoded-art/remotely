//! Update prompt, like `useMacUpdate` + `desktop/updates.cjs`: compare this build
//! with the release the account service publishes at `/api/downloads/mac`, and
//! open only that service's fixed `/download/mac` page — never a URL from the
//! response.

use std::time::Duration;

use serde::Deserialize;
use url::Url;

pub const CURRENT: &str = env!("CARGO_PKG_VERSION");
pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

fn parse(version: &str) -> Option<[u64; 3]> {
    let mut parts = version.split('.');
    let mut out = [0u64; 3];
    for slot in &mut out {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    parts.next().is_none().then_some(out)
}

/// True when `candidate` is a strictly newer x.y.z version than `current`.
pub fn is_newer(candidate: Option<&str>, current: &str) -> bool {
    match (candidate.and_then(parse), parse(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// `<origin>/download/mac` for an https origin, or loopback http in development.
pub fn download_page(service: &str) -> Option<String> {
    let url = Url::parse(service).ok()?;
    let loopback = url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]" | "::1"));
    if (url.scheme() != "https" && !loopback) || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(format!("{}/download/mac", url.origin().ascii_serialization()))
}

#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    pub latest: String,
    /// The server no longer supports this version: the prompt cannot be dismissed.
    pub required: bool,
    pub service: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    version: Option<String>,
    available: Option<bool>,
    minimum_supported_version: Option<String>,
}

/// Fetches the published release. `Ok(None)` when up to date or not available.
pub fn check(service: &str) -> anyhow::Result<Option<Update>> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(8))).build().into();
    let release: Release = agent.get(format!("{service}/api/downloads/mac")).call()?.body_mut().read_json()?;
    if release.available != Some(true) || !is_newer(release.version.as_deref(), CURRENT) {
        return Ok(None);
    }
    Ok(Some(Update {
        latest: release.version.unwrap_or_default(),
        required: is_newer(release.minimum_supported_version.as_deref(), CURRENT),
        service: service.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_like_the_electron_app() {
        assert!(is_newer(Some("0.4.1"), "0.4.0"));
        assert!(is_newer(Some("1.0.0"), "0.9.9"));
        assert!(is_newer(Some("0.10.0"), "0.9.0"));
        assert!(!is_newer(Some("0.4.0"), "0.4.0"));
        assert!(!is_newer(Some("0.3.4"), "0.4.0"));
        for bad in ["", "1", "1.2", "1.2.3.4", "v1.2.3", "1.2.x", "-1.2.3"] {
            assert!(!is_newer(Some(bad), "0.0.1"), "{bad}");
        }
        assert!(!is_newer(None, "0.4.0"));
    }

    #[test]
    fn only_opens_the_services_download_page() {
        assert_eq!(download_page("https://enftify.com").as_deref(), Some("https://enftify.com/download/mac"));
        assert_eq!(download_page("http://localhost:3000").as_deref(), Some("http://localhost:3000/download/mac"));
        assert_eq!(download_page("http://example.com"), None);
        assert_eq!(download_page("https://user:pass@enftify.com"), None);
        assert_eq!(download_page("javascript:alert(1)"), None);
    }
}
