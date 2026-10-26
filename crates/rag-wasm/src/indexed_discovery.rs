//! 검색 단서를 검토 예산과 분리하고, 미검증 후보의 후속 조회 범위를 계산합니다.

use std::collections::BTreeSet;

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 과도한 직렬화 입력은 실패로 반환합니다.
const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// 한 번에 전달할 단서의 상한이며 전체 발견 수를 자르지 않습니다.
const MAX_PAGE_SIZE: usize = 96;

/// 볼트 내부 상대 경로만 받습니다.
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// 경로 목록을 검증하고 집합으로 변환합니다.
fn paths(value: &Value, key: &str) -> Option<BTreeSet<String>> {
    value
        .get(key)?
        .as_array()?
        .iter()
        .map(|item| {
            let path = item.as_str()?;
            safe_path(path).then(|| path.to_owned())
        })
        .collect()
}

/// 폴더 이름의 부분 접두사가 아니라 경로 경계로 범위를 판정합니다.
fn in_scope(path: &str, scopes: &BTreeSet<String>) -> bool {
    scopes.is_empty()
        || scopes.iter().any(|scope| {
            path == scope
                || path
                    .strip_prefix(scope)
                    .is_some_and(|tail| tail.starts_with('/'))
        })
}

/// 시작 행 0인 레거시 주소는 보정하지 않고 경로 단서로만 남깁니다.
fn has_line_range(candidate: &Value) -> Option<bool> {
    match (candidate.get("startLine"), candidate.get("endLine")) {
        (Some(start), Some(end)) if start.as_u64()? > 0 && end.as_u64()? >= start.as_u64()? => {
            Some(true)
        }
        (None, None) => Some(false),
        (Some(start), Some(end)) if start.as_u64()? == 0 && end.as_u64().is_some() => Some(false),
        _ => None,
    }
}

/// 수집 당시와 현재 권한의 교집합에서 미검증 단서와 상태 집계를 계산합니다.
fn page(value: &Value) -> Option<Value> {
    let allowed = paths(value, "allowedPaths")?;
    let original = paths(value, "originalPaths")?;
    let reviewed = paths(value, "reviewedPaths")?;
    let selected = paths(value, "selectedPaths")?;
    let failed = paths(value, "failedPaths")?;
    let scopes = paths(value, "scopes")?;
    let original_scopes = paths(value, "originalScopes")?;
    let offset = usize::try_from(value.get("offset")?.as_u64()?).ok()?;
    let limit = usize::try_from(value.get("limit")?.as_u64()?).ok()?;
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return None;
    }
    let mut rows = Vec::new();
    let mut discovered = BTreeSet::new();
    for candidate in value.get("candidates")?.as_array()? {
        let path = candidate.get("path")?.as_str()?;
        if !safe_path(path) {
            return None;
        }
        let source = candidate.get("source")?.as_str()?;
        if !["bm25", "lexical", "vector", "ann", "structural"].contains(&source) {
            return None;
        }
        if candidate.get("rank")?.as_u64()? == 0 || !candidate.get("score")?.as_f64()?.is_finite() {
            return None;
        }
        if let Some(index) = candidate.get("queryIndex")
            && index.as_u64()? > 3
        {
            return None;
        }
        let has_line_range = has_line_range(candidate)?;
        if !allowed.contains(path)
            || !original.contains(path)
            || !in_scope(path, &scopes)
            || !in_scope(path, &original_scopes)
        {
            continue;
        }
        discovered.insert(path.to_owned());
        let state = if failed.contains(path) {
            "source-failed"
        } else if selected.contains(path) {
            "source-selected"
        } else if reviewed.contains(path) {
            "indexed-reviewed"
        } else {
            "unreviewed"
        };
        let mut row = serde_json::Map::new();
        for key in [
            "path",
            "source",
            "rank",
            "score",
            "startLine",
            "endLine",
            "queryIndex",
        ] {
            if !has_line_range && matches!(key, "startLine" | "endLine") {
                continue;
            }
            if let Some(value) = candidate.get(key) {
                row.insert(key.to_owned(), value.clone());
            }
        }
        row.insert("state".to_owned(), json!(state));
        // 같은 파일의 일부 구절이 채택됐어도 이 후보 주소의 원문 검증을 뜻하지 않습니다.
        row.insert("verification".to_owned(), json!("unverified"));
        rows.push(Value::Object(row));
    }
    let count = |set: &BTreeSet<String>| discovered.intersection(set).count();
    let pending = discovered
        .iter()
        .filter(|path| {
            !reviewed.contains(*path) && !failed.contains(*path) && !selected.contains(*path)
        })
        .count();
    let end = offset.saturating_add(limit).min(rows.len());
    let items = rows.get(offset..end).unwrap_or_default();
    Some(json!({
        "summary": {
            "basis": "collected-candidates",
            "candidateRecords": rows.len(),
            "discoveredDocuments": discovered.len(),
            "indexedReviewedDocuments": count(&reviewed),
            "selectedSourceDocuments": count(&selected),
            "failedSourceDocuments": count(&failed),
            "unreviewedDocuments": pending,
        },
        "items": items,
        "nextOffset": if end < rows.len() { Some(end) } else { None },
    }))
}

