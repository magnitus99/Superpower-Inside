//! 완료된 대화만 선택하고 모델이 반환한 제목을 한 줄로 정규화합니다.

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
/// 완료된 대화의 제한된 요약 입력과 한 줄 제목을 반환합니다.
pub fn plan_session_title_json(messages_json: &str, generated_title: &str) -> String {
    plan(messages_json, generated_title)
        .map_or_else(|| "null".to_owned(), |value| value.to_string())
}

/// 추론과 도구 원문을 제외한 제한된 대화 입력을 만듭니다.
fn plan(messages_json: &str, generated_title: &str) -> Option<Value> {
    // ponytail: 첫 질문과 최근 메시지·본문 2,000자만 요약합니다. 전체 흐름이 필요하면 단계별 요약으로 확장합니다.
    let messages: Vec<Value> = serde_json::from_str(messages_json).ok()?;
    let latest = messages.last()?;
    if latest["role"] != "assistant" || !is_completed_answer(latest) {
        return None;
    }
    let mut conversation: Vec<Value> = messages
        .iter()
        .filter(|message| {
            message["role"] == "user"
                || (message["role"] == "assistant" && is_completed_answer(message))
        })
        .filter_map(|message| {
            let content = message["content"].as_str()?;
            if content.trim().is_empty() {
                return None;
            }
            Some(json!({"role": message["role"], "content": content.chars().take(2000).collect::<String>()}))
        })
        .collect();
    if conversation.len() < 2 || !conversation.iter().any(|message| message["role"] == "user") {
        return None;
    }
    if conversation.len() > 12 {
        conversation.drain(1..conversation.len() - 11);
    }
    let title = generated_title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title: String = title
        .trim_matches(['"', '\'', '`', '“', '”'])
        .chars()
        .take(50)
        .collect();
    Some(json!({"conversation": conversation, "title": title}))
}

/// 오류·취소·승인 대기·추가 질문을 최종 답변에서 제외합니다.
fn is_completed_answer(message: &Value) -> bool {
    message["status"] == "complete"
        && message["stopReason"] == "complete"
        && (message["turnStage"].is_null() || message["turnStage"] == "complete")
        && message["assistantQuestion"].is_null()
        && message["content"]
            .as_str()
            .is_some_and(|content| !content.trim().is_empty())
}

#[cfg(test)]
/// 합성 대화로 제목 생성 계약을 검증합니다.
mod tests {
    use super::*;

    #[test]
    fn completed_conversation_excludes_private_metadata_and_tool_results() {
        let messages = json!([
            {"role": "user", "content": "합성 질문", "attachments": [{"content": "비공개 참조"}]},
            {"role": "tool", "content": "도구 원문"},
            {"role": "assistant", "content": "합성 답변", "status": "complete", "stopReason": "complete", "reasoning": "비공개 추론"}
        ]);
        let plan: Value = serde_json::from_str(&plan_session_title_json(
            &messages.to_string(),
            "  \"합성\n대화 요약\"  ",
        ))
        .unwrap_or(Value::Null);
        assert_eq!(
            plan.get("conversation"),
            Some(&json!([
                {"role": "user", "content": "합성 질문"},
                {"role": "assistant", "content": "합성 답변"}
            ]))
        );
        assert_eq!(
            plan.get("title").and_then(Value::as_str),
            Some("합성 대화 요약")
        );
    }

    #[test]
    fn incomplete_failed_and_cancelled_turns_do_not_generate_titles() {
        for status in ["pending", "streaming", "error"] {
            let messages = json!([{"role":"user","content":"q"}, {"role":"assistant","content":"a","status":status}]);
            assert_eq!(
                plan_session_title_json(&messages.to_string(), "title"),
                "null"
            );
        }
        for reason in ["cancelled", "error", "tool-failed"] {
            let messages = json!([{"role":"user","content":"q"}, {"role":"assistant","content":"a","status":"complete","stopReason":reason}]);
            assert_eq!(
                plan_session_title_json(&messages.to_string(), "title"),
                "null"
            );
        }
    }

    #[test]
    fn unicode_titles_and_conversation_are_bounded() {
        let messages = json!([{"role":"user","content":"질".repeat(10000)}, {"role":"assistant","content":"답".repeat(10000),"status":"complete","stopReason":"complete"}]);
        let plan: Value = serde_json::from_str(&plan_session_title_json(
            &messages.to_string(),
            &"가".repeat(100),
        ))
        .unwrap_or(Value::Null);
        assert_eq!(
            plan.get("title")
                .and_then(Value::as_str)
                .map(|title| title.chars().count()),
            Some(50)
        );
        assert!(
            plan.get("conversation")
                .and_then(Value::as_array)
                .is_some_and(|conversation| conversation.iter().all(|message| message
                    .get("content")
                    .and_then(Value::as_str)
                    .is_some_and(|content| content.chars().count() <= 2000)))
        );
        assert_eq!(plan_session_title_json("invalid", "title"), "null");
    }
}
