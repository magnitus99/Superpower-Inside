//! Gemini 네이티브 프로토콜과 Google OAuth 자격 증명의 결정적 매핑.
//!
//! 호스트는 네트워크와 저장소만 담당하고, 이 모듈은 요청·스트림·응답의
//! wire 형식과 OAuth 결과의 선택 규칙을 담당한다.

use serde_json::{Map, Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 비어 있지 않은 필수 문자열을 읽는다.
fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)?
        .as_str()
        .filter(|item| !item.trim().is_empty())
}

/// 유한한 숫자만 받아들인다.
fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|item| item.is_finite())
}

/// 양의 안전한 정수만 받아들인다.
fn positive(value: Option<&Value>) -> Option<u64> {
    value
        .and_then(Value::as_u64)
        .filter(|item| *item > 0 && *item <= 9_007_199_254_740_991)
}

/// 요청 본문을 공개 Gemini API 또는 Cloud Code Assist envelope으로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_gemini_json(input_json: &str) -> String {
    serde_json::from_str::<Value>(input_json)
        .ok()
        .and_then(|input| plan(&input))
        .map_or_else(String::new, |value| value.to_string())
}

/// 작업 종류별 Gemini wire 계약을 적용한다.
fn plan(input: &Value) -> Option<Value> {
    match text(input, "operation")? {
        "request" => request(input),
        "stream-event" => stream_event(input),
        "response" => response(input),
        "credentials" => credentials(input.get("value")?),
        "token" => token(input),
        "project" => project(input),
        _ => None,
    }
}

/// Gemini Content 한 개를 만든다.
fn content(role: &str, parts: &[Value]) -> Value {
    json!({ "role": role, "parts": parts })
}

/// 저장된 도구 인자 문자열을 Gemini args 객체로 바꾼다.
fn function_args(value: &Value) -> Value {
    let Some(args) = value.get("arguments").and_then(Value::as_str) else {
        return json!({});
    };
    serde_json::from_str(args).unwrap_or_else(|_| json!({}))
}

/// 연속된 도구 응답을 하나의 user Content로 합친다.
fn append_tool_response(contents: &mut Vec<Value>, part: Value) {
    if let Some(last) = contents.last_mut()
        && last.get("role").and_then(Value::as_str) == Some("user")
        && let Some(parts) = last.get_mut("parts").and_then(Value::as_array_mut)
        && parts
            .iter()
            .all(|item| item.get("functionResponse").is_some())
    {
        parts.push(part);
        return;
    }
    contents.push(content("user", &[part]));
}

/// 채팅 메시지를 Gemini contents와 systemInstruction으로 나눈다.
fn request_contents(messages: &[Value]) -> Option<(Vec<Value>, Vec<String>)> {
    let mut system: Vec<String> = Vec::new();
    let mut contents = Vec::new();
    for message in messages {
        let role = text(message, "role")?;
        let value = message.get("content")?.as_str()?;
        match role {
            "system" => system.push(value.to_owned()),
            "user" => contents.push(content("user", &[json!({ "text": value })])),
            "assistant" => {
                let mut parts = Vec::new();
                if !value.is_empty() {
                    parts.push(json!({ "text": value }));
                }
                if let Some(calls) = message.get("toolCalls").and_then(Value::as_array) {
                    for call in calls {
                        let function = call.get("function")?;
                        let mut mapped = json!({
                            "name": text(function, "name")?,
                            "args": function_args(function),
                        });
                        if let Some(signature) = text(call, "thoughtSignature")
                            && let Some(object) = mapped.as_object_mut()
                        {
                            object.insert("thoughtSignature".to_owned(), json!(signature));
                        }
                        if let Some(id) = text(call, "id")
                            && let Some(object) = mapped.as_object_mut()
                        {
                            object.insert("id".to_owned(), json!(id));
                        }
                        parts.push(json!({ "functionCall": mapped }));
                    }
                }
                if !parts.is_empty() {
                    contents.push(content("model", &parts));
                }
            }
            "tool" => {
                let response =
                    if message.get("tool_result_is_error").and_then(Value::as_bool) == Some(true) {
                        json!({ "error": value })
                    } else {
                        json!({ "output": value })
                    };
                let mut mapped = json!({
                    "name": text(message, "name").unwrap_or("tool"),
                    "response": response,
                });
                if let Some(id) = text(message, "tool_call_id")
                    && let Some(object) = mapped.as_object_mut()
                {
                    object.insert("id".to_owned(), json!(id));
                }
                append_tool_response(&mut contents, json!({ "functionResponse": mapped }));
            }
            _ => return None,
        }
    }
    Some((contents, system))
}

