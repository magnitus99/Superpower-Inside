//! 프로바이더 연결 상태와 채팅 모델 선택 정책.
//!
//! 호스트는 저장된 연결·모델 스냅샷만 전달한다. 이 모듈은 실제 사용 가능한
//! 채팅 모델과 기본 선택을 결정하며 네트워크나 저장소에는 접근하지 않는다.

use std::collections::BTreeSet;

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Copy)]
/// 설정 화면과 실행 경계에서 공유하는 프로바이더 준비 상태.
enum ProviderTone {
    /// 지원 모델의 연결 검증이 하나 이상 성공한 상태.
    Ready,
    /// 필수 연결 정보와 모델은 있지만 아직 검증하지 않은 상태.
    Configured,
    /// 실행에 필요한 API 키가 없는 상태.
    NeedsKey,
    /// `OpenAI` 호환 endpoint URL이 없는 상태.
    NeedsUrl,
    /// 현재 strategy가 지원하는 모델이 없는 상태.
    NeedsModels,
    /// 지원 모델을 모두 검증했지만 전부 실패한 상태.
    Failed,
    /// 사용자가 연결을 꺼 둔 상태.
    Disabled,
}

impl ProviderTone {
    /// TypeScript wire contract에서 사용하는 상태 문자열을 반환한다.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Configured => "configured",
            Self::NeedsKey => "needs-key",
            Self::NeedsUrl => "needs-url",
            Self::NeedsModels => "needs-models",
            Self::Failed => "failed",
            Self::Disabled => "disabled",
        }
    }
}

/// 호스트가 전달한 모델 한 개의 검증 스냅샷.
struct ProviderModelInput<'a> {
    /// 프로바이더와 모델을 함께 식별하는 canonical 참조.
    value: &'a str,
    /// 모델 선택 UI에 표시할 이름.
    label: &'a str,
    /// 채팅 또는 임베딩 모델 구분.
    kind: &'a str,
    /// 마지막 연결 검증 상태.
    verification_status: &'a str,
}

/// 상태 판정에 필요한 프로바이더 입력 스냅샷.
struct ProviderInput<'a> {
    /// provider transport 전략 식별자.
    strategy: &'a str,
    /// 사용자가 연결을 활성화했는지 여부.
    enabled: bool,
    /// 비어 있지 않은 API 키가 설정됐는지 여부.
    api_key_configured: bool,
    /// 비어 있지 않은 endpoint URL이 설정됐는지 여부.
    base_url_configured: bool,
    /// 프로바이더에 등록된 모델 스냅샷.
    models: Vec<ProviderModelInput<'a>>,
}

/// 프로바이더 한 개의 표시 상태와 기능별 사용 가능 여부를 계산한다.
///
/// 잘못된 입력은 빈 문자열을 반환해 호스트가 실패 닫힘으로 처리하도록 한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_provider_profile_state_json(provider_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(provider_json) else {
        return String::new();
    };
    let Some(provider) = parse_provider(&value) else {
        return String::new();
    };
    let tone = provider_tone(&provider);
    let connection_usable = is_connection_usable(&provider);
    let chat_supported = provider.strategy != "ternlight";
    let embedding_supported = supports_embedding(provider.strategy);
    let chat_model_values = usable_model_values(&provider, "general", connection_usable);
    let embedding_model_values = usable_model_values(&provider, "embedding", connection_usable);
    let chat_usable = chat_supported && !chat_model_values.is_empty();
    let embedding_usable = embedding_supported && !embedding_model_values.is_empty();

    json!({
        "tone": tone.as_str(),
        "chatSupported": chat_supported,
        "embeddingSupported": embedding_supported,
        "chatUsable": chat_usable,
        "embeddingUsable": embedding_usable,
        "chatModelValues": if chat_supported { chat_model_values } else { Vec::new() },
        "embeddingModelValues": if embedding_supported { embedding_model_values } else { Vec::new() },
    })
    .to_string()
}

