use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 공급자가 실제로 제공한 안전한 정수 토큰만 공통 형식으로 옮깁니다.
#[wasm_bindgen]
pub fn normalize_provider_usage_json(format: &str, payload_json: &str) -> String {
    serde_json::from_str::<Value>(payload_json)
        .ok()
        .and_then(|payload| normalize(format, &payload))
        .map_or_else(String::new, |usage| usage.to_string())
}

/// 자바스크립트에서 손실 없이 표현할 수 있는 토큰 수입니다.
fn count(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .filter(|count| *count <= 9_007_199_254_740_991)
}

/// 없는 값은 0으로 꾸미지 않습니다.
fn copy(usage: &Value, path: &str, output: &mut Map<String, Value>, key: &str) {
    if let Some(value) = usage.pointer(path).and_then(count) {
        output.insert(key.to_owned(), json!(value));
    }
}

/// 캐시·추론의 공급자별 포함 관계를 보존합니다.
pub fn normalize(format: &str, payload: &Value) -> Option<Value> {
    let mut output = Map::new();
    match format {
        "openai" | "responses" => {
            let usage = payload.get("usage")?;
            let (input, completion, input_details, output_details) = if format == "responses" {
                (
                    "/input_tokens",
                    "/output_tokens",
                    "/input_tokens_details/cached_tokens",
                    "/output_tokens_details/reasoning_tokens",
                )
            } else {
                (
                    "/prompt_tokens",
                    "/completion_tokens",
                    "/prompt_tokens_details/cached_tokens",
                    "/completion_tokens_details/reasoning_tokens",
                )
            };
            copy(usage, input, &mut output, "inputTokens");
            copy(usage, completion, &mut output, "outputTokens");
            copy(usage, "/total_tokens", &mut output, "totalTokens");
            copy(usage, input_details, &mut output, "cacheReadTokens");
            copy(usage, output_details, &mut output, "reasoningTokens");
        }
        "claude" => {
            let usage = payload
                .pointer("/message/usage")
                .or_else(|| payload.get("usage"))?;
            copy(usage, "/output_tokens", &mut output, "outputTokens");
            copy(
                usage,
                "/cache_read_input_tokens",
                &mut output,
                "cacheReadTokens",
            );
            if let Some(input) = usage.get("input_tokens").and_then(count) {
                let mut total = Some(input);
                for key in ["cache_read_input_tokens", "cache_creation_input_tokens"] {
                    if let Some(value) = usage.get(key) {
                        total = total.and_then(|current| current.checked_add(count(value)?));
                    }
                }
                if let Some(total) = total.filter(|total| *total <= 9_007_199_254_740_991) {
                    output.insert("inputTokens".to_owned(), json!(total));
                }
            }
        }
        "ollama" => {
            copy(payload, "/prompt_eval_count", &mut output, "inputTokens");
            copy(payload, "/eval_count", &mut output, "outputTokens");
        }
        "gemini" => {
            let usage = payload.get("usageMetadata")?;
            copy(usage, "/promptTokenCount", &mut output, "inputTokens");
            copy(usage, "/totalTokenCount", &mut output, "totalTokens");
            copy(
                usage,
                "/cachedContentTokenCount",
                &mut output,
                "cacheReadTokens",
            );
            copy(usage, "/thoughtsTokenCount", &mut output, "reasoningTokens");
            if let Some(candidates) = usage.get("candidatesTokenCount").and_then(count) {
                let thoughts = usage.get("thoughtsTokenCount").map_or(Some(0), count);
                if let Some(total) = thoughts
                    .and_then(|thoughts| candidates.checked_add(thoughts))
                    .filter(|total| *total <= 9_007_199_254_740_991)
                {
                    output.insert("outputTokens".to_owned(), json!(total));
                }
            }
        }
        _ => return None,
    }
    (!output.is_empty()).then_some(Value::Object(output))
}

#[cfg(test)]
/// 실제 보고의 포함 관계와 미제공 경계를 검증합니다.
mod tests {
    use super::normalize;
    use serde_json::json;

    #[test]
    /// 공급자마다 다른 캐시와 추론의 포함 관계를 유지합니다.
    fn cached_input_and_thinking_are_included_exactly_once() {
        assert_eq!(
            normalize(
                "claude",
                &json!({"usage":{"input_tokens":10,"cache_read_input_tokens":4,"cache_creation_input_tokens":2,"output_tokens":8}})
            ),
            Some(json!({"inputTokens":16,"outputTokens":8,"cacheReadTokens":4}))
        );
        assert_eq!(
            normalize(
                "gemini",
                &json!({"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":8,"thoughtsTokenCount":3,"totalTokenCount":21}})
            ),
            Some(json!({"inputTokens":10,"outputTokens":11,"reasoningTokens":3,"totalTokens":21}))
        );
    }

    #[test]
    /// 잘못된 수치와 실제 0토큰을 구분합니다.
    fn invalid_or_absent_usage_does_not_become_zero() {
        assert!(
            normalize(
                "openai",
                &json!({"usage":{"prompt_tokens":-1,"completion_tokens":2.5}})
            )
            .is_none()
        );
        assert!(normalize("ollama", &json!({})).is_none());
        assert_eq!(
            normalize("openai", &json!({"usage":{"prompt_tokens":0}})),
            Some(json!({"inputTokens":0}))
        );
    }
}
