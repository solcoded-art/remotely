//! Port of `shared/commands.cjs`: the only data-channel commands that may reach
//! the native input driver, rebuilt field by field so nothing else passes through.
//! `tests/fixtures/command-vectors.json` (from `tests/command-vectors.mjs`) pins
//! this against the JavaScript validator.

use anyhow::{bail, Result};
use serde_json::{json, Map, Value};

const LAUNCHES: [&str; 8] = [
    "com.microsoft.VSCode",
    "com.todesktop.230313mzl4w4u92",
    "dev.zed.Zed",
    "com.apple.dt.Xcode",
    "com.apple.Terminal",
    "com.apple.finder",
    "com.apple.Safari",
    "com.google.Chrome",
];

/// JavaScript `string.length` (UTF-16 code units).
fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// A finite number with |x| ≤ limit (`finite()` in commands.cjs).
fn finite(value: Option<&Value>, limit: f64) -> Option<&Value> {
    let number = value?.as_f64()?;
    (number.is_finite() && number.abs() <= limit).then_some(value?)
}

/// `Number.isInteger(x) && min ≤ x ≤ max`, returned as an integer JSON value.
fn integer(value: Option<&Value>, min: f64, max: f64) -> Option<Value> {
    let number = value?.as_f64()?;
    (number.fract() == 0.0 && number >= min && number <= max).then(|| json!(number as i64))
}

pub fn validate_command(data: &Value) -> Result<Value> {
    let Some(object) = data.as_object() else { bail!("Invalid command.") };
    let action = object.get("action").and_then(Value::as_str).unwrap_or_default();
    let request_id = object.get("requestId").and_then(Value::as_str).filter(|id| js_len(id) <= 80);
    let field = |name: &str| object.get(name);
    let mut output = Map::new();
    output.insert("action".into(), json!(action));
    match action {
        "move" | "drag" | "scroll" => {
            let (Some(dx), Some(dy)) = (finite(field("dx"), 4000.0), finite(field("dy"), 4000.0)) else { bail!("Unsupported or invalid command.") };
            output.insert("dx".into(), dx.clone());
            output.insert("dy".into(), dy.clone());
        }
        "moveTo" => {
            let (Some(x), Some(y)) = (finite(field("normX"), 1.0), finite(field("normY"), 1.0)) else { bail!("Unsupported or invalid command.") };
            if x.as_f64() < Some(0.0) || y.as_f64() < Some(0.0) {
                bail!("Unsupported or invalid command.");
            }
            output.insert("normX".into(), x.clone());
            output.insert("normY".into(), y.clone());
        }
        "click" | "down" | "up" => {
            let button = field("button").and_then(Value::as_str).unwrap_or_default();
            if !(button == "left" || button == "right" || (action == "click" && button == "double")) {
                bail!("Unsupported or invalid command.");
            }
            output.insert("button".into(), json!(button));
        }
        "key" => {
            let code = integer(field("code"), 0.0, 126.0);
            let modifiers = field("modifiers").and_then(Value::as_array).filter(|mods| {
                mods.len() <= 4 && mods.iter().all(|m| matches!(m.as_str(), Some("cmd" | "ctrl" | "alt" | "shift")))
            });
            let (Some(code), Some(modifiers)) = (code, modifiers) else { bail!("Unsupported or invalid command.") };
            output.insert("code".into(), code);
            output.insert("modifiers".into(), Value::Array(modifiers.clone()));
        }
        "type" => {
            let Some(text) = field("text").and_then(Value::as_str).filter(|t| !t.is_empty() && js_len(t) <= 4096) else { bail!("Unsupported or invalid command.") };
            output.insert("text".into(), json!(text));
        }
        "listApps" | "getBounds" | "getPos" | "releaseAll" | "status" => {}
        "activateApp" => {
            let Some(pid) = integer(field("pid"), 1.0, 2147483647.0) else { bail!("Unsupported or invalid command.") };
            output.insert("pid".into(), pid);
        }
        "launchApp" => {
            let Some(id) = field("bundleId").and_then(Value::as_str).filter(|id| LAUNCHES.contains(id)) else { bail!("Unsupported or invalid command.") };
            output.insert("bundleId".into(), json!(id));
        }
        "appIcon" => {
            let valid = |id: &&str| {
                let bytes = id.as_bytes();
                !bytes.is_empty()
                    && bytes.len() <= 200
                    && bytes[0].is_ascii_alphanumeric()
                    && bytes.iter().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
            };
            let Some(id) = field("bundleId").and_then(Value::as_str).filter(valid) else { bail!("Unsupported or invalid command.") };
            output.insert("bundleId".into(), json!(id));
        }
        _ => bail!("Unsupported or invalid command."),
    }
    if let Some(id) = request_id {
        output.insert("requestId".into(), json!(id));
    }
    Ok(Value::Object(output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_javascript_validator() {
        let vectors: Vec<Value> = serde_json::from_str(include_str!("../tests/fixtures/command-vectors.json")).unwrap();
        assert!(vectors.len() > 50);
        for vector in vectors {
            let input = &vector["input"];
            let expected = &vector["output"];
            match validate_command(input) {
                Ok(output) => {
                    assert!(!expected.is_null(), "accepted but JS rejects: {input}");
                    // Compare as numbers so 49 and 49.0 are the same, like JSON.stringify.
                    assert_eq!(normalise(&output), normalise(expected), "for {input}");
                }
                Err(_) => assert!(expected.is_null(), "rejected but JS accepts: {input}"),
            }
        }
    }

    fn normalise(value: &Value) -> Value {
        match value {
            Value::Number(n) => json!(n.as_f64()),
            Value::Array(items) => Value::Array(items.iter().map(normalise).collect()),
            Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), normalise(v))).collect()),
            other => other.clone(),
        }
    }
}