/// 모든 연결에서 사용 가능한 채팅 모델을 정렬하고 저장된 기본 모델을 검증한다.
///
/// 저장된 기본 모델이 사라졌거나 사용할 수 없으면 다른 프로바이더로 조용히
/// 전환하지 않는다. 호스트가 사용자의 명시적 선택을 받도록 빈 선택을 반환한다.
/// 잘못된 입력은 빈 문자열을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_model_state_json(providers_json: &str, configured_default: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(providers_json) else {
        return String::new();
    };
    let Some(provider_values) = value.as_array() else {
        return String::new();
    };

    let mut enabled_provider_count = 0_usize;
    let mut seen_values = BTreeSet::new();
    let mut options = Vec::<(String, String)>::new();
    for provider_value in provider_values {
        let Some(provider) = parse_provider(provider_value) else {
            return String::new();
        };
        if !is_connection_usable(&provider) || provider.strategy == "ternlight" {
            continue;
        }
        let has_chat_model = provider
            .models
            .iter()
            .any(|model| is_model_usable(model, "general"));
        if has_chat_model {
            enabled_provider_count = enabled_provider_count.saturating_add(1);
        }
        for model in provider
            .models
            .iter()
            .filter(|model| is_model_usable(model, "general"))
        {
            if seen_values.insert(model.value.to_owned()) {
                options.push((model.value.to_owned(), model.label.to_owned()));
            }
        }
    }
    options.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

    let selected_model = options
        .iter()
        .find(|(value, _label)| value == configured_default)
        .map_or("", |(value, _label)| value.as_str());
    let option_values = options
        .iter()
        .map(|(value, label)| json!({ "value": value, "label": label }))
        .collect::<Vec<_>>();

    json!({
        "options": option_values,
        "selectedModel": selected_model,
        "enabledProviderCount": enabled_provider_count,
        "availableModelCount": options.len(),
    })
    .to_string()
}

/// 연결 정보 변경 후 저장된 모델 검증 상태를 안전한 미확인 상태로 되돌린다.
///
/// 입력 상태가 wire contract를 벗어나면 빈 문자열을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_provider_verification_reset_json(models_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(models_json) else {
        return String::new();
    };
    let Some(models) = value.as_array() else {
        return String::new();
    };
    let mut reset = Vec::with_capacity(models.len());
    for model in models {
        let Some(object) = model.as_object() else {
            return String::new();
        };
        let Some(chat_status) = object.get("chatStatus").and_then(JsonValue::as_str) else {
            return String::new();
        };
        let Some(embedding_status) = object.get("embeddingStatus").and_then(JsonValue::as_str)
        else {
            return String::new();
        };
        if !is_verification_status(chat_status) || !is_verification_status(embedding_status) {
            return String::new();
        }
        reset.push(json!({
            "chatStatus": "unknown",
            "embeddingStatus": "unknown",
        }));
    }
    JsonValue::Array(reset).to_string()
}

/// JSON 값을 검증된 내부 프로바이더 입력으로 변환한다.
fn parse_provider(value: &JsonValue) -> Option<ProviderInput<'_>> {
    let object = value.as_object()?;
    let strategy = object.get("strategy")?.as_str()?;
    let enabled = object.get("enabled")?.as_bool()?;
    let api_key_configured = object.get("apiKeyConfigured")?.as_bool()?;
    let base_url_configured = object.get("baseUrlConfigured")?.as_bool()?;
    let model_values = object.get("models")?.as_array()?;
    if strategy.trim().is_empty() {
        return None;
    }
    let mut models = Vec::with_capacity(model_values.len());
    for model_value in model_values {
        let model = model_value.as_object()?;
        let value = model.get("value")?.as_str()?;
        let label = model.get("label")?.as_str()?;
        let kind = model.get("kind")?.as_str()?;
        let verification_status = model.get("verificationStatus")?.as_str()?;
        if value.trim().is_empty()
            || label.trim().is_empty()
            || !matches!(kind, "general" | "embedding")
            || !is_verification_status(verification_status)
        {
            return None;
        }
        models.push(ProviderModelInput {
            value,
            label,
            kind,
            verification_status,
        });
    }
    Some(ProviderInput {
        strategy,
        enabled,
        api_key_configured,
        base_url_configured,
        models,
    })
}

