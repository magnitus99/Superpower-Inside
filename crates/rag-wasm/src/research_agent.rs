//! Deterministic planning policy for whole-vault research workflows.

use serde_json::{Value as JsonValue, json};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::wasm_bindgen;

/// Maximum provider-request retry delay accepted from a Retry-After hint.
const MAX_RESEARCH_RETRY_DELAY_MS: u64 = 30_000;

/// Detects explicit requests that require whole-vault coverage instead of top-k retrieval.
#[must_use]
#[wasm_bindgen]
pub fn is_whole_vault_research_intent(question: &str) -> bool {
    let normalized = question.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }
    let has_scope = [
        "볼트",
        "vault",
        "전체 노트",
        "모든 노트",
        "전체 문서",
        "모든 문서",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    let has_research_action = [
        "요약",
        "정리",
        "개요",
        "조사",
        "전수",
        "분석",
        "종합",
        "research",
        "investigate",
        "inspect",
        "summary",
        "summarize",
        "overview",
        "analyze",
        "synthesize",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    has_scope && has_research_action
}

/// Groups summary items into stable bounded reduce batches without dropping any item.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_summary_batches_json(
    item_sizes_json: &str,
    max_items: usize,
    max_chars: usize,
) -> String {
    if max_items == 0 || max_chars == 0 {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<JsonValue>(item_sizes_json) else {
        return String::new();
    };
    let Some(values) = value.as_array() else {
        return String::new();
    };
    let mut sizes = Vec::with_capacity(values.len());
    for value in values {
        let Some(size) = value.as_u64().and_then(|raw| usize::try_from(raw).ok()) else {
            return String::new();
        };
        sizes.push(size);
    }

    let mut batches = Vec::<Vec<usize>>::new();
    let mut current = Vec::<usize>::new();
    let mut current_chars = 0_usize;
    for (index, size) in sizes.into_iter().enumerate() {
        let exceeds_count = current.len() >= max_items;
        let exceeds_chars = !current.is_empty() && current_chars.saturating_add(size) > max_chars;
        if exceeds_count || exceeds_chars {
            batches.push(current);
            current = Vec::new();
            current_chars = 0;
        }
        current.push(index);
        current_chars = current_chars.saturating_add(size);
    }
    if !current.is_empty() {
        batches.push(current);
    }
    json!(batches).to_string()
}

/// Selects citations explicitly referenced by the final answer, or a bounded evidence fallback.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_citation_indices_json(
    content: &str,
    citation_ids_json: &str,
    citation_paths_json: &str,
    fallback_limit: usize,
) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(citation_ids_json) else {
        return String::new();
    };
    let Some(values) = value.as_array() else {
        return String::new();
    };
    let mut citation_ids = Vec::<&str>::with_capacity(values.len());
    for value in values {
        let Some(citation_id) = value.as_str() else {
            return String::new();
        };
        citation_ids.push(citation_id);
    }
    let Ok(path_value) = serde_json::from_str::<JsonValue>(citation_paths_json) else {
        return String::new();
    };
    let Some(path_values) = path_value.as_array() else {
        return String::new();
    };
    let mut citation_paths = Vec::<&str>::with_capacity(path_values.len());
    for value in path_values {
        let Some(citation_path) = value.as_str() else {
            return String::new();
        };
        citation_paths.push(citation_path);
    }
    if citation_paths.len() != citation_ids.len() {
        return String::new();
    }

    let referenced_ids = citation_ids
        .iter()
        .enumerate()
        .filter_map(|(index, citation_id)| {
            contains_bounded_marker(content, citation_id).then_some(index)
        })
        .collect::<Vec<_>>();
    if !referenced_ids.is_empty() {
        return json!(referenced_ids).to_string();
    }
    let referenced_paths = citation_paths
        .iter()
        .enumerate()
        .filter_map(|(index, citation_path)| {
            (!citation_path.is_empty() && content.contains(citation_path)).then_some(index)
        })
        .collect::<Vec<_>>();
    if !referenced_paths.is_empty() {
        return json!(referenced_paths).to_string();
    }
    json!((0..citation_ids.len().min(fallback_limit)).collect::<Vec<_>>()).to_string()
}

