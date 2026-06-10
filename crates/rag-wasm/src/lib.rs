//! `RAG` 인덱싱과 검색을 위한 `Rust WebAssembly` 코어.
//!
//! `JavaScript`는 `Obsidian UI`와 호스트 `I/O`만 담당한다. 이 크레이트는
//! `WebAssembly`에서 실행 가능한 이식성 있는 결정적 계산 커널을 담당한다.

#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use wasm_bindgen::prelude::wasm_bindgen;

/// 기존 `TypeScript` 해시가 쓰는 `FNV-1a` 32비트 오프셋 기준값.
const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
/// 기존 `TypeScript` 해시가 쓰는 `FNV-1a` 32비트 소수.
const FNV_PRIME: u32 = 0x0100_0193;
/// 기존 `TypeScript BM25` 검색 경로의 `k1` 상수.
const BM25_K1: f64 = 1.2;
/// 기존 `TypeScript BM25` 검색 경로의 `b` 상수.
const BM25_B: f64 = 0.75;

/// `TypeScript` 호스트에 노출할 `Rust` 코어 버전을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// 현재 `TypeScript` 경로와 같은 32비트 `FNV-1a` 콘텐츠 해시를 만든다.
#[must_use]
#[wasm_bindgen]
pub fn create_content_hash(content: &str) -> String {
    let mut hash = FNV_OFFSET_BASIS;
    for unit in content.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:08x}")
}

/// 현재 `TypeScript BM25` 경로와 같은 검색 토큰 규칙으로 텍스트를 토큰화한다.
#[must_use]
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut part = String::new();

    for character in text.chars() {
        if is_token_part_character(character) {
            part.push(character);
        } else {
            tokens.extend(tokenize_part(&part));
            part.clear();
        }
    }
    tokens.extend(tokenize_part(&part));
    tokens
}

/// 텍스트를 토큰화하고 `JavaScript` 호스트 브리지를 위한 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn tokenize_json(text: &str) -> String {
    let tokens = tokenize(text);
    let body = tokens
        .iter()
        .map(|token| format!("\"{}\"", escape_json_string(token)))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// 텍스트의 `BM25` term frequency map을 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn token_frequencies_json(text: &str) -> String {
    let tokens = tokenize(text);
    let mut frequencies = BTreeMap::<String, usize>::new();
    for token in &tokens {
        let count = frequencies.entry(token.clone()).or_insert(0);
        *count = count.saturating_add(1);
    }
    serialize_token_frequencies_json(tokens.len(), &frequencies)
}

/// 두 vector의 cosine similarity를 계산한다.
#[must_use]
pub fn cosine_similarity(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.is_empty() || left.len() != right.len() {
        return None;
    }

    let mut dot = 0.0_f64;
    let mut norm_left = 0.0_f64;
    let mut norm_right = 0.0_f64;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot = left_value.mul_add(*right_value, dot);
        norm_left = left_value.mul_add(*left_value, norm_left);
        norm_right = right_value.mul_add(*right_value, norm_right);
    }

    if norm_left == 0.0 || norm_right == 0.0 {
        return None;
    }

    Some(dot / (norm_left.sqrt() * norm_right.sqrt()))
}

/// `WASM` 호출용 cosine similarity. invalid vector는 `NaN`으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn cosine_similarity_or_nan(left: &[f64], right: &[f64]) -> f64 {
    cosine_similarity(left, right).unwrap_or(f64::NAN)
}

/// flattened vector matrix에서 top-k row index와 score 쌍을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn rank_top_k_pairs(
    query: &[f64],
    vectors: &[f64],
    dimensions: usize,
    top_k: usize,
) -> Box<[f64]> {
    if dimensions == 0 || top_k == 0 || query.len() != dimensions {
        return Box::default();
    }

    let mut scored = Vec::new();
    for (row_index, vector) in vectors.chunks_exact(dimensions).enumerate() {
        let Some(score) = cosine_similarity(query, vector) else {
            continue;
        };
        scored.push(ScoredRow { row_index, score });
    }

    scored.sort_by(compare_scored_rows_descending);
    scored.truncate(top_k);

    let mut pairs = Vec::with_capacity(scored.len() * 2);
    for scored_row in scored {
        if let Ok(index) = u32::try_from(scored_row.row_index) {
            pairs.push(f64::from(index));
            pairs.push(scored_row.score);
        }
    }
    pairs.into_boxed_slice()
}

