//! 설정 입력과 재사용·전송 범위의 결정적 정책.

use serde_json::Value;
use wasm_bindgen::prelude::wasm_bindgen;

/// 설정의 편집 중 문자열을 검증하고 잘못된 값이면 `NaN`을 반환합니다.
#[wasm_bindgen]
#[must_use]
pub fn parse_settings_number(input: &str, min: f64, max: f64, integer: bool) -> f64 {
    let Ok(value) = input.trim().parse::<f64>() else {
        return f64::NAN;
    };
    if !value.is_finite() || value < min || value > max || (integer && value.fract() != 0.0) {
        return f64::NAN;
    }
    value
}

/// 같은 본문의 기존 프롬프트 위치를 반환해 항목 중복을 방지합니다.
#[wasm_bindgen]
#[must_use]
pub fn find_reusable_prompt(entries_json: &str, content: &str) -> i32 {
    let Ok(Value::Array(entries)) = serde_json::from_str(entries_json) else {
        return -1;
    };
    entries
        .iter()
        .position(|entry| entry.get("content").and_then(Value::as_str) == Some(content.trim()))
        .and_then(|index| i32::try_from(index).ok())
        .unwrap_or(-1)
}

/// 연결의 실제 주소가 로컬 처리 대상인지 판정합니다.
#[wasm_bindgen]
#[must_use]
pub fn is_local_settings_provider(strategy: &str, base_url: &str) -> bool {
    if strategy == "ternlight" {
        return true;
    }
    if strategy == "ollama" && base_url.trim().is_empty() {
        return true;
    }
    let endpoint = base_url.trim().to_ascii_lowercase();
    let Some(authority) = endpoint
        .strip_prefix("http://")
        .or_else(|| endpoint.strip_prefix("https://"))
    else {
        return false;
    };
    let authority = authority.split('/').next().unwrap_or_default();
    // 인증·유사 도메인으로 원격 주소를 로컬로 오인하지 않습니다.
    if authority.contains('@') {
        return false;
    }
    authority == "localhost"
        || authority.starts_with("localhost:")
        || authority == "127.0.0.1"
        || authority.starts_with("127.0.0.1:")
        || authority == "[::1]"
        || authority.starts_with("[::1]:")
}

/// 새 대화 저장 폴더가 볼트 안의 상대 경로인지 확인합니다.
#[wasm_bindgen]
#[must_use]
pub fn is_valid_settings_folder(input: &str) -> bool {
    let path = input.trim();
    !path.is_empty()
        && !path.starts_with('/')
        && !path
            .chars()
            .any(|character| "\\:*?\"<>|\0".contains(character))
        && !path.split('/').any(|part| matches!(part, "." | ".." | ""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_edits_reject_empty_fraction_in_integer_and_out_of_range() {
        for input in ["", " ", "1.5", "NaN", "inf", "0", "11"] {
            assert!(parse_settings_number(input, 1.0, 10.0, true).is_nan());
        }
        assert!((parse_settings_number("2", 1.0, 10.0, true) - 2.0).abs() < f64::EPSILON);
        assert!((parse_settings_number("0.85", 0.0, 1.0, false) - 0.85).abs() < f64::EPSILON);
    }

    #[test]
    fn reuse_preserves_existing_prompt_identity() {
        assert_eq!(
            find_reusable_prompt(r#"[{"content":"sample"}]"#, " sample "),
            0
        );
        assert_eq!(find_reusable_prompt("[]", "sample"), -1);
        assert_eq!(find_reusable_prompt("invalid", "sample"), -1);
    }

    #[test]
    fn transfer_scope_uses_endpoint_and_rejects_lookalikes() {
        for endpoint in [
            "http://localhost:11434",
            "http://127.0.0.1/v1",
            "http://[::1]:8080",
        ] {
            assert!(is_local_settings_provider("openAICompatible", endpoint));
        }
        for endpoint in [
            "https://localhost.example/v1",
            "http://localhost@remote.example",
            "https://remote.example",
        ] {
            assert!(!is_local_settings_provider("ollama", endpoint));
        }
        assert!(is_local_settings_provider("ternlight", ""));
        assert!(is_local_settings_provider("ollama", ""));
        assert!(!is_local_settings_provider("ollamaCloud", ""));
    }

    #[test]
    fn mcp_schema_rejects_invalid_stdio_fields() {
        for input in [
            r#"{"mcpServers":{"":{"command":"npx"}}}"#,
            r#"{"mcpServers":{"a":{"command":" "}}}"#,
            r#"{"mcpServers":{"a":{"command":1}}}"#,
            r#"{"mcpServers":{"a":{"command":"npx","args":[1]}}}"#,
            r#"{"mcpServers":{"a":{"command":"npx","env":{"key":1}}}}"#,
        ] {
            let valid = serde_json::from_str::<Value>(&crate::validate_mcp_json(input))
                .ok()
                .and_then(|result| result.get("valid").and_then(Value::as_bool));
            assert_eq!(valid, Some(false));
        }
    }

    #[test]
    fn folder_edits_stay_inside_vault() {
        for path in ["", "/outside", "../outside", "a/../outside", "a\\b", "a//b"] {
            assert!(!is_valid_settings_folder(path));
        }
        assert!(is_valid_settings_folder("채팅/저장 폴더"));
        assert!(is_valid_settings_folder("New folder"));
    }
}