/// 도구 정의와 toolChoice를 Gemini tools/toolConfig로 바꾼다.
fn request_tools(input: &Value) -> Option<Value> {
    let functions = input
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|tool| {
            let function = tool.get("function")?;
            Some(json!({
                "name": text(function, "name")?,
                "description": function.get("description").and_then(Value::as_str).unwrap_or(""),
                "parametersJsonSchema": function.get("parameters")?,
            }))
        })
        .collect::<Option<Vec<_>>>()?;
    if functions.is_empty() {
        return None;
    }
    let mode = match text(input, "toolChoice").unwrap_or("auto") {
        "none" => "NONE",
        "required" => "ANY",
        "auto" => "AUTO",
        _ => return None,
    };
    Some(json!({
        "tools": [{ "functionDeclarations": functions }],
        "toolConfig": { "functionCallingConfig": { "mode": mode } },
    }))
}

/// 공개 API와 Code Assist의 공통 `GenerateContentRequest`를 만든다.
fn request(input: &Value) -> Option<Value> {
    let messages = input.get("messages")?.as_array()?;
    let mut body = Map::new();
    let (contents, system) = request_contents(messages)?;
    body.insert("contents".to_owned(), json!(contents));
    if !system.is_empty() {
        body.insert(
            "systemInstruction".to_owned(),
            json!({ "parts": [{ "text": system.join("\n\n") }] }),
        );
    }
    if let Some(tools) = request_tools(input) {
        for key in ["tools", "toolConfig"] {
            if let Some(value) = tools.get(key) {
                body.insert(key.to_owned(), value.clone());
            }
        }
    }
    let mut generation = Map::new();
    if let Some(temperature) = number(input.get("temperature")) {
        generation.insert("temperature".to_owned(), json!(temperature));
    }
    if let Some(max_output) = positive(input.get("maxOutputTokens")) {
        generation.insert("maxOutputTokens".to_owned(), json!(max_output));
    }
    generation.insert(
        "thinkingConfig".to_owned(),
        json!({ "includeThoughts": true }),
    );
    body.insert("generationConfig".to_owned(), json!(generation));
    if text(input, "api") == Some("codeAssist") {
        return Some(json!({
            "project": text(input, "project")?,
            "model": text(input, "model")?,
            "request": body,
        }));
    }
    Some(json!(body))
}

/// `functionCall` part를 공통 `ToolCallDelta`로 바꾼다.
fn tool_call(part: &Value, index: usize) -> Option<Value> {
    let call = part.get("functionCall")?;
    let name = text(call, "name")?;
    let id = text(call, "id").map_or_else(|| format!("gemini-call-{index}-{name}"), str::to_owned);
    let arguments = call.get("args").map_or_else(
        || json!("{}"),
        |args| match args {
            Value::String(value) => json!(value),
            _ => json!(args.to_string()),
        },
    );
    let mut output = json!({
        "index": index,
        "id": id,
        "type": "function",
        "function": { "name": name, "arguments": arguments },
    });
    if let Some(signature) = part.get("thoughtSignature").and_then(Value::as_str)
        && let Some(object) = output.as_object_mut()
    {
        object.insert("thoughtSignature".to_owned(), json!(signature));
    }
    Some(output)
}

/// SSE 이벤트 하나를 공통 `StreamChunk`로 바꾼다.
fn stream_payload(event: &Value, index_base: usize) -> Value {
    let payload = event.get("response").unwrap_or(event);
    if event.get("error").is_some() || payload.get("error").is_some() {
        return json!({ "content": "", "done": true, "error": true });
    }
    let candidate = payload.pointer("/candidates/0");
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut calls = Vec::new();
    if let Some(candidate) = candidate
        && let Some(parts) = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
    {
        for (part_index, part) in parts.iter().enumerate() {
            if let Some(value) = part.get("text").and_then(Value::as_str) {
                if part.get("thought").and_then(Value::as_bool) == Some(true) {
                    reasoning.push_str(value);
                } else {
                    content.push_str(value);
                }
            }
            if let Some(call) = tool_call(part, index_base + part_index) {
                calls.push(call);
            }
        }
    }
    let finish = candidate
        .and_then(|item| text(item, "finishReason"))
        .or_else(|| {
            payload
                .pointer("/promptFeedback/blockReason")
                .and_then(Value::as_str)
        });
    let done = finish.is_some();
    let mut output = Map::new();
    output.insert("content".to_owned(), json!(content));
    if !reasoning.is_empty() {
        output.insert("reasoning".to_owned(), json!(reasoning));
    }
    if !calls.is_empty() {
        output.insert("toolCalls".to_owned(), json!(calls));
        output.insert("toolCallCount".to_owned(), json!(calls.len()));
    }
    output.insert("done".to_owned(), json!(done));
    if let Some(finish) = finish {
        output.insert("finishReason".to_owned(), json!(finish));
    }
    json!(output)
}

