//! Deterministic policy for RAG indexing performance protection.

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Maximum delay the controller may insert between provider requests.
const MAX_ADAPTIVE_YIELD_MS: u32 = 250;

/// Current protection level applied to RAG indexing.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Configured indexing pressure is safe.
    Normal,
    /// Batch pressure is reduced while indexing continues.
    Throttled,
    /// Indexing is parked until recovery is confirmed.
    Paused,
}

impl Mode {
    /// Returns the stable wire-format value.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Throttled => "throttled",
            Self::Paused => "paused",
        }
    }

    /// Parses a stable wire-format value.
    fn parse(value: &str) -> Option<Self> {
        match value {
            "normal" => Some(Self::Normal),
            "throttled" => Some(Self::Throttled),
            "paused" => Some(Self::Paused),
            _ => None,
        }
    }
}

/// Measurement channel or transition that explains the current state.
#[derive(Clone, Copy)]
enum ReasonKind {
    /// Embedding provider batch duration was slow.
    Batch,
    /// Renderer event-loop response was slow.
    EventLoop,
    /// A paused job resumed with conservative settings.
    Resumed,
}

impl ReasonKind {
    /// Returns the stable wire-format value.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Batch => "batch",
            Self::EventLoop => "event-loop",
            Self::Resumed => "resumed",
        }
    }

    /// Parses a stable wire-format value.
    fn parse(value: &str) -> Option<Self> {
        match value {
            "batch" => Some(Self::Batch),
            "event-loop" => Some(Self::EventLoop),
            "resumed" => Some(Self::Resumed),
            _ => None,
        }
    }
}

/// Validated performance-guard configuration.
struct Config {
    /// Whether adaptive protection is enabled.
    enabled: bool,
    /// User-configured embedding batch size.
    initial_batch_size: u32,
    /// Event-loop delay that starts cooperative yielding.
    slow_event_loop_threshold_ms: f64,
    /// Provider request duration used to resize future batches.
    slow_batch_threshold_ms: f64,
}

/// Complete deterministic state carried between policy events.
#[derive(Clone)]
struct PolicyState {
    /// Current protection level.
    mode: Mode,
    /// Effective embedding batch size.
    current_batch_size: u32,
    /// Effective cooperative delay.
    current_yield_ms: u32,
    /// Consecutive slow provider samples.
    slow_batch_samples: u32,
    /// Consecutive slow renderer samples.
    slow_event_loop_samples: u32,
    /// Consecutive healthy provider samples.
    healthy_batch_samples: u32,
    /// Consecutive healthy renderer samples.
    healthy_event_loop_samples: u32,
    /// Cause of the current non-normal state.
    reason_kind: Option<ReasonKind>,
    /// Duration associated with the current cause.
    reason_ms: Option<f64>,
    /// Epoch deadline for automatic recovery.
    pause_until_ms: Option<f64>,
    /// Most recent slow measurement channel.
    last_slow_kind: Option<ReasonKind>,
    /// Most recent slow duration.
    last_slow_ms: Option<f64>,
}

impl PolicyState {
    /// Creates the configured normal state with cleared counters.
    const fn baseline(config: &Config) -> Self {
        Self {
            mode: Mode::Normal,
            current_batch_size: config.initial_batch_size,
            current_yield_ms: 0,
            slow_batch_samples: 0,
            slow_event_loop_samples: 0,
            healthy_batch_samples: 0,
            healthy_event_loop_samples: 0,
            reason_kind: None,
            reason_ms: None,
            pause_until_ms: None,
            last_slow_kind: None,
            last_slow_ms: None,
        }
    }

    /// Creates the conservative state used immediately after a pause.
    const fn safe_resume(previous: &Self, _config: &Config) -> Self {
        Self {
            mode: Mode::Throttled,
            current_batch_size: 1,
            current_yield_ms: 250,
            slow_batch_samples: 0,
            slow_event_loop_samples: 0,
            healthy_batch_samples: 0,
            healthy_event_loop_samples: 0,
            reason_kind: Some(ReasonKind::Resumed),
            reason_ms: None,
            pause_until_ms: None,
            last_slow_kind: previous.last_slow_kind,
            last_slow_ms: previous.last_slow_ms,
        }
    }

    /// Reports whether the controller has returned to its zero-delay ceiling.
    fn refresh_mode(&mut self, config: &Config) {
        if self.mode != Mode::Paused {
            self.mode = if self.current_batch_size == config.initial_batch_size
                && self.current_yield_ms == 0
            {
                Mode::Normal
            } else {
                Mode::Throttled
            };
        }
    }
}

/// Plans one performance-guard state transition from deterministic JSON input.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_performance_guard_json(input_json: &str) -> String {
    let Ok(input) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(input) = input.as_object() else {
        return String::new();
    };
    let Some(config) = parse_config(input) else {
        return String::new();
    };
    let Some(now_ms) = finite_non_negative(input.get("nowMs")) else {
        return String::new();
    };
    let Some(event) = input.get("event").and_then(JsonValue::as_object) else {
        return String::new();
    };
    let Some(kind) = event.get("kind").and_then(JsonValue::as_str) else {
        return String::new();
    };

    if !config.enabled {
        return serialize_state(&PolicyState::baseline(&config));
    }

    let mut state = if matches!(kind, "initialize" | "reset") {
        PolicyState::baseline(&config)
    } else {
        let Some(parsed) = input.get("state").and_then(parse_state) else {
            return String::new();
        };
        parsed
    };

    match kind {
        "initialize" | "reset" => {}
        "timer_tick" => {
            if state.mode == Mode::Paused
                && state
                    .pause_until_ms
                    .is_some_and(|deadline| deadline <= now_ms)
            {
                state = PolicyState::safe_resume(&state, &config);
            }
        }
        "force_resume" => {
            if state.mode == Mode::Paused {
                state = PolicyState::safe_resume(&state, &config);
            }
        }
        "batch_sample" => {
            let Some(duration_ms) = finite_non_negative(event.get("durationMs")) else {
                return String::new();
            };
            let Some(batch_size) = positive_u32(event.get("batchSize")) else {
                return String::new();
            };
            if resume_expired_pause(&mut state, &config, now_ms) {
                record_batch_sample(&mut state, &config, duration_ms, batch_size);
            }
        }
        "event_loop_sample" => {
            let Some(duration_ms) = finite_non_negative(event.get("durationMs")) else {
                return String::new();
            };
            if resume_expired_pause(&mut state, &config, now_ms) {
                record_event_loop_sample(&mut state, &config, duration_ms);
            }
        }
        _ => return String::new(),
    }

    serialize_state(&state)
}