/// flattened posting list에서 `BM25` doc index와 score 쌍을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn bm25_score_pairs(
    term_offsets: &[u32],
    doc_indices: &[u32],
    term_frequencies: &[f64],
    doc_lengths: &[f64],
    total_docs: usize,
    avg_doc_length: f64,
) -> Box<[f64]> {
    if term_offsets.len() < 2
        || doc_indices.len() != term_frequencies.len()
        || doc_lengths.is_empty()
        || total_docs == 0
        || !avg_doc_length.is_finite()
        || avg_doc_length <= 0.0
    {
        return Box::default();
    }

    let Some(total_docs_f64) = usize_to_f64(total_docs) else {
        return Box::default();
    };
    let mut scores = vec![0.0_f64; doc_lengths.len()];
    let mut seen = vec![false; doc_lengths.len()];

    for window in term_offsets.windows(2) {
        let [start, end] = window else {
            continue;
        };
        let Ok(start_index) = usize::try_from(*start) else {
            continue;
        };
        let Ok(end_index) = usize::try_from(*end) else {
            continue;
        };
        if start_index >= end_index || end_index > doc_indices.len() {
            continue;
        }
        let df = end_index.saturating_sub(start_index);
        let Some(df_f64) = usize_to_f64(df) else {
            continue;
        };
        let idf = ((total_docs_f64 - df_f64 + 0.5) / (df_f64 + 0.5)).ln_1p();

        for (doc_index_raw, tf) in doc_indices
            .iter()
            .copied()
            .zip(term_frequencies.iter().copied())
            .skip(start_index)
            .take(df)
        {
            if !tf.is_finite() || tf <= 0.0 {
                continue;
            }
            let Ok(doc_index) = usize::try_from(doc_index_raw) else {
                continue;
            };
            let Some(score_slot) = scores.get_mut(doc_index) else {
                continue;
            };
            let doc_length = doc_lengths
                .get(doc_index)
                .copied()
                .filter(|value| value.is_finite() && *value > 0.0)
                .unwrap_or(1.0);
            let denominator = BM25_K1.mul_add(
                BM25_B.mul_add(doc_length / avg_doc_length, 1.0 - BM25_B),
                tf,
            );
            if denominator <= 0.0 {
                continue;
            }
            *score_slot += idf * ((tf * (BM25_K1 + 1.0)) / denominator);
            if let Some(seen_slot) = seen.get_mut(doc_index) {
                *seen_slot = true;
            }
        }
    }

    let mut pairs = Vec::new();
    for (doc_index, (score, seen_doc)) in scores.into_iter().zip(seen).enumerate() {
        if !seen_doc || !score.is_finite() {
            continue;
        }
        if let Ok(index) = u32::try_from(doc_index) {
            pairs.push(f64::from(index));
            pairs.push(score);
        }
    }
    pairs.into_boxed_slice()
}

/// Markdown을 heading/code block/paragraph 경계 기준으로 chunk JSON으로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn chunk_markdown_json(content: &str, max_chunk_size: usize, overlap_chars: usize) -> String {
    let chunks = chunk_markdown(content, max_chunk_size, overlap_chars);
    serialize_chunks_json(&chunks)
}

/// 일반 텍스트와 코드 파일을 줄/빈 줄 경계 기준으로 chunk JSON으로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn chunk_plain_text_json(content: &str, max_chunk_size: usize, overlap_chars: usize) -> String {
    let chunks = chunk_plain_text(content, max_chunk_size, overlap_chars);
    serialize_chunks_json(&chunks)
}

/// vector row와 cosine score.
struct ScoredRow {
    /// flattened matrix 안의 row index.
    row_index: usize,
    /// query와 row vector의 cosine score.
    score: f64,
}

/// 높은 score 우선, 같은 score는 원래 row 순서 우선으로 정렬한다.
fn compare_scored_rows_descending(left: &ScoredRow, right: &ScoredRow) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.row_index.cmp(&right.row_index))
}

/// RAG chunk metadata.
#[derive(Clone)]
struct ChunkMetadata {
    /// vault-relative file path. Rust chunking 단계에서는 host I/O를 모르므로 비워둔다.
    file_path: String,
    /// Markdown heading title.
    heading: Option<String>,
    /// chunk 시작 line.
    start_line: usize,
    /// chunk 종료 line.
    end_line: usize,
}

/// RAG text chunk.
#[derive(Clone)]
struct Chunk {
    /// chunk text.
    text: String,
    /// chunk metadata.
    metadata: ChunkMetadata,
}

/// line-preserving text segment.
struct TextSegment {
    /// segment text.
    text: String,
    /// segment 시작 line.
    start_line: usize,
    /// segment 종료 line.
    end_line: usize,
}

/// Markdown을 heading/code block/paragraph 경계를 존중해 chunk로 나눈다.
fn chunk_markdown(content: &str, max_chunk_size: usize, overlap_chars: usize) -> Vec<Chunk> {
    let lines = content.split('\n').map(str::to_owned).collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut current_lines = Vec::new();
    let mut current_heading = None;
    let mut start_line = 0_usize;
    let mut in_code_block = false;

    for (index, line) in lines.iter().enumerate() {
        if line.starts_with("```") {
            in_code_block = !in_code_block;
            current_lines.push(line.clone());
            if !in_code_block {
                let chunk_text = current_lines.join("\n");
                if text_len(&chunk_text) > max_chunk_size {
                    flush_chunk(
                        &mut chunks,
                        &mut current_lines,
                        current_heading.as_ref(),
                        start_line,
                        index,
                    );
                    start_line = index.saturating_add(1);
                }
            }
            continue;
        }

        if !in_code_block && line.starts_with('#') {
            if !current_lines.is_empty() {
                flush_chunk(
                    &mut chunks,
                    &mut current_lines,
                    current_heading.as_ref(),
                    start_line,
                    index.saturating_sub(1),
                );
            }
            current_heading = Some(normalize_heading(line));
            start_line = index;
            current_lines = vec![line.clone()];
            continue;
        }

        current_lines.push(line.clone());
        let chunk_text = current_lines.join("\n");

        if !in_code_block && text_len(&chunk_text) >= max_chunk_size {
            let last_para_break = chunk_text
                .rfind("\n\n")
                .map(|break_index| text_len(&chunk_text[..break_index]));
            if last_para_break
                .is_some_and(|break_index| break_index.saturating_mul(2) > max_chunk_size)
            {
                split_at_paragraph_break(
                    &mut chunks,
                    &mut current_lines,
                    current_heading.as_ref(),
                    &mut start_line,
                    index,
                    last_para_break.unwrap_or_default(),
                );
            } else {
                flush_chunk(
                    &mut chunks,
                    &mut current_lines,
                    current_heading.as_ref(),
                    start_line,
                    index,
                );
                start_line = index.saturating_add(1);
            }
        }
    }

    if !current_lines.is_empty() {
        flush_chunk(
            &mut chunks,
            &mut current_lines,
            current_heading.as_ref(),
            start_line,
            lines.len().saturating_sub(1),
        );
    }

    finalize_chunks(chunks, max_chunk_size, overlap_chars)
}