/// SSE `data` 문자열을 파싱해 `StreamChunk`를 만든다.
fn stream_event(input: &Value) -> Option<Value> {
    let event: Value = serde_json::from_str(text(input, "data")?).ok()?;
    let index_base = input
        .get("toolCallIndexBase")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(0);
    Some(stream_payload(&event, index_base))
}

/// 비스트리밍 응답을 공개 API와 Code Assist envelope 모두에서 읽는다.
fn response(input: &Value) -> Option<Value> {
    let payload: Value = serde_json::from_str(text(input, "text")?).ok()?;
    let payload = payload.get("response").unwrap_or(&payload);
    if payload.get("error").is_some() {
        return Some(json!({ "error": true }));
    }
    let candidate = payload.pointer("/candidates/0");
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut calls = Vec::new();
    if let Some(candidate) = candidate
        && let Some(parts) = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
    {
        for (part_index, part) in parts.iter().enumerate() {
            if let Some(value) = part.get("text").and_then(Value::as_str) {
                if part.get("thought").and_then(Value::as_bool) == Some(true) {
                    reasoning.push_str(value);
                } else {
                    content.push_str(value);
                }
            }
            if let Some(call) = tool_call(part, part_index) {
                calls.push(call);
            }
        }
    }
    if content.is_empty()
        && reasoning.is_empty()
        && calls.is_empty()
        && payload.pointer("/promptFeedback/blockReason").is_some()
    {
        return Some(json!({ "error": true }));
    }
    Some(json!({
        "content": content,
        "reasoning": reasoning,
        "toolCalls": calls,
        "model": payload.get("modelVersion").and_then(Value::as_str),
    }))
}

/// 저장된 Google OAuth 자격 증명의 필수 필드를 검증한다.
fn credentials(value: &Value) -> Option<Value> {
    Some(json!({
        "accessToken": text(value, "accessToken")?,
        "refreshToken": text(value, "refreshToken")?,
        "expiresAt": value.get("expiresAt")?.as_u64()?,
        "projectId": text(value, "projectId")?,
        "email": value.get("email").and_then(Value::as_str),
    }))
}

/// Google 토큰 응답을 만료 시각이 있는 자격 증명으로 바꾼다.
fn token(input: &Value) -> Option<Value> {
    let token = input.get("token")?;
    let seconds = positive(token.get("expires_in"))?;
    let expires_at = input
        .get("now")?
        .as_u64()?
        .checked_add(seconds.checked_mul(1000)?)?;
    Some(json!({
        "accessToken": text(token, "access_token")?,
        "refreshToken": text(token, "refresh_token").or_else(|| text(input, "refreshToken"))?,
        "expiresAt": expires_at,
        "projectId": text(input, "projectId"),
        "email": text(input, "email"),
    }))
}

