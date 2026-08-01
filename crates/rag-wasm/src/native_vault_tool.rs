//! 네이티브 읽기 전용 볼트 도구 요청 계약.
//!
//! 호스트는 Obsidian I/O를 소유한다. 이 모듈은 모델이 생성한 요청을 검증하고 정규화해
//! 지원하지 않는 작업과 무제한 읽기가 호스트 경계에 도달하지 않도록 한다.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 검색 작업이 반환하는 기본 근거 후보 수.
const DEFAULT_SEARCH_LIMIT: usize = 8;
/// 검색 작업 한 번이 반환할 수 있는 최대 근거 후보 수.
const MAX_SEARCH_LIMIT: usize = 20;
/// 모델 생성 검색어 하나에 허용하는 최대 Unicode scalar 수.
const MAX_SEARCH_QUERY_CHARS: usize = 512;
/// BM25 확장 전에 허용하는 원본 lexical 질의 항목 수.
const MAX_SEARCH_QUERY_TERMS: usize = 32;
/// 검색 작업 한 번에서 평가하는 중복 제거 질의 변형 수.
const MAX_SEARCH_QUERIES: usize = 4;
/// 목록 작업이 반환하는 기본 Markdown 경로 수.
const DEFAULT_LIST_LIMIT: usize = 50;
/// 목록 작업 한 번이 반환할 수 있는 최대 Markdown 경로 수.
const MAX_LIST_LIMIT: usize = 100;
/// 링크 방향 하나에서 반환하는 기본 경로 수.
const DEFAULT_LINK_LIMIT: usize = 50;
/// 링크 방향 하나에서 반환할 수 있는 최대 경로 수.
const MAX_LINK_LIMIT: usize = 100;
/// 검색 결합 후보의 식별자에 허용하는 최대 byte 수.
const MAX_SEARCH_ENTRY_ID_BYTES: usize = 4_096;

/// 내장 읽기 전용 볼트 도구에 대한 모델 생성 요청 하나를 검증한다.
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

/// 볼트 폴더 prefix 아래의 Markdown 경로를 안정적이고 제한된 한 페이지로 선택한다.
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

/// 1부터 시작하는 포함 범위 읽기를 문서 길이와 호출별 줄 예산에 맞게 제한한다.
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

/// 구조 링크 그래프 한쪽의 경로를 정렬하고 중복 제거한 뒤 상한을 적용한다.
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

/// 읽기 전용 볼트 통계 응답을 위해 Markdown 파일 크기를 집계한다.
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

/// 여러 검색 변형의 후보를 문서별 reciprocal rank fusion 결과로 결합한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_search_rrf_json(
    candidates_json: &str,
    query_count: usize,
    limit: usize,
) -> String {
    if !(1..=MAX_SEARCH_QUERIES).contains(&query_count) || !(1..=MAX_SEARCH_LIMIT).contains(&limit)
    {
        return String::new();
    }
    let Some(candidates) = parse_search_rrf_candidates(candidates_json, query_count) else {
        return String::new();
    };
    let (hits, total_entries) = rank_search_rrf_candidates(&candidates, limit);
    serialize_search_rrf_plan(hits, total_entries)
}

/// wire 입력에서 제한된 검색 결합 후보를 파싱한다.
fn parse_search_rrf_candidates(
    candidates_json: &str,
    query_count: usize,
) -> Option<Vec<SearchRrfCandidate>> {
    let value = serde_json::from_str::<JsonValue>(candidates_json).ok()?;
    let values = value.as_array()?;
    if values.len() > query_count.saturating_mul(MAX_SEARCH_LIMIT) {
        return None;
    }
    let mut candidates = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let entry_id = object.get("entryId").and_then(JsonValue::as_str)?;
        let query_index = object
            .get("queryIndex")
            .and_then(JsonValue::as_u64)
            .and_then(|value| usize::try_from(value).ok())?;
        let rank = object
            .get("rank")
            .and_then(JsonValue::as_u64)
            .and_then(|value| usize::try_from(value).ok())?;
        if entry_id.is_empty()
            || entry_id.len() > MAX_SEARCH_ENTRY_ID_BYTES
            || query_index >= query_count
            || !(1..=MAX_SEARCH_LIMIT).contains(&rank)
        {
            return None;
        }
        candidates.push(SearchRrfCandidate {
            entry_id: entry_id.to_owned(),
            query_index,
            rank,
        });
    }
    Some(candidates)
}

