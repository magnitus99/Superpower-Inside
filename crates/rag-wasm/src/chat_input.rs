//! 채팅 근거 구간과 완전한 대화 턴을 전송 예산 안에서 선택합니다.

use std::collections::BTreeSet;

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

use super::{
    Chunk, ChunkMetadata, chunk_markdown, context_source_citation_json, count_keyword_matches,
    tokenize,
};

/// JSON 파싱 전에 제한하는 호스트 입력 크기입니다.
const MAX_INPUT_BYTES: usize = 16 * 1024 * 1024;

/// 선택할 원문의 출처와 표시 정보를 함께 전달합니다.
struct EvidenceFormat<'a> {
    /// 검증된 원문 메타데이터입니다.
    source: &'a JsonValue,
    /// 첫 출처 식별자입니다.
    id: &'a str,
    /// 표시할 종류입니다.
    label: &'a str,
    /// 볼트 경로입니다.
    path: &'a str,
    /// 원문 구간의 시작 줄입니다.
    start: usize,
}

/// 현재 원문에서 질문에 맞는 완전한 Markdown 구간만 전달 근거로 선택합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_evidence_json(input_json: &str) -> String {
    if input_json.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    let Ok(input) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(source) = input.get("source") else {
        return String::new();
    };
    let (Some(content), Some(path), Some(id), Some(label), Some(question), Some(max_chars)) = (
        source.get("text").and_then(JsonValue::as_str),
        source.get("filePath").and_then(JsonValue::as_str),
        input.get("sourceId").and_then(JsonValue::as_str),
        input.get("label").and_then(JsonValue::as_str),
        input.get("question").and_then(JsonValue::as_str),
        input
            .get("maxChars")
            .and_then(JsonValue::as_u64)
            .and_then(|value| usize::try_from(value).ok()),
    ) else {
        return String::new();
    };
    let remaining_sources = input
        .get("remainingSources")
        .and_then(JsonValue::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(1)
        .max(1);
    let allowance = max_chars.div_euclid(remaining_sources);
    let start = source
        .get("startLine")
        .and_then(JsonValue::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(0);
    let whole = Chunk {
        text: content.to_owned(),
        metadata: ChunkMetadata {
            file_path: path.to_owned(),
            heading: source
                .get("heading")
                .and_then(JsonValue::as_str)
                .map(str::to_owned),
            start_line: 0,
            end_line: content.split('\n').count().saturating_sub(1),
        },
    };
    let whole_block = evidence_block(&whole, source, id, label, path, start);
    let complete = whole_block.0.encode_utf16().count().saturating_add(7) <= allowance
        && !content.trim().is_empty();
    let chunks = if complete {
        vec![whole]
    } else {
        chunk_markdown(content, allowance.saturating_sub(160).clamp(64, 1_200), 0)
    };
    let selected = select_evidence_chunks(
        &chunks,
        content,
        question,
        &EvidenceFormat {
            source,
            id,
            label,
            path,
            start,
        },
        allowance,
    );
    let mut blocks = Vec::new();
    let mut citations = Vec::new();
    let mut source_ids = Vec::new();
    for index in selected {
        let Some(chunk) = chunks.get(index) else {
            continue;
        };
        let source_id = evidence_source_id(id, citations.len());
        let (text, citation) = evidence_block(chunk, source, &source_id, label, path, start);
        blocks.push(json!({"sourceId": source_id, "text": text}));
        citations.push(citation);
        source_ids.push(source_id);
    }
    let actual_chars = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(JsonValue::as_str))
        .map(|text| text.encode_utf16().count().saturating_add(7))
        .sum::<usize>();
    if actual_chars > allowance {
        return String::new();
    }
    json!({"blocks": blocks, "citations": citations, "sourceIds": source_ids,
        "rejectedCount": 0, "complete": complete && !source_ids.is_empty(), "actualChars": actual_chars}).to_string()
}

/// 기존 출처 파서가 인식하는 접두사와 연속 숫자 형식을 유지합니다.
fn evidence_source_id(id: &str, offset: usize) -> String {
    let (prefix, first) = id.rsplit_once('-').unwrap_or((id, "1"));
    let ordinal = first.parse::<usize>().unwrap_or(1).saturating_add(offset);
    format!("{prefix}-{ordinal}")
}