/// Resumes an expired pause and reports whether a sample may be processed.
fn resume_expired_pause(state: &mut PolicyState, config: &Config, now_ms: f64) -> bool {
    if state.mode != Mode::Paused {
        return true;
    }
    if state
        .pause_until_ms
        .is_some_and(|deadline| deadline <= now_ms)
    {
        *state = PolicyState::safe_resume(state, config);
        return true;
    }
    false
}

/// Resizes future provider requests toward a stable target duration.
fn record_batch_sample(
    state: &mut PolicyState,
    config: &Config,
    duration_ms: f64,
    batch_size: u32,
) {
    if duration_ms == 0.0 {
        return;
    }
    let desired = bounded_rounded_u32(
        f64::from(batch_size) * config.slow_batch_threshold_ms / duration_ms,
        1,
        config.initial_batch_size,
    );
    if desired < state.current_batch_size {
        state.current_batch_size = u32::midpoint(state.current_batch_size, desired).max(1);
        state.slow_batch_samples = state.slow_batch_samples.saturating_add(1).min(2);
        state.healthy_batch_samples = 0;
        state.reason_kind = Some(ReasonKind::Batch);
        state.reason_ms = Some(duration_ms);
        state.last_slow_kind = Some(ReasonKind::Batch);
        state.last_slow_ms = Some(duration_ms);
    } else if duration_ms <= config.slow_batch_threshold_ms * 0.8 {
        state.slow_batch_samples = 0;
        state.healthy_batch_samples = state.healthy_batch_samples.saturating_add(1).min(2);
        if state.healthy_batch_samples >= 2 {
            let growth = state.current_batch_size.div_ceil(4).max(1);
            state.current_batch_size = state
                .current_batch_size
                .saturating_add(growth)
                .min(config.initial_batch_size);
            state.healthy_batch_samples = 0;
        }
    }
    state.refresh_mode(config);
}

/// Applies one renderer event-loop duration sample.
fn record_event_loop_sample(state: &mut PolicyState, config: &Config, duration_ms: f64) {
    if duration_ms > config.slow_event_loop_threshold_ms {
        state.slow_event_loop_samples = state.slow_event_loop_samples.saturating_add(1);
        state.healthy_event_loop_samples = 0;
        state.last_slow_kind = Some(ReasonKind::EventLoop);
        state.last_slow_ms = Some(duration_ms);
        let pressure_ms = bounded_rounded_u32(
            (duration_ms - config.slow_event_loop_threshold_ms).ceil(),
            1,
            MAX_ADAPTIVE_YIELD_MS,
        );
        state.current_yield_ms = state.current_yield_ms.max(pressure_ms);
        state.reason_kind = Some(ReasonKind::EventLoop);
        state.reason_ms = Some(duration_ms);
        state.refresh_mode(config);
        return;
    }

    state.slow_event_loop_samples = 0;
    state.healthy_event_loop_samples = state.healthy_event_loop_samples.saturating_add(1).min(2);
    if state.healthy_event_loop_samples >= 2 {
        state.current_yield_ms = if state.current_yield_ms <= 32 {
            0
        } else {
            state
                .current_yield_ms
                .saturating_sub(state.current_yield_ms.div_ceil(2))
        };
        state.healthy_event_loop_samples = 0;
    }
    state.refresh_mode(config);
}

/// Parses and validates the policy configuration object.
fn parse_config(input: &JsonMap<String, JsonValue>) -> Option<Config> {
    let config = input.get("config")?.as_object()?;
    non_negative_u32(config.get("initialYieldMs"))?;
    Some(Config {
        enabled: config.get("enabled")?.as_bool()?,
        initial_batch_size: positive_u32(config.get("initialBatchSize"))?,
        slow_event_loop_threshold_ms: positive_finite(config.get("slowEventLoopThresholdMs"))?,
        slow_batch_threshold_ms: positive_finite(config.get("slowBatchThresholdMs"))?,
    })
}

/// Converts one finite measurement to a bounded integer without unchecked casts.
fn bounded_rounded_u32(value: f64, minimum: u32, maximum: u32) -> u32 {
    if !value.is_finite() {
        return minimum;
    }
    value
        .round()
        .clamp(f64::from(minimum), f64::from(maximum))
        .to_string()
        .parse::<u32>()
        .unwrap_or(minimum)
}

/// Parses and validates a previously serialized policy state.
fn parse_state(value: &JsonValue) -> Option<PolicyState> {
    let state = value.as_object()?;
    Some(PolicyState {
        mode: Mode::parse(state.get("mode")?.as_str()?)?,
        current_batch_size: positive_u32(state.get("currentBatchSize"))?,
        current_yield_ms: non_negative_u32(state.get("currentYieldMs"))?,
        slow_batch_samples: non_negative_u32(state.get("slowBatchSamples"))?,
        slow_event_loop_samples: non_negative_u32(state.get("slowEventLoopSamples"))?,
        healthy_batch_samples: non_negative_u32(state.get("healthyBatchSamples"))?,
        healthy_event_loop_samples: non_negative_u32(state.get("healthyEventLoopSamples"))?,
        reason_kind: parse_optional_reason(state.get("reasonKind")?).ok()?,
        reason_ms: parse_optional_finite(state.get("reasonMs")?).ok()?,
        pause_until_ms: parse_optional_finite(state.get("pauseUntilMs")?).ok()?,
        last_slow_kind: parse_optional_reason(state.get("lastSlowKind")?).ok()?,
        last_slow_ms: parse_optional_finite(state.get("lastSlowMs")?).ok()?,
    })
}

