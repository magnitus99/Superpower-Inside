//! Native read-only vault tool request contract.
//!
//! The host owns Obsidian I/O. This module validates and normalizes model-generated requests so
//! unsupported operations and unbounded reads never reach the host boundary.

use std::collections::BTreeSet;

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Default number of evidence candidates returned by a search action.
const DEFAULT_SEARCH_LIMIT: usize = 8;
/// Maximum number of evidence candidates returned by one search action.
const MAX_SEARCH_LIMIT: usize = 20;
/// Default number of Markdown paths returned by a list action.
const DEFAULT_LIST_LIMIT: usize = 50;
/// Maximum number of Markdown paths returned by one list action.
const MAX_LIST_LIMIT: usize = 100;
/// Default number of paths returned for one link direction.
const DEFAULT_LINK_LIMIT: usize = 50;
/// Maximum number of paths returned for one link direction.
const MAX_LINK_LIMIT: usize = 100;

/// Validates one model-generated request for the built-in read-only vault tool.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_tool_request_json(arguments_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(arguments_json) else {
        return error_response("invalid_json");
    };
    let Some(object) = value.as_object() else {
        return error_response("invalid_request");
    };
    let Some(action) = object.get("action").and_then(JsonValue::as_str) else {
        return error_response("invalid_request");
    };

    match normalize_request(action, object) {
        Ok(request) => json!({ "ok": true, "request": request }).to_string(),
        Err(code) => error_response(code),
    }
}

/// Selects one stable, bounded page of Markdown paths under a vault folder prefix.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_list_json(
    file_paths_json: &str,
    path_prefix: &str,
    cursor: usize,
    limit: usize,
) -> String {
    let Some(file_paths) = parse_string_array(file_paths_json) else {
        return String::new();
    };
    let normalized_prefix = path_prefix.trim().trim_matches('/');
    let folder_prefix = if normalized_prefix.is_empty() {
        String::new()
    } else {
        format!("{normalized_prefix}/")
    };
    let paths = file_paths
        .into_iter()
        .filter(|path| folder_prefix.is_empty() || path.starts_with(&folder_prefix))
        .collect::<BTreeSet<_>>();
    let total = paths.len();
    let selected_paths = paths
        .iter()
        .skip(cursor)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    let consumed = cursor.saturating_add(selected_paths.len()).min(total);
    let next_cursor = (consumed < total).then_some(consumed);
    json!({
        "paths": selected_paths,
        "nextCursor": next_cursor,
        "total": total
    })
    .to_string()
}

/// Clamps a one-based inclusive read range to the document and per-call line budget.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_read_range_json(
    total_lines: usize,
    start_line: usize,
    end_line: Option<usize>,
    max_lines: usize,
) -> String {
    if total_lines == 0 || max_lines == 0 || start_line == 0 || start_line > total_lines {
        return String::new();
    }
    let requested_end = end_line.unwrap_or(total_lines).min(total_lines);
    if requested_end < start_line {
        return String::new();
    }
    let bounded_end = start_line
        .saturating_add(max_lines.saturating_sub(1))
        .min(requested_end);
    json!({
        "startLine": start_line,
        "endLine": bounded_end,
        "truncated": bounded_end < requested_end
    })
    .to_string()
}

/// Sorts, de-duplicates, and bounds one side of the structural link graph.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_link_paths_json(paths_json: &str, limit: usize) -> String {
    let Some(paths) = parse_string_array(paths_json) else {
        return String::new();
    };
    let selected = paths
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(limit)
        .collect::<Vec<_>>();
    json!(selected).to_string()
}

/// Aggregates Markdown file sizes for a read-only vault stats response.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_stats_json(file_sizes_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(file_sizes_json) else {
        return String::new();
    };
    let Some(values) = value.as_array() else {
        return String::new();
    };
    let mut total_bytes = 0_u64;
    for value in values {
        let Some(size) = value.as_u64() else {
            return String::new();
        };
        total_bytes = total_bytes.saturating_add(size);
    }
    json!({ "fileCount": values.len(), "totalBytes": total_bytes }).to_string()
}

/// Dispatches an already parsed request to the action-specific normalizer.
fn normalize_request(
    action: &str,
    object: &JsonMap<String, JsonValue>,
) -> Result<JsonValue, &'static str> {
    match action {
        "search" => normalize_search_request(object),
        "read" => normalize_read_request(object),
        "list" => normalize_list_request(object),
        "links" => normalize_links_request(object),
        "stats" => Ok(json!({ "action": "stats" })),
        _ => Err("unsupported_action"),
    }
}