/// 일반 텍스트와 코드 파일을 줄 경계를 우선해 chunk로 나눈다.
fn chunk_plain_text(content: &str, max_chunk_size: usize, overlap_chars: usize) -> Vec<Chunk> {
    let lines = content.split('\n').map(str::to_owned).collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut current_lines = Vec::new();
    let mut start_line = 0_usize;

    for (index, line) in lines.iter().enumerate() {
        current_lines.push(line.clone());
        let chunk_text = current_lines.join("\n");
        if text_len(&chunk_text) < max_chunk_size {
            continue;
        }

        let last_blank_line = current_lines
            .iter()
            .enumerate()
            .filter_map(|(line_index, candidate)| {
                if candidate.trim().is_empty() {
                    Some(line_index)
                } else {
                    None
                }
            })
            .next_back();

        if let Some(last_blank_line) = last_blank_line.filter(|line_index| *line_index > 0) {
            let part = current_lines
                .iter()
                .take(last_blank_line.saturating_add(1))
                .cloned()
                .collect::<Vec<_>>();
            let rest = current_lines
                .iter()
                .skip(last_blank_line.saturating_add(1))
                .cloned()
                .collect::<Vec<_>>();
            current_lines = part;
            flush_chunk(
                &mut chunks,
                &mut current_lines,
                None,
                start_line,
                index.saturating_sub(rest.len()),
            );
            current_lines = rest;
            start_line = index.saturating_sub(current_lines.len()).saturating_add(1);
            continue;
        }

        flush_chunk(&mut chunks, &mut current_lines, None, start_line, index);
        start_line = index.saturating_add(1);
    }

    if !current_lines.is_empty() {
        flush_chunk(
            &mut chunks,
            &mut current_lines,
            None,
            start_line,
            lines.len().saturating_sub(1),
        );
    }

    finalize_chunks(chunks, max_chunk_size, overlap_chars)
}

/// heading marker를 제거한다.
fn normalize_heading(line: &str) -> String {
    line.trim_start_matches('#').trim().to_owned()
}

/// current lines를 chunk로 flush한다.
fn flush_chunk(
    chunks: &mut Vec<Chunk>,
    current_lines: &mut Vec<String>,
    current_heading: Option<&String>,
    start_line: usize,
    end_line: usize,
) {
    let text = current_lines.join("\n").trim().to_owned();
    if !text.is_empty() {
        chunks.push(Chunk {
            text,
            metadata: ChunkMetadata {
                file_path: String::new(),
                heading: current_heading.cloned(),
                start_line,
                end_line,
            },
        });
    }
    current_lines.clear();
}

/// paragraph break 주변에서 현재 chunk를 나눈다.
fn split_at_paragraph_break(
    chunks: &mut Vec<Chunk>,
    current_lines: &mut Vec<String>,
    current_heading: Option<&String>,
    start_line: &mut usize,
    index: usize,
    last_para_break: usize,
) {
    let split_index = current_lines
        .iter()
        .enumerate()
        .find_map(|(line_index, _)| {
            let partial = current_lines
                .iter()
                .take(line_index.saturating_add(1))
                .cloned()
                .collect::<Vec<_>>()
                .join("\n");
            if text_len(&partial) >= last_para_break {
                Some(line_index)
            } else {
                None
            }
        });

    if let Some(split_index) = split_index {
        let part = current_lines
            .iter()
            .take(split_index.saturating_add(1))
            .cloned()
            .collect::<Vec<_>>();
        let rest = current_lines
            .iter()
            .skip(split_index.saturating_add(1))
            .cloned()
            .collect::<Vec<_>>();
        *current_lines = part;
        flush_chunk(chunks, current_lines, current_heading, *start_line, index);
        *current_lines = rest;
        *start_line = index.saturating_sub(current_lines.len()).saturating_add(1);
    } else {
        flush_chunk(chunks, current_lines, current_heading, *start_line, index);
        *start_line = index.saturating_add(1);
    }
}

/// 최종 chunk 크기 제한과 overlap을 적용한다.
fn finalize_chunks(chunks: Vec<Chunk>, max_chunk_size: usize, overlap_chars: usize) -> Vec<Chunk> {
    let sized_chunks = enforce_chunk_size(chunks, max_chunk_size);
    apply_line_overlap(sized_chunks, overlap_chars, max_chunk_size)
}