/// Classifies a provider failure and returns a bounded retry plan for research requests.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_request_failure_json(
    message: &str,
    status: u16,
    failed_attempt: usize,
    retry_after_ms: f64,
) -> String {
    const MAX_RETRIES: usize = 2;

    let normalized = message.to_lowercase();
    let (code, transient) = if status == 429
        || normalized.contains("rate limit")
        || normalized.contains("too many requests")
    {
        ("rate-limited", true)
    } else if matches!(status, 408 | 504)
        || normalized.contains("timeout")
        || normalized.contains("timed out")
    {
        ("timeout", true)
    } else if matches!(status, 500 | 502 | 503) {
        ("provider-server", true)
    } else if status == 0
        && [
            "network",
            "connection reset",
            "connection refused",
            "failed to fetch",
            "socket",
            "temporarily unavailable",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        ("network", true)
    } else if matches!(status, 400 | 401 | 403 | 404) {
        ("provider-configuration", false)
    } else {
        ("non-retryable", false)
    };

    let retryable = transient && failed_attempt < MAX_RETRIES;
    let exponential_delay = 500_u64.saturating_mul(1_u64 << failed_attempt.min(5));
    let requested_delay = bounded_retry_delay_ms(retry_after_ms);
    let retry_delay_ms = if retryable {
        exponential_delay
            .max(requested_delay)
            .min(MAX_RESEARCH_RETRY_DELAY_MS)
    } else {
        0
    };

    json!({
        "code": code,
        "retryable": retryable,
        "retryDelayMs": retry_delay_ms,
    })
    .to_string()
}

/// Finds repeated tool calls after canonicalizing JSON argument object key order.
#[must_use]
#[wasm_bindgen]
pub fn plan_repeated_tool_call_indices_json(
    history_json: &str,
    candidates_json: &str,
    max_repeats: usize,
    max_native_search_calls: usize,
) -> String {
    if max_repeats == 0 || max_native_search_calls == 0 {
        return String::new();
    }
    let Some(history) = parse_tool_call_signatures(history_json) else {
        return String::new();
    };
    let Some(candidates) = parse_tool_call_signatures(candidates_json) else {
        return String::new();
    };
    let mut counts = BTreeMap::<String, usize>::new();
    let mut native_search_count = 0_usize;
    for signature in history {
        if signature.is_native_search {
            native_search_count = native_search_count.saturating_add(1);
        }
        *counts.entry(signature.canonical).or_default() += 1;
    }
    let mut repeated = Vec::<usize>::new();
    for (index, signature) in candidates.into_iter().enumerate() {
        let exceeds_search_budget =
            signature.is_native_search && native_search_count >= max_native_search_calls;
        let count = counts.entry(signature.canonical).or_default();
        if *count >= max_repeats || exceeds_search_budget {
            repeated.push(index);
        }
        *count += 1;
        if signature.is_native_search {
            native_search_count = native_search_count.saturating_add(1);
        }
    }
    json!(repeated).to_string()
}

/// 도구 호출의 정규화된 중복 판정 정보.
struct ToolCallSignature {
    /// 이름과 canonical JSON 인자를 결합한 안정된 호출 식별자.
    canonical: String,
    /// 읽기 전용 Vault 도구의 search 액션인지 여부.
    is_native_search: bool,
}

/// Parses tool-call records into stable name and canonical-argument signatures.
fn parse_tool_call_signatures(raw: &str) -> Option<Vec<ToolCallSignature>> {
    let value = serde_json::from_str::<JsonValue>(raw).ok()?;
    value
        .as_array()?
        .iter()
        .map(|item| {
            let record = item.as_object()?;
            let name = record.get("name")?.as_str()?.trim();
            let arguments = record.get("arguments")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            let parsed_arguments = serde_json::from_str::<JsonValue>(arguments).ok();
            let is_native_search = name == "superpower_inside"
                && parsed_arguments
                    .as_ref()
                    .and_then(JsonValue::as_object)
                    .and_then(|object| object.get("action"))
                    .and_then(JsonValue::as_str)
                    == Some("search");
            let canonical_arguments = parsed_arguments
                .map_or_else(|| arguments.to_owned(), |value| canonical_json(&value));
            Some(ToolCallSignature {
                canonical: format!("{name}\0{canonical_arguments}"),
                is_native_search,
            })
        })
        .collect()
}

