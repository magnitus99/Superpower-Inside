//! 선택한 채팅 모델과 독립적인 제한된 원문 수집 계획입니다.

use serde_json::{Value, json};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

#[path = "evidence_review.rs"]
mod review;

use super::{
    agentic_tool_policy::{needs_content_evidence, requires_multiple_source_evidence},
    research_contract::append_meaningful_tokens,
};

/// 공통 수집 단계가 허용하는 전체 I/O 상한입니다.
const MAX_CALLS: usize = 48;
/// 여러 명시 범위와 질문 구절을 보존하는 초기 검색 큐의 안전 상한입니다.
const MAX_SEARCHES: usize = 64;
/// 원문 결과가 대화 예산을 독점하지 않게 하는 누적 전송 상한입니다.
const MAX_RESULT_BYTES: usize = 192 * 1024;
/// 같은 모델에 허용하는 의미적 공백 검토 횟수입니다.
const MAX_REVIEWS: usize = 3;
/// 계획 bridge 호출 하나가 받는 `JSON` byte 상한입니다.
const MAX_PLAN_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// 검색 계획 질문 하나의 byte 상한입니다.
const MAX_SEARCH_PLAN_QUESTION_BYTES: usize = 16_384;
/// 검색 계획이 받는 명시 범위 수 상한입니다.
const MAX_SEARCH_PLAN_SCOPES: usize = 64;
/// 검색 계획 query 하나의 안전 상한(문자 수)입니다.
const MAX_SEARCH_QUERY_CHARS: usize = 320;
/// 기존 하이브리드 검색 도구 이름입니다.
const SEARCH: &str = "superpower_inside_search";
/// 기존 원문 읽기 도구 이름입니다.
const READ: &str = "superpower_inside_read";
/// 기존 문서 기반 관련 자료 검색 도구 이름입니다.
const RELATED: &str = "superpower_inside_related";

/// 검색 결과의 순위를 유지하며 원문 문맥을 읽을 위치입니다.
struct Passage {
    /// 검증할 볼트 상대 경로입니다.
    path: String,
    /// 후보의 시작 행입니다.
    start: u64,
    /// 후보의 마지막 행입니다.
    end: u64,
}

/// 원문 수집의 다음 읽기 전용 호출을 결정합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_evidence_collection_json(input: &str) -> String {
    if input.len() > MAX_PLAN_INPUT_BYTES {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(input) else {
        return String::new();
    };
    collection_plan(&value).map_or_else(String::new, |plan| plan.to_string())
}

/// 질문을 단일 검색 또는 비교 대상별 검색 facet으로 계획합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_search_queries_json(input: &str) -> String {
    if input.len() > MAX_PLAN_INPUT_BYTES {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(input) else {
        return String::new();
    };
    search_query_plan(&value).map_or_else(String::new, |plan| plan.to_string())
}

/// 검증한 수집 입력과 실행 결과입니다.
struct CollectionState<'a> {
    /// 현재 질문입니다.
    question: &'a str,
    /// 사용자가 허용한 폴더 범위입니다.
    scopes: Vec<&'a str>,
    /// 실행한 도구 기록입니다.
    calls: &'a [Value],
    /// 원문 계약이 맞는 결과만 남깁니다.
    results: Vec<Option<Value>>,
    /// 질문 구절과 명시 범위를 함께 보존한 기본 검색입니다.
    probes: Vec<Value>,
    /// 같은 provider의 구조화 판정 기록입니다.
    reviews: &'a [Value],
    /// 원문 대조를 통과한 마지막 판정입니다.
    review: review::ReviewState,
    /// 질문과 범위 수에 비례하는 전체 I/O 예산입니다.
    max_calls: usize,
}

/// 호스트 경계와 진행 상태를 확인합니다.
fn collection_state(input: &Value) -> Option<CollectionState<'_>> {
    let question = input.get("question")?.as_str()?;
    if question.len() > 16_384 {
        return None;
    }
    let scopes = input
        .get("scopes")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if scopes.len() > 64 || scopes.iter().any(|scope| !valid_path(scope)) {
        return None;
    }
    let calls = input.get("toolCalls")?.as_array()?.as_slice();
    if calls.len() > MAX_CALLS {
        return None;
    }
    let probes = search_probes(question, &scopes);
    let results = calls.iter().map(valid_result).collect::<Vec<_>>();
    let reviews = input
        .get("reviews")
        .map_or(Some(&[][..]), |value| value.as_array().map(Vec::as_slice))?;
    if reviews.len() > MAX_REVIEWS {
        return None;
    }
    let facets = probe_facets(&probes);
    let review = review::review_state(reviews, &results, &scopes, &facets);
    let max_calls = probes
        .len()
        .saturating_add(review::prior_checks(reviews).len())
        .saturating_mul(4)
        .saturating_add(4)
        .clamp(12, MAX_CALLS);
    Some(CollectionState {
        question,
        scopes,
        calls,
        results,
        probes,
        reviews,
        review,
        max_calls,
    })
}