/// max size를 넘는 chunk를 hard split한다.
fn enforce_chunk_size(chunks: Vec<Chunk>, max_chunk_size: usize) -> Vec<Chunk> {
    let mut sized_chunks = Vec::new();
    for chunk in chunks {
        if text_len(&chunk.text) <= max_chunk_size {
            sized_chunks.push(chunk);
            continue;
        }
        for segment in
            split_text_to_segments(&chunk.text, chunk.metadata.start_line, max_chunk_size)
        {
            let mut next_chunk = chunk.clone();
            next_chunk.text = segment.text;
            next_chunk.metadata.start_line = segment.start_line;
            next_chunk.metadata.end_line = segment.end_line;
            sized_chunks.push(next_chunk);
        }
    }
    sized_chunks
}

/// 긴 text를 line 경계 우선으로 segment화한다.
fn split_text_to_segments(
    text: &str,
    initial_line: usize,
    max_chunk_size: usize,
) -> Vec<TextSegment> {
    let max_size = max_chunk_size.max(1);
    let lines = text.split('\n').collect::<Vec<_>>();
    let mut segments = Vec::new();
    let mut current_lines = Vec::new();
    let mut current_start_line = initial_line;
    let mut current_length = 0_usize;

    for (index, line) in lines.iter().copied().enumerate() {
        let line_number = initial_line.saturating_add(index);
        if text_len(line) > max_size {
            flush_segment(
                &mut segments,
                &mut current_lines,
                current_start_line,
                line_number.saturating_sub(1),
            );
            for piece in split_line_to_pieces(line, max_size) {
                let trimmed = piece.trim().to_owned();
                if trimmed.is_empty() {
                    continue;
                }
                segments.push(TextSegment {
                    text: trimmed,
                    start_line: line_number,
                    end_line: line_number,
                });
            }
            current_start_line = line_number.saturating_add(1);
            current_length = 0;
            continue;
        }

        let line_length = text_len(line);
        let next_length = if current_lines.is_empty() {
            line_length
        } else {
            current_length.saturating_add(1).saturating_add(line_length)
        };
        if !current_lines.is_empty() && next_length > max_size {
            flush_segment(
                &mut segments,
                &mut current_lines,
                current_start_line,
                line_number.saturating_sub(1),
            );
            current_start_line = line_number;
            current_length = 0;
        }

        current_lines.push(line.to_owned());
        current_length = if current_lines.len() == 1 {
            line_length
        } else {
            current_length.saturating_add(1).saturating_add(line_length)
        };
    }

    if !current_lines.is_empty() {
        flush_segment(
            &mut segments,
            &mut current_lines,
            current_start_line,
            initial_line.saturating_add(lines.len()).saturating_sub(1),
        );
    }

    segments
}

/// current segment를 flush한다.
fn flush_segment(
    segments: &mut Vec<TextSegment>,
    current_lines: &mut Vec<String>,
    current_start_line: usize,
    end_line: usize,
) {
    let segment_text = current_lines.join("\n").trim().to_owned();
    if !segment_text.is_empty() {
        segments.push(TextSegment {
            text: segment_text,
            start_line: current_start_line,
            end_line,
        });
    }
    current_lines.clear();
}

/// line을 character count 기준으로 나눈다.
fn split_line_to_pieces(line: &str, max_size: usize) -> Vec<String> {
    let chars = line.chars().collect::<Vec<_>>();
    let mut pieces = Vec::new();
    let mut offset = 0_usize;
    while offset < chars.len() {
        let end = offset.saturating_add(max_size).min(chars.len());
        pieces.push(chars.iter().skip(offset).take(end - offset).collect());
        offset = end;
    }
    pieces
}

/// line overlap을 적용한다.
fn apply_line_overlap(
    chunks: Vec<Chunk>,
    overlap_chars: usize,
    max_chunk_size: usize,
) -> Vec<Chunk> {
    if overlap_chars == 0 || chunks.len() <= 1 {
        return chunks;
    }

    let mut overlapped = Vec::with_capacity(chunks.len());
    for (index, chunk) in chunks.iter().enumerate() {
        if index == 0 {
            overlapped.push(chunk.clone());
            continue;
        }
        let Some(previous) = chunks.get(index.saturating_sub(1)) else {
            overlapped.push(chunk.clone());
            continue;
        };
        let available = max_chunk_size
            .saturating_sub(text_len(&chunk.text))
            .saturating_sub(1);
        let max_overlap_chars = overlap_chars.min(available);
        let overlap_text = get_trailing_overlap(&previous.text, max_overlap_chars);
        if overlap_text.is_empty() {
            overlapped.push(chunk.clone());
            continue;
        }

        let overlap_line_count = overlap_text.split('\n').count();
        let start_line = previous
            .metadata
            .start_line
            .max(chunk.metadata.start_line.saturating_sub(overlap_line_count));
        let mut next_chunk = chunk.clone();
        let overlapped_text = format!("{overlap_text}\n{}", chunk.text);
        next_chunk.text.clear();
        next_chunk.text.push_str(overlapped_text.trim());
        next_chunk.metadata.start_line = start_line;
        overlapped.push(next_chunk);
    }
    overlapped
}

