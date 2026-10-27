//! 색인 전체의 검토 대상·원문 분할·채택/제외 판정을 검증합니다.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 검색 계획·근거·답변 검증 bridge 호출의 `JSON` byte 상한입니다.
const MAX_ANSWER_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// 검색 계획 facet 수 상한입니다.
const MAX_ANSWER_FACETS: usize = 3;
/// 비교 답변 계획이 받는 근거 항목 수 상한입니다.
const MAX_ANSWER_EVIDENCE: usize = 64;
/// 답변이 인용할 수 있는 전체 source ID 수 상한입니다.
const MAX_ANSWER_SOURCES: usize = 64;
/// 답변 문단 수 상한입니다.
const MAX_ANSWER_PARAGRAPHS: usize = 64;
/// 검색 계획 query index의 wire 상한입니다.
const MAX_QUERY_INDEX: usize = 3;
/// 검색 계획 query 하나의 문자 수 상한입니다.
const MAX_QUERY_CHARS: usize = 320;
/// 문단 하나의 문자 수 상한입니다.
const MAX_PARAGRAPH_CHARS: usize = 8000;
/// 문단 하나가 인용할 수 있는 source 수 상한입니다.
const MAX_PARAGRAPH_SOURCES: usize = 8;

/// 후속 조사 계획에서 검색 질의와 전체 열거 의도를 분리합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_followup_json(input: &str) -> String {
    if input.len() > 16_384 {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(input) else {
        return String::new();
    };
    let Some(question) = value.get("question").and_then(Value::as_str) else {
        return String::new();
    };
    let Some(response) = value.get("response").and_then(Value::as_str) else {
        return String::new();
    };
    let parsed = serde_json::from_str::<Value>(response).ok();
    let (queries, enumerate) = match parsed.as_ref() {
        Some(Value::Array(_)) => (response.to_owned(), false),
        Some(Value::Object(plan)) => {
            let Some(queries) = plan.get("queries").filter(|queries| queries.is_array()) else {
                return String::new();
            };
            let Some(enumerate) = plan.get("enumerate").and_then(Value::as_bool) else {
                return String::new();
            };
            (queries.to_string(), enumerate)
        }
        _ => return String::new(),
    };
    if queries == "[]" {
        return json!({"variants": [], "enumerate": enumerate}).to_string();
    }
    let plan = super::plan_vault_query_expansion_json(question, &queries);
    let Ok(mut plan) = serde_json::from_str::<Value>(&plan) else {
        return String::new();
    };
    let Some(object) = plan.as_object_mut() else {
        return String::new();
    };
    object.insert("enumerate".to_owned(), json!(enumerate));
    plan.to_string()
}

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

/// 비교 답변의 보존 대상 facet과 출처 상태를 계산합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_review_answer_plan_json(input: &str) -> String {
    if input.len() > MAX_ANSWER_INPUT_BYTES {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(input) else {
        return String::new();
    };
    indexed_review_answer_plan(&value).map_or_else(String::new, |plan| plan.to_string())
}