/// 연결 필수값과 지원 모델 검증 결과를 조합해 표시 상태를 계산한다.
fn provider_tone(provider: &ProviderInput<'_>) -> ProviderTone {
    if !provider.enabled {
        return ProviderTone::Disabled;
    }
    if requires_api_key(provider.strategy) && !provider.api_key_configured {
        return ProviderTone::NeedsKey;
    }
    if requires_base_url(provider.strategy) && !provider.base_url_configured {
        return ProviderTone::NeedsUrl;
    }
    let supported_models = provider
        .models
        .iter()
        .filter(|model| is_model_supported(provider.strategy, model))
        .collect::<Vec<_>>();
    if supported_models.is_empty() {
        return ProviderTone::NeedsModels;
    }
    if supported_models
        .iter()
        .any(|model| model.verification_status == "success")
    {
        return ProviderTone::Ready;
    }
    if supported_models
        .iter()
        .any(|model| model.verification_status == "unknown")
    {
        return ProviderTone::Configured;
    }
    ProviderTone::Failed
}

/// 활성화와 strategy별 필수 연결 정보가 모두 충족됐는지 확인한다.
fn is_connection_usable(provider: &ProviderInput<'_>) -> bool {
    provider.enabled
        && (!requires_api_key(provider.strategy) || provider.api_key_configured)
        && (!requires_base_url(provider.strategy) || provider.base_url_configured)
}

/// 요청한 종류와 일치하고 명시적 검증 실패가 아닌 모델인지 확인한다.
fn is_model_usable(model: &ProviderModelInput<'_>, kind: &str) -> bool {
    model.kind == kind && model.verification_status != "failed"
}

/// provider strategy가 해당 모델 종류를 지원하는지 확인한다.
fn is_model_supported(strategy: &str, model: &ProviderModelInput<'_>) -> bool {
    match model.kind {
        "general" => strategy != "ternlight",
        "embedding" => supports_embedding(strategy),
        _ => false,
    }
}

/// 연결과 모델 검증을 통과한 canonical 모델 참조만 반환한다.
fn usable_model_values<'a>(
    provider: &'a ProviderInput<'a>,
    kind: &str,
    connection_usable: bool,
) -> Vec<&'a str> {
    if !connection_usable {
        return Vec::new();
    }
    provider
        .models
        .iter()
        .filter(|model| is_model_usable(model, kind))
        .map(|model| model.value)
        .collect()
}

/// provider strategy가 비어 있지 않은 API 키를 요구하는지 확인한다.
fn requires_api_key(strategy: &str) -> bool {
    !matches!(strategy, "ollama" | "openAICompatible" | "ternlight")
}

/// provider strategy가 명시적 endpoint URL을 요구하는지 확인한다.
fn requires_base_url(strategy: &str) -> bool {
    strategy == "openAICompatible"
}

/// provider strategy가 임베딩 transport를 제공하는지 확인한다.
fn supports_embedding(strategy: &str) -> bool {
    matches!(
        strategy,
        "openai" | "ollama" | "openRouter" | "openAICompatible" | "ternlight"
    )
}

