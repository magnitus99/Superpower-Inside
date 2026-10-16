//! 원문과 대조할 수 있는 구조화 판정만 조사 계획에 반영합니다.

use serde_json::{Value, json};

/// 모델의 충분성 판정은 원문 존재 검증과 구분해 보관합니다.
pub struct ReviewState {
    /// 판정 성공·부족·형식 실패를 구분합니다.
    pub coverage: &'static str,
    /// 추가 검색할 미해결 항목입니다.
    pub gaps: Vec<String>,
    /// 판정이 참조한 도구 실행 개수입니다.
    pub after_calls: usize,
}

/// 실제 읽은 구간만 제한된 판정 요청에 넣습니다.
pub fn evidence_rows(results: &[Option<Value>], scopes: &[&str]) -> Vec<Value> {
    results.iter().enumerate().filter_map(|(index, result)| {
        let result = result.as_ref()?;
        if result.get("action")? != "read" {
            return None;
        }
        let path = result.get("path")?.as_str()?;
        let text = result.get("content")?.as_str()?;
        let start = result.get("startLine")?.as_u64()?;
        let end = result.get("endLine")?.as_u64()?;
        if !super::in_scope(path, scopes) || text.trim().is_empty() || start == 0 || end < start {
            return None;
        }
        Some(json!({"id":format!("r{index}"),"path":path,"startLine":start,"endLine":end,"text":text.chars().take(2000).collect::<String>(),"truncated":result.get("truncated").and_then(Value::as_bool).unwrap_or(false)}))
    }).rev().take(12).collect()
}

/// 모델 제안이 실제 요청에 포함된 원문 구절을 가리키는지 검사합니다.
fn valid_support(check: &Value, evidence: &[Value]) -> bool {
    let Some(support) = check.get("evidence").and_then(Value::as_array) else {
        return false;
    };
    !support.is_empty()
        && support.len() <= 8
        && support.iter().all(|reference| {
            let Some(quote) = reference.get("quote").and_then(Value::as_str) else {
                return false;
            };
            (4..=500).contains(&quote.chars().count())
                && evidence.iter().any(|row| {
                    row.get("id") == reference.get("id")
                        && row
                            .get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|text| text.contains(quote))
                })
        })
}

/// 외부 모델의 문자열은 길이를 제한하고 명령이 아닌 검색 입력으로만 사용합니다.
fn bounded_text(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?.trim();
    (!text.is_empty() && text.chars().count() <= 500).then(|| text.to_owned())
}

/// 한 번 발견한 추가 조사 항목은 뒤의 모델 응답이 생략해도 보존합니다.
pub fn prior_checks(reviews: &[Value]) -> Vec<String> {
    let mut questions = Vec::new();
    for review in reviews {
        let Some(parsed) = review
            .get("content")
            .and_then(Value::as_str)
            .and_then(super::super::extract_json_object)
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        else {
            continue;
        };
        for check in parsed
            .get("checks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if check.get("facetId").and_then(Value::as_u64).is_none()
                && let Some(question) = bounded_text(check.get("question"))
                && !questions.contains(&question)
                && questions.len() < 16
            {
                questions.push(question);
            }
        }
    }
    questions
}

/// 마지막 판정은 해당 시점의 원문에 대조하고 기본 조사 항목 누락도 보존합니다.
pub fn review_state(
    reviews: &[Value],
    results: &[Option<Value>],
    scopes: &[&str],
    facets: &[String],
) -> ReviewState {
    let mut state = ReviewState {
        coverage: "unreviewed",
        gaps: facets.to_vec(),
        after_calls: 0,
    };
    let Some(last) = reviews.last() else {
        return state;
    };
    state.coverage = "invalid-review";
    let Some(after_calls) = last
        .get("afterCalls")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .filter(|count| *count <= results.len())
    else {
        return state;
    };
    state.after_calls = after_calls;
    let Some(raw) = last
        .get("content")
        .and_then(Value::as_str)
        .filter(|raw| raw.len() <= 32_768)
    else {
        return state;
    };
    let Some(parsed) = super::super::extract_json_object(raw)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    else {
        return state;
    };
    let Some(checks) = parsed
        .get("checks")
        .and_then(Value::as_array)
        .filter(|checks| !checks.is_empty() && checks.len() <= 16)
    else {
        return state;
    };
    let evidence = evidence_rows(results.get(..after_calls).unwrap_or_default(), scopes);
    let mut covered = std::collections::BTreeSet::new();
    let mut gaps = Vec::new();
    let mut answered = Vec::new();
    for check in checks {
        let Some(question) = bounded_text(check.get("question")) else {
            return state;
        };
        let facet = check
            .get("facetId")
            .and_then(Value::as_u64)
            .and_then(|id| usize::try_from(id).ok());
        answered.push(question.clone());
        match check.get("status").and_then(Value::as_str) {
            Some("supported") if valid_support(check, &evidence) => {
                if let Some(facet) = facet.filter(|id| *id < facets.len()) {
                    covered.insert(facet);
                }
            }
            Some("missing" | "conflicting") => {
                gaps.push(bounded_text(check.get("query")).unwrap_or(question));
            }
            _ => return state,
        }
    }
    for (index, facet) in facets.iter().enumerate() {
        if !covered.contains(&index) && !gaps.contains(facet) {
            gaps.push(facet.clone());
        }
    }
    for question in prior_checks(reviews) {
        if !answered.contains(&question) && !gaps.contains(&question) {
            gaps.push(question);
        }
    }
    state.coverage = if gaps.is_empty() {
        "supported"
    } else {
        "incomplete"
    };
    state.gaps = gaps;
    state
}