/// 문서별 최상위 순위를 합쳐 안정적인 검색 결합 순서를 만든다.
fn rank_search_rrf_candidates(
    candidates: &[SearchRrfCandidate],
    limit: usize,
) -> (Vec<SearchRrfHit>, usize) {
    let mut groups = BTreeMap::<String, SearchRrfGroup>::new();
    for (candidate_index, candidate) in candidates.iter().enumerate() {
        let group = groups.entry(candidate.entry_id.clone()).or_default();
        group.candidate_indexes.push(candidate_index);
        group
            .best_rank_by_query
            .entry(candidate.query_index)
            .and_modify(|rank| *rank = (*rank).min(candidate.rank))
            .or_insert(candidate.rank);
    }

    let total_entries = groups.len();
    let mut hits = groups
        .into_iter()
        .filter_map(|(entry_id, group)| {
            let representative_candidate_index = group
                .candidate_indexes
                .iter()
                .copied()
                .min_by_key(|index| {
                    candidates
                        .get(*index)
                        .map_or((usize::MAX, usize::MAX, *index), |candidate| {
                            (candidate.rank, candidate.query_index, *index)
                        })
                })?;
            let representative = candidates.get(representative_candidate_index)?;
            let matched_query_indices =
                group.best_rank_by_query.keys().copied().collect::<Vec<_>>();
            let rrf_score = group
                .best_rank_by_query
                .values()
                .try_fold(0.0_f64, |score, rank| {
                    search_rrf_component(*rank).map(|component| score + component)
                })?;
            Some(SearchRrfHit {
                entry_id,
                candidate_indexes: group.candidate_indexes,
                representative_candidate_index,
                representative_rank: representative.rank,
                matched_query_indices,
                rrf_score,
            })
        })
        .collect::<Vec<_>>();
    hits.sort_unstable_by(|left, right| {
        right
            .rrf_score
            .total_cmp(&left.rrf_score)
            .then_with(|| {
                right
                    .matched_query_indices
                    .len()
                    .cmp(&left.matched_query_indices.len())
            })
            .then_with(|| left.representative_rank.cmp(&right.representative_rank))
            .then_with(|| left.entry_id.cmp(&right.entry_id))
            .then_with(|| {
                left.representative_candidate_index
                    .cmp(&right.representative_candidate_index)
            })
    });
    hits.truncate(limit);
    (hits, total_entries)
}

/// 단일 query 순위를 기존 정규화 RRF component로 변환한다.
fn search_rrf_component(rank: usize) -> Option<f64> {
    let rank = u32::try_from(rank).ok().map(f64::from)?;
    Some((crate::RRF_K + 1.0) / (crate::RRF_K + rank))
}

/// 결합 검색 결과를 안정적인 JSON wire 응답으로 직렬화한다.
fn serialize_search_rrf_plan(hits: Vec<SearchRrfHit>, total_entries: usize) -> String {
    let serialized_hits = hits
        .into_iter()
        .map(|hit| {
            json!({
                "candidateIndexes": hit.candidate_indexes,
                "representativeCandidateIndex": hit.representative_candidate_index,
                "matchedQueryIndices": hit.matched_query_indices,
                "rrfScore": hit.rrf_score
            })
        })
        .collect::<Vec<_>>();
    json!({ "hits": serialized_hits, "totalEntries": total_entries }).to_string()
}

/// 검색 변형 하나가 반환한 단일 순위 후보.
struct SearchRrfCandidate {
    /// 문서 또는 chunk를 안정적으로 구분하는 식별자.
    entry_id: String,
    /// 이 후보를 반환한 질의 변형의 0부터 시작하는 index.
    query_index: usize,
    /// 해당 질의 변형 안에서 1부터 시작하는 순위.
    rank: usize,
}

/// 동일한 문서 식별자에 속한 검색 변형별 최상위 순위 집계.
#[derive(Default)]
struct SearchRrfGroup {
    /// 이 문서 식별자를 가리키는 원본 후보 index.
    candidate_indexes: Vec<usize>,
    /// 질의 변형별 가장 높은 순위.
    best_rank_by_query: BTreeMap<usize, usize>,
}

/// 정렬과 wire 직렬화에 필요한 결합 검색 결과.
struct SearchRrfHit {
    /// 동점 정렬에 사용하는 문서 또는 chunk 식별자.
    entry_id: String,
    /// 이 결과에 병합된 원본 후보 index.
    candidate_indexes: Vec<usize>,
    /// 모델 표시 내용을 가져올 최상위 원본 후보 index.
    representative_candidate_index: usize,
    /// 동점 정렬에 사용하는 대표 후보의 순위.
    representative_rank: usize,
    /// 이 결과와 일치한 질의 변형 index.
    matched_query_indices: Vec<usize>,
    /// 질의 변형별 최상위 순위를 결합한 RRF 점수.
    rrf_score: f64,
}

