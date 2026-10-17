//! 색인 전체의 검토 대상·원문 분할·채택/제외 판정을 검증합니다.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 이름·검색 순위로 자료를 제거하지 않고 색인과 허용 범위의 교집합을 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_review_inventory_json(input: &str) -> String {
    inventory(input).map_or_else(String::new, |value| value.to_string())
}

/// 허용 범위와 색인 목록을 검증하고 검색 결과를 먼저 배치합니다.
fn inventory(input: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(input).ok()?;
    let strings = |key| {
        value
            .get(key)?
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()
    };
    let indexed = strings("indexedPaths")?;
    let visible = strings("visiblePaths")?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let scopes = strings("scopes")?;
    let priorities = strings("priorityPaths")?;
    let priority = priorities
        .iter()
        .enumerate()
        .map(|(index, path)| (*path, index))
        .collect::<BTreeMap<_, _>>();
    let mut paths = indexed
        .into_iter()
        .filter(|path| {
            visible.contains(path)
                && safe_path(path)
                && (scopes.is_empty()
                    || scopes.iter().any(|scope| {
                        *path == *scope
                            || path
                                .strip_prefix(scope)
                                .is_some_and(|tail| tail.starts_with('/'))
                    }))
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| (priority.get(path).copied().unwrap_or(usize::MAX), *path));
    Some(json!({"paths": paths}))
}

/// 볼트 상대 경로만 허용합니다.
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// 긴 한 줄도 생략하지 않고 모델의 요청 예산 안에 들어가는 원문 조각으로 나눕니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_review_segments_json(input: &str, max_chars: usize) -> String {
    segments(input, max_chars).map_or_else(String::new, |value| value.to_string())
}

/// 겹치는 문맥과 UTF-16 위치를 보존하면서 전체 본문을 나눕니다.
fn segments(input: &str, max_chars: usize) -> Option<Value> {
    let value: Value = serde_json::from_str(input).ok()?;
    let path = value.get("path")?.as_str()?;
    let mut line = value.get("startLine")?.as_u64()?.max(1);
    let mut offset = value
        .get("startOffset")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let text = value.get("content")?.as_str()?;
    if !safe_path(path) || max_chars == 0 {
        return None;
    }
    let max_chars = max_chars.min(9000);
    let mut positions = Vec::new();
    for character in text.chars() {
        positions.push((character, line, offset));
        if character == '\n' {
            line = line.checked_add(1)?;
            offset = 0;
        } else {
            offset = offset.checked_add(u64::try_from(character.len_utf16()).ok()?)?;
        }
    }
    let mut parts = Vec::new();
    let overlap = max_chars.checked_div(4)?.min(128);
    for start in (0..positions.len()).step_by(max_chars - overlap) {
        let end = start.saturating_add(max_chars).min(positions.len());
        let (_, start_line, start_offset) = positions.get(start)?;
        let (_, end_line, _) = positions.get(end.checked_sub(1)?)?;
        let id = format!("{path}:{start_line}:{start_offset}");
        let part = positions
            .get(start..end)?
            .iter()
            .map(|(character, _, _)| character)
            .collect::<String>();
        parts.push(json!({"id": id, "path": path, "startLine": start_line, "endLine": end_line, "text": part}));
        if end == positions.len() {
            break;
        }
    }
    Some(json!({"segments": parts}))
}

/// 모든 원문 조각에 명시적 채택/제외가 있어야 완료하며 채택 구절은 원문과 대조합니다.
#[must_use]
#[wasm_bindgen]
pub fn validate_indexed_review_json(segments_json: &str, response: &str) -> String {
    validate_review(segments_json, response).map_or_else(String::new, |value| value.to_string())
}

/// 모든 답변 문단을 검토에서 채택한 실제 출처에 연결한 뒤 Markdown을 만듭니다.
#[must_use]
#[wasm_bindgen]
pub fn render_indexed_review_answer_json(source_ids: &str, response: &str) -> String {
    render_answer(source_ids, response).map_or_else(String::new, |value| value.to_string())
}