/// 이전 chunk의 trailing overlap text를 구한다.
fn get_trailing_overlap(text: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    if text_len(text) <= max_chars {
        return text.trim().to_owned();
    }

    let tail = text
        .chars()
        .rev()
        .take(max_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    if let Some((before_newline, after_newline)) = tail.split_once('\n')
        && !before_newline.is_empty()
        && !after_newline.is_empty()
    {
        return after_newline.trim().to_owned();
    }
    tail.trim().to_owned()
}

/// 기존 `TypeScript` `.length`와 같은 UTF-16 code unit 기준으로 길이를 계산한다.
fn text_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `usize`를 loss 없는 범위에서 `f64`로 변환한다.
fn usize_to_f64(value: usize) -> Option<f64> {
    u32::try_from(value).ok().map(f64::from)
}

/// chunk 배열을 JSON 문자열로 serialize한다.
fn serialize_chunks_json(chunks: &[Chunk]) -> String {
    let body = chunks
        .iter()
        .map(serialize_chunk_json)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// token frequency payload를 JSON 문자열로 serialize한다.
fn serialize_token_frequencies_json(
    total_tokens: usize,
    frequencies: &BTreeMap<String, usize>,
) -> String {
    let body = frequencies
        .iter()
        .map(|(token, frequency)| format!("\"{}\":{frequency}", escape_json_string(token)))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"totalTokens\":{total_tokens},\"frequencies\":{{{body}}}}}")
}

/// chunk 하나를 JSON 문자열로 serialize한다.
fn serialize_chunk_json(chunk: &Chunk) -> String {
    let heading = chunk
        .metadata
        .heading
        .as_ref()
        .map(|heading| format!(",\"heading\":\"{}\"", escape_json_string(heading)))
        .unwrap_or_default();
    format!(
        "{{\"text\":\"{}\",\"metadata\":{{\"filePath\":\"{}\"{heading},\"startLine\":{},\"endLine\":{}}}}}",
        escape_json_string(&chunk.text),
        escape_json_string(&chunk.metadata.file_path),
        chunk.metadata.start_line,
        chunk.metadata.end_line,
    )
}

/// 문자가 `BM25` 토큰 부분 문자 클래스에 속하는지 반환한다.
fn is_token_part_character(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '/' | '\\' | '@' | '.')
}

/// 하나의 연속 부분을 토큰화하고 지역 중복 토큰을 삽입 순서대로 제거한다.
fn tokenize_part(part: &str) -> Vec<String> {
    let trimmed = part.trim();
    if !trimmed.chars().any(char::is_alphanumeric) {
        return Vec::new();
    }

    let mut tokens = Vec::new();
    let normalized = normalize_token(trimmed);
    push_token(&mut tokens, &normalized);

    if trimmed.is_ascii() {
        tokenize_ascii_part(trimmed, &mut tokens);
    } else {
        tokenize_unicode_part(&normalized, &mut tokens);
    }

    dedupe_in_order(tokens)
}

/// `ASCII` 부분을 압축 토큰, 구분자 토큰, `camel-case` 토큰으로 나눈다.
fn tokenize_ascii_part(part: &str, tokens: &mut Vec<String>) {
    let segments = part
        .split(is_ascii_separator)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    if segments.len() > 1 {
        push_token(tokens, &segments.join("").to_lowercase());
    }

    for segment in segments {
        let camel_parts = split_ascii_identifier(segment);
        if camel_parts.len() > 1 {
            push_token(tokens, &camel_parts.join("").to_lowercase());
        }
        for camel_part in camel_parts {
            push_token(tokens, &camel_part.to_lowercase());
        }
    }
}

/// `BM25` 매칭에서 압축 처리되는 `ASCII` 구분자인지 반환한다.
const fn is_ascii_separator(character: char) -> bool {
    matches!(character, '_' | '-' | '/' | '\\' | '@' | '.')
}

/// `Unicode` 부분을 압축 스크립트 그룹과 짧은 `n-gram`으로 나눈다.
fn tokenize_unicode_part(part: &str, tokens: &mut Vec<String>) {
    let compact = part
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect::<String>();
    push_token(tokens, &compact);

    let mut group = String::new();
    let mut group_kind = None;
    for character in compact.chars() {
        let next_kind = unicode_group_kind(character);
        if group_kind.is_some() && group_kind != Some(next_kind) {
            push_token(tokens, &group.to_lowercase());
            group.clear();
        }
        group_kind = Some(next_kind);
        group.push(character);
    }
    push_token(tokens, &group.to_lowercase());

    let chars = compact.chars().collect::<Vec<_>>();
    for size in [2_usize, 3_usize] {
        for window in chars.windows(size) {
            let token = window.iter().collect::<String>();
            push_token(tokens, &token);
        }
    }
}

/// `TypeScript` 토크나이저의 대체 그룹과 맞추는 `Unicode` 그룹 종류.
#[derive(Clone, Copy, Eq, PartialEq)]
enum UnicodeGroupKind {
    /// 한글 글자와 호환 자모.
    Hangul,
    /// CJK 통합 한자.
    Han,
    /// 히라가나 글자.
    Hiragana,
    /// 가타카나 글자.
    Katakana,
    /// `Unicode` 숫자 문자.
    Number,
    /// `ASCII` 알파벳 문자.
    AsciiAlpha,
    /// 그 밖의 영숫자 문자.
    Other,
}

