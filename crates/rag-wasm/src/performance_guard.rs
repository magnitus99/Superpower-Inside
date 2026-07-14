//! Deterministic policy for RAG indexing performance protection.

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Consecutive slow samples required before reducing indexing pressure.
const SLOW_SAMPLE_LIMIT: u32 = 3;
/// Consecutive slow event-loop samples required before pausing indexing.
const PAUSE_SAMPLE_LIMIT: u32 = 6;
/// Healthy samples required from both channels before restoring defaults.
const RECOVERY_SAMPLE_LIMIT: u32 = 3;
/// Default conservative cooperative delay between embedding batches.
const PROTECTION_YIELD_FLOOR_MS: u32 = 500;
/// Default cooldown after sustained renderer pressure.
const DEFAULT_PAUSE_MS: f64 = 30_000.0;

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
    /// User-configured cooperative delay.
    initial_yield_ms: u32,
    /// Event-loop lag considered slow.
    slow_event_loop_threshold_ms: f64,
    /// Embedding batch duration considered slow.
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
            current_yield_ms: config.initial_yield_ms,
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
    const fn safe_resume(previous: &Self, config: &Config) -> Self {
        Self {
            mode: Mode::Throttled,
            current_batch_size: 1,
            current_yield_ms: maximum_yield_ms(config),
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

    /// Reduces batch pressure without pausing the current job.
    fn throttle(&mut self, config: &Config, reason_kind: ReasonKind, duration_ms: f64) {
        self.mode = Mode::Throttled;
        self.current_batch_size = (self.current_batch_size >> 1).max(1);
        self.current_yield_ms = self
            .current_yield_ms
            .saturating_mul(2)
            .max(config.initial_yield_ms.saturating_mul(2))
            .min(maximum_yield_ms(config));
        self.reason_kind = Some(reason_kind);
        self.reason_ms = Some(duration_ms);
    }

    /// Parks indexing for the standard cooldown.
    fn pause(&mut self, config: &Config, now_ms: f64, duration_ms: f64) {
        self.mode = Mode::Paused;
        self.current_batch_size = 1;
        self.current_yield_ms = maximum_yield_ms(config);
        self.pause_until_ms = Some(now_ms + DEFAULT_PAUSE_MS);
        self.reason_kind = Some(ReasonKind::EventLoop);
        self.reason_ms = Some(duration_ms);
        self.last_slow_kind = Some(ReasonKind::EventLoop);
        self.last_slow_ms = Some(duration_ms);
    }

    /// Restores configured defaults once both channels remain healthy.
    fn recover_if_healthy(&mut self, config: &Config) {
        if self.mode == Mode::Throttled
            && self.healthy_batch_samples >= RECOVERY_SAMPLE_LIMIT
            && self.healthy_event_loop_samples >= RECOVERY_SAMPLE_LIMIT
        {
            *self = Self::baseline(config);
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
            if resume_expired_pause(&mut state, &config, now_ms) {
                record_batch_sample(&mut state, &config, duration_ms);
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

/// Returns the conservative yield without reducing a user-configured delay.
const fn maximum_yield_ms(config: &Config) -> u32 {
    if config.initial_yield_ms > PROTECTION_YIELD_FLOOR_MS {
        config.initial_yield_ms
    } else {
        PROTECTION_YIELD_FLOOR_MS
    }
}

/// Applies one embedding-provider duration sample.
fn record_batch_sample(state: &mut PolicyState, config: &Config, duration_ms: f64) {
    if duration_ms > config.slow_batch_threshold_ms {
        state.slow_batch_samples = state.slow_batch_samples.saturating_add(1);
        state.healthy_batch_samples = 0;
        state.last_slow_kind = Some(ReasonKind::Batch);
        state.last_slow_ms = Some(duration_ms);
        if state.slow_batch_samples >= SLOW_SAMPLE_LIMIT {
            state.slow_batch_samples = 0;
            state.throttle(config, ReasonKind::Batch, duration_ms);
        }
        return;
    }

    state.slow_batch_samples = 0;
    state.healthy_batch_samples = state
        .healthy_batch_samples
        .saturating_add(1)
        .min(RECOVERY_SAMPLE_LIMIT);
    state.recover_if_healthy(config);
}

/// Applies one renderer event-loop duration sample.
fn record_event_loop_sample(
    state: &mut PolicyState,
    config: &Config,
    now_ms: f64,
    duration_ms: f64,
) {
    if duration_ms > config.slow_event_loop_threshold_ms {
        state.slow_event_loop_samples = state.slow_event_loop_samples.saturating_add(1);
        state.healthy_event_loop_samples = 0;
        state.last_slow_kind = Some(ReasonKind::EventLoop);
        state.last_slow_ms = Some(duration_ms);
        if state.slow_event_loop_samples >= PAUSE_SAMPLE_LIMIT {
            state.pause(config, now_ms, duration_ms);
        } else if state.slow_event_loop_samples == SLOW_SAMPLE_LIMIT {
            state.throttle(config, ReasonKind::EventLoop, duration_ms);
        }
        return;
    }

    state.slow_event_loop_samples = 0;
    state.healthy_event_loop_samples = state
        .healthy_event_loop_samples
        .saturating_add(1)
        .min(RECOVERY_SAMPLE_LIMIT);
    state.recover_if_healthy(config);
}

/// Parses and validates the policy configuration object.
fn parse_config(input: &JsonMap<String, JsonValue>) -> Option<Config> {
    let config = input.get("config")?.as_object()?;
    Some(Config {
        enabled: config.get("enabled")?.as_bool()?,
        initial_batch_size: positive_u32(config.get("initialBatchSize"))?,
        initial_yield_ms: non_negative_u32(config.get("initialYieldMs"))?,
        slow_event_loop_threshold_ms: positive_finite(config.get("slowEventLoopThresholdMs"))?,
        slow_batch_threshold_ms: positive_finite(config.get("slowBatchThresholdMs"))?,
    })
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
            |duration_ms| json!({ "kind": kind, "durationMs": duration_ms }),
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
    fn slow_batches_throttle_without_pausing() {
        let mut state = plan(&JsonValue::Null, "initialize", None, 1_000.0);
        for _ in 0..12 {
            state = plan(&state, "batch_sample", Some(3_500.0), 1_000.0);
        }
        assert_eq!(state.get("mode"), Some(&json!("throttled")));
        assert_eq!(state.get("currentBatchSize"), Some(&json!(2)));
        assert!(state.get("pauseUntilMs").is_some_and(JsonValue::is_null));
    }

    #[test]
    fn event_loop_pressure_pauses_and_timer_tick_resumes_safely() {
        let mut state = plan(&JsonValue::Null, "initialize", None, 1_000.0);
        for _ in 0..6 {
            state = plan(&state, "event_loop_sample", Some(200.0), 1_000.0);
        }
        assert_eq!(state.get("mode"), Some(&json!("paused")));
        assert_eq!(state.get("pauseUntilMs"), Some(&json!(31_000.0)));

        state = plan(&state, "timer_tick", None, 31_000.0);
        assert_eq!(state.get("mode"), Some(&json!("throttled")));
        assert_eq!(state.get("currentBatchSize"), Some(&json!(1)));
        assert_eq!(state.get("currentYieldMs"), Some(&json!(500)));
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