/// 모든 답변 문단에 채택된 출처만 연결합니다.
fn render_answer(source_ids: &str, response: &str) -> Option<Value> {
    let sources: BTreeSet<String> = serde_json::from_str(source_ids).ok()?;
    let raw = super::extract_json_object(response)?;
    let value: Value = serde_json::from_str(raw).ok()?;
    let paragraphs = value.get("paragraphs")?.as_array()?;
    if paragraphs.is_empty() || paragraphs.len() > 64 {
        return None;
    }
    let mut blocks = Vec::new();
    for paragraph in paragraphs {
        let text = paragraph.get("text")?.as_str()?.trim();
        let references = paragraph.get("sources")?.as_array()?;
        if text.is_empty()
            || text.chars().count() > 8000
            || text.contains("[vault:")
            || references.is_empty()
            || references.len() > 8
        {
            return None;
        }
        let citations = references
            .iter()
            .map(|reference| {
                let id = reference.as_str()?;
                sources.contains(id).then(|| format!("[{id}]"))
            })
            .collect::<Option<Vec<_>>>()?;
        blocks.push(format!("{text} {}", citations.join(" ")));
    }
    Some(json!({"content": blocks.join("\n\n")}))
}

/// 구간별 판정 누락·중복·허위 인용을 거부합니다.
fn validate_review(segments_json: &str, response: &str) -> Option<Value> {
    let segments: Vec<Value> = serde_json::from_str(segments_json).ok()?;
    let raw = super::extract_json_object(response)?;
    let review: Value = serde_json::from_str(raw).ok()?;
    let decisions = review.get("decisions")?.as_array()?;
    if segments.is_empty() || segments.len() > 8 || decisions.len() != segments.len() {
        return None;
    }
    let by_id = segments
        .iter()
        .map(|segment| Some((segment.get("id")?.as_str()?, segment)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    if by_id.len() != segments.len() {
        return None;
    }
    let mut seen = BTreeSet::new();
    let mut findings = Vec::new();
    let mut rejected = 0;
    for decision in decisions {
        let id = decision.get("id")?.as_str()?;
        let reason = decision.get("reason")?.as_str()?;
        let relevant = decision.get("relevant")?.as_bool()?;
        let extracted = decision.get("findings")?.as_array()?;
        let segment = by_id.get(id)?;
        let path = segment.get("path")?.as_str()?;
        let start_line = segment.get("startLine")?.as_u64()?;
        let end_line = segment.get("endLine")?.as_u64()?;
        let text = segment.get("text")?.as_str()?;
        if !safe_path(path)
            || start_line == 0
            || end_line < start_line
            || !seen.insert(id)
            || reason.trim().is_empty()
            || reason.chars().count() > 1000
            || extracted.len() > 8
            || relevant == extracted.is_empty()
        {
            return None;
        }
        if !relevant {
            rejected += 1;
        }
        for finding in extracted {
            let claim = finding.get("claim")?.as_str()?;
            let quote = finding.get("quote")?.as_str()?;
            if claim.trim().is_empty()
                || claim.chars().count() > 1000
                || !(4..=1000).contains(&quote.chars().count())
                || !text.contains(quote)
            {
                return None;
            }
            findings.push(json!({"path": path, "startLine": start_line,
                "endLine": end_line, "sourceId": format!("vault:{path}:{start_line}-{end_line}"),
                "claim": claim, "quote": quote}));
        }
    }
    Some(
        json!({"findings": findings, "reviewedSegments": segments.len(), "rejectedSegments": rejected}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answer_requires_accepted_sources_on_every_paragraph() {
        let sources = r#"["vault:Research/A.md:2-3"]"#;
        let answer = r#"{"paragraphs":[{"text":"Two cooling cycles are required.","sources":["vault:Research/A.md:2-3"]}]}"#;
        let rendered = render_answer(sources, answer).unwrap_or(Value::Null);
        assert!(
            rendered
                .get("content")
                .and_then(Value::as_str)
                .is_some_and(|text| text.contains("[vault:Research/A.md:2-3]"))
        );
        assert!(
            render_answer(
                sources,
                r#"{"paragraphs":[{"text":"General knowledge.","sources":[]}]}"#
            )
            .is_none()
        );
        assert!(
            render_answer(sources, &answer.replace("Research/A", "Research/Invented")).is_none()
        );
    }

    #[test]
    fn inventory_keeps_every_visible_indexed_file_and_only_prioritizes_hits() {
        let paths = (0..2103)
            .map(|index| format!("Research/{index}.txt"))
            .collect::<Vec<_>>();
        let plan = inventory(&json!({"indexedPaths": paths, "visiblePaths": paths, "scopes": [], "priorityPaths": ["Research/2102.txt"]}).to_string()).unwrap_or(Value::Null);
        assert_eq!(
            plan.get("paths").and_then(Value::as_array).map(Vec::len),
            Some(2103)
        );
        assert_eq!(plan.pointer("/paths/0"), Some(&json!("Research/2102.txt")));
        assert!(
            plan.get("paths")
                .and_then(Value::as_array)
                .is_some_and(|paths| paths.contains(&json!("Research/0.txt")))
        );
    }

    #[test]
    fn inventory_preserves_exclusions_and_scope() {
        let plan = inventory(r#"{"indexedPaths":["A/One.md","B/Two.md","A/Hidden.md","../bad"],"visiblePaths":["A/One.md","B/Two.md","../bad"],"scopes":["A"],"priorityPaths":[]}"#).unwrap_or(Value::Null);
        assert_eq!(plan.get("paths"), Some(&json!(["A/One.md"])));
    }

    #[test]
    fn segments_preserve_long_lines_unicode_and_late_evidence() {
        let text = format!("{}\nLate exception.", "😀漢".repeat(1000));
        let plan = segments(
            &json!({"path":"Research/Long.txt","startLine":7,"startOffset":2,"content":text})
                .to_string(),
            73,
        )
        .unwrap_or(Value::Null);
        let rows = plan
            .get("segments")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        assert!(!rows.is_empty());
        assert_eq!(
            rows.iter()
                .enumerate()
                .map(|(index, row)| row
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .chars()
                    .skip(if index == 0 { 0 } else { 18 })
                    .collect::<String>())
                .collect::<String>(),
            text
        );
        assert_eq!(
            rows.last().and_then(|row| row.get("endLine")),
            Some(&json!(8))
        );
        assert_eq!(
            rows.iter()
                .filter_map(|row| row.get("id").and_then(Value::as_str))
                .collect::<BTreeSet<_>>()
                .len(),
            rows.len()
        );
    }

    #[test]
    fn every_segment_needs_a_decision_and_accepted_quotes_must_exist() {
        let rows = r#"[{"id":"one","path":"Research/A.md","startLine":2,"endLine":3,"text":"Quartz requires two cooling cycles."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"Unrelated delivery schedule."}]"#;
        let decisions = json!({"decisions":[{"id":"one","relevant":true,"reason":"Restart condition","findings":[{"claim":"Wait two cycles.","quote":"two cooling cycles"}]},{"id":"two","relevant":false,"reason":"No restart information.","findings":[]}]});
        let result = validate_review(rows, &decisions.to_string()).unwrap_or(Value::Null);
        assert_eq!(result.get("reviewedSegments"), Some(&json!(2)));
        assert_eq!(result.get("rejectedSegments"), Some(&json!(1)));
        assert_eq!(
            result.pointer("/findings/0/sourceId"),
            Some(&json!("vault:Research/A.md:2-3"))
        );
        let mut invalid = decisions.clone();
        if let Some(quote) = invalid.pointer_mut("/decisions/0/findings/0/quote") {
            *quote = json!("invented condition");
        }
        assert!(validate_review(rows, &invalid.to_string()).is_none());
        invalid = decisions.clone();
        if let Some(items) = invalid.get_mut("decisions").and_then(Value::as_array_mut) {
            items.pop();
        }
        assert!(validate_review(rows, &invalid.to_string()).is_none());
        invalid = decisions;
        if let Some(id) = invalid.pointer_mut("/decisions/1/id") {
            *id = json!("one");
        }
        assert!(validate_review(rows, &invalid.to_string()).is_none());
    }
}
