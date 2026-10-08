//! 공급자가 반환한 모델 한도만 정규화하고 전체 요청 예산을 계산한다.
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::wasm_bindgen;

/// `JavaScript`가 정확하게 표현할 수 있는 양의 정수만 허용한다.
fn positive(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(Value::as_u64)
        .filter(|number| *number > 0 && *number <= 9_007_199_254_740_991)
}

/// 모델 이름으로 한도를 추측하지 않는다. 없는 정보는 호스트에 생략해서 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_provider_model_details_json(provider: &str, payload: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return String::new();
    };
    if provider == "ollama" {
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            return String::new();
        };
        let mut detail = Map::from_iter([("id".to_owned(), json!(id))]);
        if let Some(info) = value.get("model_info")
            && let Some(architecture) = info.get("general.architecture").and_then(Value::as_str)
            && let Some(context) = positive(info.get(format!("{architecture}.context_length")))
        {
            detail.insert("contextLength".to_owned(), json!(context));
        }
        return json!([detail]).to_string();
    }
    let key = if provider == "openAIChatGPT" {
        "models"
    } else {
        "data"
    };
    let Some(models) = value.get(key).and_then(Value::as_array) else {
        return String::new();
    };
    let mut details = BTreeMap::<String, Map<String, Value>>::new();
    for model in models {
        let id_key = if provider == "openAIChatGPT" {
            "slug"
        } else {
            "id"
        };
        let Some(id) = model
            .get(id_key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        let detail = details
            .entry(id.to_owned())
            .or_insert_with(|| Map::from_iter([("id".to_owned(), json!(id))]));
        if let Some(name) = model
            .get("name")
            .or_else(|| model.get("display_name"))
            .and_then(Value::as_str)
        {
            detail.insert("name".to_owned(), json!(name));
        }
        let context = match provider {
            "claude" => positive(model.get("max_input_tokens")),
            "openAIChatGPT" => positive(model.get("context_window"))
                .or_else(|| positive(model.get("max_context_window")))
                .map(|window| {
                    positive(model.get("effective_context_window_percent"))
                        .filter(|percent| *percent <= 100)
                        .map_or(window, |percent| {
                            window.saturating_mul(percent).div_euclid(100)
                        })
                }),
            _ => positive(model.get("context_length")),
        };
        let top = model.get("top_provider");
        let effective = positive(top.and_then(|top| top.get("context_length")));
        let context = match (context, effective) {
            (Some(left), Some(right)) => Some(left.min(right)),
            (left, right) => left.or(right),
        };
        let output = if provider == "claude" {
            positive(model.get("max_tokens"))
        } else {
            positive(top.and_then(|top| top.get("max_completion_tokens")))
                .or_else(|| positive(model.get("max_completion_tokens")))
        };
        for (key, limit) in [("contextLength", context), ("maxOutputTokens", output)] {
            if let Some(limit) = limit {
                detail.insert(
                    key.to_owned(),
                    json!(positive(detail.get(key)).map_or(limit, |old| old.min(limit))),
                );
            }
        }
    }
    json!(details.into_values().collect::<Vec<_>>()).to_string()
}

/// 토크나이저가 공개되지 않은 모델은 UTF-8 바이트를 보수적인 입력 토큰 상한으로 사용한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_model_context_json(metadata: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(metadata) else {
        return String::new();
    };
    let known = positive(value.get("contextLength"));
    let context = known.unwrap_or(50_000);
    let output = positive(value.get("maxOutputTokens"))
        .unwrap_or(4_096)
        .min(4_096)
        .min(context.div_euclid(4))
        .max(1);
    let margin = context
        .div_euclid(10)
        .max(1)
        .min(context.saturating_sub(output));
    let input = context.saturating_sub(output).saturating_sub(margin);
    let file_chars = input.div_euclid(24).min(9_000);
    let evidence_chars = input.div_euclid(6);
    let batch_size = evidence_chars
        .div_euclid(file_chars.saturating_add(256))
        .clamp(1, 8);
    json!({"contextTokens":context,"outputTokens":output,"marginTokens":margin,
        "inputBytes":input,"evidenceChars":evidence_chars,"researchFileChars":file_chars,
        "researchProviderBudget":{"maxSelectedItems":64,"batchSize":batch_size,"maxBatches":8},"source":if known.is_some(){"provider"}else{"fallback"},
        "counting":"utf8-upper-bound"}).to_string()
}

#[cfg(test)]
mod tests {
    use super::{Value, json, plan_model_context_json, plan_provider_model_details_json};
    #[test]
    fn limits_are_validated_and_provider_route_uses_the_smaller_window() {
        let raw = plan_provider_model_details_json(
            "openRouter",
            r#"{"data":[{"id":"m","context_length":128000,"top_provider":{"context_length":64000,"max_completion_tokens":2000}},{"id":"bad","context_length":"128000"},{"id":"m","context_length":32000}]}"#,
        );
        let parsed: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        assert_eq!(parsed.pointer("/1/contextLength"), Some(&json!(32_000)));
        assert!(parsed.pointer("/0/contextLength").is_none());
        for value in [
            json!(0),
            json!(-1),
            json!(1.5),
            json!("128000"),
            Value::Null,
        ] {
            let budget: Value = serde_json::from_str(&plan_model_context_json(
                &json!({"contextLength":value}).to_string(),
            ))
            .unwrap_or(Value::Null);
            assert_eq!(budget.get("contextTokens"), Some(&json!(50_000)));
        }
    }
    #[test]
    fn official_anthropic_and_codex_contracts_do_not_share_field_names() {
        for (provider, body) in [
            (
                "claude",
                r#"{"data":[{"id":"m","max_input_tokens":200000,"max_tokens":8192}]}"#,
            ),
            (
                "openAIChatGPT",
                r#"{"models":[{"slug":"m","context_window":200000}]}"#,
            ),
        ] {
            let value: Value =
                serde_json::from_str(&plan_provider_model_details_json(provider, body))
                    .unwrap_or(Value::Null);
            assert_eq!(value.pointer("/0/contextLength"), Some(&json!(200_000)));
        }
        let value: Value = serde_json::from_str(&plan_provider_model_details_json(
            "openai",
            r#"{"data":[{"id":"gpt-m","created":123,"owned_by":"openai"}]}"#,
        ))
        .unwrap_or(Value::Null);
        assert!(value.pointer("/0/contextLength").is_none());
    }
}
