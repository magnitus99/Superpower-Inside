//! 공통 원문 청크와 그래프의 증분 재사용 및 인용 위치를 조정합니다.

use super::JsonValue;
use std::collections::{BTreeMap, BTreeSet};
use wasm_bindgen::prelude::wasm_bindgen;

/// 변경 없는 청크의 근거를 최신 원문에 연결하고 삭제할 추출 단위를 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_graph_reconcile_json(input_json: &str) -> String {
    parse_reconcile(input_json)
        .and_then(|plan| serde_json::to_string(&plan).ok())
        .unwrap_or_else(|| "null".to_owned())
}

/// 입력을 검증한 뒤 원문 ID를 기준으로 근거를 조정합니다.
fn parse_reconcile(input_json: &str) -> Option<JsonValue> {
    let input: JsonValue = serde_json::from_str(input_json).ok()?;
    let path = input.get("filePath")?.as_str()?;
    let retained = input
        .get("retainedEntryIds")?
        .as_array()?
        .iter()
        .map(JsonValue::as_str)
        .collect::<Option<BTreeSet<_>>>()?;
    let entries = input
        .get("entries")?
        .as_array()?
        .iter()
        .map(|entry| Some((entry.get("id")?.as_str()?, entry)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let mut removed = BTreeSet::<String>::new();
    let mut evidence_updates = Vec::new();
    for evidence in input.get("evidence")?.as_array()? {
        if evidence.get("filePath")?.as_str()? != path {
            continue;
        }
        let id = evidence.get("entryId")?.as_str()?;
        if !retained.contains(id) {
            removed.insert(id.to_owned());
            continue;
        }
        let entry = entries.get(id)?;
        let old_start = evidence
            .get("sourceStartLine")
            .or_else(|| evidence.get("startLine"))?
            .as_u64()?;
        let new_start = entry.get("startLine")?.as_u64()?;
        let mut updated = evidence.as_object()?.clone();
        for field in ["startLine", "endLine"] {
            if let Some(line) = evidence.get(field).and_then(JsonValue::as_u64) {
                let line = if new_start >= old_start {
                    line.saturating_add(new_start.saturating_sub(old_start))
                } else {
                    line.checked_sub(old_start.saturating_sub(new_start))?
                };
                updated.insert(field.to_owned(), line.into());
            }
        }
        updated.insert("sourceStartLine".to_owned(), new_start.into());
        updated.insert(
            "contentHash".to_owned(),
            entry.get("contentHash")?.as_str()?.into(),
        );
        evidence_updates.push(JsonValue::Object(updated));
    }
    for cache in input.get("cache")?.as_array()? {
        let id = cache.get("entryId")?.as_str()?;
        let root = id.split_once("::overflow::").map_or(id, |(root, _)| root);
        if root
            .strip_prefix(path)
            .is_some_and(|suffix| suffix.starts_with("::"))
            && !retained.contains(root)
        {
            removed.insert(id.to_owned());
        }
    }
    for fact in input.get("rejectedFacts")?.as_array()? {
        let id = fact.get("entryId")?.as_str()?;
        let root = id.split_once("::overflow::").map_or(id, |(root, _)| root);
        if fact.get("filePath")?.as_str()? == path && !retained.contains(root) {
            removed.insert(id.to_owned());
        }
    }
    Some(serde_json::json!({"removedEntryIds": removed, "evidenceUpdates": evidence_updates}))
}

#[cfg(test)]
mod tests {
    use super::{JsonValue, plan_source_graph_reconcile_json};

    /// 분할 추출 근거도 원문 청크의 이동량만큼 이동하며 삭제된 청크 캐시를 제거합니다.
    #[test]
    fn keeps_overflow_offsets_and_removes_deleted_cache() {
        let input = serde_json::json!({
            "filePath": "a.md", "retainedEntryIds": ["a.md::chunk::kept::0"],
            "entries": [{"id": "a.md::chunk::kept::0", "contentHash": "new", "startLine": 10}],
            "evidence": [{"id": "e", "entryId": "a.md::chunk::kept::0", "filePath": "a.md", "sourceStartLine": 2, "startLine": 4, "endLine": 5, "contentHash": "old"}],
            "cache": [{"entryId": "a.md::chunk::gone::0"}, {"entryId": "a.md::chunk::gone::0::overflow::1::0"}], "rejectedFacts": []
        });
        let actual = serde_json::from_str::<JsonValue>(&plan_source_graph_reconcile_json(
            &input.to_string(),
        ))
        .ok();
        assert_eq!(
            actual,
            Some(serde_json::json!({
                "removedEntryIds": ["a.md::chunk::gone::0", "a.md::chunk::gone::0::overflow::1::0"],
                "evidenceUpdates": [{"id": "e", "entryId": "a.md::chunk::kept::0", "filePath": "a.md", "sourceStartLine": 10, "startLine": 12, "endLine": 13, "contentHash": "new"}]
            }))
        );
    }
}