/// 검색·원문·모델 판정을 구분해 다음 처리를 선택합니다.
fn collection_plan(input: &Value) -> Option<Value> {
    let state = collection_state(input)?;
    if state.probes.is_empty() {
        return Some(state.finish("empty-question", None));
    }
    if !needs_content_evidence(state.question) {
        return Some(state.finish("not-content", None));
    }
    if input.get("budgetExpired").and_then(Value::as_bool) == Some(true) {
        return Some(state.finish("time-budget", None));
    }
    if state.calls.len() >= state.max_calls {
        return Some(state.finish("budget", None));
    }
    if state
        .calls
        .iter()
        .filter_map(|call| call.get("result").and_then(Value::as_str))
        .map(str::len)
        .sum::<usize>()
        >= MAX_RESULT_BYTES
    {
        return Some(state.finish("context-budget", None));
    }
    if state.calls.len() >= 2 && state.results.iter().rev().take(2).all(Option::is_none) {
        return Some(state.finish("failed", None));
    }
    // 검색 직후 원문을 읽어 발견한 조건을 다음 검색이나 판정에 전달합니다.
    if let Some(next) = continuation_call(&state).or_else(|| read_latest_search(&state)) {
        return Some(state.finish("collecting", Some(&next)));
    }
    for probe in &state.probes {
        if !attempted(state.calls, SEARCH, probe) {
            return Some(state.finish("collecting", Some(&next_call(SEARCH, probe))));
        }
    }
    if state.review.coverage == "supported" {
        return Some(state.finish("supported", None));
    }
    if !state.reviews.is_empty() {
        for query in &state.review.gaps {
            for scope in search_scopes(&state.scopes) {
                let args = search_args(query, scope);
                if !attempted(state.calls, SEARCH, &args) {
                    return Some(state.finish("collecting", Some(&next_call(SEARCH, &args))));
                }
            }
        }
    }
    if input.get("reviewEnabled").and_then(Value::as_bool) == Some(true)
        && state.reviews.len() < MAX_REVIEWS
        && state.review.after_calls < state.calls.len()
        && !review::evidence_rows(&state.results, &state.scopes).is_empty()
    {
        let mut plan = state.finish("reviewing", None);
        let object = plan.as_object_mut()?;
        object.insert("done".to_owned(), json!(false));
        object.insert("reviewRequest".to_owned(), json!(json!({"question":state.question,"facets":probe_facets(&state.probes),"priorChecks":review::prior_checks(state.reviews),"evidence":review::evidence_rows(&state.results,&state.scopes)}).to_string()));
        return Some(plan);
    }
    if let Some(next) = next_source_call(&state) {
        return Some(state.finish("collecting", Some(&next)));
    }
    if state.calls.len() >= state.probes.len().saturating_add(2) {
        let before = state.results.get(..state.results.len().saturating_sub(2))?;
        if verified_ranges(before, &state.scopes) == verified_ranges(&state.results, &state.scopes)
        {
            return Some(state.finish("no-progress", None));
        }
    }
    Some(state.finish(
        if verified_ranges(&state.results, &state.scopes).is_empty() {
            "no-evidence"
        } else {
            "exhausted"
        },
        None,
    ))
}

impl CollectionState<'_> {
    /// 종료 이유와 미해결 항목을 최종 답변까지 전달합니다.
    fn finish(&self, reason: &str, next: Option<&Value>) -> Value {
        let ranges = verified_ranges(&self.results, &self.scopes);
        json!({"done":next.is_none(),"reason":reason,"nextCall":next,"reviewRequest":null,
            "verifiedSources":ranges.iter().map(|(path,_,_)|path).collect::<BTreeSet<_>>().len(),
            "contextReads":self.calls.iter().filter(|call| call.get("name") == Some(&json!(READ))).count(),
            "searchProbes":self.probes.len(),"maxCalls":self.max_calls,"coverage":self.review.coverage,"unresolved":self.review.gaps})
    }
}

/// 동일한 입력을 다시 실행하지 않습니다.
fn attempted(calls: &[Value], name: &str, arguments: &Value) -> bool {
    calls.iter().any(|call| {
        call.get("name").and_then(Value::as_str) == Some(name)
            && call
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|args| serde_json::from_str::<Value>(args).ok())
                .is_some_and(|previous| same_arguments(name, &previous, arguments))
    })
}

