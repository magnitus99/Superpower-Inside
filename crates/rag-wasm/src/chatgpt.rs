//! `ChatGPT` 인증의 저장 계약과 응답 입출력 매핑.

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 호스트 I/O에 필요한 결정적 결과를 생성한다. 잘못된 입력은 빈 결과로 닫는다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chatgpt_json(input_json: &str) -> String {
    serde_json::from_str::<Value>(input_json)
        .ok()
        .and_then(|input| plan(&input))
        .map_or_else(String::new, |value| value.to_string())
}

/// 비어 있지 않은 필수 문자열을 읽는다.
fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str().filter(|s| !s.trim().is_empty())
}

/// 저장된 토큰과 계정 식별자의 필수 필드를 검증한다.
fn credentials(value: &Value) -> Option<Value> {
    Some(json!({
        "accessToken": text(value, "accessToken")?,
        "refreshToken": text(value, "refreshToken")?,
        "accountId": text(value, "accountId")?,
        "expiresAt": value.get("expiresAt")?.as_u64()?,
    }))
}

/// 인증과 모델 요청의 작업 종류별 wire 계약을 적용한다.
fn plan(input: &Value) -> Option<Value> {
    match text(input, "operation")? {
        "credentials" => credentials(input.get("value")?),
        "token" => {
            let token = input.get("token")?;
            let payload = token_claims(text(token, "access_token")?)?;
            let account = text(
                payload.get("https://api.openai.com/auth")?,
                "chatgpt_account_id",
            )?;
            if text(input, "expectedAccountId").is_some_and(|expected| expected != account) {
                return None;
            }
            let seconds = token.get("expires_in")?.as_u64()?;
            if seconds == 0 {
                return None;
            }
            Some(json!({
                "accessToken": text(token, "access_token")?,
                "refreshToken": text(token, "refresh_token").or_else(|| text(input, "refreshToken"))?,
                "accountId": account,
                "expiresAt": input.get("now")?.as_u64()?.checked_add(seconds.checked_mul(1000)?)?,
            }))
        }
        "callback" => {
            if text(input, "state")? != text(input, "expectedState")? {
                return None;
            }
            if input.get("error").is_some_and(|value| !value.is_null()) {
                return Some(json!({ "denied": true }));
            }
            Some(json!({ "code": text(input, "code")? }))
        }
        "request" => request(input),
        "response" => response(text(input, "text")?),
        "stream-event" => {
            let event: Value = serde_json::from_str(text(input, "data")?).ok()?;
            let kind = text(&event, "type")?;
            match kind {
                "response.output_text.delta" | "response.refusal.delta" => {
                    Some(json!({"content": event.get("delta")?.as_str()?, "done": false}))
                }
                "response.reasoning_summary_text.delta" => Some(
                    json!({"content": "", "reasoning": event.get("delta")?.as_str()?, "done": false}),
                ),
                "response.failed" | "response.incomplete" | "error" => Some(json!({"error": true})),
                "response.completed" | "response.done" => {
                    Some(json!({"content": "", "done": true}))
                }
                _ => Some(json!({"content": "", "done": false})),
            }
        }
        "stream-tail" => {
            let mut result = response(text(input, "text")?)?;
            for key in ["content", "reasoning"] {
                let emitted = input.get(key)?.as_str()?;
                let remaining = result.get(key)?.as_str()?.strip_prefix(emitted)?.to_owned();
                *result.get_mut(key)? = json!(remaining);
            }
            Some(result)
        }
        "models" => {
            let models = input.get("value")?.get("models")?.as_array()?;
            let mut ids = models
                .iter()
                .filter_map(|model| text(model, "slug"))
                .map(str::to_owned)
                .collect::<Vec<_>>();
            ids.sort();
            ids.dedup();
            Some(json!(ids))
        }
        _ => None,
    }
}

/// 기존 디코더를 재사용해 토큰의 계정 claim을 읽는다. 서명 인증은 토큰 서버가 담당한다.
fn token_claims(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    parts.next().filter(|part| !part.is_empty())?;
    let payload = parts.next().filter(|part| !part.is_empty())?;
    parts.next().filter(|part| !part.is_empty())?;
    if parts.next().is_some()
        || !payload
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return None;
    }
    let mut encoded = payload.replace('-', "+").replace('_', "/");
    encoded.extend(std::iter::repeat_n('=', (4 - payload.len() % 4) % 4));
    serde_json::from_str(&super::decode_base64_utf8(&encoded)?).ok()
}