/// 새 질의의 검색 범위는 이전 질의의 후보가 아니라 최초·현재 접근 범위의 교집합입니다.
fn search_scope(value: &Value) -> Option<Value> {
    let original = paths(value, "originalPaths")?;
    let allowed = paths(value, "allowedPaths")?;
    let original_scopes = paths(value, "originalScopes")?;
    let scopes = paths(value, "scopes")?;
    let mut seen = BTreeSet::new();
    let eligible: Vec<&str> = value
        .get("originalPaths")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .filter(|path| {
            original.contains(*path)
                && allowed.contains(*path)
                && in_scope(path, &original_scopes)
                && in_scope(path, &scopes)
                && seen.insert(*path)
        })
        .collect();
    Some(json!(eligible))
}

/// 검색 가능한 경로를 반환하되 발견·검토·원문 검증 완료로 승격하지 않습니다.
#[must_use]
#[wasm_bindgen]
pub fn scope_indexed_discovery_json(input: &str) -> String {
    if input.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    serde_json::from_str::<Value>(input)
        .ok()
        .and_then(|value| search_scope(&value))
        .map_or_else(String::new, |result| result.to_string())
}

/// 호출 시점의 허용 범위로 페이지를 재계산하여 오래된 커서로 권한을 넓히지 않습니다.
#[must_use]
#[wasm_bindgen]
pub fn page_indexed_discovery_json(input: &str) -> String {
    if input.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    serde_json::from_str::<Value>(input)
        .ok()
        .and_then(|value| page(&value))
        .map_or_else(String::new, |result| result.to_string())
}

#[cfg(test)]
mod tests {
    use super::{page_indexed_discovery_json, scope_indexed_discovery_json};
    use serde_json::{Value, json};

    fn check<T: PartialEq + core::fmt::Debug + Copy>(
        actual: T,
        expected: T,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if actual == expected {
            Ok(())
        } else {
            Err(format!("actual={actual:?}, expected={expected:?}").into())
        }
    }

    fn input() -> Value {
        json!({
            "candidates": (0..130).map(|index| json!({"path": format!("notes/{index:03}.md"), "startLine": 2, "endLine": 5, "rank": index + 1, "score": 1.0, "source": "bm25"})).collect::<Vec<_>>(),
            "allowedPaths": (0..130).map(|index| format!("notes/{index:03}.md")).collect::<Vec<_>>(),
            "originalPaths": (0..130).map(|index| format!("notes/{index:03}.md")).collect::<Vec<_>>(),
            "originalScopes": [],
            "reviewedPaths": ["notes/000.md", "notes/001.md"],
            "selectedPaths": ["notes/000.md"], "failedPaths": ["notes/001.md"],
            "scopes": [], "offset": 0, "limit": 32,
        })
    }

    #[test]
    fn followup_scope_is_not_limited_to_the_previous_query_candidates()
    -> Result<(), Box<dyn std::error::Error>> {
        let value = json!({
            "originalPaths": ["notes/second.md", "notes/first.md", "notes/first.md", "notes-private/hidden.md", "private/file.md"],
            "allowedPaths": ["notes/first.md", "notes/second.md", "notes/new.md", "notes-private/hidden.md", "private/file.md"],
            "originalScopes": ["notes"], "scopes": [],
        });
        let result: Value =
            serde_json::from_str(&scope_indexed_discovery_json(&value.to_string()))?;
        check(
            Some(&result),
            Some(&json!(["notes/second.md", "notes/first.md"])),
        )?;
        let mut restricted = value;
        *restricted.get_mut("allowedPaths").ok_or("missing paths")? = json!(["notes/first.md"]);
        let result: Value =
            serde_json::from_str(&scope_indexed_discovery_json(&restricted.to_string()))?;
        check(Some(&result), Some(&json!(["notes/first.md"])))?;
        *restricted.get_mut("scopes").ok_or("missing scopes")? = json!(["elsewhere"]);
        let result: Value =
            serde_json::from_str(&scope_indexed_discovery_json(&restricted.to_string()))?;
        check(Some(&result), Some(&json!([])))?;
        Ok(())
    }

    #[test]
    fn followup_scope_rejects_missing_or_unsafe_access_metadata()
    -> Result<(), Box<dyn std::error::Error>> {
        for value in [
            json!({"originalPaths": [], "allowedPaths": [], "scopes": []}),
            json!({"originalPaths": ["../secret.md"], "allowedPaths": [], "originalScopes": [], "scopes": []}),
            json!({"originalPaths": [], "allowedPaths": ["/outside.md"], "originalScopes": [], "scopes": []}),
            json!({"originalPaths": [], "allowedPaths": [], "originalScopes": ["notes/../private"], "scopes": []}),
        ] {
            check(
                scope_indexed_discovery_json(&value.to_string()).as_str(),
                "",
            )?;
        }
        Ok(())
    }