/// Validates search fields and applies bounded defaults.
fn normalize_search_request(
    object: &JsonMap<String, JsonValue>,
) -> Result<JsonValue, &'static str> {
    let query = required_string(object, "query", "query_required")?;
    let raw_path = optional_string(object, "path")?;
    let path = normalize_optional_path(raw_path.as_deref())?;
    let match_mode = optional_string(object, "match")?.unwrap_or_else(|| "all".to_owned());
    if !matches!(match_mode.as_str(), "all" | "any" | "phrase") {
        return Err("invalid_match");
    }
    let limit = normalize_limit(
        optional_usize(object, "limit")?,
        DEFAULT_SEARCH_LIMIT,
        MAX_SEARCH_LIMIT,
    );
    Ok(json!({
        "action": "search",
        "query": query,
        "path": path,
        "limit": limit,
        "match": match_mode
    }))
}

/// Validates a bounded partial-read request.
fn normalize_read_request(object: &JsonMap<String, JsonValue>) -> Result<JsonValue, &'static str> {
    let raw_path = required_string(object, "path", "path_required")?;
    let path = normalize_required_path(&raw_path)?;
    let start_line = optional_usize(object, "start_line")?.unwrap_or(1).max(1);
    let end_line = optional_usize(object, "end_line")?;
    if end_line.is_some_and(|line| line < start_line) {
        return Err("invalid_line_range");
    }
    Ok(json!({
        "action": "read",
        "path": path,
        "startLine": start_line,
        "endLine": end_line
    }))
}

/// Validates a stable paginated list request.
fn normalize_list_request(object: &JsonMap<String, JsonValue>) -> Result<JsonValue, &'static str> {
    let raw_path = optional_string(object, "path")?;
    let path = normalize_optional_path(raw_path.as_deref())?;
    let cursor = optional_usize(object, "cursor")?.unwrap_or(0);
    let limit = normalize_limit(
        optional_usize(object, "limit")?,
        DEFAULT_LIST_LIMIT,
        MAX_LIST_LIMIT,
    );
    Ok(json!({ "action": "list", "path": path, "cursor": cursor, "limit": limit }))
}

/// Validates a bounded structural-link traversal request.
fn normalize_links_request(object: &JsonMap<String, JsonValue>) -> Result<JsonValue, &'static str> {
    let raw_path = required_string(object, "path", "path_required")?;
    let path = normalize_required_path(&raw_path)?;
    let direction = optional_string(object, "direction")?.unwrap_or_else(|| "both".to_owned());
    if !matches!(direction.as_str(), "incoming" | "outgoing" | "both") {
        return Err("invalid_direction");
    }
    let limit = normalize_limit(
        optional_usize(object, "limit")?,
        DEFAULT_LINK_LIMIT,
        MAX_LINK_LIMIT,
    );
    Ok(json!({
        "action": "links",
        "path": path,
        "direction": direction,
        "limit": limit
    }))
}

/// Reads one required non-empty string field.
fn required_string(
    object: &JsonMap<String, JsonValue>,
    key: &str,
    missing_code: &'static str,
) -> Result<String, &'static str> {
    let Some(value) = object.get(key) else {
        return Err(missing_code);
    };
    let Some(raw) = value.as_str() else {
        return Err("invalid_request");
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(missing_code);
    }
    Ok(trimmed.to_owned())
}

/// Reads one optional string field without inventing a default.
fn optional_string(
    object: &JsonMap<String, JsonValue>,
    key: &str,
) -> Result<Option<String>, &'static str> {
    let Some(value) = object.get(key) else {
        return Ok(None);
    };
    let Some(raw) = value.as_str() else {
        return Err("invalid_request");
    };
    Ok(Some(raw.to_owned()))
}

/// Reads one optional non-negative integer representable as `usize`.
fn optional_usize(
    object: &JsonMap<String, JsonValue>,
    key: &str,
) -> Result<Option<usize>, &'static str> {
    let Some(value) = object.get(key) else {
        return Ok(None);
    };
    let Some(raw) = value.as_u64() else {
        return Err("invalid_request");
    };
    usize::try_from(raw)
        .map(Some)
        .map_err(|_| "invalid_request")
}

/// Applies an action default and clamps one caller-controlled result limit.
fn normalize_limit(limit: Option<usize>, default: usize, maximum: usize) -> usize {
    limit.unwrap_or(default).clamp(1, maximum)
}

/// Normalizes an optional vault path, using an empty string for the vault root.
fn normalize_optional_path(path: Option<&str>) -> Result<String, &'static str> {
    let Some(path) = path else {
        return Ok(String::new());
    };
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed.chars().all(|character| character == '/') {
        return Ok(String::new());
    }
    normalize_required_path(trimmed)
}