/// 기존 채팅 메시지와 도구 결과를 구독 서버의 요청 항목으로 변환한다.
fn request(value: &Value) -> Option<Value> {
    let mut instructions = Vec::new();
    let mut items = Vec::new();
    for message in value.get("messages")?.as_array()? {
        let role = text(message, "role")?;
        let content = message.get("content")?.as_str()?;
        match role {
            "system" => instructions.push(content),
            "tool" => items.push(json!({
                "type": "function_call_output", "call_id": text(message, "tool_call_id")?, "output": content,
            })),
            "user" | "assistant" => {
                if !content.is_empty() || role == "user" {
                    items.push(json!({ "role": role, "content": [{
                        "type": if role == "assistant" { "output_text" } else { "input_text" }, "text": content,
                    }] }));
                }
                if role == "assistant"
                    && let Some(calls) = message.get("toolCalls").and_then(Value::as_array) {
                        for call in calls {
                            let function = call.get("function")?;
                            items.push(json!({ "type": "function_call", "call_id": text(call, "id")?,
                                "name": text(function, "name")?, "arguments": text(function, "arguments")?,
                            }));
                        }
                }
            }
            _ => return None,
        }
    }
    let tools = value.get("tools").and_then(Value::as_array).into_iter().flatten()
        .map(|tool| {
            let function = tool.get("function")?;
            Some(json!({ "type": "function", "name": text(function, "name")?,
                "description": function.get("description")?.as_str()?, "parameters": function.get("parameters")?, "strict": null,
            }))
        }).collect::<Option<Vec<_>>>()?;
    let choice = value
        .get("toolChoice")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    if !matches!(choice, "auto" | "required" | "none") {
        return None;
    }
    Some(
        json!({ "model": text(value, "model")?, "instructions": instructions.join("\n\n"),
            "input": items, "tools": tools, "tool_choice": choice, "store": false, "stream": true,
            "parallel_tool_calls": true, "include": ["reasoning.encrypted_content"],
        }),
    )
}

