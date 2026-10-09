//! 활성 플러그인 요청과 문서 후보를 모델 호출 없이 판정한다.
use serde_json::Value;
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

/// 현재 요청에 관련된 인덱스를 반환하며 네 번째 항목으로 조회 상한 초과를 알린다.
#[must_use]
#[wasm_bindgen]
pub fn plan_plugin_aware_indices_json(
    prompt: &str,
    previous_json: &str,
    plugins_json: &str,
) -> String {
    if prompt.len() > 64 * 1024
        || previous_json.len() > 128 * 1024
        || plugins_json.len() > 512 * 1024
    {
        return String::new();
    }
    let Ok(Value::Array(plugins)) = serde_json::from_str::<Value>(plugins_json) else {
        return String::new();
    };
    let current = prompt.to_lowercase();
    let mut indices = matching_indices(&current, &plugins);
    if indices.is_empty()
        && has_followup_intent(&current)
        && let Ok(Value::Array(previous)) = serde_json::from_str::<Value>(previous_json)
    {
        for question in previous.iter().rev().take(2).filter_map(Value::as_str) {
            indices = matching_indices(&question.to_lowercase(), &plugins);
            if !indices.is_empty() {
                break;
            }
        }
    }
    if indices.is_empty()
        && [
            "설치된 플러그인",
            "활성 플러그인",
            "installed plugins",
            "active plugins",
        ]
        .iter()
        .any(|marker| current.contains(marker))
    {
        indices.extend(0..plugins.len());
    }
    serde_json::to_string(&indices.into_iter().take(4).collect::<Vec<_>>()).unwrap_or_default()
}

/// 플러그인 이름과 식별자가 현재 요청에 등장한 순서를 보존한다.
fn matching_indices(prompt: &str, plugins: &[Value]) -> Vec<usize> {
    plugins
        .iter()
        .enumerate()
        .filter_map(|(index, plugin)| {
            ["id", "name"]
                .iter()
                .filter_map(|key| plugin.get(key).and_then(Value::as_str))
                .any(|label| {
                    label.chars().count() >= 3 && mentions_label(prompt, &label.to_lowercase())
                })
                .then_some(index)
        })
        .collect()
}

/// 영문 단어의 부분 일치를 막고 한글 조사와 `DataviewJS` 표기를 허용한다.
fn mentions_label(prompt: &str, label: &str) -> bool {
    prompt.match_indices(label).any(|(start, matched)| {
        let before = prompt.get(..start).and_then(|s| s.chars().next_back());
        let tail = prompt.get(start + matched.len()..).unwrap_or_default();
        let after = tail.chars().next();
        !before.is_some_and(|c| c.is_ascii_alphanumeric())
            && (!after.is_some_and(|c| c.is_ascii_alphanumeric()) || tail.starts_with("js"))
    })
}

/// 후속 코드·쿼리 요청에만 이전 플러그인 지정을 이어받는다.
fn has_followup_intent(prompt: &str) -> bool {
    [
        "쿼리",
        "템플릿",
        "스크립트",
        "코드",
        "문법",
        "그걸",
        "그것",
        "query",
        "template",
        "script",
        "code",
        "syntax",
    ]
    .iter()
    .any(|marker| prompt.contains(marker))
}

/// Context7 검색에서 이름이 일치하는 단일 문서 ID만 선택한다.
/// 동명이거나 모호한 후보는 임의로 첫 결과를 선택하지 않는다.
#[must_use]
#[wasm_bindgen]
pub fn select_plugin_context7_library_id(plugin_json: &str, result_json: &str) -> String {
    if plugin_json.len() > 16 * 1024 || result_json.len() > 512 * 1024 {
        return String::new();
    }
    let Ok(plugin) = serde_json::from_str::<Value>(plugin_json) else {
        return String::new();
    };
    let Ok(result) = serde_json::from_str::<Value>(result_json) else {
        return String::new();
    };
    let labels = ["name", "id"]
        .iter()
        .filter_map(|key| plugin.get(key).and_then(Value::as_str))
        .map(canonical_label)
        .filter(|label| !label.is_empty())
        .collect::<Vec<_>>();
    let mut candidates = BTreeSet::new();
    collect_candidates(&result, &labels, &mut candidates);
    let repositories = candidates
        .iter()
        .filter(|id| !id.starts_with("/websites/") && id.split('/').count() == 3)
        .cloned()
        .collect::<BTreeSet<_>>();
    if repositories.len() == 1 {
        return repositories.into_iter().next().unwrap_or_default();
    }
    if candidates.len() == 1 {
        candidates.into_iter().next().unwrap_or_default()
    } else {
        String::new()
    }
}