/// 답변 문단이 계획한 facet과 실제 출처를 모두 지키는지 검증합니다.
#[must_use]
#[wasm_bindgen]
pub fn validate_indexed_review_answer_json(input: &str) -> String {
    if input.len() > MAX_ANSWER_INPUT_BYTES {
        return invalid_answer("invalid-format", &[]).to_string();
    }
    let value = serde_json::from_str::<Value>(input).ok();
    value
        .as_ref()
        .and_then(indexed_review_answer_validation)
        .unwrap_or_else(|| invalid_answer("invalid-format", &[]))
        .to_string()
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

/// 검색 계획의 facet 하나입니다.
struct ReviewSearchFacet {
    /// 안정적인 facet ID입니다.
    id: String,
    /// `question`/`subject` 구분입니다.
    kind: String,
    /// 사용자 질문에서 보존한 query 원문입니다.
    query: String,
    /// 검색 계획 배열 순서와 같은 index입니다.
    query_index: usize,
}

/// 답변 계획의 근거 하나입니다.
struct ReviewAnswerEvidence {
    /// 호스트가 부여한 실제 출처 ID입니다.
    source_id: String,
    /// 검색 계획의 query index 합집합입니다.
    query_indexes: BTreeSet<usize>,
}

/// 답변 계획이 보존할 facet 상태입니다.
struct ReviewAnswerPlanFacet {
    /// 검색 계획 facet ID입니다.
    id: String,
    /// `question`/`subject` 구분입니다.
    kind: String,
    /// `supported`/`missing` 상태입니다.
    status: &'static str,
    /// 이 facet와 연결된 실제 출처 ID입니다.
    source_ids: Vec<String>,
}

/// 검증한 검색 계획과 근거에서 답변 계획을 계산합니다.
fn indexed_review_answer_plan(value: &Value) -> Option<Value> {
    let search_plan = value.get("searchPlan")?;
    let (mode, search_facets) = parse_review_search_plan(search_plan)?;
    let evidence = parse_review_evidence(value.get("evidence")?)?;
    let facets = search_facets
        .iter()
        .filter(|facet| mode == "single" || facet.kind == "subject")
        .map(|facet| {
            let source_ids = if mode == "single" {
                unique_source_ids(evidence.iter().map(|item| item.source_id.as_str()))
            } else {
                let mut source_ids = Vec::new();
                for item in &evidence {
                    if item.query_indexes.contains(&facet.query_index)
                        && !source_ids.contains(&item.source_id)
                    {
                        source_ids.push(item.source_id.clone());
                    }
                }
                source_ids
            };
            ReviewAnswerPlanFacet {
                id: facet.id.clone(),
                kind: facet.kind.clone(),
                status: if source_ids.is_empty() {
                    "missing"
                } else {
                    "supported"
                },
                source_ids,
            }
        })
        .collect::<Vec<_>>();
    if facets.is_empty()
        || facets.len() > MAX_ANSWER_FACETS
        || facets
            .iter()
            .filter(|facet| facet.kind == "subject")
            .count()
            == 0
            && mode == "comparison"
    {
        return None;
    }
    let required_facet_ids: Vec<String> = if mode == "single" {
        facets.iter().map(|facet| facet.id.clone()).collect()
    } else {
        facets
            .iter()
            .filter(|facet| facet.status == "supported")
            .map(|facet| facet.id.clone())
            .collect()
    };
    let missing_facet_ids = facets
        .iter()
        .filter(|facet| facet.status == "missing")
        .map(|facet| facet.id.clone())
        .collect::<Vec<_>>();
    let synthesis_required = mode == "comparison" && required_facet_ids.len() >= 2;
    Some(json!({
        "mode": mode,
        "facets": facets.iter().map(|facet| json!({
            "id": facet.id,
            "kind": facet.kind,
            "label": search_facets
                .iter()
                .find(|item| item.id == facet.id)
                .map_or("", |item| item.query.as_str()),
            "status": facet.status,
            "sourceIds": facet.source_ids,
        })).collect::<Vec<_>>(),
        "requiredFacetIds": required_facet_ids,
        "missingFacetIds": missing_facet_ids,
        "synthesisRequired": synthesis_required,
    }))
}

/// 검색 계획 wire를 검증하고 facet을 보존합니다.
fn parse_review_search_plan(value: &Value) -> Option<(String, Vec<ReviewSearchFacet>)> {
    let mode = value.get("mode")?.as_str()?.to_owned();
    if !matches!(mode.as_str(), "single" | "comparison") {
        return None;
    }
    let items = value.get("facets")?.as_array()?;
    if items.is_empty()
        || items.len() > MAX_ANSWER_FACETS
        || mode == "single" && items.len() != 1
        || mode == "comparison" && items.len() < 2
    {
        return None;
    }
    let mut seen = BTreeSet::new();
    let mut facets = Vec::new();
    for (position, item) in items.iter().enumerate() {
        let id = item.get("id")?.as_str()?;
        let expected_id = match position {
            0 => "question",
            1 => "subject-0",
            2 => "subject-1",
            _ => return None,
        };
        if id != expected_id || !seen.insert(id.to_owned()) {
            return None;
        }
        let kind = item.get("kind")?.as_str()?.to_owned();
        let expected_kind = if position == 0 { "question" } else { "subject" };
        if kind != expected_kind {
            return None;
        }
        let query = item.get("query")?.as_str()?.to_owned();
        if query.trim().is_empty() || query.chars().count() > MAX_QUERY_CHARS {
            return None;
        }
        let query_index = usize::try_from(item.get("queryIndex")?.as_u64()?).ok()?;
        if query_index != position || query_index > MAX_QUERY_INDEX {
            return None;
        }
        let terms = item
            .get("terms")?
            .as_array()?
            .iter()
            .map(|term| {
                term.as_str()
                    .filter(|term| !term.is_empty() && term.chars().count() <= 128)
                    .map(str::to_owned)
            })
            .collect::<Option<Vec<_>>>()?;
        if terms.len() > 64 {
            return None;
        }
        facets.push(ReviewSearchFacet {
            id: id.to_owned(),
            kind,
            query,
            query_index,
        });
    }
    Some((mode, facets))
}

/// 답변 계획 입력의 근거를 검증합니다.
fn parse_review_evidence(value: &Value) -> Option<Vec<ReviewAnswerEvidence>> {
    let items = value.as_array()?;
    if items.len() > MAX_ANSWER_EVIDENCE {
        return None;
    }
    let mut evidence = Vec::new();
    for item in items {
        let source_id = item.get("sourceId")?.as_str()?;
        let path = item.get("path")?.as_str()?;
        let quote = item.get("quote")?.as_str()?;
        if source_id.is_empty()
            || source_id.len() > 4096
            || source_id.contains("[vault:")
            || !safe_path(path)
            || quote.trim().is_empty()
            || quote.len() > 2 * 1024 * 1024
        {
            return None;
        }
        let mut query_indexes = BTreeSet::new();
        if let Some(indexes) = item.get("queryIndexes") {
            let indexes = indexes.as_array()?;
            if indexes.len() > MAX_QUERY_INDEX + 1 {
                return None;
            }
            for index in indexes {
                let index = usize::try_from(index.as_u64()?).ok()?;
                if index > MAX_QUERY_INDEX {
                    return None;
                }
                query_indexes.insert(index);
            }
        }
        evidence.push(ReviewAnswerEvidence {
            source_id: source_id.to_owned(),
            query_indexes,
        });
    }
    Some(evidence)
}

/// source ID를 입력 순서대로 중복 없이 보존합니다.
fn unique_source_ids<'a>(sources: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut output = Vec::new();
    for source in sources {
        if !output.iter().any(|item| item == source) {
            output.push(source.to_owned());
        }
    }
    output
}