/// 문자를 토크나이저의 거친 `Unicode` 스크립트 그룹으로 분류한다.
fn unicode_group_kind(character: char) -> UnicodeGroupKind {
    if is_hangul(character) {
        UnicodeGroupKind::Hangul
    } else if is_han(character) {
        UnicodeGroupKind::Han
    } else if is_hiragana(character) {
        UnicodeGroupKind::Hiragana
    } else if is_katakana(character) {
        UnicodeGroupKind::Katakana
    } else if character.is_numeric() {
        UnicodeGroupKind::Number
    } else if character.is_ascii_alphabetic() {
        UnicodeGroupKind::AsciiAlpha
    } else {
        UnicodeGroupKind::Other
    }
}

/// 일반 vault 텍스트에서 쓰이는 한글 스크립트 범위인지 반환한다.
const fn is_hangul(character: char) -> bool {
    matches!(
        character,
        '\u{1100}'..='\u{11FF}'
            | '\u{3130}'..='\u{318F}'
            | '\u{A960}'..='\u{A97F}'
            | '\u{AC00}'..='\u{D7AF}'
            | '\u{D7B0}'..='\u{D7FF}'
    )
}

/// 일반 vault 텍스트에서 쓰이는 한자 스크립트 범위인지 반환한다.
const fn is_han(character: char) -> bool {
    matches!(
        character,
        '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{20000}'..='\u{2A6DF}'
            | '\u{2A700}'..='\u{2B73F}'
            | '\u{2B740}'..='\u{2B81F}'
            | '\u{2B820}'..='\u{2CEAF}'
            | '\u{2CEB0}'..='\u{2EBEF}'
            | '\u{30000}'..='\u{3134F}'
    )
}

/// 히라가나 스크립트 범위인지 반환한다.
const fn is_hiragana(character: char) -> bool {
    matches!(character, '\u{3040}'..='\u{309F}')
}

/// 가타카나 스크립트 범위인지 반환한다.
const fn is_katakana(character: char) -> bool {
    matches!(character, '\u{30A0}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}')
}

/// `TypeScript` 정규식과 같은 `camel-case` 규칙으로 `ASCII` 식별자를 나눈다.
fn split_ascii_identifier(segment: &str) -> Vec<String> {
    let chars = segment.chars().collect::<Vec<_>>();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut previous = None;

    for (index, character) in chars.iter().copied().enumerate() {
        let next = chars.get(index.saturating_add(1)).copied();
        if should_split_ascii_identifier(previous, character, next) && !current.is_empty() {
            parts.push(current);
            current = String::new();
        }
        current.push(character);
        previous = Some(character);
    }

    if !current.is_empty() {
        parts.push(current);
    }

    if parts.is_empty() {
        vec![segment.to_owned()]
    } else {
        parts
    }
}

/// `camel-case` 식별자를 현재 문자 앞에서 나눠야 하는지 반환한다.
fn should_split_ascii_identifier(
    previous: Option<char>,
    current: char,
    next: Option<char>,
) -> bool {
    let Some(previous) = previous else {
        return false;
    };

    if previous.is_ascii_digit() != current.is_ascii_digit() {
        return true;
    }
    if previous.is_ascii_lowercase() && current.is_ascii_uppercase() {
        return true;
    }
    previous.is_ascii_uppercase()
        && current.is_ascii_uppercase()
        && next.is_some_and(|next_character| next_character.is_ascii_lowercase())
}

/// 영숫자가 아닌 가장자리를 제거하고 소문자화해 토큰을 정규화한다.
fn normalize_token(token: &str) -> String {
    token
        .trim()
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase()
}

/// `Unicode` 스칼라 값이 2개 이상인 정규화 토큰만 추가한다.
fn push_token(tokens: &mut Vec<String>, token: &str) {
    let normalized = normalize_token(token);
    if normalized.chars().count() < 2 {
        return;
    }
    tokens.push(normalized);
}

/// 첫 출현 순서를 보존하면서 중복 토큰을 제거한다.
fn dedupe_in_order(tokens: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for token in tokens {
        if !deduped.iter().any(|existing| existing == &token) {
            deduped.push(token);
        }
    }
    deduped
}

/// `JSON` 의존성을 코어에 끌어오지 않고 토큰을 `JSON` 문자열 리터럴용으로 이스케이프한다.
fn escape_json_string(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                let code = u32::from(character);
                push_json_unicode_escape(&mut escaped, code);
            }
            character => escaped.push(character),
        }
    }
    escaped
}

/// 네 자리 `JSON unicode escape`를 추가한다.
fn push_json_unicode_escape(output: &mut String, code: u32) {
    output.push_str("\\u");
    for shift in [12_u32, 8, 4, 0] {
        output.push(hex_digit((code >> shift) & 0x0f));
    }
}

/// 16진수 `nibble`을 소문자 `ASCII` 숫자로 변환한다.
const fn hex_digit(nibble: u32) -> char {
    match nibble {
        0 => '0',
        1 => '1',
        2 => '2',
        3 => '3',
        4 => '4',
        5 => '5',
        6 => '6',
        7 => '7',
        8 => '8',
        9 => '9',
        10 => 'a',
        11 => 'b',
        12 => 'c',
        13 => 'd',
        14 => 'e',
        _ => 'f',
    }
}

