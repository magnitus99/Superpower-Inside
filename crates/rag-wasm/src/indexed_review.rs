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

/// 화면 단계의 채택/제외 판정을 검증하고 extract가 사용할 판정 순서를 보존합니다.
#[wasm_bindgen]
pub fn validate_indexed_review_screen_json(segments_json: &str, response: &str) -> String {
    validate_screen_review(segments_json, response)
        .map_or_else(String::new, |value| value.to_string())
}

/// 질문 토큰과 겹치는 비율만 계산하고 임계 판정은 호스트에 맡깁니다.
#[wasm_bindgen]
pub fn score_indexed_review_segments_json(input: &str) -> String {
    score_segments(input).map_or_else(String::new, |value| value.to_string())
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
                if id == "vault:" || id.starts_with("vault:vault:") {
                    return None;
                }
                let source_id = if sources.contains(id) {
                    id
                } else {
                    let normalized = id.strip_prefix("vault:")?;
                    sources.contains(normalized).then_some(normalized)?
                };
                Some(format!("[{source_id}]"))
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

/// 조각마다 중복 없이 1:1로 대응하는 채택/제외 판정만 허용합니다.
fn validate_screen_review(segments_json: &str, response: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(segments_json).ok()?;
    let segments = value.get("segments")?.as_array()?;
    if segments.is_empty() || segments.len() > 16 {
        return None;
    }
    let ids = segments
        .iter()
        .map(|segment| segment.get("id")?.as_str())
        .collect::<Option<BTreeSet<_>>>()?;
    if ids.len() != segments.len() {
        return None;
    }
    let raw = super::extract_json_object(response)?;
    let review: Value = serde_json::from_str(raw).ok()?;
    let decisions = review.get("decisions")?.as_array()?;
    if decisions.len() != segments.len() {
        return None;
    }
    let mut seen = BTreeSet::new();
    let mut screened = Vec::with_capacity(decisions.len());
    for decision in decisions {
        let id = decision.get("id")?.as_str()?;
        let relevant = decision.get("relevant")?.as_bool()?;
        let reason = decision.get("reason")?.as_str()?;
        if !ids.contains(id)
            || !seen.insert(id)
            || reason.trim().is_empty()
            || reason.chars().count() > 1000
        {
            return None;
        }
        screened.push(json!({"id": id, "relevant": relevant, "reason": reason}));
    }
    Some(json!({"decisions": screened}))
}

/// 한 조각의 질문 용어 빈도와 검색 구간입니다.
struct ReviewScoreSegment<'a> {
    /// 원문 조각 식별자입니다.
    id: &'a str,
    /// 문서 빈도를 합산할 경로입니다.
    path: &'a str,
    /// 질문 밖 용어도 포함한 전체 토큰 수입니다.
    length: usize,
    /// 질문에 등장하는 용어의 출현 횟수입니다.
    frequencies: BTreeMap<String, usize>,
    /// 선택적으로 제공된 시작 행입니다.
    start_line: Option<u64>,
    /// 선택적으로 제공된 끝 행입니다.
    end_line: Option<u64>,
}

/// 기존 하이브리드 검색이 지목한 원문 구간과 순위입니다.
struct ReviewRetrievalSignal<'a> {
    /// 검색 결과 문서 경로입니다.
    path: &'a str,
    /// 1부터 시작하는 검색 순위입니다.
    rank: f64,
    /// 검색 결과의 시작 행입니다.
    start_line: Option<u64>,
    /// 검색 결과의 끝 행입니다.
    end_line: Option<u64>,
}

/// 검색 신호가 없으면 빈 목록, 손상됐으면 실패를 반환합니다.
fn parse_review_retrieval_signals(value: &Value) -> Option<Vec<ReviewRetrievalSignal<'_>>> {
    let Some(raw) = value.get("retrievalSignals") else {
        return Some(Vec::new());
    };
    raw.as_array()?
        .iter()
        .map(|signal| {
            let rank = signal.get("rank")?.as_u64()?;
            if rank == 0 {
                return None;
            }
            let start_line = match signal.get("startLine") {
                Some(line) => Some(line.as_u64()?),
                None => None,
            };
            let end_line = match signal.get("endLine") {
                Some(line) => Some(line.as_u64()?),
                None => None,
            };
            if start_line.is_some_and(|line| line == 0)
                || end_line.is_some_and(|line| line < start_line.unwrap_or(1))
            {
                return None;
            }
            Some(ReviewRetrievalSignal {
                path: signal.get("path")?.as_str()?,
                rank: crate::usize_to_f64(usize::try_from(rank).ok()?)?,
                start_line,
                end_line,
            })
        })
        .collect()
}