/// wire 입력의 모델 검증 상태가 허용된 값인지 확인한다.
fn is_verification_status(status: &str) -> bool {
    matches!(status, "success" | "failed" | "unknown")
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as JsonValue, json};

    use super::{
        plan_chat_model_state_json, plan_provider_profile_state_json,
        plan_provider_verification_reset_json,
    };

    #[test]
    fn provider_state_requires_openai_compatible_url() {
        let output = plan_provider_profile_state_json(
            r#"{"strategy":"openAICompatible","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":false,"models":[{"value":"profile:local:auto","label":"Local / auto","kind":"general","verificationStatus":"unknown"}]}"#,
        );
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("tone").and_then(JsonValue::as_str),
            Some("needs-url")
        );
    }

    #[test]
    fn provider_state_distinguishes_verified_connection() {
        let output = plan_provider_profile_state_json(
            r#"{"strategy":"openRouter","enabled":true,"apiKeyConfigured":true,"baseUrlConfigured":true,"models":[{"value":"profile:remote:model","label":"Remote / model","kind":"general","verificationStatus":"success"}]}"#,
        );
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("tone").and_then(JsonValue::as_str),
            Some("ready")
        );
    }

    #[test]
    fn provider_state_keeps_partial_success_ready() {
        let output = plan_provider_profile_state_json(
            r#"{"strategy":"openRouter","enabled":true,"apiKeyConfigured":true,"baseUrlConfigured":true,"models":[{"value":"profile:remote:working","label":"Remote / working","kind":"general","verificationStatus":"success"},{"value":"profile:remote:broken","label":"Remote / broken","kind":"general","verificationStatus":"failed"}]}"#,
        );
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("tone").and_then(JsonValue::as_str),
            Some("ready")
        );
        assert_eq!(
            parsed.get("chatUsable").and_then(JsonValue::as_bool),
            Some(true)
        );
    }

    #[test]
    fn chat_model_state_filters_unusable_without_switching_provider() {
        let providers = r#"[
          {"strategy":"ternlight","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":false,"models":[{"value":"profile:ternlight:legacy","label":"Ternlight / legacy","kind":"general","verificationStatus":"success"}]},
          {"strategy":"openAICompatible","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":false,"models":[{"value":"profile:missing:auto","label":"Missing / auto","kind":"general","verificationStatus":"unknown"}]},
          {"strategy":"openAICompatible","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":true,"models":[{"value":"profile:free:auto","label":"Free / auto","kind":"general","verificationStatus":"unknown"}]}
        ]"#;
        let output = plan_chat_model_state_json(providers, "profile:missing:auto");
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("selectedModel").and_then(JsonValue::as_str),
            Some("")
        );
    }

    #[test]
    fn chat_model_state_preserves_available_configured_default() {
        let providers = r#"[
          {"strategy":"openAICompatible","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":true,"models":[
            {"value":"profile:free:b","label":"Free / B","kind":"general","verificationStatus":"unknown"},
            {"value":"profile:free:a","label":"Free / A","kind":"general","verificationStatus":"unknown"}
          ]}
        ]"#;
        let output = plan_chat_model_state_json(providers, "profile:free:b");
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("selectedModel").and_then(JsonValue::as_str),
            Some("profile:free:b")
        );
    }

    #[test]
    fn chat_model_state_excludes_failed_models_without_cross_provider_fallback() {
        let providers = r#"[
          {"strategy":"openRouter","enabled":true,"apiKeyConfigured":true,"baseUrlConfigured":true,"models":[
            {"value":"profile:remote:broken","label":"Remote / broken","kind":"general","verificationStatus":"failed"}
          ]},
          {"strategy":"openAICompatible","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":true,"models":[
            {"value":"profile:free:auto","label":"Free / auto","kind":"general","verificationStatus":"unknown"}
          ]}
        ]"#;
        let output = plan_chat_model_state_json(providers, "profile:remote:broken");
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed
                .get("enabledProviderCount")
                .and_then(JsonValue::as_u64),
            Some(1)
        );
        assert_eq!(
            parsed
                .get("availableModelCount")
                .and_then(JsonValue::as_u64),
            Some(1)
        );
        assert_eq!(
            parsed.get("selectedModel").and_then(JsonValue::as_str),
            Some("")
        );
    }

    #[test]
    fn chat_model_state_requires_explicit_initial_selection() {
        let providers = r#"[
          {"strategy":"openAICompatible","enabled":true,"apiKeyConfigured":false,"baseUrlConfigured":true,"models":[
            {"value":"profile:free:auto","label":"Free / auto","kind":"general","verificationStatus":"unknown"}
          ]}
        ]"#;
        let output = plan_chat_model_state_json(providers, "");
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("selectedModel").and_then(JsonValue::as_str),
            Some("")
        );
        assert_eq!(
            parsed
                .get("availableModelCount")
                .and_then(JsonValue::as_u64),
            Some(1)
        );
    }

    #[test]
    fn provider_verification_reset_removes_stale_success_and_error_details() {
        let output = plan_provider_verification_reset_json(
            r#"[{"chatStatus":"success","embeddingStatus":"failed"},{"chatStatus":"unknown","embeddingStatus":"success"}]"#,
        );
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed,
            json!([
                {"chatStatus":"unknown","embeddingStatus":"unknown"},
                {"chatStatus":"unknown","embeddingStatus":"unknown"}
            ])
        );
    }

    #[test]
    fn provider_state_rejects_unsupported_embedding_strategy() {
        let output = plan_provider_profile_state_json(
            r#"{"strategy":"claude","enabled":true,"apiKeyConfigured":true,"baseUrlConfigured":true,"models":[{"value":"profile:claude:embed","label":"Claude / embed","kind":"embedding","verificationStatus":"success"}]}"#,
        );
        let parsed = serde_json::from_str::<JsonValue>(&output).unwrap_or_default();

        assert_eq!(
            parsed.get("embeddingUsable").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            parsed.get("tone").and_then(JsonValue::as_str),
            Some("needs-models")
        );
        assert_eq!(parsed.get("embeddingModelValues"), Some(&json!([])));
    }
}