/// validator가 검증한 답변 계획입니다.
struct ReviewAnswerPlan {
    /// `single`/`comparison` 모드입니다.
    mode: String,
    /// 보존할 facet 상태입니다.
    facets: Vec<ReviewAnswerPlanFacet>,
    /// 반드시 다뤄야 할 facet ID입니다.
    required_facet_ids: Vec<String>,
    /// 하나의 문단에서 여러 facet을 종합해야 하는지입니다.
    synthesis_required: bool,
}

/// validator가 검증한 답변 문단입니다.
struct ReviewAnswerParagraph {
    /// 이미 trim한 문단 본문입니다.
    text: String,
    /// 실제 source ID로 정규화한 인용 목록입니다.
    sources: Vec<String>,
    /// 이 문단이 다루는 facet ID입니다.
    covers: BTreeSet<String>,
}

/// validator가 받는 실제 source ID 목록을 검증합니다.
fn parse_answer_source_ids(value: &Value) -> Option<BTreeSet<String>> {
    let items = value.as_array()?;
    if items.len() > MAX_ANSWER_SOURCES {
        return None;
    }
    items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|source| {
                    !source.is_empty() && source.len() <= 4096 && !source.contains("[vault:")
                })
                .map(str::to_owned)
        })
        .collect()
}

/// validator 입력의 답변 계획을 검증합니다.
fn parse_review_answer_plan(value: &Value) -> Option<ReviewAnswerPlan> {
    let mode = value.get("mode")?.as_str()?.to_owned();
    if !matches!(mode.as_str(), "single" | "comparison") {
        return None;
    }
    let items = value.get("facets")?.as_array()?;
    if items.is_empty() || items.len() > MAX_ANSWER_FACETS {
        return None;
    }
    let mut seen = BTreeSet::new();
    let mut facets = Vec::new();
    for item in items {
        let id = item.get("id")?.as_str()?;
        let kind = item.get("kind")?.as_str()?;
        let label = item.get("label")?.as_str()?;
        let status = item.get("status")?.as_str()?;
        if id.is_empty()
            || id.len() > 128
            || !seen.insert(id.to_owned())
            || !matches!(kind, "question" | "subject")
            || label.trim().is_empty()
            || label.chars().count() > MAX_QUERY_CHARS
            || !matches!(status, "supported" | "missing")
        {
            return None;
        }
        let source_ids = item
            .get("sourceIds")?
            .as_array()?
            .iter()
            .map(|source| {
                source
                    .as_str()
                    .filter(|source| !source.is_empty() && !source.contains("[vault:"))
                    .map(str::to_owned)
            })
            .collect::<Option<Vec<_>>>()?;
        if source_ids.len() > MAX_ANSWER_EVIDENCE
            || status == "supported" && source_ids.is_empty()
            || status == "missing" && !source_ids.is_empty()
        {
            return None;
        }
        facets.push(ReviewAnswerPlanFacet {
            id: id.to_owned(),
            kind: kind.to_owned(),
            status: if status == "supported" {
                "supported"
            } else {
                "missing"
            },
            source_ids,
        });
    }
    if mode == "single" {
        let facet = facets.first()?;
        if facets.len() != 1 || facet.kind != "question" || facet.id != "question" {
            return None;
        }
    } else if facets.len() < 2 || facets.iter().any(|facet| facet.kind != "subject") {
        return None;
    }
    let (required_facet_ids, synthesis_required) =
        parse_review_answer_plan_contract(value, &mode, &facets)?;
    Some(ReviewAnswerPlan {
        mode,
        facets,
        required_facet_ids,
        synthesis_required,
    })
}