/// Serializes JSON recursively with lexicographically ordered object keys.
fn canonical_json(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "null".to_owned(),
        JsonValue::Bool(value) => value.to_string(),
        JsonValue::Number(value) => value.to_string(),
        JsonValue::String(value) => serde_json::to_string(value).unwrap_or_default(),
        JsonValue::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        JsonValue::Object(values) => {
            let sorted = values
                .iter()
                .map(|(key, value)| (key, canonical_json(value)))
                .collect::<BTreeMap<_, _>>();
            format!(
                "{{{}}}",
                sorted
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{value}",
                        serde_json::to_string(key).unwrap_or_default()
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

/// Converts a JavaScript numeric retry delay without unchecked numeric casts.
fn bounded_retry_delay_ms(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    if value >= 30_000.0 {
        return MAX_RESEARCH_RETRY_DELAY_MS;
    }
    value
        .round()
        .to_string()
        .parse::<u64>()
        .unwrap_or(0)
        .min(MAX_RESEARCH_RETRY_DELAY_MS)
}

/// Checks whether a citation marker occurs outside a larger word-like token.
fn contains_bounded_marker(content: &str, marker: &str) -> bool {
    if marker.is_empty() {
        return false;
    }
    content.match_indices(marker).any(|(start, _)| {
        let end = start.saturating_add(marker.len());
        let before_is_boundary = content
            .get(..start)
            .and_then(|prefix| prefix.chars().next_back())
            .is_none_or(|character| !is_marker_word_character(character));
        let after_is_boundary = content
            .get(end..)
            .and_then(|suffix| suffix.chars().next())
            .is_none_or(|character| !is_marker_word_character(character));
        before_is_boundary && after_is_boundary
    })
}

/// Returns whether a character can continue a source marker token.
fn is_marker_word_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        is_whole_vault_research_intent, plan_repeated_tool_call_indices_json,
        plan_research_citation_indices_json, plan_research_request_failure_json,
        plan_research_summary_batches_json,
    };

    #[test]
    fn explicit_whole_vault_summary_is_research_intent() {
        assert!(is_whole_vault_research_intent(
            "이 옵시디언 볼트를 요약해줘"
        ));
    }

    #[test]
    fn ordinary_note_question_is_not_whole_vault_research() {
        assert!(!is_whole_vault_research_intent(
            "Alpha 노트에서 고객 문제를 찾아줘"
        ));
    }

    #[test]
    fn summary_batches_preserve_all_indices_under_count_and_char_limits() {
        let raw = plan_research_summary_batches_json("[4,4,20,3]", 2, 10);

        assert_eq!(raw, "[[0,1],[2],[3]]");
    }

    #[test]
    fn citation_selection_keeps_only_bounded_markers_from_the_final_answer() {
        let raw = plan_research_citation_indices_json(
            "결론 [vault:Alpha.md:1-10] 및 Source graph-2",
            r#"["vault:Alpha.md:1-1","vault:Alpha.md:1-10","graph-2","unused"]"#,
            r#"["Alpha.md","Alpha.md","graph://2","Unused.md"]"#,
            2,
        );

        assert_eq!(raw, "[1,2]");
    }

    #[test]
    fn citation_selection_uses_a_bounded_fallback_when_the_model_omits_markers() {
        let raw = plan_research_citation_indices_json(
            "출처 표기가 없는 요약",
            r#"["a","b","c","d"]"#,
            r#"["A.md","B.md","C.md","D.md"]"#,
            2,
        );

        assert_eq!(raw, "[0,1]");
    }

    #[test]
    fn citation_selection_uses_paths_named_in_the_final_answer() {
        let raw = plan_research_citation_indices_json(
            "Bible/Genesis.md와 People/Neville.md를 확인했다.",
            r#"["a","b","c"]"#,
            r#"["Bible/Genesis.md","People/Neville.md","Archive/Other.md"]"#,
            2,
        );

        assert_eq!(raw, "[0,1]");
    }

    #[test]
    fn transient_research_failures_retry_with_bounded_provider_delay() {
        let raw = plan_research_request_failure_json("Too many requests", 429, 0, 45_000.0);

        assert_eq!(
            raw,
            json!({"code": "rate-limited", "retryable": true, "retryDelayMs": 30_000}).to_string()
        );
    }

    #[test]
    fn research_retry_budget_and_configuration_failures_stop() {
        let exhausted = plan_research_request_failure_json("server error", 503, 2, f64::NAN);
        let unauthorized = plan_research_request_failure_json("invalid api key", 401, 0, f64::NAN);

        assert_eq!(
            exhausted,
            json!({"code": "provider-server", "retryable": false, "retryDelayMs": 0}).to_string()
        );
        assert_eq!(
            unauthorized,
            json!({"code": "provider-configuration", "retryable": false, "retryDelayMs": 0})
                .to_string()
        );
    }

    #[test]
    fn repeated_tool_calls_ignore_json_object_key_order_and_block_the_third_call() {
        let history = r#"[
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"alpha\"}"},
            {"name":"superpower_inside","arguments":"{\"query\":\"alpha\",\"action\":\"search\"}"}
        ]"#;
        let candidates = r#"[
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"alpha\"}"},
            {"name":"superpower_inside","arguments":"{\"action\":\"read\",\"path\":\"Alpha.md\"}"}
        ]"#;

        assert_eq!(
            plan_repeated_tool_call_indices_json(history, candidates, 2, 4),
            "[0]"
        );
    }

    #[test]
    fn repeated_tool_call_plan_rejects_invalid_input() {
        assert!(plan_repeated_tool_call_indices_json("{}", "[]", 2, 4).is_empty());
        assert!(plan_repeated_tool_call_indices_json("[]", "[]", 0, 4).is_empty());
    }

    #[test]
    fn native_search_calls_have_a_per_turn_budget() {
        let candidates = r#"[
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"one\"}"},
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"two\"}"},
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"three\"}"},
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"four\"}"},
            {"name":"superpower_inside","arguments":"{\"action\":\"search\",\"query\":\"five\"}"},
            {"name":"superpower_inside","arguments":"{\"action\":\"read\",\"path\":\"Alpha.md\"}"}
        ]"#;

        assert_eq!(
            plan_repeated_tool_call_indices_json("[]", candidates, 2, 4),
            "[4]",
        );
    }
}