/// 질문과 관련된 완전한 구간을 예산 안에서 선택합니다.
fn select_evidence_chunks(
    chunks: &[Chunk],
    content: &str,
    question: &str,
    format: &EvidenceFormat<'_>,
    allowance: usize,
) -> BTreeSet<usize> {
    let tokens = tokenize(question).join("\u{1f}");
    let mut ranked = chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| (index, count_keyword_matches(&tokens, &chunk.text)))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    let has_matches = ranked.iter().any(|(_, score)| *score > 0);
    let boundaries = markdown_boundaries(content);
    let mut selected = BTreeSet::new();
    let mut used = 0usize;
    for (index, score) in ranked {
        if has_matches && score == 0 {
            continue;
        }
        let Some(chunk) = chunks.get(index) else {
            continue;
        };
        if boundaries.get(chunk.metadata.start_line) != Some(&true)
            || boundaries.get(chunk.metadata.end_line.saturating_add(1)) != Some(&true)
        {
            continue;
        }
        // 정렬 후 숫자 폭이 커질 가능성까지 보수적으로 예약합니다.
        let reserved_id = evidence_source_id(format.id, chunks.len());
        let (text, _) = evidence_block(
            chunk,
            format.source,
            &reserved_id,
            format.label,
            format.path,
            format.start,
        );
        let size = text.encode_utf16().count().saturating_add(7);
        if !chunk.text.trim().is_empty() && used.saturating_add(size) <= allowance {
            selected.insert(index);
            used = used.saturating_add(size);
        }
    }
    selected
}

/// 긴 fenced block을 잘라 만든 청크가 원문 근거로 승격되는 것을 막습니다.
fn markdown_boundaries(content: &str) -> Vec<bool> {
    let mut fence: Option<(char, usize)> = None;
    let mut boundaries = vec![true];
    for line in content.split('\n') {
        let trimmed = line.trim_start();
        let marker = trimmed.chars().next().unwrap_or_default();
        if matches!(marker, '`' | '~') {
            let width = trimmed
                .chars()
                .take_while(|character| *character == marker)
                .count();
            if width >= 3 {
                if let Some((open_marker, open_width)) = fence {
                    if marker == open_marker && width >= open_width {
                        fence = None;
                    }
                } else {
                    fence = Some((marker, width));
                }
            }
        }
        boundaries.push(fence.is_none());
    }
    boundaries
}

/// 전달 구간의 실제 줄 범위와 미리보기로 출처를 만듭니다.
fn evidence_block(
    chunk: &Chunk,
    source: &JsonValue,
    id: &str,
    label: &str,
    path: &str,
    start: usize,
) -> (String, JsonValue) {
    let mut metadata = source.as_object().cloned().unwrap_or_default();
    metadata.insert(
        "startLine".to_owned(),
        json!(start.saturating_add(chunk.metadata.start_line)),
    );
    metadata.insert(
        "endLine".to_owned(),
        json!(start.saturating_add(chunk.metadata.end_line)),
    );
    if let Some(heading) = &chunk.metadata.heading {
        metadata.insert("heading".to_owned(), json!(heading));
    }
    let text = format!(
        "[{label}: {path}]\n[Source {id}: {path}]\n[Lines {}-{}]\n{}",
        start
            .saturating_add(chunk.metadata.start_line)
            .saturating_add(1),
        start
            .saturating_add(chunk.metadata.end_line)
            .saturating_add(1),
        chunk.text
    );
    let citation = context_source_citation_json(
        id,
        &JsonValue::Object(metadata),
        None,
        "verified",
        path,
        &chunk.text,
    );
    (text, citation)
}

/// 시스템 지침·최신 요청을 보존하며 오래된 완전한 턴만 예산에 따라 제외합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_request_json(input_json: &str) -> String {
    if input_json.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    let Ok(input) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let (Some(messages), Some(reserved), Some(max_bytes)) = (
        input.get("messages").and_then(JsonValue::as_array),
        input
            .get("reservedBytes")
            .and_then(JsonValue::as_u64)
            .and_then(|value| usize::try_from(value).ok()),
        input
            .get("maxBytes")
            .and_then(JsonValue::as_u64)
            .and_then(|value| usize::try_from(value).ok()),
    ) else {
        return String::new();
    };
    let mut systems = Vec::new();
    let mut turns = Vec::<Vec<usize>>::new();
    for (index, message) in messages.iter().enumerate() {
        let (Some(role), Some(content)) = (
            message.get("role").and_then(JsonValue::as_str),
            message.get("content").and_then(JsonValue::as_str),
        ) else {
            return String::new();
        };
        if role == "system" {
            systems.push(index);
            continue;
        }
        if !matches!(role, "user" | "assistant" | "tool") {
            return String::new();
        }
        if turns.is_empty() || role == "user" && !is_turn_continuation(content) {
            turns.push(Vec::new());
        }
        if let Some(turn) = turns.last_mut() {
            turn.push(index);
        }
    }
    let message_size = |index: &usize| {
        messages
            .get(*index)
            .map_or(0, |message| message.to_string().len().saturating_add(1))
    };
    let mut selected = systems.iter().copied().collect::<BTreeSet<_>>();
    let mut used = reserved
        .saturating_add(2)
        .saturating_add(systems.iter().map(message_size).sum::<usize>());
    for (offset, turn) in turns.iter().rev().enumerate() {
        let size = turn.iter().map(message_size).sum::<usize>();
        if used.saturating_add(size) <= max_bytes {
            selected.extend(turn);
            used = used.saturating_add(size);
        } else if offset == 0 {
            return String::new();
        } else {
            break;
        }
    }
    if used > max_bytes {
        return String::new();
    }
    json!({"indices": selected.into_iter().collect::<Vec<_>>(), "usedBytes": used}).to_string()
}