/// 답변 계획의 required·missing 목록과 synthesis 계약을 검증합니다.
fn parse_review_answer_plan_contract(
    value: &Value,
    mode: &str,
    facets: &[ReviewAnswerPlanFacet],
) -> Option<(Vec<String>, bool)> {
    let required_facet_ids = parse_facet_id_list(value.get("requiredFacetIds")?)?;
    let missing_facet_ids = parse_facet_id_list(value.get("missingFacetIds")?)?;
    let required = required_facet_ids.iter().cloned().collect::<BTreeSet<_>>();
    let missing = missing_facet_ids.iter().cloned().collect::<BTreeSet<_>>();
    if required.len() != required_facet_ids.len() || missing.len() != missing_facet_ids.len() {
        return None;
    }
    if mode == "single" {
        let facet = facets.first()?;
        if required != BTreeSet::from(["question".to_owned()])
            || missing.contains("question") != (facet.status == "missing")
            || missing.len() != usize::from(facet.status == "missing")
        {
            return None;
        }
    } else {
        if required.iter().any(|id| missing.contains(id))
            || required.len().saturating_add(missing.len()) != facets.len()
            || !required
                .iter()
                .chain(missing.iter())
                .all(|id| facets.iter().any(|facet| &facet.id == id))
        {
            return None;
        }
        for facet in facets {
            if required.contains(&facet.id) != (facet.status == "supported")
                || missing.contains(&facet.id) != (facet.status == "missing")
            {
                return None;
            }
        }
    }
    let synthesis_required = value.get("synthesisRequired")?.as_bool()?;
    if synthesis_required
        != (mode == "comparison"
            && facets
                .iter()
                .filter(|facet| facet.status == "supported")
                .count()
                >= 2)
    {
        return None;
    }
    Some((required_facet_ids, synthesis_required))
}

/// facet ID 배열을 중복 없는 문자열 목록으로 검증합니다.
fn parse_facet_id_list(value: &Value) -> Option<Vec<String>> {
    let items = value.as_array()?;
    if items.len() > MAX_ANSWER_FACETS {
        return None;
    }
    items
        .iter()
        .map(|item| {
            item.as_str()
                .filter(|id| !id.is_empty() && id.len() <= 128)
                .map(str::to_owned)
        })
        .collect()
}

/// 답변 문단을 실제 source ID·facet coverage로 검증합니다.
fn parse_answer_paragraphs(
    response: &str,
    plan: &ReviewAnswerPlan,
    allowed_sources: &BTreeSet<String>,
) -> Result<Vec<ReviewAnswerParagraph>, &'static str> {
    let raw = super::extract_json_object(response).ok_or("invalid-json")?;
    let value: Value = serde_json::from_str(raw).map_err(|_| "invalid-json")?;
    let items = value
        .get("paragraphs")
        .and_then(Value::as_array)
        .ok_or("invalid-paragraphs")?;
    if items.is_empty() || items.len() > MAX_ANSWER_PARAGRAPHS {
        return Err("invalid-paragraphs");
    }
    let question_id = plan
        .facets
        .iter()
        .find(|facet| facet.kind == "question")
        .map(|facet| facet.id.as_str());
    let mut paragraphs = Vec::new();
    for item in items {
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| {
                !text.is_empty()
                    && text.chars().count() <= MAX_PARAGRAPH_CHARS
                    && !text.contains("[vault:")
            })
            .ok_or("invalid-text")?;
        let references = item
            .get("sources")
            .and_then(Value::as_array)
            .ok_or("invalid-sources")?;
        if references.is_empty() || references.len() > MAX_PARAGRAPH_SOURCES {
            return Err("invalid-sources");
        }
        let sources = references
            .iter()
            .map(|reference| {
                let reference = reference.as_str().ok_or("invalid-sources")?;
                if reference.contains("[vault:") {
                    return Err("invalid-sources");
                }
                if allowed_sources.contains(reference) {
                    return Ok(reference.to_owned());
                }
                let normalized = reference
                    .strip_prefix("vault:")
                    .filter(|source| allowed_sources.contains(*source))
                    .ok_or("unknown-source")?;
                Ok(normalized.to_owned())
            })
            .collect::<Result<Vec<_>, &'static str>>()?;
        let cover_values = match item.get("covers") {
            None | Some(Value::Null) if plan.mode == "single" => None,
            Some(Value::Null) | None => return Err("invalid-covers"),
            Some(value) => Some(value.as_array().ok_or("invalid-covers")?),
        };
        let mut covers = BTreeSet::new();
        if let Some(values) = cover_values {
            if values.is_empty() || values.len() > MAX_ANSWER_FACETS {
                return Err("invalid-covers");
            }
            for value in values {
                let id = value.as_str().ok_or("invalid-covers")?;
                if !covers.insert(id.to_owned()) {
                    return Err("invalid-covers");
                }
                let facet = plan
                    .facets
                    .iter()
                    .find(|facet| facet.id == id)
                    .ok_or("unknown-facet")?;
                if facet.status != "supported" {
                    return Err("unavailable-facet");
                }
            }
        } else {
            covers.insert(question_id.ok_or("invalid-covers")?.to_owned());
        }
        let cover_facets = covers
            .iter()
            .filter_map(|id| plan.facets.iter().find(|facet| &facet.id == id))
            .collect::<Vec<_>>();
        // 추가 출처가 다른 supported facet에 속하는 것은 문단의 주장 범위를
        // 넓히지 않으므로 허용합니다. 다만 covers에 적은 각 facet에는 반드시
        // 해당 facet의 출처가 하나 이상 있어야 합니다.
        if !cover_facets.iter().all(|facet| {
            facet
                .source_ids
                .iter()
                .any(|source_id| sources.contains(source_id))
        }) {
            return Err("facet-source-mismatch");
        }
        paragraphs.push(ReviewAnswerParagraph {
            text: text.to_owned(),
            sources,
            covers,
        });
    }
    Ok(paragraphs)
}