/// Normalizes one vault-relative path and rejects traversal segments.
fn normalize_required_path(path: &str) -> Result<String, &'static str> {
    let normalized = path.trim().trim_matches('/');
    if normalized.is_empty() {
        return Err("path_required");
    }
    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("invalid_path");
    }
    Ok(normalized.to_owned())
}

/// Serializes a stable validation error wire response.
fn error_response(code: &str) -> String {
    json!({ "ok": false, "error": { "code": code } }).to_string()
}

/// Parses an array containing strings only.
fn parse_string_array(input: &str) -> Option<Vec<String>> {
    let value = serde_json::from_str::<JsonValue>(input).ok()?;
    value
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(ToOwned::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::Value as JsonValue;

    use super::plan_native_vault_tool_request_json;
    use super::{
        plan_native_vault_link_paths_json, plan_native_vault_list_json,
        plan_native_vault_read_range_json, plan_native_vault_stats_json,
    };

    /// Parses a test result without hiding invalid JSON behind a panic.
    fn parse_json(raw: &str) -> JsonValue {
        serde_json::from_str::<JsonValue>(raw)
            .unwrap_or_else(|error| JsonValue::String(format!("invalid JSON: {error}")))
    }

    #[test]
    fn list_request_clamps_limit_and_normalizes_path() {
        let raw = plan_native_vault_tool_request_json(
            r#"{"action":"list","path":"/Projects/","cursor":4,"limit":500}"#,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.get("request"),
            Some(&serde_json::json!({
                "action": "list",
                "path": "Projects",
                "cursor": 4,
                "limit": 100
            }))
        );
    }

    #[test]
    fn list_request_accepts_common_root_aliases() {
        for path in ["/", "."] {
            let raw = plan_native_vault_tool_request_json(&format!(
                r#"{{"action":"list","path":"{path}"}}"#
            ));
            let parsed = parse_json(&raw);

            assert_eq!(
                parsed.pointer("/request/path"),
                Some(&JsonValue::from("")),
                "{path} should resolve to the vault root",
            );
        }
    }

    #[test]
    fn search_request_defaults_to_all_terms_and_accepts_explicit_match_mode() {
        let default_raw =
            plan_native_vault_tool_request_json(r#"{"action":"search","query":"Neville Genesis"}"#);
        let default_parsed = parse_json(&default_raw);
        assert_eq!(
            default_parsed.pointer("/request/match"),
            Some(&JsonValue::from("all")),
        );

        let any_raw = plan_native_vault_tool_request_json(
            r#"{"action":"search","query":"Neville Genesis","match":"any"}"#,
        );
        let any_parsed = parse_json(&any_raw);
        assert_eq!(
            any_parsed.pointer("/request/match"),
            Some(&JsonValue::from("any")),
        );
    }

    #[test]
    fn write_action_is_rejected_before_host_execution() {
        let raw =
            plan_native_vault_tool_request_json(r#"{"action":"write","path":"Projects/Alpha.md"}"#);
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/error/code"),
            Some(&JsonValue::from("unsupported_action"))
        );
    }

    #[test]
    fn parent_directory_path_is_rejected() {
        let raw =
            plan_native_vault_tool_request_json(r#"{"action":"read","path":"../Secrets.md"}"#);
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/error/code"),
            Some(&JsonValue::from("invalid_path"))
        );
    }

    #[test]
    fn list_plan_returns_a_sorted_folder_page() {
        let raw = plan_native_vault_list_json(
            r#"["Projects/Beta.md","Archive/Old.md","Projects/Alpha.md"]"#,
            "Projects",
            0,
            1,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed,
            serde_json::json!({ "paths": ["Projects/Alpha.md"], "nextCursor": 1, "total": 2 })
        );
    }

    #[test]
    fn read_range_enforces_the_line_budget() {
        let raw = plan_native_vault_read_range_json(500, 2, None, 400);
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed,
            serde_json::json!({ "startLine": 2, "endLine": 401, "truncated": true })
        );
    }

    #[test]
    fn link_paths_are_sorted_deduplicated_and_bounded() {
        let raw = plan_native_vault_link_paths_json(r#"["B.md","A.md","B.md"]"#, 2);

        assert_eq!(raw, r#"["A.md","B.md"]"#);
    }

    #[test]
    fn stats_plan_aggregates_file_sizes() {
        let raw = plan_native_vault_stats_json("[4,6]");

        assert_eq!(raw, r#"{"fileCount":2,"totalBytes":10}"#);
    }
}
