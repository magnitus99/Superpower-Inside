//! Model-neutral fallback protocol for providers without native function calling.

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Opening delimiter understood by weak-model compatibility mode.
const OPEN_TAG: &str = "<tool_call>";
/// Closing delimiter understood by weak-model compatibility mode.
const CLOSE_TAG: &str = "</tool_call>";
/// Per-response bound that prevents untrusted model text from planning unbounded work.
const MAX_TOOL_CALLS: usize = 8;

/// Extracts bounded JSON tool calls from the compatibility protocol.
#[must_use]
#[wasm_bindgen]
pub fn plan_compatibility_tool_calls_json(content: &str) -> String {
    let mut calls = Vec::<JsonValue>::new();
    let mut remaining = content;
    while calls.len() < MAX_TOOL_CALLS {
        let Some(open_index) = remaining.find(OPEN_TAG) else {
            break;
        };
        let after_open = &remaining[open_index + OPEN_TAG.len()..];
        let Some(close_index) = after_open.find(CLOSE_TAG) else {
            break;
        };
        let body = after_open[..close_index].trim();
        if let Some(call) = parse_call(body) {
            calls.push(call);
        }
        remaining = &after_open[close_index + CLOSE_TAG.len()..];
    }
    json!(calls).to_string()
}

/// Removes only complete compatibility tool-call blocks from visible answer text.
#[must_use]
#[wasm_bindgen]
pub fn strip_compatibility_tool_calls(content: &str) -> String {
    let mut visible = String::with_capacity(content.len());
    let mut remaining = content;
    loop {
        let Some(open_index) = remaining.find(OPEN_TAG) else {
            visible.push_str(remaining);
            break;
        };
        visible.push_str(&remaining[..open_index]);
        let after_open = &remaining[open_index + OPEN_TAG.len()..];
        let Some(close_index) = after_open.find(CLOSE_TAG) else {
            visible.push_str(&remaining[open_index..]);
            break;
        };
        remaining = &after_open[close_index + CLOSE_TAG.len()..];
    }
    visible.trim().to_owned()
}

/// Validates one compatibility call and normalizes its arguments to JSON text.
fn parse_call(body: &str) -> Option<JsonValue> {
    let value = serde_json::from_str::<JsonValue>(body).ok()?;
    let object = value.as_object()?;
    let name = object.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let arguments = match object.get("arguments")? {
        JsonValue::String(arguments) => {
            let parsed = serde_json::from_str::<JsonValue>(arguments).ok()?;
            if !parsed.is_object() {
                return None;
            }
            parsed.to_string()
        }
        arguments @ JsonValue::Object(_) => arguments.to_string(),
        _ => return None,
    };
    Some(json!({ "name": name, "arguments": arguments }))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as JsonValue, json};

    use super::{plan_compatibility_tool_calls_json, strip_compatibility_tool_calls};

    #[test]
    fn extracts_object_and_string_arguments() {
        let content = concat!(
            "조사하겠습니다.\n",
            "<tool_call>{\"name\":\"superpower_inside\",\"arguments\":{\"action\":\"search\",\"query\":\"alpha\"}}</tool_call>",
            "<tool_call>{\"name\":\"other\",\"arguments\":\"{\\\"path\\\":\\\"A.md\\\"}\"}</tool_call>"
        );
        let output = plan_compatibility_tool_calls_json(content);
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);

        assert_eq!(parsed.as_array().map(Vec::len), Some(2));
        assert_eq!(
            parsed.get(0).and_then(|call| call.get("name")),
            Some(&json!("superpower_inside"))
        );
        assert_eq!(
            parsed.get(1).and_then(|call| call.get("arguments")),
            Some(&json!("{\"path\":\"A.md\"}"))
        );
    }

    #[test]
    fn ignores_invalid_calls_and_strips_only_complete_blocks() {
        let content = "앞 <tool_call>{invalid}</tool_call> 뒤 <tool_call>unfinished";

        assert_eq!(plan_compatibility_tool_calls_json(content), "[]");
        assert_eq!(
            strip_compatibility_tool_calls(content),
            "앞  뒤 <tool_call>unfinished"
        );
    }
}
