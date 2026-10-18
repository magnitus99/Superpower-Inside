use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 합산 가능한 공급자 보고 필드입니다.
const FIELDS: [&str; 5] = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "reasoningTokens",
];
/// JavaScript 정수 정밀도를 보존하는 상한입니다.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// 요청 안의 누적 보고는 덮어쓰고 서로 다른 요청의 사용량만 합산합니다.
#[wasm_bindgen]
pub fn plan_turn_usage_json(input_json: &str) -> String {
    serde_json::from_str::<Value>(input_json)
        .ok()
        .and_then(|input| plan(&input))
        .map_or_else(String::new, |value| value.to_string())
}

/// 음수·소수·정밀도 손실 수치를 보고에서 제외합니다.
fn count(value: &Value) -> Option<u64> {
    value.as_u64().filter(|count| *count <= MAX_SAFE_INTEGER)
}

/// 저장 파일의 잘못된 집계는 답변과 분리해서 폐기합니다.
pub fn validated_snapshot(value: &Value) -> Option<Value> {
    value.as_object()?;
    plan(&json!({"base": value, "requests": []}))
}

/// 합계도 안전한 정수 범위를 벗어나지 않게 합니다.
fn add(target: &mut Map<String, Value>, key: &str, value: u64) -> Option<()> {
    let total = target
        .get(key)
        .and_then(count)
        .unwrap_or_default()
        .checked_add(value)?;
    if total > MAX_SAFE_INTEGER {
        return None;
    }
    target.insert(key.to_owned(), json!(total));
    Some(())
}

/// 요청별 최신 보고를 합산하되 미제공 필드를 0으로 만들지 않습니다.
fn plan(input: &Value) -> Option<Value> {
    let mut total = Map::new();
    let base = input.get("base").filter(|value| !value.is_null());
    let mut requests = 0;
    let mut reported = 0;
    let mut partial = false;
    if let Some(base) = base {
        requests = count(base.get("requests")?)?;
        reported = count(base.get("reportedRequests")?)?;
        if reported > requests {
            return None;
        }
        if base
            .get("partial")
            .is_some_and(|value| value.as_bool() != Some(true))
        {
            return None;
        }
        partial = base.get("partial").is_some()
            || reported < requests
            || (requests > 0
                && ["inputTokens", "outputTokens", "totalTokens"]
                    .iter()
                    .any(|key| base.get(key).is_none()));
        for field in FIELDS {
            if let Some(value) = base.get(field) {
                add(&mut total, field, count(value)?)?;
            }
        }
    }
    for updates in input.get("requests")?.as_array()? {
        requests = requests.checked_add(1)?;
        if requests > MAX_SAFE_INTEGER {
            return None;
        }
        let mut latest = Map::new();
        for update in updates.as_array()? {
            for field in FIELDS {
                if let Some(value) = update.get(field).and_then(count) {
                    latest.insert(field.to_owned(), json!(value));
                }
            }
        }
        if latest.is_empty() {
            partial = true;
            continue;
        }
        reported += 1;
        if !latest.contains_key("totalTokens")
            && let (Some(input), Some(output)) = (
                latest.get("inputTokens").and_then(count),
                latest.get("outputTokens").and_then(count),
            )
        {
            add(&mut latest, "totalTokens", input.checked_add(output)?)?;
        }
        partial |= ["inputTokens", "outputTokens", "totalTokens"]
            .iter()
            .any(|key| !latest.contains_key(*key));
        for (field, value) in latest {
            add(&mut total, &field, count(&value)?)?;
        }
    }
    total.insert("requests".to_owned(), json!(requests));
    total.insert("reportedRequests".to_owned(), json!(reported));
    if partial {
        total.insert("partial".to_owned(), json!(true));
    }
    Some(Value::Object(total))
}

#[cfg(test)]
/// 공급자 누적 보고와 재개 이력의 회귀 계약입니다.
mod tests {
    use super::plan;
    use serde_json::json;

    /// 요청별 보고 필드가 다르면 모든 요청이 보고했어도 합계는 일부입니다.
    #[test]
    fn mixed_report_fields_preserve_partial_coverage() {
        assert_eq!(
            plan(&json!({"requests": [
                [{"totalTokens": 20}], [{"inputTokens": 10, "outputTokens": 4}]
            ]})),
            Some(json!({"requests":2,"reportedRequests":2,"inputTokens":10,
            "outputTokens":4,"totalTokens":34,"partial":true}))
        );
        let base = json!({"requests":2,"reportedRequests":2,"inputTokens":10,
            "outputTokens":4,"totalTokens":34,"partial":true});
        assert_eq!(plan(&json!({"base":base,"requests":[]})), Some(base));
    }

    #[test]
    /// 같은 요청의 반복 누적 보고는 중복 합산하지 않습니다.
    fn cumulative_reports_merge_per_request_and_preserve_missing_usage() {
        let result = plan(&json!({"requests": [
            [{"inputTokens": 20, "outputTokens": 0}, {"outputTokens": 8}, {"outputTokens": 8}],
            [{"inputTokens": 10, "outputTokens": 4, "totalTokens": 14}],
            []
        ]}));
        assert_eq!(
            result,
            Some(json!({"requests": 3, "reportedRequests": 2,
            "inputTokens": 30, "outputTokens": 12, "totalTokens": 42, "partial":true}))
        );
    }

    #[test]
    /// 재개 전 보고를 보존하며 실제 0토큰은 제공된 값으로 취급합니다.
    fn resumed_usage_keeps_prior_counts_and_zero_is_reported() {
        assert_eq!(
            plan(&json!({"base": {"requests": 2, "reportedRequests": 1,
            "inputTokens": 12, "outputTokens": 3, "totalTokens": 15},
            "requests": [[{"inputTokens": 0, "outputTokens": 0}]]})),
            Some(json!({"requests": 3, "reportedRequests": 2,
                "inputTokens": 12, "outputTokens": 3, "totalTokens": 15, "partial":true}))
        );
    }

    #[test]
    /// 잘못된 수치와 제공되지 않은 수치를 구분합니다.
    fn invalid_counts_and_missing_fields_are_not_fabricated() {
        assert_eq!(
            plan(&json!({"requests": [[{"inputTokens": -1, "totalTokens": 2.5}], []]})),
            Some(json!({"requests": 2, "reportedRequests": 0, "partial":true}))
        );
        assert_eq!(
            plan(&json!({"requests": [[{"outputTokens": 4}]]})),
            Some(json!({"requests": 1, "reportedRequests": 1, "outputTokens": 4, "partial":true}))
        );
        assert!(plan(&json!({"base":{"requests":1,"reportedRequests":2},"requests":[]})).is_none());
    }
}