/// 대소문자나 공백만 바꾼 검색은 같은 시도로 취급합니다.
fn same_arguments(name: &str, left: &Value, right: &Value) -> bool {
    if name != SEARCH {
        return left == right;
    }
    let normalized_query = |value: &Value| {
        value
            .get("query")
            .and_then(Value::as_str)
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    left.get("path") == right.get("path") && normalized_query(left) == normalized_query(right)
}

/// 원래 질문의 기본 항목을 모델 판정이 누락하지 않도록 보존합니다.
fn probe_facets(probes: &[Value]) -> Vec<String> {
    let mut facets = Vec::new();
    for probe in probes {
        if let Some(query) = probe.get("query").and_then(Value::as_str)
            && !facets.iter().any(|facet| facet == query)
        {
            facets.push(query.to_owned());
        }
    }
    facets
}

/// 직전 검색의 상위 미확인 구간을 선택합니다.
fn read_latest_search(state: &CollectionState<'_>) -> Option<Value> {
    let result = state.results.last()?.as_ref()?;
    if result.get("action").and_then(Value::as_str) == Some("read") {
        return None;
    }
    ranked_passages(&[Some(result.clone())], &state.scopes)
        .iter()
        .find_map(|passage| read_passage(state, passage))
}

/// 원문 구간 단위로 중복 읽기를 피합니다.
fn read_passage(state: &CollectionState<'_>, passage: &Passage) -> Option<Value> {
    if verified_ranges(&state.results, &state.scopes)
        .iter()
        .any(|(path, start, end)| {
            path == &passage.path && *start <= passage.start && *end >= passage.end
        })
        && state.results.iter().flatten().any(|result| {
            result.get("action").and_then(Value::as_str) == Some("read")
                && result.get("path").and_then(Value::as_str) == Some(passage.path.as_str())
                && result
                    .get("startLine")
                    .and_then(Value::as_u64)
                    .is_some_and(|start| start <= passage.start)
                && result
                    .get("endLine")
                    .and_then(Value::as_u64)
                    .is_some_and(|end| end >= passage.end)
        })
    {
        return None;
    }
    let start = passage.start.saturating_sub(8).max(1);
    let args = json!({"path":passage.path,"start_line":start,"end_line":passage.end.saturating_add(16).min(start.saturating_add(79))});
    (!attempted(state.calls, READ, &args)).then(|| next_call(READ, &args))
}

/// 길이 제한으로 잘린 원문은 호스트가 반환한 위치에서 이어 읽습니다.
fn continuation_call(state: &CollectionState<'_>) -> Option<Value> {
    let result = state.results.last()?.as_ref()?;
    if result.get("action")? != "read" || !result.get("truncated")?.as_bool()? {
        return None;
    }
    let path = result.get("path")?.as_str()?;
    let start = result.get("nextStartLine")?.as_u64()?.max(1);
    let mut args = json!({"path":path,"start_line":start,"end_line":start.saturating_add(79)});
    if !in_scope(path, &state.scopes) {
        return None;
    }
    if let Some(offset) = result.get("nextStartOffset").and_then(Value::as_u64) {
        args.as_object_mut()?
            .insert("start_offset".to_owned(), json!(offset));
    }
    (!attempted(state.calls, READ, &args)).then(|| next_call(READ, &args))
}

/// 미확인 구간과 관련 문서를 전체 예산 안에서 추가합니다.
fn next_source_call(state: &CollectionState<'_>) -> Option<Value> {
    let passages = ranked_passages(&state.results, &state.scopes);
    if let Some(next) = passages
        .iter()
        .find_map(|passage| read_passage(state, passage))
    {
        return Some(next);
    }
    // related 도구는 범위를 받지 않으므로 원문 시드를 범위가 있는 검색으로 전달합니다.
    if !state.scopes.is_empty() {
        for result in state.results.iter().flatten() {
            if result.get("action").and_then(Value::as_str) != Some("read")
                || !result
                    .get("path")
                    .and_then(Value::as_str)
                    .is_some_and(|path| in_scope(path, &state.scopes))
            {
                continue;
            }
            let Some(content) = result.get("content").and_then(Value::as_str) else {
                continue;
            };
            for probe in search_probes(content, &state.scopes) {
                if !attempted(state.calls, SEARCH, &probe) {
                    return Some(next_call(SEARCH, &probe));
                }
            }
        }
    }
    if state.calls.len() >= 2 {
        let before = state.results.get(..state.results.len().saturating_sub(2))?;
        if verified_ranges(before, &state.scopes) == verified_ranges(&state.results, &state.scopes)
            && ranked_passages(before, &state.scopes).len() == passages.len()
        {
            return None;
        }
    }
    if state.scopes.is_empty() {
        for seed in &passages {
            let args = json!({"path":seed.path,"limit":6});
            if !attempted(state.calls, RELATED, &args) {
                return Some(next_call(RELATED, &args));
            }
        }
    }
    None
}

/// 명시한 폴더 밖으로 검색 범위를 넓히지 않습니다.
fn search_scopes<'a>(scopes: &'a [&'a str]) -> Vec<&'a str> {
    if scopes.is_empty() {
        vec![""]
    } else {
        scopes.to_vec()
    }
}

/// 초기 검색과 부족 항목 검색은 같은 하이브리드 계약을 사용합니다.
fn search_args(query: &str, path: &str) -> Value {
    json!({"query":query,"path":path,"limit":8,"mode":"auto","match":"any"})
}

/// 비교 probe와 계획 facet이 함께 쓰는 검색 토큰 정규화입니다.
fn focused_search_query(text: &str, limit: usize) -> String {
    let mut tokens = Vec::new();
    append_meaningful_tokens(&mut tokens, text);
    tokens.retain(|token| {
        ![
            "compare",
            "comparison",
            "and",
            "versus",
            "difference",
            "differences",
            "similarities",
            "explain",
            "between",
            "공통점",
            "차이",
            "차이점",
            "비교",
            "설명",
            "설명해줘",
            "비교해줘",
            "다른",
            "같은",
        ]
        .contains(&token.as_str())
    });
    tokens
        .into_iter()
        .take(limit)
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_SEARCH_QUERY_CHARS)
        .collect::<String>()
}

/// 비교 subject 끝에 붙은 한국어 주제·주격 조사를 제거합니다.
fn subject_search_query(text: &str) -> String {
    focused_search_query(korean_subject_head(text), 12)
}

/// 문장 안에서 주제·주격 조사가 공백 앞에 붙은 첫 지점까지를 subject로 자릅니다.
fn korean_subject_head(text: &str) -> &str {
    for (index, character) in text.char_indices() {
        if !matches!(character, '는' | '은' | '이' | '가') {
            continue;
        }
        let end = index.saturating_add(character.len_utf8());
        if text
            .get(end..)
            .and_then(|suffix| suffix.chars().next())
            .is_none_or(char::is_whitespace)
        {
            return text.get(..index).unwrap_or(text);
        }
    }
    text
}

/// 기존 비교 probe 분할에서 subject 정체성을 순서대로 보존합니다.
fn comparison_subject_queries(question: &str) -> Vec<String> {
    let normalized = question.to_lowercase();
    let interpretation = [
        "어떻게 해석",
        "해석하고",
        "해석은",
        "입장",
        "관점",
        "어떻게 보",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    if !requires_multiple_source_evidence(question) && !interpretation {
        return Vec::new();
    }
    let mut delimiters = Vec::<(usize, usize)>::new();
    for delimiter in [
        " versus ", " vs ", " and ", " 및 ", "와 ", "과 ", "와의 ", "과의 ",
    ] {
        for (start, _) in question.char_indices() {
            let Some(end) = start.checked_add(delimiter.len()) else {
                continue;
            };
            let Some(candidate) = question.get(start..end) else {
                continue;
            };
            if candidate.eq_ignore_ascii_case(delimiter) && !inside_quotes(question, start, end) {
                delimiters.push((start, end));
            }
        }
    }
    delimiters.sort_by(|left, right| {
        left.0.cmp(&right.0).then_with(|| {
            right
                .1
                .saturating_sub(right.0)
                .cmp(&left.1.saturating_sub(left.0))
        })
    });
    let mut selected = Vec::<(usize, usize)>::new();
    for delimiter in delimiters {
        if selected
            .last()
            .is_some_and(|(_, previous_end)| delimiter.0 < *previous_end)
        {
            continue;
        }
        selected.push(delimiter);
        if selected.len() == 2 {
            break;
        }
    }
    if selected.is_empty() {
        return Vec::new();
    }
    let mut parts = Vec::new();
    let mut start = 0_usize;
    for (delimiter_start, delimiter_end) in selected {
        parts.push(question[start..delimiter_start].trim());
        start = delimiter_end;
    }
    parts.push(question[start..].trim());
    parts
        .into_iter()
        .map(subject_search_query)
        .filter(|query| !query.is_empty())
        .take(2)
        .collect()
}

/// 비교 구분자가 따옴표 안의 구문 일부인지 확인합니다.
fn inside_quotes(text: &str, start: usize, end: usize) -> bool {
    let bytes = text.as_bytes();
    let mut quoted = false;
    let mut escaped = false;
    for (index, byte) in bytes.iter().enumerate() {
        let in_range = index >= start && index < end;
        if in_range && quoted {
            return true;
        }
        if *byte == b'"' && !escaped {
            quoted = !quoted;
        }
        escaped = *byte == b'\\' && !escaped;
        if *byte != b'\\' {
            escaped = false;
        }
    }
    false
}

/// 비교 구절을 독립 검색 입력으로 사용해 모델의 번역·분해에만 의존하지 않습니다.
fn search_probes(question: &str, scopes: &[&str]) -> Vec<Value> {
    let main = focused_search_query(question, 12);
    if main.is_empty() {
        return Vec::new();
    }
    let mut queries = vec![main];
    for query in comparison_subject_queries(question) {
        if !queries.contains(&query) {
            queries.push(query);
        }
    }
    let paths = search_scopes(scopes);
    queries
        .iter()
        .flat_map(|query| paths.iter().map(move |path| search_args(query, path)))
        .take(MAX_SEARCHES)
        .collect()
}

/// 검색 입력을 검증하고 메인 질문과 최대 두 비교 subject facet을 만듭니다.
fn search_query_plan(value: &Value) -> Option<Value> {
    let question = value.get("question")?.as_str()?;
    if question.len() > MAX_SEARCH_PLAN_QUESTION_BYTES || question.trim().is_empty() {
        return None;
    }
    let scoring_question = match value.get("scoringQuestion") {
        None | Some(Value::Null) => None,
        Some(item) => Some(item.as_str()?),
    };
    if scoring_question
        .is_some_and(|text| text.len() > MAX_SEARCH_PLAN_QUESTION_BYTES || text.trim().is_empty())
    {
        return None;
    }
    let scopes = match value.get("scopes") {
        None => &[][..],
        Some(Value::Null) => return None,
        Some(item) => item.as_array()?.as_slice(),
    };
    if scopes.len() > MAX_SEARCH_PLAN_SCOPES {
        return None;
    }
    let scopes = scopes
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if scopes.iter().any(|scope| !valid_path(scope)) {
        return None;
    }
    let main = scoring_question
        .unwrap_or(question)
        .trim()
        .chars()
        .take(MAX_SEARCH_QUERY_CHARS)
        .collect::<String>();
    let subjects = comparison_subject_queries(question);
    let comparison = subjects.len() >= 2;
    let queries = if comparison {
        std::iter::once(main)
            .chain(subjects.into_iter().take(2))
            .collect::<Vec<_>>()
    } else {
        vec![main]
    };
    let facets = queries
        .iter()
        .enumerate()
        .map(|(query_index, query)| {
            let mut terms = Vec::new();
            append_meaningful_tokens(&mut terms, query);
            let (id, kind) = if query_index == 0 {
                ("question", "question")
            } else {
                (
                    if query_index == 1 {
                        "subject-0"
                    } else {
                        "subject-1"
                    },
                    "subject",
                )
            };
            json!({"id":id,"kind":kind,"query":query,"queryIndex":query_index,"terms":terms})
        })
        .collect::<Vec<_>>();
    Some(json!({
        "mode": if comparison { "comparison" } else { "single" },
        "facets": facets,
    }))
}

/// 원문이 없는 저장 요약이나 행동이 일치하지 않는 결과는 근거로 세지 않습니다.
fn valid_result(call: &Value) -> Option<Value> {
    if call.get("status").unwrap_or(&Value::Null) != "success" {
        return None;
    }
    let expected = match call.get("name").unwrap_or(&Value::Null).as_str()? {
        SEARCH => "search",
        READ => "read",
        RELATED => "related",
        _ => return None,
    };
    let result: Value = serde_json::from_str(call.get("result")?.as_str()?).ok()?;
    if result.get("action").unwrap_or(&Value::Null) != expected
        || result.get("kind").unwrap_or(&Value::Null) == "tool-result-summary"
    {
        return None;
    }
    Some(result)
}

/// 기존 도구 실행기가 받을 wire 요청을 만듭니다.
fn next_call(name: &str, arguments: &Value) -> Value {
    json!({"name":name,"arguments":arguments.to_string()})
}

/// 상대 경로만 허용하며 명시 범위를 다른 폴더로 넓히지 않습니다.
fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.starts_with('/')
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// 요청된 폴더의 실제 하위 경로인지 확인합니다.
fn in_scope(path: &str, scopes: &[&str]) -> bool {
    valid_path(path)
        && (scopes.is_empty()
            || scopes.iter().any(|scope| {
                path.strip_prefix(scope)
                    .is_some_and(|suffix| suffix.starts_with('/'))
            }))
}

/// 검색별 상위 후보를 번갈아 읽어 첫 검색의 편향을 줄입니다.
fn ranked_passages(results: &[Option<Value>], scopes: &[&str]) -> Vec<Passage> {
    let groups = results
        .iter()
        .flatten()
        .filter_map(|result| result.get("hits").unwrap_or(&Value::Null).as_array())
        .collect::<Vec<_>>();
    let mut seen = BTreeSet::new();
    let mut passages = Vec::new();
    for rank in 0..20 {
        for hits in &groups {
            let Some(hit) = hits.get(rank) else {
                continue;
            };
            let Some(path) = hit
                .get("path")
                .unwrap_or(&Value::Null)
                .as_str()
                .filter(|path| in_scope(path, scopes))
            else {
                continue;
            };
            let Some(start) = hit
                .get("startLine")
                .unwrap_or(&Value::Null)
                .as_u64()
                .filter(|start| *start > 0)
            else {
                continue;
            };
            let end = hit
                .get("endLine")
                .and_then(Value::as_u64)
                .unwrap_or(start)
                .max(start);
            if seen.insert((path.to_owned(), start, end)) {
                passages.push(Passage {
                    path: path.to_owned(),
                    start,
                    end,
                });
            }
        }
    }
    passages
}

/// 검증된 비어 있지 않은 원문과 정확한 위치만 진행으로 셉니다.
fn verified_ranges(results: &[Option<Value>], scopes: &[&str]) -> BTreeSet<(String, u64, u64)> {
    let mut ranges = BTreeSet::new();
    for result in results.iter().flatten() {
        if result.get("action").unwrap_or(&Value::Null) == "read" {
            insert_range(&mut ranges, result, "content", scopes);
        } else if let Some(hits) = result.get("hits").unwrap_or(&Value::Null).as_array() {
            for hit in hits {
                if hit.get("citationStatus").unwrap_or(&Value::Null) == "verified"
                    && hit.get("requiresRead").unwrap_or(&Value::Null) != true
                {
                    insert_range(&mut ranges, hit, "preview", scopes);
                }
            }
        }
    }
    ranges
}

/// 원문이 비어 있지 않고 유효한 범위일 때만 진행 집합에 넣습니다.
fn insert_range(
    ranges: &mut BTreeSet<(String, u64, u64)>,
    value: &Value,
    text_key: &str,
    scopes: &[&str],
) {
    if value[text_key]
        .as_str()
        .is_none_or(|text| text.trim().is_empty())
    {
        return;
    }
    let Some(path) = value
        .get("path")
        .unwrap_or(&Value::Null)
        .as_str()
        .filter(|path| in_scope(path, scopes))
    else {
        return;
    };
    if let (Some(start), Some(end)) = (
        value.get("startLine").unwrap_or(&Value::Null).as_u64(),
        value.get("endLine").unwrap_or(&Value::Null).as_u64(),
    ) && start > 0
        && end >= start
    {
        ranges.insert((path.to_owned(), start, end));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, arguments: &Value, result: &Value) -> Value {
        json!({"name": name, "arguments": arguments.to_string(), "status":"success", "result":result.to_string()})
    }

    #[test]
    fn comparison_reads_the_first_result_before_exhausting_search_probes() {
        let probe = search_probes(
            "Compare copper storage and glass queue latency",
            &["Research"],
        );
        let result = plan(&json!([call(
            SEARCH,
            probe.first().unwrap_or(&Value::Null),
            &json!({"action":"search","hits":[{"path":"Research/Seed.md","startLine":10,"endLine":12,"preview":"candidate","requiresRead":true}]})
        )]));
        assert_eq!(result.pointer("/nextCall/name"), Some(&json!(READ)));
    }

    #[test]
    fn another_range_in_the_same_document_remains_a_read_candidate() {
        let probes = search_probes(
            "Compare copper storage and glass queue latency",
            &["Research"],
        );
        let mut calls = probes.iter().map(|probe| call(SEARCH, probe, &json!({"action":"search","hits":[
            {"path":"Research/Seed.md","startLine":10,"endLine":12,"preview":"first","requiresRead":true},
            {"path":"Research/Seed.md","startLine":300,"endLine":302,"preview":"exception","requiresRead":true}
        ]}))).collect::<Vec<_>>();
        calls.push(call(READ, &json!({"path":"Research/Seed.md","start_line":2,"end_line":28}), &json!({"action":"read","path":"Research/Seed.md","startLine":2,"endLine":28,"content":"first"})));
        let result = plan(&json!(calls));
        let args: Value = serde_json::from_str(
            result
                .pointer("/nextCall/arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}"),
        )
        .unwrap_or(Value::Null);
        assert_eq!(result.pointer("/nextCall/name"), Some(&json!(READ)));
        assert_eq!(args.get("start_line"), Some(&json!(292)));
    }

    #[test]
    fn incomplete_review_searches_the_gap_instead_of_counting_documents() {
        let calls = json!([
            call(
                SEARCH,
                &json!({"query":"copper","path":"Research","mode":"auto","match":"any","limit":8}),
                &json!({"action":"search","hits":[]})
            ),
            call(
                READ,
                &json!({"path":"Research/Seed.md"}),
                &json!({"action":"read","path":"Research/Seed.md","startLine":1,"endLine":3,"content":"Copper uses a latch."})
            )
        ]);
        let input = json!({"question":"copper","scopes":["Research"],"toolCalls":calls,"reviewEnabled":true,"reviews":[{"afterCalls":2,"content":json!({"checks":[{"question":"failure conditions","status":"missing","query":"copper latch failure conditions","evidence":[]}]}).to_string()}]});
        let result: Value =
            serde_json::from_str(&plan_evidence_collection_json(&input.to_string()))
                .unwrap_or(Value::Null);
        let args: Value = serde_json::from_str(
            result
                .pointer("/nextCall/arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}"),
        )
        .unwrap_or(Value::Null);
        assert_eq!(
            args.get("query"),
            Some(&json!("copper latch failure conditions"))
        );
        assert_eq!(result.get("coverage"), Some(&json!("incomplete")));
    }

    #[test]
    fn unsupported_review_cannot_declare_sufficient_evidence() {
        let input = json!({"question":"copper","scopes":["Research"],"toolCalls":[],"reviewEnabled":true,"reviews":[{"afterCalls":0,"content":json!({"checks":[{"question":"copper","status":"supported","evidence":[{"id":"e0","quote":"fabricated evidence"}]}]}).to_string()}]});
        let result: Value =
            serde_json::from_str(&plan_evidence_collection_json(&input.to_string()))
                .unwrap_or(Value::Null);
        assert_eq!(result.get("coverage"), Some(&json!("invalid-review")));
        assert_ne!(result.get("reason"), Some(&json!("supported")));
    }

    #[test]
    fn supported_review_requires_every_baseline_facet_and_an_exact_original_quote() {
        let calls = json!([
            call(
                SEARCH,
                &search_args("copper", "Research"),
                &json!({"action":"search","hits":[]})
            ),
            call(
                READ,
                &json!({"path":"Research/Seed.md"}),
                &json!({"action":"read","path":"Research/Seed.md","startLine":1,"endLine":3,"content":"Copper uses a latch."})
            )
        ]);
        for (quote, expected) in [
            ("Copper uses a latch.", "supported"),
            ("Copper never fails.", "invalid-review"),
        ] {
            let input = json!({"question":"copper","scopes":["Research"],"toolCalls":calls,"reviewEnabled":true,"reviews":[{"afterCalls":2,"content":json!({"checks":[{"facetId":0,"question":"copper","status":"supported","evidence":[{"id":"r1","quote":quote}]}]}).to_string()}]});
            let result: Value =
                serde_json::from_str(&plan_evidence_collection_json(&input.to_string()))
                    .unwrap_or(Value::Null);
            assert_eq!(result.get("coverage"), Some(&json!(expected)));
        }
    }

    #[test]
    fn a_later_review_cannot_erase_a_discovered_gap() {
        let reviews = json!([
            {"afterCalls":0,"content":json!({"checks":[{"facetId":null,"question":"recovery condition","status":"missing","query":"quartz recovery"}]}).to_string()},
            {"afterCalls":1,"content":json!({"checks":[{"facetId":0,"question":"copper","status":"supported","evidence":[{"id":"r0","quote":"Copper uses a latch."}]}]}).to_string()}
        ]);
        let results = vec![Some(
            json!({"action":"read","path":"Research/Seed.md","startLine":1,"endLine":3,"content":"Copper uses a latch."}),
        )];
        let state = review::review_state(
            reviews.as_array().map_or(&[][..], Vec::as_slice),
            &results,
            &["Research"],
            &["copper".to_owned()],
        );
        assert_eq!(state.coverage, "incomplete");
        assert!(state.gaps.contains(&"recovery condition".to_owned()));
    }

    #[test]
    fn truncated_text_preserves_the_exact_continuation_offset() {
        let result = plan(&json!([call(
            READ,
            &json!({"path":"Research/Seed.md","start_line":1}),
            &json!({"action":"read","path":"Research/Seed.md","startLine":1,"endLine":1,"content":"partial","truncated":true,"nextStartLine":1,"nextStartOffset":240})
        )]));
        let args: Value = serde_json::from_str(
            result
                .pointer("/nextCall/arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}"),
        )
        .unwrap_or(Value::Null);
        assert_eq!(args.get("start_offset"), Some(&json!(240)));
        assert_eq!(args.get("start_line"), Some(&json!(1)));
    }

    #[test]
    fn time_and_aggregate_context_budgets_remain_separate_from_sufficiency() {
        let input = json!({"question":"copper","scopes":[],"toolCalls":[],"budgetExpired":true});
        let result: Value =
            serde_json::from_str(&plan_evidence_collection_json(&input.to_string()))
                .unwrap_or(Value::Null);
        assert_eq!(result.get("reason"), Some(&json!("time-budget")));
        assert_eq!(result.get("coverage"), Some(&json!("unreviewed")));
        let input = json!({"question":"copper","scopes":[],"toolCalls":[{"name":SEARCH,"status":"success","arguments":"{}","result":"x".repeat(MAX_RESULT_BYTES)}]});
        let result: Value =
            serde_json::from_str(&plan_evidence_collection_json(&input.to_string()))
                .unwrap_or(Value::Null);
        assert_eq!(result.get("reason"), Some(&json!("context-budget")));
    }

    fn plan(calls: &Value) -> Value {
        serde_json::from_str(&plan_evidence_collection_json(
            &json!({"question":"Compare copper storage and glass queue latency", "scopes":["Research"], "toolCalls":calls}).to_string(),
        )).unwrap_or(Value::Null)
    }

    #[test]
    fn collection_starts_without_model_tool_calls_and_preserves_scope() {
        let result = plan(&json!([]));
        assert_eq!(result.get("done").unwrap_or(&Value::Null), false);
        assert_eq!(
            result.pointer("/nextCall/name").unwrap_or(&Value::Null),
            "superpower_inside_search"
        );
        let args: Value = serde_json::from_str(
            result
                .pointer("/nextCall/arguments")
                .unwrap_or(&Value::Null)
                .as_str()
                .unwrap_or(""),
        )
        .unwrap_or(Value::Null);
        assert_eq!(args.get("path").unwrap_or(&Value::Null), "Research");
        assert_eq!(args.get("mode").unwrap_or(&Value::Null), "auto");
    }

    #[test]
    fn scoped_original_text_discovers_related_sources_without_model_reviews() {
        for content in [
            "Restart uses the quartz handshake waiting procedure",
            "재시작은 수정 인계 대기 절차를 따른다",
        ] {
            let mut calls = Vec::new();
            let mut discovered = false;
            let mut finished = false;
            for _ in 0..MAX_CALLS {
                let input = json!({"question":"restart waiting procedure", "scopes":["Research"], "toolCalls":calls});
                let result = collection_plan(&input).unwrap_or(Value::Null);
                assert!(result.is_object());
                assert!(result.get("reviewRequest").is_none_or(Value::is_null));
                if result.get("done") == Some(&json!(true)) {
                    assert!(discovered);
                    assert_eq!(result.get("verifiedSources"), Some(&json!(2)));
                    assert!(
                        u64::try_from(calls.len()).unwrap_or(u64::MAX)
                            <= result.get("maxCalls").and_then(Value::as_u64).unwrap_or(0)
                    );
                    finished = true;
                    break;
                }
                let next = result.get("nextCall").unwrap_or(&Value::Null);
                let args: Value = serde_json::from_str(
                    next.get("arguments").and_then(Value::as_str).unwrap_or(""),
                )
                .unwrap_or(Value::Null);
                let name = next.get("name").and_then(Value::as_str).unwrap_or("");
                assert!([SEARCH, READ].contains(&name));
                let response = match name {
                    SEARCH => {
                        assert_eq!(args.get("path"), Some(&json!("Research")));
                        let path = if calls.is_empty() {
                            "Research/Seed.md"
                        } else {
                            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
                            assert!(query.contains("quartz") || query.contains("수정"));
                            discovered = true;
                            "Research/Procedure.md"
                        };
                        json!({"action":"search","hits":[
                            {"path":path,"startLine":1,"endLine":1,"requiresRead":true},
                            {"path":"Other/Private.md","startLine":1,"endLine":1,"requiresRead":true}
                        ]})
                    }
                    READ => {
                        let path = args.get("path").and_then(Value::as_str).unwrap_or("");
                        assert!(path.starts_with("Research/"));
                        json!({"action":"read","path":path,"startLine":1,"endLine":1,"content":content})
                    }
                    _ => Value::Null,
                };
                calls.push(call(name, &args, &response));
            }
            assert!(discovered);
            assert!(finished);
        }
    }

    #[test]
    fn repeated_failures_close_collection() {
        let result = plan(&json!([
            {"name":"superpower_inside_search","status":"error","arguments":"{}"},
            {"name":"superpower_inside_search","status":"error","arguments":"{}"}
        ]));
        assert_eq!(result.get("done").unwrap_or(&Value::Null), true);
        assert_eq!(result.get("reason").unwrap_or(&Value::Null), "failed");
    }

    #[test]
    fn oversized_input_is_rejected() {
        assert!(plan_evidence_collection_json(&" ".repeat(8 * 1024 * 1024 + 1)).is_empty());
    }

    #[test]
    fn comparison_probes_preserve_both_languages_without_model_translation() {
        for question in [
            "Compare copper storage and glass queue latency",
            "구리 저장소와 유리 큐의 지연 차이를 설명해줘",
        ] {
            let probes = search_probes(question, &["Research"]);
            assert_eq!(probes.len(), 3);
            let queries = probes
                .iter()
                .filter_map(|probe| probe.get("query").and_then(Value::as_str))
                .collect::<Vec<_>>();
            assert!(
                queries
                    .iter()
                    .any(|query| query.contains("copper") || query.contains("구리"))
            );
            assert!(
                queries
                    .iter()
                    .any(|query| query.contains("glass") || query.contains("유리"))
            );
        }
    }

    #[test]
    fn interpretation_question_with_connector_keeps_only_named_subject_heads() {
        let plan: Value = serde_json::from_str(&plan_indexed_search_queries_json(
            &json!({
                "question": "보관 기록과 오린 퀼런은 원장 3장을 어떻게 해석하고 있어?"
            })
            .to_string(),
        ))
        .unwrap_or(Value::Null);
        assert_eq!(plan.get("mode"), Some(&json!("comparison")));
        let facets = plan
            .get("facets")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert_eq!(
            facets.get(2).and_then(|facet| facet.get("query")),
            Some(&json!("오린 퀼런"))
        );
    }

    #[test]
    fn comparison_subjects_do_not_split_on_connectors_inside_quotes() {
        assert_eq!(
            comparison_subject_queries("Compare \"alpha and beta\" and gamma"),
            vec!["alpha beta".to_owned(), "gamma".to_owned()]
        );
        assert!(comparison_subject_queries("Compare \"alpha and beta\" values").is_empty());
    }

    #[test]
    fn comparison_subjects_keep_distinguishing_tokens_after_a_shared_prefix() {
        assert_eq!(
            comparison_subject_queries(
                "Compare New York City public transit and New York City housing"
            ),
            vec![
                "new york city public transit".to_owned(),
                "new york city housing".to_owned(),
            ]
        );
    }

    #[test]
    fn search_query_plan_preserves_comparison_subjects_and_order() {
        for (question, first, second) in [
            (
                "Compare copper storage and glass queue latency",
                "copper",
                "glass",
            ),
            (
                "구리 저장소와 유리 큐의 지연 차이를 설명해줘",
                "구리",
                "유리",
            ),
        ] {
            let plan: Value = serde_json::from_str(&plan_indexed_search_queries_json(
                &json!({"question": question, "scopes": ["Research"]}).to_string(),
            ))
            .unwrap_or(Value::Null);
            assert_eq!(plan.get("mode"), Some(&json!("comparison")));
            let facets = plan
                .get("facets")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            assert_eq!(facets.len(), 3);
            let first_facet = facets.first().unwrap_or(&Value::Null);
            let second_facet = facets.get(1).unwrap_or(&Value::Null);
            let third_facet = facets.get(2).unwrap_or(&Value::Null);
            assert_eq!(first_facet.get("id"), Some(&json!("question")));
            assert_eq!(first_facet.get("queryIndex"), Some(&json!(0)));
            assert_eq!(second_facet.get("id"), Some(&json!("subject-0")));
            assert_eq!(second_facet.get("queryIndex"), Some(&json!(1)));
            assert_eq!(third_facet.get("id"), Some(&json!("subject-1")));
            assert_eq!(third_facet.get("queryIndex"), Some(&json!(2)));
            assert!(
                second_facet
                    .get("query")
                    .and_then(Value::as_str)
                    .is_some_and(|query| query.contains(first))
            );
            assert!(
                third_facet
                    .get("query")
                    .and_then(Value::as_str)
                    .is_some_and(|query| query.contains(second))
            );
        }
    }

    #[test]
    fn scoring_question_replaces_only_the_main_query() {
        let plan: Value = serde_json::from_str(&plan_indexed_search_queries_json(
            &json!({
                "question": "Compare copper storage and glass queue latency",
                "scoringQuestion": "  copper storage and glass queue latency reliability  ",
                "scopes": ["Research"]
            })
            .to_string(),
        ))
        .unwrap_or(Value::Null);
        assert_eq!(
            plan.pointer("/facets/0/query"),
            Some(&json!("copper storage and glass queue latency reliability"))
        );
        assert_eq!(
            plan.pointer("/facets/1/query"),
            Some(&json!("copper storage"))
        );
        assert_eq!(
            plan.pointer("/facets/2/query"),
            Some(&json!("glass queue latency"))
        );
        assert_eq!(
            plan_indexed_search_queries_json(&json!({"question": ""}).to_string()),
            ""
        );
    }

    #[test]
    fn search_query_plan_preserves_main_query_syntax() {
        for (input, expected) in [
            (
                json!({"question": "  title:\"quoted phrase\" -deprecated Compare copper and glass  "}),
                "title:\"quoted phrase\" -deprecated Compare copper and glass",
            ),
            (
                json!({
                    "question": "Compare copper and glass",
                    "scoringQuestion": "  body:\"quoted phrase\" -deprecated  "
                }),
                "body:\"quoted phrase\" -deprecated",
            ),
        ] {
            let plan: Value =
                serde_json::from_str(&plan_indexed_search_queries_json(&input.to_string()))
                    .unwrap_or(Value::Null);
            assert_eq!(plan.pointer("/facets/0/query"), Some(&json!(expected)));
        }
    }

    #[test]
    fn search_query_plan_requires_two_valid_subject_facets_for_comparison() {
        for question in ["구리·유리 차이", "Compare copper only"] {
            let plan: Value = serde_json::from_str(&plan_indexed_search_queries_json(
                &json!({"question": question}).to_string(),
            ))
            .unwrap_or(Value::Null);
            assert_eq!(plan.get("mode"), Some(&json!("single")));
            assert_eq!(
                plan.get("facets").and_then(Value::as_array).map(Vec::len),
                Some(1)
            );
        }

        let duplicate_identity: Value = serde_json::from_str(&plan_indexed_search_queries_json(
            &json!({"question": "Compare copper and copper"}).to_string(),
        ))
        .unwrap_or(Value::Null);
        assert_eq!(duplicate_identity.get("mode"), Some(&json!("comparison")));
        assert_eq!(
            duplicate_identity
                .get("facets")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(3)
        );
        assert_eq!(
            duplicate_identity.pointer("/facets/1/query"),
            Some(&json!("copper"))
        );
        assert_eq!(
            duplicate_identity.pointer("/facets/2/query"),
            Some(&json!("copper"))
        );
    }

    #[test]
    fn search_query_plan_keeps_subjects_with_the_maximum_scope_count() {
        let scopes = (0..MAX_SEARCH_PLAN_SCOPES)
            .map(|index| format!("Scope{index}"))
            .collect::<Vec<_>>();
        let plan: Value = serde_json::from_str(&plan_indexed_search_queries_json(
            &json!({
                "question": "Compare copper storage and glass queue latency",
                "scopes": scopes
            })
            .to_string(),
        ))
        .unwrap_or(Value::Null);
        assert_eq!(
            plan.get("facets").and_then(Value::as_array).map(Vec::len),
            Some(3)
        );
    }

    #[test]
    fn search_budget_visits_scopes_before_repeating_one_scope() {
        let probes = search_probes("Compare copper and glass", &["A", "B", "C", "D", "E"]);
        assert_eq!(probes.len(), 15);
        let paths = probes
            .iter()
            .filter_map(|probe| probe.get("path").and_then(Value::as_str))
            .collect::<BTreeSet<_>>();
        assert_eq!(paths.len(), 5);
    }

    #[test]
    fn candidates_and_saved_summaries_never_count_as_verified_progress() {
        let results = vec![
            Some(json!({"action":"search","hits":[{
                "path":"Research/Seed.md","startLine":5,"endLine":8,
                "preview":"합성 원문 후보", "citationStatus":"candidate", "requiresRead":true
            }]})),
            Some(json!({"kind":"tool-result-summary","summary":"검증했다는 문구"})),
        ];
        assert!(verified_ranges(&results, &["Research"]).is_empty());
        let passages = ranked_passages(&results, &["Other"]);
        assert!(passages.is_empty());
    }

    #[test]
    fn no_progress_and_hard_budget_close_collection() {
        let probes = search_probes(
            "Compare copper storage and glass queue latency",
            &["Research"],
        );
        let mut calls = probes.iter().map(|probe| json!({"name":SEARCH,"arguments":probe.to_string(),"status":"success","result":json!({"action":"search","hits":[]}).to_string()})).collect::<Vec<_>>();
        for _ in 0..2 {
            calls.push(json!({"name":READ,"arguments":"{}","status":"success","result":json!({"action":"read","path":"Research/Seed.md","startLine":1,"endLine":1,"content":""}).to_string()}));
        }
        assert_eq!(
            plan(&json!(calls)).get("reason"),
            Some(&json!("no-progress"))
        );
        while calls.len() < MAX_CALLS {
            calls.push(json!({"name":READ,"status":"error","arguments":"{}"}));
        }
        assert_eq!(plan(&json!(calls)).get("reason"), Some(&json!("budget")));
    }

    #[test]
    fn verified_search_text_is_progress_but_headings_are_not_extra_documents() {
        let results = vec![Some(json!({"action":"search","hits":[
            {"path":"Research/Seed.md","startLine":2,"endLine":4,"preview":"합성 본문","citationStatus":"verified"},
            {"path":"Research/Seed.md","startLine":1,"endLine":1,"preview":"합성 제목","citationStatus":"verified"},
            {"path":"Other/Hidden.md","startLine":1,"endLine":3,"preview":"범위 밖 본문","citationStatus":"verified"}
        ]}))];
        let ranges = verified_ranges(&results, &["Research"]);
        assert_eq!(ranges.len(), 2);
        assert_eq!(
            ranges
                .iter()
                .map(|(path, _, _)| path)
                .collect::<BTreeSet<_>>()
                .len(),
            1
        );
    }
}