/// 답변 계획과 문단의 facet coverage·출처·종합 계약을 검증합니다.
fn indexed_review_answer_validation(value: &Value) -> Option<Value> {
    let allowed_sources = parse_answer_source_ids(value.get("sourceIds")?)?;
    let plan = parse_review_answer_plan(value.get("answerPlan")?)?;
    if plan
        .facets
        .iter()
        .flat_map(|facet| facet.source_ids.iter())
        .any(|source| !allowed_sources.contains(source))
    {
        return Some(invalid_answer("invalid-format", &[]));
    }
    let response = value.get("response")?.as_str()?;
    let paragraphs = match parse_answer_paragraphs(response, &plan, &allowed_sources) {
        Ok(paragraphs) => paragraphs,
        Err(reason) => return Some(invalid_answer(reason, &[])),
    };
    let covered = paragraphs
        .iter()
        .flat_map(|paragraph| paragraph.covers.iter().cloned())
        .collect::<BTreeSet<_>>();
    let missing = plan
        .required_facet_ids
        .iter()
        .filter(|id| !covered.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Some(invalid_answer("missing-facet", &missing));
    }
    if plan.synthesis_required {
        let full_cover = paragraphs
            .iter()
            .filter(|paragraph| {
                plan.required_facet_ids
                    .iter()
                    .all(|id| paragraph.covers.contains(id))
            })
            .collect::<Vec<_>>();
        let synthesized = full_cover.iter().any(|paragraph| {
            plan.required_facet_ids.iter().all(|id| {
                let facet = plan.facets.iter().find(|facet| &facet.id == id);
                facet.is_some_and(|facet| {
                    facet
                        .source_ids
                        .iter()
                        .any(|source| paragraph.sources.contains(source))
                })
            })
        });
        if !synthesized {
            let missing = if full_cover.is_empty() {
                plan.required_facet_ids.clone()
            } else {
                plan.required_facet_ids
                    .iter()
                    .filter(|id| {
                        let facet = plan.facets.iter().find(|facet| &facet.id == *id);
                        !facet.is_some_and(|facet| {
                            full_cover.iter().any(|paragraph| {
                                facet
                                    .source_ids
                                    .iter()
                                    .any(|source| paragraph.sources.contains(source))
                            })
                        })
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            };
            return Some(invalid_answer("missing-synthesis", &missing));
        }
    }
    let content = paragraphs
        .iter()
        .map(|paragraph| {
            let citations = paragraph
                .sources
                .iter()
                .map(|source| format!("[{source}]"))
                .collect::<Vec<_>>()
                .join(" ");
            format!("{} {citations}", paragraph.text)
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(json!({"valid": true, "content": content}))
}

/// 검증 실패 wire를 만듭니다.
fn invalid_answer(reason: &str, missing_facet_ids: &[String]) -> Value {
    // 원문·응답 조각 대신 고정된 코드만 전달하고 기존 상위 실패 계약은 보존합니다.
    let format_issue = matches!(
        reason,
        "invalid-json"
            | "invalid-paragraphs"
            | "invalid-text"
            | "invalid-sources"
            | "unknown-source"
            | "invalid-covers"
    );
    if format_issue {
        json!({
            "valid": false,
            "reason": "invalid-format",
            "missingFacetIds": missing_facet_ids,
            "formatIssue": reason,
        })
    } else {
        json!({
            "valid": false,
            "reason": reason,
            "missingFacetIds": missing_facet_ids,
        })
    }
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
    #[test]
    fn followup_plan_keeps_listing_separate_from_search_and_accepts_legacy_arrays() {
        for (response, enumerate, count) in [
            (r#"{"queries":[],"enumerate":true}"#, true, 0),
            (
                r#"{"queries":["cooling exceptions"],"enumerate":false}"#,
                false,
                1,
            ),
            (r#"["remote conditions"]"#, false, 1),
            ("[]", false, 0),
        ] {
            let plan: serde_json::Value = serde_json::from_str(&super::plan_indexed_followup_json(
                &serde_json::json!({"question":"synthetic request", "response":response})
                    .to_string(),
            ))
            .unwrap_or(Value::Null);
            assert_eq!(plan.get("enumerate"), Some(&json!(enumerate)));
            assert_eq!(
                plan.get("variants").and_then(Value::as_array).map(Vec::len),
                Some(count)
            );
        }
        for response in [
            r#"{"queries":[],"enumerate":"yes"}"#,
            r#"{"queries":["\n"],"enumerate":true}"#,
            "not-json",
        ] {
            assert!(
                super::plan_indexed_followup_json(
                    &serde_json::json!({"question":"synthetic request", "response":response})
                        .to_string()
                )
                .is_empty()
            );
        }
    }

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

    fn comparison_search_plan() -> Value {
        json!({
            "mode": "comparison",
            "facets": [
                {"id": "question", "kind": "question", "query": "copper glass", "queryIndex": 0, "terms": ["copper", "glass"]},
                {"id": "subject-0", "kind": "subject", "query": "copper storage", "queryIndex": 1, "terms": ["copper", "storage"]},
                {"id": "subject-1", "kind": "subject", "query": "glass latency", "queryIndex": 2, "terms": ["glass", "latency"]}
            ]
        })
    }

    fn answer_plan_of(input: &Value) -> Value {
        serde_json::from_str(&plan_indexed_review_answer_plan_json(&input.to_string()))
            .unwrap_or(Value::Null)
    }

    fn validate_answer_of(input: &Value) -> Value {
        serde_json::from_str(&validate_indexed_review_answer_json(&input.to_string()))
            .unwrap_or(Value::Null)
    }

    #[test]
    fn answer_format_failures_report_only_bounded_issue_codes() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": {
                "mode": "single",
                "facets": [{"id": "question", "kind": "question", "query": "copper", "queryIndex": 0, "terms": ["copper"]}]
            },
            "evidence": [{"sourceId": "synthetic/a.md#L1-L1", "path": "synthetic/a.md", "quote": "copper"}]
        }));
        let valid_paragraph =
            json!({"text": "Copper needs a latch.", "sources": ["synthetic/a.md#L1-L1"]});
        let mut cases = vec![
            ("not json".to_owned(), "invalid-json"),
            ("{\"paragraphs\":".to_owned(), "invalid-json"),
            (json!({}).to_string(), "invalid-paragraphs"),
            (json!({"paragraphs": []}).to_string(), "invalid-paragraphs"),
            (
                json!({"paragraphs": vec![valid_paragraph.clone(); MAX_ANSWER_PARAGRAPHS + 1]})
                    .to_string(),
                "invalid-paragraphs",
            ),
        ];
        for (field, value, issue) in [
            ("text", json!(""), "invalid-text"),
            (
                "text",
                json!("[vault:synthetic/a.md#L1-L1]"),
                "invalid-text",
            ),
            (
                "text",
                json!("x".repeat(MAX_PARAGRAPH_CHARS + 1)),
                "invalid-text",
            ),
            ("sources", json!([]), "invalid-sources"),
            ("sources", json!([17]), "invalid-sources"),
            (
                "sources",
                json!(vec!["synthetic/a.md#L1-L1"; MAX_PARAGRAPH_SOURCES + 1]),
                "invalid-sources",
            ),
            (
                "sources",
                json!(["[vault:synthetic/a.md#L1-L1]"]),
                "invalid-sources",
            ),
            (
                "sources",
                json!(["synthetic/unknown.md#L1-L1"]),
                "unknown-source",
            ),
            (
                "sources",
                json!(["vault:vault:synthetic/a.md#L1-L1"]),
                "unknown-source",
            ),
            ("covers", json!([]), "invalid-covers"),
            ("covers", json!(["question", "question"]), "invalid-covers"),
            ("covers", json!(17), "invalid-covers"),
        ] {
            let mut paragraph = valid_paragraph.as_object().cloned().unwrap_or_default();
            paragraph.insert(field.to_owned(), value);
            cases.push((json!({"paragraphs": [paragraph]}).to_string(), issue));
        }
        for (response, issue) in cases {
            let validation = validate_answer_of(&json!({
                "sourceIds": ["synthetic/a.md#L1-L1"],
                "answerPlan": answer_plan,
                "response": response,
            }));
            assert_eq!(
                validation,
                json!({
                    "valid": false,
                    "reason": "invalid-format",
                    "missingFacetIds": [],
                    "formatIssue": issue,
                })
            );
        }
    }

    #[test]
    fn comparison_answer_plan_supports_both_subjects_and_requires_synthesis() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]},
                {"sourceId": "glass.md#L1-L1", "path": "glass.md", "quote": "Glass queue latency stays low.", "queryIndexes": [2]}
            ]
        }));
        assert_eq!(answer_plan.get("mode"), Some(&json!("comparison")));
        assert_eq!(
            answer_plan.pointer("/facets/0/id"),
            Some(&json!("subject-0"))
        );
        assert_eq!(
            answer_plan.pointer("/facets/0/label"),
            Some(&json!("copper storage"))
        );
        assert_eq!(
            answer_plan.pointer("/facets/0/status"),
            Some(&json!("supported"))
        );
        assert_eq!(
            answer_plan.pointer("/facets/1/status"),
            Some(&json!("supported"))
        );
        assert_eq!(
            answer_plan.get("requiredFacetIds"),
            Some(&json!(["subject-0", "subject-1"]))
        );
        assert_eq!(answer_plan.get("missingFacetIds"), Some(&json!([])));
        assert_eq!(answer_plan.get("synthesisRequired"), Some(&json!(true)));

        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1", "glass.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [{
                "text": "Copper storage and glass latency have different constraints.",
                "sources": ["copper.md#L1-L1", "glass.md#L1-L1"],
                "covers": ["subject-0", "subject-1"]
            }]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(true)));
        assert_eq!(
            validation.get("content"),
            Some(&json!(
                "Copper storage and glass latency have different constraints. [copper.md#L1-L1] [glass.md#L1-L1]"
            ))
        );
    }

    #[test]
    fn answer_plan_does_not_support_the_opposite_subject_from_a_shared_quote_term() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {
                    "sourceId": "copper.md#L1-L1",
                    "path": "copper.md",
                    "quote": "Copper and glass share a boundary.",
                    "queryIndexes": [1]
                }
            ]
        }));
        assert_eq!(
            answer_plan.pointer("/facets/0/status"),
            Some(&json!("supported"))
        );
        assert_eq!(
            answer_plan.pointer("/facets/1/status"),
            Some(&json!("missing"))
        );
        assert_eq!(answer_plan.pointer("/facets/1/sourceIds"), Some(&json!([])));
    }

    #[test]
    fn comparison_validation_rejects_incomplete_coverage() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]},
                {"sourceId": "glass.md#L1-L1", "path": "glass.md", "quote": "Glass queue latency stays low.", "queryIndexes": [2]}
            ]
        }));
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1", "glass.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [{
                "text": "Copper storage is documented.",
                "sources": ["copper.md#L1-L1"],
                "covers": ["subject-0"]
            }]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(false)));
        assert_eq!(validation.get("reason"), Some(&json!("missing-facet")));
        assert_eq!(
            validation.get("missingFacetIds"),
            Some(&json!(["subject-1"]))
        );
    }

    #[test]
    fn comparison_validation_rejects_sources_outside_the_covered_facet() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]},
                {"sourceId": "glass.md#L1-L1", "path": "glass.md", "quote": "Glass queue latency stays low.", "queryIndexes": [2]}
            ]
        }));
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1", "glass.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [{
                "text": "Copper storage is documented.",
                "sources": ["glass.md#L1-L1"],
                "covers": ["subject-0"]
            }]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(false)));
        assert_eq!(
            validation.get("reason"),
            Some(&json!("facet-source-mismatch"))
        );
    }

    #[test]
    fn comparison_validation_allows_a_supported_extra_source() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]},
                {"sourceId": "glass.md#L1-L1", "path": "glass.md", "quote": "Glass queue latency stays low.", "queryIndexes": [2]}
            ]
        }));
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1", "glass.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [
                {
                    "text": "Copper storage needs a latch.",
                    "sources": ["copper.md#L1-L1", "glass.md#L1-L1"],
                    "covers": ["subject-0"]
                },
                {
                    "text": "Glass queue latency stays low.",
                    "sources": ["glass.md#L1-L1"],
                    "covers": ["subject-1"]
                },
                {
                    "text": "The two systems are documented separately.",
                    "sources": ["copper.md#L1-L1", "glass.md#L1-L1"],
                    "covers": ["subject-0", "subject-1"]
                }
            ]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(true)));
    }

    #[test]
    fn missing_comparison_subject_is_reported_but_not_required() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]}
            ]
        }));
        assert_eq!(
            answer_plan.get("requiredFacetIds"),
            Some(&json!(["subject-0"]))
        );
        assert_eq!(
            answer_plan.get("missingFacetIds"),
            Some(&json!(["subject-1"]))
        );
        assert_eq!(answer_plan.get("synthesisRequired"), Some(&json!(false)));
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [{
                "text": "Copper storage is documented.",
                "sources": ["copper.md#L1-L1"],
                "covers": ["subject-0"]
            }]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(true)));
    }

    #[test]
    fn single_answer_plan_uses_question_coverage_when_covers_is_omitted() {
        let search_plan = json!({
            "mode": "single",
            "facets": [
                {"id": "question", "kind": "question", "query": "copper storage", "queryIndex": 0, "terms": ["copper", "storage"]}
            ]
        });
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": search_plan,
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch."}
            ]
        }));
        assert_eq!(
            answer_plan.get("requiredFacetIds"),
            Some(&json!(["question"]))
        );
        assert_eq!(answer_plan.get("synthesisRequired"), Some(&json!(false)));
        let empty_plan = answer_plan_of(&json!({
            "searchPlan": search_plan,
            "evidence": []
        }));
        assert_eq!(
            empty_plan.get("requiredFacetIds"),
            Some(&json!(["question"]))
        );
        assert_eq!(
            empty_plan.get("missingFacetIds"),
            Some(&json!(["question"]))
        );
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [{
                "text": "Copper storage needs a latch.",
                "sources": ["copper.md#L1-L1"]
            }]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(true)));
    }

    #[test]
    fn comparison_validation_rejects_multi_cover_paragraph_with_one_facet_source() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]},
                {"sourceId": "glass.md#L1-L1", "path": "glass.md", "quote": "Glass queue latency stays low.", "queryIndexes": [2]}
            ]
        }));
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1", "glass.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [{
                "text": "Copper storage and glass latency differ.",
                "sources": ["copper.md#L1-L1"],
                "covers": ["subject-0", "subject-1"]
            }]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(false)));
        assert_eq!(
            validation.get("reason"),
            Some(&json!("facet-source-mismatch"))
        );
    }

    #[test]
    fn comparison_validation_requires_one_paragraph_covering_both_sources() {
        let answer_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]},
                {"sourceId": "glass.md#L1-L1", "path": "glass.md", "quote": "Glass queue latency stays low.", "queryIndexes": [2]}
            ]
        }));
        let validation = validate_answer_of(&json!({
            "sourceIds": ["copper.md#L1-L1", "glass.md#L1-L1"],
            "answerPlan": answer_plan,
            "response": json!({"paragraphs": [
                {
                    "text": "Copper storage needs a latch.",
                    "sources": ["copper.md#L1-L1"],
                    "covers": ["subject-0"]
                },
                {
                    "text": "Glass queue latency stays low.",
                    "sources": ["glass.md#L1-L1"],
                    "covers": ["subject-1"]
                }
            ]}).to_string()
        }));
        assert_eq!(validation.get("valid"), Some(&json!(false)));
        assert_eq!(validation.get("reason"), Some(&json!("missing-synthesis")));
        assert_eq!(
            validation.get("missingFacetIds"),
            Some(&json!(["subject-0", "subject-1"]))
        );
    }

    #[test]
    fn answer_validation_distinguishes_unknown_and_unavailable_facets() {
        let missing_plan = answer_plan_of(&json!({
            "searchPlan": comparison_search_plan(),
            "evidence": [
                {"sourceId": "copper.md#L1-L1", "path": "copper.md", "quote": "Copper storage needs a latch.", "queryIndexes": [1]}
            ]
        }));
        for (cover, expected) in [
            ("question", "unknown-facet"),
            ("subject-1", "unavailable-facet"),
        ] {
            let validation = validate_answer_of(&json!({
                "sourceIds": ["copper.md#L1-L1"],
                "answerPlan": missing_plan,
                "response": json!({"paragraphs": [{
                    "text": "Copper storage is documented.",
                    "sources": ["copper.md#L1-L1"],
                    "covers": [cover]
                }]}).to_string()
            }));
            assert_eq!(validation.get("reason"), Some(&json!(expected)));
        }
    }

    #[test]
    fn answer_plan_rejects_duplicate_or_out_of_order_facets() {
        let duplicate = json!({
            "searchPlan": {"mode": "comparison", "facets": [
                {"id": "question", "kind": "question", "query": "a b", "queryIndex": 0, "terms": ["a", "b"]},
                {"id": "subject-0", "kind": "subject", "query": "a", "queryIndex": 1, "terms": ["a"]},
                {"id": "subject-0", "kind": "subject", "query": "b", "queryIndex": 2, "terms": ["b"]}
            ]},
            "evidence": []
        });
        assert!(answer_plan_of(&duplicate).is_null());
        let out_of_order = json!({
            "searchPlan": {"mode": "single", "facets": [
                {"id": "question", "kind": "question", "query": "a b", "queryIndex": 1, "terms": ["a", "b"]}
            ]},
            "evidence": []
        });
        assert!(answer_plan_of(&out_of_order).is_null());
    }

    #[test]
    fn review_search_plan_single_mode_has_only_the_question_facet() {
        let valid = json!({
            "mode": "single",
            "facets": [
                {"id": "question", "kind": "question", "query": "\"quoted phrase\"", "queryIndex": 0, "terms": ["quoted", "phrase"]}
            ]
        });
        assert!(parse_review_search_plan(&valid).is_some());
        let with_subject = json!({
            "mode": "single",
            "facets": [
                {"id": "question", "kind": "question", "query": "a b", "queryIndex": 0, "terms": ["a", "b"]},
                {"id": "subject-0", "kind": "subject", "query": "a", "queryIndex": 1, "terms": ["a"]}
            ]
        });
        assert!(parse_review_search_plan(&with_subject).is_none());
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
        assert_ne!(rows.len(), 0);
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