    #[test]
    fn retains_candidates_beyond_review_budget_and_pages_without_promoting_quotes()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut value = input();
        let first: Value = serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            first.pointer("/summary/discoveredDocuments"),
            Some(&json!(130)),
        )?;
        check(
            first.pointer("/summary/unreviewedDocuments"),
            Some(&json!(128)),
        )?;
        check(
            first.pointer("/items/0/state"),
            Some(&json!("source-selected")),
        )?;
        check(
            first.pointer("/items/1/state"),
            Some(&json!("source-failed")),
        )?;
        check(
            first.pointer("/items/0/verification"),
            Some(&json!("unverified")),
        )?;
        check(first.get("nextOffset"), Some(&json!(32)))?;
        *value.get_mut("offset").ok_or("missing offset")? = json!(128);
        let last: Value = serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            last.get("items").and_then(Value::as_array).map(Vec::len),
            Some(2),
        )?;
        check(last.pointer("/items/1/path"), Some(&json!("notes/129.md")))?;
        check(last.get("nextOffset"), Some(&Value::Null))?;
        Ok(())
    }

    #[test]
    fn retains_path_clues_when_legacy_ranges_start_at_zero()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut value = input();
        *value
            .pointer_mut("/candidates/0/startLine")
            .ok_or("missing start")? = json!(0);
        *value
            .pointer_mut("/candidates/0/endLine")
            .ok_or("missing end")? = json!(9);
        let result: Value = serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            result.pointer("/summary/discoveredDocuments"),
            Some(&json!(130)),
        )?;
        check(
            result.pointer("/items/0/path"),
            Some(&json!("notes/000.md")),
        )?;
        check(result.pointer("/items/0/startLine"), None)?;
        check(result.pointer("/items/0/endLine"), None)?;
        check(
            result.pointer("/items/0/verification"),
            Some(&json!("unverified")),
        )?;
        check(result.pointer("/items/1/startLine"), Some(&json!(2)))?;
        Ok(())
    }

    #[test]
    fn reapplies_current_access_and_folder_scope() -> Result<(), Box<dyn std::error::Error>> {
        let mut value = input();
        *value.get_mut("allowedPaths").ok_or("missing access")? =
            json!(["notes/001.md", "notes/002.md"]);
        *value.get_mut("scopes").ok_or("missing scopes")? = json!(["note"]);
        let none: Value = serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            none.pointer("/summary/discoveredDocuments"),
            Some(&json!(0)),
        )?;
        *value.get_mut("scopes").ok_or("missing scopes")? = json!(["notes"]);
        let restricted: Value =
            serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            restricted.pointer("/summary/discoveredDocuments"),
            Some(&json!(2)),
        )?;
        check(
            restricted.pointer("/items/0/path"),
            Some(&json!("notes/001.md")),
        )?;
        *value.get_mut("offset").ok_or("missing offset")? = json!(999);
        let exhausted: Value =
            serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(exhausted.get("items"), Some(&json!([])))?;
        check(exhausted.get("nextOffset"), Some(&Value::Null))?;
        Ok(())
    }

    #[test]
    fn cannot_widen_original_scope_or_copy_unverified_text()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut value = input();
        *value.get_mut("originalPaths").ok_or("missing access")? = json!(["notes/000.md"]);
        value
            .pointer_mut("/candidates/0")
            .and_then(Value::as_object_mut)
            .ok_or("missing candidate")?
            .insert("quote".to_owned(), json!("unverified body"));
        let result: Value = serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            result.pointer("/summary/discoveredDocuments"),
            Some(&json!(1)),
        )?;
        check(result.pointer("/items/0/quote"), None)?;
        *value.get_mut("originalScopes").ok_or("missing scopes")? = json!(["another"]);
        let result: Value = serde_json::from_str(&page_indexed_discovery_json(&value.to_string()))?;
        check(
            result.pointer("/summary/discoveredDocuments"),
            Some(&json!(0)),
        )?;
        Ok(())
    }

    #[test]
    fn rejects_unsafe_paths_and_invalid_ranges_and_page_bounds()
    -> Result<(), Box<dyn std::error::Error>> {
        for (pointer, invalid) in [
            ("/candidates/0/path", json!("../secret.md")),
            ("/candidates/0/startLine", json!(8)),
            ("/candidates/0/queryIndex", json!(4)),
            ("/limit", json!(0)),
            ("/limit", json!(97)),
        ] {
            let mut value = input();
            if pointer.ends_with("queryIndex") {
                value
                    .pointer_mut("/candidates/0")
                    .and_then(Value::as_object_mut)
                    .ok_or("missing candidate")?
                    .insert("queryIndex".to_owned(), invalid);
            } else {
                *value.pointer_mut(pointer).ok_or("missing field")? = invalid;
            }
            check(page_indexed_discovery_json(&value.to_string()).as_str(), "")?;
        }
        Ok(())
    }
}