/// Serializes a validated policy state for the TypeScript bridge.
fn serialize_state(state: &PolicyState) -> String {
    json!({
        "mode": state.mode.as_str(),
        "currentBatchSize": state.current_batch_size,
        "currentYieldMs": state.current_yield_ms,
        "slowBatchSamples": state.slow_batch_samples,
        "slowEventLoopSamples": state.slow_event_loop_samples,
        "healthyBatchSamples": state.healthy_batch_samples,
        "healthyEventLoopSamples": state.healthy_event_loop_samples,
        "reasonKind": state.reason_kind.map(ReasonKind::as_str),
        "reasonMs": state.reason_ms,
        "pauseUntilMs": state.pause_until_ms,
        "lastSlowKind": state.last_slow_kind.map(ReasonKind::as_str),
        "lastSlowMs": state.last_slow_ms,
    })
    .to_string()
}

/// Parses a positive unsigned integer.
fn positive_u32(value: Option<&JsonValue>) -> Option<u32> {
    let value = non_negative_u32(value)?;
    (value > 0).then_some(value)
}

/// Parses a non-negative unsigned integer.
fn non_negative_u32(value: Option<&JsonValue>) -> Option<u32> {
    u32::try_from(value?.as_u64()?).ok()
}

/// Parses a positive finite number.
fn positive_finite(value: Option<&JsonValue>) -> Option<f64> {
    let value = finite_non_negative(value)?;
    (value > 0.0).then_some(value)
}

/// Parses a non-negative finite number.
fn finite_non_negative(value: Option<&JsonValue>) -> Option<f64> {
    let value = value?.as_f64()?;
    (value.is_finite() && value >= 0.0).then_some(value)
}

/// Parses a nullable reason while preserving invalid input as an error.
fn parse_optional_reason(value: &JsonValue) -> Result<Option<ReasonKind>, ()> {
    match value {
        JsonValue::Null => Ok(None),
        JsonValue::String(value) => ReasonKind::parse(value).map(Some).ok_or(()),
        _ => Err(()),
    }
}