/// `loadCodeAssist`·`onboardUser` 응답에서 프로젝트와 tier를 고른다.
fn project(input: &Value) -> Option<Value> {
    if let Some(project_id) = input
        .pointer("/onboard/response/cloudaicompanionProject/id")
        .and_then(Value::as_str)
        .filter(|project| !project.trim().is_empty())
    {
        return Some(json!({ "projectId": project_id }));
    }
    let load = input.get("load")?;
    if let Some(project_id) = text(load, "cloudaicompanionProject").or_else(|| {
        load.pointer("/cloudaicompanionProject/id")
            .and_then(Value::as_str)
    }) {
        return Some(json!({ "projectId": project_id }));
    }
    let tier = load
        .get("allowedTiers")
        .and_then(Value::as_array)
        .and_then(|tiers| {
            tiers
                .iter()
                .find(|tier| tier.get("isDefault").and_then(Value::as_bool) == Some(true))
        })
        .and_then(|tier| text(tier, "id"))
        .or_else(|| load.pointer("/currentTier/id").and_then(Value::as_str));
    if let Some(tier) = tier {
        return Some(json!({ "needsOnboard": true, "tierId": tier }));
    }
    let message = load
        .get("ineligibleTiers")
        .and_then(Value::as_array)
        .and_then(|tiers| tiers.first())
        .and_then(|tier| text(tier, "reasonMessage"));
    Some(json!({ "error": message.unwrap_or("project-required") }))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::plan;

    fn text(value: &Value, pointer: &str) -> Option<String> {
        value
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::to_owned)
    }

    #[test]
    fn public_request_maps_roles_tools_and_tool_results() {
        let body = plan(&json!({
            "operation": "request",
            "model": "gemini-test",
            "messages": [
                {"role": "system", "content": "be concise"},
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "", "toolCalls": [
                    {"id": "call-1", "function": {"name": "read", "arguments": "{\"path\":\"a\"}"}}
                ]},
                {"role": "tool", "content": "done", "name": "read", "tool_call_id": "call-1"}
            ],
            "tools": [{"type": "function", "function": {
                "name": "read", "description": "read a file", "parameters": {"type": "object"}
            }}],
            "toolChoice": "required",
            "temperature": 0.2,
            "maxOutputTokens": 64
        }))
        .unwrap_or_default();
        assert_eq!(
            text(&body, "/systemInstruction/parts/0/text").as_deref(),
            Some("be concise")
        );
        assert_eq!(
            text(&body, "/contents/1/parts/0/functionCall/name").as_deref(),
            Some("read")
        );
        assert_eq!(
            text(&body, "/contents/2/parts/0/functionResponse/id").as_deref(),
            Some("call-1")
        );
        assert_eq!(
            text(&body, "/toolConfig/functionCallingConfig/mode").as_deref(),
            Some("ANY")
        );
        assert_eq!(
            body.pointer("/generationConfig/maxOutputTokens"),
            Some(&json!(64))
        );
        assert!(body.get("project").is_none());
    }

    #[test]
    fn code_assist_request_wraps_project_and_model() {
        let body = plan(&json!({
            "operation": "request",
            "api": "codeAssist",
            "project": "project-1",
            "model": "gemini-test",
            "messages": [{"role": "user", "content": "hello"}],
            "tools": [],
            "toolChoice": "auto"
        }))
        .unwrap_or_default();
        assert_eq!(text(&body, "/project").as_deref(), Some("project-1"));
        assert_eq!(text(&body, "/model").as_deref(), Some("gemini-test"));
        assert_eq!(
            text(&body, "/request/contents/0/role").as_deref(),
            Some("user")
        );
    }

    #[test]
    fn stream_event_reads_text_thought_and_function_calls_from_both_envelopes() {
        let event = json!({"response": {"candidates": [{"content": {"parts": [
            {"text": "answer"}, {"text": "thought", "thought": true},
            {"functionCall": {"name": "read", "args": {"path": "a"}}}
        ]}, "finishReason": "STOP"}]}});
        let chunk = plan(&json!({"operation": "stream-event", "data": event.to_string()}))
            .unwrap_or_default();
        assert_eq!(text(&chunk, "/content").as_deref(), Some("answer"));
        assert_eq!(text(&chunk, "/reasoning").as_deref(), Some("thought"));
        assert_eq!(chunk.get("toolCallCount"), Some(&json!(1)));
        assert_eq!(chunk.get("done"), Some(&json!(true)));
        assert_eq!(
            text(&chunk, "/toolCalls/0/function/arguments").as_deref(),
            Some("{\"path\":\"a\"}")
        );
    }

    #[test]
    fn response_reads_public_payload_and_rejects_blocked_prompts() {
        let body = plan(&json!({"operation": "response", "text": json!({
            "candidates": [{"content": {"parts": [{"text": "answer"}]}}]
        }).to_string()}))
        .unwrap_or_default();
        assert_eq!(text(&body, "/content").as_deref(), Some("answer"));
        let blocked = plan(&json!({"operation": "response", "text": json!({
            "promptFeedback": {"blockReason": "SAFETY"}
        }).to_string()}))
        .unwrap_or_default();
        assert_eq!(blocked.get("error"), Some(&json!(true)));
    }

    #[test]
    fn project_discovery_prefers_existing_project_then_onboarding() {
        let existing = plan(&json!({"operation": "project", "load": {
            "cloudaicompanionProject": "project-1"
        }}))
        .unwrap_or_default();
        assert_eq!(text(&existing, "/projectId").as_deref(), Some("project-1"));
        let onboard = plan(&json!({"operation": "project", "load": {
            "allowedTiers": [{"id": "free-tier", "isDefault": true}]
        }}))
        .unwrap_or_default();
        assert_eq!(text(&onboard, "/tierId").as_deref(), Some("free-tier"));
        let created = plan(&json!({"operation": "project", "load": {},
            "onboard": {"response": {"cloudaicompanionProject": {"id": "project-2"}}}
        }))
        .unwrap_or_default();
        assert_eq!(text(&created, "/projectId").as_deref(), Some("project-2"));
    }
}
