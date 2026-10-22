//! 지원 파일의 구조 경계와 안정적인 청크 식별자를 공통으로 계획합니다.

use super::{Chunk, ChunkMetadata, JsonValue, chunk_markdown, chunk_plain_text, finalize_chunks};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::wasm_bindgen;

/// 현재 내용 기반 청크 ID와 일치하는 저장 벡터의 이관 인덱스를 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_chunk_import_indices_json(input_json: &str) -> String {
    let Ok(JsonValue::Array(entries)) = serde_json::from_str::<JsonValue>(input_json) else {
        return "null".to_owned();
    };
    let indices = entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let path = entry.get("filePath")?.as_str()?;
            let hash = entry.get("chunkHash")?.as_str()?;
            if hash.len() != 16
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return None;
            }
            let prefix = format!("{path}::chunk::{hash}::");
            let ordinal = entry.get("id")?.as_str()?.strip_prefix(&prefix)?;
            if ordinal.parse::<usize>().ok()?.to_string() != ordinal {
                return None;
            }
            Some(index)
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&indices).unwrap_or_else(|_| "null".to_owned())
}

/// 파일 형식별 원문 경계와 내용 기반 청크 ID를 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_chunks_json(
    path: &str,
    extension: &str,
    content: &str,
    max_size: usize,
    overlap: usize,
) -> String {
    let extension = if extension.is_empty() {
        path.rsplit_once('.').map_or("", |(_, extension)| extension)
    } else {
        extension
    }
    .to_ascii_lowercase();
    let chunks = match extension.as_str() {
        "md" | "markdown" => chunk_markdown(content, max_size, overlap),
        "json" if serde_json::from_str::<JsonValue>(content).is_ok() => {
            structured_chunks(content, max_size, overlap, true)
        }
        "csv" | "tsv" => csv_chunks(content, max_size),
        "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "java" | "c" | "cpp" | "h" | "go" | "swift"
        | "cs" | "kt" => structured_chunks(content, max_size, overlap, false),
        _ => chunk_plain_text(content, max_size, overlap),
    };
    let mut occurrences = BTreeMap::<String, usize>::new();
    let output = chunks
        .into_iter()
        .map(|chunk| {
            let hash = chunk_hash(&chunk);
            let ordinal = occurrences.entry(hash.clone()).or_default();
            let id = format!("{path}::chunk::{hash}::{ordinal}");
            *ordinal = ordinal.saturating_add(1);
            let mut output = serde_json::json!({
                "id": id, "chunkHash": hash, "text": chunk.text,
                "metadata": {
                    "filePath": path, "heading": chunk.metadata.heading,
                    // 청커 내부 metadata는 0부터 시작하지만, 인용·Obsidian 행 번호·검증 문서는
                    // 모두 1부터 시작합니다. 소비자 경계인 여기서 한 번만 변환합니다.
                    "startLine": chunk.metadata.start_line.saturating_add(1),
                    "endLine": chunk.metadata.end_line.saturating_add(1)
                }
            });
            if chunk.metadata.heading.is_none()
                && let Some(metadata) = output
                    .get_mut("metadata")
                    .and_then(JsonValue::as_object_mut)
            {
                metadata.remove("heading");
            }
            output
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&output).unwrap_or_else(|_| "null".to_owned())
}

/// 줄 위치와 독립적으로 본문과 구조 힌트를 UTF-8의 64비트 FNV-1a에 매핑합니다.
fn chunk_hash(chunk: &Chunk) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in chunk
        .metadata
        .heading
        .as_deref()
        .unwrap_or_default()
        .bytes()
        .chain([0])
        .chain(chunk.text.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// 구간의 실제 원문과 줄 위치를 보존합니다.
fn source_chunk(
    content: &str,
    line_offsets: &[usize],
    start: usize,
    end: usize,
    heading: Option<String>,
) -> Option<Chunk> {
    let raw = content.get(start..end)?;
    let text = raw.trim_matches(['\n', '\r']);
    if text.trim().is_empty() {
        return None;
    }
    let start = start.saturating_add(
        raw.len()
            .saturating_sub(raw.trim_start_matches(['\n', '\r']).len()),
    );
    let start_line = line_offsets.partition_point(|offset| *offset < start);
    let end_line =
        line_offsets.partition_point(|offset| *offset < start.saturating_add(text.len()));
    Some(Chunk {
        text: text.to_owned(),
        metadata: ChunkMetadata {
            file_path: String::new(),
            heading,
            start_line,
            end_line,
        },
    })
}

/// 문자열·주석 내부의 괄호를 제외하고 JSON 항목과 코드 블록 경계를 찾습니다.
fn structured_chunks(content: &str, max_size: usize, overlap: usize, json: bool) -> Vec<Chunk> {
    let line_offsets = content
        .match_indices('\n')
        .map(|(offset, _)| offset)
        .collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut start = 0_usize;
    let mut depth = 0_usize;
    let mut quote = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    let mut chars = content.char_indices().peekable();
    while let Some((offset, character)) = chars.next() {
        let next = chars.peek().map(|(_, value)| *value);
        if line_comment {
            if character == '\n' {
                line_comment = false;
            }
            continue;
        }
        if block_comment {
            if character == '*' && next == Some('/') {
                chars.next();
                block_comment = false;
            }
            continue;
        }
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
            continue;
        }
        if !json && character == '/' && matches!(next, Some('/' | '*')) {
            line_comment = next == Some('/');
            block_comment = next == Some('*');
            chars.next();
            continue;
        }
        if matches!(character, '"' | '\'' | '`') {
            quote = Some(character);
            continue;
        }
        if matches!(character, '{' | '[' | '(') {
            depth = depth.saturating_add(1);
        }
        if matches!(character, '}' | ']' | ')') {
            depth = depth.saturating_sub(1);
        }
        let boundary = if json {
            character == ',' && depth == 1
        } else {
            depth == 0
                && (character == '}'
                    || character == ';'
                    || (character == '\n' && next == Some('\n')))
        };
        if boundary {
            let end = offset.saturating_add(character.len_utf8());
            push_structured_chunk(&mut chunks, content, &line_offsets, start, end, json);
            start = end;
        }
    }
    push_structured_chunk(
        &mut chunks,
        content,
        &line_offsets,
        start,
        content.len(),
        json,
    );
    finalize_chunks(chunks, max_size, overlap)
}

/// 최상위 JSON 키 또는 코드 선언을 검색 힌트로 유지합니다.
fn push_structured_chunk(
    chunks: &mut Vec<Chunk>,
    content: &str,
    line_offsets: &[usize],
    start: usize,
    end: usize,
    json: bool,
) {
    let Some(text) = content.get(start..end) else {
        return;
    };
    let trimmed = text.trim().trim_start_matches(['{', '[']).trim_start();
    let heading = if json {
        json_key_hint(trimmed).map(|key| format!("$.{key}"))
    } else {
        trimmed
            .lines()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().chars().take(120).collect())
    };
    if let Some(chunk) = source_chunk(content, line_offsets, start, end, heading) {
        chunks.push(chunk);
    }
}

