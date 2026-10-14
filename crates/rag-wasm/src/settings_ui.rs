//! 설정 입력과 재사용·전송 범위의 결정적 정책.

use serde_json::Value;
use wasm_bindgen::prelude::wasm_bindgen;

/// 저장된 MCP 설정을 로컬·원격 공통 내부 형식으로 마이그레이션한다.
#[wasm_bindgen]
#[must_use]
pub fn migrate_stored_mcp_servers_json(input: &str) -> String {
    let Ok(Value::Array(servers)) = serde_json::from_str::<Value>(input) else {
        return String::new();
    };
    Value::Array(
        servers
            .iter()
            .filter_map(migrate_stored_mcp_server)
            .collect(),
    )
    .to_string()
}

/// 기존 로컬 인수·환경 변수 정리 계약을 보존하고 원격 연결 필드를 유지한다.
fn migrate_stored_mcp_server(server: &Value) -> Option<Value> {
    let name = server
        .get("name")?
        .as_str()
        .filter(|name| !name.is_empty())?;
    let transport = server.get("transport").and_then(Value::as_str);
    let mut result = serde_json::Map::new();
    result.insert("name".to_owned(), Value::String(name.to_owned()));
    if let Some(url) = server
        .get("url")
        .and_then(Value::as_str)
        .filter(|url| !url.is_empty())
    {
        if !matches!(transport, None | Some("http" | "sse")) {
            return None;
        }
        result.insert("command".to_owned(), Value::String(String::new()));
        result.insert("url".to_owned(), Value::String(url.to_owned()));
        result.insert(
            "transport".to_owned(),
            Value::String(transport.unwrap_or("http").to_owned()),
        );
        if let Some(secret) = server.get("authTokenSecret").and_then(Value::as_str) {
            result.insert(
                "authTokenSecret".to_owned(),
                Value::String(secret.to_owned()),
            );
        }
    } else {
        if !matches!(transport, None | Some("stdio")) {
            return None;
        }
        let command = server
            .get("command")?
            .as_str()
            .filter(|command| !command.is_empty())?;
        result.insert("command".to_owned(), Value::String(command.to_owned()));
        if transport == Some("stdio") {
            result.insert("transport".to_owned(), Value::String("stdio".to_owned()));
        }
        if let Some(args) = server.get("args").and_then(Value::as_array) {
            result.insert(
                "args".to_owned(),
                Value::Array(args.iter().filter(|arg| arg.is_string()).cloned().collect()),
            );
        }
        if let Some(env) = server.get("env").and_then(Value::as_object) {
            result.insert(
                "env".to_owned(),
                Value::Object(
                    env.iter()
                        .filter(|(_, value)| value.is_string())
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect(),
                ),
            );
        }
    }
    Some(Value::Object(result))
}

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
    fn stored_mcp_migration_preserves_local_and_remote_after_restart() {
        let local = serde_json::json!({"name":"synthetic-local", "command":"node", "args":["script with spaces.mjs"], "env":{"SYNTHETIC_OPTION":"한글 값"}});
        let explicit =
            serde_json::json!({"name":"explicit", "command":"node", "transport":"stdio"});
        let http = serde_json::json!({"name":"remote", "command":"", "url":"https://example.com/mcp", "transport":"http", "authTokenSecret":"mcp-synthetic"});
        let sse = serde_json::json!({"name":"legacy", "command":"", "url":"https://example.com/sse", "transport":"sse"});
        let input = serde_json::json!([local, explicit, http, sse]);
        let output = migrate_stored_mcp_servers_json(&input.to_string());
        assert_eq!(serde_json::from_str::<Value>(&output).ok(), Some(input));
        assert_eq!(migrate_stored_mcp_servers_json(&output), output);
        let default_http = serde_json::json!([{"name":"remote","url":"https://example.com/mcp"}]);
        assert_eq!(
            serde_json::from_str::<Value>(&migrate_stored_mcp_servers_json(
                &default_http.to_string()
            ))
            .ok(),
            Some(
                serde_json::json!([{"name":"remote","command":"","url":"https://example.com/mcp","transport":"http"}])
            )
        );
    }

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
            r#"{"mcpServers":{"a":{"command":"node","transport":1}}}"#,
            r#"{"mcpServers":{"a":{"command":"node","transport":null}}}"#,
            r#"{"mcpServers":{"a":{"command":"node","transport":"http"}}}"#,
        ] {
            let valid = serde_json::from_str::<Value>(&crate::validate_mcp_json(input))
                .ok()
                .and_then(|result| result.get("valid").and_then(Value::as_bool));
            assert_eq!(valid, Some(false));
        }
    }

    #[test]
    fn remote_mcp_schema_preserves_transports_and_secret_references() {
        for entry in [
            serde_json::json!({"url":"https://example.com/mcp"}),
            serde_json::json!({"url":"http://127.0.0.1:8080/sse", "transport":"sse", "authTokenSecret":"mcp-test"}),
            serde_json::json!({"url":"https://example.com/mcp", "transport":"http"}),
        ] {
            let input = serde_json::json!({"mcpServers":{"remote":entry}});
            let result =
                serde_json::from_str::<Value>(&crate::validate_mcp_json(&input.to_string())).ok();
            assert_eq!(
                result.as_ref().and_then(|value| value.get("valid")),
                Some(&serde_json::json!(true))
            );
            assert_eq!(
                result.as_ref().and_then(|value| value.get("data")),
                Some(&input)
            );
        }
        for entry in [
            serde_json::json!({"url":"file:///tmp/socket"}),
            serde_json::json!({"url":"https://user:secret@example.com"}),
            serde_json::json!({"url":"https:///missing"}),
            serde_json::json!({"url":"https://example.com", "transport":"stdio"}),
            serde_json::json!({"url":"https://example.com", "transport":1}),
            serde_json::json!({"url":"https://example.com", "command":"node"}),
            serde_json::json!({"url":"https://example.com", "headers":{"Authorization":"secret"}}),
            serde_json::json!({"url":"https://example.com", "authTokenSecret":"raw secret"}),
        ] {
            let input = serde_json::json!({"mcpServers":{"remote":entry}});
            let result =
                serde_json::from_str::<Value>(&crate::validate_mcp_json(&input.to_string())).ok();
            assert_eq!(
                result.as_ref().and_then(|value| value.get("valid")),
                Some(&serde_json::json!(false)),
                "{entry}"
            );
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