/// 이미 파싱된 요청을 작업별 정규화 함수로 전달한다.
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

/// 검색 필드를 검증하고 제한된 기본값을 적용한다.
fn normalize_search_request(
    object: &JsonMap<String, JsonValue>,
) -> Result<JsonValue, &'static str> {
    let primary_query = required_string(object, "query", "query_required")?;
    let raw_path = optional_string(object, "path")?;
    let path = normalize_optional_path(raw_path.as_deref())?;
    let explicit_match_mode = optional_string(object, "match")?;
    let (queries, inferred_any_match) =
        normalize_search_queries(object, primary_query, explicit_match_mode.is_none())?;
    let match_mode = explicit_match_mode
        .unwrap_or_else(|| if inferred_any_match { "any" } else { "all" }.to_owned());
    if !matches!(match_mode.as_str(), "all" | "any" | "phrase") {
        return Err("invalid_match");
    }
    let Some(query) = queries.first() else {
        return Err("query_required");
    };
    let limit = normalize_limit(
        optional_usize(object, "limit")?,
        DEFAULT_SEARCH_LIMIT,
        MAX_SEARCH_LIMIT,
    );
    Ok(json!({
        "action": "search",
        "query": query,
        "queries": queries,
        "path": path,
        "limit": limit,
        "match": match_mode
    }))
}

/// 주 질의와 선택적 변형을 정규화·검증하고 중복 제거한다.
fn normalize_search_queries(
    object: &JsonMap<String, JsonValue>,
    primary_query: String,
    infer_match_mode: bool,
) -> Result<(Vec<String>, bool), &'static str> {
    let mut raw_queries = Vec::with_capacity(MAX_SEARCH_QUERIES);
    raw_queries.push(primary_query);
    raw_queries.extend(optional_string_array(object, "queries")?.unwrap_or_default());

    let mut normalized_queries = Vec::with_capacity(raw_queries.len().min(MAX_SEARCH_QUERIES));
    let mut seen = BTreeSet::new();
    let mut inferred_any_match = false;
    for raw_query in raw_queries {
        let canonical_query = normalize_query_whitespace(&raw_query);
        if canonical_query.is_empty() {
            return Err("query_required");
        }
        if canonical_query.chars().count() > MAX_SEARCH_QUERY_CHARS {
            return Err("query_too_long");
        }
        let normalized_query = if infer_match_mode {
            let (normalized, inferred_match) = normalize_implicit_search_query(canonical_query)?;
            inferred_any_match |= inferred_match == "any";
            normalized
        } else {
            canonical_query
        };
        if count_original_query_terms(&normalized_query) > MAX_SEARCH_QUERY_TERMS {
            return Err("query_too_many_terms");
        }
        let deduplication_key = normalized_query.to_lowercase();
        if seen.insert(deduplication_key) {
            normalized_queries.push(normalized_query);
        }
    }
    if normalized_queries.len() > MAX_SEARCH_QUERIES {
        return Err("query_variants_too_many");
    }
    Ok((normalized_queries, inferred_any_match))
}

/// 모델 생성 공백을 축약해 중복 질의 변형이 하나의 안정적 key를 갖게 한다.
fn normalize_query_whitespace(query: &str) -> String {
    query.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Unicode n-gram이나 식별자 확장을 곱하지 않고 원본 질의 항목을 센다.
fn count_original_query_terms(query: &str) -> usize {
    let mut count = 0_usize;
    let mut part = String::new();
    for character in query.chars() {
        if character.is_alphanumeric() || matches!(character, '_' | '-' | '/' | '\\' | '@' | '.') {
            part.push(character);
        } else {
            count = count.saturating_add(query_term_contribution(&part));
            part.clear();
        }
    }
    count.saturating_add(query_term_contribution(&part))
}

/// 원본 질의 조각 하나가 Boolean과 독립적인 검색어를 만드는지 반환한다.
fn query_term_contribution(part: &str) -> usize {
    let normalized = part
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase();
    usize::from(!normalized.is_empty() && !matches!(normalized.as_str(), "or" | "and"))
}

/// 독립된 Boolean OR 구분자를 네이티브 any-term 검색 계약으로 바꾼다.
fn normalize_implicit_search_query(query: String) -> Result<(String, String), &'static str> {
    if !query
        .split_whitespace()
        .any(|term| term.eq_ignore_ascii_case("or"))
    {
        return Ok((query, "all".to_owned()));
    }
    let compact_query = query
        .split_whitespace()
        .filter(|term| !term.eq_ignore_ascii_case("or"))
        .collect::<Vec<_>>()
        .join(" ");
    if compact_query.is_empty() {
        return Err("query_required");
    }
    Ok((compact_query, "any".to_owned()))
}

