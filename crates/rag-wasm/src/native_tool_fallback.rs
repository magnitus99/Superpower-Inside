//! Provider-neutral downgrade policy for native tool calling.

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Maximum provider error payload inspected by the deterministic planner.
const MAX_ERROR_MESSAGE_BYTES: usize = 64 * 1024;

/// Parsed host state for one failed native-tool provider request.
struct NativeToolFallbackInput {
    /// Structured HTTP status, or `None` when the transport did not provide one.
    status: Option<u16>,
    /// Provider error body or normalized error message.
    message: String,
    /// Whether the failed request actually included the native tool protocol.
    native_attempted: bool,
    /// Whether this chat turn already used its one compatibility retry.
    compatibility_fallback_attempted: bool,
}

/// Plans whether one failed native-tool request may retry with the text compatibility protocol.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_tool_compatibility_fallback_json(input_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(input) = parse_input(&value) else {
        return String::new();
    };
    let retry_with_compatibility = input.native_attempted
        && !input.compatibility_fallback_attempted
        && matches!(input.status, Some(400 | 404 | 422))
        && clearly_rejects_native_tool_protocol(&input.message);

    json!({ "retryWithCompatibility": retry_with_compatibility }).to_string()
}

/// Parses and bounds the host wire format without guessing missing state.
fn parse_input(value: &JsonValue) -> Option<NativeToolFallbackInput> {
    let object = value.as_object()?;
    let status = match object.get("status")? {
        JsonValue::Null => None,
        value => Some(u16::try_from(value.as_u64()?).ok()?),
    };
    if status.is_some_and(|status| !(100..=599).contains(&status)) {
        return None;
    }
    let message = object.get("message")?.as_str()?;
    if message.len() > MAX_ERROR_MESSAGE_BYTES {
        return None;
    }
    Some(NativeToolFallbackInput {
        status,
        message: message.to_owned(),
        native_attempted: object.get("nativeAttempted")?.as_bool()?,
        compatibility_fallback_attempted: object
            .get("compatibilityFallbackAttempted")?
            .as_bool()?,
    })
}

/// Returns whether the provider explicitly rejects native tool fields or model capability.
fn clearly_rejects_native_tool_protocol(message: &str) -> bool {
    let normalized = message.to_lowercase();
    if !contains_any(
        &normalized,
        &[
            "tools",
            "tool_choice",
            "tool choice",
            "tool use",
            "tool calling",
            "functions",
            "function_call",
            "function calling",
        ],
    ) {
        return false;
    }

    contains_any(
        &normalized,
        &[
            "not support",
            "doesn't support",
            "does not support",
            "does not have support",
            "unsupported",
            "not available for this model",
            "not available on this model",
            "unavailable for this model",
            "unavailable on this model",
            "not implemented",
            "not enabled",
            "is disabled",
            "are disabled",
            "unknown field",
            "unknown parameter",
            "unrecognized request argument",
            "unrecognized argument",
            "unexpected field",
            "extra inputs are not permitted",
            "extra fields not permitted",
            "not permitted",
            "not allowed",
        ],
    ) || (normalized.contains("no endpoints") && normalized.contains("support"))
}

/// Returns whether text contains at least one stable provider error marker.
fn contains_any(text: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| text.contains(marker))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as JsonValue, json};

    use super::plan_native_tool_compatibility_fallback_json;

    /// Runs the planner with the common first native-attempt state.
    fn plan(status: u16, message: &str) -> JsonValue {
        let output = plan_native_tool_compatibility_fallback_json(
            &json!({
                "status": status,
                "message": message,
                "nativeAttempted": true,
                "compatibilityFallbackAttempted": false,
            })
            .to_string(),
        );
        serde_json::from_str(&output).unwrap_or(JsonValue::Null)
    }

    #[test]
    fn retries_status_400_when_model_explicitly_rejects_tools() {
        assert_eq!(
            plan(400, "This model does not support tools"),
            json!({ "retryWithCompatibility": true }),
        );
    }

    #[test]
    fn retries_status_404_when_no_endpoint_supports_tool_use() {
        assert_eq!(
            plan(404, "No endpoints found that support tool use"),
            json!({ "retryWithCompatibility": true }),
        );
    }

    #[test]
    fn retries_status_422_when_tool_choice_is_an_extra_forbidden_input() {
        assert_eq!(
            plan(422, "Extra inputs are not permitted: tool_choice"),
            json!({ "retryWithCompatibility": true }),
        );
    }

    #[test]
    fn rejects_authentication_errors_even_when_the_message_mentions_tools() {
        assert_eq!(
            plan(401, "Unauthorized while requesting tools"),
            json!({ "retryWithCompatibility": false }),
        );
    }

    #[test]
    fn rejects_rate_limit_errors_even_when_the_message_mentions_tools() {
        assert_eq!(
            plan(429, "Rate limit exceeded for tools request"),
            json!({ "retryWithCompatibility": false }),
        );
    }

    #[test]
    fn rejects_generic_bad_requests_without_an_unsupported_feature_signal() {
        assert_eq!(
            plan(400, "Invalid request body"),
            json!({ "retryWithCompatibility": false }),
        );
    }

    #[test]
    fn rejects_invalid_tool_schemas_as_fixable_request_errors() {
        assert_eq!(
            plan(400, "Invalid tools schema: parameters must be an object"),
            json!({ "retryWithCompatibility": false }),
        );
    }

    #[test]
    fn rejects_transient_tool_unavailability_without_a_capability_rejection() {
        assert_eq!(
            plan(400, "Tools are temporarily unavailable; try again later"),
            json!({ "retryWithCompatibility": false }),
        );
    }

    #[test]
    fn rejects_requests_that_never_attempted_native_tools() {
        let output = plan_native_tool_compatibility_fallback_json(
            &json!({
                "status": 400,
                "message": "This model does not support tools",
                "nativeAttempted": false,
                "compatibilityFallbackAttempted": false,
            })
            .to_string(),
        );

        assert_eq!(
            serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null),
            json!({ "retryWithCompatibility": false }),
        );
    }

    #[test]
    fn rejects_a_second_compatibility_fallback_attempt() {
        let output = plan_native_tool_compatibility_fallback_json(
            &json!({
                "status": 400,
                "message": "This model does not support tools",
                "nativeAttempted": true,
                "compatibilityFallbackAttempted": true,
            })
            .to_string(),
        );

        assert_eq!(
            serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null),
            json!({ "retryWithCompatibility": false }),
        );
    }
}