/// 문서별 희귀도·조각 길이와 기존 검색 순위를 함께 보존합니다.
fn score_segments(input: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(input).ok()?;
    let question = value.get("question")?.as_str()?;
    let segments = value.get("segments")?.as_array()?;
    if segments.is_empty() {
        return None;
    }
    let asked = crate::tokenize(question)
        .into_iter()
        .collect::<BTreeSet<_>>();
    let mut corpus = Vec::with_capacity(segments.len());
    let mut documents = BTreeMap::<&str, BTreeSet<String>>::new();
    let mut total_length = 0_usize;
    let mut ids = BTreeSet::new();
    for segment in segments {
        let id = segment.get("id")?.as_str()?;
        if !ids.insert(id) {
            return None;
        }
        let path = segment.get("path")?.as_str()?;
        let text = segment.get("text")?.as_str()?;
        let tokens = crate::tokenize(text);
        total_length = total_length.checked_add(tokens.len())?;
        let mut frequencies = BTreeMap::<String, usize>::new();
        for token in tokens.iter().filter(|token| asked.contains(*token)) {
            *frequencies.entry(token.clone()).or_default() += 1;
        }
        documents
            .entry(path)
            .or_default()
            .extend(frequencies.keys().cloned());
        corpus.push(ReviewScoreSegment {
            id,
            path,
            length: tokens.len(),
            frequencies,
            start_line: segment.get("startLine").and_then(Value::as_u64),
            end_line: segment.get("endLine").and_then(Value::as_u64),
        });
    }
    let document_count = crate::usize_to_f64(documents.len())?;
    let average_length = crate::usize_to_f64(total_length)? / crate::usize_to_f64(corpus.len())?;
    let inverse_frequencies = asked
        .iter()
        .map(|token| {
            let frequency = documents
                .values()
                .filter(|terms| terms.contains(token))
                .count();
            let frequency = crate::usize_to_f64(frequency)?;
            Some((
                token.as_str(),
                ((document_count - frequency + 0.5) / (frequency + 0.5)).ln_1p(),
            ))
        })
        .collect::<Option<BTreeMap<_, _>>>()?;
    let signals = parse_review_retrieval_signals(&value)?;
    let mut rows = Vec::with_capacity(corpus.len());
    for segment in corpus {
        let mut raw_score = 0.0;
        for (term, frequency) in segment.frequencies {
            raw_score += crate::bm25_score_value(
                *inverse_frequencies.get(term.as_str())?,
                crate::usize_to_f64(frequency)?,
                crate::usize_to_f64(segment.length)?,
                average_length,
            );
        }
        let retrieval_score = signals
            .iter()
            .filter(|signal| {
                signal.path == segment.path
                    && match (signal.start_line, segment.start_line, segment.end_line) {
                        (Some(start), Some(segment_start), Some(segment_end)) => {
                            segment_start <= signal.end_line.unwrap_or(start)
                                && segment_end >= start
                        }
                        _ => true,
                    }
            })
            .map(|signal| 1.0 / (60.0 + signal.rank))
            .fold(0.0_f64, f64::max);
        raw_score += retrieval_score;
        let score = if asked.is_empty() {
            1.0
        } else {
            raw_score / (1.0 + raw_score)
        };
        rows.push(json!({"id": segment.id, "score": score}));
    }
    Some(json!({"scores": rows}))
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
    fn answer_normalizes_one_vault_prefix_to_the_original_source_id() {
        let sources = r#"["Research/A.md#L2-L3"]"#;
        let answer = r#"{"paragraphs":[{"text":"Two cooling cycles are required.","sources":["vault:Research/A.md#L2-L3"]}]}"#;
        let content = render_answer(sources, answer).and_then(|value| {
            value
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        assert_eq!(
            content.as_deref(),
            Some("Two cooling cycles are required. [Research/A.md#L2-L3]")
        );
    }

    #[test]
    fn answer_rejects_duplicate_vault_prefix_unknown_and_empty_source_ids() {
        let sources = r#"["Research/A.md#L2-L3"]"#;
        for reference in [
            "vault:vault:Research/A.md#L2-L3",
            "vault:Research/Invented.md#L1-L1",
            "vault:",
        ] {
            let answer =
                json!({"paragraphs":[{"text":"Unsupported reference.","sources":[reference]}]})
                    .to_string();
            assert!(
                render_answer(sources, &answer).is_none(),
                "accepted {reference}"
            );
        }
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

    #[test]
    fn screen_keeps_only_id_relevant_reason_for_mixed_decisions() {
        let rows = json!({"segments":[{"id":"one","path":"Research/A.md","startLine":2,"endLine":3,"text":"Quartz requires two cooling cycles."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"Unrelated delivery schedule."}]}).to_string();
        let response = json!({"decisions":[{"id":"one","relevant":true,"reason":"Restart condition","findings":[{"claim":"Wait two cycles.","quote":"two cooling cycles"}]},{"id":"two","relevant":false,"reason":"No restart information."}]}).to_string();
        let expected = json!({"decisions":[{"id":"one","relevant":true,"reason":"Restart condition"},{"id":"two","relevant":false,"reason":"No restart information."}]});
        assert_eq!(
            validate_screen_review(&rows, &response),
            Some(expected.clone())
        );
        assert_eq!(
            serde_json::from_str::<Value>(&validate_indexed_review_screen_json(&rows, &response))
                .ok(),
            Some(expected)
        );
    }

    #[test]
    fn screen_preserves_decision_order_from_response() {
        let rows = json!({"segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"Quartz requires two cooling cycles."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"Unrelated delivery schedule."}]}).to_string();
        let response = json!({"decisions":[{"id":"two","relevant":false,"reason":"No restart information."},{"id":"one","relevant":true,"reason":"Restart condition."}]}).to_string();
        let result = validate_screen_review(&rows, &response).unwrap_or(Value::Null);
        assert_eq!(result.pointer("/decisions/0/id"), Some(&json!("two")));
        assert_eq!(result.pointer("/decisions/1/id"), Some(&json!("one")));
        assert_eq!(result.pointer("/decisions/1/relevant"), Some(&json!(true)));
    }

    #[test]
    fn screen_rejects_segment_without_decision() {
        let rows = json!({"segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"First."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"Second."}]}).to_string();
        let response = json!({"decisions":[{"id":"one","relevant":true,"reason":"Match."},{"id":"three","relevant":false,"reason":"Mismatch."}]}).to_string();
        assert!(validate_screen_review(&rows, &response).is_none());
        assert_eq!(validate_indexed_review_screen_json(&rows, &response), "");
    }

    #[test]
    fn screen_rejects_duplicate_decision_ids() {
        let rows = json!({"segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"First."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"Second."}]}).to_string();
        let response = json!({"decisions":[{"id":"one","relevant":true,"reason":"Match."},{"id":"one","relevant":false,"reason":"Mismatch."}]}).to_string();
        assert!(validate_screen_review(&rows, &response).is_none());
        assert_eq!(validate_indexed_review_screen_json(&rows, &response), "");
    }

    #[test]
    fn screen_rejects_non_boolean_relevance() {
        let rows = json!({"segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"First."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"Second."}]}).to_string();
        let response = json!({"decisions":[{"id":"one","relevant":"yes","reason":"Match."},{"id":"two","relevant":false,"reason":"Mismatch."}]}).to_string();
        assert!(validate_screen_review(&rows, &response).is_none());
        assert_eq!(validate_indexed_review_screen_json(&rows, &response), "");
    }

    #[test]
    fn screen_rejects_more_than_sixteen_segments() {
        let segments = (0..17)
            .map(|index| {
                json!({"id": format!("segment-{index}"), "path": "Research/A.md", "startLine": 1, "endLine": 1, "text": "text"})
            })
            .collect::<Vec<_>>();
        let rows = json!({"segments": segments}).to_string();
        let decisions = (0..17)
            .map(|index| json!({"id": format!("segment-{index}"), "relevant": true, "reason": "reason"}))
            .collect::<Vec<_>>();
        let response = json!({"decisions": decisions}).to_string();
        assert!(validate_screen_review(&rows, &response).is_none());
        assert_eq!(validate_indexed_review_screen_json(&rows, &response), "");
    }

    #[test]
    fn score_matches_korean_tokens_partially() {
        let input = json!({"question":"냉각 주기","segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"냉각이 필요하다."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"무관한 배송 일정입니다."}]}).to_string();
        let result = score_segments(&input).unwrap_or(Value::Null);
        let partial = result
            .pointer("/scores/0/score")
            .and_then(Value::as_f64)
            .unwrap_or(-1.0);
        assert!(partial > 0.0 && partial < 1.0);
        assert_eq!(result.pointer("/scores/0/id"), Some(&json!("one")));
        assert_eq!(result.pointer("/scores/1/score"), Some(&json!(0.0)));
        assert_eq!(result.pointer("/scores/1/id"), Some(&json!("two")));
    }

    #[test]
    fn score_ignores_english_letter_case() {
        let input = json!({"question":"Quartz Cooling","segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"the QUARTZ cooling cycle requires two cycles"}]}).to_string();
        let result = score_segments(&input).unwrap_or(Value::Null);
        let lower = score_segments(&input.to_lowercase()).unwrap_or(Value::Null);
        assert_eq!(
            result.pointer("/scores/0/score"),
            lower.pointer("/scores/0/score")
        );
        assert!(
            result
                .pointer("/scores/0/score")
                .and_then(Value::as_f64)
                .is_some_and(|score| score > 0.0 && score < 1.0)
        );
    }

    #[test]
    fn score_is_zero_without_token_overlap() {
        let input = json!({"question":"냉각 주기","segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"Delivery schedule for next week."}]}).to_string();
        let result = score_segments(&input).unwrap_or(Value::Null);
        assert_eq!(result.pointer("/scores/0/score"), Some(&json!(0.0)));
    }

    #[test]
    fn score_prioritizes_rare_terms_and_concise_passages() {
        let input = json!({"question":"quartz maintenance","segments":[
            {"id":"rare","path":"A.md","text":"quartz"},
            {"id":"common","path":"B.md","text":"maintenance"},
            {"id":"long","path":"C.md","text":format!("quartz {}", "delivery ".repeat(40))},
            {"id":"other","path":"D.md","text":"maintenance"},
            {"id":"another","path":"E.md","text":"maintenance"}
        ]})
        .to_string();
        let result = score_segments(&input).unwrap_or(Value::Null);
        let score = |index| {
            result
                .pointer(&format!("/scores/{index}/score"))
                .and_then(Value::as_f64)
                .unwrap_or(-1.0)
        };
        assert!(score(0) > score(1));
        assert!(score(0) > score(2));
    }

    #[test]
    fn score_preserves_semantic_retrieval_signal_without_lexical_overlap() {
        let input = json!({"question":"quartz","segments":[
            {"id":"semantic","path":"A.md","startLine":10,"endLine":20,"text":"cooling cycles"},
            {"id":"unrelated","path":"B.md","startLine":1,"endLine":5,"text":"delivery schedule"}
        ],"retrievalSignals":[{"path":"A.md","startLine":12,"endLine":15,"rank":1}]})
        .to_string();
        let result = score_segments(&input).unwrap_or(Value::Null);
        assert!(
            result
                .pointer("/scores/0/score")
                .and_then(Value::as_f64)
                .is_some_and(|score| score > 0.0)
        );
        assert_eq!(result.pointer("/scores/1/score"), Some(&json!(0.0)));
    }

    #[test]
    fn score_rejects_invalid_retrieval_signals_and_duplicate_ids() {
        let segment = json!({"id":"one","path":"A.md","startLine":1,"endLine":2,"text":"quartz"});
        for signal in [
            json!({"path":"A.md","rank":0}),
            json!({"path":"A.md","rank":1,"startLine":3,"endLine":1}),
            json!({"path":"A.md","rank":1,"startLine":"invalid"}),
        ] {
            let invalid =
                json!({"question":"quartz","segments":[segment],"retrievalSignals":[signal]});
            assert!(score_segments(&invalid.to_string()).is_none());
        }
        let duplicated = json!({"question":"quartz","segments":[segment, segment]});
        assert!(score_segments(&duplicated.to_string()).is_none());
    }

    #[test]
    fn score_keeps_every_segment_when_question_has_no_tokens() {
        let input = json!({"question":"가","segments":[{"id":"one","path":"Research/A.md","startLine":1,"endLine":1,"text":"Quartz requires two cooling cycles."},{"id":"two","path":"Research/B.md","startLine":1,"endLine":1,"text":"전혀 무관한 문장입니다."}]}).to_string();
        let result = score_segments(&input).unwrap_or(Value::Null);
        assert_eq!(result.pointer("/scores/0/score"), Some(&json!(1.0)));
        assert_eq!(result.pointer("/scores/1/score"), Some(&json!(1.0)));
    }

    #[test]
    fn score_rejects_empty_segments() {
        let input = json!({"question":"냉각 주기","segments":[]}).to_string();
        assert!(score_segments(&input).is_none());
        assert_eq!(score_indexed_review_segments_json(&input), "");
    }

    #[test]
    fn score_supports_full_corpus_with_more_than_1024_segments() {
        let segments = (0..1025)
            .map(|index| {
                json!({"id": format!("segment-{index}"), "path": "Research/A.md", "startLine": 1, "endLine": 1, "text": "냉각이 필요하다."})
            })
            .collect::<Vec<_>>();
        let input = json!({"question":"냉각 주기","segments":segments}).to_string();
        assert_eq!(
            score_segments(&input)
                .and_then(|value| value.get("scores").and_then(Value::as_array).map(Vec::len)),
            Some(1025)
        );
    }
}