#[cfg(test)]
mod tests {
    //! `TypeScript`에서 옮기는 계산 커널의 `Rust` 동등성 테스트.

    use super::{
        BM25_B, BM25_K1, bm25_score_pairs, chunk_markdown, chunk_plain_text, cosine_similarity,
        create_content_hash, rank_top_k_pairs, token_frequencies_json, tokenize,
    };

    /// 콘텐츠 해시는 현재 `TypeScript UTF-16 FNV-1a` 계약을 보존해야 한다.
    #[test]
    fn content_hash_matches_typescript_fnv1a_utf16_units() {
        assert_eq!(
            create_content_hash("hello"),
            "4f9f2cab",
            "ASCII 해시는 TypeScript 구현과 같아야 한다",
        );
        assert_eq!(
            create_content_hash("요고49 포인트 페이백"),
            "d30c670d",
            "한국어 해시는 TypeScript 구현과 같아야 한다",
        );
    }

    /// `ASCII` 토크나이저 동작은 복합어와 `camel-case` 검색 재현율을 보존해야 한다.
    #[test]
    fn tokenizer_preserves_ascii_compounds_and_camel_case_parts() {
        let tokens = tokenize("OpenRouter freeLLMApi open-router");

        for expected in [
            "openrouter",
            "open",
            "router",
            "freellmapi",
            "free",
            "llm",
            "api",
        ] {
            assert!(
                tokens.iter().any(|token| token == expected),
                "missing expected token {expected}; got {tokens:?}",
            );
        }
    }

    /// BM25 term frequency JSON은 Rust tokenizer output의 중복 횟수를 보존해야 한다.
    #[test]
    fn token_frequencies_json_counts_tokenizer_output() {
        assert_eq!(
            token_frequencies_json("OpenRouter OpenRouter freeLLMApi"),
            "{\"totalTokens\":10,\"frequencies\":{\"api\":1,\"free\":1,\"freellmapi\":1,\"llm\":1,\"open\":2,\"openrouter\":2,\"router\":2}}",
            "frequency JSON은 token별 중복 횟수를 보존해야 한다",
        );
    }

    /// `Unicode` 토크나이저 동작은 한국어 숫자 그룹과 짧은 `n-gram`을 보존해야 한다.
    #[test]
    fn tokenizer_preserves_korean_digits_and_unicode_ngrams() {
        let tokens = tokenize("요고49 포인트 페이백");

        for expected in ["요고49", "요고", "49", "포인트", "포인", "인트", "페이백"] {
            assert!(
                tokens.iter().any(|token| token == expected),
                "missing expected token {expected}; got {tokens:?}",
            );
        }
    }

    /// Markdown chunking은 heading과 code block 경계를 유지하고 line metadata를 보존해야 한다.
    #[test]
    fn chunk_markdown_preserves_headings_code_blocks_and_line_metadata() {
        let chunks = chunk_markdown(
            "# First\nalpha\n\nbeta\n# Second\n```\nconst value = 1;\n```",
            100,
            0,
        );

        assert_eq!(chunks.len(), 2, "heading 경계 기준으로 두 chunk가 필요하다");
        let [first, second] = chunks.as_slice() else {
            return;
        };
        assert_eq!(first.text, "# First\nalpha\n\nbeta");
        assert_eq!(first.metadata.heading.as_deref(), Some("First"));
        assert_eq!(first.metadata.start_line, 0);
        assert_eq!(first.metadata.end_line, 3);
        assert_eq!(second.text, "# Second\n```\nconst value = 1;\n```");
        assert_eq!(second.metadata.heading.as_deref(), Some("Second"));
        assert_eq!(second.metadata.start_line, 4);
        assert_eq!(second.metadata.end_line, 7);
    }

    /// 일반 텍스트 chunking은 빈 줄 split과 line metadata를 보존해야 한다.
    #[test]
    fn chunk_plain_text_preserves_blank_line_split_metadata() {
        let chunks = chunk_plain_text("alpha\n\nbeta beta", 12, 0);

        assert_eq!(chunks.len(), 2, "빈 줄 기준으로 두 chunk가 필요하다");
        let [first, second] = chunks.as_slice() else {
            return;
        };
        assert_eq!(first.text, "alpha");
        assert_eq!(first.metadata.heading, None);
        assert_eq!(first.metadata.start_line, 0);
        assert_eq!(first.metadata.end_line, 1);
        assert_eq!(second.text, "beta beta");
        assert_eq!(second.metadata.heading, None);
        assert_eq!(second.metadata.start_line, 2);
        assert_eq!(second.metadata.end_line, 2);
    }