/// 제한된 부분 읽기 요청을 검증한다.
fn normalize_read_request(object: &JsonMap<String, JsonValue>) -> Result<JsonValue, &'static str> {
    let raw_path = required_string(object, "path", "path_required")?;
    let path = normalize_required_path(&raw_path)?;
    let start_line = optional_usize(object, "start_line")?.unwrap_or(1).max(1);
    let start_offset = optional_usize(object, "start_offset")?.unwrap_or(0);
    let end_line = optional_usize(object, "end_line")?;
    if end_line.is_some_and(|line| line < start_line) {
        return Err("invalid_line_range");
    }
    Ok(json!({
        "action": "read",
        "path": path,
        "startLine": start_line,
        "startOffset": start_offset,
        "endLine": end_line
    }))
}

/// 안정적으로 페이지를 나누는 목록 요청을 검증한다.
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

/// 제한된 구조 링크 순회 요청을 검증한다.
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

/// 필수 비어 있지 않은 문자열 필드 하나를 읽는다.
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

/// 기본값을 만들지 않고 선택적 문자열 필드 하나를 읽는다.
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

/// 문자열만 포함하는 선택적 배열 하나를 읽는다.
fn optional_string_array(
    object: &JsonMap<String, JsonValue>,
    key: &str,
) -> Result<Option<Vec<String>>, &'static str> {
    let Some(value) = object.get(key) else {
        return Ok(None);
    };
    let Some(values) = value.as_array() else {
        return Err("invalid_request");
    };
    values
        .iter()
        .map(|value| value.as_str().map(ToOwned::to_owned))
        .collect::<Option<Vec<_>>>()
        .map(Some)
        .ok_or("invalid_request")
}

/// `usize`로 표현할 수 있는 선택적 음이 아닌 정수 하나를 읽는다.
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

/// 작업 기본값을 적용하고 호출자가 지정한 결과 상한을 제한한다.
fn normalize_limit(limit: Option<usize>, default: usize, maximum: usize) -> usize {
    limit.unwrap_or(default).clamp(1, maximum)
}

/// 볼트 root를 빈 문자열로 사용해 선택적 볼트 경로를 정규화한다.
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

/// 볼트 상대 경로 하나를 정규화하고 traversal segment를 거부한다.
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

/// 안정적인 검증 오류 wire 응답을 직렬화한다.
fn error_response(code: &str) -> String {
    json!({ "ok": false, "error": { "code": code } }).to_string()
}