/// JSON 키의 이스케이프를 표준 파서로 복원합니다.
fn json_key_hint(text: &str) -> Option<String> {
    if !text.starts_with('"') {
        return None;
    }
    let mut escaped = false;
    for (offset, character) in text.char_indices().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '"' {
            let end = offset.saturating_add(1);
            if !text.get(end..)?.trim_start().starts_with(':') {
                return None;
            }
            return serde_json::from_str::<String>(text.get(..end)?).ok();
        }
    }
    None
}

/// CSV 인용부 내부의 줄바꿈과 이중 인용부를 보존하고 레코드 사이에서만 청킹합니다.
fn csv_chunks(content: &str, max_size: usize) -> Vec<Chunk> {
    let line_offsets = content
        .match_indices('\n')
        .map(|(offset, _)| offset)
        .collect::<Vec<_>>();
    let mut records = Vec::new();
    let mut start = 0_usize;
    let mut quoted = false;
    let mut chars = content.char_indices().peekable();
    while let Some((offset, character)) = chars.next() {
        if character == '"' {
            if quoted && chars.peek().is_some_and(|(_, next)| *next == '"') {
                chars.next();
            } else {
                quoted = !quoted;
            }
        }
        if character == '\n' && !quoted {
            records.push((start, offset.saturating_add(1)));
            start = offset.saturating_add(1);
        }
    }
    if quoted {
        return chunk_plain_text(content, max_size, 0);
    }
    if start < content.len() {
        records.push((start, content.len()));
    }
    let heading = records
        .first()
        .and_then(|(start, end)| content.get(*start..*end))
        .map(|header| header.trim_end().to_owned());
    let mut chunks = Vec::new();
    let mut group_start = 0_usize;
    let mut group_end = 0_usize;
    for (start, end) in records {
        if group_end > group_start && end.saturating_sub(group_start) > max_size {
            if let Some(chunk) = source_chunk(
                content,
                &line_offsets,
                group_start,
                group_end,
                heading.clone(),
            ) {
                chunks.push(chunk);
            }
            group_start = start;
        }
        group_end = end;
    }
    if let Some(chunk) = source_chunk(content, &line_offsets, group_start, group_end, heading) {
        chunks.push(chunk);
    }
    chunks
}
