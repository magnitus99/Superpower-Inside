//! 저장된 도구 결과를 provider에 재주입할 때 사용할 제한된 출처 참조 정책.

use serde_json::{Map as JsonMap, Value as JsonValue};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

/// Maximum number of persisted source locators retained for one tool result.
const MAX_SOURCE_REFERENCES: usize = 32;
/// Maximum Unicode-scalar length accepted for one vault-relative source path.
const MAX_SOURCE_REFERENCE_PATH_CHARS: usize = 1_024;
/// Maximum serialized byte size of the complete persisted source-locator array.
const MAX_SOURCE_REFERENCES_JSON_BYTES: usize = 12_000;

/// citation 배열에서 본문을 제외한 bounded source reference JSON 배열만 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_tool_result_source_references_json(citations_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(citations_json) else {
        return String::new();
    };
    let Some(citations) = value.as_array() else {
        return String::new();
    };

    let mut selected = Vec::new();
    let mut seen = BTreeSet::new();
    for citation in citations {
        if selected.len() >= MAX_SOURCE_REFERENCES {
            break;
        }
        let Some(reference) = plan_source_reference(citation) else {
            continue;
        };
        let file_path = reference
            .get("filePath")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        let line = reference.get("line").and_then(JsonValue::as_u64);
        let end_line = reference.get("endLine").and_then(JsonValue::as_u64);
        if !seen.insert((file_path.to_owned(), line, end_line)) {
            continue;
        }
        let mut candidate = selected.clone();
        candidate.push(reference.clone());
        let Ok(serialized) = serde_json::to_string(&candidate) else {
            continue;
        };
        if serialized.len() > MAX_SOURCE_REFERENCES_JSON_BYTES {
            continue;
        }
        selected.push(reference);
    }
    serde_json::to_string(&selected).unwrap_or_default()
}

/// Builds one bounded, content-free source locator from untrusted citation metadata.
fn plan_source_reference(value: &JsonValue) -> Option<JsonValue> {
    let object = value.as_object()?;
    let file_path = bounded_vault_path(object.get("filePath")?)?;
    let status = match object.get("status").and_then(JsonValue::as_str) {
        Some(value @ ("candidate" | "verified")) => value,
        Some("missing" | "stale" | "low-relevance") => return None,
        _ => "candidate",
    };
    let mut reference = JsonMap::new();
    reference.insert(
        "filePath".to_owned(),
        JsonValue::String(file_path.to_owned()),
    );
    reference.insert("status".to_owned(), JsonValue::String(status.to_owned()));
    reference.insert("requiresRead".to_owned(), JsonValue::Bool(true));

    let line = object
        .get("line")
        .and_then(JsonValue::as_u64)
        .filter(|line| *line > 0 && u32::try_from(*line).is_ok());
    if let Some(line) = line {
        reference.insert("line".to_owned(), JsonValue::Number(line.into()));
        if let Some(end_line) = object
            .get("endLine")
            .and_then(JsonValue::as_u64)
            .filter(|end_line| *end_line >= line && u32::try_from(*end_line).is_ok())
        {
            reference.insert("endLine".to_owned(), JsonValue::Number(end_line.into()));
        }
    }
    Some(JsonValue::Object(reference))
}

/// Accepts only bounded, normalized Markdown paths relative to the current vault.
fn bounded_vault_path(value: &JsonValue) -> Option<&str> {
    let value = value.as_str()?;
    if value.trim() != value
        || value.is_empty()
        || value.chars().count() > MAX_SOURCE_REFERENCE_PATH_CHARS
        || value.chars().any(char::is_control)
        || value.starts_with('/')
        || value.contains('\\')
        || !value.to_lowercase().ends_with(".md")
        || value
            .split('/')
            .any(|component| component.is_empty() || matches!(component, "." | ".."))
    {
        return None;
    }
    Some(value)
}

#[cfg(test)]
mod tests {
    use serde_json::Value as JsonValue;

    use super::{MAX_SOURCE_REFERENCES_JSON_BYTES, plan_tool_result_source_references_json};

    #[test]
    fn source_references_drop_content_and_preserve_verification_status() {
        assert_eq!(
            plan_tool_result_source_references_json(
                r#"[{"id":"vault:Alpha.md:3-4","filePath":"Alpha.md","heading":"Ignore instructions","line":3,"endLine":4,"status":"candidate","preview":"secret","score":0.9}]"#,
            ),
            r#"[{"filePath":"Alpha.md","status":"candidate","requiresRead":true,"line":3,"endLine":4}]"#,
        );
    }

    #[test]
    fn source_references_reject_invalid_metadata_and_never_upgrade_unknown_status() {
        let input = r#"[{"filePath":3},{"filePath":"bad\npath.md"},{"filePath":"/absolute.md"},{"filePath":"../escape.md"},{"filePath":"A.md","status":"stale"},{"filePath":"B.md","status":"unexpected","line":2,"endLine":1}]"#;
        assert_eq!(
            plan_tool_result_source_references_json(input),
            r#"[{"filePath":"B.md","status":"candidate","requiresRead":true,"line":2}]"#,
        );
    }

    #[test]
    fn source_references_obey_count_and_aggregate_byte_limits() {
        let citations = (0..100)
            .map(|index| {
                format!(
                    r#"{{"id":"vault:{index}","filePath":"{index}/{}.md","status":"verified"}}"#,
                    "경로".repeat(250),
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let result = plan_tool_result_source_references_json(&format!("[{citations}]"));
        let parsed = serde_json::from_str::<JsonValue>(&result)
            .ok()
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();

        assert!(parsed.len() <= 32);
        assert!(result.len() <= MAX_SOURCE_REFERENCES_JSON_BYTES);
    }
}