/// Parses a nullable finite duration while preserving invalid input as an error.
fn parse_optional_finite(value: &JsonValue) -> Result<Option<f64>, ()> {
    match value {
        JsonValue::Null => Ok(None),
        value => finite_non_negative(Some(value)).map(Some).ok_or(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a complete bridge input for one policy event.
    fn input(state: &JsonValue, kind: &str, duration_ms: Option<f64>, now_ms: f64) -> String {
        let event = duration_ms.map_or_else(
            || json!({ "kind": kind }),
            |duration_ms| {
                if kind == "batch_sample" {
                    json!({ "kind": kind, "durationMs": duration_ms, "batchSize": 32 })
                } else {
                    json!({ "kind": kind, "durationMs": duration_ms })
                }
            },
        );
        json!({
            "config": {
                "enabled": true,
                "initialBatchSize": 32,
                "initialYieldMs": 25,
                "slowEventLoopThresholdMs": 150,
                "slowBatchThresholdMs": 3000,
            },
            "state": state,
            "event": event,
            "nowMs": now_ms,
        })
        .to_string()
    }

    /// Runs one event and parses the returned policy state.
    fn plan(state: &JsonValue, kind: &str, duration_ms: Option<f64>, now_ms: f64) -> JsonValue {
        let output = plan_rag_performance_guard_json(&input(state, kind, duration_ms, now_ms));
        serde_json::from_str(&output).unwrap_or(JsonValue::Null)
    }

    #[test]
    fn slow_batches_resize_the_next_request_without_fixed_sleep() {
        let mut state = plan(&JsonValue::Null, "initialize", None, 1_000.0);
        state = plan(&state, "batch_sample", Some(6_000.0), 1_000.0);
        assert_eq!(state.get("mode"), Some(&json!("throttled")));
        assert_eq!(state.get("currentBatchSize"), Some(&json!(24)));
        assert_eq!(state.get("currentYieldMs"), Some(&json!(0)));
        assert!(state.get("pauseUntilMs").is_some_and(JsonValue::is_null));
    }

    #[test]
    fn event_loop_pressure_yields_without_pausing_or_resizing_batches() {
        let mut state = plan(&JsonValue::Null, "initialize", None, 1_000.0);
        for _ in 0..3 {
            state = plan(&state, "event_loop_sample", Some(300.0), 1_000.0);
        }
        assert_eq!(state.get("mode"), Some(&json!("throttled")));
        assert_eq!(state.get("currentBatchSize"), Some(&json!(32)));
        assert_eq!(state.get("currentYieldMs"), Some(&json!(150)));
        assert!(state.get("pauseUntilMs").is_some_and(JsonValue::is_null));
    }

    #[test]
    fn invalid_state_fails_closed() {
        let output = plan_rag_performance_guard_json(&input(
            &json!({ "mode": "unknown" }),
            "batch_sample",
            Some(100.0),
            1_000.0,
        ));
        assert_eq!(output, "");
    }
}

/// 로컬 admission은 기존 원격 포함 guard와 상태 및 중단 정책을 공유하지 않는다.
/// 최근 종료 표본의 유효 기간이다.
pub const LOCAL_SAMPLE_MAX_AGE_MS: f64 = 5_000.0;
/// JS에서 손실 없이 왕복할 수 있는 정수 상한이다.
const MAX_WIRE_INTEGER: u64 = 9_007_199_254_740_991;

/// 실제 miss 관측과 한 단계 trial에 필요한 상태만 호스트가 왕복 보존한다.
struct LocalAdmissionState {
    /// 실제로 관측한 로컬 backend다.
    backend: String,
    /// 직전 호스트 안전 상한이다. 현재 배치 이하의 축소도 감지한다.
    max_batch_size: u32,
    /// 다음 실제 miss 배치의 상한이다.
    batch_size: u32,
    /// 연속된 건강한 완전 배치 표본 수다.
    healthy_samples: u32,
    /// 이전 완전 배치의 실제 miss 처리율이다.
    previous_rate: Option<f64>,
    /// 증량 직전 비교할 처리율이다.
    trial_base_rate: Option<f64>,
    /// 중복 및 역순 표본을 막는 종료 시각이다.
    last_sample_ended_at_ms: Option<f64>,
    /// lag 악화를 판정하는 직전 관측값이다.
    last_lag_ms: Option<f64>,
}

impl LocalAdmissionState {
    /// 안전한 한 행 기준선을 만든다.
    fn baseline(backend: &str, max_batch_size: u32, ended_at_ms: Option<f64>) -> Self {
        Self {
            backend: backend.to_owned(),
            max_batch_size,
            batch_size: 1,
            healthy_samples: 0,
            previous_rate: None,
            trial_base_rate: None,
            last_sample_ended_at_ms: ended_at_ms,
            last_lag_ms: None,
        }
    }

    /// 필수 wire 필드와 수치 범위를 검증한다.
    fn parse(value: &JsonValue) -> Option<Self> {
        let value = value.as_object()?;
        let state = Self {
            backend: local_backend(value.get("backend")?)?.to_owned(),
            max_batch_size: positive_u32(value.get("maxBatchSize"))?,
            batch_size: positive_u32(value.get("batchSize"))?,
            healthy_samples: non_negative_u32(value.get("healthySamples"))?,
            previous_rate: local_optional_number(value.get("previousRate")?).ok()?,
            trial_base_rate: local_optional_number(value.get("trialBaseRate")?).ok()?,
            last_sample_ended_at_ms: local_optional_number(value.get("lastSampleEndedAtMs")?)
                .ok()?,
            last_lag_ms: local_optional_number(value.get("lastLagMs")?).ok()?,
        };
        if state.batch_size > state.max_batch_size
            || state.healthy_samples > 1
            || state.previous_rate.is_some_and(|rate| rate == 0.0)
            || state.trial_base_rate.is_some_and(|rate| rate == 0.0)
            || (state.trial_base_rate.is_some()
                && (state.batch_size == 1 || state.previous_rate.is_none()))
            || ((state.healthy_samples > 0 || state.batch_size > 1)
                && state.previous_rate.is_none())
            || (state.last_lag_ms.is_some() && state.last_sample_ended_at_ms.is_none())
            || (state.previous_rate.is_some()
                && (state.last_sample_ended_at_ms.is_none() || state.last_lag_ms.is_none()))
            || (state.trial_base_rate.is_some()
                && (state.healthy_samples != 0 || state.trial_base_rate != state.previous_rate))
        {
            return None;
        }
        Some(state)
    }

    /// 상태와 추가 최적화 admission만 직렬화한다.
    fn serialize(&self, prefetch: bool) -> String {
        json!({
            "state": {
                "backend": self.backend, "maxBatchSize": self.max_batch_size,
                "batchSize": self.batch_size, "healthySamples": self.healthy_samples, "previousRate": self.previous_rate,
                "trialBaseRate": self.trial_base_rate,
                "lastSampleEndedAtMs": self.last_sample_ended_at_ms, "lastLagMs": self.last_lag_ms,
            },
            "nextBatchSize": self.batch_size, "admitSourcePrefetch": prefetch,
        })
        .to_string()
    }
}

/// null은 미지원 표본이며 0 여유나 정상 관측으로 대체하지 않는다.
struct LocalAdmissionSample {
    /// 실제 추론 종료 시각이다.
    ended_at_ms: Option<f64>,
    /// 캐시를 제외한 실제 miss 행 수다.
    work_units: Option<u32>,
    /// 실제 추론 경과 시간이다.
    duration_ms: Option<f64>,
    /// 호스트 event-loop 지연 표본이다.
    lag_ms: Option<f64>,
    /// 실제 RSS이며 heap이나 weights 크기가 아니다.
    rss_bytes: Option<u64>,
    /// 호스트가 실제 측정한 가용 메모리다.
    available_bytes: Option<u64>,
}

impl LocalAdmissionSample {
    /// 필수 wire 필드와 수치 범위를 검증한다.
    fn parse(value: &JsonValue, now_ms: f64) -> Option<Self> {
        let sample = Self {
            ended_at_ms: local_optional_number(value.get("endedAtMs")?).ok()?,
            work_units: local_optional_u32(value.get("workUnits")?).ok()?,
            duration_ms: local_optional_number(value.get("durationMs")?).ok()?,
            lag_ms: local_optional_number(value.get("lagMs")?).ok()?,
            rss_bytes: local_optional_bytes(value.get("rssBytes")?).ok()?,
            available_bytes: local_optional_bytes(value.get("availableBytes")?).ok()?,
        };
        if sample.ended_at_ms.is_some_and(|ended| {
            ended > now_ms || sample.duration_ms.is_some_and(|duration| duration > ended)
        }) {
            return None;
        }
        // 극소 duration에 의한 rate 무한대도 wire 실패로 닫는다.
        if let (Some(work), Some(duration)) = (sample.work_units, sample.duration_ms)
            && duration > 0.0
            && (!(f64::from(work) / duration).is_finite()
                || f64::from(work) / duration > 9_007_199_254_740_991.0)
        {
            return None;
        }
        Some(sample)
    }
}

/// 호스트 원장은 실제 물리 idle까지 유지하며 여기서 취소를 이유로 감산하지 않는다.
struct LocalAdmissionLimits {
    /// 기존 backend의 안전 배치 상한이다.
    max_batch_size: u32,
    /// 호스트의 응답성 시간 상한이다.
    target_batch_ms: f64,
    /// 호스트의 event-loop 지연 상한이다.
    max_lag_ms: f64,
    /// 기존 source 원장의 공유 예산이다.
    source_budget_bytes: u64,
    /// 유지 중 예약과 다음 source charge의 합이다.
    source_charge: u64,
    /// 대기 중인 foreground 작업 수다.
    foreground_pending: u32,
    /// 실제로 아직 종료되지 않은 source 수다.
    physical_source_count: u32,
    /// 실제로 실행 중인 추론 수다.
    physical_inference_count: u32,
    /// 다음 source 한 개에 대한 예약 charge다.
    planned_source_bytes: u64,
}

impl LocalAdmissionLimits {
    /// 필수 wire 필드와 수치 범위를 검증한다.
    fn parse(input: &JsonMap<String, JsonValue>) -> Option<Self> {
        let reserved = local_bytes(input.get("reservedSourceBytes")?)?;
        let planned = local_bytes(input.get("plannedSourceBytes")?)?;
        let source_charge = reserved.checked_add(planned)?;
        if source_charge > MAX_WIRE_INTEGER {
            return None;
        }
        Some(Self {
            max_batch_size: positive_u32(input.get("maxBatchSize"))?,
            target_batch_ms: positive_finite(input.get("targetBatchMs"))
                .filter(|number| *number <= 9_007_199_254_740_991.0)?,
            max_lag_ms: positive_finite(input.get("maxLagMs"))
                .filter(|number| *number <= 9_007_199_254_740_991.0)?,
            source_budget_bytes: local_bytes(input.get("sourceBudgetBytes")?)?,
            source_charge,
            foreground_pending: non_negative_u32(input.get("foregroundPending"))?,
            physical_source_count: non_negative_u32(input.get("physicalSourceCount"))?,
            physical_inference_count: non_negative_u32(input.get("physicalInferenceCount"))?,
            planned_source_bytes: planned,
        })
    }
}

/// 다음 로컬 BG 배치와 추론 중 source 한 개의 추가 admission만 계산한다.
/// baseline 실행의 중단·물리 슬롯 해제·작업자 증설 권한은 반환하지 않는다.
#[must_use]
#[wasm_bindgen]
pub fn plan_local_rag_admission_json(input_json: &str) -> String {
    let Some(output) = plan_local_admission(input_json) else {
        return String::new();
    };
    output
}

/// 검증한 호스트 관측에서 한 번의 계획을 계산한다.
fn plan_local_admission(input_json: &str) -> Option<String> {
    let input: JsonValue = serde_json::from_str(input_json).ok()?;
    let input = input.as_object()?;
    let backend = local_backend(input.get("backend")?)?;
    let now_ms = local_number(input.get("nowMs")?)?;
    let limits = LocalAdmissionLimits::parse(input)?;
    let sample = match input.get("sample")? {
        JsonValue::Null => None,
        value => Some(LocalAdmissionSample::parse(value, now_ms)?),
    };
    let ended = sample.as_ref().and_then(|sample| sample.ended_at_ms);
    let mut state = match input.get("state")? {
        JsonValue::Null => {
            return Some(
                LocalAdmissionState::baseline(backend, limits.max_batch_size, ended)
                    .serialize(false),
            );
        }
        value => LocalAdmissionState::parse(value)?,
    };
    if state
        .last_sample_ended_at_ms
        .is_some_and(|time| time > now_ms)
    {
        return None;
    }
    if state.backend != backend || limits.max_batch_size < state.max_batch_size {
        return Some(
            LocalAdmissionState::baseline(backend, limits.max_batch_size, ended).serialize(false),
        );
    }
    // 확장은 이력을 지우지 않되 다음 호출의 축소 비교 기준에는 즉시 반영한다.
    state.max_batch_size = limits.max_batch_size;
    let Some(sample) = sample else {
        return Some(
            LocalAdmissionState::baseline(
                backend,
                limits.max_batch_size,
                state.last_sample_ended_at_ms,
            )
            .serialize(false),
        );
    };
    let Some((ended, work, duration, lag, rss, available)) = local_complete_sample(&sample) else {
        return Some(
            LocalAdmissionState::baseline(
                backend,
                limits.max_batch_size,
                state.last_sample_ended_at_ms,
            )
            .serialize(false),
        );
    };
    let fresh = now_ms - ended <= LOCAL_SAMPLE_MAX_AGE_MS
        && state
            .last_sample_ended_at_ms
            .is_none_or(|previous| ended >= previous);
    let lag_pressure = lag > limits.max_lag_ms
        || state
            .last_lag_ms
            .is_some_and(|previous| lag > previous && lag > limits.max_lag_ms / 2.0);
    // RSS는 실제 상주량 그대로만 사용한다. 가용량의 보수적 여유를 요구하며 RSS 상한이라고 부르지 않는다.
    let memory_pressure = rss == 0
        || available < rss.div_ceil(10)
        || available < limits.source_charge
        || limits.source_charge > limits.source_budget_bytes;
    if !fresh
        || work == 0
        || duration == 0.0
        || limits.foreground_pending > 0
        || limits.physical_inference_count > 1
        || lag_pressure
        || memory_pressure
        || duration > limits.target_batch_ms
    {
        let watermark = state
            .last_sample_ended_at_ms
            .map_or(ended, |previous| previous.max(ended));
        return Some(
            LocalAdmissionState::baseline(backend, limits.max_batch_size, Some(watermark))
                .serialize(false),
        );
    }
    let new_sample = state
        .last_sample_ended_at_ms
        .is_none_or(|previous| ended > previous);
    if new_sample {
        local_record_miss(&mut state, &limits, work, duration);
        state.last_sample_ended_at_ms = Some(ended);
        state.last_lag_ms = Some(lag);
    }
    let prefetch = limits.physical_source_count == 0
        && limits.physical_inference_count == 1
        && limits.planned_source_bytes > 0
        && state.trial_base_rate.is_none();
    Some(state.serialize(prefetch))
}

/// 완전한 실제 miss 표본만 trial과 증량에 반영한다.
fn local_record_miss(
    state: &mut LocalAdmissionState,
    limits: &LocalAdmissionLimits,
    work: u32,
    duration: f64,
) {
    // 말단의 부분 배치나 중복된 표본은 trial의 처리량 증거가 아니다.
    if work != state.batch_size {
        state.healthy_samples = 0;
        return;
    }
    let rate = f64::from(work) / duration;
    if let Some(base) = state.trial_base_rate.take() {
        if rate <= base * 1.05 {
            state.batch_size = state.batch_size.saturating_sub(1).max(1);
            state.previous_rate = Some(base);
        } else {
            state.previous_rate = Some(rate);
        }
        state.healthy_samples = 0;
        return;
    }
    state.previous_rate = Some(rate);
    state.healthy_samples = state.healthy_samples.saturating_add(1);
    if state.healthy_samples >= 2 {
        if state.batch_size < limits.max_batch_size {
            state.batch_size += 1;
            state.trial_base_rate = Some(rate);
        }
        state.healthy_samples = 0;
    }
}

/// 모든 관측값이 존재할 때만 표본을 제공한다.
fn local_complete_sample(sample: &LocalAdmissionSample) -> Option<(f64, u32, f64, f64, u64, u64)> {
    Some((
        sample.ended_at_ms?,
        sample.work_units?,
        sample.duration_ms?,
        sample.lag_ms?,
        sample.rss_bytes?,
        sample.available_bytes?,
    ))
}

/// 지원하는 로컬 backend만 허용한다.
fn local_backend(value: &JsonValue) -> Option<&str> {
    value
        .as_str()
        .filter(|backend| matches!(*backend, "cpu" | "webgpu"))
}

/// 유한한 비음수 wire 수치를 검증한다.
fn local_number(value: &JsonValue) -> Option<f64> {
    finite_non_negative(Some(value)).filter(|number| *number <= 9_007_199_254_740_991.0)
}

/// 미지원 수치와 잘못된 수치를 구별한다.
fn local_optional_number(value: &JsonValue) -> Result<Option<f64>, ()> {
    if value.is_null() {
        Ok(None)
    } else {
        local_number(value).map(Some).ok_or(())
    }
}

/// 안전한 정수 바이트를 검증한다.
fn local_bytes(value: &JsonValue) -> Option<u64> {
    value.as_u64().filter(|number| *number <= MAX_WIRE_INTEGER)
}

/// 미지원 바이트와 잘못된 바이트를 구별한다.
fn local_optional_bytes(value: &JsonValue) -> Result<Option<u64>, ()> {
    if value.is_null() {
        Ok(None)
    } else {
        local_bytes(value).map(Some).ok_or(())
    }
}

/// 미지원 작업 수와 잘못된 작업 수를 구별한다.
fn local_optional_u32(value: &JsonValue) -> Result<Option<u32>, ()> {
    if value.is_null() {
        Ok(None)
    } else {
        non_negative_u32(Some(value)).map(Some).ok_or(())
    }
}

#[cfg(test)]
mod local_admission_tests {
    use super::*;

    /// 합성 JSON 필드를 안전하게 읽는다.
    fn field<'a>(value: &'a JsonValue, path: &str) -> &'a JsonValue {
        path.split('.').fold(value, |value, key| {
            value.get(key).unwrap_or(&JsonValue::Null)
        })
    }

    /// 합성 JSON 필드를 안전하게 변경한다.
    fn put(path: &str, replacement: JsonValue, value: &mut JsonValue) {
        let mut keys = path.split('.').peekable();
        let mut target = value;
        while let Some(key) = keys.next() {
            assert!(target.get(key).is_some(), "합성 필드 존재");
            let Some(next) = target.get_mut(key) else {
                return;
            };
            target = next;
            if keys.peek().is_none() {
                *target = replacement;
                return;
            }
        }
    }

    /// 실제 자료와 무관한 물리 원장 및 miss 표본이다.
    /// 독립적인 합성 입력을 만든다.
    fn input() -> JsonValue {
        json!({
            "backend": "cpu", "maxBatchSize": 4, "targetBatchMs": 100,
            "maxLagMs": 20, "sourceBudgetBytes": 1000, "nowMs": 1000,
            "foregroundPending": 0, "physicalSourceCount": 0, "physicalInferenceCount": 1,
            "reservedSourceBytes": 200, "plannedSourceBytes": 300, "state": null,
            "sample": { "endedAtMs": 1000, "workUnits": 1, "durationMs": 10,
                "lagMs": 1, "rssBytes": 1000, "availableBytes": 10000 }
        })
    }

    /// 실제 Rust 계획 결과를 읽는다.
    fn plan(input: &JsonValue) -> JsonValue {
        let wire = plan_local_rag_admission_json(&input.to_string());
        let parsed = serde_json::from_str(&wire);
        assert!(parsed.is_ok(), "유효한 합성 admission 출력");
        parsed.unwrap_or(JsonValue::Null)
    }

    /// 상태와 실제 종료 시각을 다음 관측으로 진행한다.
    fn advance(input: &mut JsonValue) -> JsonValue {
        let output = plan(input);
        put("state", field(&output, "state").clone(), input);
        put(
            "nowMs",
            json!(field(input, "nowMs").as_u64().unwrap_or(0) + 100),
            input,
        );
        put("sample.endedAtMs", field(input, "nowMs").clone(), input);
        output
    }

    /// 두 건강한 표본 뒤 한 단계 trial을 만든다.
    fn trial() -> JsonValue {
        let mut input = input();
        assert_eq!(field(&advance(&mut input), "nextBatchSize"), 1);
        assert_eq!(field(&advance(&mut input), "nextBatchSize"), 1);
        assert_eq!(field(&advance(&mut input), "nextBatchSize"), 2);
        input
    }

    #[test]
    fn healthy_misses_grow_one_step_and_rate_loss_or_no_gain_reverts_trial() {
        for duration in [20, 30] {
            let mut input = trial();
            put("sample.workUnits", json!(2), &mut input);
            put("sample.durationMs", json!(duration), &mut input);
            assert_eq!(field(&plan(&input), "nextBatchSize"), 1);
        }
        let mut input = trial();
        put("sample.workUnits", json!(2), &mut input);
        put("sample.durationMs", json!(10), &mut input);
        let accepted = advance(&mut input);
        assert_eq!(field(&accepted, "nextBatchSize"), 2);
        assert!(field(&accepted, "state.trialBaseRate").is_null());
        assert_eq!(field(&advance(&mut input), "nextBatchSize"), 2);
        assert_eq!(field(&advance(&mut input), "nextBatchSize"), 3);
    }

    #[test]
    fn every_max_shrink_resets_even_when_current_batch_fits() {
        for backend in ["cpu", "webgpu"] {
            for max in [3, 2, 1] {
                let mut input = input();
                put("backend", json!(backend), &mut input);
                advance(&mut input);
                advance(&mut input);
                advance(&mut input);
                put("sample.workUnits", json!(2), &mut input);
                assert_eq!(field(&advance(&mut input), "nextBatchSize"), 2);
                put("maxBatchSize", json!(max), &mut input);
                let reset = advance(&mut input);
                assert_eq!(field(&reset, "nextBatchSize"), 1, "{backend}/{max}");
                assert_eq!(field(&reset, "state.healthySamples"), 0);
                assert!(field(&reset, "state.previousRate").is_null());
                assert!(field(&reset, "state.trialBaseRate").is_null());
                assert_eq!(field(&reset, "admitSourcePrefetch"), false);
                assert_eq!(field(&reset, "state.maxBatchSize"), max);
                // 축소 호출의 표본은 새 건강 이력으로 세지 않는다.
                put("sample.workUnits", json!(1), &mut input);
                assert_eq!(field(&plan(&input), "state.healthySamples"), 1);
            }
        }
    }

    #[test]
    fn max_expansion_preserves_history_and_is_saved_for_later_shrink() {
        let mut input = input();
        advance(&mut input);
        advance(&mut input);
        put("maxBatchSize", json!(6), &mut input);
        let expanded = advance(&mut input);
        assert_eq!(field(&expanded, "nextBatchSize"), 2);
        assert_eq!(field(&expanded, "state.previousRate"), 0.1);
        assert_eq!(field(&expanded, "state.trialBaseRate"), 0.1);
        assert_eq!(field(&expanded, "state.maxBatchSize"), 6);
        // 원래 상한보다 커도 직전 상한보다 작으면 축소다. 진행 중 trial도 폐기한다.
        put("maxBatchSize", json!(5), &mut input);
        let reset = plan(&input);
        assert_eq!(field(&reset, "nextBatchSize"), 1);
        assert!(field(&reset, "state.previousRate").is_null());
        assert!(field(&reset, "state.trialBaseRate").is_null());
        assert_eq!(field(&reset, "admitSourcePrefetch"), false);
    }

    #[test]
    fn missing_or_invalid_saved_max_is_rejected_not_repaired() {
        for saved_max in [
            JsonValue::Null,
            json!(0),
            json!(1.5),
            json!(4_294_967_296_u64),
            json!(1),
        ] {
            let mut input = trial();
            let state = input.get_mut("state").and_then(JsonValue::as_object_mut);
            assert!(state.is_some());
            if let Some(state) = state {
                state.insert("maxBatchSize".to_owned(), saved_max);
            }
            assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        }
        let mut input = trial();
        if let Some(state) = input.get_mut("state").and_then(JsonValue::as_object_mut) {
            state.remove("maxBatchSize");
        }
        assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
    }

    #[test]
    fn max_shrink_before_second_healthy_sample_cannot_start_trial() {
        for max in [1, 2, 3] {
            let mut input = input();
            advance(&mut input);
            assert_eq!(field(&advance(&mut input), "state.healthySamples"), 1);
            put("maxBatchSize", json!(max), &mut input);
            let reset = plan(&input);
            assert_eq!(field(&reset, "nextBatchSize"), 1);
            assert_eq!(field(&reset, "state.healthySamples"), 0);
            assert!(field(&reset, "state.previousRate").is_null());
            assert!(field(&reset, "state.trialBaseRate").is_null());
            assert_eq!(field(&reset, "admitSourcePrefetch"), false);
        }
    }

    #[test]
    fn foreground_lag_memory_and_backend_change_immediately_close_optimizations() {
        for (key, value) in [
            ("foregroundPending", json!(1)),
            ("lagMs", json!(21)),
            ("availableBytes", json!(10)),
            ("backend", json!("webgpu")),
        ] {
            let mut input = trial();
            if matches!(key, "lagMs" | "availableBytes") {
                put(&format!("sample.{key}"), value, &mut input);
            } else {
                put(key, value, &mut input);
            }
            let output = plan(&input);
            assert_eq!(field(&output, "nextBatchSize"), 1, "{key}");
            assert_eq!(field(&output, "admitSourcePrefetch"), false, "{key}");
            assert_eq!(field(&output, "state.healthySamples"), 0);
            assert!(field(&output, "state.trialBaseRate").is_null());
        }
        let mut input = trial();
        put("sample.lagMs", json!(11), &mut input);
        assert_eq!(field(&plan(&input), "nextBatchSize"), 1);
    }

    #[test]
    fn unknown_stale_zero_and_replayed_samples_cannot_grow() {
        for key in [
            "durationMs",
            "lagMs",
            "rssBytes",
            "availableBytes",
            "workUnits",
            "endedAtMs",
        ] {
            let mut input = trial();
            put(&format!("sample.{key}"), JsonValue::Null, &mut input);
            let output = plan(&input);
            assert_eq!(field(&output, "nextBatchSize"), 1, "{key}");
            assert_eq!(field(&output, "admitSourcePrefetch"), false);
            let removed = input
                .get_mut("sample")
                .and_then(JsonValue::as_object_mut)
                .and_then(|sample| sample.remove(key));
            assert!(removed.is_some(), "합성 필드 제거");
            assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        }
        for (key, value) in [("durationMs", 0), ("workUnits", 0), ("endedAtMs", 100)] {
            let mut input = trial();
            put("nowMs", json!(10000), &mut input);
            put(&format!("sample.{key}"), json!(value), &mut input);
            let output = plan(&input);
            assert_eq!(field(&output, "nextBatchSize"), 1);
            assert_eq!(field(&output, "admitSourcePrefetch"), false);
        }
        let mut input = input();
        advance(&mut input);
        let first = plan(&input);
        put("state", field(&first, "state").clone(), &mut input);
        assert_eq!(field(&plan(&input), "state"), field(&first, "state"));
        put("sample", JsonValue::Null, &mut input);
        assert_eq!(field(&plan(&input), "nextBatchSize"), 1);
    }

    #[test]
    fn invalid_wire_future_nonfinite_and_safe_integer_overflow_fail_empty() {
        for (key, value) in [
            ("plannedSourceBytes", json!(9_007_199_254_740_992_u64)),
            ("reservedSourceBytes", json!(9_007_199_254_740_991_u64)),
            ("maxBatchSize", json!(4_294_967_296_u64)),
            ("backend", json!("remote")),
        ] {
            let mut input = input();
            put(key, value, &mut input);
            assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        }
        let mut input = input();
        put("sample.endedAtMs", json!(1001), &mut input);
        assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        put("sample.endedAtMs", json!(1000), &mut input);
        put("sample.durationMs", json!(1e-310), &mut input);
        assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        let wire = input.to_string().replace("1e-310", "1e999");
        assert_eq!(plan_local_rag_admission_json(&wire), "");
    }

    #[test]
    fn physical_source_and_shared_budget_gate_only_additional_prefetch() {
        let mut input = input();
        advance(&mut input);
        assert_eq!(field(&plan(&input), "admitSourcePrefetch"), true);
        for count in [1, 2] {
            // 소비자 취소 여부가 아니라 실제 물리 작업 수만 신뢰한다.
            put("physicalSourceCount", json!(count), &mut input);
            assert_eq!(field(&plan(&input), "admitSourcePrefetch"), false);
        }
        put("physicalSourceCount", json!(0), &mut input);
        put("physicalInferenceCount", json!(0), &mut input);
        assert_eq!(field(&plan(&input), "admitSourcePrefetch"), false);
        put("physicalInferenceCount", json!(1), &mut input);
        put("plannedSourceBytes", json!(800), &mut input);
        assert_eq!(field(&plan(&input), "admitSourcePrefetch"), true);
        put("plannedSourceBytes", json!(801), &mut input);
        assert_eq!(field(&plan(&input), "admitSourcePrefetch"), false);
        put("reservedSourceBytes", json!(5000), &mut input);
        let output = plan(&input);
        assert_eq!(field(&output, "nextBatchSize"), 1);
        assert_eq!(field(&output, "admitSourcePrefetch"), false);
        // 단독 대형 기존 작업의 중단 명령은 반환하지 않는다.
        assert_eq!(output.as_object().map(JsonMap::len), Some(3));
    }
    #[test]
    fn cpu_and_webgpu_caps_and_fresh_non_inference_samples_are_conservative() {
        for backend in ["cpu", "webgpu"] {
            let mut input = input();
            put("backend", json!(backend), &mut input);
            put("maxBatchSize", json!(1), &mut input);
            advance(&mut input);
            advance(&mut input);
            assert_eq!(field(&advance(&mut input), "nextBatchSize"), 1);
            put("maxBatchSize", json!(4), &mut input);
            assert_eq!(field(&advance(&mut input), "nextBatchSize"), 1);
            assert_eq!(field(&advance(&mut input), "nextBatchSize"), 2);
            put(
                "backend",
                json!(if backend == "cpu" { "webgpu" } else { "cpu" }),
                &mut input,
            );
            let reset = plan(&input);
            assert_eq!(field(&reset, "nextBatchSize"), 1);
            assert!(field(&reset, "state.previousRate").is_null());
        }
        for (key, value) in [("durationMs", 0), ("workUnits", 0)] {
            let mut input = trial();
            put(&format!("sample.{key}"), json!(value), &mut input);
            let output = plan(&input);
            assert_eq!(field(&output, "nextBatchSize"), 1);
            assert_eq!(field(&output, "admitSourcePrefetch"), false);
        }
    }

    #[test]
    fn partial_batch_cannot_resolve_trial_and_concurrency_is_not_increased_with_batch() {
        let mut input = trial();
        assert_eq!(field(&plan(&input), "admitSourcePrefetch"), false);
        let partial = advance(&mut input);
        assert!(field(&partial, "state.trialBaseRate").is_number());
        assert_eq!(field(&partial, "state.healthySamples"), 0);
        assert_eq!(field(&partial, "nextBatchSize"), 2);
        put("physicalInferenceCount", json!(2), &mut input);
        let output = plan(&input);
        assert_eq!(field(&output, "nextBatchSize"), 1);
        assert_eq!(field(&output, "admitSourcePrefetch"), false);
    }

    #[test]
    fn state_and_top_level_missing_fields_and_numeric_boundaries_fail_closed() {
        let mut invalid_state = trial();
        put(
            "state.lastSampleEndedAtMs",
            JsonValue::Null,
            &mut invalid_state,
        );
        assert_eq!(
            plan_local_rag_admission_json(&invalid_state.to_string()),
            ""
        );
        for key in [
            "state",
            "sample",
            "foregroundPending",
            "reservedSourceBytes",
        ] {
            let input = input_with_missing_field(key);
            assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        }
        for (key, value) in [
            ("maxBatchSize", json!(0)),
            ("maxLagMs", json!(1e30)),
            ("targetBatchMs", json!(1e30)),
            ("physicalSourceCount", json!(4_294_967_296_u64)),
        ] {
            let mut input = input();
            put(key, value, &mut input);
            assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
        }
        let mut input = input();
        put("maxBatchSize", json!(u32::MAX), &mut input);
        assert_eq!(field(&plan(&input), "nextBatchSize"), 1);
        put("sample.durationMs", json!(-1), &mut input);
        assert_eq!(plan_local_rag_admission_json(&input.to_string()), "");
    }

    /// 차단 경계용으로 필드를 제거한 독립 입력을 만든다.
    fn input_with_missing_field(key: &str) -> JsonValue {
        let mut input = input();
        if let Some(object) = input.as_object_mut() {
            object.remove(key);
        }
        input
    }
    #[test]
    fn freshness_boundary_and_batch_integer_ceiling_do_not_wrap() {
        let mut request = input();
        advance(&mut request);
        put("nowMs", json!(6100), &mut request);
        assert_eq!(field(&plan(&request), "admitSourcePrefetch"), true);
        put("nowMs", json!(6101), &mut request);
        assert_eq!(field(&plan(&request), "admitSourcePrefetch"), false);

        let mut request = trial();
        put("maxBatchSize", json!(u32::MAX), &mut request);
        put("state.maxBatchSize", json!(u32::MAX), &mut request);
        put("state.batchSize", json!(u32::MAX - 1), &mut request);
        put("state.healthySamples", json!(1), &mut request);
        put("state.trialBaseRate", JsonValue::Null, &mut request);
        put("sample.workUnits", json!(u32::MAX - 1), &mut request);
        let output = advance(&mut request);
        assert_eq!(field(&output, "nextBatchSize"), u32::MAX);
        assert_eq!(field(&output, "admitSourcePrefetch"), false);
        put("sample.workUnits", json!(u32::MAX), &mut request);
        put("sample.durationMs", json!(1), &mut request);
        assert_eq!(field(&advance(&mut request), "nextBatchSize"), u32::MAX);
        assert_eq!(field(&advance(&mut request), "nextBatchSize"), u32::MAX);
        assert_eq!(field(&advance(&mut request), "nextBatchSize"), u32::MAX);
    }
}
