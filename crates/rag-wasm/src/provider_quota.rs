//! 공식 제공자 한도 응답의 정규화와 요약 선택입니다.

use core::cmp::Ordering;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::wasm_bindgen;

/// 제공자 한도를 정규화·요약하거나 갱신 간격을 제한합니다.
///
/// 잘못된 요청·지원하지 않는 형식은 JSON null이며 I/O를 수행하지 않습니다.
#[wasm_bindgen]
#[must_use]
pub fn plan_provider_quota_json(input_json: &str) -> String {
    serde_json::from_str::<Value>(input_json)
        .ok()
        .and_then(|input| match input.get("op")?.as_str()? {
            "normalize" => normalize(input.get("format")?.as_str()?, input.get("payload")?),
            "summarize" => summarize(input.get("snapshot")?),
            "interval" => Some(json!(
                input
                    .get("value")
                    .and_then(Value::as_f64)
                    .filter(|value| value.is_finite() && value.fract() == 0.0)
                    .map_or(30.0, |value| value.clamp(10.0, 3600.0))
            )),
            _ => None,
        })
        .unwrap_or(Value::Null)
        .to_string()
}

/// 숫자 타입인 유한한 음이 아닌 값만 허용합니다.
fn nonnegative(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

/// 잔여 비율은 범위를 벗어나면 미확인입니다.
fn percent(value: &Value) -> Option<f64> {
    nonnegative(value).filter(|value| *value <= 100.0)
}

/// 사용 비율은 초과 사용을 포화시키되 음수·문자열은 거부합니다.
fn from_used(value: &Value) -> Option<f64> {
    nonnegative(value).map(|used| 100.0 - used.min(100.0))
}

/// 빈 문자열을 선택 필드로 전달하지 않습니다.
fn text(value: &Value) -> Option<&str> {
    value.as_str().filter(|value| !value.trim().is_empty())
}

/// 공식 문자열 금액은 JSON 십진수 문법과 유한 범위를 검증합니다.
fn decimal_string(value: &Value) -> Option<f64> {
    let parsed = serde_json::from_str::<Value>(value.as_str()?).ok()?;
    nonnegative(&parsed)
}

/// 알려진 잔액 또는 명시적 무제한만 크레딧 항목으로 만듭니다.
fn credit(remaining: Option<f64>, unit: &str, unlimited: Option<bool>) -> Option<Value> {
    if remaining.is_none() && unlimited != Some(true) {
        return None;
    }
    let mut output = Map::new();
    output.insert("unit".to_owned(), json!(unit));
    if let Some(remaining) = remaining {
        output.insert("remaining".to_owned(), json!(remaining));
    }
    if let Some(unlimited) = unlimited {
        output.insert("unlimited".to_owned(), json!(unlimited));
    }
    Some(Value::Object(output))
}

/// 유효한 잔여 비율이 확인된 창만 만듭니다.
fn window(id: &str, remaining: f64) -> Value {
    json!({"id":id,"remainingPercent":remaining})
}

/// 객체에만 필드를 삽입해 인덱싱 패닉을 방지합니다.
fn put(output: &mut Value, key: &str, value: Value) {
    if let Some(object) = output.as_object_mut() {
        object.insert(key.to_owned(), value);
    }
}

/// 선택 문자열은 유효할 때만 복사하고 null을 생략합니다.
fn copy_text(output: &mut Value, key: &str, value: Option<&Value>) {
    if let Some(value) = value.and_then(text) {
        put(output, key, json!(value));
    }
}

/// 공식 응답에 있는 양의 실제 초만 보존합니다.
fn copy_duration(output: &mut Value, value: Option<&Value>) {
    if let Some(value) = value.and_then(nonnegative).filter(|value| *value > 0.0) {
        put(output, "durationSeconds", json!(value));
    }
}

/// `ChatGPT` 기본·추가 한도에 실제 존재하는 창을 수집합니다.
fn chatgpt_windows(rate_limit: &Value, prefix: &str, windows: &mut Vec<Value>) {
    for (key, suffix) in [
        ("primary_window", "primary"),
        ("secondary_window", "secondary"),
    ] {
        let Some(source) = rate_limit.get(key) else {
            continue;
        };
        let Some(remaining) = source.get("used_percent").and_then(from_used) else {
            continue;
        };
        let mut output = window(&format!("{prefix}{suffix}"), remaining);
        copy_duration(&mut output, source.get("limit_window_seconds"));
        // reset_at은 epoch 초입니다. ISO 문자열을 꾸미지 않고 생략합니다.
        windows.push(output);
    }
}

/// 요금제 이름이나 `has_credits`로 없는 한도·잔액을 만들지 않습니다.
fn chatgpt(payload: &Value, windows: &mut Vec<Value>, credits: &mut Vec<Value>) {
    if let Some(rate_limit) = payload.get("rate_limit") {
        chatgpt_windows(rate_limit, "", windows);
    }
    if let Some(additional) = payload
        .get("additional_rate_limits")
        .and_then(Value::as_array)
    {
        let mut occurrences = BTreeMap::<String, usize>::new();
        for item in additional {
            if let Some(rate_limit) = item.get("rate_limit") {
                let identity = json!([
                    item.get("metered_feature").and_then(text),
                    item.get("limit_name").and_then(text)
                ])
                .to_string();
                let occurrence = occurrences.entry(identity.clone()).or_default();
                chatgpt_windows(
                    rate_limit,
                    &format!("additional:{identity}:{occurrence}:"),
                    windows,
                );
                *occurrence += 1;
            }
        }
    }
    if let Some(source) = payload.get("credits") {
        credits.extend(credit(
            source.get("balance").and_then(decimal_string),
            "credits",
            source.get("unlimited").and_then(Value::as_bool),
        ));
    }
}

/// Gemini의 모델·토큰별 창과 공식 `GOOGLE_ONE_AI` 크레딧만 정규화합니다.
fn gemini(payload: &Value, windows: &mut Vec<Value>, credits: &mut Vec<Value>) {
    if let Some(buckets) = payload.pointer("/quota/buckets").and_then(Value::as_array) {
        let mut occurrences = BTreeMap::<String, usize>::new();
        for bucket in buckets {
            let Some(fraction) = bucket
                .get("remainingFraction")
                .and_then(nonnegative)
                .filter(|value| *value <= 1.0)
            else {
                continue;
            };
            let identity = json!([
                bucket.get("modelId").and_then(text),
                bucket.get("tokenType").and_then(text)
            ])
            .to_string();
            let occurrence = occurrences.entry(identity.clone()).or_default();
            let mut output = window(&format!("gemini:{identity}:{occurrence}"), fraction * 100.0);
            *occurrence += 1;
            copy_text(&mut output, "modelId", bucket.get("modelId"));
            copy_text(&mut output, "resetsAt", bucket.get("resetTime"));
            windows.push(output);
        }
    }
    if let Some(available) = payload
        .pointer("/creditInfo/paidTier/availableCredits")
        .and_then(Value::as_array)
    {
        let amounts = available
            .iter()
            .filter(|entry| {
                entry.get("creditType").and_then(Value::as_str) == Some("GOOGLE_ONE_AI")
            })
            .filter_map(|entry| {
                let amount = entry.get("creditAmount")?.as_str()?;
                if amount.is_empty() || !amount.bytes().all(|byte| byte.is_ascii_digit()) {
                    return None;
                }
                amount.parse::<i64>().ok()
            });
        let mut total = None::<i64>;
        for amount in amounts {
            let Some(sum) = total.unwrap_or(0).checked_add(amount) else {
                return;
            };
            total = Some(sum);
        }
        // JSON 숫자로 변환하며 TS와 동일한 유한 숫자 표현을 사용합니다.
        let remaining = total.and_then(|value| json!(value).as_f64());
        credits.extend(credit(remaining, "credits", None));
    }
}

/// Go의 rolling 기간 길이·잔액·차감원은 추측하지 않습니다.
fn opencode(payload: &Value, windows: &mut Vec<Value>) {
    for (key, period) in [
        ("rolling", None),
        ("weekly", Some("week")),
        ("monthly", Some("month")),
    ] {
        let Some(source) = payload.get("usage").and_then(|usage| usage.get(key)) else {
            continue;
        };
        let Some(remaining) = source.get("percent").and_then(from_used) else {
            continue;
        };
        let mut output = window(key, remaining);
        if let Some(period) = period {
            put(&mut output, "period", json!(period));
        }
        copy_text(&mut output, "resetsAt", source.get("resetsAt"));
        windows.push(output);
    }
}

/// Ollama의 포함 월 한도와 별도 구매 달러를 혼동하지 않습니다.
fn ollama(payload: &Value, windows: &mut Vec<Value>, credits: &mut Vec<Value>) {
    if let Some(included) = payload.get("included") {
        if let (Some(balance), Some(allowance)) = (
            included.get("balance_usd").and_then(nonnegative),
            included
                .get("allowance_usd")
                .and_then(nonnegative)
                .filter(|value| *value > 0.0),
        ) {
            let mut output = window("included", (balance / allowance).min(1.0) * 100.0);
            put(&mut output, "period", json!("month"));
            copy_text(&mut output, "resetsAt", included.pointer("/period/until"));
            windows.push(output);
        }
        for (key, period) in [("session", "session"), ("weekly", "week")] {
            let Some(source) = included.get(key) else {
                continue;
            };
            let Some(remaining) = source.get("remaining_percent").and_then(percent) else {
                continue;
            };
            let mut output = window(key, remaining);
            put(&mut output, "period", json!(period));
            copy_text(&mut output, "resetsAt", source.get("resets_at"));
            windows.push(output);
        }
    }
    credits.extend(credit(
        payload
            .pointer("/purchased/balance_usd")
            .and_then(nonnegative),
        "USD",
        None,
    ));
}

/// `OpenRouter`는 계정 총량과 사용량이 모두 유효할 때만 잔액을 제공합니다.
fn openrouter(payload: &Value, credits: &mut Vec<Value>) {
    if let (Some(total), Some(usage)) = (
        payload.pointer("/data/total_credits").and_then(nonnegative),
        payload.pointer("/data/total_usage").and_then(nonnegative),
    ) {
        let remaining = total - usage;
        credits.extend(credit(
            (remaining.is_finite() && remaining >= 0.0).then_some(remaining),
            "USD",
            None,
        ));
    }
}

/// 공통 스냅샷을 반환하며 지원하지 않는 형식은 실패로 닫습니다.
fn normalize(format: &str, payload: &Value) -> Option<Value> {
    payload.as_object()?;
    let mut windows = Vec::new();
    let mut credits = Vec::new();
    match format {
        "chatgpt" => chatgpt(payload, &mut windows, &mut credits),
        "gemini" => gemini(payload, &mut windows, &mut credits),
        "opencode-go" => opencode(payload, &mut windows),
        "ollama-cloud" => ollama(payload, &mut windows, &mut credits),
        "openrouter" => openrouter(payload, &mut credits),
        _ => return None,
    }
    Some(json!({"windows":windows,"credits":credits}))
}

/// 공통 창의 필수 값을 검증하고 유효한 선택 필드만 보존합니다.
fn valid_window(source: &Value) -> Option<Value> {
    let mut output = window(
        source.get("id").and_then(text)?,
        source.get("remainingPercent").and_then(percent)?,
    );
    copy_duration(&mut output, source.get("durationSeconds"));
    if let Some(period @ ("session" | "week" | "month")) =
        source.get("period").and_then(Value::as_str)
    {
        put(&mut output, "period", json!(period));
    }
    copy_text(&mut output, "resetsAt", source.get("resetsAt"));
    copy_text(&mut output, "modelId", source.get("modelId"));
    Some(output)
}

/// 기간의 실제 초가 없을 때 명시된 세션·주·월 순서만 비교합니다.
fn period_rank(window: &Value) -> u8 {
    match window.get("period").and_then(Value::as_str) {
        Some("session") => 0,
        Some("week") => 1,
        Some("month") => 2,
        _ => 3,
    }
}

/// 실제 기간이 있는 창을 우선하고 의미 기간·ID로 완전한 동률을 해소합니다.
fn compare_windows(left: &Value, right: &Value) -> Ordering {
    let remaining = |window: &Value| window.get("remainingPercent").and_then(Value::as_f64);
    let duration = |window: &Value| window.get("durationSeconds").and_then(Value::as_f64);
    remaining(left)
        .zip(remaining(right))
        .map_or(Ordering::Equal, |(left, right)| left.total_cmp(&right))
        .then_with(|| match (duration(left), duration(right)) {
            (Some(left), Some(right)) => left.total_cmp(&right),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => period_rank(left).cmp(&period_rank(right)),
        })
        .then_with(|| {
            left.get("id")
                .and_then(Value::as_str)
                .cmp(&right.get("id").and_then(Value::as_str))
        })
}

/// 유효한 창 전체에서 소진을 판단하고 최솟값을 선택합니다.
fn summarize(snapshot: &Value) -> Option<Value> {
    let windows: Vec<Value> = snapshot
        .get("windows")?
        .as_array()?
        .iter()
        .filter_map(valid_window)
        .collect();
    let credits: Vec<Value> = snapshot
        .get("credits")?
        .as_array()?
        .iter()
        .filter_map(|source| {
            let unit @ ("USD" | "credits") = source.get("unit")?.as_str()? else {
                return None;
            };
            credit(
                source.get("remaining").and_then(nonnegative),
                unit,
                source.get("unlimited").and_then(Value::as_bool),
            )
        })
        .collect();
    let exhausted = windows
        .iter()
        .any(|window| window.get("remainingPercent").and_then(Value::as_f64) == Some(0.0));
    let mut output = json!({"credits":credits,"subscriptionExhausted":exhausted});
    if let Some(window) = windows
        .iter()
        .min_by(|left, right| compare_windows(left, right))
    {
        put(&mut output, "window", window.clone());
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::plan_provider_quota_json;
    use serde_json::{Value, json};

    /// 합성 요청을 실제 JSON 진입점으로 전달합니다.
    fn call(input: &Value) -> Value {
        serde_json::from_str(&plan_provider_quota_json(&input.to_string())).unwrap_or(Value::Null)
    }

    /// 합성 제공자 응답을 정규화합니다.
    fn normalize(format: &str, payload: &Value) -> Value {
        call(&json!({"op":"normalize","format":format,"payload":payload}))
    }

    /// 합성 창을 요약합니다.
    fn summarize(windows: &Value) -> Value {
        call(&json!({"op":"summarize","snapshot":{"windows":windows,"credits":[]}}))
    }

    #[test]
    fn provider_quota_minimum_and_shortest_actual_duration() {
        for ([session, week, month], expected) in [
            ([10, 2, 80], "week"),
            ([100, 100, 100], "session"),
            ([100, 100, 20], "month"),
        ] {
            let result = summarize(&json!([
                {"id":"month","remainingPercent":month,"durationSeconds":2_592_000},
                {"id":"week","remainingPercent":week,"durationSeconds":604_800},
                {"id":"session","remainingPercent":session,"durationSeconds":18_000}
            ]));
            assert_eq!(
                result.pointer("/window/id").cloned().unwrap_or(Value::Null),
                expected,
                "가장 적은 잔여량과 실제 기간을 우선해야 합니다"
            );
        }
    }

    #[test]
    fn provider_quota_raw_fractions_dynamic_duration_and_stable_ids() {
        assert_eq!(
            summarize(&json!([
                {"id":"short","remainingPercent":2.04,"durationSeconds":10},
                {"id":"long","remainingPercent":2.01,"durationSeconds":20}
            ]))
            .pointer("/window/id")
            .cloned()
            .unwrap_or(Value::Null),
            "long",
            "반올림 전 비율로 선택해야 합니다"
        );
        assert_eq!(
            summarize(&json!([
                {"id":"z","remainingPercent":100,"durationSeconds":12.5},
                {"id":"a","remainingPercent":100,"durationSeconds":12.5},
                {"id":"shorter","remainingPercent":100,"durationSeconds":12.4},
                {"id":"unknown","remainingPercent":100}
            ]))
            .pointer("/window/id")
            .cloned()
            .unwrap_or(Value::Null),
            "shorter",
            "소수 기간도 반올림하지 않습니다"
        );
        assert_eq!(
            summarize(&json!([
                {"id":"z","remainingPercent":100}, {"id":"a","remainingPercent":100}
            ]))
            .pointer("/window/id")
            .cloned()
            .unwrap_or(Value::Null),
            "a",
            "동률은 ID 순으로 결정합니다"
        );
    }

    #[test]
    fn provider_quota_semantic_periods_without_fabricated_duration() {
        let result = summarize(&json!([
            {"id":"monthly","remainingPercent":100,"period":"month"},
            {"id":"weekly","remainingPercent":100,"period":"week"},
            {"id":"rolling","remainingPercent":100},
            {"id":"session","remainingPercent":100,"period":"session"}
        ]));
        assert_eq!(
            result.pointer("/window/id").cloned().unwrap_or(Value::Null),
            "session",
            "반환된 기간 의미를 비교합니다"
        );
        assert!(
            result
                .pointer("/window")
                .cloned()
                .unwrap_or(Value::Null)
                .get("durationSeconds")
                .is_none(),
            "세션 시간을 만들지 않습니다"
        );
    }

    #[test]
    fn provider_quota_chatgpt_absent_primary_ignores_plan_and_preserves_partial() {
        for plan in ["plus", "pro", "unknown"] {
            let result = normalize(
                "chatgpt",
                &json!({"plan_type":plan,"rate_limit":{
                    "secondary_window":{"used_percent":98,"limit_window_seconds":604_800}
                }}),
            );
            assert_eq!(
                result
                    .pointer("/windows")
                    .cloned()
                    .unwrap_or(Value::Null)
                    .as_array()
                    .map(Vec::len),
                Some(1),
                "없는 기본 창을 만들지 않습니다"
            );
            assert_eq!(
                result
                    .pointer("/windows/0/remainingPercent")
                    .cloned()
                    .unwrap_or(Value::Null),
                2.0,
                "실제 창만 정규화합니다"
            );
        }
        let result = normalize(
            "chatgpt",
            &json!({"rate_limit":{
                "primary_window":{"used_percent":"0"},"secondary_window":{"used_percent":120}
            }}),
        );
        assert_eq!(
            result
                .pointer("/windows")
                .cloned()
                .unwrap_or(Value::Null)
                .as_array()
                .map(Vec::len),
            Some(1),
            "문자열 비율을 거부합니다"
        );
        assert_eq!(
            result
                .pointer("/windows/0/remainingPercent")
                .cloned()
                .unwrap_or(Value::Null),
            0.0,
            "초과 사용은 소진입니다"
        );
        assert!(
            result
                .pointer("/windows/0")
                .cloned()
                .unwrap_or(Value::Null)
                .get("durationSeconds")
                .is_none(),
            "기간을 추측하지 않습니다"
        );
    }

    #[test]
    fn provider_quota_chatgpt_additional_features_and_credits() {
        let result = normalize(
            "chatgpt",
            &json!({"additional_rate_limits":[
            {"metered_feature":"review","limit_name":"review cap","rate_limit":{"primary_window":{"used_percent":75}}}
        ],"credits":{"has_credits":true,"unlimited":false,"balance":"12.50"}}),
        );
        assert_eq!(
            result
                .pointer("/windows/0/remainingPercent")
                .cloned()
                .unwrap_or(Value::Null),
            25.0,
            "추가 한도도 실제 창입니다"
        );
        assert!(
            result
                .pointer("/windows/0/id")
                .cloned()
                .unwrap_or(Value::Null)
                .as_str()
                .is_some_and(|id| id.contains("review")),
            "특징별 ID를 보존합니다"
        );
        assert_eq!(
            result
                .pointer("/credits/0/remaining")
                .cloned()
                .unwrap_or(Value::Null),
            12.5,
            "공식 문자열 잔액을 파싱합니다"
        );
        for balance in [json!(""), json!("-1"), Value::Null, json!("NaN")] {
            let result = normalize(
                "chatgpt",
                &json!({"credits":{"has_credits":false,"balance":balance}}),
            );
            assert_eq!(
                result.pointer("/credits").cloned().unwrap_or(Value::Null),
                json!([]),
                "미확인 잔액을 0으로 만들지 않습니다"
            );
        }
        assert_eq!(
            normalize("chatgpt", &json!({"credits":{"unlimited":true}}))
                .pointer("/credits")
                .cloned()
                .unwrap_or(Value::Null),
            json!([{"unit":"credits","unlimited":true}]),
            "무제한은 잔액 없이 표현합니다"
        );
    }

    #[test]
    fn provider_quota_gemini_optional_amount_and_only_google_one_credits() {
        let result = normalize(
            "gemini",
            &json!({"quota":{"buckets":[
                {"modelId":"model-a","tokenType":"INPUT","remainingFraction":0.02,"resetTime":"2030-01-01T00:00:00Z"},
                {"modelId":"model-a","tokenType":"OUTPUT","remainingFraction":0},
                {"remainingFraction":-0.1},{"remainingFraction":1.1},{"remainingFraction":"0.5"}
            ]},"creditInfo":{"paidTier":{"availableCredits":[
                {"creditType":"GOOGLE_ONE_AI","creditAmount":"12"},
                {"creditType":"OTHER","creditAmount":"999"},
                {"creditType":"GOOGLE_ONE_AI","creditAmount":"3"}
            ]}}}),
        );
        assert_eq!(
            result
                .pointer("/windows")
                .cloned()
                .unwrap_or(Value::Null)
                .as_array()
                .map(Vec::len),
            Some(2),
            "잔여 토큰 총량 없이도 비율은 유효합니다"
        );
        assert_ne!(
            result
                .pointer("/windows/0/id")
                .cloned()
                .unwrap_or(Value::Null),
            result
                .pointer("/windows/1/id")
                .cloned()
                .unwrap_or(Value::Null),
            "모델과 토큰별 ID가 다릅니다"
        );
        assert!(
            result
                .pointer("/windows/0")
                .cloned()
                .unwrap_or(Value::Null)
                .get("period")
                .is_none(),
            "resetTime에서 기간을 추측하지 않습니다"
        );
        assert_eq!(
            result.pointer("/credits").cloned().unwrap_or(Value::Null),
            json!([{"unit":"credits","remaining":15.0}]),
            "명시된 크레딧 유형만 합산합니다"
        );
    }

    #[test]
    fn provider_quota_gemini_rejects_non_int64_credit_strings() {
        for amount in ["", "-1", "1.5", "9223372036854775808", "NaN"] {
            let result = normalize(
                "gemini",
                &json!({"creditInfo":{"paidTier":{"availableCredits":[{"creditType":"GOOGLE_ONE_AI","creditAmount":amount}]}}}),
            );
            assert_eq!(
                result.pointer("/credits").cloned().unwrap_or(Value::Null),
                json!([]),
                "잘못된 int64 잔액을 거부합니다"
            );
        }
    }

    #[test]
    fn provider_quota_opencode_used_percent_and_exact_month() {
        let result = normalize(
            "opencode-go",
            &json!({"usage":{
                "rolling":{"percent":90,"resetsAt":"2030-01-01T00:00:00Z"},
                "weekly":{"percent":98},"monthly":{"percent":20}
            }}),
        );
        assert_eq!(
            result
                .pointer("/windows/0/remainingPercent")
                .cloned()
                .unwrap_or(Value::Null),
            10.0,
            "percent는 사용량입니다"
        );
        assert!(
            result
                .pointer("/windows/0")
                .cloned()
                .unwrap_or(Value::Null)
                .get("durationSeconds")
                .is_none(),
            "rolling을 5시간으로 가정하지 않습니다"
        );
        assert!(
            result
                .pointer("/windows/0")
                .cloned()
                .unwrap_or(Value::Null)
                .get("period")
                .is_none(),
            "rolling의 기간명도 추측하지 않습니다"
        );
        assert_eq!(
            result
                .pointer("/windows/2/period")
                .cloned()
                .unwrap_or(Value::Null),
            "month",
            "월을 일수로 치환하지 않습니다"
        );
        assert_eq!(
            result.pointer("/credits").cloned().unwrap_or(Value::Null),
            json!([]),
            "공개되지 않은 잔액을 만들지 않습니다"
        );
    }

    #[test]
    fn provider_quota_ollama_monthly_legacy_and_zero_allowance() {
        let result = normalize(
            "ollama-cloud",
            &json!({"included":{"balance_usd":5,"allowance_usd":20,"period":{"from":"2030-01-01","until":"2030-02-01"}},"purchased":{"balance_usd":0}}),
        );
        assert_eq!(
            result
                .pointer("/windows/0/remainingPercent")
                .cloned()
                .unwrap_or(Value::Null),
            25.0,
            "포함 잔액은 비율만 제공합니다"
        );
        assert_eq!(
            result
                .pointer("/windows/0/period")
                .cloned()
                .unwrap_or(Value::Null),
            "month",
            "공식 월 기간을 유지합니다"
        );
        assert_eq!(
            result.pointer("/credits").cloned().unwrap_or(Value::Null),
            json!([{"unit":"USD","remaining":0.0}]),
            "구매 잔액 0은 유효합니다"
        );
        assert_eq!(
            normalize(
                "ollama-cloud",
                &json!({"included":{"balance_usd":0,"allowance_usd":0}})
            )
            .pointer("/windows")
            .cloned()
            .unwrap_or(Value::Null),
            json!([]),
            "0/0은 미확인입니다"
        );
        let legacy = normalize(
            "ollama-cloud",
            &json!({"included":{"session":{"remaining_percent":0},"weekly":{"remaining_percent":80}}}),
        );
        assert_eq!(
            legacy
                .pointer("/windows")
                .cloned()
                .unwrap_or(Value::Null)
                .as_array()
                .map(Vec::len),
            Some(2),
            "구형 실제 창도 지원합니다"
        );
        assert!(
            legacy
                .pointer("/windows/0")
                .cloned()
                .unwrap_or(Value::Null)
                .get("durationSeconds")
                .is_none(),
            "구형 세션 기간도 추측하지 않습니다"
        );
    }

    #[test]
    fn provider_quota_openrouter_requires_both_totals_and_rejects_debt() {
        assert_eq!(
            normalize(
                "openrouter",
                &json!({"data":{"total_credits":10,"total_usage":4}})
            ),
            json!({"windows":[],"credits":[{"unit":"USD","remaining":6.0}]}),
            "계정 잔액만 제공합니다"
        );
        for payload in [
            json!({"data":{"limit_remaining":20}}),
            json!({"data":{"total_credits":10}}),
            json!({"data":{"total_credits":1,"total_usage":2}}),
        ] {
            assert_eq!(
                normalize("openrouter", &payload)
                    .pointer("/credits")
                    .cloned()
                    .unwrap_or(Value::Null),
                json!([]),
                "키 한도·없는 사용량·음수 잔액은 미확인입니다"
            );
        }
    }

    #[test]
    fn provider_quota_exhaustion_credits_only_and_invalid_partial() {
        let result = call(
            &json!({"op":"summarize","snapshot":{"windows":[],"credits":[{"unit":"USD","remaining":5}]}}),
        );
        assert_eq!(
            result
                .pointer("/subscriptionExhausted")
                .cloned()
                .unwrap_or(Value::Null),
            false,
            "크레딧만 있으면 구독 소진이 아닙니다"
        );
        assert!(result.get("window").is_none(), "구독 창을 만들지 않습니다");
        let result = summarize(&json!([
            {"id":"bad","remainingPercent":-1},{"id":"string","remainingPercent":"0"},
            {"id":"valid","remainingPercent":0}, {"id":"over","remainingPercent":101}
        ]));
        assert_eq!(
            result
                .pointer("/subscriptionExhausted")
                .cloned()
                .unwrap_or(Value::Null),
            true,
            "유효한 0만 소진입니다"
        );
        assert_eq!(
            result.pointer("/window/id").cloned().unwrap_or(Value::Null),
            "valid",
            "잘못된 창을 제외하고 선택합니다"
        );
        assert_eq!(
            summarize(&json!([]))
                .pointer("/subscriptionExhausted")
                .cloned()
                .unwrap_or(Value::Null),
            false,
            "알 수 없음은 소진이 아닙니다"
        );
    }

    #[test]
    fn provider_quota_null_empty_and_bad_inputs() {
        assert_eq!(
            plan_provider_quota_json("not-json"),
            "null",
            "JSON 실패는 null입니다"
        );
        for input in [
            Value::Null,
            json!({}),
            json!({"op":"normalize","format":"unknown","payload":{}}),
            json!({"op":"summarize","snapshot":null}),
        ] {
            assert_eq!(call(&input), Value::Null, "잘못된 계약 입력은 null입니다");
        }
        for format in [
            "chatgpt",
            "gemini",
            "opencode-go",
            "ollama-cloud",
            "openrouter",
        ] {
            assert_eq!(
                normalize(format, &json!({})),
                json!({"windows":[],"credits":[]}),
                "빈 응답은 미확인 목록입니다"
            );
            assert_eq!(
                normalize(format, &Value::Null),
                Value::Null,
                "응답 객체가 필요합니다"
            );
        }
    }

    #[test]
    fn provider_quota_invalid_durations_and_optional_fields_are_omitted() {
        for duration in [json!(0), json!(-1), json!("3600"), Value::Null] {
            let result = normalize(
                "chatgpt",
                &json!({"rate_limit":{"primary_window":{
                    "used_percent":25,"limit_window_seconds":duration,"reset_at":1_900_000_000
                }}}),
            );
            assert_eq!(
                result.pointer("/windows/0"),
                Some(&json!({"id":"primary","remainingPercent":75.0})),
                "불명확한 기간과 epoch reset은 생략합니다"
            );
        }
        let result = normalize(
            "ollama-cloud",
            &json!({"included":{"balance_usd":50,"allowance_usd":20}}),
        );
        assert_eq!(
            result.pointer("/windows/0/remainingPercent"),
            Some(&json!(100.0)),
            "포함량 초과 잔액은 100%로 제한합니다"
        );
    }

    #[test]
    fn provider_quota_additional_ids_do_not_depend_on_unrelated_feature_order() {
        let first = json!({"metered_feature":"review","limit_name":"cap","rate_limit":{"primary_window":{"used_percent":50}}});
        let second = json!({"metered_feature":"image","limit_name":"cap","rate_limit":{"primary_window":{"used_percent":50}}});
        let forward = normalize("chatgpt", &json!({"additional_rate_limits":[first,second]}));
        let reverse = normalize("chatgpt", &json!({"additional_rate_limits":[second,first]}));
        assert_eq!(
            forward.pointer("/windows/0/id"),
            reverse.pointer("/windows/1/id"),
            "다른 기능의 순서가 ID를 바꾸지 않습니다"
        );
        let forward_summary = call(&json!({"op":"summarize","snapshot":forward}));
        let reverse_summary = call(&json!({"op":"summarize","snapshot":reverse}));
        assert_eq!(
            forward_summary, reverse_summary,
            "입력 순서와 무관하게 ID로 동률을 해소합니다"
        );
    }

    #[test]
    fn provider_quota_summary_filters_bad_credits_without_inventing_zero() {
        let result = call(&json!({"op":"summarize","snapshot":{"windows":[
            {"id":"bad","remainingPercent":-1}, {"id":"unknown"}
        ],"credits":[
            {"unit":"USD","remaining":-1}, {"unit":"USD","remaining":"2"},
            {"unit":"EUR","remaining":10}, {"unit":"USD"},
            {"unit":"credits","remaining":0}, {"unit":"credits","unlimited":true}
        ]}}));
        assert_eq!(
            result,
            json!({"subscriptionExhausted":false,"credits":[
                {"unit":"credits","remaining":0.0}, {"unit":"credits","unlimited":true}
            ]}),
            "알 수 없음은 소진이나 잔액 0으로 바뀌지 않습니다"
        );
    }

    #[test]
    fn provider_quota_gemini_sum_overflow_and_missing_credits_are_unknown() {
        for entries in [
            json!([]),
            json!([
                {"creditType":"GOOGLE_ONE_AI","creditAmount":"9223372036854775807"},
                {"creditType":"GOOGLE_ONE_AI","creditAmount":"1"}
            ]),
        ] {
            let result = normalize(
                "gemini",
                &json!({"creditInfo":{"paidTier":{"availableCredits":entries}}}),
            );
            assert_eq!(
                result.get("credits"),
                Some(&json!([])),
                "미제공 또는 int64 합산 초과는 미확인입니다"
            );
        }
    }

    #[test]
    fn provider_quota_interval_defaults_and_integer_clamping() {
        for value in [Value::Null, json!("30"), json!(0.5), json!({}), json!(true)] {
            assert_eq!(
                call(&json!({"op":"interval","value":value})),
                30.0,
                "잘못된 값은 기본 30초입니다"
            );
        }
        for (value, expected) in [
            (-1, 10.0),
            (0, 10.0),
            (10, 10.0),
            (31, 31.0),
            (3601, 3600.0),
        ] {
            assert_eq!(
                call(&json!({"op":"interval","value":value})),
                expected,
                "정수는 허용 범위로 제한합니다"
            );
        }
        assert_eq!(
            call(&json!({"op":"interval"})),
            30.0,
            "누락은 기본 30초입니다"
        );
    }
}