/// 호환 도구 결과와 축약 envelope도 현재 사용자 요청의 일부입니다.
fn is_turn_continuation(content: &str) -> bool {
    [
        "[Superpower Inside agent checkpoint]",
        "[Superpower Inside tool results]",
        "[Superpower Inside tool protocol]",
        "[Superpower Inside grounded answer repair]",
    ]
    .iter()
    .any(|prefix| content.starts_with(prefix))
        || serde_json::from_str::<JsonValue>(content)
            .ok()
            .and_then(|value| {
                value
                    .get("kind")
                    .and_then(JsonValue::as_str)
                    .map(str::to_owned)
            })
            .is_some_and(|kind| kind == "tool-result-summary")
}

#[cfg(test)]
mod tests {
    use super::{plan_chat_evidence_json, plan_chat_request_json};
    use serde_json::{Value as JsonValue, json};

    /// 테스트 입력의 JSON wire 결과를 읽습니다.
    fn evidence(content: &str, max_chars: usize) -> JsonValue {
        serde_json::from_str(&plan_chat_evidence_json(
            &json!({
                "question": "deployment owner", "source": {"filePath": "note.md", "text": content},
                "sourceId": "file-1", "label": "File", "remainingSources": 1, "maxChars": max_chars
            })
            .to_string(),
        ))
        .unwrap_or(JsonValue::Null)
    }

    #[test]
    fn selects_relevant_tail_with_exact_source_range() {
        let content = format!(
            "# Background\n{}\n# Deployment\nThe deployment owner is Mina.",
            "Unrelated background.\n".repeat(100)
        );
        let plan = evidence(&content, 300);
        assert!(
            plan.pointer("/blocks/0/text")
                .and_then(JsonValue::as_str)
                .is_some_and(|text| text.contains("owner is Mina")),
            "질문과 관련된 후반부를 전달해야 합니다"
        );
        assert_eq!(
            plan.get("complete"),
            Some(&json!(false)),
            "부분 원문을 전체로 표시하면 안 됩니다"
        );
        assert!(
            plan.pointer("/citations/0/line")
                .and_then(JsonValue::as_u64)
                .is_some_and(|line| line > 100),
            "출처 줄은 실제 전달 구간이어야 합니다"
        );
    }

    #[test]
    fn does_not_register_budget_excluded_or_broken_code_evidence() {
        for plan in [
            evidence("content", 1),
            evidence(&format!("```ts\n{}\n```", "long code ".repeat(100)), 200),
        ] {
            assert_eq!(
                plan.get("sourceIds"),
                Some(&json!([])),
                "전달하지 않은 원문은 근거가 아닙니다"
            );
            assert_eq!(
                plan.get("actualChars"),
                Some(&json!(0)),
                "제외한 원문은 전송량이 없어야 합니다"
            );
        }
    }

    #[test]
    fn preserves_short_history_and_drops_whole_old_tool_turns() {
        let messages = json!([
            {"role":"system", "content":"rules"}, {"role":"user", "content":"x".repeat(500)},
            {"role":"assistant", "content":"", "toolCalls":[{"id":"a"}]},
            {"role":"tool", "content":"old source", "tool_call_id":"a"},
            {"role":"user", "content":"latest objective"}
        ]);
        let plan = plan_chat_request_json(
            &json!({"messages":messages, "reservedBytes":50, "maxBytes":250}).to_string(),
        );
        let parsed = serde_json::from_str::<JsonValue>(&plan).unwrap_or(JsonValue::Null);
        assert_eq!(
            parsed.get("indices"),
            Some(&json!([0, 4])),
            "도구 요청과 결과를 같은 턴으로 제외해야 합니다"
        );
        assert!(
            plan_chat_request_json(
                &json!({"messages":messages, "reservedBytes":50, "maxBytes":60}).to_string()
            )
            .is_empty(),
            "최신 요청을 잘라서 전송하면 안 됩니다"
        );
    }
}