/// 완료된 이벤트만 텍스트·추론 요약·도구 호출 결과로 인정한다.
fn response(body: &str) -> Option<Value> {
    let mut terminal = None;
    let mut completed_items = Vec::new();
    for block in body.replace("\r\n", "\n").split("\n\n") {
        let data = block
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let event: Value = serde_json::from_str(&data).ok()?;
        match text(&event, "type")? {
            "response.output_item.done" => {
                completed_items.push((
                    event.get("output_index")?.as_u64()?,
                    event.get("item")?.clone(),
                ));
            }
            "response.completed" | "response.done" => {
                terminal = Some(event.get("response")?.clone());
            }
            "response.failed" | "response.incomplete" | "error" => return None,
            _ => {}
        }
    }
    let mut terminal = terminal?;
    if text(&terminal, "status")? != "completed" {
        return None;
    }
    if terminal.get("output")?.as_array()?.is_empty() {
        completed_items.sort_by_key(|(index, _)| *index);
        *terminal.get_mut("output")? =
            Value::Array(completed_items.into_iter().map(|(_, item)| item).collect());
    }
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut calls = Vec::new();
    for item in terminal.get("output")?.as_array()? {
        match text(item, "type")? {
            "message" => {
                for part in item.get("content")?.as_array()? {
                    match text(part, "type")? {
                        "output_text" => content.push_str(part.get("text")?.as_str()?),
                        "refusal" => content.push_str(part.get("refusal")?.as_str()?),
                        _ => {}
                    }
                }
            }
            "reasoning" => {
                if let Some(summary) = item.get("summary").and_then(Value::as_array) {
                    for part in summary { reasoning.push_str(part.get("text")?.as_str()?); }
                }
            }
            "function_call" => calls.push(json!({ "index": calls.len(), "type": "function",
                "id": text(item, "call_id")?, "function": { "name": text(item, "name")?, "arguments": text(item, "arguments")? },
            })),
            _ => {}
        }
    }
    let mut result = json!({ "content": content, "reasoning": reasoning, "toolCalls": calls, "model": terminal.get("model").and_then(Value::as_str) });
    if let Some(usage) = crate::provider_usage::normalize("responses", &terminal) {
        result.as_object_mut()?.insert("usage".to_owned(), usage);
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::plan;
    use serde_json::json;

    #[test]
    fn alternate_completion_preserves_tools_and_rejects_failed_status() {
        for kind in ["response.completed", "response.done"] {
            let event = json!({"type":kind,"response":{"status":"completed","output":[
                {"type":"function_call","call_id":"call-1","name":"search","arguments":"{}"}
            ]}});
            let body = format!("data: {event}\n\n");
            let result = plan(&json!({"operation":"response","text":body})).unwrap_or_default();
            assert_eq!(result.pointer("/toolCalls/0/id"), Some(&json!("call-1")));
            assert_eq!(
                plan(&json!({"operation":"stream-event","data":event.to_string()}))
                    .and_then(|value| value.get("done").cloned()),
                Some(json!(true))
            );
            for status in ["failed", "incomplete", "in_progress"] {
                let event = json!({"type":kind,"response":{"status":status,"output":[]}});
                assert!(
                    plan(&json!({"operation":"response","text":format!("data: {event}\n\n")}))
                        .is_none()
                );
            }
        }
    }

    #[test]
    fn live_events_and_terminal_reconciliation_do_not_duplicate_text() {
        for (kind, field) in [
            ("response.output_text.delta", "content"),
            ("response.refusal.delta", "content"),
            ("response.reasoning_summary_text.delta", "reasoning"),
        ] {
            let event = json!({"type":kind, "delta":"한글 😀"});
            let chunk = plan(&json!({"operation":"stream-event", "data":event.to_string()}));
            assert_eq!(
                chunk.as_ref().and_then(|value| value.get(field)),
                Some(&json!("한글 😀"))
            );
            assert_eq!(
                chunk.as_ref().and_then(|value| value.get("done")),
                Some(&json!(false))
            );
        }
        for kind in ["response.failed", "response.incomplete", "error"] {
            let chunk =
                plan(&json!({"operation":"stream-event", "data":json!({"type":kind}).to_string()}));
            assert_eq!(
                chunk.as_ref().and_then(|value| value.get("error")),
                Some(&json!(true))
            );
        }
        let body = format!(
            "data: {}\n\n",
            json!({"type":"response.completed", "response":{"status":"completed", "model":"synthetic", "output":[{"type":"message","content":[{"type":"output_text","text":"first second"}]}]}})
        );
        let result = plan(
            &json!({"operation":"stream-tail", "text":body, "content":"first", "reasoning":""}),
        );
        assert_eq!(
            result.as_ref().and_then(|value| value.get("content")),
            Some(&json!(" second"))
        );
        assert!(plan(&json!({"operation":"stream-tail", "text":body, "content":"different", "reasoning":""})).is_none());
        assert!(plan(&json!({"operation":"stream-event", "data":"invalid"})).is_none());
    }

    #[test]
    fn completed_response_recovers_finalized_items_when_terminal_output_is_empty() {
        let events = [
            json!({"type":"response.output_item.done","output_index":2,"item":{
                "type":"message","content":[{"type":"output_text","text":" after"}]
            }}),
            json!({"type":"response.output_item.done","output_index":1,"item":{
                "type":"function_call","call_id":"call-1","name":"search","arguments":"{}"
            }}),
            json!({"type":"response.output_item.done","output_index":0,"item":{
                "type":"message","content":[{"type":"output_text","text":"answer"}]
            }}),
        ];
        let mut incomplete = String::new();
        for event in events {
            incomplete.push_str("data: ");
            incomplete.push_str(&event.to_string());
            incomplete.push_str("\n\n");
        }
        let terminal = json!({"type":"response.completed","response":{"status":"completed","model":"chosen","output":[]}});
        let body = format!("{incomplete}data: {terminal}\n\n");
        let result = plan(&json!({"operation":"response","text":body})).unwrap_or_default();
        assert_eq!(result.get("content"), Some(&json!("answer after")));
        assert_eq!(result.pointer("/toolCalls/0/id"), Some(&json!("call-1")));
        assert_eq!(result.get("model"), Some(&json!("chosen")));
        assert!(plan(&json!({"operation":"response","text":incomplete})).is_none());
        let failed = format!("{incomplete}data: {{\"type\":\"response.failed\"}}\n\n");
        assert!(plan(&json!({"operation":"response","text":failed})).is_none());
    }

    #[test]
    fn responses_preserve_tool_call_ids_and_system_instructions() {
        let result = plan(&json!({ "operation": "request", "model": "chosen", "messages": [
            {"role":"system","content":"instruction"},
            {"role":"assistant","content":"", "toolCalls":[{"id":"call-1","function":{"name":"search","arguments":"{}"}}]},
            {"role":"tool","content":"evidence","tool_call_id":"call-1"}
        ], "tools": [], "toolChoice":"required" })).unwrap_or_default();
        assert_eq!(result.get("instructions"), Some(&json!("instruction")));
        assert_eq!(result.pointer("/input/0/call_id"), Some(&json!("call-1")));
        assert_eq!(
            result.pointer("/input/1/type"),
            Some(&json!("function_call_output"))
        );
        assert_eq!(result.get("tool_choice"), Some(&json!("required")));
        assert_eq!(result.get("store"), Some(&json!(false)));
    }

    #[test]
    fn truncated_or_failed_sse_never_becomes_success() {
        for text in [
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
            "data: {\"type\":\"response.failed\"}\n\n",
        ] {
            assert!(plan(&json!({"operation":"response","text":text})).is_none());
        }
    }

    #[test]
    fn wrong_state_and_invalid_credentials_fail_closed() {
        assert!(plan(&json!({"operation":"callback","state":"wrong","expectedState":"expected","code":"code"})).is_none());
        assert!(
            plan(&json!({"operation":"credentials","value":{"accessToken":"token"}})).is_none()
        );
    }
}