/// 이름 비교에서 Obsidian과 plugin이라는 일반 접두·접미어를 제외한다.
fn canonical_label(label: &str) -> String {
    label
        .to_lowercase()
        .replace("for obsidian", "")
        .replace("obsidian", "")
        .replace("plugin", "")
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// 문서 ID의 경로 형태와 후보의 플러그인 이름을 함께 확인한다.
fn add_candidate(title: &str, id: &str, labels: &[String], candidates: &mut BTreeSet<String>) {
    let id = id.trim().trim_matches('`');
    let valid_id = id.starts_with('/')
        && id.split('/').count() >= 3
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/_-.".contains(c));
    if valid_id && labels.contains(&canonical_label(title)) {
        candidates.insert(id.to_owned());
    }
}

/// 구조화된 검색 결과와 MCP text 블록의 공개 출력 형식을 읽는다.
fn collect_candidates(value: &Value, labels: &[String], candidates: &mut BTreeSet<String>) {
    if let Some(results) = value.get("results").and_then(Value::as_array) {
        for result in results {
            if let (Some(title), Some(id)) = (
                result.get("title").and_then(Value::as_str),
                result.get("id").and_then(Value::as_str),
            ) {
                add_candidate(title, id, labels, candidates);
            }
        }
    }
    if let Some(structured) = value.get("structuredContent") {
        collect_candidates(structured, labels, candidates);
    }
    if let Some(content) = value.get("content").and_then(Value::as_array) {
        for text in content
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
        {
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                collect_candidates(&parsed, labels, candidates);
            } else {
                collect_text_candidates(text, labels, candidates);
            }
        }
    }
}

/// 제목과 ID를 한 후보로 묶어 다른 라이브러리와 섞이지 않게 한다.
fn collect_text_candidates(text: &str, labels: &[String], candidates: &mut BTreeSet<String>) {
    let mut title = "";
    for line in text.lines() {
        let line = line.trim().trim_start_matches("- ");
        if let Some(next) = line.strip_prefix("Title:") {
            title = next.trim();
        } else if let Some(id) = line.strip_prefix("Context7-compatible library ID:") {
            add_candidate(title, id, labels, candidates);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{plan_plugin_aware_indices_json, select_plugin_context7_library_id};
    use serde_json::json;

    #[test]
    fn requests_and_followups_use_active_plugins_only() {
        let plugins = r#"[{"id":"sample-query","name":"Sample Query"},{"id":"template-engine","name":"Template Engine"}]"#;
        assert_eq!(
            plan_plugin_aware_indices_json("Sample Query로 목록 만들어줘", "[]", plugins),
            "[0]"
        );
        assert_eq!(
            plan_plugin_aware_indices_json(
                "그 템플릿 수정해줘",
                r#"["Template Engine 사용법"]"#,
                plugins
            ),
            "[1]"
        );
        assert_eq!(
            plan_plugin_aware_indices_json("개발 회의 요약", "[]", plugins),
            "[]"
        );
        assert_eq!(
            plan_plugin_aware_indices_json("Sample QueryExtra 사용법", "[]", plugins),
            "[]"
        );
    }

    #[test]
    fn resolution_rejects_unrelated_and_ambiguous_libraries() {
        let plugin = r#"{"id":"sample-query","name":"Sample Query"}"#;
        let valid =
            json!({"results":[{"title":"Obsidian Sample Query", "id":"/owner/sample-query"}]})
                .to_string();
        assert_eq!(
            select_plugin_context7_library_id(plugin, &valid),
            "/owner/sample-query"
        );
        let ambiguous = json!({"results":[{"title":"Sample Query", "id":"/one/sample-query"},{"title":"Sample Query", "id":"/two/sample-query"}]}).to_string();
        assert_eq!(select_plugin_context7_library_id(plugin, &ambiguous), "");
        assert_eq!(
            select_plugin_context7_library_id(
                plugin,
                r#"{"results":[{"title":"React","id":"/facebook/react"}]}"#
            ),
            ""
        );
    }
}
