//! Deterministic policy for RAG indexing performance protection.

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Provider requests are resized toward this wall-clock duration.
const TARGET_BATCH_DURATION_MS: f64 = 1_500.0;
/// Event-loop samples below this value progressively remove cooperative delay.
const HEALTHY_EVENT_LOOP_MS: f64 = 24.0;
/// Sustained severe renderer pressure parks indexing briefly.
const SEVERE_EVENT_LOOP_MS: f64 = 250.0;
/// Maximum delay the controller may insert between provider requests.
const MAX_ADAPTIVE_YIELD_MS: u32 = 1_000;
/// Severe samples required before parking the current indexing job.
const PAUSE_SAMPLE_LIMIT: u32 = 3;
/// Cooldown after sustained renderer pressure.
const DEFAULT_PAUSE_MS: f64 = 15_000.0;

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

    /// Reduces request pressure without pausing the current job.
    fn throttle(&mut self, reason_kind: ReasonKind, duration_ms: f64) {
        self.mode = Mode::Throttled;
        self.current_batch_size = (self.current_batch_size >> 1).max(1);
        self.reason_kind = Some(reason_kind);
        self.reason_ms = Some(duration_ms);
    }

    /// Parks indexing for the standard cooldown.
    fn pause(&mut self, _config: &Config, now_ms: f64, duration_ms: f64) {
        self.mode = Mode::Paused;
        self.current_batch_size = 1;
        self.current_yield_ms = 250;
        self.pause_until_ms = Some(now_ms + DEFAULT_PAUSE_MS);
        self.reason_kind = Some(ReasonKind::EventLoop);
        self.reason_ms = Some(duration_ms);
        self.last_slow_kind = Some(ReasonKind::EventLoop);
        self.last_slow_ms = Some(duration_ms);
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
                record_event_loop_sample(&mut state, &config, now_ms, duration_ms);
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
        f64::from(batch_size) * TARGET_BATCH_DURATION_MS / duration_ms,
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
    } else if duration_ms <= TARGET_BATCH_DURATION_MS * 0.8 {
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
fn record_event_loop_sample(
    state: &mut PolicyState,
    config: &Config,
    now_ms: f64,
    duration_ms: f64,
) {
    if duration_ms > HEALTHY_EVENT_LOOP_MS {
        state.slow_event_loop_samples = state.slow_event_loop_samples.saturating_add(1);
        state.healthy_event_loop_samples = 0;
        state.last_slow_kind = Some(ReasonKind::EventLoop);
        state.last_slow_ms = Some(duration_ms);
        let pressure_ms = bounded_rounded_u32(
            (duration_ms - HEALTHY_EVENT_LOOP_MS).ceil(),
            1,
            MAX_ADAPTIVE_YIELD_MS,
        );
        state.current_yield_ms = state
            .current_yield_ms
            .saturating_add(pressure_ms)
            .min(MAX_ADAPTIVE_YIELD_MS);
        state.reason_kind = Some(ReasonKind::EventLoop);
        state.reason_ms = Some(duration_ms);
        if duration_ms >= SEVERE_EVENT_LOOP_MS
            && state.slow_event_loop_samples >= PAUSE_SAMPLE_LIMIT
        {
            state.pause(config, now_ms, duration_ms);
        } else if state.slow_event_loop_samples >= 2 {
            state.throttle(ReasonKind::EventLoop, duration_ms);
        }
        return;
    }

    state.slow_event_loop_samples = 0;
    state.healthy_event_loop_samples = state.healthy_event_loop_samples.saturating_add(1).min(2);
    if state.healthy_event_loop_samples >= 2 {
        state.current_yield_ms = state
            .current_yield_ms
            .saturating_sub(state.current_yield_ms.div_ceil(2).max(1));
        state.healthy_event_loop_samples = 0;
    }
    state.refresh_mode(config);
}

/// Parses and validates the policy configuration object.
fn parse_config(input: &JsonMap<String, JsonValue>) -> Option<Config> {
    let config = input.get("config")?.as_object()?;
    non_negative_u32(config.get("initialYieldMs"))?;
    positive_finite(config.get("slowEventLoopThresholdMs"))?;
    positive_finite(config.get("slowBatchThresholdMs"))?;
    Some(Config {
        enabled: config.get("enabled")?.as_bool()?,
        initial_batch_size: positive_u32(config.get("initialBatchSize"))?,
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
        assert_eq!(state.get("currentBatchSize"), Some(&json!(20)));
        assert_eq!(state.get("currentYieldMs"), Some(&json!(0)));
        assert!(state.get("pauseUntilMs").is_some_and(JsonValue::is_null));
    }

    #[test]
    fn event_loop_pressure_pauses_and_timer_tick_resumes_safely() {
        let mut state = plan(&JsonValue::Null, "initialize", None, 1_000.0);
        for _ in 0..3 {
            state = plan(&state, "event_loop_sample", Some(300.0), 1_000.0);
        }
        assert_eq!(state.get("mode"), Some(&json!("paused")));
        assert_eq!(state.get("pauseUntilMs"), Some(&json!(16_000.0)));

        state = plan(&state, "timer_tick", None, 16_000.0);
        assert_eq!(state.get("mode"), Some(&json!("throttled")));
        assert_eq!(state.get("currentBatchSize"), Some(&json!(1)));
        assert_eq!(state.get("currentYieldMs"), Some(&json!(250)));
    }

    #[test]
    fn invalid_state_fails_closed() {
        let output = plan_rag_performance_guard_json(&input(
            &json!({ "mode": "unknown" }),
            "batch_sample",
            Some(100.0),
            1_000.0,
        ));
        assert!(output.is_empty());
    }
}