/// 문자열만 포함하는 배열을 파싱한다.
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
        plan_native_vault_read_range_json, plan_native_vault_search_rrf_json,
        plan_native_vault_stats_json,
    };

    /// 잘못된 JSON을 panic 뒤에 숨기지 않고 테스트 결과를 파싱한다.
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
    fn search_request_normalizes_and_deduplicates_bounded_query_variants() {
        let raw = plan_native_vault_tool_request_json(
            r#"{
                "action":"search",
                "query":"  Customer   Problem  ",
                "queries":["customer problem","Onboarding friction","이탈 원인","ONBOARDING   FRICTION"]
            }"#,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/request/queries"),
            Some(&serde_json::json!([
                "Customer Problem",
                "Onboarding friction",
                "이탈 원인"
            ])),
        );
    }

    #[test]
    fn search_request_rejects_more_than_four_unique_queries() {
        let raw = plan_native_vault_tool_request_json(
            r#"{
                "action":"search",
                "query":"one",
                "queries":["two","three","four","five"]
            }"#,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/error/code"),
            Some(&JsonValue::from("query_variants_too_many")),
        );
    }

    #[test]
    fn search_request_applies_query_bounds_to_every_variant() {
        let excessive_terms = (0..33)
            .map(|index| format!("term{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let raw = plan_native_vault_tool_request_json(
            &serde_json::json!({
                "action": "search",
                "query": "bounded",
                "queries": [excessive_terms]
            })
            .to_string(),
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/error/code"),
            Some(&JsonValue::from("query_too_many_terms")),
        );
    }

    #[test]
    fn search_rrf_rewards_entries_matched_by_multiple_query_variants() {
        let raw = plan_native_vault_search_rrf_json(
            r#"[
                {"entryId":"shared","queryIndex":0,"rank":4},
                {"entryId":"shared","queryIndex":1,"rank":8},
                {"entryId":"single","queryIndex":0,"rank":1}
            ]"#,
            2,
            20,
        );
        let parsed = parse_json(&raw);

        assert_eq!(parsed.pointer("/totalEntries"), Some(&JsonValue::from(2)));
        assert_eq!(
            parsed.pointer("/hits/0/matchedQueryIndices"),
            Some(&serde_json::json!([0, 1])),
        );
        assert_eq!(
            parsed.pointer("/hits/0/representativeCandidateIndex"),
            Some(&JsonValue::from(0)),
        );
    }

    #[test]
    fn search_rrf_uses_only_the_best_rank_for_duplicate_entry_query_pairs() {
        let raw = plan_native_vault_search_rrf_json(
            r#"[
                {"entryId":"same","queryIndex":0,"rank":5},
                {"entryId":"same","queryIndex":0,"rank":2},
                {"entryId":"other","queryIndex":0,"rank":3}
            ]"#,
            1,
            20,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/hits/0/candidateIndexes"),
            Some(&serde_json::json!([0, 1])),
        );
        assert_eq!(
            parsed.pointer("/hits/0/representativeCandidateIndex"),
            Some(&JsonValue::from(1)),
        );
    }

    #[test]
    fn search_rrf_rejects_candidates_outside_the_bounded_query_contract() {
        let invalid_query = plan_native_vault_search_rrf_json(
            r#"[{"entryId":"A","queryIndex":2,"rank":1}]"#,
            2,
            20,
        );
        let invalid_rank = plan_native_vault_search_rrf_json(
            r#"[{"entryId":"A","queryIndex":0,"rank":21}]"#,
            1,
            20,
        );

        assert!(invalid_query.is_empty());
        assert!(invalid_rank.is_empty());
    }

    #[test]
    fn search_request_treats_implicit_or_as_any_term_separator() {
        let raw = plan_native_vault_tool_request_json(
            r#"{"action":"search","query":"네빌 OR Neville or Goddard"}"#,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.get("request"),
            Some(&serde_json::json!({
                "action": "search",
                "query": "네빌 Neville Goddard",
                "queries": ["네빌 Neville Goddard"],
                "path": "",
                "limit": 8,
                "match": "any"
            }))
        );
    }

    #[test]
    fn search_request_preserves_explicit_match_when_query_contains_or() {
        let raw = plan_native_vault_tool_request_json(
            r#"{"action":"search","query":"Neville OR Goddard","match":"all"}"#,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/request/query"),
            Some(&JsonValue::from("Neville OR Goddard")),
        );
        assert_eq!(
            parsed.pointer("/request/match"),
            Some(&JsonValue::from("all")),
        );
    }

    #[test]
    fn search_request_does_not_treat_or_inside_a_word_as_separator() {
        let raw = plan_native_vault_tool_request_json(
            r#"{"action":"search","query":"Goddard organization"}"#,
        );
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/request/query"),
            Some(&JsonValue::from("Goddard organization")),
        );
        assert_eq!(
            parsed.pointer("/request/match"),
            Some(&JsonValue::from("all")),
        );
    }

    #[test]
    fn search_request_rejects_query_containing_only_or_separators() {
        let raw = plan_native_vault_tool_request_json(r#"{"action":"search","query":"OR or Or"}"#);
        let parsed = parse_json(&raw);

        assert_eq!(
            parsed.pointer("/error/code"),
            Some(&JsonValue::from("query_required")),
        );
    }

    #[test]
    fn search_request_rejects_unbounded_query_length_and_original_term_count() {
        let long_query = "가".repeat(513);
        let long_raw = plan_native_vault_tool_request_json(
            &serde_json::json!({ "action": "search", "query": long_query }).to_string(),
        );
        assert_eq!(
            parse_json(&long_raw).pointer("/error/code"),
            Some(&JsonValue::from("query_too_long")),
        );

        let excessive_terms = (0..33)
            .map(|index| format!("term{index}"))
            .collect::<Vec<_>>()
            .join(",");
        let excessive_raw = plan_native_vault_tool_request_json(
            &serde_json::json!({ "action": "search", "query": excessive_terms }).to_string(),
        );
        assert_eq!(
            parse_json(&excessive_raw).pointer("/error/code"),
            Some(&JsonValue::from("query_too_many_terms")),
        );

        let bounded_terms = (0..32)
            .map(|index| format!("term{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let bounded_raw = plan_native_vault_tool_request_json(
            &serde_json::json!({ "action": "search", "query": bounded_terms }).to_string(),
        );
        assert_eq!(
            parse_json(&bounded_raw).pointer("/request/match"),
            Some(&JsonValue::from("all")),
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