    /// cosine score는 기존 `TypeScript` RAG 경로처럼 차원 불일치와 zero vector를 제외한다.
    #[test]
    fn cosine_similarity_preserves_rag_invalid_vector_contract() {
        assert_some_float_close(
            cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]),
            1.0,
            "동일 방향 vector는 1.0이어야 한다",
        );
        assert_some_float_close(
            cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]),
            0.0,
            "직교 vector는 0.0이어야 한다",
        );
        assert!(
            cosine_similarity(&[1.0], &[1.0, 0.0]).is_none(),
            "차원이 다르면 기존 RAG 경로처럼 제외해야 한다"
        );
        assert!(
            cosine_similarity(&[0.0, 0.0], &[1.0, 0.0]).is_none(),
            "zero vector는 기존 RAG 경로처럼 제외해야 한다"
        );
    }

    /// top-k ranking은 flattened matrix를 받아 원래 row index와 score를 내림차순으로 반환한다.
    #[test]
    fn rank_top_k_pairs_returns_descending_indices_and_scores() {
        let query = [1.0, 0.0];
        let vectors = [
            0.0, 1.0, // index 0, score 0
            1.0, 0.0, // index 1, score 1
            0.6, 0.8, // index 2, score 0.6
            0.0, 0.0, // index 3, ignored
        ];

        let pairs = rank_top_k_pairs(&query, &vectors, 2, 3);

        assert_eq!(
            pairs.len(),
            6,
            "top 3 rows should produce 3 index/score pairs"
        );
        assert_float_close(pair_value(&pairs, 0), 1.0, "best row index should be first");
        assert_float_close(pair_value(&pairs, 1), 1.0, "best score should be preserved");
        assert_float_close(pair_value(&pairs, 2), 2.0, "second row index should follow");
        assert!(
            (pair_value(&pairs, 3) - 0.6).abs() < f64::EPSILON,
            "second score should be preserved; got {pairs:?}",
        );
        assert_float_close(
            pair_value(&pairs, 4),
            0.0,
            "orthogonal row remains valid and should be third",
        );
        assert_float_close(
            pair_value(&pairs, 5),
            0.0,
            "orthogonal score should be zero",
        );
    }

    /// 같은 score는 기존 stable sort 관찰값처럼 원래 row 순서를 보존한다.
    #[test]
    fn rank_top_k_pairs_preserves_original_order_for_ties() {
        let query = [1.0, 0.0];
        let vectors = [
            1.0, 0.0, // index 0, score 1
            2.0, 0.0, // index 1, score 1
            3.0, 0.0, // index 2, score 1
        ];

        let pairs = rank_top_k_pairs(&query, &vectors, 2, 3);

        for (offset, expected) in [0.0_f64, 1.0, 1.0, 1.0, 2.0, 1.0]
            .iter()
            .copied()
            .enumerate()
        {
            assert_float_close(
                pair_value(&pairs, offset),
                expected,
                "tie order pair mismatch",
            );
        }
    }

    /// BM25 score 계산은 기존 TypeScript 공식과 doc index 순서를 보존해야 한다.
    #[test]
    fn bm25_score_pairs_matches_typescript_formula() {
        let term_offsets = [0_u32, 2, 3];
        let doc_indices = [0_u32, 1, 0];
        let term_frequencies = [2.0, 1.0, 1.0];
        let doc_lengths = [3.0, 4.0];

        let pairs = bm25_score_pairs(
            &term_offsets,
            &doc_indices,
            &term_frequencies,
            &doc_lengths,
            2,
            3.5,
        );

        assert_eq!(pairs.len(), 4, "두 doc의 index/score pair가 필요하다");
        assert_float_close(pair_value(&pairs, 0), 0.0, "첫 pair는 doc 0이어야 한다");
        assert_float_close(
            pair_value(&pairs, 2),
            1.0,
            "두 번째 pair는 doc 1이어야 한다",
        );
        assert_float_close(
            pair_value(&pairs, 1),
            bm25_score(2.0, 2.0, 2.0, 3.0, 3.5) + bm25_score(2.0, 1.0, 1.0, 3.0, 3.5),
            "doc 0 score는 두 term 점수를 누적해야 한다",
        );
        assert_float_close(
            pair_value(&pairs, 3),
            bm25_score(2.0, 2.0, 1.0, 4.0, 3.5),
            "doc 1 score는 첫 term 점수만 포함해야 한다",
        );
    }

    /// `Option<f64>` 값이 존재하고 기대값과 같은지 확인한다.
    fn assert_some_float_close(actual: Option<f64>, expected: f64, message: &str) {
        if let Some(value) = actual {
            assert_float_close(value, expected, message);
        } else {
            assert!(actual.is_some(), "{message}; got None");
        }
    }

    /// 부동소수점 값을 strict equality 없이 확인한다.
    fn assert_float_close(actual: f64, expected: f64, message: &str) {
        assert!(
            (actual - expected).abs() <= f64::EPSILON,
            "{message}; expected {expected}, got {actual}",
        );
    }

    /// pair 배열에서 값을 안전하게 읽는다.
    fn pair_value(pairs: &[f64], offset: usize) -> f64 {
        pairs.get(offset).copied().unwrap_or(f64::NAN)
    }

    /// 테스트용 BM25 공식 계산.
    fn bm25_score(total_docs: f64, df: f64, tf: f64, doc_length: f64, avg_doc_length: f64) -> f64 {
        let idf = ((total_docs - df + 0.5) / (df + 0.5)).ln_1p();
        idf * ((tf * (BM25_K1 + 1.0))
            / BM25_K1.mul_add(
                BM25_B.mul_add(doc_length / avg_doc_length, 1.0 - BM25_B),
                tf,
            ))
    }
}
