//! `RAG` 인덱싱과 검색을 위한 `Rust WebAssembly` 코어.
//!
//! `JavaScript`는 `Obsidian UI`와 호스트 `I/O`만 담당한다. 이 크레이트는
//! `WebAssembly`에서 실행 가능한 이식성 있는 결정적 계산 커널을 담당한다.

#![forbid(unsafe_code)]

use regex::Regex;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use std::collections::{BTreeMap, BTreeSet, HashSet, btree_map::Entry};
use std::sync::atomic::{AtomicU32, Ordering};
use wasm_bindgen::prelude::wasm_bindgen;

/// 기존 `TypeScript` 해시가 쓰는 `FNV-1a` 32비트 오프셋 기준값.
const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
/// 기존 `TypeScript` 해시가 쓰는 `FNV-1a` 32비트 소수.
const FNV_PRIME: u32 = 0x0100_0193;
/// 기존 `TypeScript BM25` 검색 경로의 `k1` 상수.
const BM25_K1: f64 = 1.2;
/// 기존 `TypeScript BM25` 검색 경로의 `b` 상수.
const BM25_B: f64 = 0.75;
/// compact BM25 저장 포맷 schema version.
const BM25_COMPACT_SCHEMA_VERSION: u32 = 3;
/// 기존 `TypeScript RRF` 계산의 rank smoothing 상수.
const RRF_K: f64 = 60.0;
/// 기존 hybrid score의 base vector/BM25 component weight.
const VECTOR_SCORE_WEIGHT: f64 = 0.35;
/// 기존 hybrid score의 reciprocal rank fusion component weight.
const RRF_SCORE_WEIGHT: f64 = 0.55;
/// 기존 hybrid score의 source prior component weight.
const SOURCE_PRIOR_WEIGHT: f64 = 0.1;
/// 강한 graph/evidence 후보의 score floor.
const STRONG_EVIDENCE_SCORE_FLOOR: f64 = 0.58;
/// 강한 graph/evidence 후보의 score cap.
const STRONG_EVIDENCE_SCORE_CAP: f64 = 0.88;
/// 프롬프트 라이브러리 상위 폴더 표시 개수.
const PROMPT_LIBRARY_TOP_FOLDER_LIMIT: usize = 12;
/// 프롬프트 라이브러리 상위 파일 표시 개수.
const PROMPT_LIBRARY_TOP_FILE_LIMIT: usize = 16;
/// 프롬프트 라이브러리 상위 헤딩 표시 개수.
const PROMPT_LIBRARY_TOP_HEADING_LIMIT: usize = 18;
/// BM25 retrieval source.
const SOURCE_BM25: u8 = 1;
/// vector/ANN retrieval source.
const SOURCE_VECTOR: u8 = 2;
/// graph-local retrieval source.
const SOURCE_GRAPH_EVIDENCE: u8 = 3;
/// structural retrieval source.
const SOURCE_STRUCTURAL: u8 = 4;
/// ANN retrieval source. RRF에서는 vector와 같은 weight를 쓰지만 source prior에서는 별도 보정한다.
const SOURCE_ANN: u8 = 5;
/// graph-global retrieval source.
const SOURCE_GRAPH_GLOBAL: u8 = 6;
/// evidence retrieval source.
const SOURCE_EVIDENCE: u8 = 7;
/// 프롬프트 라이브러리 샘플 preview 최대 길이.
const PROMPT_LIBRARY_SAMPLE_PREVIEW_MAX_CHARS: usize = 320;
/// 프롬프트 라이브러리 샘플 최대 개수.
const PROMPT_LIBRARY_SAMPLE_LIMIT: usize = 24;
/// 마크다운 문서 확장자로 제외/차단을 금지할 대상 목록.
const PROTECTED_RAG_DOCUMENT_EXTENSIONS: [&str; 2] = ["md", "markdown"];
/// LLM reranker system prompt.
const RERANK_SYSTEM_CONTENT: &str = "You rerank retrieval candidates for an Obsidian RAG answer. Return JSON only: {\"rankedIds\":[\"candidate-id\"]}. Rank candidates by direct usefulness as answer evidence. Do not invent ids.";
/// RAG relevance window 후보 row의 numeric column 수.
const RELEVANT_RESULT_VALUE_WIDTH: usize = 6;
/// RAG relevance window 후보 row의 combined score column.
const RELEVANT_RESULT_SCORE_COLUMN: usize = 0;
/// RAG relevance window 후보 row의 vector score column.
const RELEVANT_RESULT_VECTOR_COLUMN: usize = 1;
/// RAG relevance window 후보 row의 BM25 score column.
const RELEVANT_RESULT_BM25_COLUMN: usize = 2;
/// RAG relevance window 후보 row의 keyword match count column.
const RELEVANT_RESULT_KEYWORD_COLUMN: usize = 3;
/// RAG relevance window 후보 row의 graph/structural evidence score column.
const RELEVANT_RESULT_EVIDENCE_SCORE_COLUMN: usize = 4;
/// RAG relevance window 후보 row의 graph/structural best evidence rank column.
const RELEVANT_RESULT_EVIDENCE_RANK_COLUMN: usize = 5;
/// 기존 `TypeScript` MMR selection의 relevance 가중치.
const MMR_RELEVANCE_WEIGHT: f64 = 0.72;
/// 같은 파일 후보를 연속 선택하지 않기 위한 penalty.
const SAME_FILE_DIVERSITY_PENALTY: f64 = 0.12;
/// 같은 heading 후보를 연속 선택하지 않기 위한 추가 penalty.
const SAME_HEADING_DIVERSITY_PENALTY: f64 = 0.06;
/// `TypeScript`에서 알 수 없는 graph reference index를 표현하는 sentinel.
const GRAPH_PRUNE_UNKNOWN_INDEX: u32 = u32::MAX;
/// `GraphRAG` entity mention matching에서 단어 뒤에 붙을 수 있는 한국어 조사.
const KOREAN_PARTICLES: &[&str] = &[
    "은", "는", "이", "가", "을", "를", "과", "와", "의", "에", "에서", "로", "으로", "에게", "께",
    "도", "만", "부터", "까지",
];
/// Ontology relation domain/range wildcard type id.
const ONTOLOGY_ANY_ENTITY_TYPE: &str = "any";
/// Graph extraction parser/normalizer wire contract version.
const GRAPH_EXTRACTION_CONTRACT_VERSION: u32 = 1;
/// `wasm-bindgen` runtime getter가 읽는 extraction contract version.
static GRAPH_EXTRACTION_CONTRACT_VERSION_EXPORT: AtomicU32 =
    AtomicU32::new(GRAPH_EXTRACTION_CONTRACT_VERSION);
/// Graph extraction entity name 후보 key 목록.
const GRAPH_ENTITY_NAME_KEYS: &[&str] = &["name", "canonicalName", "label", "id"];
/// Graph extraction entity type 후보 key 목록.
const GRAPH_ENTITY_TYPE_KEYS: &[&str] =
    &["typeId", "type_id", "entityTypeId", "entity_type", "type"];
/// Graph extraction relation source 후보 key 목록.
const GRAPH_RELATION_SOURCE_KEYS: &[&str] = &["source", "from", "subject"];
/// Graph extraction relation target 후보 key 목록.
const GRAPH_RELATION_TARGET_KEYS: &[&str] = &["target", "to", "object"];
/// Graph extraction relation type 후보 key 목록.
const GRAPH_RELATION_TYPE_KEYS: &[&str] = &[
    "relationTypeId",
    "relation_type_id",
    "relationType",
    "relation_type",
    "typeId",
    "type",
    "relation",
];
/// Graph extraction claim text 후보 key 목록.
const GRAPH_CLAIM_TEXT_KEYS: &[&str] = &["text", "claim", "statement"];
/// Graph extraction claim type 후보 key 목록.
const GRAPH_CLAIM_TYPE_KEYS: &[&str] = &[
    "claimTypeId",
    "claim_type_id",
    "claimType",
    "claim_type",
    "typeId",
    "type",
];
/// Graph extraction description 후보 key 목록.
const GRAPH_DESCRIPTION_KEYS: &[&str] = &["description", "desc"];
/// Graph extraction alias 후보 key 목록.
const GRAPH_ALIAS_KEYS: &[&str] = &["aliases", "alias"];
/// Graph extraction confidence 후보 key 목록.
const GRAPH_CONFIDENCE_KEYS: &[&str] = &["confidence", "score"];
/// Graph extraction claim direct entity list 후보 key 목록.
const GRAPH_CLAIM_ENTITY_LIST_KEYS: &[&str] = &["entityNames", "entity_names", "entities"];
/// Graph extraction claim single entity 후보 key 목록.
const GRAPH_CLAIM_SINGLE_ENTITY_KEYS: &[&str] =
    &["entity", "subject", "source", "object", "target"];

/// 작은 token part에서는 `HashSet` 준비 비용보다 선형 스캔이 싸다.
const DEDUPE_LINEAR_SCAN_LIMIT: usize = 32;

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
    let (total_tokens, frequencies) = accumulate_token_frequencies(tokenize(text));
    serialize_token_frequencies_json(total_tokens, &frequencies)
}

/// BM25 index에 문서 하나를 추가/교체한 새 index JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_index_add_document_json(
    index_json: &str,
    doc_id: &str,
    text: &str,
    source_path: &str,
    tokenizer_version: u32,
) -> String {
    let Some(mut index) = parse_bm25_index_json(index_json) else {
        return String::new();
    };
    index.tokenizer_version = tokenizer_version;
    add_bm25_document(&mut index, doc_id, text, source_path);

    serialize_bm25_index_json(&index)
}

/// BM25 index에서 문서 하나를 제거한 새 index JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_index_remove_document_json(
    index_json: &str,
    doc_id: &str,
    tokenizer_version: u32,
) -> String {
    let Some(mut index) = parse_bm25_index_json(index_json) else {
        return String::new();
    };
    index.tokenizer_version = tokenizer_version;
    remove_bm25_document(&mut index, doc_id);
    serialize_bm25_index_json(&index)
}

/// BM25 index에서 source path에 속한 문서를 제거한 새 index JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_index_remove_source_json(
    index_json: &str,
    source_path: &str,
    tokenizer_version: u32,
) -> String {
    let Some(mut index) = parse_bm25_index_json(index_json) else {
        return String::new();
    };
    index.tokenizer_version = tokenizer_version;
    let doc_ids = index
        .doc_sources
        .iter()
        .filter_map(|(doc_id, source)| (source == source_path).then_some(doc_id.clone()))
        .collect::<Vec<_>>();
    for doc_id in doc_ids {
        remove_bm25_document(&mut index, &doc_id);
    }
    serialize_bm25_index_json(&index)
}

/// BM25 index와 raw query에서 doc score JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_search_json(index_json: &str, query: &str) -> String {
    let Some(index) = parse_bm25_index_json(index_json) else {
        return String::new();
    };
    serialize_bm25_search_scores_json(&search_bm25_index(&index, query))
}

/// query token 목록과 텍스트에서 substring 매칭 수를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn count_keyword_matches(query_tokens: &str, text: &str) -> u32 {
    if query_tokens.is_empty() || text.is_empty() {
        return 0;
    }

    let haystack = text.to_lowercase();
    let matches = query_tokens
        .split('\u{1f}')
        .filter(|token| haystack.contains(&token.to_lowercase()))
        .count();
    u32::try_from(matches).unwrap_or(u32::MAX)
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

/// f32 vector를 normalized row로 복사한다.
fn normalized_f32_row(values: &[f32]) -> Option<Vec<f32>> {
    if values.is_empty() {
        return None;
    }
    let norm = f32_row_norm(values)?;
    let mut output = Vec::with_capacity(values.len());
    for value in values {
        output.push(*value / norm);
    }
    Some(output)
}

/// f32 row를 output에 normalized 형태로 추가하고 validity를 반환한다.
fn push_normalized_f32_row(values: &[f32], output: &mut Vec<f32>) -> bool {
    let Some(norm) = f32_row_norm(values) else {
        output.resize(output.len().saturating_add(values.len()), 0.0);
        return false;
    };
    for value in values {
        output.push(*value / norm);
    }
    true
}

/// f32 vector norm을 계산한다.
fn f32_row_norm(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let mut norm_sq = 0.0_f32;
    for value in values {
        if !value.is_finite() {
            return None;
        }
        norm_sq = value.mul_add(*value, norm_sq);
    }
    if norm_sq <= 0.0 || !norm_sq.is_finite() {
        return None;
    }
    Some(norm_sq.sqrt())
}

/// normalized f32 row끼리 dot product를 계산한다.
fn normalized_f32_dot(left: &[f32], right: &[f32]) -> f64 {
    let mut dot = 0.0_f32;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot = left_value.mul_add(*right_value, dot);
    }
    f64::from(dot)
}

/// wasm-bindgen export getter를 non-const 함수로 유지하기 위한 runtime usize passthrough.
fn wasm_bridge_usize(value: usize) -> usize {
    value.to_string().parse::<usize>().unwrap_or(value)
}

/// wasm-bindgen export getter를 non-const 함수로 유지하기 위한 runtime u32 passthrough.
fn wasm_bridge_u32(value: u32) -> u32 {
    value.to_string().parse::<u32>().unwrap_or(value)
}

/// wasm-bindgen export getter를 non-const 함수로 유지하기 위한 runtime bool passthrough.
fn wasm_bridge_bool(value: bool) -> bool {
    value.to_string().parse::<bool>().unwrap_or(value)
}

/// normalized f32 matrix에서 균등 간격으로 초기 centroid를 고른다.
fn select_initial_f32_centroids(
    normalized_vectors: &[f32],
    dimensions: usize,
    row_count: usize,
    cluster_count: usize,
) -> Vec<f32> {
    let mut centroids = Vec::with_capacity(cluster_count.saturating_mul(dimensions));
    if row_count == 0 || cluster_count == 0 {
        return centroids;
    }
    if cluster_count == 1 {
        if let Some(first_vector) = normalized_vectors.get(0..dimensions) {
            centroids.extend_from_slice(first_vector);
        }
        return centroids;
    }

    for index in 0..cluster_count {
        let row_index = index
            .saturating_mul(row_count.saturating_sub(1))
            .checked_div(cluster_count.saturating_sub(1))
            .unwrap_or_default();
        let offset = row_index.saturating_mul(dimensions);
        if let Some(vector) = normalized_vectors.get(offset..offset.saturating_add(dimensions)) {
            centroids.extend_from_slice(vector);
        }
    }
    centroids
}

/// normalized f32 row들을 가장 가까운 centroid에 배정한다.
fn assign_f32_vectors_to_centroids(
    normalized_vectors: &[f32],
    valid_rows: &[bool],
    centroids: &[f32],
    dimensions: usize,
) -> Vec<usize> {
    let row_count = normalized_vectors
        .len()
        .checked_div(dimensions)
        .unwrap_or_default();
    let cluster_count = centroids.len().checked_div(dimensions).unwrap_or_default();
    let mut assignments = Vec::with_capacity(row_count);

    for row_index in 0..row_count {
        if !valid_rows.get(row_index).copied().unwrap_or(false) {
            assignments.push(0);
            continue;
        }
        let offset = row_index.saturating_mul(dimensions);
        let Some(vector) = normalized_vectors.get(offset..offset.saturating_add(dimensions)) else {
            assignments.push(0);
            continue;
        };
        assignments.push(assign_f32_vector_to_centroid(
            vector,
            centroids,
            dimensions,
            cluster_count,
        ));
    }

    assignments
}

/// 단일 normalized f32 row의 nearest centroid index를 계산한다.
fn assign_f32_vector_to_centroid(
    vector: &[f32],
    centroids: &[f32],
    dimensions: usize,
    cluster_count: usize,
) -> usize {
    let mut best_index = 0_usize;
    let mut best_score = f64::NEG_INFINITY;
    for centroid_index in 0..cluster_count {
        let offset = centroid_index.saturating_mul(dimensions);
        let Some(centroid) = centroids.get(offset..offset.saturating_add(dimensions)) else {
            continue;
        };
        let score = normalized_f32_dot(vector, centroid);
        if score > best_score {
            best_index = centroid_index;
            best_score = score;
        }
    }
    best_index
}

/// assignment 기반으로 normalized f32 centroid를 다시 계산한다.
fn recompute_f32_centroids(
    normalized_vectors: &[f32],
    valid_rows: &[bool],
    assignments: &[usize],
    previous_centroids: &[f32],
    dimensions: usize,
) -> Vec<f32> {
    let cluster_count = previous_centroids
        .len()
        .checked_div(dimensions)
        .unwrap_or_default();
    let mut sums = vec![0.0_f32; previous_centroids.len()];
    let mut counts = vec![0_usize; cluster_count];

    for (row_index, assignment) in assignments.iter().copied().enumerate() {
        if assignment >= cluster_count || !valid_rows.get(row_index).copied().unwrap_or(false) {
            continue;
        }
        let input_offset = row_index.saturating_mul(dimensions);
        let output_offset = assignment.saturating_mul(dimensions);
        let Some(input) =
            normalized_vectors.get(input_offset..input_offset.saturating_add(dimensions))
        else {
            continue;
        };
        let Some(output) = sums.get_mut(output_offset..output_offset.saturating_add(dimensions))
        else {
            continue;
        };
        for (sum, value) in output.iter_mut().zip(input.iter().copied()) {
            *sum += value;
        }
        if let Some(count) = counts.get_mut(assignment) {
            *count = count.saturating_add(1);
        }
    }

    let mut centroids = Vec::with_capacity(previous_centroids.len());
    for cluster_index in 0..cluster_count {
        let offset = cluster_index.saturating_mul(dimensions);
        let Some(previous) = previous_centroids.get(offset..offset.saturating_add(dimensions))
        else {
            continue;
        };
        let count = counts.get(cluster_index).copied().unwrap_or_default();
        if count == 0 {
            centroids.extend_from_slice(previous);
            continue;
        }
        let Some(sum) = sums.get(offset..offset.saturating_add(dimensions)) else {
            centroids.extend_from_slice(previous);
            continue;
        };
        if !push_normalized_f32_row(sum, &mut centroids) {
            centroids.extend_from_slice(previous);
        }
    }
    centroids
}

/// assignment를 cluster별 row index 목록으로 변환한다.
fn build_f32_clusters(assignments: &[usize], cluster_count: usize) -> Vec<Vec<usize>> {
    let mut clusters = vec![Vec::<usize>::new(); cluster_count];
    for (row_index, cluster_index) in assignments.iter().copied().enumerate() {
        if let Some(cluster) = clusters.get_mut(cluster_index) {
            cluster.push(row_index);
        }
    }
    clusters
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

    let mut scored = Vec::with_capacity(top_k);
    for (row_index, vector) in vectors.chunks_exact(dimensions).enumerate() {
        let Some(score) = cosine_similarity(query, vector) else {
            continue;
        };
        push_top_k_scored_row(&mut scored, ScoredRow { row_index, score }, top_k);
    }

    let mut pairs = Vec::with_capacity(scored.len() * 2);
    for scored_row in scored {
        if let Ok(index) = u32::try_from(scored_row.row_index) {
            pairs.push(f64::from(index));
            pairs.push(scored_row.score);
        }
    }
    pairs.into_boxed_slice()
}

/// exact top-k와 approximate top-k index 목록으로 recall@k를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn recall_at_k(exact_indices: &[u32], approximate_indices: &[u32], top_k: usize) -> f64 {
    if top_k == 0 {
        return 0.0;
    }
    let exact_top_k = exact_indices
        .iter()
        .copied()
        .take(top_k)
        .collect::<BTreeSet<_>>();
    if exact_top_k.is_empty() {
        return 0.0;
    }
    let hits = approximate_indices
        .iter()
        .copied()
        .take(top_k)
        .filter(|index| exact_top_k.contains(index))
        .count();
    let Some(hits) = usize_to_f64(hits) else {
        return f64::NAN;
    };
    let Some(total) = usize_to_f64(exact_top_k.len()) else {
        return f64::NAN;
    };
    hits / total
}

/// flattened vector matrix의 각 row를 가장 가까운 centroid index로 배정한다.
#[must_use]
#[wasm_bindgen]
pub fn assign_vector_clusters(vectors: &[f64], centroids: &[f64], dimensions: usize) -> Box<[f64]> {
    if dimensions == 0
        || centroids.is_empty()
        || !vectors.len().is_multiple_of(dimensions)
        || !centroids.len().is_multiple_of(dimensions)
    {
        return Box::default();
    }

    collect_indices_as_f64(assign_vectors_to_centroids(vectors, centroids, dimensions))
}

/// flattened vector matrix와 cluster assignment로 centroid matrix를 다시 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn recompute_centroids(
    vectors: &[f64],
    assignments: &[u32],
    previous_centroids: &[f64],
    dimensions: usize,
) -> Box<[f64]> {
    let Some(vector_count) = vectors.len().checked_div(dimensions) else {
        return Box::default();
    };
    if dimensions == 0
        || !vectors.len().is_multiple_of(dimensions)
        || !previous_centroids.len().is_multiple_of(dimensions)
        || vector_count != assignments.len()
    {
        return Box::default();
    }

    recompute_centroids_from_assignments(vectors, assignments, previous_centroids, dimensions)
        .into_boxed_slice()
}

/// flattened vector matrix에서 `IVF ANN` 초기 centroid matrix를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn build_initial_centroids(
    vectors: &[f64],
    dimensions: usize,
    requested_cluster_count: usize,
) -> Box<[f64]> {
    if dimensions == 0 || vectors.is_empty() || !vectors.len().is_multiple_of(dimensions) {
        return Box::default();
    }
    let vector_count = vectors.len().checked_div(dimensions).unwrap_or_default();
    let cluster_count = resolve_cluster_count(vector_count, requested_cluster_count);
    if cluster_count == 0 {
        return Box::default();
    }
    select_initial_centroids(vectors, dimensions, cluster_count).into_boxed_slice()
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

/// retrieval source rank map에서 RRF score를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn rrf_score_or_nan(source_codes: &[u8], ranks: &[f64], bm25_weight: f64) -> f64 {
    if source_codes.len() != ranks.len() || !bm25_weight.is_finite() {
        return f64::NAN;
    }

    let mut weighted_score = 0.0_f64;
    let mut total_weight = 0.0_f64;

    for (source_code, rank) in source_codes.iter().copied().zip(ranks.iter().copied()) {
        if !rank.is_finite() || rank < 1.0 {
            continue;
        }
        let weight = rrf_source_weight(source_code, bm25_weight);
        weighted_score = weight.mul_add(1.0 / (RRF_K + rank), weighted_score);
        total_weight = weight.mul_add(1.0 / (RRF_K + 1.0), total_weight);
    }

    if total_weight == 0.0 {
        return 0.0;
    }
    weighted_score / total_weight
}

/// RAG hybrid score를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn hybrid_score_or_nan(
    combined_base: f64,
    rrf_score: f64,
    source_prior: f64,
    source_evidence_score: f64,
    best_evidence_rank: f64,
    source_codes: &[u8],
) -> f64 {
    if !combined_base.is_finite()
        || !rrf_score.is_finite()
        || !source_prior.is_finite()
        || !source_evidence_score.is_finite()
    {
        return f64::NAN;
    }

    let base_score = VECTOR_SCORE_WEIGHT.mul_add(
        combined_base,
        RRF_SCORE_WEIGHT.mul_add(rrf_score, SOURCE_PRIOR_WEIGHT * source_prior),
    );
    if !has_graph_evidence_source(source_codes) {
        return base_score;
    }
    if !is_strong_evidence_score(source_evidence_score, best_evidence_rank) {
        return base_score;
    }

    let evidence_score = source_evidence_score.clamp(0.0, 1.0);
    let evidence_aware_score =
        STRONG_EVIDENCE_SCORE_FLOOR + evidence_score.mul_add(0.25, rrf_score * 0.08);
    base_score.max(evidence_aware_score.min(STRONG_EVIDENCE_SCORE_CAP))
}

/// retrieval source score/rank를 source-aware RAG relevance 계산 입력으로 요약한다.
#[must_use]
#[wasm_bindgen]
pub fn analyze_retrieval_sources(
    source_codes: &[u8],
    source_scores: &[f64],
    source_ranks: &[f64],
) -> Box<[f64]> {
    if source_codes.len() != source_scores.len() || source_codes.len() != source_ranks.len() {
        return Box::default();
    }

    let source_prior = calculate_source_prior(source_codes, source_scores);
    let source_evidence_score = max_graph_or_structural_score(source_codes, source_scores);
    let best_evidence_rank = best_graph_or_structural_rank(source_codes, source_ranks);
    let has_graph_or_structural = has_graph_or_structural_source(source_codes);
    let has_strong_graph_or_structural = has_graph_or_structural
        && is_strong_evidence_score(source_evidence_score, best_evidence_rank);

    [
        source_prior,
        source_evidence_score,
        best_evidence_rank,
        bool_to_f64(has_graph_or_structural),
        bool_to_f64(has_strong_graph_or_structural),
    ]
    .into()
}

/// RAG query result score row를 `JSON` plan으로 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_query_result_score_json(input_json: &str) -> String {
    let Some(input) = parse_query_result_score_input_json(input_json) else {
        return String::new();
    };
    let plan = plan_query_result_score(&input);
    serialize_query_result_score_plan_json(&plan)
}

/// RAG 후보가 최종 context 후보로 유지될 만큼 관련 있는지 판단한다.
#[must_use]
#[wasm_bindgen]
pub fn is_relevant_result(config: &[f64], source_codes: &[u8]) -> bool {
    let [
        combined_score,
        vector_score,
        bm25_score,
        keyword_matches,
        threshold,
        has_bm25,
        source_evidence_score,
        best_evidence_rank,
    ] = config
    else {
        return false;
    };
    let combined_score = *combined_score;
    let vector_score = *vector_score;
    let bm25_score = *bm25_score;
    let keyword_matches = *keyword_matches;
    let threshold = *threshold;
    let has_bm25 = *has_bm25 >= 1.0;
    let source_evidence_score = *source_evidence_score;
    let best_evidence_rank = *best_evidence_rank;

    if !combined_score.is_finite() || !vector_score.is_finite() || !threshold.is_finite() {
        return false;
    }
    if has_strong_graph_or_structural_source(
        source_codes,
        source_evidence_score,
        best_evidence_rank,
    ) {
        return true;
    }
    if combined_score < threshold {
        return false;
    }
    if has_graph_or_structural_source(source_codes) {
        return true;
    }
    if !has_bm25 {
        return vector_score >= 0.62_f64.max(threshold);
    }
    if bm25_score > 0.0 && keyword_matches >= 1.0 {
        return true;
    }
    vector_score >= 0.62_f64.max(threshold + 0.08)
}

/// RAG 후보 score 목록에서 최종 relevance gate를 통과한 원본 result index를 score 내림차순으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn select_relevant_result_indices(
    config: &[f64],
    source_offsets: &[u32],
    source_codes: &[u8],
    result_values: &[f64],
) -> Box<[f64]> {
    let [threshold, has_bm25] = config else {
        return Box::default();
    };
    if !result_values
        .len()
        .is_multiple_of(RELEVANT_RESULT_VALUE_WIDTH)
    {
        return Box::default();
    }
    let result_count = result_values
        .len()
        .checked_div(RELEVANT_RESULT_VALUE_WIDTH)
        .unwrap_or_default();
    if source_offsets.len() != result_count.saturating_add(1) || !threshold.is_finite() {
        return Box::default();
    }

    let mut sorted = Vec::new();
    for row_index in 0..result_count {
        let Some(score) =
            relevant_result_value(result_values, row_index, RELEVANT_RESULT_SCORE_COLUMN)
        else {
            return Box::default();
        };
        if score.is_finite() {
            sorted.push(ScoredRow { row_index, score });
        }
    }
    if sorted.is_empty() {
        return Box::default();
    }
    sorted.sort_by(compare_scored_rows_descending);
    let best_score = sorted.first().map_or(0.0, |row| row.score);
    let relative_threshold = threshold.max(best_score - 0.18);
    let has_bm25 = *has_bm25 >= 1.0;

    let mut selected = Vec::new();
    for row in sorted {
        let Some(result_source_codes) =
            source_codes_for_result(source_offsets, source_codes, row.row_index)
        else {
            return Box::default();
        };
        let source_aware_threshold = if has_graph_or_structural_source(result_source_codes) {
            threshold.max(best_score - 0.45)
        } else {
            relative_threshold
        };
        let Some(vector_score) =
            relevant_result_value(result_values, row.row_index, RELEVANT_RESULT_VECTOR_COLUMN)
        else {
            return Box::default();
        };
        let Some(bm25_score) =
            relevant_result_value(result_values, row.row_index, RELEVANT_RESULT_BM25_COLUMN)
        else {
            return Box::default();
        };
        let Some(keyword_match_count) =
            relevant_result_value(result_values, row.row_index, RELEVANT_RESULT_KEYWORD_COLUMN)
        else {
            return Box::default();
        };
        let Some(evidence_score) = relevant_result_value(
            result_values,
            row.row_index,
            RELEVANT_RESULT_EVIDENCE_SCORE_COLUMN,
        ) else {
            return Box::default();
        };
        let Some(evidence_rank) = relevant_result_value(
            result_values,
            row.row_index,
            RELEVANT_RESULT_EVIDENCE_RANK_COLUMN,
        ) else {
            return Box::default();
        };
        if is_relevant_result(
            &[
                row.score,
                vector_score,
                bm25_score,
                keyword_match_count,
                source_aware_threshold,
                bool_to_f64(has_bm25),
                evidence_score,
                evidence_rank,
            ],
            result_source_codes,
        ) {
            selected.push(row.row_index);
        }
    }

    collect_indices_as_f64(selected)
}

/// retrieval provider 후보를 entry별로 병합할 numeric plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_merged_retrieval_candidates(
    entry_indices: &[u32],
    source_codes: &[u8],
    source_scores: &[f64],
    source_ranks: &[f64],
) -> Box<[f64]> {
    let candidate_count = entry_indices.len();
    if source_codes.len() != candidate_count
        || source_scores.len() != candidate_count
        || source_ranks.len() != candidate_count
    {
        return Box::default();
    }

    let mut group_index_by_entry = BTreeMap::new();
    let mut groups: Vec<RetrievalMergeGroup> = Vec::new();
    for candidate_index in 0..candidate_count {
        let Some(source_code) = source_codes.get(candidate_index).copied() else {
            return Box::default();
        };
        if !is_retrieval_source_code(source_code) {
            return Box::default();
        }
        let Some(entry_index) = entry_indices.get(candidate_index).copied() else {
            return Box::default();
        };
        let Some(source_score) = source_scores.get(candidate_index).copied() else {
            return Box::default();
        };
        let Some(rank) = source_ranks.get(candidate_index).copied() else {
            return Box::default();
        };
        let group_index = match group_index_by_entry.entry(entry_index) {
            Entry::Occupied(entry) => *entry.get(),
            Entry::Vacant(entry) => {
                let next_index = groups.len();
                entry.insert(next_index);
                groups.push(RetrievalMergeGroup {
                    entry_index,
                    first_candidate_index: candidate_index,
                    candidate_indexes: Vec::new(),
                    sources: Vec::new(),
                });
                next_index
            }
        };
        let Some(group) = groups.get_mut(group_index) else {
            return Box::default();
        };
        group.candidate_indexes.push(candidate_index);
        merge_retrieval_source(&mut group.sources, source_code, source_score, rank);
    }

    encode_retrieval_merge_groups(&groups).into_boxed_slice()
}

/// retrieval provider 후보를 `entry id`별로 병합할 numeric plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_merged_retrieval_candidates_by_entry_id(
    entry_ids_json: &str,
    source_codes: &[u8],
    source_scores: &[f64],
    source_ranks: &[f64],
) -> Box<[f64]> {
    let Some(entry_ids) = parse_raw_string_array_json(entry_ids_json) else {
        return Box::default();
    };
    if source_codes.len() != entry_ids.len()
        || source_scores.len() != entry_ids.len()
        || source_ranks.len() != entry_ids.len()
    {
        return Box::default();
    }
    let Some(entry_indices) = map_entry_ids_to_indices(&entry_ids) else {
        return Box::default();
    };

    plan_merged_retrieval_candidates(&entry_indices, source_codes, source_scores, source_ranks)
}

/// 벡터 entry snapshot 배열 fingerprint를 생성한다.
#[must_use]
#[wasm_bindgen]
pub fn create_entries_fingerprint(
    entry_ids_json: &str,
    content_hashes_json: &str,
    indexed_ats_json: &str,
    vector_lengths_json: &str,
) -> String {
    let Some(entry_ids) = parse_raw_string_array_json(entry_ids_json) else {
        return String::new();
    };
    let Some(content_hashes) = parse_raw_string_array_json(content_hashes_json) else {
        return String::new();
    };
    let Some(indexed_ats) = parse_non_negative_u64_array_json(indexed_ats_json) else {
        return String::new();
    };
    let Some(vector_lengths) = parse_usize_array_json(vector_lengths_json) else {
        return String::new();
    };
    if entry_ids.len() != content_hashes.len()
        || entry_ids.len() != indexed_ats.len()
        || entry_ids.len() != vector_lengths.len()
    {
        return String::new();
    }

    let mut fingerprint = String::new();
    for (index, ((entry_id, content_hash), (indexed_at, vector_length))) in entry_ids
        .iter()
        .zip(content_hashes.iter())
        .zip(indexed_ats.iter().zip(vector_lengths.iter()))
        .enumerate()
    {
        if index > 0 {
            fingerprint.push('|');
        }
        fingerprint.push_str(entry_id);
        fingerprint.push(':');
        fingerprint.push_str(content_hash);
        fingerprint.push(':');
        fingerprint.push_str(&indexed_at.to_string());
        fingerprint.push(':');
        fingerprint.push_str(&vector_length.to_string());
    }
    fingerprint
}

/// 후보 reason 목록을 인덱스 순서로 중복 제거해 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn collect_candidate_reasons(
    candidate_reasons_json: &str,
    candidate_indexes_json: &str,
) -> String {
    let Some(candidate_reasons) = parse_raw_string_array_json(candidate_reasons_json) else {
        return String::new();
    };
    let Some(candidate_indexes) = parse_usize_array_json(candidate_indexes_json) else {
        return String::new();
    };

    let mut seen = BTreeSet::new();
    let mut output = Vec::new();
    for candidate_index in candidate_indexes {
        let Some(reason) = candidate_reasons.get(candidate_index) else {
            continue;
        };
        if reason.is_empty() || !seen.insert(reason.clone()) {
            continue;
        }
        output.push(reason.clone());
    }
    serialize_string_array_json(&output)
}

/// BM25 score hit 목록을 score 순서로 제한하고 lookup plan을 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_hit_lookup_json(
    hits_json: &str,
    candidate_limit: usize,
    lookup_multiplier: usize,
) -> String {
    let Some(mut hits) = parse_bm25_hits_json(hits_json) else {
        return String::new();
    };
    hits.retain(|hit| !hit.doc_id.is_empty() && hit.score.is_finite() && hit.score > 0.0);
    if hits.is_empty() || candidate_limit == 0 {
        return String::new();
    }

    hits.sort_by(compare_bm25_hits_descending);
    let lookup_limit = candidate_limit
        .saturating_mul(lookup_multiplier.max(1))
        .max(candidate_limit)
        .min(hits.len());
    hits.truncate(lookup_limit);
    serialize_bm25_hit_lookup_plan_json(&hits)
}

/// BM25 hit 중 id lookup에서 발견되지 않은 source file path 목록을 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_source_lookups_json(hits_json: &str, found_entry_ids_json: &str) -> String {
    let Some(hits) = parse_bm25_hits_json(hits_json) else {
        return String::new();
    };
    let Some(found_entry_ids) = parse_string_set_json(found_entry_ids_json) else {
        return String::new();
    };

    let mut seen_sources = BTreeSet::new();
    let mut sources = Vec::new();
    for hit in hits {
        if found_entry_ids.contains(&hit.doc_id) || hit.source_path.is_empty() {
            continue;
        }
        if seen_sources.insert(hit.source_path.clone()) {
            sources.push(hit.source_path);
        }
    }
    serialize_string_array_json(&sources)
}

/// BM25 hit, id lookup entry, file-path lookup entry를 최종 candidate plan으로 해석한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_bm25_candidate_resolution_json(
    hits_json: &str,
    found_entries_json: &str,
    path_entries_json: &str,
    candidate_limit: usize,
    max_score: f64,
) -> String {
    let Some(hits) = parse_bm25_hits_json(hits_json) else {
        return String::new();
    };
    let Some(found_entries) = parse_bm25_entries_json(found_entries_json) else {
        return String::new();
    };
    let Some(path_entries) = parse_bm25_entries_json(path_entries_json) else {
        return String::new();
    };
    if candidate_limit == 0 || hits.is_empty() {
        return "[]".to_owned();
    }

    let candidates = resolve_bm25_candidate_entries(
        &hits,
        &found_entries,
        &path_entries,
        candidate_limit,
        max_score,
    );
    serialize_bm25_candidate_resolution_json(&candidates)
}

/// structural retrieval에서 link/backlink target path plan을 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_structural_linked_paths_json(seed_paths_json: &str, edges_json: &str) -> String {
    let Some(seed_paths) = parse_string_array_json(seed_paths_json) else {
        return String::new();
    };
    let Some(edges) = parse_structural_link_edges_json(edges_json) else {
        return String::new();
    };
    let seed_path_set = seed_paths.iter().cloned().collect::<BTreeSet<_>>();
    if seed_path_set.is_empty() {
        return "[]".to_owned();
    }

    let mut seen = BTreeSet::new();
    let mut target_paths = Vec::new();
    for edge in edges {
        if seed_path_set.contains(&edge.source_path) && edge.target_path != edge.source_path {
            push_unique_string_with_seen(&mut target_paths, &mut seen, edge.target_path.clone());
        }
        if seed_path_set.contains(&edge.target_path) && edge.source_path != edge.target_path {
            push_unique_string_with_seen(&mut target_paths, &mut seen, edge.source_path);
        }
    }
    serialize_string_array_json(&target_paths)
}

/// structural retrieval에서 같은 heading 주변 entry index plan을 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_structural_heading_neighbors_json(
    seeds_json: &str,
    entries_json: &str,
    headings_json: &str,
) -> String {
    let Some(seeds) = parse_structural_heading_seeds_json(seeds_json) else {
        return String::new();
    };
    let Some(entries) = parse_structural_entries_json(entries_json) else {
        return String::new();
    };
    let Some(headings) = parse_structural_headings_json(headings_json) else {
        return String::new();
    };
    if seeds.is_empty() || entries.is_empty() {
        return "[]".to_owned();
    }

    let ranges = create_structural_heading_ranges(&seeds, &headings);
    let seed_ids = seeds
        .iter()
        .map(|seed| seed.id.clone())
        .collect::<BTreeSet<_>>();
    let mut selected = Vec::new();
    for (entry_index, entry) in entries.iter().enumerate() {
        if !entry.compatible || seed_ids.contains(&entry.id) {
            continue;
        }
        if ranges
            .iter()
            .any(|range| structural_entry_matches_range(entry, range))
        {
            selected.push(entry_index);
        }
    }
    serialize_usize_array_json(&selected)
}

/// LLM reranker provider에 넘길 system/user message content를 JSON으로 계획한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rerank_messages_json(
    question: &str,
    candidates_json: &str,
    max_text_chars: usize,
) -> String {
    let Some(candidates) = parse_rerank_message_candidates_json(candidates_json) else {
        return String::new();
    };
    let plan = plan_rerank_messages(question, &candidates, max_text_chars);
    serialize_rerank_messages_plan_json(&plan)
}

/// LLM reranker raw 응답에서 허용된 ranked id 목록만 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rerank_response_json(raw_response: &str, allowed_ids_json: &str) -> String {
    let Some(allowed_ids) = parse_string_array_json(allowed_ids_json) else {
        return String::new();
    };
    let allowed_ids = allowed_ids.into_iter().collect::<BTreeSet<_>>();
    if allowed_ids.is_empty() {
        return serialize_rerank_response_plan_json(&[], "skipped-empty-allowed-ids");
    }
    let Some(json_text) = extract_json_object(raw_response) else {
        return serialize_rerank_response_plan_json(&[], "invalid-json");
    };
    let Ok(value) = serde_json::from_str::<JsonValue>(json_text) else {
        return serialize_rerank_response_plan_json(&[], "invalid-json");
    };

    let ranked_ids = extract_allowed_rerank_ids(&value, &allowed_ids);
    let status = if ranked_ids.is_empty() {
        "empty-rank-plan"
    } else {
        "applied"
    };
    serialize_rerank_response_plan_json(&ranked_ids, status)
}

/// RAG reranker ranked id 목록을 전체 result index 순서 plan으로 변환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rerank_result_order_json(result_ids_json: &str, ranked_ids_json: &str) -> String {
    let Some(result_ids) = parse_string_array_json(result_ids_json) else {
        return String::new();
    };
    let Some(ranked_ids) = parse_string_array_json(ranked_ids_json) else {
        return String::new();
    };
    if result_ids.is_empty() {
        return "[]".to_owned();
    }

    let result_index_by_id = result_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect::<BTreeMap<_, _>>();
    let mut seen = BTreeSet::new();
    let mut ordered = Vec::new();

    for id in ranked_ids {
        let Some(index) = result_index_by_id.get(&id).copied() else {
            continue;
        };
        if seen.insert(id) {
            ordered.push(index);
        }
    }

    if ordered.is_empty() {
        ordered.extend(0..result_ids.len());
    } else {
        for (index, id) in result_ids.iter().enumerate() {
            if !seen.contains(id) {
                ordered.push(index);
            }
        }
    }
    serialize_usize_array_json(&ordered)
}

/// Query result 후보에서 기존 `TypeScript` MMR diversity selection과 같은 index를 고른다.
#[must_use]
#[wasm_bindgen]
pub fn select_diverse_indices(
    scores: &[f64],
    vectors: &[f64],
    dimensions: usize,
    source_keys: &[u32],
    heading_keys: &[u32],
    top_k: usize,
) -> Box<[f64]> {
    let Some(indexes) = select_diverse_index_plan(
        scores,
        vectors,
        dimensions,
        source_keys,
        heading_keys,
        top_k,
    ) else {
        return Box::default();
    };
    collect_indices_as_f64(indexes)
}

/// Query result 후보의 source path/heading 문자열을 포함해 MMR diversity index plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_diverse_result_indices_json(candidates_json: &str, top_k: usize) -> String {
    let Some(candidates) = parse_diverse_result_candidates_json(candidates_json) else {
        return String::new();
    };
    let Some(indexes) = plan_diverse_result_indices(&candidates, top_k) else {
        return String::new();
    };
    serialize_usize_array_json(&indexes)
}

/// `GraphRAG` community detection의 node assignment와 modularity를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn detect_communities_flat(
    source_indices: &[u32],
    target_indices: &[u32],
    weights: &[f64],
    node_count: usize,
    max_iterations: usize,
) -> Box<[f64]> {
    if node_count == 0
        || source_indices.len() != target_indices.len()
        || source_indices.len() != weights.len()
        || weights.iter().any(|weight| !weight.is_finite())
    {
        return Box::default();
    }

    let Some(graph) = build_community_graph(source_indices, target_indices, weights, node_count)
    else {
        return Box::default();
    };
    if graph.total_weight == 0.0 {
        return Box::default();
    }

    let assignments = detect_community_assignments(&graph, max_iterations);
    let remapped = remap_community_assignments(&assignments);
    let modularity = calculate_community_modularity(&graph, &remapped);

    let mut output = Vec::with_capacity(node_count.saturating_add(1));
    output.push(modularity);
    for community_id in remapped {
        if let Some(value) = usize_to_f64(community_id) {
            output.push(value);
        }
    }
    if output.len() != node_count.saturating_add(1) {
        return Box::default();
    }
    output.into_boxed_slice()
}

/// `GraphRAG` string edge snapshot에서 community assignment JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn detect_communities_from_edges_json(edges_json: &str, max_iterations: usize) -> String {
    let Some(edges) = parse_community_edge_records_json(edges_json) else {
        return String::new();
    };
    let Some(plan) = detect_communities_from_edge_records(&edges, max_iterations) else {
        return String::new();
    };
    serialize_community_detection_plan_json(&plan)
}

/// `GraphRAG` entity/relation string snapshot에서 relation edge record JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_edge_records_json(
    entity_ids_json: &str,
    relation_source_ids_json: &str,
    relation_target_ids_json: &str,
    confidences_json: &str,
) -> String {
    let Some(entity_ids) = parse_raw_string_array_json(entity_ids_json) else {
        return String::new();
    };
    let Some(source_ids) = parse_raw_string_array_json(relation_source_ids_json) else {
        return String::new();
    };
    let Some(target_ids) = parse_raw_string_array_json(relation_target_ids_json) else {
        return String::new();
    };
    let Some(confidences) = parse_finite_number_array_json(confidences_json) else {
        return String::new();
    };
    let Some(edges) = plan_graph_edge_records(&entity_ids, &source_ids, &target_ids, &confidences)
    else {
        return String::new();
    };
    serialize_community_edge_records_json(&edges)
}

/// `GraphRAG` relation edge를 무방향 endpoint pair 기준으로 집계한다.
#[must_use]
#[wasm_bindgen]
pub fn aggregate_graph_edges_flat(
    source_indices: &[u32],
    target_indices: &[u32],
    confidences: &[f64],
    node_count: usize,
) -> Box<[f64]> {
    if node_count == 0
        || source_indices.len() != target_indices.len()
        || source_indices.len() != confidences.len()
        || confidences.iter().any(|confidence| !confidence.is_finite())
    {
        return Box::default();
    }

    let Some(edges) =
        aggregate_graph_edges(source_indices, target_indices, confidences, node_count)
    else {
        return Box::default();
    };

    encode_aggregated_graph_edges(&edges)
}

/// `GraphRAG` store pruning에서 삭제/업데이트할 record index plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn prune_graph_indexes_json(config: &[u32], indices: &[u32], wire_values: &str) -> String {
    let Some(input) = parse_graph_prune_input(config, indices, wire_values) else {
        return String::new();
    };
    let plan = compute_graph_prune_plan(&input);
    serialize_graph_prune_plan_json(&plan)
}

/// `GraphRAG` local/evidence-first evidence score pair를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn score_local_evidence_pairs(config: &[u32], indices: &[u32], values: &[f64]) -> Box<[f64]> {
    let Some(input) = parse_local_evidence_input(config, indices, values) else {
        return Box::default();
    };

    let Some(evidence_scores) = score_local_evidence(&input) else {
        return Box::default();
    };
    encode_local_evidence_scores(&evidence_scores)
}

/// `GraphRAG` record snapshot에서 local evidence score `JSON` plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_local_evidence_scores_json(
    matches_json: &str,
    relations_json: &str,
    claims_json: &str,
    traversal_depth: usize,
) -> String {
    let Some(matches) = parse_local_evidence_match_records_json(matches_json) else {
        return String::new();
    };
    let Some(relations) = parse_local_evidence_relation_records_json(relations_json) else {
        return String::new();
    };
    let Some(claims) = parse_local_evidence_claim_records_json(claims_json) else {
        return String::new();
    };
    let Some(planned) =
        plan_local_evidence_input_from_records(&matches, &relations, &claims, traversal_depth)
    else {
        return String::new();
    };
    let input = planned.input.as_borrowed();
    let Some(scores) = score_local_evidence(&input) else {
        return String::new();
    };
    let mut scores_by_id = Vec::with_capacity(scores.len());
    for score in scores {
        let Some(evidence_id) = planned.evidence_ids.get(score.evidence_index) else {
            return String::new();
        };
        scores_by_id.push(EvidenceScoreById {
            evidence_id: evidence_id.clone(),
            score: score.score,
            sequence: score.sequence,
        });
    }
    serialize_evidence_scores_json(&scores_by_id)
}

/// claim record snapshot에서 evidence score JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_claim_evidence_scores_json(claims_json: &str) -> String {
    let Some(claims) = parse_claim_evidence_inputs_json(claims_json) else {
        return String::new();
    };
    let mut scores = Vec::new();
    for claim in claims {
        let score = clamp_unit_score(claim.confidence * 0.75);
        for evidence_id in claim.evidence_ids {
            if evidence_id.is_empty() {
                continue;
            }
            scores.push(EvidenceScoreById {
                evidence_id,
                score,
                sequence: scores.len(),
            });
        }
    }
    serialize_evidence_scores_json(&scores)
}

/// evidence score 목록을 max-score, first-seen tie 순서로 candidate order plan으로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_evidence_candidate_order_json(
    scores_json: &str,
    available_evidence_ids_json: &str,
) -> String {
    let Some(scores) = parse_evidence_scores_json(scores_json) else {
        return String::new();
    };
    let Some(available_ids) = parse_string_set_json(available_evidence_ids_json) else {
        return String::new();
    };
    if scores.is_empty() || available_ids.is_empty() {
        return "[]".to_owned();
    }

    let mut merged = BTreeMap::<String, EvidenceScoreById>::new();
    for score in scores {
        if !available_ids.contains(&score.evidence_id) {
            continue;
        }
        match merged.entry(score.evidence_id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(score);
            }
            Entry::Occupied(mut entry) => {
                let existing = entry.get_mut();
                existing.score = existing.score.max(score.score);
            }
        }
    }

    let mut ordered = merged.into_values().collect::<Vec<_>>();
    ordered.sort_by(compare_evidence_scores_by_id_descending);
    serialize_evidence_scores_json(&ordered)
}

/// ordered evidence score와 evidence snapshot에서 후보 lookup plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_evidence_candidate_lookup_json(scores_json: &str, evidence_json: &str) -> String {
    let Some(scores) = parse_evidence_scores_json(scores_json) else {
        return String::new();
    };
    let Some(evidence) = parse_graph_evidence_lookup_records_json(evidence_json) else {
        return String::new();
    };
    serialize_graph_evidence_candidate_lookup_plan_json(&plan_graph_evidence_candidate_lookup(
        &scores, &evidence,
    ))
}

/// Graph evidence candidate를 최종 vector entry candidate로 해석한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_evidence_entry_candidates_json(
    candidate_entry_ids_json: &str,
    entries_json: &str,
    candidate_limit: usize,
) -> String {
    let Some(candidate_entry_ids) = parse_raw_string_array_json(candidate_entry_ids_json) else {
        return String::new();
    };
    let Some(entries) = parse_graph_evidence_entry_records_json(entries_json) else {
        return String::new();
    };
    serialize_graph_evidence_entry_candidate_plan_json(&plan_graph_evidence_entry_candidates(
        &candidate_entry_ids,
        &entries,
        candidate_limit,
    ))
}

/// `GraphRAG` mention context에서 표시할 entity/relation index plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_mention_context_json(
    mention_names_json: &str,
    entities_json: &str,
    relations_json: &str,
) -> String {
    let Some(mention_names) = parse_string_array_json(mention_names_json) else {
        return String::new();
    };
    let Some(entities) = parse_graph_mention_entities_json(entities_json) else {
        return String::new();
    };
    let Some(relations) = parse_graph_mention_relations_json(relations_json) else {
        return String::new();
    };
    serialize_graph_mention_context_plan_json(&plan_graph_mention_context(
        &mention_names,
        &entities,
        &relations,
    ))
}

/// Graph extraction claim entity name을 entity id 목록으로 해석한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_claim_entity_ids_json(
    entity_names_json: &str,
    lookup_records_json: &str,
) -> String {
    let Some(entity_names) = parse_string_array_json(entity_names_json) else {
        return String::new();
    };
    let Some(lookup_records) = parse_graph_claim_entity_lookup_records_json(lookup_records_json)
    else {
        return String::new();
    };
    serialize_string_array_json(&plan_graph_claim_entity_ids(&entity_names, &lookup_records))
}

/// Graph extraction relation source/target name을 accepted entity index pair로 해석한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_relation_endpoint_indices_json(
    relations_json: &str,
    lookup_records_json: &str,
    entity_count: usize,
) -> String {
    let Some(relations) = parse_graph_relation_endpoint_inputs_json(relations_json) else {
        return String::new();
    };
    let Some(lookup_records) =
        parse_graph_relation_endpoint_lookup_records_json(lookup_records_json)
    else {
        return String::new();
    };
    serialize_graph_relation_endpoint_plan_json(&plan_graph_relation_endpoint_indices(
        &relations,
        &lookup_records,
        entity_count,
    ))
}

/// Graph extraction entity/claim type membership을 schema 기준 boolean plan으로 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_extraction_type_validation_json(
    entity_type_ids_json: &str,
    claim_type_ids_json: &str,
    schema_entity_type_ids_json: &str,
    schema_claim_type_ids_json: &str,
) -> String {
    let Some(entity_type_ids) = parse_raw_string_array_json(entity_type_ids_json) else {
        return String::new();
    };
    let Some(claim_type_ids) = parse_raw_string_array_json(claim_type_ids_json) else {
        return String::new();
    };
    let Some(schema_entity_type_ids) = parse_raw_string_array_json(schema_entity_type_ids_json)
    else {
        return String::new();
    };
    let Some(schema_claim_type_ids) = parse_raw_string_array_json(schema_claim_type_ids_json)
    else {
        return String::new();
    };

    serialize_graph_extraction_type_validation_plan_json(
        &plan_type_membership(&entity_type_ids, &schema_entity_type_ids),
        &plan_type_membership(&claim_type_ids, &schema_claim_type_ids),
    )
}

/// Graph community summarizer의 entity/relation/claim grouping index plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_community_summary_groups_json(
    assignments_json: &str,
    entity_ids_json: &str,
    relations_json: &str,
    claims_json: &str,
    community_ids_json: &str,
) -> String {
    let Some(assignments) = parse_graph_community_assignments_json(assignments_json) else {
        return String::new();
    };
    let Some(entity_ids) = parse_raw_string_array_json(entity_ids_json) else {
        return String::new();
    };
    let Some(relations) = parse_graph_community_summary_relations_json(relations_json) else {
        return String::new();
    };
    let Some(claims) = parse_graph_community_summary_claims_json(claims_json) else {
        return String::new();
    };
    let Some(community_ids) = parse_usize_array_json(community_ids_json) else {
        return String::new();
    };

    serialize_graph_community_summary_groups_json(&plan_graph_community_summary_groups(
        &assignments,
        &entity_ids,
        &relations,
        &claims,
        &community_ids,
    ))
}

/// vector entry metadata snapshot에서 file index record JSON plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_file_index_records_json(entries_json: &str, updated: f64) -> String {
    let Some(entries) = parse_file_index_entries_json(entries_json) else {
        return String::new();
    };
    if entries.is_empty() {
        return "[]".to_owned();
    }

    let mut index_by_path = BTreeMap::<String, usize>::new();
    let mut records = Vec::<FileIndexRecordPlan>::new();
    for entry in entries {
        let group_index = match index_by_path.entry(entry.file_path.clone()) {
            Entry::Occupied(index) => *index.get(),
            Entry::Vacant(index) => {
                let next_index = records.len();
                index.insert(next_index);
                records.push(FileIndexRecordPlan::from_first_entry(&entry, updated));
                next_index
            }
        };
        let Some(record) = records.get_mut(group_index) else {
            return String::new();
        };
        record.vector_count = record.vector_count.saturating_add(1);
        if let Some(entry_updated) = entry.updated {
            record.updated = record.updated.max(entry_updated);
        }
        record.has_complete_metadata =
            record.has_complete_metadata && entry.has_complete_metadata();
        if !record.has_complete_metadata {
            record.clear_optional_metadata();
        }
    }

    serialize_file_index_records_json(&records)
}

/// vector store add mutation plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_add_json(existing_ids_json: &str, incoming_ids_json: &str) -> String {
    let Some(existing_ids) = parse_raw_string_array_json(existing_ids_json) else {
        return String::new();
    };
    let Some(incoming_ids) = parse_raw_string_array_json(incoming_ids_json) else {
        return String::new();
    };

    serialize_vector_store_mutation_plan_json(&plan_vector_store_add(&existing_ids, &incoming_ids))
}

/// vector store file replacement mutation plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_replace_file_json(
    existing_file_paths_json: &str,
    file_path: &str,
    incoming_count: usize,
) -> String {
    let Some(existing_file_paths) = parse_raw_string_array_json(existing_file_paths_json) else {
        return String::new();
    };

    serialize_vector_store_mutation_plan_json(&plan_vector_store_replace_file(
        &existing_file_paths,
        file_path,
        incoming_count,
    ))
}

/// vector store file removal mutation plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_remove_file_json(
    existing_file_paths_json: &str,
    file_path: &str,
) -> String {
    let Some(existing_file_paths) = parse_raw_string_array_json(existing_file_paths_json) else {
        return String::new();
    };

    serialize_vector_store_mutation_plan_json(&plan_vector_store_remove_file(
        &existing_file_paths,
        file_path,
    ))
}

/// vector store stats와 indexed file path plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_stats_json(file_paths_json: &str, now: f64) -> String {
    let Some(file_paths) = parse_raw_string_array_json(file_paths_json) else {
        return String::new();
    };
    if !now.is_finite() {
        return String::new();
    }

    serialize_vector_store_stats_plan_json(&plan_vector_store_stats(&file_paths, now))
}

/// vector store file-path lookup index plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_lookup_by_file_paths_json(
    entry_file_paths_json: &str,
    requested_file_paths_json: &str,
) -> String {
    let Some(entry_file_paths) = parse_raw_string_array_json(entry_file_paths_json) else {
        return String::new();
    };
    let Some(requested_file_paths) = parse_raw_string_array_json(requested_file_paths_json) else {
        return String::new();
    };

    serialize_usize_array_json(&plan_vector_store_lookup_by_file_paths(
        &entry_file_paths,
        &requested_file_paths,
    ))
}

/// vector store id lookup index plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_lookup_by_ids_json(
    entry_ids_json: &str,
    requested_ids_json: &str,
) -> String {
    let Some(entry_ids) = parse_raw_string_array_json(entry_ids_json) else {
        return String::new();
    };
    let Some(requested_ids) = parse_raw_string_array_json(requested_ids_json) else {
        return String::new();
    };

    serialize_usize_array_json(&plan_vector_store_lookup_by_ids(&entry_ids, &requested_ids))
}

/// RAG index status summary와 update 대상 document plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_status_json(input_json: &str) -> String {
    let Some(input) = parse_rag_status_input_json(input_json) else {
        return String::new();
    };
    serialize_rag_status_plan_json(&plan_rag_status(&input))
}

/// indexPending이 처리할 file index와 skip count plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_index_pending_files_json(file_paths_json: &str, update_paths_json: &str) -> String {
    let Some(file_paths) = parse_raw_string_array_json(file_paths_json) else {
        return String::new();
    };
    let Some(update_paths) = parse_raw_string_array_json(update_paths_json) else {
        return String::new();
    };
    serialize_index_pending_plan_json(&plan_index_pending_files(&file_paths, &update_paths))
}

/// graph store record key snapshot에서 삭제할 record index plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_indexing_eta_json(input_json: &str) -> String {
    let Some(input) = parse_rag_indexing_eta_input_json(input_json) else {
        return String::new();
    };
    serialize_rag_indexing_eta_plan_json(&plan_rag_indexing_eta(&input))
}

/// RAG vector indexing progress snapshot에서 ETA plan JSON을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_deletion_indices_json(
    record_keys_json: &str,
    requested_keys_json: &str,
) -> String {
    let Some(record_keys) = parse_raw_string_array_json(record_keys_json) else {
        return String::new();
    };
    let Some(requested_keys) = parse_raw_string_array_json(requested_keys_json) else {
        return String::new();
    };
    serialize_usize_array_json(&plan_graph_deletion_indices(&record_keys, &requested_keys))
}

/// `GraphRAG` status 계산에 필요한 vector entry id lookup plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_status_entry_lookups_json(
    evidence_entry_ids_json: &str,
    cache_entry_ids_json: &str,
) -> String {
    let Some(evidence_entry_ids) = parse_raw_string_array_json(evidence_entry_ids_json) else {
        return String::new();
    };
    let Some(cache_entry_ids) = parse_raw_string_array_json(cache_entry_ids_json) else {
        return String::new();
    };
    serialize_string_array_json(&plan_graph_rag_status_entry_lookups(
        &evidence_entry_ids,
        &cache_entry_ids,
    ))
}

/// `GraphRAG` status에 사용할 candidate file snapshot plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_status_file_snapshot_json(
    file_records_json: &str,
    indexed_file_paths_json: &str,
) -> String {
    let Some(file_records) = parse_graph_rag_status_file_snapshot_records_json(file_records_json)
    else {
        return String::new();
    };
    let Some(indexed_file_paths) =
        parse_graph_rag_run_file_path_inputs_json(indexed_file_paths_json)
    else {
        return String::new();
    };
    serialize_graph_rag_status_file_snapshot_plan_json(&plan_graph_rag_status_file_snapshot(
        &file_records,
        &indexed_file_paths,
    ))
}

/// `GraphRAG` status에 사용할 vector entry snapshot plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_status_entry_snapshot_json(entries_json: &str) -> String {
    let Some(entries) = parse_graph_rag_status_entry_snapshot_inputs_json(entries_json) else {
        return String::new();
    };
    serialize_graph_rag_status_entry_snapshot_plan_json(&plan_graph_rag_status_entry_snapshot(
        &entries,
    ))
}

/// `GraphRAG`가 처리할 markdown file path 목록을 입력 순서대로 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_markdown_file_paths_json(file_paths_json: &str) -> String {
    let Some(file_paths) = parse_raw_string_array_json(file_paths_json) else {
        return String::new();
    };
    serialize_string_array_json(&plan_graph_rag_markdown_file_paths(&file_paths))
}

/// `GraphRAG` indexing run에서 candidate/selected file path 목록을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_run_file_selection_json(input_json: &str) -> String {
    let Some(input) = parse_graph_rag_run_file_selection_input_json(input_json) else {
        return String::new();
    };
    serialize_graph_rag_run_file_selection_plan_json(&plan_graph_rag_run_file_selection(&input))
}

/// `GraphRAG` store에서 prune할 unsupported graph file path 목록을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_unsupported_prune_paths_json(
    evidence_json: &str,
    rejected_facts_json: &str,
) -> String {
    let Some(evidence) = parse_graph_rag_run_file_path_inputs_json(evidence_json) else {
        return String::new();
    };
    let Some(rejected_facts) = parse_graph_rag_run_file_path_inputs_json(rejected_facts_json)
    else {
        return String::new();
    };
    serialize_string_array_json(&plan_graph_rag_unsupported_prune_paths(
        &evidence,
        &rejected_facts,
    ))
}

/// `GraphRAG` index status summary plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_rag_status_json(input_json: &str) -> String {
    let Some(input) = parse_graph_rag_status_input_json(input_json) else {
        return String::new();
    };
    serialize_graph_rag_status_plan_json(&plan_graph_rag_status(&input))
}

/// `GraphRAG` runtime 재구성 여부를 판정한다.
#[must_use]
#[wasm_bindgen]
pub fn should_rebuild_graph_runtime_for_graph_status(
    graph_rag_enabled: bool,
    graph_rag_model: &str,
    previous_status_state: &str,
    next_status_state: &str,
    graph_provider_attached: bool,
) -> bool {
    if (!graph_rag_enabled) || graph_rag_model.trim().is_empty() {
        return false;
    }
    if graph_provider_attached {
        return false;
    }
    if !is_graph_rag_queryable_state(next_status_state) {
        return false;
    }
    !is_graph_rag_queryable_state(previous_status_state)
}

/// `GraphRAG` 상태 문자열이 query 가능 상태인지 판정한다.
#[must_use]
fn is_graph_rag_queryable_state(state: &str) -> bool {
    matches!(state, "ready" | "partial")
}

/// MCP 연결 상태를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn get_mcp_connection_state_rust(
    total_count: usize,
    connected_count: usize,
    failed_count: usize,
    is_connecting: bool,
) -> String {
    if total_count == 0 {
        return "idle".to_owned();
    }
    if is_connecting {
        return "connecting".to_owned();
    }
    if failed_count == 0 {
        return "connected".to_owned();
    }
    if connected_count > 0 {
        return "partial-error".to_owned();
    }
    "error".to_owned()
}

/// MCP 경로 힌트가 필요한지 판정한다.
#[must_use]
#[wasm_bindgen]
pub fn should_append_mcp_path_hint_rust(command: &str, error_message: &str) -> bool {
    if !error_message.contains("ENOENT") {
        return false;
    }
    if command.is_empty() || command.contains('/') || command.contains('\\') {
        return false;
    }
    true
}

/// `GraphRAG` entity upsert merge field plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_entity_merge_json(existing_json: &str, next_json: &str) -> String {
    let Some(existing) = parse_graph_entity_merge_input_json(existing_json) else {
        return String::new();
    };
    let Some(next) = parse_graph_entity_merge_input_json(next_json) else {
        return String::new();
    };
    serialize_graph_entity_merge_plan_json(&plan_graph_entity_merge(&existing, &next))
}

/// `GraphRAG` entity 병합 이후 참조 id를 교체하고 필요하면 순서를 보존해 중복 제거한다.
#[must_use]
#[wasm_bindgen]
pub fn rewrite_graph_entity_references_json(
    references_json: &str,
    candidate_entity_id: &str,
    existing_entity_id: &str,
    deduplicate: bool,
) -> String {
    let Ok(references) = serde_json::from_str::<Vec<String>>(references_json) else {
        return String::new();
    };
    serde_json::to_string(&rewrite_graph_entity_references(
        &references,
        candidate_entity_id,
        existing_entity_id,
        deduplicate,
    ))
    .unwrap_or_default()
}

/// 두 entity id 쌍이 순서와 무관하게 같은 대상을 가리키는지 판정한다.
#[must_use]
#[wasm_bindgen]
pub fn is_same_graph_entity_pair(
    first_left: &str,
    first_right: &str,
    second_left: &str,
    second_right: &str,
) -> bool {
    (first_left == second_left && first_right == second_right)
        || (first_left == second_right && first_right == second_left)
}

/// `GraphRAG` extraction cache snapshot이 요청 key와 일치하는지 판정한다.
#[must_use]
#[wasm_bindgen]
pub fn is_graph_extraction_cache_hit_json(cached_json: &str, input_json: &str) -> String {
    let Ok(cached_value) = serde_json::from_str::<JsonValue>(cached_json) else {
        return String::new();
    };
    let Some(input) = parse_graph_extraction_cache_key_json(input_json) else {
        return String::new();
    };
    if cached_value.is_null() {
        return "false".to_owned();
    }
    let Some(cached) = parse_graph_extraction_cache_key_value(&cached_value) else {
        return String::new();
    };
    graph_extraction_cache_hit(&cached, &input).to_string()
}

/// RAG file type summary의 집계/정렬 plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_file_type_summary_json(files_json: &str, no_extension_label: &str) -> String {
    let Some(files) = parse_rag_file_type_inputs_json(files_json) else {
        return String::new();
    };

    let mut target_counts = BTreeMap::<String, usize>::new();
    let mut recommendation_counts = BTreeMap::<String, RagExcludeRecommendationPlan>::new();
    for file in files {
        let extension = normalize_file_extension(
            file.extension
                .filter(|extension| !extension.trim().is_empty())
                .as_deref()
                .unwrap_or_else(|| get_path_extension(&file.file_path)),
        );
        let key = if extension.is_empty() {
            "(none)".to_owned()
        } else {
            extension
        };

        if file.indexable {
            *target_counts.entry(key).or_insert(0) += 1;
            continue;
        }
        if key != "(none)" && !is_recommendable_exclude_extension(&key) {
            continue;
        }

        let reason = file.recommendation_reason.unwrap_or_default();
        let entry = recommendation_counts.entry(key.clone()).or_insert_with(|| {
            RagExcludeRecommendationPlan {
                extension: key,
                label: String::new(),
                count: 0,
                reason: String::new(),
            }
        });
        entry.count = entry.count.saturating_add(1);
        entry.reason = reason;
    }

    let mut target_types = target_counts
        .into_iter()
        .map(|(extension, count)| RagFileTypeCountPlan {
            label: file_type_label(&extension, no_extension_label),
            extension,
            count,
        })
        .collect::<Vec<_>>();
    target_types.sort_by(compare_file_type_counts);

    let mut recommendations = recommendation_counts
        .into_values()
        .map(|mut recommendation| {
            recommendation.label = file_type_label(&recommendation.extension, no_extension_label);
            recommendation
        })
        .collect::<Vec<_>>();
    recommendations.sort_by(compare_recommendation_counts);

    let total_target_files = target_types.iter().map(|item| item.count).sum::<usize>();
    serialize_rag_file_type_summary_json(&target_types, &recommendations, total_target_files)
}

/// RAG 후보 파일 판정 전에 host content read가 필요한 file index를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_file_content_probe_indices_json(
    files_json: &str,
    exclude_paths_json: &str,
    exclude_exts_json: &str,
) -> String {
    let Some(files) = parse_rag_file_eligibility_inputs_json(files_json) else {
        return String::new();
    };
    let Some(exclude_paths) = parse_string_array_json(exclude_paths_json) else {
        return String::new();
    };
    let Some(exclude_exts) = parse_string_array_json(exclude_exts_json) else {
        return String::new();
    };

    serialize_usize_array_json(&plan_rag_file_content_probe_indices(
        &files,
        &exclude_paths,
        &exclude_exts,
    ))
}

/// RAG 후보 file index와 file type summary 입력 row를 함께 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_file_indexability_json(
    files_json: &str,
    exclude_paths_json: &str,
    exclude_exts_json: &str,
    text_probes_json: &str,
) -> String {
    let Some(files) = parse_rag_file_eligibility_inputs_json(files_json) else {
        return String::new();
    };
    let Some(exclude_paths) = parse_string_array_json(exclude_paths_json) else {
        return String::new();
    };
    let Some(exclude_exts) = parse_string_array_json(exclude_exts_json) else {
        return String::new();
    };
    let Some(text_probes) = parse_rag_file_text_probe_inputs_json(text_probes_json) else {
        return String::new();
    };

    let (candidate_indices, summary_inputs) =
        plan_rag_file_indexability(&files, &exclude_paths, &exclude_exts, &text_probes);
    serialize_rag_file_indexability_plan_json(&candidate_indices, &summary_inputs)
}

/// assistant 답변에서 출처 참조와 path alias plan을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_references_json(content: &str) -> String {
    serialize_source_references_json(&extract_source_references(content))
}

/// source validation에 필요한 verified citation과 vault alias probe 입력을 `JSON` 문자열로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_validation_inputs_json(
    references_json: &str,
    citation_ids_json: &str,
    citation_paths_json: &str,
    citation_statuses_json: &str,
) -> String {
    let Some(references) = parse_source_references_json(references_json) else {
        return String::new();
    };
    let Some(citation_ids) = parse_raw_string_array_json(citation_ids_json) else {
        return String::new();
    };
    let Some(citation_paths) = parse_raw_string_array_json(citation_paths_json) else {
        return String::new();
    };
    let Some(citation_statuses) = parse_raw_string_array_json(citation_statuses_json) else {
        return String::new();
    };
    let Some(plan) = plan_source_validation_inputs(
        &references,
        &citation_ids,
        &citation_paths,
        &citation_statuses,
    ) else {
        return String::new();
    };

    serialize_source_validation_input_plan_json(&plan)
}

/// 출처 참조 plan과 host boundary 검증 결과를 warning key plan으로 합친다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_validation_warnings_json(
    references_json: &str,
    verified_citation_ids_json: &str,
    verified_paths_json: &str,
    existing_aliases_json: &str,
) -> String {
    let Some(references) = parse_source_references_json(references_json) else {
        return String::new();
    };
    let Some(verified_citation_ids) = parse_string_array_json(verified_citation_ids_json) else {
        return String::new();
    };
    let Some(verified_paths) = parse_string_array_json(verified_paths_json) else {
        return String::new();
    };
    let Some(existing_aliases) = parse_string_array_json(existing_aliases_json) else {
        return String::new();
    };

    let verified_citation_ids = verified_citation_ids.into_iter().collect::<BTreeSet<_>>();
    let existing_aliases = existing_aliases.into_iter().collect::<BTreeSet<_>>();
    let verified_path_aliases = verified_paths
        .iter()
        .flat_map(|path| source_path_aliases(path))
        .collect::<BTreeSet<_>>();

    let mut seen = BTreeSet::<String>::new();
    let mut warnings = Vec::<SourceValidationWarningPlan>::new();
    for reference in references {
        if reference.kind == SourceReferenceKind::SourceId {
            if verified_citation_ids.contains(&reference.target) {
                continue;
            }
            let id = format!("source:{}", reference.target);
            if seen.insert(id.clone()) {
                warnings.push(SourceValidationWarningPlan {
                    id,
                    label: reference.label,
                    kind: SourceWarningKind::UnverifiedSource,
                });
            }
            continue;
        }

        let is_verified = reference
            .aliases
            .iter()
            .any(|alias| verified_path_aliases.contains(alias));
        let exists = reference
            .aliases
            .iter()
            .any(|alias| existing_aliases.contains(alias));
        if is_verified || exists {
            continue;
        }

        let id = format!("link:{}", reference.target);
        if seen.insert(id.clone()) {
            warnings.push(SourceValidationWarningPlan {
                id,
                label: reference.label,
                kind: SourceWarningKind::MissingLink,
            });
        }
    }

    serialize_source_validation_warnings_json(&warnings)
}

/// assistant 응답을 일반 답변 또는 사용자 질문 plan으로 분류한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_assistant_response_classification_json(content: &str, reasoning: &str) -> String {
    let trimmed_content = content.trim();
    let trimmed_reasoning = reasoning.trim();

    if let Some(question) =
        detect_assistant_question(trimmed_content, AssistantQuestionSource::Answer)
    {
        return serialize_assistant_question_classification_json(
            "",
            trimmed_reasoning,
            &question,
            content,
        );
    }

    if trimmed_content.is_empty() {
        let leaked_block = extract_last_assistant_question_block(trimmed_reasoning);
        if let Some(question) =
            detect_assistant_question(&leaked_block, AssistantQuestionSource::ReasoningLeak)
        {
            return serialize_assistant_question_classification_json(
                "",
                trimmed_reasoning,
                &question,
                content,
            );
        }
    }

    serialize_assistant_answer_classification_json(trimmed_content, trimmed_reasoning)
}

/// Vault prompt 생성용 summary를 `JSON` 계획 형태로 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_prompt_library_summary_json(entries_json: &str) -> String {
    let Some(inputs) = parse_prompt_library_inputs_json(entries_json) else {
        return String::new();
    };
    let plan = plan_prompt_library_summary(&inputs);
    serialize_prompt_library_summary_json(&plan)
}

/// prompt library summary를 계산한다.
fn plan_prompt_library_summary(inputs: &[PromptLibrarySummaryInput]) -> PromptLibrarySummaryPlan {
    let mut file_counts = BTreeMap::<String, usize>::new();
    let mut folder_counts = BTreeMap::<String, usize>::new();
    let mut heading_counts = BTreeMap::<String, usize>::new();

    for input in inputs {
        *file_counts.entry(input.file_path.clone()).or_insert(0) += 1;

        let folder = if input.file_path.contains('/') {
            let mut parts = input.file_path.split('/').collect::<Vec<_>>();
            parts.pop();
            parts.join("/")
        } else {
            "(root)".to_owned()
        };
        *folder_counts.entry(folder).or_insert(0) += 1;

        let heading = input.heading.trim();
        if !heading.is_empty() {
            *heading_counts.entry(heading.to_owned()).or_insert(0) += 1;
        }
    }

    let top_folders =
        summarize_prompt_library_counts(&folder_counts, PROMPT_LIBRARY_TOP_FOLDER_LIMIT);
    let top_files = summarize_prompt_library_counts(&file_counts, PROMPT_LIBRARY_TOP_FILE_LIMIT);
    let top_headings =
        summarize_prompt_library_counts(&heading_counts, PROMPT_LIBRARY_TOP_HEADING_LIMIT);
    let representative_inputs =
        select_prompt_library_representative_entries(inputs, PROMPT_LIBRARY_SAMPLE_LIMIT);
    let samples = representative_inputs
        .into_iter()
        .map(|input| PromptLibrarySummarySample {
            file_path: input.file_path,
            heading: input.heading,
            preview: compact_prompt_library_whitespace(&input.text)
                .chars()
                .take(PROMPT_LIBRARY_SAMPLE_PREVIEW_MAX_CHARS)
                .collect(),
        })
        .collect();

    PromptLibrarySummaryPlan {
        total_chunks: inputs.len(),
        top_folders,
        top_files,
        top_headings,
        samples,
    }
}

/// prompt library summary를 `JSON`으로 serialize한다.
fn serialize_prompt_library_summary_json(plan: &PromptLibrarySummaryPlan) -> String {
    format!(
        "{{\"totalChunks\":{},\"topFolders\":{},\"topFiles\":{},\"topHeadings\":{},\"samples\":{}}}",
        plan.total_chunks,
        serialize_prompt_library_count_rows_json(&plan.top_folders),
        serialize_prompt_library_count_rows_json(&plan.top_files),
        serialize_prompt_library_count_rows_json(&plan.top_headings),
        serialize_prompt_library_sample_rows_json(&plan.samples),
    )
}

/// prompt library summary count 행 배열을 JSON 배열로 serialize한다.
fn serialize_prompt_library_count_rows_json(rows: &[PromptLibrarySummaryCount]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            format!(
                "{{\"label\":\"{}\",\"count\":{}}}",
                escape_json_string(&row.label),
                row.count
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// prompt library representative sample 행 배열을 JSON 배열로 serialize한다.
fn serialize_prompt_library_sample_rows_json(rows: &[PromptLibrarySummarySample]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            format!(
                "{{\"filePath\":\"{}\",\"heading\":\"{}\",\"preview\":\"{}\"}}",
                escape_json_string(&row.file_path),
                escape_json_string(&row.heading),
                escape_json_string(&row.preview),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// count map을 limit 순서로 정렬한 집계 plan으로 변환한다.
fn summarize_prompt_library_counts(
    counts: &BTreeMap<String, usize>,
    limit: usize,
) -> Vec<PromptLibrarySummaryCount> {
    let mut rows = counts
        .iter()
        .map(|(label, count)| PromptLibrarySummaryCount {
            label: label.clone(),
            count: *count,
        })
        .collect::<Vec<_>>();
    rows.sort_unstable_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.label.cmp(&right.label))
    });
    rows.into_iter().take(limit).collect()
}

/// representative 샘플을 TS와 동일한 정책으로 선별한다.
fn select_prompt_library_representative_entries(
    inputs: &[PromptLibrarySummaryInput],
    limit: usize,
) -> Vec<PromptLibrarySummaryInput> {
    if inputs.len() <= limit {
        return inputs.to_vec();
    }
    let mut selected = Vec::<PromptLibrarySummaryInput>::with_capacity(limit);
    let mut used = BTreeSet::<usize>::new();
    let step = inputs.len().div_ceil(limit.max(1));

    for (index, input) in inputs.iter().enumerate().step_by(step) {
        if selected.len() >= limit {
            break;
        }
        selected.push(input.clone());
        used.insert(index);
    }

    for (index, input) in inputs.iter().enumerate() {
        if selected.len() >= limit {
            break;
        }
        if used.contains(&index) {
            continue;
        }
        selected.push(input.clone());
    }

    selected
}

/// 연속 공백을 단일 공백으로 압축한다.
fn compact_prompt_library_whitespace(text: &str) -> String {
    let mut compact = String::new();
    let mut previous_space = false;
    for character in text.chars() {
        if character.is_whitespace() {
            if !previous_space {
                compact.push(' ');
                previous_space = true;
            }
            continue;
        }
        previous_space = false;
        compact.push(character);
    }
    compact.trim().to_owned()
}

/// 저장된 chat session markdown body에서 current-format message plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_messages_json(
    body: &str,
    now_timestamp: f64,
    now_iso: &str,
    decode_failure_label: &str,
) -> String {
    serialize_json_array(&parse_chat_message_plans(
        body,
        now_timestamp,
        now_iso,
        decode_failure_label,
    ))
}

/// 저장된 chat session markdown에서 list metadata plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_meta_json(
    content: &str,
    fallback_title: &str,
    fallback_created_iso: &str,
) -> String {
    serialize_chat_meta_plan_json(&plan_chat_meta(
        content,
        fallback_title,
        fallback_created_iso,
    ))
}

/// 저장할 chat session metadata plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_save_metadata_json(
    messages_json: &str,
    existing_created: &str,
    option_title: &str,
    now_iso: &str,
) -> String {
    serialize_chat_save_metadata_plan_json(&plan_chat_save_metadata(
        messages_json,
        existing_created,
        option_title,
        now_iso,
    ))
}

/// RAG context source citation/block/source id plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_context_sources_json(
    results_json: &str,
    verifications_json: &str,
    first_index: usize,
    prefix: &str,
) -> String {
    serialize_context_source_plan_json(&plan_context_sources(
        results_json,
        verifications_json,
        first_index,
        prefix,
    ))
}

/// Context budget append 결과를 Rust에서 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_context_budget_append_json(remaining_chars: usize, text: &str) -> String {
    serialize_context_budget_append_plan_json(&plan_context_budget_append(remaining_chars, text))
}

/// Chat context mention type별 index와 auto-RAG policy를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_chat_context_mentions_json(mention_types_json: &str) -> String {
    let Some(mention_types) = parse_raw_string_array_json(mention_types_json) else {
        return String::new();
    };
    let Some(plan) = plan_chat_context_mentions(&mention_types) else {
        return String::new();
    };

    serialize_chat_context_mention_plan_json(&plan)
}

/// MCP server 후보 순서를 Rust에서 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_mcp_server_candidates_json(
    preferred_server_names_json: &str,
    enabled_server_names_json: &str,
    connection_statuses_json: &str,
) -> String {
    let Some(preferred_server_names) = parse_raw_string_array_json(preferred_server_names_json)
    else {
        return String::new();
    };
    let Some(enabled_server_names) = parse_raw_string_array_json(enabled_server_names_json) else {
        return String::new();
    };
    let Some(connection_statuses) = parse_string_string_object_json(connection_statuses_json)
    else {
        return String::new();
    };

    serialize_string_array_json(&plan_mcp_server_candidates(
        &preferred_server_names,
        &enabled_server_names,
        &connection_statuses,
    ))
}

/// MCP tool 목록에 요청 tool name이 있는지 Rust에서 판정한다.
#[must_use]
#[wasm_bindgen]
pub fn is_mcp_tool_name_available(tool_name: &str, tool_names_json: &str) -> bool {
    let Some(tool_names) = parse_raw_string_array_json(tool_names_json) else {
        return false;
    };
    tool_names.iter().any(|name| name == tool_name)
}

/// MCP tool 실행 인자 문자열을 TypeScript 호스트 경계 계약으로 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn parse_mcp_tool_arguments_json(arguments_text: &str) -> String {
    let trimmed = arguments_text.trim();
    if trimmed.is_empty() {
        return "{}".to_owned();
    }

    let Ok(parsed) = serde_json::from_str::<JsonValue>(trimmed) else {
        let mut fallback = JsonMap::new();
        fallback.insert(
            "input".to_owned(),
            JsonValue::String(arguments_text.to_owned()),
        );
        return JsonValue::Object(fallback).to_string();
    };

    if parsed.is_object() {
        return parsed.to_string();
    }

    let mut wrapped = JsonMap::new();
    wrapped.insert("input".to_owned(), parsed);
    JsonValue::Object(wrapped).to_string()
}

/// MCP tool 실행 결과에서 표시/모델 텍스트 추출 계약을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_mcp_tool_result_json(result_json: &str) -> String {
    let result = serde_json::from_str::<JsonValue>(result_json)
        .unwrap_or_else(|_| JsonValue::String(result_json.to_owned()));

    let extracted = collect_mcp_tool_result_text_from_json(&result).unwrap_or_else(|| {
        if result
            .get("content")
            .and_then(JsonValue::as_array)
            .is_some_and(Vec::is_empty)
        {
            "[]".to_owned()
        } else {
            stringify_json_compact(&result).unwrap_or_else(|| "{}".to_owned())
        }
    });

    let mut output = JsonMap::new();
    output.insert(
        "displayText".to_owned(),
        JsonValue::String(extracted.clone()),
    );
    output.insert("modelText".to_owned(), JsonValue::String(extracted));
    JsonValue::Object(output).to_string()
}

/// MCP tool 결과가 빈 응답으로 간주되는지 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn is_mcp_tool_result_empty_json(
    result_json: &str,
    display_text: &str,
    model_text: &str,
) -> bool {
    if display_text.trim().is_empty() || model_text.trim().is_empty() {
        return true;
    }

    let Ok(result) = serde_json::from_str::<JsonValue>(result_json) else {
        return false;
    };

    if result
        .get("content")
        .and_then(JsonValue::as_array)
        .is_some_and(|content| !mcp_tool_has_meaningful_content(content))
    {
        return true;
    }

    false
}

/// MCP 에러 메시지를 분류해 TS i18n 렌더링에 필요한 키 계약을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn classify_mcp_tool_error_json(raw_msg: &str) -> String {
    let message = raw_msg.trim();

    let mut output = JsonMap::new();
    if message.contains("Input validation error") {
        if let Some(pattern) = extract_quoted_after(message, "does not match '") {
            output.insert(
                "kind".to_owned(),
                JsonValue::String("validation-pattern".to_owned()),
            );
            output.insert("pattern".to_owned(), JsonValue::String(pattern));
            return JsonValue::Object(output).to_string();
        }

        if let Some(field) = extract_first_quoted(message) {
            output.insert(
                "kind".to_owned(),
                JsonValue::String("validation-field".to_owned()),
            );
            output.insert("field".to_owned(), JsonValue::String(field));
            return JsonValue::Object(output).to_string();
        }

        output.insert(
            "kind".to_owned(),
            JsonValue::String("validation-generic".to_owned()),
        );
        return JsonValue::Object(output).to_string();
    }

    if message.contains("required") {
        output.insert(
            "kind".to_owned(),
            JsonValue::String("validation-required".to_owned()),
        );
        return JsonValue::Object(output).to_string();
    }

    output.insert("kind".to_owned(), JsonValue::String("raw".to_owned()));
    output.insert("message".to_owned(), JsonValue::String(message.to_owned()));
    JsonValue::Object(output).to_string()
}

/// MCP 툴 응답에서 text-only/복합 컨텐츠 항목을 추출해 표시 문자열로 정규화한다.
/// text 항목은 trim 이후 값이 있는 경우만 반영한다.
fn collect_mcp_tool_result_text_from_json(result: &JsonValue) -> Option<String> {
    let content_items = result.get("content")?.as_array()?;
    let mut parts: Vec<String> = Vec::new();

    for item in content_items {
        let Some(item_obj) = item.as_object() else {
            continue;
        };

        if item_obj.get("type").and_then(JsonValue::as_str) == Some("text") {
            let text = item_obj.get("text").and_then(JsonValue::as_str);
            if let Some(text) = text {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    parts.push(text.to_owned());
                }
            }
            continue;
        }

        parts
            .push(stringify_json_compact(&JsonValue::Object(item_obj.clone())).unwrap_or_default());
    }

    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n\n"))
}

/// MCP content 배열에서 실질적으로 의미 있는 항목이 있는지 판별한다.
/// text 항목은 빈 문자열을 거르고, 비-text 항목은 빈 객체를 제외한다.
fn mcp_tool_has_meaningful_content(items: &[JsonValue]) -> bool {
    items.iter().any(|item| {
        let Some(item_obj) = item.as_object() else {
            return false;
        };

        if item_obj.get("type").and_then(JsonValue::as_str) == Some("text") {
            return item_obj
                .get("text")
                .and_then(JsonValue::as_str)
                .is_some_and(|text| !text.trim().is_empty());
        }

        !item_obj.is_empty()
    })
}

/// 문자열에서 특정 패턴 뒤에 오는 첫 번째 작은따옴표로 감싼 값에서 내용을 추출한다.
fn extract_quoted_after(text: &str, needle: &str) -> Option<String> {
    let rest = text.find(needle)?;
    let value = &text[rest + needle.len()..];
    let end = value.find('\'')?;
    Some(value[..end].to_owned())
}

/// 문자열에서 첫 번째 작은따옴표로 감싸인 값을 추출한다.
fn extract_first_quoted(text: &str) -> Option<String> {
    let start = text.find('\'')?;
    let value = &text[start + 1..];
    let end = value.find('\'')?;
    Some(value[..end].to_owned())
}

/// compact JSON 문자열화를 수행한다.
fn stringify_json_compact(value: &JsonValue) -> Option<String> {
    serde_json::to_string(value).ok()
}

/// `GraphRAG` virtual source verification plan을 만든다.
#[must_use]
#[wasm_bindgen]
pub fn plan_context_graph_verification_json(file_path: &str, unsupported_detail: &str) -> String {
    serialize_context_graph_verification_plan_json(&plan_context_graph_verification(
        file_path,
        unsupported_detail,
    ))
}

/// context source preview를 만든다.
#[must_use]
#[wasm_bindgen]
pub fn create_context_preview(text: &str) -> String {
    build_context_preview(text)
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

/// vault 내부 참조 링크를 추출하고 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn extract_vault_links_json(content: &str) -> String {
    let links = extract_vault_links(content);
    serialize_string_array_json(&links)
}

/// vault link target의 path candidate와 basename fallback을 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vault_link_candidates_json(source_path: &str, raw_target: &str) -> String {
    let target = normalize_vault_path(raw_target);
    let candidates = create_vault_link_path_candidates(source_path, raw_target, &target);
    let fallback_basename = target
        .rsplit('/')
        .next()
        .map(strip_markdown_extension)
        .unwrap_or_default();
    serialize_vault_link_candidate_plan_json(&candidates, fallback_basename)
}

/// vault link basename fallback으로 선택할 markdown file index를 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_vault_link_fallback_index_json(
    fallback_basename: &str,
    basenames_json: &str,
) -> String {
    let Some(basenames) = parse_raw_string_array_json(basenames_json) else {
        return String::new();
    };
    serialize_optional_index_plan_json(plan_vault_link_fallback_index(
        fallback_basename,
        &basenames,
    ))
}

/// folder mention에 포함할 markdown file index와 partial 여부를 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_folder_mention_file_indices_json(
    folder_path: &str,
    file_paths_json: &str,
    max_files: usize,
) -> String {
    let Some(file_paths) = parse_raw_string_array_json(file_paths_json) else {
        return String::new();
    };
    serialize_folder_mention_file_plan_json(&plan_folder_mention_file_indices(
        folder_path,
        &file_paths,
        max_files,
    ))
}

/// 참조 확장 대상으로 사용할 resolved file path index를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_reference_file_indices_json(source_path: &str, file_paths_json: &str) -> String {
    let Some(file_paths) = parse_raw_string_array_json(file_paths_json) else {
        return String::new();
    };
    serialize_usize_array_json(&plan_reference_file_indices(source_path, &file_paths))
}

/// 채팅 입력의 raw mention 후보를 추출하고 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn parse_mention_candidates_json(content: &str) -> String {
    let candidates = parse_mention_candidates(content);
    serialize_mention_candidates_json(&candidates)
}

/// vault path가 제외 pattern 목록에 매칭되는지 확인한다.
#[must_use]
#[wasm_bindgen]
pub fn is_excluded_path(file_path: &str, patterns: &str) -> bool {
    is_vault_path_excluded(file_path, patterns.split('\0'))
}

/// 파일 확장자 목록 기준 카운트를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn count_files_by_extensions_json(
    file_extensions_json: &str,
    extension_keys_json: &str,
) -> String {
    let Some(file_extensions) = parse_raw_string_array_json(file_extensions_json) else {
        return String::new();
    };
    let Some(extension_keys) = parse_raw_string_array_json(extension_keys_json) else {
        return String::new();
    };

    serialize_string_number_map_json(&count_file_extensions_by_keys(
        &file_extensions,
        &extension_keys,
    ))
}

/// 파일 경로 확장자가 제외 대상 목록에 있으면 `true`를 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn is_excluded_ext_json(file_path: &str, extension_keys_json: &str) -> bool {
    let Some(extension_keys) = parse_raw_string_array_json(extension_keys_json) else {
        return false;
    };

    is_vault_file_extension_excluded(file_path, &extension_keys)
}

/// 파일 확장자 목록을 기준으로 카운트를 계산한다.
fn count_file_extensions_by_keys(
    file_extensions: &[String],
    extension_keys: &[String],
) -> BTreeMap<String, f64> {
    let target_extensions = normalized_extension_set(extension_keys);
    let mut output = target_extensions
        .into_iter()
        .map(|extension| (extension, 0_f64))
        .collect::<BTreeMap<String, f64>>();

    for extension in file_extensions {
        let normalized_extension = normalize_file_extension(extension);
        if normalized_extension.is_empty() {
            continue;
        }
        if let Some(count) = output.get_mut(&normalized_extension) {
            *count += 1.0;
        }
    }

    output
}

/// 파일 경로의 확장자가 제외 목록에 있으면 true를 반환한다.
fn is_vault_file_extension_excluded(file_path: &str, extension_keys: &[String]) -> bool {
    let file_extension = normalize_file_extension(get_path_extension(file_path));
    if file_extension.is_empty() {
        return false;
    }

    let excluded_extensions = normalized_extension_set(extension_keys);
    excluded_extensions.contains(&file_extension)
}

/// 확장자 문자열을 RAG 제외 설정 계약에 맞게 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_exclude_extension_json(extension: &str) -> String {
    normalize_file_extension(extension)
}

/// Markdown 문서 확장자 제외를 막는지 확인한다.
#[must_use]
#[wasm_bindgen]
pub fn is_protected_rag_document_extension_json(extension: &str) -> bool {
    is_protected_rag_document_extension(extension)
}

/// RAG 제외 가능한 확장자인지 확인한다.
#[must_use]
#[wasm_bindgen]
pub fn is_recommendable_exclude_extension_json(extension: &str) -> bool {
    is_recommendable_rag_exclude_extension_for_validation(extension)
}

/// RAG 제외 경로 입력을 정규화하고 유효성 이슈를 JSON으로 반환한다.
/// `path-missing` 경고는 host(상태 검사 필요)에서 처리한다.
#[must_use]
#[wasm_bindgen]
pub fn validate_exclude_path_input_json(input: &str, existing_paths_json: &str) -> String {
    let Some(existing_paths) = parse_raw_string_array_json(existing_paths_json) else {
        return String::new();
    };

    let normalized = input.trim();
    let issues = analyze_exclude_path_issues(normalized, input, &existing_paths);
    serialize_exclude_validation_result(normalized, &issues)
}

/// RAG 제외 확장자 입력을 정규화하고 유효성 이슈를 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn validate_exclude_extension_input_json(input: &str, existing_exts_json: &str) -> String {
    let Some(existing_exts) = parse_raw_string_array_json(existing_exts_json) else {
        return String::new();
    };

    let trimmed = input.trim();
    let normalized = normalize_file_extension(trimmed);
    let issues = analyze_exclude_extension_issues(trimmed, &normalized, &existing_exts);
    serialize_exclude_validation_result(&normalized, &issues)
}

/// RAG 제외 경로 입력을 위한 문제 목록을 계산한다.
fn analyze_exclude_path_issues(
    normalized: &str,
    original: &str,
    existing_paths: &[String],
) -> Vec<ExcludeInputValidationIssue> {
    let mut issues = Vec::new();

    if normalized.is_empty() {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::Empty,
        });
        return issues;
    }

    if normalized != original {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Warning,
            code: ExcludeValidationCode::Trimmed,
        });
    }

    if normalized.contains(',') {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::Comma,
        });
    }

    if normalized.contains('\\') {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::PathBackslash,
        });
    }

    if normalized.starts_with('/') {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::PathLeadingSlash,
        });
    }

    if existing_paths
        .iter()
        .any(|existing| existing.trim().to_lowercase() == normalized.to_lowercase())
    {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::Duplicate,
        });
    }

    issues
}

/// RAG 제외 확장자 입력을 위한 문제 목록을 계산한다.
fn analyze_exclude_extension_issues(
    trimmed: &str,
    normalized: &str,
    existing_exts: &[String],
) -> Vec<ExcludeInputValidationIssue> {
    let mut issues = Vec::new();

    if normalized.is_empty() {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::Empty,
        });
        return issues;
    }

    if normalized != trimmed {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Warning,
            code: ExcludeValidationCode::Trimmed,
        });
    }

    if trimmed.contains(',') {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::Comma,
        });
    }

    if trimmed.starts_with('.') {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Warning,
            code: ExcludeValidationCode::ExtensionLeadingDot,
        });
    }

    if !is_valid_exclude_extension(normalized) {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::ExtensionInvalid,
        });
    }

    if existing_exts
        .iter()
        .any(|existing| existing.trim().to_lowercase() == normalized.to_lowercase())
    {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::Duplicate,
        });
    }

    if is_protected_rag_document_extension(normalized) {
        issues.push(ExcludeInputValidationIssue {
            level: ExcludeValidationLevel::Error,
            code: ExcludeValidationCode::ExtensionProtectedDocument,
        });
    }

    issues
}

/// 주어진 확장자가 마크다운 핵심 문서 확장자인지 판별한다.
fn is_protected_rag_document_extension(extension: &str) -> bool {
    PROTECTED_RAG_DOCUMENT_EXTENSIONS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(extension))
}

/// 제외 확장자 입력에서 추천/수락 가능한 값인지 판별한다.
fn is_recommendable_rag_exclude_extension_for_validation(extension: &str) -> bool {
    !extension.is_empty() && !is_protected_rag_document_extension(extension)
}

/// 제외 확장자 입력이 유효한 토큰 형식인지 판별한다.
fn is_valid_exclude_extension(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }

    if !value
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
    {
        return false;
    }

    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

/// 제외 입력 검증 결과의 심각도 레벨.
#[derive(Clone, Copy)]
enum ExcludeValidationLevel {
    /// 처리 중단을 요구하는 에러.
    Error,
    /// 경고성 제안만 남기는 경고.
    Warning,
}

impl ExcludeValidationLevel {
    /// JSON 직렬화용 문자열 토큰을 반환한다.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
        }
    }
}

/// 제외 입력 검증 결과의 코드.
#[derive(Clone, Copy)]
enum ExcludeValidationCode {
    /// 공백 입력.
    Empty,
    /// 앞뒤 공백 정리 제안.
    Trimmed,
    /// 구분자 오염.
    Comma,
    /// 경로 백슬래시 사용 경고.
    PathBackslash,
    /// 선행 경로 구분자 경고.
    PathLeadingSlash,
    /// 중복 값.
    Duplicate,
    /// 확장자 선행 점 경고.
    ExtensionLeadingDot,
    /// 유효하지 않은 확장자 규칙.
    ExtensionInvalid,
    /// 마크다운 핵심 확장자 제외 차단.
    ExtensionProtectedDocument,
}

impl ExcludeValidationCode {
    /// JSON 직렬화용 문자열 토큰을 반환한다.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Trimmed => "trimmed",
            Self::Comma => "comma",
            Self::PathBackslash => "path-backslash",
            Self::PathLeadingSlash => "path-leading-slash",
            Self::Duplicate => "duplicate",
            Self::ExtensionLeadingDot => "extension-leading-dot",
            Self::ExtensionInvalid => "extension-invalid",
            Self::ExtensionProtectedDocument => "extension-protected-document",
        }
    }
}

/// `validate_exclude_*` 경로/확장자 계약에 쓰이는 단건 이슈.
#[derive(Clone, Copy)]
struct ExcludeInputValidationIssue {
    /// 이슈 심각도.
    level: ExcludeValidationLevel,
    /// 이슈 코드.
    code: ExcludeValidationCode,
}

impl ExcludeInputValidationIssue {
    /// JSON 값으로 변환한다.
    fn to_json_value(self) -> JsonValue {
        let mut issue = JsonMap::new();
        issue.insert(
            "level".to_owned(),
            JsonValue::String(self.level.as_str().to_owned()),
        );
        issue.insert(
            "code".to_owned(),
            JsonValue::String(self.code.as_str().to_owned()),
        );
        JsonValue::Object(issue)
    }
}

/// 제외 입력 검증 결과를 JSON 문자열로 직렬화한다.
fn serialize_exclude_validation_result(
    normalized: &str,
    issues: &[ExcludeInputValidationIssue],
) -> String {
    let valid = issues
        .iter()
        .all(|issue| !matches!(issue.level, ExcludeValidationLevel::Error));
    let mut output = JsonMap::new();
    output.insert(
        "normalized".to_owned(),
        JsonValue::String(normalized.to_owned()),
    );
    output.insert(
        "issues".to_owned(),
        JsonValue::Array(issues.iter().map(|issue| issue.to_json_value()).collect()),
    );
    output.insert("valid".to_owned(), JsonValue::Bool(valid));

    JsonValue::Object(output).to_string()
}

/// `GraphRAG` entity 이름을 비교 가능한 형태로 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_entity_name(name: &str) -> String {
    normalize_graph_entity_name(name)
}

/// `GraphRAG` extraction 이름을 비교 가능한 형태로 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_graph_name(name: &str) -> String {
    normalize_graph_entity_name(name)
}

/// `GraphRAG` extraction confidence를 `[0, 1]` 범위로 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_graph_confidence_or_default(confidence: f64) -> f64 {
    if !confidence.is_finite() {
        return 0.5;
    }
    if matches!(confidence.partial_cmp(&0.0), Some(std::cmp::Ordering::Less)) {
        return 0.0;
    }
    if matches!(
        confidence.partial_cmp(&1.0),
        Some(std::cmp::Ordering::Greater)
    ) {
        return 1.0;
    }
    confidence
}

/// `GraphRAG` record id part를 기존 extraction ID 규칙으로 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn sanitize_graph_id_part(part: &str) -> String {
    sanitize_graph_id_part_value(part)
}

/// `GraphRAG` record id를 기존 extraction ID 규칙으로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn create_graph_id(parts: &str) -> String {
    parts
        .split('\0')
        .map(sanitize_graph_id_part_value)
        .collect::<Vec<_>>()
        .join("::")
}

/// `GraphRAG` LLM 응답에서 JSON object 텍스트를 추출한다. 실패하면 빈 문자열을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn extract_json_object_text(raw_response: &str) -> String {
    extract_json_object(raw_response)
        .unwrap_or_default()
        .to_owned()
}

/// `delta` 객체의 구조화 reasoning 필드를 추출한다.
#[must_use]
#[wasm_bindgen]
pub fn extract_structured_reasoning(delta_json: &str) -> String {
    let Ok(delta) = serde_json::from_str::<JsonValue>(delta_json) else {
        return String::new();
    };
    let Some(delta_object) = delta.as_object() else {
        return String::new();
    };

    for key in ["reasoning", "reasoning_content", "thinking"] {
        let Some(value) = delta_object.get(key).and_then(JsonValue::as_str) else {
            continue;
        };
        if !value.is_empty() {
            return value.to_owned();
        }
    }
    String::new()
}

/// `<think>`류 태그를 reasoning/content로 분할한다.
#[must_use]
#[wasm_bindgen]
pub fn split_reasoning_tags_json(content: &str) -> String {
    serialize_reasoning_chunk_parts(&split_reasoning_chunks(content))
}

/// 구조화 reasoning과 태그 reasoning을 병합해 content/reasoning을 만들고 JSON으로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_reasoning_chunk_json(content: &str, reasoning: &str) -> String {
    let split = split_reasoning_chunks(content);
    let mut merged_reasoning = Vec::<String>::new();
    let normalized_reasoning = reasoning.trim();
    if !normalized_reasoning.is_empty() {
        merged_reasoning.push(normalized_reasoning.to_owned());
    }
    if !split.reasoning.is_empty() {
        merged_reasoning.push(split.reasoning);
    }
    let reasoning_text = if merged_reasoning.is_empty() {
        String::new()
    } else {
        merged_reasoning.join("\n\n")
    };

    serialize_reasoning_chunk_content(split.content, reasoning_text)
}

/// reasoning 태그를 분할한 결과.
#[derive(Debug)]
struct ReasoningChunk {
    /// 태그에서 제외된 사용자에게 표시될 메시지 본문.
    content: String,
    /// reasoning 태그에서 추출된 추론 텍스트.
    reasoning: String,
}

/// 문자열 전체에서 `<think>`류 태그를 제거하고 reasoning 본문을 분리한다.
fn split_reasoning_chunks(content: &str) -> ReasoningChunk {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return ReasoningChunk {
            content: String::new(),
            reasoning: String::new(),
        };
    }

    if let Some(chunk) = split_reasoning_chunks_with_paired_tags(trimmed) {
        return chunk;
    }
    if let Some(chunk) = split_reasoning_chunks_with_closing_only(trimmed) {
        return chunk;
    }
    if let Some(chunk) = split_reasoning_chunks_with_opening_only(trimmed) {
        return chunk;
    }

    ReasoningChunk {
        content: content.to_owned(),
        reasoning: String::new(),
    }
}

/// paired open/close reasoning 태그를 처리한다.
fn split_reasoning_chunks_with_paired_tags(trimmed: &str) -> Option<ReasoningChunk> {
    let open_tag_pattern = Regex::new(r"(?i)<(think|thinking|reasoning|thought)\b[^>]*>");
    let Ok(open_tags) = open_tag_pattern else {
        return None;
    };

    let mut reasoning_parts = Vec::<String>::new();
    let mut content_parts = Vec::<String>::new();
    let mut last_index = 0usize;
    for capture in open_tags.captures_iter(trimmed) {
        let Some(open_full) = capture.get(0) else {
            continue;
        };
        if open_full.start() < last_index {
            continue;
        }

        let Some(tag_name_match) = capture.get(1) else {
            continue;
        };
        let close_pattern = format!(r"(?i)</{}>", tag_name_match.as_str());
        let Ok(close_tags) = Regex::new(&close_pattern) else {
            continue;
        };
        let Some(close_match) = close_tags.find(&trimmed[open_full.end()..]) else {
            continue;
        };
        let close_start = open_full.end() + close_match.start();
        let close_end = open_full.end() + close_match.end();

        if let Some(before_raw) = trimmed.get(last_index..open_full.start()) {
            let before = before_raw.trim();
            if !before.is_empty() {
                content_parts.push(before.to_owned());
            }
        }
        let reasoning = trimmed[open_full.end()..close_start].trim();
        if !reasoning.is_empty() {
            reasoning_parts.push(reasoning.to_owned());
        }
        last_index = close_end;
    }

    if reasoning_parts.is_empty() {
        return None;
    }
    if let Some(remaining_raw) = trimmed
        .get(last_index..)
        .filter(|tail| !tail.trim().is_empty())
    {
        content_parts.push(remaining_raw.trim().to_owned());
    }
    Some(ReasoningChunk {
        content: content_parts.join("\n\n"),
        reasoning: reasoning_parts.join("\n\n"),
    })
}

/// 닫는 태그만 들어왔을 때 앞쪽 텍스트를 reasoning으로 이동한다.
fn split_reasoning_chunks_with_closing_only(trimmed: &str) -> Option<ReasoningChunk> {
    let mut content = String::new();

    let closing_pattern = Regex::new("(?is)([\\s\\S]*?)</(think|thinking|reasoning|thought)>");
    let Ok(closing_tag) = closing_pattern else {
        return None;
    };
    if let Some(capture) = closing_tag.captures(trimmed) {
        let reasoning = capture.get(1).map_or("", |m| m.as_str()).trim().to_owned();
        if let Some(reasoning_match) = capture.get(0)
            && let Some(tail) = trimmed.get(reasoning_match.end()..)
        {
            let after = tail.trim();
            if !after.is_empty() {
                content.push_str(after);
            }
        }
        return Some(ReasoningChunk { content, reasoning });
    }
    None
}

/// 여는 태그만 있을 때 본문 뒤쪽을 content로 이동한다.
fn split_reasoning_chunks_with_opening_only(trimmed: &str) -> Option<ReasoningChunk> {
    let mut content = String::new();
    let opening_pattern =
        Regex::new("(?is)<(think|thinking|reasoning|thought)\\b[^>]*>([\\s\\S]*)");
    let Ok(opening_tag) = opening_pattern else {
        return None;
    };
    if let Some(capture) = opening_tag.captures(trimmed) {
        let reasoning = capture
            .get(2)
            .map_or(String::new(), |m| m.as_str().trim().to_owned());
        if let Some(opening_match) = capture.get(0)
            && let Some(prefix) = trimmed.get(..opening_match.start())
        {
            let prefix = prefix.trim();
            if !prefix.is_empty() {
                content.push_str(prefix);
            }
        }
        return Some(ReasoningChunk { content, reasoning });
    }
    None
}

/// reasoning 분할 결과를 JSON 직렬화한다.
fn serialize_reasoning_chunk_parts(chunk: &ReasoningChunk) -> String {
    let mut fields: Vec<String> = Vec::new();
    fields.push(format!(
        "\"content\":\"{}\"",
        escape_json_string(&chunk.content)
    ));
    if !chunk.reasoning.is_empty() {
        fields.push(format!(
            "\"reasoning\":\"{}\"",
            escape_json_string(&chunk.reasoning),
        ));
    }
    format!("{{{}}}", fields.join(","))
}

/// content/reasoning pair를 JSON 문자열로 직렬화한다.
fn serialize_reasoning_chunk_content(content: String, reasoning: String) -> String {
    serialize_reasoning_chunk_parts(&ReasoningChunk { content, reasoning })
}

/// `GraphRAG` LLM 추출 JSON payload를 저장 가능한 graph fact payload로 정규화한다.
#[must_use]
#[wasm_bindgen]
pub fn normalize_extracted_graph_payload_json(json_text: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(json_text) else {
        return String::new();
    };
    let Some(normalized) = normalize_extracted_graph_payload(&value) else {
        return String::new();
    };
    serialize_normalized_graph_payload(&normalized)
}

/// `GraphRAG` LLM raw 응답을 graph extraction parse 결과로 변환한다.
#[must_use]
#[wasm_bindgen]
pub fn parse_extracted_graph_payload_json(raw_response: &str) -> String {
    let Some(json_text) = extract_json_object(raw_response) else {
        return serialize_graph_payload_parse_rejection(
            "invalid-json",
            &JsonValue::String(raw_response.to_owned()),
        );
    };
    let Ok(value) = serde_json::from_str::<JsonValue>(json_text) else {
        return serialize_graph_payload_parse_rejection(
            "invalid-json",
            &JsonValue::String(raw_response.to_owned()),
        );
    };
    let Some(normalized) = normalize_extracted_graph_payload(&value) else {
        return serialize_graph_payload_parse_rejection("schema-shape-mismatch", &value);
    };
    if normalized.raw_fact_count > 0 && valid_graph_fact_count(&normalized) == 0 {
        return serialize_graph_payload_parse_rejection("schema-shape-mismatch", &value);
    }
    serialize_graph_payload_parse_success(&normalized)
}

/// 현재 Graph extraction parser/normalizer wire contract version을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn graph_extraction_contract_version() -> u32 {
    GRAPH_EXTRACTION_CONTRACT_VERSION_EXPORT.load(Ordering::Relaxed)
}

/// Ontology relation type/source/target 조합을 검증한다.
#[must_use]
#[wasm_bindgen]
pub fn validate_ontology_relation(
    entity_type_ids: &str,
    relation_type_ids: &str,
    relation_source_type_rows: &str,
    relation_target_type_rows: &str,
    relation_type_id: &str,
    source_type_id: &str,
    target_type_id: &str,
) -> String {
    let entity_type_ids = split_entity_wire_values(entity_type_ids).collect::<Vec<_>>();
    let relation_type_ids = split_entity_wire_values(relation_type_ids).collect::<Vec<_>>();
    let relation_source_type_rows = split_ontology_relation_type_rows(relation_source_type_rows);
    let relation_target_type_rows = split_ontology_relation_type_rows(relation_target_type_rows);
    let Some(relation_index) = relation_type_ids
        .iter()
        .position(|candidate| *candidate == relation_type_id)
    else {
        return "unknown-relation-type".to_owned();
    };

    if !is_known_ontology_entity_type(&entity_type_ids, source_type_id)
        || !is_known_ontology_entity_type(&entity_type_ids, target_type_id)
    {
        return "unknown-entity-type".to_owned();
    }

    let source_type_row = relation_source_type_rows
        .get(relation_index)
        .copied()
        .unwrap_or_default();
    let target_type_row = relation_target_type_rows
        .get(relation_index)
        .copied()
        .unwrap_or_default();
    if !ontology_type_row_contains(source_type_row, source_type_id)
        || !ontology_type_row_contains(target_type_row, target_type_id)
    {
        return "relation-domain-range-mismatch".to_owned();
    }

    "valid".to_owned()
}

/// Ontology schema 정합성 오류 목록을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn validate_ontology_schema_json(schema_json: &str) -> String {
    let schema = serde_json::from_str::<JsonValue>(schema_json).ok();
    let Some(schema_obj) = schema.as_ref().and_then(JsonValue::as_object) else {
        return "[]".to_owned();
    };

    let mut errors = Vec::new();
    push_schema_field_errors(schema_obj, &mut errors);
    let (_, entity_type_id_set) = collect_ontology_entity_type_ids(schema_obj);
    push_ontology_entity_type_errors(schema_obj, &entity_type_id_set, &mut errors);
    push_ontology_relation_type_errors(schema_obj, &entity_type_id_set, &mut errors);
    serialize_json_array(
        &errors
            .into_iter()
            .map(JsonValue::String)
            .collect::<Vec<_>>(),
    )
}

/// MCP JSON 검증/포맷 처리의 결과를 직렬화 가능한 계약으로 보관한다.
struct McpJsonValidationPlan {
    /// 입력 JSON이 유효한 MCP 설정인지 나타낸다.
    valid: bool,
    /// 검증 성공 시 사용자 입력을 정규화해 보존한다.
    data: Option<JsonValue>,
    /// 실패 시 UI/로그에서 매핑할 오류 코드를 담는다.
    error_code: Option<String>,
    /// 실패한 서버 단위 검증에서 서버 이름을 추적한다.
    server_name: Option<String>,
    /// 파싱 오류의 경우 원본 메시지를 보존한다.
    parse_error: Option<String>,
}

/// MCP stdio server 설정 JSON을 스키마 기반으로 검증한다.
#[must_use]
#[wasm_bindgen]
pub fn validate_mcp_json(mcp_json_text: &str) -> String {
    let plan = analyze_mcp_json(mcp_json_text);
    serialize_mcp_json_validation_plan(&plan)
}

/// MCP JSON 설정을 검증 가능한 JSON 문자열로 다시 포맷한다.
#[must_use]
#[wasm_bindgen]
pub fn format_mcp_json(mcp_json_text: &str) -> String {
    let plan = analyze_mcp_json(mcp_json_text);
    if !plan.valid {
        return String::new();
    }
    let Some(data) = plan.data else {
        return String::new();
    };
    serde_json::to_string_pretty(&data).unwrap_or_default()
}

/// MCP stdio server 설정 JSON의 검증 계약을 계산한다.
fn analyze_mcp_json(mcp_json_text: &str) -> McpJsonValidationPlan {
    let parsed = match serde_json::from_str::<JsonValue>(mcp_json_text) {
        Ok(value) => value,
        Err(error) => {
            return McpJsonValidationPlan {
                valid: false,
                data: None,
                error_code: Some("parse-error".to_owned()),
                server_name: None,
                parse_error: Some(format!("Invalid JSON: {error}")),
            };
        }
    };

    let Some(config) = parsed.as_object() else {
        return McpJsonValidationPlan {
            valid: false,
            data: None,
            error_code: Some("invalid-object".to_owned()),
            server_name: None,
            parse_error: None,
        };
    };

    let Some(mcp_servers) = config.get("mcpServers") else {
        return McpJsonValidationPlan {
            valid: false,
            data: None,
            error_code: Some("missing-mcp-servers".to_owned()),
            server_name: None,
            parse_error: None,
        };
    };
    let Some(mcp_servers) = mcp_servers.as_object() else {
        return McpJsonValidationPlan {
            valid: false,
            data: None,
            error_code: Some("invalid-mcp-servers".to_owned()),
            server_name: None,
            parse_error: None,
        };
    };

    for (name, server) in mcp_servers {
        let Some(server_obj) = server.as_object() else {
            return McpJsonValidationPlan {
                valid: false,
                data: None,
                error_code: Some("invalid-server-value".to_owned()),
                server_name: Some(name.clone()),
                parse_error: None,
            };
        };

        if !server_obj.contains_key("command") {
            return McpJsonValidationPlan {
                valid: false,
                data: None,
                error_code: Some("server-needs-command".to_owned()),
                server_name: Some(name.clone()),
                parse_error: None,
            };
        }

        if let Some(args) = server_obj.get("args")
            && !args.is_array()
        {
            return McpJsonValidationPlan {
                valid: false,
                data: None,
                error_code: Some("invalid-args".to_owned()),
                server_name: Some(name.clone()),
                parse_error: None,
            };
        }

        if let Some(env) = server_obj.get("env")
            && !env.is_object()
        {
            return McpJsonValidationPlan {
                valid: false,
                data: None,
                error_code: Some("invalid-env".to_owned()),
                server_name: Some(name.clone()),
                parse_error: None,
            };
        }
    }

    McpJsonValidationPlan {
        valid: true,
        data: Some(parsed),
        error_code: None,
        server_name: None,
        parse_error: None,
    }
}

/// MCP JSON 검증 계획을 외부 바인딩이 소비할 수 있는 JSON 문자열로 직렬화한다.
fn serialize_mcp_json_validation_plan(plan: &McpJsonValidationPlan) -> String {
    let mut output = JsonMap::new();
    output.insert("valid".to_owned(), JsonValue::Bool(plan.valid));

    if plan.valid {
        if let Some(data) = &plan.data {
            output.insert("data".to_owned(), data.clone());
        }
    } else {
        output.insert(
            "errorCode".to_owned(),
            JsonValue::String(
                plan.error_code
                    .clone()
                    .unwrap_or_else(|| "invalid-json".to_owned()),
            ),
        );
        if let Some(server_name) = &plan.server_name {
            output.insert(
                "serverName".to_owned(),
                JsonValue::String(server_name.clone()),
            );
        }
        if let Some(parse_error) = &plan.parse_error {
            output.insert("message".to_owned(), JsonValue::String(parse_error.clone()));
        }
    }

    JsonValue::Object(output).to_string()
}

/// `entityTypes`에서 id 목록과 빠른 조회용 id set을 만든다.
fn collect_ontology_entity_type_ids(
    schema_obj: &serde_json::Map<String, JsonValue>,
) -> (Vec<&str>, std::collections::HashSet<&str>) {
    let mut ids = Vec::new();
    let mut id_set = std::collections::HashSet::new();
    let entity_types: &[JsonValue] =
        match schema_obj.get("entityTypes").and_then(JsonValue::as_array) {
            Some(entity_types) => entity_types.as_slice(),
            None => &[],
        };

    for entity_type in entity_types.iter().filter_map(JsonValue::as_object) {
        let entity_type_id = entity_type
            .get("id")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        ids.push(entity_type_id);
        id_set.insert(entity_type_id);
    }

    (ids, id_set)
}

/// `relationTypes`에서 relation id 목록을 추출한다.
fn collect_ontology_relation_type_ids(relation_types: &[&JsonValue]) -> Vec<String> {
    relation_types
        .iter()
        .filter_map(|relation_type| relation_type.get("id").and_then(JsonValue::as_str))
        .map(ToString::to_string)
        .collect()
}

/// schema-level 필수/형식 검증 오류를 추가한다.
fn push_schema_field_errors(
    schema_obj: &serde_json::Map<String, JsonValue>,
    errors: &mut Vec<String>,
) {
    if schema_obj
        .get("id")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .is_empty()
    {
        errors.push("schema.id is required".to_owned());
    }
    if schema_obj
        .get("name")
        .and_then(JsonValue::as_str)
        .unwrap_or("")
        .is_empty()
    {
        errors.push("schema.name is required".to_owned());
    }
    if !matches!(schema_obj.get("version").and_then(JsonValue::as_u64), Some(version) if version >= 1)
    {
        errors.push("schema.version must be a positive integer".to_owned());
    }
}

/// entity type row에서 id/parent type 참조 오류를 추가한다.
fn push_ontology_entity_type_errors(
    schema_obj: &serde_json::Map<String, JsonValue>,
    entity_type_id_set: &std::collections::HashSet<&str>,
    errors: &mut Vec<String>,
) {
    for entity_type in schema_obj
        .get("entityTypes")
        .and_then(JsonValue::as_array)
        .into_iter()
        .flatten()
        .filter_map(JsonValue::as_object)
    {
        let entity_type_id = entity_type
            .get("id")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        if entity_type_id.is_empty() {
            errors.push("entityType.id is required".to_owned());
        }
        if let Some(parent_type_id) = entity_type.get("parentTypeId").and_then(JsonValue::as_str)
            && !parent_type_id.is_empty()
            && !entity_type_id_set.contains(parent_type_id)
        {
            errors.push(format!("unknown parent entity type: {parent_type_id}"));
        }
    }
}

/// relation type row에서 inverse/source/target 타입 참조 오류를 추가한다.
fn push_ontology_relation_type_errors(
    schema_obj: &serde_json::Map<String, JsonValue>,
    entity_type_id_set: &std::collections::HashSet<&str>,
    errors: &mut Vec<String>,
) {
    let relation_types = schema_obj
        .get("relationTypes")
        .and_then(JsonValue::as_array)
        .map(|relation_types| relation_types.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    let relation_type_ids = collect_ontology_relation_type_ids(&relation_types);

    for relation_type in &relation_types {
        let Some(relation_type_obj) = relation_type.as_object() else {
            continue;
        };
        let relation_type_id = relation_type_obj
            .get("id")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        if relation_type_id.is_empty() {
            errors.push("relationType.id is required".to_owned());
        }

        if let Some(inverse_relation_type_id) = relation_type_obj
            .get("inverseRelationTypeId")
            .and_then(JsonValue::as_str)
            && !inverse_relation_type_id.is_empty()
            && !relation_type_ids
                .iter()
                .any(|id| id == inverse_relation_type_id)
        {
            errors.push(format!(
                "unknown inverse relation type: {inverse_relation_type_id}"
            ));
        }

        if let Some(source_type_ids) = relation_type_obj
            .get("sourceTypeIds")
            .and_then(JsonValue::as_array)
        {
            for source_type_id in source_type_ids {
                let source_type_id = source_type_id.as_str().unwrap_or("");
                if source_type_id != ONTOLOGY_ANY_ENTITY_TYPE
                    && !entity_type_id_set.contains(source_type_id)
                {
                    errors.push(format!("unknown relation source type: {source_type_id}"));
                }
            }
        }

        if let Some(target_type_ids) = relation_type_obj
            .get("targetTypeIds")
            .and_then(JsonValue::as_array)
        {
            for target_type_id in target_type_ids {
                let target_type_id = target_type_id.as_str().unwrap_or("");
                if target_type_id != ONTOLOGY_ANY_ENTITY_TYPE
                    && !entity_type_id_set.contains(target_type_id)
                {
                    errors.push(format!("unknown relation target type: {target_type_id}"));
                }
            }
        }
    }
}

/// `GraphRAG` entity merge score를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn score_entity_match_or_nan(
    candidate_names: &str,
    existing_names: &str,
    descriptions: &str,
    evidence_ids: &str,
    same_type: bool,
    embedding_score: f64,
) -> f64 {
    let Some((existing_description, candidate_description)) = descriptions.split_once('\u{1f}')
    else {
        return f64::NAN;
    };
    let Some((existing_evidence_ids, candidate_evidence_ids)) = evidence_ids.split_once('\u{1f}')
    else {
        return f64::NAN;
    };
    let candidate_names = split_entity_wire_values(candidate_names)
        .map(normalize_graph_entity_name)
        .collect::<Vec<_>>();
    let existing_names = split_entity_wire_values(existing_names)
        .map(normalize_graph_entity_name)
        .collect::<Vec<_>>();

    if has_string_intersection(&candidate_names, &existing_names) {
        return 1.0;
    }

    let name_score = max_entity_name_similarity(&candidate_names, &existing_names);
    let alias_score = max_entity_alias_containment_score(&candidate_names, &existing_names);
    let description_score = entity_jaccard_token_score(existing_description, candidate_description);
    let evidence_score =
        shared_entity_evidence_score(existing_evidence_ids, candidate_evidence_ids);
    let embedding_score = if embedding_score.is_finite() {
        embedding_score
    } else {
        0.0
    };
    let ontology_type_score = if same_type { 1.0 } else { 0.0 };
    let semantic_score = description_score.max(embedding_score);

    let weighted_score = clamp_unit_score(0.42_f64.mul_add(
        name_score,
        0.18_f64.mul_add(
            alias_score,
            0.22_f64.mul_add(
                semantic_score,
                0.18_f64.mul_add(evidence_score, 0.08 * ontology_type_score),
            ),
        ),
    ));
    let semantic_boost = if same_type && embedding_score >= 0.92 && description_score >= 0.5 {
        0.74
    } else {
        0.0
    };

    weighted_score.max(semantic_boost)
}

/// `GraphRAG` entity id를 기존 resolver 규칙으로 만든다.
#[must_use]
#[wasm_bindgen]
pub fn create_entity_id(ontology_schema_id: &str, type_id: &str, canonical_name: &str) -> String {
    let canonical_normalized = normalize_graph_entity_name(canonical_name).replace(' ', "-");
    format!(
        "entity::{}::{}::{}",
        sanitize_graph_id_part_value(ontology_schema_id),
        sanitize_graph_id_part_value(type_id),
        sanitize_graph_id_part_value(&canonical_normalized),
    )
}

/// `GraphRAG` entity resolution 후보 점수에서 최종 merge plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_entity_resolution_json(input_json: &str) -> String {
    let Some(input) = parse_entity_resolution_input_json(input_json) else {
        return String::new();
    };
    let plan = plan_entity_resolution(&input);
    serialize_entity_resolution_plan_json(&plan)
}

/// 질문과 entity name 목록에서 언급된 `GraphRAG` entity index/score 쌍을 찾는다.
#[must_use]
#[wasm_bindgen]
pub fn find_mentioned_entity_matches(
    question: &str,
    ontology_schema_id: &str,
    entity_schema_ids: &str,
    canonical_names: &str,
    aliases_by_entity: &str,
    entity_hints: &str,
) -> Box<[f64]> {
    let schema_ids = split_entity_wire_values(entity_schema_ids).collect::<Vec<_>>();
    let canonical_names = split_entity_wire_values(canonical_names).collect::<Vec<_>>();
    let alias_rows = aliases_by_entity.split('\u{1f}').collect::<Vec<_>>();
    if schema_ids.len() != canonical_names.len() || schema_ids.len() != alias_rows.len() {
        return Box::default();
    }

    let normalized_question = normalize_graph_entity_name(question);
    let normalized_hints = split_entity_wire_values(entity_hints)
        .map(normalize_graph_entity_name)
        .filter(|hint| !hint.is_empty())
        .collect::<BTreeSet<_>>();
    let mut matches = Vec::<ScoredRow>::new();

    for (entity_index, ((schema_id, canonical_name), aliases)) in schema_ids
        .iter()
        .copied()
        .zip(canonical_names.iter().copied())
        .zip(alias_rows.iter().copied())
        .enumerate()
    {
        if schema_id != ontology_schema_id {
            continue;
        }
        let canonical_normalized = normalize_graph_entity_name(canonical_name);
        let mut names = Vec::new();
        if !canonical_normalized.is_empty() {
            names.push(canonical_normalized.clone());
        }
        for alias in split_entity_wire_values(aliases).map(normalize_graph_entity_name) {
            if !alias.is_empty() {
                names.push(alias);
            }
        }

        let mut best_score = 0.0_f64;
        for name in names {
            if normalized_hints.contains(&name) {
                best_score = best_score.max(1.0);
            }
            if is_safe_entity_mention(&normalized_question, &name) {
                let mention_score = if name == canonical_normalized {
                    0.94
                } else {
                    0.88
                };
                best_score = best_score.max(mention_score);
            }
        }

        if best_score > 0.0 {
            matches.push(ScoredRow {
                row_index: entity_index,
                score: best_score,
            });
        }
    }

    matches.sort_by(compare_scored_rows_descending);
    encode_scored_rows(&matches)
}

/// deterministic `GraphRAG` query plan을 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_query_json(question: &str) -> String {
    let normalized = question.to_lowercase();
    let entity_hints = extract_graph_query_entity_hints(question);
    if contains_any(&normalized, &["근거", "출처", "어디", "source", "evidence"]) {
        return serialize_graph_query_plan_json("source-seeking", "local", 1, true, &entity_hints);
    }
    if contains_any(
        &normalized,
        &[
            "반복",
            "핵심 주제",
            "전체",
            "주제",
            "theme",
            "thematic",
            "community",
        ],
    ) {
        return serialize_graph_query_plan_json("thematic", "global", 1, false, &entity_hints);
    }
    if contains_any(
        &normalized,
        &[
            "관계", "관련", "연결", "대립", "협력", "relation", "related",
        ],
    ) {
        return serialize_graph_query_plan_json("relational", "local", 2, false, &entity_hints);
    }
    if contains_any(&normalized, &["차이", "비교", "compare", "difference"]) {
        return serialize_graph_query_plan_json("comparative", "hybrid", 2, false, &entity_hints);
    }
    if contains_any(&normalized, &["누구", "무엇", "어떤", "who", "what"]) {
        return serialize_graph_query_plan_json("factual", "local", 1, false, &entity_hints);
    }
    serialize_graph_query_plan_json("ordinary-rag", "none", 0, false, &entity_hints)
}

/// `GraphRAG` query mode와 planner 결과에서 실행 action을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_query_execution_json(
    configured_mode: &str,
    planned_mode: &str,
    evidence_first: bool,
) -> String {
    let Some(plan) = plan_graph_query_execution(configured_mode, planned_mode, evidence_first)
    else {
        return String::new();
    };
    serialize_graph_query_execution_plan_json(&plan)
}

/// `GraphRAG` relation schema id matching index plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_schema_relation_indices_json(
    relation_schema_ids_json: &str,
    ontology_schema_id: &str,
) -> String {
    let Some(relation_schema_ids) = parse_raw_string_array_json(relation_schema_ids_json) else {
        return String::new();
    };
    let selected = plan_schema_id_indices(&relation_schema_ids, ontology_schema_id);
    serialize_usize_array_json(&selected)
}

/// `GraphRAG` community schema id matching index plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_schema_community_indices_json(
    community_schema_ids_json: &str,
    ontology_schema_id: &str,
) -> String {
    let Some(community_schema_ids) = parse_raw_string_array_json(community_schema_ids_json) else {
        return String::new();
    };
    let selected = plan_schema_id_indices(&community_schema_ids, ontology_schema_id);
    serialize_usize_array_json(&selected)
}

/// `GraphRAG` community replacement에서 삭제할 기존 community id plan을 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_community_replacement_delete_ids_json(
    communities_json: &str,
    ontology_schema_id: &str,
) -> String {
    let Some(communities) = parse_graph_community_replacement_records_json(communities_json) else {
        return String::new();
    };
    let delete_ids = communities
        .iter()
        .filter(|community| community.ontology_schema_id == ontology_schema_id)
        .map(|community| community.id.clone())
        .collect::<Vec<_>>();
    serialize_string_array_json(&delete_ids)
}

/// `GraphRAG` LLM planner raw 응답을 graph query plan JSON으로 변환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_graph_query_response_json(raw_response: &str, fallback_question: &str) -> String {
    let Some(json_text) = extract_json_object(raw_response) else {
        return plan_graph_query_json(fallback_question);
    };
    let Ok(value) = serde_json::from_str::<JsonValue>(json_text) else {
        return plan_graph_query_json(fallback_question);
    };
    let Some(object) = value.as_object() else {
        return plan_graph_query_json(fallback_question);
    };

    serialize_normalized_graph_query_plan_from_object(object)
}

/// JS wrapper가 재사용할 수 있는 normalized vector runtime index.
#[wasm_bindgen]
pub struct VectorRuntimeIndex {
    /// vector dimension.
    dimensions: usize,
    /// original row count.
    row_count: usize,
    /// row-major normalized vector matrix.
    normalized_vectors: Vec<f32>,
    /// zero/invalid vector를 제외하기 위한 row별 validity flag.
    valid_rows: Vec<bool>,
}

#[wasm_bindgen]
impl VectorRuntimeIndex {
    /// flattened row-major vector matrix로 runtime index를 만든다.
    #[must_use]
    #[wasm_bindgen(constructor)]
    pub fn new(vectors: &[f32], dimensions: usize) -> Self {
        let row_count = if dimensions == 0 {
            0
        } else {
            vectors.len().checked_div(dimensions).unwrap_or_default()
        };
        if dimensions == 0 || !vectors.len().is_multiple_of(dimensions) {
            return Self {
                dimensions: 0,
                row_count: 0,
                normalized_vectors: Vec::new(),
                valid_rows: Vec::new(),
            };
        }

        let mut normalized_vectors = Vec::with_capacity(vectors.len());
        let mut valid_rows = Vec::with_capacity(row_count);
        for vector in vectors.chunks_exact(dimensions) {
            let valid = push_normalized_f32_row(vector, &mut normalized_vectors);
            valid_rows.push(valid);
        }

        Self {
            dimensions,
            row_count,
            normalized_vectors,
            valid_rows,
        }
    }

    /// original row count를 반환한다.
    #[must_use]
    pub fn row_count(&self) -> usize {
        wasm_bridge_usize(self.row_count)
    }

    /// vector dimension을 반환한다.
    #[must_use]
    pub fn dimensions(&self) -> usize {
        wasm_bridge_usize(self.dimensions)
    }

    /// 모든 valid row에서 top-k row index/score pair를 반환한다.
    #[must_use]
    pub fn rank_top_k(&self, query: &[f32], top_k: usize) -> Box<[f64]> {
        self.rank_top_k_for_rows(query, None, top_k)
    }

    /// 지정된 row index 후보 안에서 top-k row index/score pair를 반환한다.
    #[must_use]
    pub fn rank_top_k_filtered(
        &self,
        query: &[f32],
        row_indices: &[u32],
        top_k: usize,
    ) -> Box<[f64]> {
        self.rank_top_k_for_rows(query, Some(row_indices), top_k)
    }

    /// top-k scoring 구현.
    fn rank_top_k_for_rows(
        &self,
        query: &[f32],
        row_indices: Option<&[u32]>,
        top_k: usize,
    ) -> Box<[f64]> {
        if top_k == 0 || self.dimensions == 0 || query.len() != self.dimensions {
            return Box::default();
        }
        let Some(normalized_query) = normalized_f32_row(query) else {
            return Box::default();
        };

        let mut scored = Vec::with_capacity(top_k);
        match row_indices {
            Some(indices) => {
                for row_index_raw in indices.iter().copied() {
                    let Some(row_index) = bounded_u32_index(row_index_raw, self.row_count) else {
                        continue;
                    };
                    self.push_runtime_score(row_index, &normalized_query, top_k, &mut scored);
                }
            }
            None => {
                for row_index in 0..self.row_count {
                    self.push_runtime_score(row_index, &normalized_query, top_k, &mut scored);
                }
            }
        }
        encode_scored_rows(&scored)
    }

    /// 단일 row score를 top-k 버퍼에 반영한다.
    fn push_runtime_score(
        &self,
        row_index: usize,
        normalized_query: &[f32],
        top_k: usize,
        scored: &mut Vec<ScoredRow>,
    ) {
        if !self.valid_rows.get(row_index).copied().unwrap_or(false) {
            return;
        }
        let offset = row_index.saturating_mul(self.dimensions);
        let Some(row) = self
            .normalized_vectors
            .get(offset..offset.saturating_add(self.dimensions))
        else {
            return;
        };
        let score = normalized_f32_dot(normalized_query, row);
        push_top_k_scored_row(scored, ScoredRow { row_index, score }, top_k);
    }
}

/// JS wrapper가 재사용할 수 있는 IVF ANN runtime index.
#[wasm_bindgen]
pub struct IvfRuntimeIndex {
    /// vector dimension.
    dimensions: usize,
    /// original row count.
    row_count: usize,
    /// cluster count.
    cluster_count: usize,
    /// row-major normalized vector matrix.
    normalized_vectors: Vec<f32>,
    /// zero/invalid vector를 제외하기 위한 row별 validity flag.
    valid_rows: Vec<bool>,
    /// row-major normalized centroid matrix.
    centroids: Vec<f32>,
    /// cluster별 original row index.
    clusters: Vec<Vec<usize>>,
}

#[wasm_bindgen]
impl IvfRuntimeIndex {
    /// flattened row-major vector matrix로 IVF runtime index를 만든다.
    #[must_use]
    #[wasm_bindgen(constructor)]
    pub fn new(
        vectors: &[f32],
        dimensions: usize,
        requested_cluster_count: usize,
        iterations: usize,
    ) -> Self {
        if dimensions == 0 || vectors.is_empty() || !vectors.len().is_multiple_of(dimensions) {
            return Self::empty();
        }
        let row_count = vectors.len().checked_div(dimensions).unwrap_or_default();
        let cluster_count = resolve_cluster_count(row_count, requested_cluster_count);
        if row_count == 0 || cluster_count == 0 {
            return Self::empty();
        }

        let mut normalized_vectors = Vec::with_capacity(vectors.len());
        let mut valid_rows = Vec::with_capacity(row_count);
        for vector in vectors.chunks_exact(dimensions) {
            valid_rows.push(push_normalized_f32_row(vector, &mut normalized_vectors));
        }

        let mut centroids =
            select_initial_f32_centroids(&normalized_vectors, dimensions, row_count, cluster_count);
        let mut assignments = assign_f32_vectors_to_centroids(
            &normalized_vectors,
            &valid_rows,
            &centroids,
            dimensions,
        );
        for _ in 0..iterations {
            centroids = recompute_f32_centroids(
                &normalized_vectors,
                &valid_rows,
                &assignments,
                &centroids,
                dimensions,
            );
            assignments = assign_f32_vectors_to_centroids(
                &normalized_vectors,
                &valid_rows,
                &centroids,
                dimensions,
            );
        }
        let clusters = build_f32_clusters(&assignments, cluster_count);

        Self {
            dimensions,
            row_count,
            cluster_count,
            normalized_vectors,
            valid_rows,
            centroids,
            clusters,
        }
    }

    /// 빈 IVF runtime index를 만든다.
    const fn empty() -> Self {
        Self {
            dimensions: 0,
            row_count: 0,
            cluster_count: 0,
            normalized_vectors: Vec::new(),
            valid_rows: Vec::new(),
            centroids: Vec::new(),
            clusters: Vec::new(),
        }
    }

    /// original row count를 반환한다.
    #[must_use]
    pub fn row_count(&self) -> usize {
        wasm_bridge_usize(self.row_count)
    }

    /// vector dimension을 반환한다.
    #[must_use]
    pub fn dimensions(&self) -> usize {
        wasm_bridge_usize(self.dimensions)
    }

    /// cluster count를 반환한다.
    #[must_use]
    pub fn cluster_count(&self) -> usize {
        wasm_bridge_usize(self.cluster_count)
    }

    /// centroid probe와 candidate scoring을 Rust 내부에서 수행해 top-k row index/score pair를 반환한다.
    #[must_use]
    pub fn query(&self, query: &[f32], top_k: usize, probe_count: usize) -> Box<[f64]> {
        if top_k == 0
            || self.dimensions == 0
            || self.cluster_count == 0
            || query.len() != self.dimensions
        {
            return Box::default();
        }
        let Some(normalized_query) = normalized_f32_row(query) else {
            return Box::default();
        };

        let resolved_probe_count = probe_count.clamp(1, self.cluster_count);
        let centroid_scores =
            self.rank_centroids_for_query(&normalized_query, resolved_probe_count);
        let mut scored = Vec::with_capacity(top_k);
        for centroid_score in centroid_scores {
            let Some(row_indices) = self.clusters.get(centroid_score.row_index) else {
                continue;
            };
            for row_index in row_indices {
                self.push_runtime_score(*row_index, &normalized_query, top_k, &mut scored);
            }
        }
        encode_scored_rows(&scored)
    }

    /// query와 가장 가까운 centroid를 top-k 버퍼로 고른다.
    fn rank_centroids_for_query(
        &self,
        normalized_query: &[f32],
        probe_count: usize,
    ) -> Vec<ScoredRow> {
        let mut scored = Vec::with_capacity(probe_count);
        for centroid_index in 0..self.cluster_count {
            let offset = centroid_index.saturating_mul(self.dimensions);
            let Some(centroid) = self
                .centroids
                .get(offset..offset.saturating_add(self.dimensions))
            else {
                continue;
            };
            let score = normalized_f32_dot(normalized_query, centroid);
            push_top_k_scored_row(
                &mut scored,
                ScoredRow {
                    row_index: centroid_index,
                    score,
                },
                probe_count,
            );
        }
        scored
    }

    /// 단일 row score를 top-k 버퍼에 반영한다.
    fn push_runtime_score(
        &self,
        row_index: usize,
        normalized_query: &[f32],
        top_k: usize,
        scored: &mut Vec<ScoredRow>,
    ) {
        if !self.valid_rows.get(row_index).copied().unwrap_or(false) {
            return;
        }
        let offset = row_index.saturating_mul(self.dimensions);
        let Some(row) = self
            .normalized_vectors
            .get(offset..offset.saturating_add(self.dimensions))
        else {
            return;
        };
        let score = normalized_f32_dot(normalized_query, row);
        push_top_k_scored_row(scored, ScoredRow { row_index, score }, top_k);
    }
}

/// JS wrapper가 재사용할 수 있는 BM25 runtime index.
#[wasm_bindgen]
pub struct Bm25RuntimeIndex {
    /// runtime BM25 index state.
    index: Bm25IndexData,
}

#[wasm_bindgen]
impl Bm25RuntimeIndex {
    /// 빈 BM25 runtime index를 만든다.
    #[must_use]
    #[wasm_bindgen(constructor)]
    pub fn new(tokenizer_version: u32) -> Self {
        Self {
            index: Bm25IndexData::empty(wasm_bridge_u32(tokenizer_version)),
        }
    }

    /// legacy 또는 compact JSON payload에서 runtime index를 만든다.
    #[must_use]
    pub fn from_json(payload: &str, fallback_tokenizer_version: u32) -> Self {
        let index = parse_bm25_index_json(payload)
            .unwrap_or_else(|| Bm25IndexData::empty(fallback_tokenizer_version));
        Self { index }
    }

    /// document가 하나 이상 있는지 반환한다.
    #[must_use]
    pub fn is_ready(&self) -> bool {
        !self.index.doc_lengths.is_empty()
    }

    /// tokenizer contract version을 반환한다.
    #[must_use]
    pub fn tokenizer_version(&self) -> u32 {
        wasm_bridge_u32(self.index.tokenizer_version)
    }

    /// tokenizer contract version이 최신인지 반환한다.
    #[must_use]
    pub fn is_tokenizer_current(&self, tokenizer_version: u32) -> bool {
        wasm_bridge_bool(self.index.tokenizer_version == tokenizer_version)
    }

    /// indexed document 수를 반환한다.
    #[must_use]
    pub fn total_docs(&self) -> usize {
        self.index.doc_lengths.len()
    }

    /// doc id에 대응되는 source path를 반환한다. 없으면 빈 문자열이다.
    #[must_use]
    pub fn source_path_for_doc(&self, doc_id: &str) -> String {
        self.index
            .doc_sources
            .get(doc_id)
            .cloned()
            .unwrap_or_default()
    }

    /// document 하나를 runtime index에 추가하거나 교체한다.
    pub fn add_document(
        &mut self,
        doc_id: &str,
        text: &str,
        source_path: &str,
        tokenizer_version: u32,
    ) {
        self.index.tokenizer_version = tokenizer_version;
        add_bm25_document(&mut self.index, doc_id, text, source_path);
    }

    /// 중복이 없다고 보장된 document 하나를 runtime index에 추가한다.
    pub fn add_new_document(
        &mut self,
        doc_id: &str,
        text: &str,
        source_path: &str,
        tokenizer_version: u32,
    ) {
        self.index.tokenizer_version = tokenizer_version;
        insert_bm25_document(&mut self.index, doc_id, text, source_path);
    }

    /// document 하나를 runtime index에서 제거한다.
    pub fn remove_document(&mut self, doc_id: &str, tokenizer_version: u32) {
        self.index.tokenizer_version = tokenizer_version;
        remove_bm25_document(&mut self.index, doc_id);
    }

    /// source path에 속한 document들을 runtime index에서 제거한다.
    pub fn remove_source(&mut self, source_path: &str, tokenizer_version: u32) {
        self.index.tokenizer_version = tokenizer_version;
        let doc_ids = self
            .index
            .doc_sources
            .iter()
            .filter_map(|(doc_id, source)| (source == source_path).then_some(doc_id.clone()))
            .collect::<Vec<_>>();
        for doc_id in doc_ids {
            remove_bm25_document(&mut self.index, &doc_id);
        }
    }

    /// query score 목록을 JSON 문자열로 반환한다.
    #[must_use]
    pub fn search_json(&self, query: &str) -> String {
        serialize_bm25_search_scores_json(&search_bm25_index(&self.index, query))
    }

    /// 상위 query score 목록만 JSON 문자열로 반환한다.
    #[must_use]
    pub fn search_top_json(&self, query: &str, limit: usize) -> String {
        serialize_bm25_search_scores_json(&search_bm25_index_top(&self.index, query, limit))
    }

    /// compact v3 JSON payload로 직렬화한다.
    #[must_use]
    pub fn to_json(&self) -> String {
        serialize_bm25_compact_index_json(&self.index)
    }
}

/// vector row와 cosine score.
struct ScoredRow {
    /// flattened matrix 안의 row index.
    row_index: usize,
    /// query와 row vector의 cosine score.
    score: f64,
}

/// retrieval candidate merge group.
struct RetrievalMergeGroup {
    /// TS wrapper가 부여한 entry key index.
    entry_index: u32,
    /// 이 group을 대표하는 첫 candidate index.
    first_candidate_index: usize,
    /// 이 entry에 속한 candidate index 목록.
    candidate_indexes: Vec<usize>,
    /// 첫 등장 순서를 보존한 source merge 결과.
    sources: Vec<RetrievalMergeSource>,
}

/// retrieval source merge result.
struct RetrievalMergeSource {
    /// retrieval source code.
    source_code: u8,
    /// source score. 값이 없으면 `NaN`.
    source_score: f64,
    /// source rank. 값이 없으면 `NaN`.
    rank: f64,
}

/// RAG query result score plan 입력.
struct QueryResultScoreInput {
    /// query vector와 candidate vector cosine score.
    cosine_score: f64,
    /// candidate BM25 score.
    bm25_score: f64,
    /// BM25 blend weight.
    bm25_weight: f64,
    /// BM25 index readiness.
    has_bm25: bool,
    /// source별 score.
    source_scores: BTreeMap<String, f64>,
    /// source별 rank.
    source_ranks: BTreeMap<String, f64>,
    /// candidate retrieval source names.
    retrieval_sources: Vec<String>,
}

/// RAG query result score plan 출력.
struct QueryResultScorePlan {
    /// vector/BM25 blended base score.
    combined_base: f64,
    /// source rank fusion score.
    rrf_score: f64,
    /// source-aware prior.
    source_prior: f64,
    /// graph/structural/evidence source score.
    source_evidence_score: f64,
    /// graph/structural/evidence best rank.
    best_evidence_rank: f64,
    /// graph or structural source flag.
    has_graph_or_structural_evidence: bool,
    /// strong graph or structural source flag.
    has_strong_graph_or_structural_evidence: bool,
    /// final combined score.
    combined_score: f64,
    /// machine-readable source selection reason.
    selection_reason: &'static str,
}

/// LLM reranker message candidate snapshot.
struct RerankMessageCandidate {
    /// candidate id.
    id: String,
    /// source path.
    source_path: String,
    /// optional heading label.
    heading: String,
    /// candidate text.
    text: String,
}

/// LLM reranker user payload candidate.
struct PlannedRerankCandidate {
    /// candidate id.
    id: String,
    /// candidate index.
    index: usize,
    /// source path.
    source_path: String,
    /// heading label.
    heading: String,
    /// truncated candidate text.
    text: String,
}

/// LLM reranker message content plan.
struct RerankMessagesPlan {
    /// system message content.
    system_content: String,
    /// user message content.
    user_content: String,
}

/// BM25 score hit.
#[derive(Clone)]
struct Bm25Hit {
    /// BM25 index document id.
    doc_id: String,
    /// stale document id repair에 사용할 source file path.
    source_path: String,
    /// BM25 score.
    score: f64,
    /// 원래 hit 순서.
    sequence: usize,
}

/// BM25 index JSON snapshot.
struct Bm25IndexData {
    /// tokenizer contract version.
    tokenizer_version: u32,
    /// term -> doc id -> term frequency.
    inverted: BTreeMap<String, BTreeMap<String, f64>>,
    /// doc id -> document token count.
    doc_lengths: BTreeMap<String, f64>,
    /// doc id -> source file path.
    doc_sources: BTreeMap<String, String>,
}

impl Bm25IndexData {
    /// 빈 BM25 index data를 만든다.
    const fn empty(tokenizer_version: u32) -> Self {
        Self {
            tokenizer_version,
            inverted: BTreeMap::new(),
            doc_lengths: BTreeMap::new(),
            doc_sources: BTreeMap::new(),
        }
    }
}

/// BM25 search score.
struct Bm25SearchScore {
    /// BM25 index document id.
    doc_id: String,
    /// BM25 score.
    score: f64,
}

/// 원래 검색 순서를 보존한 BM25 score.
struct RankedBm25SearchScore {
    /// 전체 BM25 score 목록에서의 원래 순서.
    sequence: usize,
    /// BM25 search score.
    score: Bm25SearchScore,
}

/// TS wrapper가 store에서 조회한 entry metadata.
struct Bm25Entry {
    /// vector entry id.
    id: String,
    /// vector entry file path.
    file_path: String,
    /// request compatibility predicate 결과.
    compatible: bool,
}

/// 최종 BM25 candidate entry 선택 plan.
struct Bm25CandidateResolution {
    /// `found` id lookup entry인지 `path` file-path lookup entry인지 구분한다.
    entry_set: &'static str,
    /// 해당 entry 배열 안의 index.
    entry_index: usize,
    /// top BM25 hit 대비 정규화 score.
    source_score: f64,
}

/// structural retrieval link edge.
struct StructuralLinkEdge {
    /// link source file path.
    source_path: String,
    /// resolved link target file path.
    target_path: String,
}

/// structural heading seed entry.
struct StructuralHeadingSeed {
    /// seed vector entry id.
    id: String,
    /// seed file path.
    file_path: String,
    /// seed start line.
    start_line: usize,
    /// seed end line.
    end_line: usize,
    /// seed heading label.
    heading: Option<String>,
}

/// structural candidate entry input.
struct StructuralEntry {
    /// vector entry id.
    id: String,
    /// vector entry file path.
    file_path: String,
    /// vector entry start line.
    start_line: usize,
    /// vector entry heading label.
    heading: Option<String>,
    /// request compatibility predicate result.
    compatible: bool,
}

/// Obsidian cached heading row.
#[derive(Clone)]
struct StructuralHeading {
    /// heading file path.
    file_path: String,
    /// heading start line.
    start_line: usize,
    /// heading level.
    level: usize,
}

/// structural heading range selected by a seed entry.
struct StructuralHeadingRange {
    /// file path.
    file_path: String,
    /// inclusive start line.
    start_line: usize,
    /// inclusive end line. `None` means file tail.
    end_line: Option<usize>,
    /// optional seed heading label gate.
    heading: Option<String>,
}

/// Graph extraction payload normalization 결과.
struct NormalizedGraphPayload {
    /// 정규화된 entity fact 목록.
    entities: Vec<JsonValue>,
    /// 정규화된 relation fact 목록.
    relations: Vec<JsonValue>,
    /// 정규화된 claim fact 목록.
    claims: Vec<JsonValue>,
    /// 입력에서 fact 후보로 본 raw item 수.
    raw_fact_count: usize,
}

/// Graph extraction entity item 목록과 top-level inference 여부.
struct GraphEntityItems<'a> {
    /// 정규화 대상 raw entity item.
    items: Vec<GraphPayloadItem<'a>>,
    /// `entities` field 없이 top-level object에서 entity를 추론했는지 여부.
    inferred_from_top_level: bool,
}

/// Graph extraction payload 안의 raw object item과 fallback name.
struct GraphPayloadItem<'a> {
    /// raw JSON value.
    value: &'a JsonValue,
    /// keyed object entry의 key를 fallback name으로 쓸 수 있는 경우.
    fallback_name: Option<&'a str>,
}

/// 높은 score 우선, 같은 score는 원래 row 순서 우선으로 정렬한다.
fn compare_scored_rows_descending(left: &ScoredRow, right: &ScoredRow) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.row_index.cmp(&right.row_index))
}

/// top-k 버퍼에 score row를 정렬 상태로 삽입한다.
fn push_top_k_scored_row(rows: &mut Vec<ScoredRow>, row: ScoredRow, top_k: usize) {
    if top_k == 0 || !row.score.is_finite() {
        return;
    }
    let insert_at = rows
        .iter()
        .position(|candidate| compare_scored_rows_descending(&row, candidate).is_lt())
        .unwrap_or(rows.len());
    if insert_at >= top_k {
        return;
    }
    rows.insert(insert_at, row);
    if rows.len() > top_k {
        rows.truncate(top_k);
    }
}

/// BM25 hit 정렬. 높은 score 우선, 같은 score는 검색 결과 원래 순서 우선이다.
fn compare_bm25_hits_descending(left: &Bm25Hit, right: &Bm25Hit) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.sequence.cmp(&right.sequence))
}

/// row index/score 구조를 WASM bridge용 flat pair로 인코딩한다.
fn encode_scored_rows(rows: &[ScoredRow]) -> Box<[f64]> {
    let mut pairs = Vec::with_capacity(rows.len().saturating_mul(2));
    for row in rows {
        if let Ok(index) = u32::try_from(row.row_index) {
            pairs.push(f64::from(index));
            pairs.push(row.score);
        }
    }
    pairs.into_boxed_slice()
}

/// 정규화된 질문 안에서 entity name이 안전한 단어 경계나 한국어 조사 앞에 등장하는지 확인한다.
fn is_safe_entity_mention(normalized_text: &str, normalized_name: &str) -> bool {
    if normalized_name.is_empty() {
        return false;
    }
    if normalized_name.chars().count() < 2 {
        return normalized_text
            .split(' ')
            .any(|part| part == normalized_name);
    }

    for (byte_index, _) in normalized_text.match_indices(normalized_name) {
        let prefix = normalized_text.get(..byte_index).unwrap_or_default();
        let left_boundary = prefix
            .chars()
            .next_back()
            .is_none_or(|character| !character.is_alphanumeric());
        if !left_boundary {
            continue;
        }

        let suffix_start = byte_index.saturating_add(normalized_name.len());
        let suffix = normalized_text.get(suffix_start..).unwrap_or_default();
        let right_boundary = suffix.is_empty()
            || suffix
                .chars()
                .next()
                .is_some_and(|character| !character.is_alphanumeric())
            || has_korean_particle_suffix(suffix);
        if right_boundary {
            return true;
        }
    }
    false
}

/// 정규화된 suffix가 한국어 조사로 시작하는지 확인한다.
fn has_korean_particle_suffix(suffix: &str) -> bool {
    KOREAN_PARTICLES
        .iter()
        .any(|particle| suffix.starts_with(particle))
}

/// normalized text가 후보 keyword 중 하나를 포함하는지 확인한다.
fn contains_any(normalized_text: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| normalized_text.contains(candidate))
}

/// 질문에서 기존 `TypeScript` fallback planner와 같은 Latin entity hint를 추출한다.
fn extract_graph_query_entity_hints(question: &str) -> Vec<String> {
    let mut hints = Vec::new();
    let mut byte_index = 0_usize;
    while byte_index < question.len() {
        let Some(suffix) = question.get(byte_index..) else {
            break;
        };
        let Some(character) = suffix.chars().next() else {
            break;
        };
        if character.is_ascii_uppercase() && has_latin_name_left_boundary(question, byte_index) {
            let (name, next_index) = read_latin_name_sequence(question, byte_index);
            if !name.is_empty() && !is_graph_query_keyword(&name) && !hints.contains(&name) {
                hints.push(name);
            }
            byte_index = next_index;
            continue;
        }
        byte_index = byte_index.saturating_add(character.len_utf8());
    }
    hints
}

/// Latin name token이 단어 안에서 시작하지 않았는지 확인한다.
fn has_latin_name_left_boundary(question: &str, byte_index: usize) -> bool {
    question
        .get(..byte_index)
        .and_then(|prefix| prefix.chars().next_back())
        .is_none_or(|character| !is_latin_name_character(character))
}

/// 대문자 시작 Latin token과 공백으로 이어진 다음 대문자 token들을 하나의 hint로 읽는다.
fn read_latin_name_sequence(question: &str, start_index: usize) -> (String, usize) {
    let (mut name, mut next_index) = read_latin_name_token(question, start_index);
    loop {
        let whitespace_start = next_index;
        let whitespace_end = consume_ascii_whitespace(question, whitespace_start);
        if whitespace_end == whitespace_start {
            break;
        }
        let Some(suffix) = question.get(whitespace_end..) else {
            break;
        };
        let Some(character) = suffix.chars().next() else {
            break;
        };
        if !character.is_ascii_uppercase() {
            break;
        }
        let (next_name, token_end) = read_latin_name_token(question, whitespace_end);
        if next_name.is_empty() {
            break;
        }
        name.push(' ');
        name.push_str(&next_name);
        next_index = token_end;
    }
    (name, next_index)
}

/// Latin name token 하나를 읽는다.
fn read_latin_name_token(question: &str, start_index: usize) -> (String, usize) {
    let mut output = String::new();
    let mut next_index = start_index;
    while next_index < question.len() {
        let Some(suffix) = question.get(next_index..) else {
            break;
        };
        let Some(character) = suffix.chars().next() else {
            break;
        };
        if !is_latin_name_character(character) {
            break;
        }
        output.push(character);
        next_index = next_index.saturating_add(character.len_utf8());
    }
    (output, next_index)
}

/// ASCII whitespace를 건너뛴다.
fn consume_ascii_whitespace(question: &str, start_index: usize) -> usize {
    let mut next_index = start_index;
    while next_index < question.len() {
        let Some(suffix) = question.get(next_index..) else {
            break;
        };
        let Some(character) = suffix.chars().next() else {
            break;
        };
        if !character.is_ascii_whitespace() {
            break;
        }
        next_index = next_index.saturating_add(character.len_utf8());
    }
    next_index
}

/// Latin entity hint token에 허용되는 문자.
const fn is_latin_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
}

/// query keyword는 entity hint에서 제외한다.
fn is_graph_query_keyword(value: &str) -> bool {
    matches!(
        value.to_lowercase().as_str(),
        "who"
            | "what"
            | "where"
            | "source"
            | "evidence"
            | "theme"
            | "community"
            | "compare"
            | "difference"
    )
}

/// 각 vector row를 가장 cosine score가 높은 centroid로 배정한다.
fn assign_vectors_to_centroids(
    vectors: &[f64],
    centroids: &[f64],
    dimensions: usize,
) -> Vec<usize> {
    let vector_count = vectors.len().checked_div(dimensions).unwrap_or_default();
    let mut assignments = Vec::with_capacity(vector_count);
    for vector in vectors.chunks_exact(dimensions) {
        assignments.push(assign_vector_to_centroid(vector, centroids, dimensions));
    }
    assignments
}

/// 단일 vector의 centroid 배정을 계산한다. 유효 score가 없으면 기존 `TypeScript` 기본값처럼 0번 cluster로 둔다.
fn assign_vector_to_centroid(vector: &[f64], centroids: &[f64], dimensions: usize) -> usize {
    let mut best_index = 0_usize;
    let mut best_score = f64::NEG_INFINITY;

    for (centroid_index, centroid) in centroids.chunks_exact(dimensions).enumerate() {
        let Some(score) = cosine_similarity(vector, centroid) else {
            continue;
        };
        if score > best_score {
            best_index = centroid_index;
            best_score = score;
        }
    }

    best_index
}

/// 요청 cluster 수와 entry 수로 실제 cluster 수를 결정한다.
fn resolve_cluster_count(entry_count: usize, requested_cluster_count: usize) -> usize {
    if entry_count == 0 {
        return 0;
    }
    if requested_cluster_count > 0 {
        return requested_cluster_count.clamp(1, entry_count);
    }
    rounded_sqrt_clamped(entry_count, 128).clamp(1, entry_count)
}

/// `Math.round(Math.sqrt(entryCount))`와 같은 정수 결과를 안전한 정수 연산으로 계산한다.
fn rounded_sqrt_clamped(entry_count: usize, max_value: usize) -> usize {
    if entry_count == 0 || max_value == 0 {
        return 0;
    }

    let mut floor = 1_usize;
    while floor < max_value {
        let next = floor.saturating_add(1);
        let next_square = next.saturating_mul(next);
        if next_square > entry_count {
            break;
        }
        floor = next;
    }
    if floor >= max_value {
        return max_value;
    }

    let ceil = floor.saturating_add(1).min(max_value);
    let round_up_threshold = floor
        .saturating_mul(floor)
        .saturating_add(floor)
        .saturating_add(1);
    if entry_count >= round_up_threshold {
        ceil
    } else {
        floor
    }
}

/// 기존 `TypeScript` IVF 경로처럼 vector matrix에서 균등 간격으로 초기 centroid를 고른다.
fn select_initial_centroids(vectors: &[f64], dimensions: usize, cluster_count: usize) -> Vec<f64> {
    let vector_count = vectors.len().checked_div(dimensions).unwrap_or_default();
    if vector_count == 0 || cluster_count == 0 {
        return Vec::new();
    }
    let mut centroids = Vec::with_capacity(cluster_count.saturating_mul(dimensions));
    if cluster_count == 1 {
        let Some(first_vector) = vectors.get(0..dimensions) else {
            return Vec::new();
        };
        centroids.extend_from_slice(first_vector);
        return centroids;
    }

    for index in 0..cluster_count {
        let entry_index = index
            .saturating_mul(vector_count.saturating_sub(1))
            .checked_div(cluster_count.saturating_sub(1))
            .unwrap_or_default();
        let offset = entry_index.saturating_mul(dimensions);
        let Some(vector) = vectors.get(offset..offset + dimensions) else {
            return Vec::new();
        };
        centroids.extend_from_slice(vector);
    }
    centroids
}

/// assignment를 기준으로 centroid 평균을 다시 계산한다. 비어 있는 cluster는 기존 centroid를 유지한다.
fn recompute_centroids_from_assignments(
    vectors: &[f64],
    assignments: &[u32],
    previous_centroids: &[f64],
    dimensions: usize,
) -> Vec<f64> {
    let cluster_count = previous_centroids
        .len()
        .checked_div(dimensions)
        .unwrap_or_default();
    let mut sums = vec![0.0_f64; previous_centroids.len()];
    let mut counts = vec![0_usize; cluster_count];

    for (vector_index, vector) in vectors.chunks_exact(dimensions).enumerate() {
        let Some(raw_assignment) = assignments.get(vector_index).copied() else {
            return Vec::new();
        };
        let Some(cluster_index) = bounded_u32_index(raw_assignment, cluster_count) else {
            return Vec::new();
        };
        if let Some(count) = counts.get_mut(cluster_index) {
            *count = count.saturating_add(1);
        }
        let output_offset = cluster_index.saturating_mul(dimensions);
        let Some(output_slice) = sums.get_mut(output_offset..output_offset + dimensions) else {
            return Vec::new();
        };
        for (sum, value) in output_slice.iter_mut().zip(vector.iter().copied()) {
            *sum += value;
        }
    }

    let mut output = Vec::with_capacity(previous_centroids.len());
    for (cluster_index, previous_centroid) in
        previous_centroids.chunks_exact(dimensions).enumerate()
    {
        let count = counts.get(cluster_index).copied().unwrap_or_default();
        if count == 0 {
            output.extend_from_slice(previous_centroid);
            continue;
        }
        let Some(count_f64) = usize_to_f64(count) else {
            return Vec::new();
        };
        let offset = cluster_index.saturating_mul(dimensions);
        let Some(sum_slice) = sums.get(offset..offset + dimensions) else {
            return Vec::new();
        };
        output.extend(sum_slice.iter().map(|value| value / count_f64));
    }

    output
}

/// retrieval source별 RRF weight를 반환한다.
fn rrf_source_weight(source_code: u8, bm25_weight: f64) -> f64 {
    match source_code {
        SOURCE_BM25 => bm25_weight.max(0.05),
        SOURCE_VECTOR | SOURCE_ANN => (1.0 - bm25_weight).max(0.05),
        code if is_graph_evidence_source_code(code) => 0.2,
        SOURCE_STRUCTURAL => 0.12,
        _ => 0.05,
    }
}

/// graph/evidence source code인지 반환한다.
const fn is_graph_evidence_source_code(source_code: u8) -> bool {
    matches!(
        source_code,
        SOURCE_GRAPH_EVIDENCE | SOURCE_GRAPH_GLOBAL | SOURCE_EVIDENCE
    )
}

/// 알려진 retrieval source code인지 반환한다.
const fn is_retrieval_source_code(source_code: u8) -> bool {
    matches!(
        source_code,
        SOURCE_BM25 | SOURCE_VECTOR | SOURCE_STRUCTURAL | SOURCE_ANN
    ) || is_graph_evidence_source_code(source_code)
}

/// graph/evidence source가 있는지 반환한다.
fn has_graph_evidence_source(source_codes: &[u8]) -> bool {
    source_codes
        .iter()
        .copied()
        .any(is_graph_evidence_source_code)
}

/// graph/evidence/structural source가 있는지 반환한다.
fn has_graph_or_structural_source(source_codes: &[u8]) -> bool {
    source_codes.iter().copied().any(|source_code| {
        is_graph_evidence_source_code(source_code) || source_code == SOURCE_STRUCTURAL
    })
}

/// graph/evidence/structural source가 강한 근거인지 반환한다.
fn has_strong_graph_or_structural_source(
    source_codes: &[u8],
    evidence_score: f64,
    rank: f64,
) -> bool {
    has_graph_or_structural_source(source_codes) && is_strong_evidence_score(evidence_score, rank)
}

/// RAG query result score row를 계산한다.
fn plan_query_result_score(input: &QueryResultScoreInput) -> QueryResultScorePlan {
    let combined_base = if input.has_bm25 {
        input.bm25_weight.mul_add(
            input.bm25_score,
            (1.0 - input.bm25_weight) * input.cosine_score,
        )
    } else {
        input.cosine_score
    };
    let (source_codes, source_scores, source_ranks) =
        query_result_source_metric_rows(&input.source_scores, &input.source_ranks);
    let analysis = analyze_retrieval_sources(&source_codes, &source_scores, &source_ranks);
    let source_prior = analysis_value(&analysis, 0);
    let source_evidence_score = analysis_value(&analysis, 1);
    let best_evidence_rank = analysis_value(&analysis, 2);
    let has_graph_or_structural_evidence = analysis_value(&analysis, 3) > 0.5;
    let has_strong_graph_or_structural_evidence = analysis_value(&analysis, 4) > 0.5;
    let rank_codes = input
        .source_ranks
        .keys()
        .map(|source| source_code_from_name(source))
        .collect::<Vec<_>>();
    let ranks = input.source_ranks.values().copied().collect::<Vec<_>>();
    let rrf_score = rrf_score_or_nan(&rank_codes, &ranks, input.bm25_weight);
    let retrieval_source_codes = input
        .retrieval_sources
        .iter()
        .map(|source| source_code_from_name(source))
        .collect::<Vec<_>>();
    let combined_score = hybrid_score_or_nan(
        combined_base,
        rrf_score,
        source_prior,
        source_evidence_score,
        best_evidence_rank,
        &retrieval_source_codes,
    );
    let selection_reason = query_result_selection_reason(
        &retrieval_source_codes,
        has_graph_or_structural_evidence,
        has_strong_graph_or_structural_evidence,
    );

    QueryResultScorePlan {
        combined_base,
        rrf_score,
        source_prior,
        source_evidence_score,
        best_evidence_rank,
        has_graph_or_structural_evidence,
        has_strong_graph_or_structural_evidence,
        combined_score,
        selection_reason,
    }
}

/// Query result가 최종 후보로 유지된 주된 machine reason을 계산한다.
fn query_result_selection_reason(
    retrieval_source_codes: &[u8],
    has_graph_or_structural_evidence: bool,
    has_strong_graph_or_structural_evidence: bool,
) -> &'static str {
    if has_strong_graph_or_structural_evidence {
        return "strong-graph-evidence";
    }
    if has_graph_or_structural_evidence {
        return "graph-structural-evidence";
    }

    let has_keyword = retrieval_source_codes.contains(&SOURCE_BM25);
    let has_vector = retrieval_source_codes
        .iter()
        .copied()
        .any(|source| matches!(source, SOURCE_VECTOR | SOURCE_ANN));
    match (has_keyword, has_vector) {
        (true, true) => "keyword-vector",
        (true, false) => "keyword",
        (false, true) => "vector",
        (false, false) => "hybrid",
    }
}

/// source score/rank map을 analysis kernel 입력 row로 변환한다.
fn query_result_source_metric_rows(
    source_scores: &BTreeMap<String, f64>,
    source_ranks: &BTreeMap<String, f64>,
) -> (Vec<u8>, Vec<f64>, Vec<f64>) {
    let source_names = source_scores
        .keys()
        .chain(source_ranks.keys())
        .collect::<BTreeSet<_>>();
    let mut source_codes = Vec::with_capacity(source_names.len());
    let mut scores = Vec::with_capacity(source_names.len());
    let mut ranks = Vec::with_capacity(source_names.len());
    for source in source_names {
        source_codes.push(source_code_from_name(source));
        scores.push(source_scores.get(source).copied().unwrap_or(f64::NAN));
        ranks.push(source_ranks.get(source).copied().unwrap_or(f64::NAN));
    }
    (source_codes, scores, ranks)
}

/// source analysis 값 하나를 반환한다.
fn analysis_value(analysis: &[f64], index: usize) -> f64 {
    analysis.get(index).copied().unwrap_or(f64::NAN)
}

/// retrieval source 문자열을 numeric source code로 변환한다.
fn source_code_from_name(source: &str) -> u8 {
    match source {
        "bm25" => SOURCE_BM25,
        "vector" => SOURCE_VECTOR,
        "graph-local" => SOURCE_GRAPH_EVIDENCE,
        "structural" => SOURCE_STRUCTURAL,
        "ann" => SOURCE_ANN,
        "graph-global" => SOURCE_GRAPH_GLOBAL,
        "evidence" => SOURCE_EVIDENCE,
        _ => 0,
    }
}

/// LLM reranker message content plan을 만든다.
fn plan_rerank_messages(
    question: &str,
    candidates: &[RerankMessageCandidate],
    max_text_chars: usize,
) -> RerankMessagesPlan {
    let candidates = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| PlannedRerankCandidate {
            id: candidate.id.clone(),
            index,
            source_path: candidate.source_path.clone(),
            heading: candidate.heading.clone(),
            text: truncate_rerank_text(&candidate.text, max_text_chars),
        })
        .collect::<Vec<_>>();
    RerankMessagesPlan {
        system_content: RERANK_SYSTEM_CONTENT.to_owned(),
        user_content: serialize_rerank_user_content_json(question, &candidates),
    }
}

/// LLM reranker 후보 텍스트를 max char 기준으로 자르고 trim 후 ellipsis를 붙인다.
fn truncate_rerank_text(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let truncated = text.chars().take(max_chars).collect::<String>();
    format!("{}...", truncated.trim())
}

/// result index에 해당하는 retrieval source code 구간을 반환한다.
fn source_codes_for_result<'a>(
    source_offsets: &[u32],
    source_codes: &'a [u8],
    result_index: usize,
) -> Option<&'a [u8]> {
    let start = usize::try_from(*source_offsets.get(result_index)?).ok()?;
    let end = usize::try_from(*source_offsets.get(result_index.saturating_add(1))?).ok()?;
    if start > end || end > source_codes.len() {
        return None;
    }
    source_codes.get(start..end)
}

/// result row matrix에서 특정 numeric column 값을 반환한다.
fn relevant_result_value(
    result_values: &[f64],
    row_index: usize,
    column_index: usize,
) -> Option<f64> {
    let offset = row_index
        .checked_mul(RELEVANT_RESULT_VALUE_WIDTH)?
        .checked_add(column_index)?;
    result_values.get(offset).copied()
}

/// retrieval source merge state를 갱신한다.
fn merge_retrieval_source(
    sources: &mut Vec<RetrievalMergeSource>,
    source_code: u8,
    source_score: f64,
    rank: f64,
) {
    if let Some(existing) = sources
        .iter_mut()
        .find(|source| source.source_code == source_code)
    {
        if source_score.is_finite() {
            existing.source_score = source_score;
        }
        if rank.is_finite() {
            existing.rank = if existing.rank.is_finite() {
                existing.rank.min(rank)
            } else {
                rank
            };
        }
        return;
    }

    sources.push(RetrievalMergeSource {
        source_code,
        source_score: if source_score.is_finite() {
            source_score
        } else {
            f64::NAN
        },
        rank: if rank.is_finite() { rank } else { f64::NAN },
    });
}

/// BM25 index에 document를 추가하거나 기존 document를 교체한다.
fn add_bm25_document(index: &mut Bm25IndexData, doc_id: &str, text: &str, source_path: &str) {
    remove_bm25_document(index, doc_id);
    insert_bm25_document(index, doc_id, text, source_path);
}

/// BM25 index에 중복 제거가 이미 끝난 document를 삽입한다.
fn insert_bm25_document(index: &mut Bm25IndexData, doc_id: &str, text: &str, source_path: &str) {
    let (token_count, frequencies) = accumulate_token_frequencies(tokenize(text));
    for (term, frequency) in frequencies {
        let Some(frequency) = usize_to_f64(frequency) else {
            continue;
        };
        index
            .inverted
            .entry(term)
            .or_default()
            .insert(doc_id.to_owned(), frequency);
    }
    index.doc_lengths.insert(
        doc_id.to_owned(),
        usize_to_f64(token_count).unwrap_or_default(),
    );
    index
        .doc_sources
        .insert(doc_id.to_owned(), source_path.to_owned());
}

/// tokenizer output을 소비하면서 total token 수와 token별 frequency를 한 번에 누적한다.
fn accumulate_token_frequencies(
    tokens: impl IntoIterator<Item = String>,
) -> (usize, BTreeMap<String, usize>) {
    let mut total_tokens = 0_usize;
    let mut frequencies = BTreeMap::<String, usize>::new();
    for token in tokens {
        total_tokens = total_tokens.saturating_add(1);
        let count = frequencies.entry(token).or_insert(0);
        *count = count.saturating_add(1);
    }
    (total_tokens, frequencies)
}

/// BM25 index에서 doc id를 제거하고 빈 posting term을 정리한다.
fn remove_bm25_document(index: &mut Bm25IndexData, doc_id: &str) {
    for posting in index.inverted.values_mut() {
        posting.remove(doc_id);
    }
    index.inverted.retain(|_, posting| !posting.is_empty());
    index.doc_lengths.remove(doc_id);
    index.doc_sources.remove(doc_id);
}

/// BM25 index에서 query score를 계산한다.
fn search_bm25_index(index: &Bm25IndexData, query: &str) -> Vec<Bm25SearchScore> {
    let total_docs = index.doc_lengths.len();
    if total_docs == 0 {
        return Vec::new();
    }
    let Some(total_docs_f64) = usize_to_f64(total_docs) else {
        return Vec::new();
    };
    let avg_doc_length = bm25_average_doc_length(index);
    if !avg_doc_length.is_finite() || avg_doc_length <= 0.0 {
        return Vec::new();
    }

    let mut query_tokens = Vec::new();
    let mut seen_tokens = BTreeSet::new();
    for token in tokenize(query) {
        if seen_tokens.insert(token.clone()) {
            query_tokens.push(token);
        }
    }

    let mut scores = Vec::<Bm25SearchScore>::new();
    let mut score_index_by_doc_id = BTreeMap::<String, usize>::new();
    for token in query_tokens {
        let Some(posting) = index.inverted.get(&token) else {
            continue;
        };
        let Some(df_f64) = usize_to_f64(posting.len()) else {
            continue;
        };
        for (doc_id, term_frequency) in posting {
            if !term_frequency.is_finite() || *term_frequency <= 0.0 {
                continue;
            }
            let doc_length = index
                .doc_lengths
                .get(doc_id)
                .copied()
                .filter(|value| value.is_finite() && *value > 0.0)
                .unwrap_or(1.0);
            let score = bm25_score_value(
                total_docs_f64,
                df_f64,
                *term_frequency,
                doc_length,
                avg_doc_length,
            );
            if score <= 0.0 || !score.is_finite() {
                continue;
            }
            let score_index = match score_index_by_doc_id.entry(doc_id.clone()) {
                Entry::Occupied(entry) => *entry.get(),
                Entry::Vacant(entry) => {
                    let next_index = scores.len();
                    entry.insert(next_index);
                    scores.push(Bm25SearchScore {
                        doc_id: doc_id.clone(),
                        score: 0.0,
                    });
                    next_index
                }
            };
            if let Some(score_slot) = scores.get_mut(score_index) {
                score_slot.score += score;
            }
        }
    }
    scores
}

/// BM25 index에서 상위 query score만 계산한다.
fn search_bm25_index_top(index: &Bm25IndexData, query: &str, limit: usize) -> Vec<Bm25SearchScore> {
    if limit == 0 {
        return Vec::new();
    }
    limit_bm25_search_scores(search_bm25_index(index, query), limit)
}

/// BM25 score 목록을 기존 hit lookup 정렬 계약과 같은 순서로 제한한다.
fn limit_bm25_search_scores(scores: Vec<Bm25SearchScore>, limit: usize) -> Vec<Bm25SearchScore> {
    if limit == 0 || scores.is_empty() {
        return Vec::new();
    }

    let mut top_scores = Vec::<RankedBm25SearchScore>::with_capacity(limit.min(scores.len()));
    for (sequence, score) in scores.into_iter().enumerate() {
        push_top_bm25_search_score(
            &mut top_scores,
            RankedBm25SearchScore { sequence, score },
            limit,
        );
    }
    top_scores.into_iter().map(|ranked| ranked.score).collect()
}

/// 단일 BM25 score를 정렬된 top-k 버퍼에 반영한다.
fn push_top_bm25_search_score(
    scores: &mut Vec<RankedBm25SearchScore>,
    score: RankedBm25SearchScore,
    limit: usize,
) {
    if limit == 0 || !score.score.score.is_finite() {
        return;
    }
    let insert_at = scores
        .iter()
        .position(|candidate| {
            compare_ranked_bm25_search_scores_descending(&score, candidate).is_lt()
        })
        .unwrap_or(scores.len());
    if insert_at >= limit {
        return;
    }
    scores.insert(insert_at, score);
    if scores.len() > limit {
        scores.truncate(limit);
    }
}

/// BM25 제한 검색 정렬. 높은 score 우선, 같은 score는 전체 검색의 원래 순서 우선이다.
fn compare_ranked_bm25_search_scores_descending(
    left: &RankedBm25SearchScore,
    right: &RankedBm25SearchScore,
) -> std::cmp::Ordering {
    right
        .score
        .score
        .total_cmp(&left.score.score)
        .then_with(|| left.sequence.cmp(&right.sequence))
}

/// BM25 score 공식을 계산한다.
fn bm25_score_value(
    total_docs: f64,
    document_frequency: f64,
    term_frequency: f64,
    doc_length: f64,
    avg_doc_length: f64,
) -> f64 {
    if !total_docs.is_finite()
        || !document_frequency.is_finite()
        || !term_frequency.is_finite()
        || !doc_length.is_finite()
        || !avg_doc_length.is_finite()
        || total_docs <= 0.0
        || document_frequency <= 0.0
        || term_frequency <= 0.0
        || doc_length <= 0.0
        || avg_doc_length <= 0.0
    {
        return 0.0;
    }
    let idf = ((total_docs - document_frequency + 0.5) / (document_frequency + 0.5)).ln_1p();
    let denominator = BM25_K1.mul_add(
        BM25_B.mul_add(doc_length / avg_doc_length, 1.0 - BM25_B),
        term_frequency,
    );
    if denominator <= 0.0 {
        return 0.0;
    }
    idf * ((term_frequency * (BM25_K1 + 1.0)) / denominator)
}

/// BM25 평균 document length를 계산한다.
fn bm25_average_doc_length(index: &Bm25IndexData) -> f64 {
    let total_docs = index.doc_lengths.len();
    if total_docs == 0 {
        return 1.0;
    }
    let Some(total_docs_f64) = usize_to_f64(total_docs) else {
        return 1.0;
    };
    let total_length = index
        .doc_lengths
        .values()
        .copied()
        .filter(|value| value.is_finite())
        .sum::<f64>();
    total_length / total_docs_f64
}

/// BM25 hit와 조회 entry를 최종 candidate plan으로 해석한다.
fn resolve_bm25_candidate_entries(
    hits: &[Bm25Hit],
    found_entries: &[Bm25Entry],
    path_entries: &[Bm25Entry],
    candidate_limit: usize,
    max_score: f64,
) -> Vec<Bm25CandidateResolution> {
    let mut found_index_by_id = BTreeMap::new();
    for (index, entry) in found_entries.iter().enumerate() {
        found_index_by_id.entry(entry.id.as_str()).or_insert(index);
    }

    let mut path_indexes_by_file = BTreeMap::<&str, Vec<usize>>::new();
    for (index, entry) in path_entries.iter().enumerate() {
        path_indexes_by_file
            .entry(entry.file_path.as_str())
            .or_default()
            .push(index);
    }

    let denominator = if max_score.is_finite() && max_score > 0.0 {
        max_score
    } else {
        hits.iter()
            .map(|hit| hit.score)
            .filter(|score| score.is_finite() && *score > 0.0)
            .fold(1.0, f64::max)
    };
    let mut seen_entry_ids = BTreeSet::new();
    let mut candidates = Vec::new();

    for hit in hits {
        if candidates.len() >= candidate_limit {
            break;
        }
        let source_score = (hit.score / denominator).clamp(0.0, 1.0);
        if let Some(found_index) = found_index_by_id.get(hit.doc_id.as_str()).copied() {
            if let Some(entry) = found_entries.get(found_index)
                && entry.compatible
                && seen_entry_ids.insert(entry.id.clone())
            {
                candidates.push(Bm25CandidateResolution {
                    entry_set: "found",
                    entry_index: found_index,
                    source_score,
                });
            }
            continue;
        }

        let Some(path_indexes) = path_indexes_by_file.get(hit.source_path.as_str()) else {
            continue;
        };
        for path_index in path_indexes {
            if candidates.len() >= candidate_limit {
                break;
            }
            let Some(entry) = path_entries.get(*path_index) else {
                continue;
            };
            if !entry.compatible || !seen_entry_ids.insert(entry.id.clone()) {
                continue;
            }
            candidates.push(Bm25CandidateResolution {
                entry_set: "path",
                entry_index: *path_index,
                source_score,
            });
        }
    }

    candidates
}

/// seed entry와 Obsidian heading cache로 structural heading range를 만든다.
fn create_structural_heading_ranges(
    seeds: &[StructuralHeadingSeed],
    headings: &[StructuralHeading],
) -> Vec<StructuralHeadingRange> {
    let mut headings_by_path = BTreeMap::<&str, Vec<StructuralHeading>>::new();
    for heading in headings {
        headings_by_path
            .entry(heading.file_path.as_str())
            .or_default()
            .push(heading.clone());
    }
    for rows in headings_by_path.values_mut() {
        rows.sort_by(|left, right| {
            left.start_line
                .cmp(&right.start_line)
                .then_with(|| left.level.cmp(&right.level))
        });
    }

    let mut ranges = Vec::new();
    for seed in seeds {
        let heading_ranges = headings_by_path
            .get(seed.file_path.as_str())
            .map(|rows| structural_heading_ranges_for_seed(seed, rows))
            .unwrap_or_default();
        if heading_ranges.is_empty() {
            if let Some(heading) = seed.heading.as_ref() {
                ranges.push(StructuralHeadingRange {
                    file_path: seed.file_path.clone(),
                    start_line: seed.start_line,
                    end_line: Some(seed.end_line),
                    heading: Some(heading.clone()),
                });
            }
            continue;
        }
        ranges.extend(heading_ranges);
    }
    ranges
}

/// 한 seed가 속한 heading cache range를 계산한다.
fn structural_heading_ranges_for_seed(
    seed: &StructuralHeadingSeed,
    headings: &[StructuralHeading],
) -> Vec<StructuralHeadingRange> {
    let mut ranges = Vec::new();
    for (index, heading) in headings.iter().enumerate() {
        let end_line = headings
            .iter()
            .skip(index.saturating_add(1))
            .find(|candidate| candidate.level <= heading.level)
            .and_then(|candidate| candidate.start_line.checked_sub(1));
        if line_in_range(seed.start_line, heading.start_line, end_line) {
            ranges.push(StructuralHeadingRange {
                file_path: seed.file_path.clone(),
                start_line: heading.start_line,
                end_line,
                heading: seed.heading.clone(),
            });
        }
    }
    ranges
}

/// entry가 structural heading range에 들어가는지 확인한다.
fn structural_entry_matches_range(entry: &StructuralEntry, range: &StructuralHeadingRange) -> bool {
    entry.file_path == range.file_path
        && line_in_range(entry.start_line, range.start_line, range.end_line)
        && range.heading.as_ref().is_none_or(|heading| {
            entry
                .heading
                .as_ref()
                .is_none_or(|entry_heading| entry_heading == heading)
        })
}

/// line이 inclusive range에 포함되는지 확인한다.
fn line_in_range(line: usize, start_line: usize, end_line: Option<usize>) -> bool {
    line >= start_line && end_line.is_none_or(|end_line| line <= end_line)
}

/// `entry id`를 first-seen numeric index로 매핑한다.
fn map_entry_ids_to_indices(entry_ids: &[String]) -> Option<Vec<u32>> {
    let mut index_by_id = BTreeMap::<&str, u32>::new();
    let mut entry_indices = Vec::with_capacity(entry_ids.len());
    for entry_id in entry_ids {
        let entry_id_key = entry_id.as_str();
        if let Some(entry_index) = index_by_id.get(entry_id_key).copied() {
            entry_indices.push(entry_index);
            continue;
        }
        let next_index = u32::try_from(index_by_id.len()).ok()?;
        index_by_id.insert(entry_id_key, next_index);
        entry_indices.push(next_index);
    }
    Some(entry_indices)
}

/// schema id 배열에서 target schema id와 일치하는 index를 선택한다.
fn plan_schema_id_indices(schema_ids: &[String], target_schema_id: &str) -> Vec<usize> {
    schema_ids
        .iter()
        .enumerate()
        .filter_map(|(index, schema_id)| (schema_id == target_schema_id).then_some(index))
        .collect()
}

/// retrieval merge group을 variable-width flat row로 인코딩한다.
fn encode_retrieval_merge_groups(groups: &[RetrievalMergeGroup]) -> Vec<f64> {
    let mut output = Vec::new();
    for group in groups {
        let Some(first_candidate_index) = usize_to_f64(group.first_candidate_index) else {
            return Vec::new();
        };
        let Some(source_count) = usize_to_f64(group.sources.len()) else {
            return Vec::new();
        };
        let Some(candidate_count) = usize_to_f64(group.candidate_indexes.len()) else {
            return Vec::new();
        };
        output.push(f64::from(group.entry_index));
        output.push(first_candidate_index);
        output.push(source_count);
        output.push(candidate_count);
        for source in &group.sources {
            output.push(f64::from(source.source_code));
            output.push(source.source_score);
            output.push(source.rank);
        }
        for candidate_index in &group.candidate_indexes {
            let Some(candidate_index) = usize_to_f64(*candidate_index) else {
                return Vec::new();
            };
            output.push(candidate_index);
        }
    }
    output
}

/// graph/evidence score가 강한 근거인지 반환한다.
fn is_strong_evidence_score(evidence_score: f64, rank: f64) -> bool {
    evidence_score >= 0.7 || (rank.is_finite() && rank <= 2.0)
}

/// graph/evidence, structural, ANN source score에서 retrieval source prior를 계산한다.
fn calculate_source_prior(source_codes: &[u8], source_scores: &[f64]) -> f64 {
    let graph_score = max_score_for_sources(
        source_codes,
        source_scores,
        &[SOURCE_GRAPH_EVIDENCE, SOURCE_GRAPH_GLOBAL, SOURCE_EVIDENCE],
    );
    let graph_prior = if graph_score > 0.0 {
        graph_score.mul_add(0.2, 0.12).min(0.35)
    } else {
        0.0
    };
    let structural_score = max_score_for_sources(source_codes, source_scores, &[SOURCE_STRUCTURAL]);
    let structural_prior = if structural_score.is_finite() {
        (structural_score * 0.12).min(0.18)
    } else {
        0.0
    };
    let ann_score = max_score_for_sources(source_codes, source_scores, &[SOURCE_ANN]);
    let ann_prior = if ann_score.is_finite() {
        (ann_score * 0.05).min(0.08)
    } else {
        0.0
    };
    graph_prior.max(structural_prior).max(ann_prior)
}

/// graph/evidence/structural source score 중 최댓값을 반환한다.
fn max_graph_or_structural_score(source_codes: &[u8], source_scores: &[f64]) -> f64 {
    max_score_for_sources(
        source_codes,
        source_scores,
        &[
            SOURCE_GRAPH_EVIDENCE,
            SOURCE_GRAPH_GLOBAL,
            SOURCE_EVIDENCE,
            SOURCE_STRUCTURAL,
        ],
    )
    .max(0.0)
}

/// graph/evidence/structural source rank 중 최솟값을 반환한다.
fn best_graph_or_structural_rank(source_codes: &[u8], source_ranks: &[f64]) -> f64 {
    source_codes
        .iter()
        .copied()
        .zip(source_ranks.iter().copied())
        .filter(|(source_code, rank)| {
            (is_graph_evidence_source_code(*source_code) || *source_code == SOURCE_STRUCTURAL)
                && rank.is_finite()
                && *rank >= 1.0
        })
        .map(|(_, rank)| rank)
        .min_by(f64::total_cmp)
        .unwrap_or(f64::NAN)
}

/// 지정 source code들의 유효 score 최댓값을 반환한다.
fn max_score_for_sources(source_codes: &[u8], source_scores: &[f64], target_codes: &[u8]) -> f64 {
    source_codes
        .iter()
        .copied()
        .zip(source_scores.iter().copied())
        .filter(|(source_code, score)| target_codes.contains(source_code) && score.is_finite())
        .map(|(_, score)| score)
        .max_by(f64::total_cmp)
        .unwrap_or(f64::NAN)
}

/// bool 값을 numeric bridge flag로 바꾼다.
const fn bool_to_f64(value: bool) -> f64 {
    if value { 1.0 } else { 0.0 }
}

/// MMR diversity selection index plan을 계산한다.
fn select_diverse_index_plan(
    scores: &[f64],
    vectors: &[f64],
    dimensions: usize,
    source_keys: &[u32],
    heading_keys: &[u32],
    top_k: usize,
) -> Option<Vec<usize>> {
    if top_k == 0 || scores.is_empty() {
        return Some(Vec::new());
    }
    if dimensions == 0
        || vectors.len() != scores.len().saturating_mul(dimensions)
        || source_keys.len() != scores.len()
        || heading_keys.len() != scores.len()
        || scores.iter().any(|score| !score.is_finite())
        || vectors.iter().any(|value| !value.is_finite())
    {
        return None;
    }
    if scores.len() <= top_k {
        return Some((0..scores.len()).collect());
    }

    let rows = vectors.chunks_exact(dimensions).collect::<Vec<_>>();
    if rows.len() != scores.len() {
        return None;
    }

    let mut selected = Vec::with_capacity(top_k.min(scores.len()));
    let mut remaining = (0..scores.len()).collect::<Vec<_>>();

    while selected.len() < top_k && !remaining.is_empty() {
        let mut best_remaining_position = 0_usize;
        let mut best_selection_score = f64::NEG_INFINITY;

        for (remaining_position, candidate_index) in remaining.iter().copied().enumerate() {
            let Some(candidate_score) = scores.get(candidate_index).copied() else {
                continue;
            };
            let diversity_penalty = calculate_mmr_diversity_penalty(
                candidate_index,
                &selected,
                source_keys,
                heading_keys,
            );
            let max_similarity =
                calculate_max_selected_similarity(candidate_index, &selected, &rows);
            let novelty_penalty =
                (1.0 - MMR_RELEVANCE_WEIGHT).mul_add(max_similarity, diversity_penalty);
            let selection_score = MMR_RELEVANCE_WEIGHT.mul_add(candidate_score, -novelty_penalty);

            if selection_score > best_selection_score {
                best_selection_score = selection_score;
                best_remaining_position = remaining_position;
            }
        }

        let Some(next_index) = remaining.get(best_remaining_position).copied() else {
            break;
        };
        remaining.remove(best_remaining_position);
        selected.push(next_index);
    }

    Some(selected)
}

/// RAG result snapshot의 문자열 source/heading key를 포함해 diversity index plan을 만든다.
fn plan_diverse_result_indices(
    candidates: &[DiverseResultCandidate],
    top_k: usize,
) -> Option<Vec<usize>> {
    if top_k == 0 || candidates.is_empty() {
        return Some(Vec::new());
    }
    if candidates.len() <= top_k {
        return Some((0..candidates.len()).collect());
    }

    let dimensions = candidates.first()?.vector.len();
    if dimensions == 0 {
        return None;
    }
    let mut scores = Vec::with_capacity(candidates.len());
    let mut vectors = Vec::with_capacity(candidates.len().saturating_mul(dimensions));
    let mut source_key_by_path = BTreeMap::<String, u32>::new();
    let mut heading_key_by_value = BTreeMap::<String, u32>::new();
    let mut source_keys = Vec::with_capacity(candidates.len());
    let mut heading_keys = Vec::with_capacity(candidates.len());

    for candidate in candidates {
        if candidate.vector.len() != dimensions {
            return None;
        }
        scores.push(candidate.score);
        vectors.extend(candidate.vector.iter().copied());
        source_keys.push(diverse_result_string_key(
            &mut source_key_by_path,
            &candidate.source_path,
            false,
        )?);
        heading_keys.push(match &candidate.heading {
            Some(heading) => diverse_result_string_key(&mut heading_key_by_value, heading, true)?,
            None => 0,
        });
    }

    select_diverse_index_plan(
        &scores,
        &vectors,
        dimensions,
        &source_keys,
        &heading_keys,
        top_k,
    )
}

/// 문자열 key를 first-seen numeric key로 변환한다.
fn diverse_result_string_key(
    key_by_value: &mut BTreeMap<String, u32>,
    value: &str,
    zero_for_empty: bool,
) -> Option<u32> {
    let value = value.trim();
    if value.is_empty() {
        return zero_for_empty.then_some(0);
    }
    if let Some(key) = key_by_value.get(value).copied() {
        return Some(key);
    }
    let key = u32::try_from(key_by_value.len().saturating_add(1)).ok()?;
    key_by_value.insert(value.to_owned(), key);
    Some(key)
}

/// 후보가 이미 선택된 후보와 같은 파일/heading을 공유할 때 penalty를 계산한다.
fn calculate_mmr_diversity_penalty(
    candidate_index: usize,
    selected: &[usize],
    source_keys: &[u32],
    heading_keys: &[u32],
) -> f64 {
    let Some(candidate_source_key) = source_keys.get(candidate_index).copied() else {
        return 0.0;
    };
    let candidate_heading_key = heading_keys
        .get(candidate_index)
        .copied()
        .unwrap_or_default();
    let mut penalty = 0.0_f64;

    for selected_index in selected {
        if source_keys.get(*selected_index).copied() != Some(candidate_source_key) {
            continue;
        }
        penalty = penalty.max(SAME_FILE_DIVERSITY_PENALTY);
        if candidate_heading_key != 0
            && heading_keys.get(*selected_index).copied() == Some(candidate_heading_key)
        {
            penalty = penalty.max(SAME_FILE_DIVERSITY_PENALTY + SAME_HEADING_DIVERSITY_PENALTY);
        }
    }

    penalty
}

/// 후보와 이미 선택된 후보들의 최대 cosine similarity를 계산한다.
fn calculate_max_selected_similarity(
    candidate_index: usize,
    selected: &[usize],
    rows: &[&[f64]],
) -> f64 {
    let mut max_similarity = 0.0_f64;
    let Some(candidate_vector) = rows.get(candidate_index).copied() else {
        return max_similarity;
    };

    for selected_index in selected {
        let Some(selected_vector) = rows.get(*selected_index).copied() else {
            continue;
        };
        let Some(similarity) = cosine_similarity(candidate_vector, selected_vector) else {
            continue;
        };
        max_similarity = max_similarity.max(similarity);
    }

    max_similarity
}

/// Graph community detection용 adjacency graph.
struct CommunityGraph {
    /// node별 neighbor와 weight. 입력 edge 순서 기반 insertion order를 보존한다.
    adjacency: Vec<Vec<(usize, f64)>>,
    /// node별 weighted degree.
    degrees: Vec<f64>,
    /// 무방향 edge를 양방향 adjacency로 펼친 총 weight.
    total_weight: f64,
}

/// 집계된 `GraphRAG` relation edge.
struct AggregatedGraphEdge {
    /// lexicographic entity id 순서를 numeric index로 옮긴 source index.
    source_index: usize,
    /// lexicographic entity id 순서를 numeric index로 옮긴 target index.
    target_index: usize,
    /// 같은 무방향 endpoint pair의 누적 confidence.
    weight: f64,
}

/// `GraphRAG` community detection edge record snapshot.
struct CommunityEdgeRecord {
    /// source entity id.
    source: String,
    /// target entity id.
    target: String,
    /// edge weight.
    weight: f64,
}

/// `GraphRAG` community assignment by entity id.
struct CommunityAssignmentById {
    /// entity id.
    entity_id: String,
    /// remapped community id.
    community_id: usize,
}

/// `GraphRAG` community detection `JSON` plan.
struct CommunityDetectionPlan {
    /// entity assignment rows.
    assignments: Vec<CommunityAssignmentById>,
    /// community ids.
    community_ids: Vec<usize>,
    /// modularity.
    modularity: f64,
}

/// local evidence scoring 중간 상태.
struct LocalEvidenceState {
    /// entity별 현재 score.
    entity_scores: Vec<f64>,
    /// entity별 traversal distance.
    entity_distances: Vec<usize>,
    /// entity가 한 번이라도 발견됐는지 여부.
    entity_known: Vec<bool>,
    /// 현재 depth frontier 여부.
    frontier: Vec<bool>,
}

impl LocalEvidenceState {
    /// entity 수에 맞는 빈 상태를 만든다.
    fn new(entity_count: usize) -> Self {
        Self {
            entity_scores: vec![0.0_f64; entity_count],
            entity_distances: vec![0_usize; entity_count],
            entity_known: vec![false; entity_count],
            frontier: vec![false; entity_count],
        }
    }
}

/// `GraphRAG` local evidence scoring wire input.
struct LocalEvidenceInput<'a> {
    /// numeric entity count.
    entity_count: usize,
    /// numeric evidence count.
    evidence_count: usize,
    /// relation traversal depth.
    traversal_depth: usize,
    /// mentioned match count.
    match_count: usize,
    /// match entity indices.
    match_entity_indices: &'a [u32],
    /// precomputed match entity scores.
    match_scores: &'a [f64],
    /// offsets into match evidence indices.
    match_evidence_offsets: &'a [u32],
    /// flattened match evidence indices.
    match_evidence_indices: &'a [u32],
    /// relation count.
    relation_count: usize,
    /// relation source entity indices.
    relation_source_indices: &'a [u32],
    /// relation target entity indices.
    relation_target_indices: &'a [u32],
    /// relation confidence values.
    relation_confidences: &'a [f64],
    /// offsets into relation evidence indices.
    relation_evidence_offsets: &'a [u32],
    /// flattened relation evidence indices.
    relation_evidence_indices: &'a [u32],
    /// claim count.
    claim_count: usize,
    /// offsets into claim entity indices.
    claim_entity_offsets: &'a [u32],
    /// flattened claim entity indices.
    claim_entity_indices: &'a [u32],
    /// claim confidence values.
    claim_confidences: &'a [f64],
    /// offsets into claim evidence indices.
    claim_evidence_offsets: &'a [u32],
    /// flattened claim evidence indices.
    claim_evidence_indices: &'a [u32],
}

impl LocalEvidenceInput<'_> {
    /// match index의 entity index를 반환한다.
    fn entity_index_for_match(&self, match_index: usize) -> Option<usize> {
        bounded_u32_index(
            self.match_entity_indices.get(match_index).copied()?,
            self.entity_count,
        )
    }

    /// relation index의 source entity index를 반환한다.
    fn entity_index_for_relation_source(&self, relation_index: usize) -> Option<usize> {
        bounded_u32_index(
            self.relation_source_indices.get(relation_index).copied()?,
            self.entity_count,
        )
    }

    /// relation index의 target entity index를 반환한다.
    fn entity_index_for_relation_target(&self, relation_index: usize) -> Option<usize> {
        bounded_u32_index(
            self.relation_target_indices.get(relation_index).copied()?,
            self.entity_count,
        )
    }
}

/// evidence index와 score.
struct LocalEvidenceScore {
    /// evidence index.
    evidence_index: usize,
    /// evidence score.
    score: f64,
    /// 생성 순서. 같은 score tie에서 기존 순서를 보존한다.
    sequence: usize,
}

/// RAG result diversity selection record snapshot.
struct DiverseResultCandidate {
    /// final relevance score.
    score: f64,
    /// embedding vector.
    vector: Vec<f64>,
    /// source file path.
    source_path: String,
    /// optional heading key.
    heading: Option<String>,
}

/// `GraphRAG` local evidence match record snapshot.
struct LocalEvidenceMatchRecord {
    /// entity id.
    entity_id: String,
    /// entity confidence.
    entity_confidence: f64,
    /// mention match score.
    match_score: f64,
    /// entity evidence id 목록.
    evidence_ids: Vec<String>,
}

/// `GraphRAG` local evidence relation record snapshot.
struct LocalEvidenceRelationRecord {
    /// source entity id.
    source_entity_id: String,
    /// target entity id.
    target_entity_id: String,
    /// relation confidence.
    confidence: f64,
    /// relation evidence id 목록.
    evidence_ids: Vec<String>,
}

/// `GraphRAG` local evidence claim record snapshot.
struct LocalEvidenceClaimRecord {
    /// claim entity id 목록.
    entity_ids: Vec<String>,
    /// claim confidence.
    confidence: f64,
    /// claim evidence id 목록.
    evidence_ids: Vec<String>,
}

/// owned local evidence scoring wire input.
struct OwnedLocalEvidenceInput {
    /// numeric entity count.
    entity_count: usize,
    /// numeric evidence count.
    evidence_count: usize,
    /// relation traversal depth.
    traversal_depth: usize,
    /// match entity indices.
    match_entity_indices: Vec<u32>,
    /// match scores.
    match_scores: Vec<f64>,
    /// match evidence offsets.
    match_evidence_offsets: Vec<u32>,
    /// match evidence indices.
    match_evidence_indices: Vec<u32>,
    /// relation source entity indices.
    relation_source_indices: Vec<u32>,
    /// relation target entity indices.
    relation_target_indices: Vec<u32>,
    /// relation confidences.
    relation_confidences: Vec<f64>,
    /// relation evidence offsets.
    relation_evidence_offsets: Vec<u32>,
    /// relation evidence indices.
    relation_evidence_indices: Vec<u32>,
    /// claim entity offsets.
    claim_entity_offsets: Vec<u32>,
    /// claim entity indices.
    claim_entity_indices: Vec<u32>,
    /// claim confidences.
    claim_confidences: Vec<f64>,
    /// claim evidence offsets.
    claim_evidence_offsets: Vec<u32>,
    /// claim evidence indices.
    claim_evidence_indices: Vec<u32>,
}

impl OwnedLocalEvidenceInput {
    /// borrowed local evidence scoring input으로 변환한다.
    fn as_borrowed(&self) -> LocalEvidenceInput<'_> {
        LocalEvidenceInput {
            entity_count: self.entity_count,
            evidence_count: self.evidence_count,
            traversal_depth: self.traversal_depth,
            match_count: self.match_entity_indices.len(),
            match_entity_indices: &self.match_entity_indices,
            match_scores: &self.match_scores,
            match_evidence_offsets: &self.match_evidence_offsets,
            match_evidence_indices: &self.match_evidence_indices,
            relation_count: self.relation_source_indices.len(),
            relation_source_indices: &self.relation_source_indices,
            relation_target_indices: &self.relation_target_indices,
            relation_confidences: &self.relation_confidences,
            relation_evidence_offsets: &self.relation_evidence_offsets,
            relation_evidence_indices: &self.relation_evidence_indices,
            claim_count: self.claim_confidences.len(),
            claim_entity_offsets: &self.claim_entity_offsets,
            claim_entity_indices: &self.claim_entity_indices,
            claim_confidences: &self.claim_confidences,
            claim_evidence_offsets: &self.claim_evidence_offsets,
            claim_evidence_indices: &self.claim_evidence_indices,
        }
    }
}

/// planned local evidence scoring input과 evidence id lookup.
struct PlannedLocalEvidenceInput {
    /// owned scoring input.
    input: OwnedLocalEvidenceInput,
    /// evidence index -> evidence id.
    evidence_ids: Vec<String>,
}

/// claim evidence score 입력.
struct ClaimEvidenceInput {
    /// claim confidence.
    confidence: f64,
    /// evidence id 목록.
    evidence_ids: Vec<String>,
}

/// evidence id와 score.
struct EvidenceScoreById {
    /// evidence id.
    evidence_id: String,
    /// score.
    score: f64,
    /// 생성 순서. 같은 score tie에서 기존 순서를 보존한다.
    sequence: usize,
}

/// Graph evidence 후보 lookup record.
struct GraphEvidenceLookupRecord {
    /// evidence id.
    id: String,
    /// evidence가 속한 vault file path.
    file_path: String,
}

/// Graph evidence 후보 lookup plan.
struct GraphEvidenceCandidateLookupPlan {
    /// 사용할 evidence score index.
    score_indices: Vec<usize>,
    /// score index에 대응하는 evidence snapshot index.
    evidence_indices: Vec<usize>,
    /// vector store lookup에 필요한 file path 목록.
    file_paths: Vec<String>,
}

/// Graph evidence candidate가 참조할 vector entry record.
struct GraphEvidenceEntryRecord {
    /// vector entry id.
    id: String,
    /// request compatibility predicate 결과.
    compatible: bool,
}

/// Graph community replacement 삭제 대상 입력 record.
struct GraphCommunityReplacementRecord {
    /// community id.
    id: String,
    /// community ontology schema id.
    ontology_schema_id: String,
}

/// Graph evidence candidate의 최종 vector entry 선택 plan.
struct GraphEvidenceEntryCandidatePlan {
    /// 사용할 evidence candidate index.
    candidate_indices: Vec<usize>,
    /// candidate index에 대응하는 vector entry snapshot index.
    entry_indices: Vec<usize>,
}

/// Graph mention context entity snapshot.
struct GraphMentionEntity {
    /// entity id.
    id: String,
    /// canonical display name.
    canonical_name: String,
    /// alias names.
    aliases: Vec<String>,
    /// entity type id.
    type_id: String,
    /// optional entity description.
    description: Option<String>,
}

/// Graph mention context relation endpoint snapshot.
struct GraphMentionRelation {
    /// source entity id.
    source_entity_id: String,
    /// target entity id.
    target_entity_id: String,
    /// relation type id.
    relation_type_id: String,
    /// optional relation description.
    description: Option<String>,
}

/// Graph mention context selection plan.
struct GraphMentionContextPlan {
    /// mention에 직접 매칭된 entity snapshot index.
    matched_entity_indices: Vec<usize>,
    /// matched entity와 연결된 relation snapshot index.
    matched_relation_indices: Vec<usize>,
    /// Graph context block에 표시할 line plan.
    context_lines: Vec<String>,
}

/// Graph community summarizer assignment row.
struct GraphCommunityAssignmentInput {
    /// assigned entity id.
    entity_id: String,
    /// numeric community id.
    community_id: usize,
}

/// Graph community summarizer relation endpoint row.
struct GraphCommunitySummaryRelationInput {
    /// source entity id.
    source_entity_id: String,
    /// target entity id.
    target_entity_id: String,
}

/// Graph community summarizer claim entity row.
struct GraphCommunitySummaryClaimInput {
    /// claim entity ids.
    entity_ids: Vec<String>,
}

/// Graph community summarizer group index plan.
#[derive(Default)]
struct GraphCommunitySummaryGroupPlan {
    /// grouped entity snapshot indices.
    entities: Vec<usize>,
    /// grouped relation snapshot indices.
    relations: Vec<usize>,
    /// grouped claim snapshot indices.
    claims: Vec<usize>,
}

/// Graph extraction claim entity name lookup row.
struct GraphClaimEntityLookupRecord {
    /// entity canonical or alias name.
    name: String,
    /// resolved graph entity id.
    entity_id: String,
}

/// Graph extraction relation endpoint input row.
struct GraphRelationEndpointInput {
    /// extracted source entity name.
    source: String,
    /// extracted target entity name.
    target: String,
}

/// Graph extraction relation endpoint lookup row.
struct GraphRelationEndpointLookupRecord {
    /// entity canonical or alias name.
    name: String,
    /// accepted entity snapshot index.
    entity_index: usize,
}

/// Graph extraction relation endpoint index pair.
struct GraphRelationEndpointPair {
    /// accepted source entity snapshot index.
    source_entity_index: usize,
    /// accepted target entity snapshot index.
    target_entity_index: usize,
}

/// `GraphRAG` query 실행 정책 plan.
struct GraphQueryExecutionPlan {
    /// 실행할 query action.
    action: &'static str,
    /// planner 호출이 필요한지 여부.
    requires_planner: bool,
}

/// vector entry metadata에서 추린 file index 입력.
struct FileIndexEntryInput {
    /// vector entry file path.
    file_path: String,
    /// source file mtime.
    source_mtime: Option<f64>,
    /// source file size.
    source_size: Option<f64>,
    /// source content hash.
    content_hash: Option<String>,
    /// indexed timestamp.
    indexed_at: Option<f64>,
    /// chunk end line.
    end_line: Option<f64>,
    /// embedding provider key.
    embedding_provider: Option<String>,
    /// embedding model key.
    embedding_model: Option<String>,
    /// vector record updated timestamp.
    updated: Option<f64>,
}

impl FileIndexEntryInput {
    /// 기존 TypeScript complete metadata 조건을 판정한다.
    const fn has_complete_metadata(&self) -> bool {
        self.source_mtime.is_some()
            && self.source_size.is_some()
            && self.content_hash.is_some()
            && self.indexed_at.is_some()
            && self.end_line.is_some()
            && self.embedding_provider.is_some()
            && self.embedding_model.is_some()
    }
}

/// file 단위 index record plan.
struct FileIndexRecordPlan {
    /// file path.
    file_path: String,
    /// 첫 entry의 source mtime.
    source_mtime: Option<f64>,
    /// 첫 entry의 source size.
    source_size: Option<f64>,
    /// 첫 entry의 content hash.
    content_hash: Option<String>,
    /// 첫 entry의 indexed timestamp.
    indexed_at: Option<f64>,
    /// 첫 entry의 embedding provider.
    embedding_provider: Option<String>,
    /// 첫 entry의 embedding model.
    embedding_model: Option<String>,
    /// 그룹 전체 metadata complete 여부.
    has_complete_metadata: bool,
    /// file path에 속한 vector entry 수.
    vector_count: usize,
    /// caller가 제공한 updated timestamp.
    updated: f64,
}

impl FileIndexRecordPlan {
    /// 첫 entry 기준 record를 만든다. vector count는 caller loop에서 증가시킨다.
    fn from_first_entry(entry: &FileIndexEntryInput, default_updated: f64) -> Self {
        let has_complete_metadata = entry.has_complete_metadata();
        let mut record = Self {
            file_path: entry.file_path.clone(),
            source_mtime: entry.source_mtime,
            source_size: entry.source_size,
            content_hash: entry.content_hash.clone(),
            indexed_at: entry.indexed_at,
            embedding_provider: entry.embedding_provider.clone(),
            embedding_model: entry.embedding_model.clone(),
            has_complete_metadata,
            vector_count: 0,
            updated: entry.updated.unwrap_or(default_updated),
        };
        if !has_complete_metadata {
            record.clear_optional_metadata();
        }
        record
    }

    /// incomplete record에서는 기존 `TypeScript`처럼 optional metadata를 비운다.
    fn clear_optional_metadata(&mut self) {
        self.source_mtime = None;
        self.source_size = None;
        self.content_hash = None;
        self.indexed_at = None;
        self.embedding_provider = None;
        self.embedding_model = None;
    }
}

/// vector store entry source kind.
#[derive(Clone, Copy)]
enum VectorStoreEntrySource {
    /// 기존 저장소 entry.
    Existing,
    /// 새로 들어온 entry.
    Incoming,
}

impl VectorStoreEntrySource {
    /// JSON wire-format 문자열.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Existing => "existing",
            Self::Incoming => "incoming",
        }
    }
}

/// vector store output entry source.
struct VectorStoreEntrySourcePlan {
    /// source set.
    source: VectorStoreEntrySource,
    /// source set 안의 index.
    index: usize,
}

/// vector store mutation plan.
struct VectorStoreMutationPlan {
    /// 최종 entry 순서를 만드는 source plan.
    sources: Vec<VectorStoreEntrySourcePlan>,
    /// 삭제된 기존 entry 수.
    removed_count: usize,
    /// 저장소 내용 변경 여부.
    changed: bool,
}

/// vector store stats와 indexed path plan.
struct VectorStoreStatsPlan {
    /// 전체 entry 수.
    total_entries: usize,
    /// unique file path 수.
    total_files: usize,
    /// vector 수. 현재 entry 수와 같다.
    total_vectors: usize,
    /// file당 평균 vector 수.
    average_vectors_per_file: f64,
    /// caller가 제공한 최신 timestamp.
    last_updated: Option<f64>,
    /// 정렬된 unique indexed file paths.
    indexed_file_paths: Vec<String>,
}

/// RAG status 계산 대상 file snapshot.
struct RagStatusFileInput {
    /// vault file path.
    path: String,
    /// source mtime.
    mtime: f64,
    /// source size.
    size: f64,
}

/// RAG status 계산 대상 file index record snapshot.
struct RagStatusRecordInput {
    /// record file path.
    file_path: String,
    /// source mtime.
    source_mtime: Option<f64>,
    /// source size.
    source_size: Option<f64>,
    /// source content hash.
    content_hash: Option<String>,
    /// indexed timestamp.
    indexed_at: Option<f64>,
    /// embedding provider key.
    embedding_provider: Option<String>,
    /// embedding model key.
    embedding_model: Option<String>,
    /// complete metadata flag.
    has_complete_metadata: Option<bool>,
    /// record vector count.
    vector_count: usize,
}

impl RagStatusRecordInput {
    /// 기존 `TypeScript` status 판정의 legacy 조건을 보존한다.
    const fn is_legacy_record(&self) -> bool {
        !matches!(self.has_complete_metadata, Some(true))
            || self.source_mtime.is_none()
            || self.source_size.is_none()
            || self.content_hash.is_none()
            || self.indexed_at.is_none()
            || self.embedding_provider.is_none()
            || self.embedding_model.is_none()
    }
}

/// RAG status reason label bundle.
struct RagStatusReasonLabels {
    /// missing reason.
    missing: String,
    /// legacy reason.
    legacy: String,
    /// stale source file reason.
    stale_file: String,
    /// embedding changed reason.
    embedding_changed: String,
}

/// RAG status summary input.
struct RagStatusInput {
    /// included candidate files.
    included_files: Vec<RagStatusFileInput>,
    /// vector store file records.
    records: Vec<RagStatusRecordInput>,
    /// vault 전체 file 수.
    total_vault_files: usize,
    /// 현재 embedding provider key.
    embedding_provider: String,
    /// 현재 embedding model key.
    embedding_model: String,
    /// i18n reason labels.
    reasons: RagStatusReasonLabels,
}

/// RAG document status.
#[derive(Clone, Copy, PartialEq, Eq)]
enum RagDocumentStatus {
    /// indexed and compatible.
    Healthy,
    /// no vector record.
    Missing,
    /// stale file metadata or embedding config.
    Stale,
    /// legacy/incomplete vector metadata.
    Unknown,
}

impl RagDocumentStatus {
    /// JSON wire-format status string.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Missing => "missing",
            Self::Stale => "stale",
            Self::Unknown => "unknown",
        }
    }

    /// 기존 updateRequiredDocuments sort order.
    const fn sort_order(self) -> u8 {
        match self {
            Self::Missing => 0,
            Self::Stale => 1,
            Self::Unknown => 2,
            Self::Healthy => 3,
        }
    }
}

/// RAG document update row.
struct RagDocumentUpdatePlan {
    /// file path.
    path: String,
    /// document status.
    status: RagDocumentStatus,
    /// display reason.
    reason: String,
    /// source mtime.
    mtime: f64,
    /// source size.
    size: f64,
}

/// RAG status summary plan.
struct RagStatusPlan {
    /// included document count.
    total_documents: usize,
    /// healthy count.
    healthy_documents: usize,
    /// missing count.
    missing_documents: usize,
    /// stale count.
    stale_documents: usize,
    /// unknown count.
    unknown_documents: usize,
    /// excluded vault file count.
    excluded_documents: usize,
    /// total vector count from all file records.
    total_vectors: usize,
    /// update-required rows.
    update_required_documents: Vec<RagDocumentUpdatePlan>,
}

/// indexPending file selection plan.
struct IndexPendingPlan {
    /// files 배열에서 indexing이 필요한 index 목록.
    file_indices: Vec<usize>,
    /// update 대상이 아니라 skip되는 file 수.
    skipped: usize,
}

/// RAG vector indexing ETA input snapshot.
struct RagIndexingEtaInput {
    /// Host timestamp at progress emission.
    now_ms: f64,
    /// Host timestamp when indexing progress tracking started.
    started_at_ms: f64,
    /// Total file count in the current indexing job.
    total_files: usize,
    /// Fully processed file count in the current indexing job.
    completed_files: usize,
    /// Chunk count for the current file.
    current_file_total_chunks: usize,
    /// Embedded chunk count for the current file.
    current_file_embedded_chunks: usize,
    /// Estimated chunk count for the current indexing job.
    total_estimated_chunks: usize,
    /// Estimated chunk count for fully processed files.
    completed_estimated_chunks: usize,
    /// Estimated chunk count for the current file before exact chunking is known.
    current_file_estimated_chunks: usize,
    /// Exact planned chunk count for the current indexing job, when precomputed.
    total_planned_chunks: usize,
    /// Exact planned chunk count for fully processed files.
    completed_planned_chunks: usize,
    /// Whether the host finished the exact chunk planning pass.
    planning_complete: bool,
    /// Completed embedding batch durations.
    completed_batch_durations_ms: Vec<f64>,
    /// Chunk counts for completed embedding batches.
    completed_batch_chunk_counts: Vec<usize>,
    /// Completed file durations.
    completed_file_durations_ms: Vec<f64>,
    /// Actual or estimated chunk counts for completed file durations.
    completed_file_chunk_counts: Vec<usize>,
    /// Byte-estimated chunk counts for completed files.
    completed_file_estimated_chunk_counts: Vec<usize>,
    /// Actual chunk counts for completed files.
    completed_file_actual_chunk_counts: Vec<usize>,
    /// Completed non-embedding overhead durations per file.
    completed_file_overhead_durations_ms: Vec<f64>,
    /// Historical milliseconds per chunk for matching provider/model/chunk settings.
    historical_ms_per_chunk: Option<f64>,
    /// Historical actual/estimated chunk ratio for matching provider/model/chunk settings.
    historical_chunk_estimate_ratio: Option<f64>,
    /// Historical ETA rate variance for matching provider/model/chunk settings.
    historical_variance: Option<f64>,
}

/// Estimated milliseconds per chunk-like work unit.
#[derive(Clone, Copy)]
struct RagIndexingEtaRate {
    /// Average milliseconds per work unit.
    ms_per_chunk: f64,
    /// Number of samples used for the rate.
    sample_count: usize,
    /// Number of chunk-like work units represented by the samples.
    chunk_count: usize,
    /// Coefficient of variation across per-sample rates.
    coefficient_of_variation: f64,
}

/// RAG indexing ETA work basis.
#[derive(Clone, Copy)]
enum RagIndexingEtaBasis {
    /// Exact planned chunk counts are available.
    PlannedChunks,
    /// Remaining work is based on calibrated byte-derived estimates.
    CalibratedEstimate,
    /// Remaining time is based on embedding batch throughput.
    BatchRate,
    /// Remaining time is based on elapsed progress.
    ElapsedRate,
}

impl RagIndexingEtaBasis {
    /// Returns the JSON string label for this ETA basis.
    const fn as_str(self) -> &'static str {
        match self {
            Self::PlannedChunks => "planned-chunks",
            Self::CalibratedEstimate => "calibrated-estimate",
            Self::BatchRate => "batch-rate",
            Self::ElapsedRate => "elapsed-rate",
        }
    }
}

/// RAG vector indexing ETA confidence label.
#[derive(Clone, Copy)]
enum RagIndexingEtaConfidence {
    /// No reliable sample exists yet.
    Calculating,
    /// ETA is based on a weak partial sample.
    Low,
    /// ETA is based on a small completed-file sample.
    Medium,
    /// ETA is based on several completed files.
    High,
    /// Indexing is already complete.
    Complete,
}

impl RagIndexingEtaConfidence {
    /// Returns the JSON string label for this confidence level.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Calculating => "calculating",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Complete => "complete",
        }
    }
}

/// RAG vector indexing ETA output plan.
struct RagIndexingEtaPlan {
    /// Clamped total file count.
    total_files: usize,
    /// Clamped completed file count.
    completed_files: usize,
    /// Current file partial progress in `[0, 1]`.
    current_file_progress: f64,
    /// Overall indexing progress ratio in `[0, 1]`.
    progress_ratio: f64,
    /// Elapsed indexing time in milliseconds.
    elapsed_ms: f64,
    /// Estimated remaining milliseconds, when available.
    remaining_ms: Option<f64>,
    /// Estimated completion timestamp in milliseconds, when available.
    estimated_completion_ms: Option<f64>,
    /// Estimate confidence.
    confidence: RagIndexingEtaConfidence,
    /// Work and speed model basis used for the estimate.
    basis: RagIndexingEtaBasis,
    /// Lower remaining-time bound in milliseconds, when available.
    lower_remaining_ms: Option<f64>,
    /// Upper remaining-time bound in milliseconds, when available.
    upper_remaining_ms: Option<f64>,
    /// Machine-readable confidence reason.
    confidence_reason: &'static str,
}

/// `GraphRAG` status file index record snapshot.
struct GraphRagStatusFileRecordInput {
    /// file path.
    file_path: String,
    /// vector count for this file.
    vector_count: usize,
}

/// `GraphRAG` status file snapshot 후보 record.
struct GraphRagStatusFileSnapshotRecordInput {
    /// file path.
    file_path: String,
    /// vector count for this file.
    vector_count: usize,
    /// host-side processable path predicate result.
    processable: bool,
}

/// `GraphRAG` status file snapshot plan.
struct GraphRagStatusFileSnapshotPlan {
    /// file index record snapshot에서 status input에 사용할 index 목록.
    file_record_indices: Vec<usize>,
    /// candidate file count.
    total_candidate_files: usize,
}

/// `GraphRAG` status entry snapshot 후보 record.
struct GraphRagStatusEntrySnapshotInput {
    /// vector entry id.
    id: String,
    /// entry file path.
    file_path: String,
    /// host-side processable path predicate result.
    processable: bool,
}

/// `GraphRAG` status entry snapshot plan.
struct GraphRagStatusEntrySnapshotPlan {
    /// vector entry snapshot에서 status input에 사용할 index 목록.
    entry_indices: Vec<usize>,
}

/// `GraphRAG` evidence snapshot.
struct GraphRagStatusEvidenceInput {
    /// evidence file path.
    file_path: String,
    /// vector entry id.
    entry_id: String,
    /// evidence content hash.
    content_hash: String,
    /// extraction model key.
    extraction_model_key: String,
    /// host-side processable path predicate result.
    processable: bool,
}

/// `GraphRAG` extraction cache snapshot.
struct GraphRagStatusCacheInput {
    /// vector entry id.
    entry_id: String,
    /// cached content hash.
    content_hash: String,
    /// cached extraction model key.
    extraction_model_key: String,
    /// cached ontology schema id.
    ontology_schema_id: String,
    /// cached ontology schema version.
    ontology_version: u32,
    /// cached extraction parser/normalizer contract version.
    extraction_contract_version: u32,
}

/// `GraphRAG` status vector entry snapshot.
struct GraphRagStatusEntryInput {
    /// vector entry id.
    id: String,
    /// entry file path.
    file_path: String,
    /// optional precomputed content hash.
    content_hash: Option<String>,
    /// entry text for Rust content hash fallback.
    text: String,
}

impl GraphRagStatusEntryInput {
    /// contentHash metadata가 없으면 기존 TS와 같은 FNV-1a hash를 계산한다.
    fn effective_content_hash(&self) -> String {
        self.content_hash
            .clone()
            .unwrap_or_else(|| create_content_hash(&self.text))
    }
}

/// `GraphRAG` status input.
struct GraphRagStatusInput {
    /// `GraphRAG` enabled setting.
    graph_rag_enabled: bool,
    /// indexing runner currently active.
    is_running: bool,
    /// schema error count.
    schema_error_count: usize,
    /// candidate file count from vector store/vault boundary.
    total_candidate_files: usize,
    /// raw max files per run setting.
    graph_rag_max_files_per_run: f64,
    /// current extraction model key.
    graph_rag_model: String,
    /// active ontology schema id.
    ontology_schema_id: String,
    /// active ontology schema version.
    ontology_version: u32,
    /// active extraction parser/normalizer contract version.
    extraction_contract_version: u32,
    /// processable file index records.
    file_records: Vec<GraphRagStatusFileRecordInput>,
    /// graph evidence records.
    evidence: Vec<GraphRagStatusEvidenceInput>,
    /// rejected fact file paths.
    rejected_fact_file_paths: Vec<String>,
    /// pending entity merge count.
    pending_merge_count: usize,
    /// extraction cache records.
    cache_records: Vec<GraphRagStatusCacheInput>,
    /// vector entries selected by lookup plan.
    entries: Vec<GraphRagStatusEntryInput>,
}

/// `GraphRAG` index state.
#[derive(Clone, Copy, PartialEq, Eq)]
enum GraphRagIndexState {
    /// `GraphRAG` disabled.
    Disabled,
    /// no graph evidence yet.
    NotBuilt,
    /// graph indexing is running.
    Building,
    /// graph is current and no rejected facts exist.
    Ready,
    /// rejected facts exist.
    Partial,
    /// stale or orphan graph data exists.
    Stale,
    /// ontology schema has errors.
    SchemaError,
}

impl GraphRagIndexState {
    /// JSON wire-format state string.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NotBuilt => "not-built",
            Self::Building => "building",
            Self::Ready => "ready",
            Self::Partial => "partial",
            Self::Stale => "stale",
            Self::SchemaError => "schema-error",
        }
    }
}

/// `GraphRAG` status summary plan.
struct GraphRagStatusPlan {
    /// index state.
    state: GraphRagIndexState,
    /// total candidate files.
    total_candidate_files: usize,
    /// evidence record count.
    graph_evidence_count: usize,
    /// rejected fact record count.
    rejected_fact_count: usize,
    /// unique rejected fact file count.
    failed_file_count: usize,
    /// pending merge count.
    pending_merge_count: usize,
    /// unique stale file count.
    stale_file_count: usize,
    /// sorted stale file paths.
    stale_file_paths: Vec<String>,
    /// normalized max files per run.
    max_files_per_run: usize,
}

/// `GraphRAG` indexing run source mode.
#[derive(Clone, Copy, PartialEq, Eq)]
enum GraphRagRunFileSelectionMode {
    /// retry failed files.
    Failed,
    /// process stale files reported by status plan.
    Stale,
    /// full run from vector store records/indexed paths.
    Full,
}

/// `GraphRAG` run file path input row.
struct GraphRagRunFilePathInput {
    /// file path.
    file_path: String,
    /// host boundary processable predicate result.
    processable: bool,
}

/// `GraphRAG` indexing run file selection input.
struct GraphRagRunFileSelectionInput {
    /// run mode.
    mode: GraphRagRunFileSelectionMode,
    /// failed file paths from previous run.
    failed_file_paths: Vec<String>,
    /// stale file paths from status plan.
    stale_file_paths: Vec<String>,
    /// vector store file record paths.
    record_file_paths: Vec<GraphRagRunFilePathInput>,
    /// vector store indexed file paths.
    indexed_file_paths: Vec<GraphRagRunFilePathInput>,
    /// max selected files for this run.
    max_files_per_run: usize,
}

/// `GraphRAG` indexing run file selection output.
struct GraphRagRunFileSelectionPlan {
    /// all candidate file paths after filtering/sorting/deduplication.
    candidate_file_paths: Vec<String>,
    /// selected file paths limited by max files per run.
    selected_file_paths: Vec<String>,
}

/// `GraphRAG` entity resolution 후보 점수 record.
struct EntityResolutionCandidate {
    /// existing entity id.
    entity_id: String,
    /// existing ontology schema id.
    ontology_schema_id: String,
    /// existing entity type id.
    type_id: String,
    /// precomputed merge score.
    score: f64,
}

/// `GraphRAG` entity resolution plan 입력.
struct EntityResolutionInput {
    /// target ontology schema id.
    ontology_schema_id: String,
    /// target entity type id.
    type_id: String,
    /// candidate entity id.
    candidate_entity_id: String,
    /// auto merge threshold.
    auto_merge_threshold: f64,
    /// pending merge threshold.
    pending_merge_threshold: f64,
    /// existing entity candidates.
    candidates: Vec<EntityResolutionCandidate>,
}

/// `GraphRAG` entity resolution status.
enum EntityResolutionStatus {
    /// create a new entity.
    New,
    /// automatically merge into the matched entity.
    AutoMerge,
    /// leave a pending merge record.
    PendingMerge,
}

impl EntityResolutionStatus {
    /// JSON status string.
    const fn as_str(&self) -> &'static str {
        match self {
            Self::New => "new",
            Self::AutoMerge => "auto-merge",
            Self::PendingMerge => "pending-merge",
        }
    }
}

/// `GraphRAG` entity resolution output plan.
struct EntityResolutionPlan {
    /// resolution status.
    status: EntityResolutionStatus,
    /// resolved entity id.
    entity_id: String,
    /// merge score.
    merge_score: f64,
    /// optional matched entity id.
    matched_entity_id: Option<String>,
}

/// `GraphRAG` entity upsert merge input.
struct GraphEntityMergeInput {
    /// ordered aliases.
    aliases: Vec<String>,
    /// entity description.
    description: String,
    /// entity confidence.
    confidence: f64,
    /// ordered evidence ids.
    evidence_ids: Vec<String>,
    /// updated timestamp.
    updated_at: f64,
}

/// `GraphRAG` entity upsert merge plan.
struct GraphEntityMergePlan {
    /// ordered merged aliases.
    aliases: Vec<String>,
    /// merged description.
    description: String,
    /// merged confidence.
    confidence: f64,
    /// ordered merged evidence ids.
    evidence_ids: Vec<String>,
    /// next updated timestamp.
    updated_at: f64,
}

/// `GraphRAG` extraction cache hit key.
struct GraphExtractionCacheKey {
    /// cached vector entry id.
    entry_id: String,
    /// cached content hash.
    content_hash: String,
    /// cached extraction model key.
    extraction_model_key: String,
    /// cached ontology schema id.
    ontology_schema_id: String,
    /// cached ontology schema version.
    ontology_version: u32,
    /// extraction parser/normalizer contract version.
    extraction_contract_version: u32,
}

/// 기존 entry id와 incoming id에서 add mutation plan을 만든다.
fn plan_vector_store_add(
    existing_ids: &[String],
    incoming_ids: &[String],
) -> VectorStoreMutationPlan {
    if incoming_ids.is_empty() {
        return VectorStoreMutationPlan {
            sources: existing_ids
                .iter()
                .enumerate()
                .map(|(index, _)| VectorStoreEntrySourcePlan {
                    source: VectorStoreEntrySource::Existing,
                    index,
                })
                .collect(),
            removed_count: 0,
            changed: false,
        };
    }

    let mut latest_incoming_index_by_id = BTreeMap::<&str, usize>::new();
    for (index, id) in incoming_ids.iter().enumerate() {
        latest_incoming_index_by_id.insert(id.as_str(), index);
    }
    let existing_id_set = existing_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let mut used_incoming_indices = BTreeSet::<usize>::new();
    let mut sources = Vec::<VectorStoreEntrySourcePlan>::with_capacity(
        existing_ids.len().saturating_add(incoming_ids.len()),
    );

    for (index, id) in existing_ids.iter().enumerate() {
        if let Some(incoming_index) = latest_incoming_index_by_id.get(id.as_str()).copied() {
            used_incoming_indices.insert(incoming_index);
            sources.push(VectorStoreEntrySourcePlan {
                source: VectorStoreEntrySource::Incoming,
                index: incoming_index,
            });
        } else {
            sources.push(VectorStoreEntrySourcePlan {
                source: VectorStoreEntrySource::Existing,
                index,
            });
        }
    }

    for (index, id) in incoming_ids.iter().enumerate() {
        let is_latest_for_id = latest_incoming_index_by_id.get(id.as_str()).copied() == Some(index);
        if is_latest_for_id && !existing_id_set.contains(id.as_str()) {
            used_incoming_indices.insert(index);
            sources.push(VectorStoreEntrySourcePlan {
                source: VectorStoreEntrySource::Incoming,
                index,
            });
        }
    }

    VectorStoreMutationPlan {
        sources,
        removed_count: 0,
        changed: !used_incoming_indices.is_empty(),
    }
}

/// file path 기준 replacement mutation plan을 만든다.
fn plan_vector_store_replace_file(
    existing_file_paths: &[String],
    file_path: &str,
    incoming_count: usize,
) -> VectorStoreMutationPlan {
    let mut removed_count = 0usize;
    let mut sources = Vec::<VectorStoreEntrySourcePlan>::with_capacity(
        existing_file_paths.len().saturating_add(incoming_count),
    );
    for (index, existing_path) in existing_file_paths.iter().enumerate() {
        if existing_path == file_path {
            removed_count = removed_count.saturating_add(1);
        } else {
            sources.push(VectorStoreEntrySourcePlan {
                source: VectorStoreEntrySource::Existing,
                index,
            });
        }
    }
    sources.extend((0..incoming_count).map(|index| VectorStoreEntrySourcePlan {
        source: VectorStoreEntrySource::Incoming,
        index,
    }));

    VectorStoreMutationPlan {
        sources,
        removed_count,
        changed: removed_count > 0 || incoming_count > 0,
    }
}

/// file path 기준 removal mutation plan을 만든다.
fn plan_vector_store_remove_file(
    existing_file_paths: &[String],
    file_path: &str,
) -> VectorStoreMutationPlan {
    let mut removed_count = 0usize;
    let mut sources = Vec::<VectorStoreEntrySourcePlan>::with_capacity(existing_file_paths.len());
    for (index, existing_path) in existing_file_paths.iter().enumerate() {
        if existing_path == file_path {
            removed_count = removed_count.saturating_add(1);
        } else {
            sources.push(VectorStoreEntrySourcePlan {
                source: VectorStoreEntrySource::Existing,
                index,
            });
        }
    }

    VectorStoreMutationPlan {
        sources,
        removed_count,
        changed: removed_count > 0,
    }
}

/// vector store stats와 indexed path plan을 만든다.
fn plan_vector_store_stats(file_paths: &[String], now: f64) -> VectorStoreStatsPlan {
    let indexed_file_paths = file_paths
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let total_entries = file_paths.len();
    let total_files = indexed_file_paths.len();
    VectorStoreStatsPlan {
        total_entries,
        total_files,
        total_vectors: total_entries,
        average_vectors_per_file: match (usize_to_f64(total_entries), usize_to_f64(total_files)) {
            (Some(entries), Some(files)) if files > 0.0 => entries / files,
            _ => 0.0,
        },
        last_updated: (total_entries > 0).then_some(now),
        indexed_file_paths,
    }
}

/// requested file paths에 대응하는 entry index plan을 만든다.
fn plan_vector_store_lookup_by_file_paths(
    entry_file_paths: &[String],
    requested_file_paths: &[String],
) -> Vec<usize> {
    if requested_file_paths.is_empty() {
        return Vec::new();
    }
    let requested_set = requested_file_paths
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    entry_file_paths
        .iter()
        .enumerate()
        .filter_map(|(index, file_path)| {
            requested_set.contains(file_path.as_str()).then_some(index)
        })
        .collect()
}

/// requested ids 순서에 대응하는 entry index plan을 만든다.
fn plan_vector_store_lookup_by_ids(entry_ids: &[String], requested_ids: &[String]) -> Vec<usize> {
    if requested_ids.is_empty() {
        return Vec::new();
    }
    let mut index_by_id = BTreeMap::<&str, usize>::new();
    for (index, id) in entry_ids.iter().enumerate() {
        index_by_id.entry(id.as_str()).or_insert(index);
    }
    requested_ids
        .iter()
        .filter_map(|id| index_by_id.get(id.as_str()).copied())
        .collect()
}

/// RAG status summary plan을 만든다.
fn plan_rag_status(input: &RagStatusInput) -> RagStatusPlan {
    let mut record_index_by_path = BTreeMap::<&str, usize>::new();
    let mut total_vectors = 0usize;
    for (index, record) in input.records.iter().enumerate() {
        record_index_by_path.insert(record.file_path.as_str(), index);
        total_vectors = total_vectors.saturating_add(record.vector_count);
    }

    let mut healthy_documents = 0usize;
    let mut missing_documents = 0usize;
    let mut stale_documents = 0usize;
    let mut unknown_documents = 0usize;
    let mut update_required_documents =
        Vec::<RagDocumentUpdatePlan>::with_capacity(input.included_files.len());

    for file in &input.included_files {
        let record = record_index_by_path
            .get(file.path.as_str())
            .and_then(|index| input.records.get(*index));
        let (status, reason) = rag_file_index_state(file, record, input);
        match status {
            RagDocumentStatus::Healthy => {
                healthy_documents = healthy_documents.saturating_add(1);
            }
            RagDocumentStatus::Missing => {
                missing_documents = missing_documents.saturating_add(1);
                update_required_documents.push(RagDocumentUpdatePlan {
                    path: file.path.clone(),
                    status,
                    reason,
                    mtime: file.mtime,
                    size: file.size,
                });
            }
            RagDocumentStatus::Stale => {
                stale_documents = stale_documents.saturating_add(1);
                update_required_documents.push(RagDocumentUpdatePlan {
                    path: file.path.clone(),
                    status,
                    reason,
                    mtime: file.mtime,
                    size: file.size,
                });
            }
            RagDocumentStatus::Unknown => {
                unknown_documents = unknown_documents.saturating_add(1);
                update_required_documents.push(RagDocumentUpdatePlan {
                    path: file.path.clone(),
                    status,
                    reason,
                    mtime: file.mtime,
                    size: file.size,
                });
            }
        }
    }

    update_required_documents.sort_by(|left, right| {
        left.status
            .sort_order()
            .cmp(&right.status.sort_order())
            .then_with(|| left.path.cmp(&right.path))
    });

    RagStatusPlan {
        total_documents: input.included_files.len(),
        healthy_documents,
        missing_documents,
        stale_documents,
        unknown_documents,
        excluded_documents: input
            .total_vault_files
            .saturating_sub(input.included_files.len()),
        total_vectors,
        update_required_documents,
    }
}

/// file 하나의 RAG index 상태를 판정한다.
fn rag_file_index_state(
    file: &RagStatusFileInput,
    record: Option<&RagStatusRecordInput>,
    input: &RagStatusInput,
) -> (RagDocumentStatus, String) {
    let Some(record) = record else {
        return (RagDocumentStatus::Missing, input.reasons.missing.clone());
    };
    if record.vector_count == 0 {
        return (RagDocumentStatus::Missing, input.reasons.missing.clone());
    }
    if record.is_legacy_record() {
        return (RagDocumentStatus::Unknown, input.reasons.legacy.clone());
    }
    if record.source_mtime != Some(file.mtime) || record.source_size != Some(file.size) {
        return (RagDocumentStatus::Stale, input.reasons.stale_file.clone());
    }
    if record.embedding_provider.as_deref() != Some(input.embedding_provider.as_str())
        || record.embedding_model.as_deref() != Some(input.embedding_model.as_str())
    {
        return (
            RagDocumentStatus::Stale,
            input.reasons.embedding_changed.clone(),
        );
    }
    (RagDocumentStatus::Healthy, String::new())
}

/// indexPending에서 실제 indexFile을 호출할 file index plan을 만든다.
fn plan_index_pending_files(file_paths: &[String], update_paths: &[String]) -> IndexPendingPlan {
    let update_path_set = update_paths
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let file_indices = file_paths
        .iter()
        .enumerate()
        .filter_map(|(index, file_path)| {
            update_path_set
                .contains(file_path.as_str())
                .then_some(index)
        })
        .collect::<Vec<_>>();
    let skipped = file_paths.len().saturating_sub(file_indices.len());
    IndexPendingPlan {
        file_indices,
        skipped,
    }
}

/// graph store record key와 요청 key로 삭제할 record index 목록을 만든다.
/// RAG vector indexing ETA plan을 계산한다.
/// ETA work units and progress after choosing the strongest available basis.
struct RagIndexingEtaWorkEstimate {
    /// Work basis represented by the units.
    basis: RagIndexingEtaBasis,
    /// Completed chunk-like work units including current file partial work.
    progress_units: f64,
    /// Remaining chunk-like work units.
    remaining_units: f64,
    /// Overall progress ratio.
    progress_ratio: f64,
}

/// Observed actual/estimated chunk calibration.
struct RagIndexingEtaCalibration {
    /// Shrunk actual/estimated chunk ratio.
    ratio: f64,
    /// Mean absolute ratio residual.
    residual: f64,
}

/// Remaining ETA calculation before confidence labeling.
struct RagIndexingEtaEstimate {
    /// Selected speed basis.
    basis: RagIndexingEtaBasis,
    /// Estimated remaining milliseconds.
    remaining_ms: f64,
    /// Rate sample used for confidence.
    rate: Option<RagIndexingEtaRate>,
}

/// A single duration/chunk sample for robust ETA rate estimation.
struct RagIndexingEtaRateSample {
    /// Sample duration in milliseconds.
    duration_ms: f64,
    /// Sample chunk count.
    chunk_count: usize,
    /// Sample milliseconds per chunk.
    ms_per_chunk: f64,
}

/// Plans the RAG vector indexing ETA from host-collected progress samples.
fn plan_rag_indexing_eta(input: &RagIndexingEtaInput) -> RagIndexingEtaPlan {
    let total_files = input.total_files;
    let completed_files = input.completed_files.min(total_files);
    let elapsed_ms = (input.now_ms - input.started_at_ms).max(0.0).round();
    let current_file_progress = current_file_progress(input, completed_files);
    let work = estimate_rag_indexing_eta_work(input, current_file_progress);

    if total_files == 0 || completed_files >= total_files {
        return RagIndexingEtaPlan {
            total_files,
            completed_files,
            current_file_progress: 0.0,
            progress_ratio: 1.0,
            elapsed_ms,
            remaining_ms: Some(0.0),
            estimated_completion_ms: Some(input.now_ms),
            confidence: RagIndexingEtaConfidence::Complete,
            basis: complete_eta_basis(input),
            lower_remaining_ms: Some(0.0),
            upper_remaining_ms: Some(0.0),
            confidence_reason: "complete",
        };
    }

    let estimate = estimate_rag_indexing_remaining_time(input, &work, completed_files, elapsed_ms);
    let Some(estimate) = estimate else {
        return RagIndexingEtaPlan {
            total_files,
            completed_files,
            current_file_progress,
            progress_ratio: work.progress_ratio,
            elapsed_ms,
            remaining_ms: None,
            estimated_completion_ms: None,
            confidence: RagIndexingEtaConfidence::Calculating,
            basis: work.basis,
            lower_remaining_ms: None,
            upper_remaining_ms: None,
            confidence_reason: "insufficient-samples",
        };
    };

    let (confidence, confidence_reason) =
        rag_indexing_eta_confidence(input, &work, &estimate, completed_files, total_files);
    let (lower_remaining_ms, upper_remaining_ms) = rag_indexing_eta_interval(
        estimate.remaining_ms,
        confidence,
        estimate.rate.as_ref(),
        input,
    );
    RagIndexingEtaPlan {
        total_files,
        completed_files,
        current_file_progress,
        progress_ratio: work.progress_ratio,
        elapsed_ms,
        remaining_ms: Some(estimate.remaining_ms),
        estimated_completion_ms: Some(input.now_ms + estimate.remaining_ms),
        confidence,
        basis: estimate.basis,
        lower_remaining_ms: Some(lower_remaining_ms),
        upper_remaining_ms: Some(upper_remaining_ms),
        confidence_reason,
    }
}

/// Current file progress를 `[0, 1]`로 제한한다.
fn current_file_progress(input: &RagIndexingEtaInput, completed_files: usize) -> f64 {
    if completed_files >= input.total_files || input.current_file_total_chunks == 0 {
        return 0.0;
    }
    let embedded_chunks = input
        .current_file_embedded_chunks
        .min(input.current_file_total_chunks);
    let Some(embedded) = usize_to_f64(embedded_chunks) else {
        return 0.0;
    };
    let Some(total) = usize_to_f64(input.current_file_total_chunks) else {
        return 0.0;
    };
    clamp_unit_score(embedded / total)
}

/// Complete jobs keep their strongest available work basis.
const fn complete_eta_basis(input: &RagIndexingEtaInput) -> RagIndexingEtaBasis {
    if input.planning_complete {
        RagIndexingEtaBasis::PlannedChunks
    } else if input.historical_chunk_estimate_ratio.is_some()
        || !input.completed_file_actual_chunk_counts.is_empty()
    {
        RagIndexingEtaBasis::CalibratedEstimate
    } else {
        RagIndexingEtaBasis::ElapsedRate
    }
}

/// Chooses exact planned chunks, calibrated estimates, or raw estimates for work progress.
fn estimate_rag_indexing_eta_work(
    input: &RagIndexingEtaInput,
    current_file_progress: f64,
) -> RagIndexingEtaWorkEstimate {
    if input.planning_complete && input.total_planned_chunks > 0 {
        return planned_rag_indexing_eta_work(input, current_file_progress);
    }
    if let Some(calibration) = observed_rag_indexing_eta_calibration(input) {
        return calibrated_rag_indexing_eta_work(
            input,
            current_file_progress,
            Some(calibration.ratio),
        );
    }
    if let Some(ratio) = finite_positive(input.historical_chunk_estimate_ratio) {
        return calibrated_rag_indexing_eta_work(input, current_file_progress, Some(ratio));
    }
    raw_estimated_rag_indexing_eta_work(input, current_file_progress)
}

/// Builds a planned-chunk work estimate.
fn planned_rag_indexing_eta_work(
    input: &RagIndexingEtaInput,
    current_file_progress: f64,
) -> RagIndexingEtaWorkEstimate {
    let total_units = usize_to_f64(input.total_planned_chunks)
        .filter(|total| *total > 0.0)
        .unwrap_or(1.0);
    let completed_planned_chunks = input
        .completed_planned_chunks
        .min(input.total_planned_chunks);
    let completed_units = usize_to_f64(completed_planned_chunks).unwrap_or(0.0);
    let current_units =
        usize_to_f64(input.current_file_total_chunks).unwrap_or(0.0) * current_file_progress;
    let progress_units = (completed_units + current_units).clamp(0.0, total_units);
    let remaining_units = (total_units - progress_units).max(0.0);
    RagIndexingEtaWorkEstimate {
        basis: RagIndexingEtaBasis::PlannedChunks,
        progress_units,
        remaining_units,
        progress_ratio: clamp_unit_score(progress_units / total_units),
    }
}

/// Builds a calibrated-estimate work estimate.
fn calibrated_rag_indexing_eta_work(
    input: &RagIndexingEtaInput,
    current_file_progress: f64,
    ratio: Option<f64>,
) -> RagIndexingEtaWorkEstimate {
    let ratio = ratio.unwrap_or(1.0).max(0.05);
    let completed_actual_chunks = input
        .completed_file_actual_chunk_counts
        .iter()
        .copied()
        .fold(0_usize, usize::saturating_add);
    let completed_units = if completed_actual_chunks > 0 {
        usize_to_f64(completed_actual_chunks).unwrap_or(0.0)
    } else {
        usize_to_f64(input.completed_estimated_chunks).unwrap_or(0.0) * ratio
    };
    let current_total_units = if input.current_file_total_chunks > 0 {
        usize_to_f64(input.current_file_total_chunks).unwrap_or(0.0)
    } else {
        usize_to_f64(input.current_file_estimated_chunks).unwrap_or(0.0) * ratio
    };
    let current_units = current_total_units * current_file_progress;
    let total_estimated_chunks = input.total_estimated_chunks.max(input.total_files);
    let completed_estimated_chunks = input.completed_estimated_chunks.min(total_estimated_chunks);
    let remaining_after_completed =
        total_estimated_chunks.saturating_sub(completed_estimated_chunks);
    let remaining_units = usize_to_f64(remaining_after_completed)
        .unwrap_or(0.0)
        .mul_add(ratio, -current_units)
        .max(0.0);
    let total_units = (completed_units + current_units + remaining_units).max(1.0);
    let progress_units = (completed_units + current_units).clamp(0.0, total_units);
    RagIndexingEtaWorkEstimate {
        basis: RagIndexingEtaBasis::CalibratedEstimate,
        progress_units,
        remaining_units: (total_units - progress_units).max(0.0),
        progress_ratio: clamp_unit_score(progress_units / total_units),
    }
}

/// Builds a raw estimated work estimate when no calibration exists.
fn raw_estimated_rag_indexing_eta_work(
    input: &RagIndexingEtaInput,
    current_file_progress: f64,
) -> RagIndexingEtaWorkEstimate {
    let total_estimated_chunks = input.total_estimated_chunks.max(input.total_files);
    let completed_estimated_chunks = input.completed_estimated_chunks.min(total_estimated_chunks);
    let current_completed_chunks =
        current_file_completed_estimated_chunks(input, current_file_progress);
    let progress_units = completed_estimated_chunks_to_f64(completed_estimated_chunks)
        .map_or(0.0, |completed| completed + current_completed_chunks);
    let progress_ratio = estimated_chunk_progress_ratio(total_estimated_chunks, progress_units);
    let remaining_units =
        remaining_estimated_chunk_units(total_estimated_chunks, progress_units).unwrap_or(0.0);
    RagIndexingEtaWorkEstimate {
        basis: RagIndexingEtaBasis::ElapsedRate,
        progress_units,
        remaining_units,
        progress_ratio,
    }
}

/// Overall file progress ratio를 계산한다.
fn current_file_completed_estimated_chunks(
    input: &RagIndexingEtaInput,
    current_file_progress: f64,
) -> f64 {
    let estimated_chunks = input
        .current_file_estimated_chunks
        .max(input.current_file_total_chunks);
    let Some(estimated_chunks) = usize_to_f64(estimated_chunks) else {
        return 0.0;
    };
    estimated_chunks * current_file_progress.clamp(0.0, 1.0)
}

/// Estimated chunk work 기준 전체 진행률을 계산한다.
fn estimated_chunk_progress_ratio(total_estimated_chunks: usize, progress_chunks: f64) -> f64 {
    if total_estimated_chunks == 0 {
        return 1.0;
    }
    let Some(total) = usize_to_f64(total_estimated_chunks) else {
        return 0.0;
    };
    clamp_unit_score(progress_chunks.max(0.0) / total)
}

/// Completed file units plus current file partial unit.
fn completed_estimated_chunks_to_f64(completed_estimated_chunks: usize) -> Option<f64> {
    usize_to_f64(completed_estimated_chunks)
}

/// Remaining file-equivalent units.
fn remaining_estimated_chunk_units(
    total_estimated_chunks: usize,
    progress_chunks: f64,
) -> Option<f64> {
    let total = usize_to_f64(total_estimated_chunks)?;
    Some((total - progress_chunks.max(0.0)).max(0.0))
}

/// Positive finite values의 평균을 계산한다.
fn average_completed_file_chunk_ms(
    durations_ms: &[f64],
    chunk_counts: &[usize],
) -> Option<RagIndexingEtaRate> {
    weighted_average_ms_per_chunk(durations_ms, chunk_counts)
}

/// Completed batch samples에서 chunk당 평균 시간을 계산한다.
fn average_completed_batch_chunk_ms(
    durations_ms: &[f64],
    chunk_counts: &[usize],
) -> Option<RagIndexingEtaRate> {
    weighted_average_ms_per_chunk(durations_ms, chunk_counts)
}

/// Duration/unit samples에서 weighted average milliseconds per chunk를 계산한다.
fn weighted_average_ms_per_chunk(
    durations_ms: &[f64],
    chunk_counts: &[usize],
) -> Option<RagIndexingEtaRate> {
    let mut samples = Vec::new();
    for (duration_ms, chunk_count) in durations_ms.iter().zip(chunk_counts.iter().copied()) {
        if !duration_ms.is_finite() || *duration_ms <= 0.0 || chunk_count == 0 {
            continue;
        }
        let chunk_units = usize_to_f64(chunk_count)?;
        samples.push(RagIndexingEtaRateSample {
            duration_ms: *duration_ms,
            chunk_count,
            ms_per_chunk: *duration_ms / chunk_units,
        });
    }
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|left, right| left.ms_per_chunk.total_cmp(&right.ms_per_chunk));
    let trim = usize::from(samples.len() >= 5);
    let observed_sample_count = samples.len();
    let observed_chunk_count = samples
        .iter()
        .map(|sample| sample.chunk_count)
        .fold(0_usize, usize::saturating_add);
    let selected_len = samples.len().saturating_sub(trim.saturating_mul(2));
    let mut total_duration = 0.0;
    let mut total_chunks = 0_usize;
    let mut rates = Vec::with_capacity(selected_len);
    for sample in samples.iter().skip(trim).take(selected_len) {
        total_duration += sample.duration_ms;
        total_chunks = total_chunks.saturating_add(sample.chunk_count);
        rates.push(sample.ms_per_chunk);
    }
    let total_chunk_units = usize_to_f64(total_chunks)?;
    if total_chunk_units <= 0.0 {
        return None;
    }
    let ms_per_chunk = total_duration / total_chunk_units;
    Some(RagIndexingEtaRate {
        ms_per_chunk,
        sample_count: observed_sample_count,
        chunk_count: observed_chunk_count,
        coefficient_of_variation: coefficient_of_variation(&rates, ms_per_chunk),
    })
}

/// Estimates remaining milliseconds from phase-aware speed samples.
fn estimate_rag_indexing_remaining_time(
    input: &RagIndexingEtaInput,
    work: &RagIndexingEtaWorkEstimate,
    completed_files: usize,
    elapsed_ms: f64,
) -> Option<RagIndexingEtaEstimate> {
    let batch_rate = average_completed_batch_chunk_ms(
        &input.completed_batch_durations_ms,
        &input.completed_batch_chunk_counts,
    );
    let file_rate = average_completed_file_chunk_ms(
        &input.completed_file_durations_ms,
        &input.completed_file_chunk_counts,
    );
    let selected_rate = select_rag_indexing_eta_rate(batch_rate, file_rate);
    let overhead_ms_per_file = trimmed_average_ms(&input.completed_file_overhead_durations_ms)
        .unwrap_or(0.0)
        .max(0.0);
    if let Some(rate) = selected_rate {
        let basis = match work.basis {
            RagIndexingEtaBasis::PlannedChunks => RagIndexingEtaBasis::PlannedChunks,
            RagIndexingEtaBasis::CalibratedEstimate => RagIndexingEtaBasis::CalibratedEstimate,
            RagIndexingEtaBasis::ElapsedRate | RagIndexingEtaBasis::BatchRate => {
                RagIndexingEtaBasis::BatchRate
            }
        };
        let remaining_ms = remaining_ms_from_rate(
            input,
            work,
            completed_files,
            rate.ms_per_chunk,
            overhead_ms_per_file,
        )?;
        return Some(RagIndexingEtaEstimate {
            basis,
            remaining_ms,
            rate: Some(rate),
        });
    }
    if let Some(historical_ms_per_chunk) = finite_positive(input.historical_ms_per_chunk) {
        let remaining_ms = remaining_ms_from_rate(
            input,
            work,
            completed_files,
            historical_ms_per_chunk,
            overhead_ms_per_file,
        )?;
        return Some(RagIndexingEtaEstimate {
            basis: work.basis,
            remaining_ms,
            rate: None,
        });
    }
    if work.progress_units > 0.0 && elapsed_ms > 0.0 {
        let elapsed_rate = elapsed_ms / work.progress_units;
        let remaining_ms = round_non_negative_millis(work.remaining_units * elapsed_rate)?;
        return Some(RagIndexingEtaEstimate {
            basis: RagIndexingEtaBasis::ElapsedRate,
            remaining_ms,
            rate: None,
        });
    }
    None
}

/// Chooses the most stable current run rate sample.
const fn select_rag_indexing_eta_rate(
    batch_rate: Option<RagIndexingEtaRate>,
    file_rate: Option<RagIndexingEtaRate>,
) -> Option<RagIndexingEtaRate> {
    match (batch_rate, file_rate) {
        (Some(batch), Some(file)) => {
            if batch.sample_count >= 3 || file.sample_count < 3 {
                Some(batch)
            } else {
                Some(file)
            }
        }
        (Some(batch), None) => Some(batch),
        (None, Some(file)) => Some(file),
        (None, None) => None,
    }
}

/// Computes remaining milliseconds from chunk rate and per-file overhead.
fn remaining_ms_from_rate(
    input: &RagIndexingEtaInput,
    work: &RagIndexingEtaWorkEstimate,
    completed_files: usize,
    ms_per_chunk: f64,
    overhead_ms_per_file: f64,
) -> Option<f64> {
    let remaining_files = input.total_files.saturating_sub(completed_files);
    let remaining_file_units = usize_to_f64(remaining_files).unwrap_or(0.0);
    round_non_negative_millis(
        work.remaining_units
            .mul_add(ms_per_chunk, remaining_file_units * overhead_ms_per_file),
    )
}

/// Labels ETA confidence and reason from basis, progress, variance, and calibration quality.
fn rag_indexing_eta_confidence(
    input: &RagIndexingEtaInput,
    work: &RagIndexingEtaWorkEstimate,
    estimate: &RagIndexingEtaEstimate,
    completed_files: usize,
    total_files: usize,
) -> (RagIndexingEtaConfidence, &'static str) {
    let rate_sample_count = estimate.rate.as_ref().map_or(0, |rate| rate.sample_count);
    let rate_chunk_count = estimate.rate.as_ref().map_or(0, |rate| rate.chunk_count);
    let rate_variation = estimate.rate.as_ref().map_or_else(
        || input.historical_variance.unwrap_or(1.0).sqrt(),
        |rate| rate.coefficient_of_variation,
    );
    match estimate.basis {
        RagIndexingEtaBasis::PlannedChunks => {
            if input.planning_complete
                && work.progress_ratio >= 0.2
                && rate_sample_count >= 5
                && rate_chunk_count >= 50
                && rate_variation <= 0.15
                && completed_files < total_files
            {
                (RagIndexingEtaConfidence::High, "planned-stable")
            } else if input.planning_complete
                && rate_sample_count >= 3
                && work.progress_ratio >= 0.05
            {
                if rate_variation > 0.35 {
                    (RagIndexingEtaConfidence::Medium, "planned-variable-rate")
                } else {
                    (RagIndexingEtaConfidence::Medium, "planned-partial")
                }
            } else {
                (RagIndexingEtaConfidence::Low, "insufficient-samples")
            }
        }
        RagIndexingEtaBasis::CalibratedEstimate => {
            if rate_sample_count >= 3 && work.progress_ratio >= 0.05 {
                if observed_rag_indexing_eta_calibration(input)
                    .is_some_and(|calibration| calibration.residual > 0.35)
                {
                    (RagIndexingEtaConfidence::Medium, "calibration-variable")
                } else {
                    (RagIndexingEtaConfidence::Medium, "calibrated-estimate")
                }
            } else {
                (RagIndexingEtaConfidence::Low, "calibrated-estimate")
            }
        }
        RagIndexingEtaBasis::BatchRate => (RagIndexingEtaConfidence::Low, "batch-rate-only"),
        RagIndexingEtaBasis::ElapsedRate => (RagIndexingEtaConfidence::Low, "elapsed-rate-only"),
    }
}

/// Computes a confidence interval for the remaining estimate.
fn rag_indexing_eta_interval(
    remaining_ms: f64,
    confidence: RagIndexingEtaConfidence,
    rate: Option<&RagIndexingEtaRate>,
    input: &RagIndexingEtaInput,
) -> (f64, f64) {
    let variation = rate.map_or_else(
        || input.historical_variance.unwrap_or(0.25).sqrt(),
        |rate| rate.coefficient_of_variation,
    );
    let factor = match confidence {
        RagIndexingEtaConfidence::High => (variation * 1.96).clamp(0.05, 0.10),
        RagIndexingEtaConfidence::Medium => (variation * 1.96).clamp(0.20, 0.60),
        RagIndexingEtaConfidence::Low | RagIndexingEtaConfidence::Calculating => {
            (variation * 1.96).clamp(0.50, 1.00)
        }
        RagIndexingEtaConfidence::Complete => 0.0,
    };
    (
        (remaining_ms * (1.0 - factor)).max(0.0).round(),
        (remaining_ms * (1.0 + factor)).max(0.0).round(),
    )
}

/// Observes actual/estimated chunk calibration with shrinkage toward a prior.
fn observed_rag_indexing_eta_calibration(
    input: &RagIndexingEtaInput,
) -> Option<RagIndexingEtaCalibration> {
    let mut actual_total = 0.0;
    let mut estimated_total = 0.0;
    let mut ratios = Vec::new();
    for (estimated, actual) in input
        .completed_file_estimated_chunk_counts
        .iter()
        .copied()
        .zip(input.completed_file_actual_chunk_counts.iter().copied())
    {
        if estimated == 0 || actual == 0 {
            continue;
        }
        let estimated = usize_to_f64(estimated)?;
        let actual = usize_to_f64(actual)?;
        estimated_total += estimated;
        actual_total += actual;
        ratios.push(actual / estimated);
    }
    if estimated_total <= 0.0 || actual_total <= 0.0 {
        return None;
    }
    let observed_ratio = actual_total / estimated_total;
    let prior_ratio = finite_positive(input.historical_chunk_estimate_ratio).unwrap_or(1.0);
    let sample_count_f64 = usize_to_f64(ratios.len()).unwrap_or(0.0);
    let shrinkage = sample_count_f64 / (sample_count_f64 + 4.0);
    let ratio = observed_ratio * shrinkage + prior_ratio * (1.0 - shrinkage);
    let residual = mean_absolute_ratio_residual(&ratios, observed_ratio);
    Some(RagIndexingEtaCalibration {
        ratio: ratio.max(0.05),
        residual,
    })
}

/// Mean absolute residual for actual/estimated ratio observations.
fn mean_absolute_ratio_residual(ratios: &[f64], observed_ratio: f64) -> f64 {
    if ratios.is_empty() || observed_ratio <= 0.0 {
        return 0.0;
    }
    let total = ratios
        .iter()
        .map(|ratio| ((*ratio - observed_ratio).abs()) / observed_ratio)
        .sum::<f64>();
    total / usize_to_f64(ratios.len()).unwrap_or(1.0)
}

/// Trimmed average for non-chunk overhead samples.
fn trimmed_average_ms(values: &[f64]) -> Option<f64> {
    let mut samples = values
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .collect::<Vec<_>>();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(f64::total_cmp);
    let trim = usize::from(samples.len() >= 5);
    let selected_len = samples.len().saturating_sub(trim.saturating_mul(2));
    let count = usize_to_f64(selected_len)?;
    Some(samples.iter().skip(trim).take(selected_len).sum::<f64>() / count)
}

/// Coefficient of variation for sample rates.
fn coefficient_of_variation(values: &[f64], mean: f64) -> f64 {
    if values.len() < 2 || mean <= 0.0 || !mean.is_finite() {
        return 0.0;
    }
    let count = usize_to_f64(values.len()).unwrap_or(1.0);
    let variance = values
        .iter()
        .map(|value| {
            let delta = *value - mean;
            delta * delta
        })
        .sum::<f64>()
        / count;
    variance.sqrt() / mean
}

/// Returns finite positive optional values.
fn finite_positive(value: Option<f64>) -> Option<f64> {
    value.filter(|number| number.is_finite() && *number > 0.0)
}

// Removed old remaining-chunk helper; ETA now uses estimated chunk work units.

/// Millisecond estimate를 non-negative integer-like JSON number로 반올림한다.
const fn round_non_negative_millis(value: f64) -> Option<f64> {
    if !value.is_finite() {
        return None;
    }
    Some(value.max(0.0).round())
}

/// graph store record key? ?붿껌 key濡???젣??record index 紐⑸줉??留뚮뱺??
fn plan_graph_deletion_indices(record_keys: &[String], requested_keys: &[String]) -> Vec<usize> {
    if record_keys.is_empty() || requested_keys.is_empty() {
        return Vec::new();
    }
    let requested_key_set = requested_keys
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    record_keys
        .iter()
        .enumerate()
        .filter_map(|(index, key)| requested_key_set.contains(key.as_str()).then_some(index))
        .collect()
}

/// ordered evidence score에서 존재하는 evidence 후보와 필요한 file path를 계산한다.
fn plan_graph_evidence_candidate_lookup(
    scores: &[EvidenceScoreById],
    evidence: &[GraphEvidenceLookupRecord],
) -> GraphEvidenceCandidateLookupPlan {
    let mut evidence_index_by_id = BTreeMap::<&str, usize>::new();
    for (index, record) in evidence.iter().enumerate() {
        evidence_index_by_id
            .entry(record.id.as_str())
            .or_insert(index);
    }

    let mut plan = GraphEvidenceCandidateLookupPlan {
        score_indices: Vec::new(),
        evidence_indices: Vec::new(),
        file_paths: Vec::new(),
    };
    for (score_index, score) in scores.iter().enumerate() {
        let Some(evidence_index) = evidence_index_by_id
            .get(score.evidence_id.as_str())
            .copied()
        else {
            continue;
        };
        plan.score_indices.push(score_index);
        plan.evidence_indices.push(evidence_index);
        if let Some(file_path) = evidence
            .get(evidence_index)
            .map(|record| record.file_path.as_str())
            && !plan.file_paths.iter().any(|existing| existing == file_path)
        {
            plan.file_paths.push(file_path.to_owned());
        }
    }
    plan
}

/// evidence candidate entry id와 vector entry snapshot에서 최종 candidate index를 계산한다.
fn plan_graph_evidence_entry_candidates(
    candidate_entry_ids: &[String],
    entries: &[GraphEvidenceEntryRecord],
    candidate_limit: usize,
) -> GraphEvidenceEntryCandidatePlan {
    if candidate_limit == 0 || candidate_entry_ids.is_empty() || entries.is_empty() {
        return GraphEvidenceEntryCandidatePlan {
            candidate_indices: Vec::new(),
            entry_indices: Vec::new(),
        };
    }

    let mut entry_index_by_id = BTreeMap::<&str, usize>::new();
    for (index, entry) in entries.iter().enumerate() {
        entry_index_by_id.entry(entry.id.as_str()).or_insert(index);
    }

    let mut seen_entry_ids = BTreeSet::<String>::new();
    let mut plan = GraphEvidenceEntryCandidatePlan {
        candidate_indices: Vec::new(),
        entry_indices: Vec::new(),
    };
    for (candidate_index, entry_id) in candidate_entry_ids.iter().enumerate() {
        if plan.candidate_indices.len() >= candidate_limit {
            break;
        }
        let Some(entry_index) = entry_index_by_id.get(entry_id.as_str()).copied() else {
            continue;
        };
        let Some(entry) = entries.get(entry_index) else {
            continue;
        };
        if !entry.compatible || !seen_entry_ids.insert(entry.id.clone()) {
            continue;
        }
        plan.candidate_indices.push(candidate_index);
        plan.entry_indices.push(entry_index);
    }
    plan
}

/// mention names와 graph snapshot에서 entity/relation index plan을 계산한다.
fn plan_graph_mention_context(
    mention_names: &[String],
    entities: &[GraphMentionEntity],
    relations: &[GraphMentionRelation],
) -> GraphMentionContextPlan {
    let mentioned_names = mention_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect::<BTreeSet<_>>();
    let mut matched_entity_indices = Vec::new();
    let mut matched_entity_ids = BTreeSet::new();

    for (index, entity) in entities.iter().enumerate() {
        let canonical_match = mentioned_names.contains(&entity.canonical_name.to_lowercase());
        let alias_match = entity
            .aliases
            .iter()
            .any(|alias| mentioned_names.contains(&alias.to_lowercase()));
        if canonical_match || alias_match {
            matched_entity_indices.push(index);
            matched_entity_ids.insert(entity.id.clone());
        }
    }

    let matched_relation_indices = relations
        .iter()
        .enumerate()
        .filter_map(|(index, relation)| {
            (matched_entity_ids.contains(&relation.source_entity_id)
                || matched_entity_ids.contains(&relation.target_entity_id))
            .then_some(index)
        })
        .collect::<Vec<_>>();
    let context_lines = plan_graph_mention_context_lines(
        entities,
        relations,
        &matched_entity_indices,
        &matched_relation_indices,
    );

    GraphMentionContextPlan {
        matched_entity_indices,
        matched_relation_indices,
        context_lines,
    }
}

/// Graph mention context block에 표시할 line plan을 계산한다.
fn plan_graph_mention_context_lines(
    entities: &[GraphMentionEntity],
    relations: &[GraphMentionRelation],
    matched_entity_indices: &[usize],
    matched_relation_indices: &[usize],
) -> Vec<String> {
    if matched_entity_indices.is_empty() {
        return Vec::new();
    }

    let entity_name_by_id = entities
        .iter()
        .map(|entity| (entity.id.as_str(), entity.canonical_name.as_str()))
        .collect::<BTreeMap<_, _>>();
    let mut lines = vec![
        "[Graph Knowledge Context]".to_owned(),
        String::new(),
        "## Matched Entities".to_owned(),
    ];

    for entity_index in matched_entity_indices.iter().copied().take(10) {
        let Some(entity) = entities.get(entity_index) else {
            continue;
        };
        let aliases = if entity.aliases.is_empty() {
            String::new()
        } else {
            format!(" (aka {})", entity.aliases.join(", "))
        };
        lines.push(format!(
            "- [{}] {}{}",
            entity.type_id, entity.canonical_name, aliases
        ));
        if let Some(description) = entity
            .description
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            lines.push(format!(
                "  {}",
                truncate_utf16_scalar_boundary(description, 200).0
            ));
        }
    }

    let mut has_relation_heading = false;
    for relation_index in matched_relation_indices.iter().copied().take(15) {
        let Some(relation) = relations.get(relation_index) else {
            continue;
        };
        if !has_relation_heading {
            lines.push(String::new());
            lines.push("## Related Relations".to_owned());
            has_relation_heading = true;
        }
        let source = entity_name_by_id
            .get(relation.source_entity_id.as_str())
            .copied()
            .unwrap_or(relation.source_entity_id.as_str());
        let target = entity_name_by_id
            .get(relation.target_entity_id.as_str())
            .copied()
            .unwrap_or(relation.target_entity_id.as_str());
        lines.push(format!(
            "- {} → [{}] → {}",
            source, relation.relation_type_id, target
        ));
        if let Some(description) = relation
            .description
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            lines.push(format!(
                "  {}",
                truncate_utf16_scalar_boundary(description, 150).0
            ));
        }
    }

    lines
}

/// claim entity names를 graph entity id 목록으로 해석한다.
fn plan_graph_claim_entity_ids(
    entity_names: &[String],
    lookup_records: &[GraphClaimEntityLookupRecord],
) -> Vec<String> {
    let mut entity_id_by_name = BTreeMap::<String, &str>::new();
    for record in lookup_records {
        let normalized = normalize_graph_name(&record.name);
        if normalized.is_empty() {
            continue;
        }
        entity_id_by_name
            .entry(normalized)
            .or_insert(record.entity_id.as_str());
    }

    entity_names
        .iter()
        .filter_map(|name| {
            let normalized = normalize_graph_name(name);
            entity_id_by_name
                .get(&normalized)
                .map(|entity_id| (*entity_id).to_owned())
        })
        .collect()
}

/// relation source/target names를 accepted entity index pair 목록으로 해석한다.
fn plan_graph_relation_endpoint_indices(
    relations: &[GraphRelationEndpointInput],
    lookup_records: &[GraphRelationEndpointLookupRecord],
    entity_count: usize,
) -> Vec<Option<GraphRelationEndpointPair>> {
    let mut entity_index_by_name = BTreeMap::<String, usize>::new();
    for record in lookup_records {
        if record.entity_index >= entity_count {
            continue;
        }
        let normalized = normalize_graph_name(&record.name);
        if normalized.is_empty() {
            continue;
        }
        entity_index_by_name
            .entry(normalized)
            .or_insert(record.entity_index);
    }

    relations
        .iter()
        .map(|relation| {
            let source_name = normalize_graph_name(&relation.source);
            let target_name = normalize_graph_name(&relation.target);
            let source_entity_index = *entity_index_by_name.get(&source_name)?;
            let target_entity_index = *entity_index_by_name.get(&target_name)?;
            Some(GraphRelationEndpointPair {
                source_entity_index,
                target_entity_index,
            })
        })
        .collect()
}

/// type id 목록이 schema type set에 포함되는지 입력 순서대로 계산한다.
fn plan_type_membership(type_ids: &[String], schema_type_ids: &[String]) -> Vec<bool> {
    let known_type_ids = schema_type_ids
        .iter()
        .map(|type_id| type_id.trim())
        .filter(|type_id| !type_id.is_empty())
        .collect::<BTreeSet<_>>();

    type_ids
        .iter()
        .map(|type_id| known_type_ids.contains(type_id.trim()))
        .collect()
}

/// community id별 entity/relation/claim snapshot index group을 계산한다.
fn plan_graph_community_summary_groups(
    assignments: &[GraphCommunityAssignmentInput],
    entity_ids: &[String],
    relations: &[GraphCommunitySummaryRelationInput],
    claims: &[GraphCommunitySummaryClaimInput],
    community_ids: &[usize],
) -> Vec<GraphCommunitySummaryGroupPlan> {
    let mut groups = community_ids
        .iter()
        .map(|_| GraphCommunitySummaryGroupPlan::default())
        .collect::<Vec<_>>();
    let group_index_by_community_id = community_ids
        .iter()
        .enumerate()
        .map(|(index, community_id)| (*community_id, index))
        .collect::<BTreeMap<_, _>>();
    let entity_index_by_id = entity_ids
        .iter()
        .enumerate()
        .map(|(index, entity_id)| (entity_id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut community_id_by_entity_id = BTreeMap::<String, usize>::new();

    for assignment in assignments {
        let Some(group_index) = group_index_by_community_id.get(&assignment.community_id) else {
            continue;
        };
        let Some(entity_index) = entity_index_by_id.get(assignment.entity_id.as_str()) else {
            continue;
        };
        if let Some(group) = groups.get_mut(*group_index) {
            group.entities.push(*entity_index);
        }
        community_id_by_entity_id
            .entry(assignment.entity_id.clone())
            .or_insert(assignment.community_id);
    }

    for (relation_index, relation) in relations.iter().enumerate() {
        let Some(source_community_id) =
            community_id_by_entity_id.get(relation.source_entity_id.as_str())
        else {
            continue;
        };
        let Some(target_community_id) =
            community_id_by_entity_id.get(relation.target_entity_id.as_str())
        else {
            continue;
        };
        if source_community_id != target_community_id {
            continue;
        }
        let Some(group_index) = group_index_by_community_id.get(source_community_id) else {
            continue;
        };
        if let Some(group) = groups.get_mut(*group_index) {
            group.relations.push(relation_index);
        }
    }

    for (claim_index, claim) in claims.iter().enumerate() {
        for entity_id in &claim.entity_ids {
            let Some(community_id) = community_id_by_entity_id.get(entity_id) else {
                continue;
            };
            let Some(group_index) = group_index_by_community_id.get(community_id) else {
                continue;
            };
            if let Some(group) = groups.get_mut(*group_index) {
                group.claims.push(claim_index);
            }
            break;
        }
    }

    groups
}

/// configured mode와 planner 결과를 최종 query action으로 변환한다.
fn plan_graph_query_execution(
    configured_mode: &str,
    planned_mode: &str,
    evidence_first: bool,
) -> Option<GraphQueryExecutionPlan> {
    match configured_mode {
        "global" => Some(GraphQueryExecutionPlan {
            action: "global",
            requires_planner: false,
        }),
        "local" => Some(GraphQueryExecutionPlan {
            action: "local",
            requires_planner: true,
        }),
        "hybrid" => Some(GraphQueryExecutionPlan {
            action: "hybrid",
            requires_planner: true,
        }),
        "auto" => plan_auto_graph_query_execution(planned_mode, evidence_first),
        _ => None,
    }
}

/// auto mode에서 planner 결과를 실행 action으로 변환한다.
fn plan_auto_graph_query_execution(
    planned_mode: &str,
    evidence_first: bool,
) -> Option<GraphQueryExecutionPlan> {
    let action = match planned_mode {
        "none" => "none",
        "hybrid" => "hybrid",
        "global" => "global",
        "local" if evidence_first => "evidence-first",
        "local" => "local",
        _ => return None,
    };
    Some(GraphQueryExecutionPlan {
        action,
        requires_planner: true,
    })
}

/// `GraphRAG` status 계산에 필요한 entry id를 evidence 우선 순서로 dedupe한다.
fn plan_graph_rag_status_entry_lookups(
    evidence_entry_ids: &[String],
    cache_entry_ids: &[String],
) -> Vec<String> {
    let mut seen = BTreeSet::<String>::new();
    let mut entry_ids = Vec::<String>::new();
    for entry_id in evidence_entry_ids.iter().chain(cache_entry_ids.iter()) {
        if seen.insert(entry_id.clone()) {
            entry_ids.push(entry_id.clone());
        }
    }
    entry_ids
}

/// `GraphRAG` status file record와 fallback indexed path snapshot을 status 후보 plan으로 만든다.
fn plan_graph_rag_status_file_snapshot(
    file_records: &[GraphRagStatusFileSnapshotRecordInput],
    indexed_file_paths: &[GraphRagRunFilePathInput],
) -> GraphRagStatusFileSnapshotPlan {
    let mut seen_record_paths = BTreeSet::<String>::new();
    let mut file_record_indices = Vec::<usize>::new();
    for (index, record) in file_records.iter().enumerate() {
        if record.vector_count == 0
            || !record.processable
            || !is_graph_rag_markdown_file_path(&record.file_path)
        {
            continue;
        }
        if seen_record_paths.insert(record.file_path.clone()) {
            file_record_indices.push(index);
        }
    }
    if !file_record_indices.is_empty() {
        return GraphRagStatusFileSnapshotPlan {
            total_candidate_files: file_record_indices.len(),
            file_record_indices,
        };
    }

    let total_candidate_files = sorted_unique_graph_rag_markdown_paths(
        indexed_file_paths
            .iter()
            .filter(|row| row.processable)
            .map(|row| row.file_path.as_str()),
    )
    .len();
    GraphRagStatusFileSnapshotPlan {
        file_record_indices,
        total_candidate_files,
    }
}

/// `GraphRAG` status entry snapshot에서 사용할 vector entry index를 계산한다.
fn plan_graph_rag_status_entry_snapshot(
    entries: &[GraphRagStatusEntrySnapshotInput],
) -> GraphRagStatusEntrySnapshotPlan {
    let mut seen_entry_ids = BTreeSet::<String>::new();
    let mut entry_indices = Vec::<usize>::new();
    for (index, entry) in entries.iter().enumerate() {
        if !entry.processable || !is_graph_rag_markdown_file_path(&entry.file_path) {
            continue;
        }
        if seen_entry_ids.insert(entry.id.clone()) {
            entry_indices.push(index);
        }
    }
    GraphRagStatusEntrySnapshotPlan { entry_indices }
}

/// file path 목록에서 `GraphRAG` markdown path만 입력 순서대로 고른다.
fn plan_graph_rag_markdown_file_paths(file_paths: &[String]) -> Vec<String> {
    file_paths
        .iter()
        .filter(|file_path| is_graph_rag_markdown_file_path(file_path))
        .cloned()
        .collect()
}

/// `GraphRAG` indexing run의 candidate/selected file path plan을 만든다.
fn plan_graph_rag_run_file_selection(
    input: &GraphRagRunFileSelectionInput,
) -> GraphRagRunFileSelectionPlan {
    let max_files_per_run = input.max_files_per_run.max(1);
    let candidate_file_paths = match input.mode {
        GraphRagRunFileSelectionMode::Failed => sorted_unique_graph_rag_markdown_paths(
            input.failed_file_paths.iter().map(String::as_str),
        ),
        GraphRagRunFileSelectionMode::Stale => sorted_unique_graph_rag_markdown_paths(
            input.stale_file_paths.iter().map(String::as_str),
        ),
        GraphRagRunFileSelectionMode::Full => {
            let source = if input.record_file_paths.is_empty() {
                &input.indexed_file_paths
            } else {
                &input.record_file_paths
            };
            sorted_unique_graph_rag_markdown_paths(
                source
                    .iter()
                    .filter(|row| row.processable)
                    .map(|row| row.file_path.as_str()),
            )
        }
    };
    let selected_file_paths = candidate_file_paths
        .iter()
        .take(max_files_per_run)
        .cloned()
        .collect();
    GraphRagRunFileSelectionPlan {
        candidate_file_paths,
        selected_file_paths,
    }
}

/// unsupported graph data prune 대상 file path를 계산한다.
fn plan_graph_rag_unsupported_prune_paths(
    evidence: &[GraphRagRunFilePathInput],
    rejected_facts: &[GraphRagRunFilePathInput],
) -> Vec<String> {
    let mut seen = BTreeSet::<String>::new();
    let mut paths = Vec::<String>::new();
    for row in evidence.iter().chain(rejected_facts.iter()) {
        if row.processable || row.file_path.is_empty() {
            continue;
        }
        if seen.insert(row.file_path.clone()) {
            paths.push(row.file_path.clone());
        }
    }
    paths
}

/// Markdown path를 dedupe/sort해 run candidate list로 만든다.
fn sorted_unique_graph_rag_markdown_paths<'a>(
    file_paths: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let mut seen = BTreeSet::<String>::new();
    for file_path in file_paths {
        if is_graph_rag_markdown_file_path(file_path) {
            seen.insert(file_path.to_owned());
        }
    }
    seen.into_iter().collect()
}

/// `GraphRAG` markdown extension 정책을 판정한다.
fn is_graph_rag_markdown_file_path(file_path: &str) -> bool {
    file_path.to_lowercase().ends_with(".md")
}

/// `GraphRAG` status summary plan을 만든다.
fn plan_graph_rag_status(input: &GraphRagStatusInput) -> GraphRagStatusPlan {
    let max_files_per_run =
        normalize_graph_rag_max_files_per_run(input.graph_rag_max_files_per_run);
    if let Some(plan) = graph_rag_status_early_plan(input, max_files_per_run) {
        return plan;
    }

    let failed_file_count = count_unique_strings(&input.rejected_fact_file_paths);
    if input.is_running {
        return graph_rag_building_status(input, failed_file_count, max_files_per_run);
    }
    let graph_evidence_count = input.evidence.len();
    if graph_evidence_count == 0 {
        return graph_rag_not_built_status(input, failed_file_count, max_files_per_run);
    }

    let stale_file_paths = collect_graph_rag_stale_files(input)
        .into_iter()
        .collect::<Vec<_>>();
    let state = determine_graph_rag_status_state(&stale_file_paths, failed_file_count);

    GraphRagStatusPlan {
        state,
        total_candidate_files: input.total_candidate_files,
        graph_evidence_count,
        rejected_fact_count: input.rejected_fact_file_paths.len(),
        failed_file_count,
        pending_merge_count: input.pending_merge_count,
        stale_file_count: stale_file_paths.len(),
        stale_file_paths,
        max_files_per_run,
    }
}

/// `GraphRAG` status에서 비활성/스키마 오류 상태를 먼저 처리한다.
const fn graph_rag_status_early_plan(
    input: &GraphRagStatusInput,
    max_files_per_run: usize,
) -> Option<GraphRagStatusPlan> {
    if !input.graph_rag_enabled {
        return Some(empty_graph_rag_status(
            GraphRagIndexState::Disabled,
            input.total_candidate_files,
            max_files_per_run,
        ));
    }
    if input.schema_error_count > 0 {
        return Some(empty_graph_rag_status(
            GraphRagIndexState::SchemaError,
            input.total_candidate_files,
            max_files_per_run,
        ));
    }
    None
}

/// 아직 evidence가 없는 `GraphRAG` status를 만든다.
const fn graph_rag_not_built_status(
    input: &GraphRagStatusInput,
    failed_file_count: usize,
    max_files_per_run: usize,
) -> GraphRagStatusPlan {
    GraphRagStatusPlan {
        state: GraphRagIndexState::NotBuilt,
        total_candidate_files: input.total_candidate_files,
        graph_evidence_count: 0,
        rejected_fact_count: input.rejected_fact_file_paths.len(),
        failed_file_count,
        pending_merge_count: input.pending_merge_count,
        stale_file_count: 0,
        stale_file_paths: Vec::new(),
        max_files_per_run,
    }
}

/// 실행 중인 `GraphRAG` status에서도 기존 대상/실패 수는 유지한다.
const fn graph_rag_building_status(
    input: &GraphRagStatusInput,
    failed_file_count: usize,
    max_files_per_run: usize,
) -> GraphRagStatusPlan {
    GraphRagStatusPlan {
        state: GraphRagIndexState::Building,
        total_candidate_files: input.total_candidate_files,
        graph_evidence_count: input.evidence.len(),
        rejected_fact_count: input.rejected_fact_file_paths.len(),
        failed_file_count,
        pending_merge_count: input.pending_merge_count,
        stale_file_count: 0,
        stale_file_paths: Vec::new(),
        max_files_per_run,
    }
}

/// stale로 봐야 하는 `GraphRAG` file path를 계산한다.
fn collect_graph_rag_stale_files(input: &GraphRagStatusInput) -> BTreeSet<String> {
    let cache_by_entry_id = input
        .cache_records
        .iter()
        .map(|record| (record.entry_id.as_str(), record))
        .collect::<BTreeMap<_, _>>();
    let entries_by_id = input
        .entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect::<BTreeMap<_, _>>();
    let mut stale_files = BTreeSet::<String>::new();

    mark_unprocessable_or_removed_evidence(input, &mut stale_files);
    mark_missing_cache_entries(input, &entries_by_id, &mut stale_files);
    mark_stale_evidence_content(input, &entries_by_id, &mut stale_files);
    let fresh_cache_count_by_file_path =
        collect_fresh_graph_rag_cache_counts(input, &cache_by_entry_id, &mut stale_files);
    mark_incomplete_graph_rag_file_records(
        input,
        &fresh_cache_count_by_file_path,
        &mut stale_files,
    );

    stale_files
}

/// processable 대상에서 벗어난 evidence를 stale로 표시한다.
fn mark_unprocessable_or_removed_evidence(
    input: &GraphRagStatusInput,
    stale_files: &mut BTreeSet<String>,
) {
    let vector_file_paths = input
        .file_records
        .iter()
        .map(|record| record.file_path.as_str())
        .collect::<BTreeSet<_>>();

    for record in &input.evidence {
        if !record.processable || !vector_file_paths.contains(record.file_path.as_str()) {
            stale_files.insert(record.file_path.clone());
        }
    }
}

/// cache가 가리키는 vector entry가 없어졌으면 stale로 표시한다.
fn mark_missing_cache_entries(
    input: &GraphRagStatusInput,
    entries_by_id: &BTreeMap<&str, &GraphRagStatusEntryInput>,
    stale_files: &mut BTreeSet<String>,
) {
    for record in &input.cache_records {
        if !entries_by_id.contains_key(record.entry_id.as_str()) {
            stale_files.insert(file_path_for_missing_graph_entry(
                &record.entry_id,
                &input.evidence,
            ));
        }
    }
}

/// evidence hash/model이 현재 vector entry와 다르면 stale로 표시한다.
fn mark_stale_evidence_content(
    input: &GraphRagStatusInput,
    entries_by_id: &BTreeMap<&str, &GraphRagStatusEntryInput>,
    stale_files: &mut BTreeSet<String>,
) {
    for record in &input.evidence {
        let Some(entry) = entries_by_id.get(record.entry_id.as_str()) else {
            stale_files.insert(record.file_path.clone());
            continue;
        };
        let content_hash = entry.effective_content_hash();
        if record.content_hash != content_hash
            || record.extraction_model_key != input.graph_rag_model
        {
            stale_files.insert(record.file_path.clone());
        }
    }
}

/// 현재 schema/model과 일치하는 extraction cache 수를 file path별로 센다.
fn collect_fresh_graph_rag_cache_counts(
    input: &GraphRagStatusInput,
    cache_by_entry_id: &BTreeMap<&str, &GraphRagStatusCacheInput>,
    stale_files: &mut BTreeSet<String>,
) -> BTreeMap<String, usize> {
    let mut fresh_counts = BTreeMap::<String, usize>::new();
    for entry in &input.entries {
        let content_hash = entry.effective_content_hash();
        let Some(cache) = cache_by_entry_id.get(entry.id.as_str()) else {
            stale_files.insert(entry.file_path.clone());
            continue;
        };
        if cache.content_hash != content_hash
            || cache.extraction_model_key != input.graph_rag_model
            || cache.ontology_schema_id != input.ontology_schema_id
            || cache.ontology_version != input.ontology_version
            || cache.extraction_contract_version != input.extraction_contract_version
        {
            stale_files.insert(entry.file_path.clone());
            continue;
        }
        let count = fresh_counts.entry(entry.file_path.clone()).or_insert(0);
        *count = count.saturating_add(1);
    }
    fresh_counts
}

/// vector count보다 fresh cache가 적은 file을 stale로 표시한다.
fn mark_incomplete_graph_rag_file_records(
    input: &GraphRagStatusInput,
    fresh_cache_count_by_file_path: &BTreeMap<String, usize>,
    stale_files: &mut BTreeSet<String>,
) {
    for record in &input.file_records {
        let fresh_cache_count = fresh_cache_count_by_file_path
            .get(&record.file_path)
            .copied()
            .unwrap_or_default();
        if fresh_cache_count < record.vector_count {
            stale_files.insert(record.file_path.clone());
        }
    }
}

/// stale/failed 상태로 최종 `GraphRAG` index state를 결정한다.
const fn determine_graph_rag_status_state(
    stale_file_paths: &[String],
    failed_file_count: usize,
) -> GraphRagIndexState {
    if stale_file_paths.is_empty() {
        if failed_file_count > 0 {
            GraphRagIndexState::Partial
        } else {
            GraphRagIndexState::Ready
        }
    } else {
        GraphRagIndexState::Stale
    }
}

/// `GraphRAG` entity resolution 최종 상태를 계산한다.
fn plan_entity_resolution(input: &EntityResolutionInput) -> EntityResolutionPlan {
    let best_match = input
        .candidates
        .iter()
        .filter(|candidate| {
            candidate.ontology_schema_id == input.ontology_schema_id
                && candidate.type_id == input.type_id
        })
        .fold(
            None,
            |best: Option<&EntityResolutionCandidate>, candidate| {
                if best.is_none_or(|best_candidate| candidate.score > best_candidate.score) {
                    Some(candidate)
                } else {
                    best
                }
            },
        );

    let Some(best_match) = best_match else {
        return EntityResolutionPlan {
            status: EntityResolutionStatus::New,
            entity_id: input.candidate_entity_id.clone(),
            merge_score: 0.0,
            matched_entity_id: None,
        };
    };

    if best_match.score >= input.auto_merge_threshold {
        return EntityResolutionPlan {
            status: EntityResolutionStatus::AutoMerge,
            entity_id: best_match.entity_id.clone(),
            merge_score: best_match.score,
            matched_entity_id: Some(best_match.entity_id.clone()),
        };
    }

    if best_match.score >= input.pending_merge_threshold {
        return EntityResolutionPlan {
            status: EntityResolutionStatus::PendingMerge,
            entity_id: input.candidate_entity_id.clone(),
            merge_score: best_match.score,
            matched_entity_id: Some(best_match.entity_id.clone()),
        };
    }

    EntityResolutionPlan {
        status: EntityResolutionStatus::New,
        entity_id: input.candidate_entity_id.clone(),
        merge_score: best_match.score,
        matched_entity_id: Some(best_match.entity_id.clone()),
    }
}

/// `GraphRAG` entity upsert merge field plan을 계산한다.
fn plan_graph_entity_merge(
    existing: &GraphEntityMergeInput,
    next: &GraphEntityMergeInput,
) -> GraphEntityMergePlan {
    GraphEntityMergePlan {
        aliases: merge_ordered_strings(&existing.aliases, &next.aliases),
        description: if next.description.is_empty() {
            existing.description.clone()
        } else {
            next.description.clone()
        },
        confidence: existing.confidence.max(next.confidence),
        evidence_ids: merge_ordered_strings(&existing.evidence_ids, &next.evidence_ids),
        updated_at: next.updated_at,
    }
}

/// 두 string 배열을 순서 보존 dedupe로 병합한다.
fn merge_ordered_strings(left: &[String], right: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::<&str>::new();
    let mut merged = Vec::<String>::new();
    for value in left.iter().chain(right.iter()) {
        if seen.insert(value.as_str()) {
            merged.push(value.clone());
        }
    }
    merged
}

/// entity id 참조를 교체하고 요청된 경우 순서를 보존해 중복을 제거한다.
fn rewrite_graph_entity_references(
    references: &[String],
    candidate_entity_id: &str,
    existing_entity_id: &str,
    deduplicate: bool,
) -> Vec<String> {
    let mut rewritten = Vec::<String>::with_capacity(references.len());
    let mut seen = BTreeSet::<String>::new();
    for reference in references {
        let value = if reference == candidate_entity_id {
            existing_entity_id
        } else {
            reference
        };
        if !deduplicate || seen.insert(value.to_owned()) {
            rewritten.push(value.to_owned());
        }
    }
    rewritten
}

/// extraction cache snapshot이 현재 extraction key와 일치하는지 판정한다.
fn graph_extraction_cache_hit(
    cached: &GraphExtractionCacheKey,
    input: &GraphExtractionCacheKey,
) -> bool {
    cached.entry_id == input.entry_id
        && cached.content_hash == input.content_hash
        && cached.extraction_model_key == input.extraction_model_key
        && cached.ontology_schema_id == input.ontology_schema_id
        && cached.ontology_version == input.ontology_version
        && cached.extraction_contract_version == input.extraction_contract_version
}

/// 문자열 목록의 unique count를 반환한다.
fn count_unique_strings(values: &[String]) -> usize {
    values.iter().collect::<BTreeSet<_>>().len()
}

/// `GraphRAG` maxFilesPerRun 설정을 기존 `TS` 계약처럼 1 이상 정수로 정규화한다.
fn normalize_graph_rag_max_files_per_run(value: f64) -> usize {
    if !value.is_finite() {
        return 1;
    }
    let floored = value.floor();
    if floored < 1.0 {
        return 1;
    }
    floored.to_string().parse::<usize>().unwrap_or(usize::MAX)
}

/// 초기/비활성 `GraphRAG` status를 만든다.
const fn empty_graph_rag_status(
    state: GraphRagIndexState,
    total_candidate_files: usize,
    max_files_per_run: usize,
) -> GraphRagStatusPlan {
    GraphRagStatusPlan {
        state,
        total_candidate_files,
        graph_evidence_count: 0,
        rejected_fact_count: 0,
        failed_file_count: 0,
        pending_merge_count: 0,
        stale_file_count: 0,
        stale_file_paths: Vec::new(),
        max_files_per_run,
    }
}

/// missing entry id가 어느 file에서 왔는지 evidence 우선으로 복구한다.
fn file_path_for_missing_graph_entry(
    entry_id: &str,
    evidence: &[GraphRagStatusEvidenceInput],
) -> String {
    evidence
        .iter()
        .find_map(|record| (record.entry_id == entry_id).then_some(record.file_path.clone()))
        .unwrap_or_else(|| entry_id.split("::").next().unwrap_or(entry_id).to_owned())
}

/// RAG file type summary 입력 row.
struct RagFileTypeInput {
    /// vault file path.
    file_path: String,
    /// Obsidian file extension 값.
    extension: Option<String>,
    /// TS host boundary가 판단한 RAG indexable 여부.
    indexable: bool,
    /// indexable이 아닐 때 UI에 표시할 제외 추천 사유.
    recommendation_reason: Option<String>,
}

/// RAG 후보 판정에 필요한 vault file metadata snapshot.
struct RagFileEligibilityInput {
    /// 입력 배열 내 원본 index.
    index: usize,
    /// vault file path.
    file_path: String,
    /// vault file name.
    file_name: String,
    /// Obsidian file extension 값.
    extension: String,
    /// file size in bytes.
    size: u64,
}

/// TS host boundary가 읽은 unknown file text sample.
struct RagFileTextProbeInput {
    /// `RagFileEligibilityInput` 원본 index.
    index: usize,
    /// host read 성공 여부.
    readable: bool,
    /// file 시작 부분 text sample.
    sample: String,
}

/// RAG file type count 출력 row.
struct RagFileTypeCountPlan {
    /// normalized extension key.
    extension: String,
    /// UI 표시 label.
    label: String,
    /// file count.
    count: usize,
}

/// RAG exclude recommendation 출력 row.
struct RagExcludeRecommendationPlan {
    /// normalized extension key.
    extension: String,
    /// UI 표시 label.
    label: String,
    /// file count.
    count: usize,
    /// UI 표시 reason.
    reason: String,
}

/// assistant 답변에서 추출한 source reference 종류.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SourceReferenceKind {
    /// Obsidian `[[path]]` wikilink 참조.
    Wikilink,
    /// Markdown `[label](path.md)` 링크 참조.
    MarkdownLink,
    /// `Source rag-1` 같은 source id 참조.
    SourceId,
}

impl SourceReferenceKind {
    /// TS wire format에 쓰는 kind 문자열을 반환한다.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Wikilink => "wikilink",
            Self::MarkdownLink => "markdown-link",
            Self::SourceId => "source-id",
        }
    }
}

/// assistant 답변의 source reference와 vault path alias plan.
struct SourceReferencePlan {
    /// 답변에 나온 원문 label.
    label: String,
    /// 검증할 source id 또는 vault path target.
    target: String,
    /// 참조 종류.
    kind: SourceReferenceKind,
    /// vault path alias 후보.
    aliases: Vec<String>,
}

/// source validation warning 종류.
enum SourceWarningKind {
    /// vault에 없는 링크 참조.
    MissingLink,
    /// verified citation 목록에 없는 source id 참조.
    UnverifiedSource,
}

impl SourceWarningKind {
    /// TS wire format에 쓰는 kind 문자열을 반환한다.
    const fn as_str(&self) -> &'static str {
        match self {
            Self::MissingLink => "missing-link",
            Self::UnverifiedSource => "unverified-source",
        }
    }
}

/// source validation warning의 deterministic key/label/kind plan.
struct SourceValidationWarningPlan {
    /// warning dedupe key.
    id: String,
    /// UI에 표시할 원문 label.
    label: String,
    /// warning 종류.
    kind: SourceWarningKind,
}

/// source validation wrapper가 host boundary에 넘길 deterministic 입력 plan.
struct SourceValidationInputPlan {
    /// verified citation id 목록.
    verified_citation_ids: Vec<String>,
    /// verified citation file path 목록.
    verified_paths: Vec<String>,
    /// vault 존재 확인을 수행할 alias 후보.
    alias_candidates: Vec<String>,
}

/// assistant question 출처.
#[derive(Clone, Copy, PartialEq, Eq)]
enum AssistantQuestionSource {
    /// answer content에서 직접 감지한 질문.
    Answer,
    /// reasoning leak에서 감지한 질문.
    ReasoningLeak,
}

impl AssistantQuestionSource {
    /// TS wire format에 쓰는 source 문자열을 반환한다.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Answer => "answer",
            Self::ReasoningLeak => "reasoning-leak",
        }
    }
}

/// assistant question 선택 모드.
enum AssistantSelectionMode {
    /// 단일 선택.
    Single,
    /// 다중 선택.
    Multiple,
}

impl AssistantSelectionMode {
    /// TS wire format에 쓰는 selectionMode 문자열을 반환한다.
    const fn as_str(&self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::Multiple => "multiple",
        }
    }
}

/// assistant question 선택지.
struct AssistantChoicePlan {
    /// choice id.
    id: String,
    /// 사용자 표시 label.
    label: String,
}

/// assistant 응답에서 감지한 질문 plan.
struct AssistantQuestionPlan {
    /// 사용자에게 표시할 prompt.
    prompt: String,
    /// 선택지 목록.
    choices: Vec<AssistantChoicePlan>,
    /// 선택 모드.
    selection_mode: AssistantSelectionMode,
    /// 자유 입력 허용 여부.
    allow_free_text: bool,
    /// 질문 출처.
    source: AssistantQuestionSource,
}

/// `GraphRAG` store pruning 계산 입력.
struct GraphPruneInput<'a> {
    /// 삭제 대상 file path.
    file_paths: Vec<&'a str>,
    /// evidence file path 목록.
    evidence_file_paths: Vec<&'a str>,
    /// evidence entry id 목록.
    evidence_entry_ids: Vec<&'a str>,
    /// entity ontology schema id 목록.
    entity_schema_ids: Vec<&'a str>,
    /// entity별 evidence offset.
    entity_evidence_offsets: &'a [u32],
    /// entity별 evidence index.
    entity_evidence_indices: &'a [u32],
    /// relation ontology schema id 목록.
    relation_schema_ids: Vec<&'a str>,
    /// relation source entity index 목록.
    relation_source_entity_indices: &'a [u32],
    /// relation target entity index 목록.
    relation_target_entity_indices: &'a [u32],
    /// relation별 evidence offset.
    relation_evidence_offsets: &'a [u32],
    /// relation별 evidence index.
    relation_evidence_indices: &'a [u32],
    /// claim별 entity offset.
    claim_entity_offsets: &'a [u32],
    /// claim별 entity index.
    claim_entity_indices: &'a [u32],
    /// claim별 relation offset.
    claim_relation_offsets: &'a [u32],
    /// claim별 relation index.
    claim_relation_indices: &'a [u32],
    /// claim별 evidence offset.
    claim_evidence_offsets: &'a [u32],
    /// claim별 evidence index.
    claim_evidence_indices: &'a [u32],
    /// community ontology schema id 목록.
    community_schema_ids: Vec<&'a str>,
    /// community별 entity offset.
    community_entity_offsets: &'a [u32],
    /// community별 entity index.
    community_entity_indices: &'a [u32],
    /// community별 relation offset.
    community_relation_offsets: &'a [u32],
    /// community별 relation index.
    community_relation_indices: &'a [u32],
    /// community별 claim offset.
    community_claim_offsets: &'a [u32],
    /// community별 claim index.
    community_claim_indices: &'a [u32],
    /// rejected fact file path 목록.
    rejected_fact_file_paths: Vec<&'a str>,
    /// rejected fact entry id 목록.
    rejected_fact_entry_ids: Vec<&'a str>,
    /// extraction cache entry id 목록.
    extraction_cache_entry_ids: Vec<&'a str>,
    /// pending merge existing entity index 목록.
    pending_merge_existing_entity_indices: &'a [u32],
    /// pending merge candidate entity index 목록.
    pending_merge_candidate_entity_indices: &'a [u32],
}

/// `GraphRAG` store pruning index 결과.
#[derive(Default)]
struct GraphPrunePlan {
    /// 삭제할 evidence index.
    deleted_evidence: Vec<usize>,
    /// 삭제할 entity index.
    deleted_entities: Vec<usize>,
    /// evidenceIds만 갱신할 entity index.
    updated_entities: Vec<usize>,
    /// 갱신할 entity별 남은 evidence index.
    updated_entity_evidence: Vec<Vec<usize>>,
    /// 삭제할 relation index.
    deleted_relations: Vec<usize>,
    /// evidenceIds만 갱신할 relation index.
    updated_relations: Vec<usize>,
    /// 갱신할 relation별 남은 evidence index.
    updated_relation_evidence: Vec<Vec<usize>>,
    /// 삭제할 claim index.
    deleted_claims: Vec<usize>,
    /// entity/relation/evidence reference를 갱신할 claim index.
    updated_claims: Vec<usize>,
    /// 갱신할 claim별 남은 entity index.
    updated_claim_entities: Vec<Vec<usize>>,
    /// 갱신할 claim별 남은 relation index.
    updated_claim_relations: Vec<Vec<usize>>,
    /// 갱신할 claim별 남은 evidence index.
    updated_claim_evidence: Vec<Vec<usize>>,
    /// 삭제할 community index.
    deleted_communities: Vec<usize>,
    /// 삭제할 rejected fact index.
    deleted_rejected_facts: Vec<usize>,
    /// 삭제할 extraction cache index.
    deleted_extraction_cache: Vec<usize>,
    /// 삭제할 pending merge index.
    deleted_pending_merges: Vec<usize>,
}

/// Graph prune wire config count 묶음.
struct GraphPruneCounts {
    /// 삭제 대상 file path 수.
    file_paths: usize,
    /// evidence record 수.
    evidence: usize,
    /// entity record 수.
    entities: usize,
    /// entity evidence flat reference 수.
    entity_evidence_refs: usize,
    /// relation record 수.
    relations: usize,
    /// relation evidence flat reference 수.
    relation_evidence_refs: usize,
    /// claim record 수.
    claims: usize,
    /// claim entity flat reference 수.
    claim_entity_refs: usize,
    /// claim relation flat reference 수.
    claim_relation_refs: usize,
    /// claim evidence flat reference 수.
    claim_evidence_refs: usize,
    /// community record 수.
    communities: usize,
    /// community entity flat reference 수.
    community_entity_refs: usize,
    /// community relation flat reference 수.
    community_relation_refs: usize,
    /// community claim flat reference 수.
    community_claim_refs: usize,
    /// rejected fact record 수.
    rejected_facts: usize,
    /// extraction cache record 수.
    extraction_cache: usize,
    /// pending merge record 수.
    pending_merges: usize,
}

/// Graph prune wire string section 묶음.
struct GraphPruneStrings<'a> {
    /// 삭제 대상 file path.
    file_paths: Vec<&'a str>,
    /// evidence file path.
    evidence_files: Vec<&'a str>,
    /// evidence entry id.
    evidence_entries: Vec<&'a str>,
    /// entity schema id.
    entity_schemas: Vec<&'a str>,
    /// relation schema id.
    relation_schemas: Vec<&'a str>,
    /// community schema id.
    community_schemas: Vec<&'a str>,
    /// rejected fact file path.
    rejected_files: Vec<&'a str>,
    /// rejected fact entry id.
    rejected_entries: Vec<&'a str>,
    /// extraction cache entry id.
    cache_entries: Vec<&'a str>,
}

/// Graph prune flattened index section 묶음.
struct GraphPruneIndexSlices<'a> {
    /// entity evidence offsets.
    entity_evidence_offsets: &'a [u32],
    /// entity evidence refs.
    entity_evidence: &'a [u32],
    /// relation source entity refs.
    relation_sources: &'a [u32],
    /// relation target entity refs.
    relation_targets: &'a [u32],
    /// relation evidence offsets.
    relation_evidence_offsets: &'a [u32],
    /// relation evidence refs.
    relation_evidence: &'a [u32],
    /// claim entity offsets.
    claim_entity_offsets: &'a [u32],
    /// claim entity refs.
    claim_entities: &'a [u32],
    /// claim relation offsets.
    claim_relation_offsets: &'a [u32],
    /// claim relation refs.
    claim_relations: &'a [u32],
    /// claim evidence offsets.
    claim_evidence_offsets: &'a [u32],
    /// claim evidence refs.
    claim_evidence: &'a [u32],
    /// community entity offsets.
    community_entity_offsets: &'a [u32],
    /// community entity refs.
    community_entities: &'a [u32],
    /// community relation offsets.
    community_relation_offsets: &'a [u32],
    /// community relation refs.
    community_relations: &'a [u32],
    /// community claim offsets.
    community_claim_offsets: &'a [u32],
    /// community claim refs.
    community_claims: &'a [u32],
    /// pending merge existing entity refs.
    pending_existing_entities: &'a [u32],
    /// pending merge candidate entity refs.
    pending_candidate_entities: &'a [u32],
}

/// 채팅 mention 후보.
struct MentionCandidate {
    /// 원문 mention 문자열.
    raw: String,
    /// resolver에 넘길 mention 이름.
    name: String,
}

/// parsed input으로 local evidence score list를 계산한다.
fn score_local_evidence(input: &LocalEvidenceInput<'_>) -> Option<Vec<LocalEvidenceScore>> {
    let mut state = LocalEvidenceState::new(input.entity_count);
    let mut evidence_scores = Vec::<LocalEvidenceScore>::new();
    let mut sequence = 0_usize;

    initialize_local_evidence_matches(input, &mut state, &mut evidence_scores, &mut sequence)?;
    add_local_claim_evidence_scores(
        input,
        &state.entity_scores,
        &state.entity_distances,
        &state.entity_known,
        &mut evidence_scores,
        &mut sequence,
    );

    for depth in 1..=input.traversal_depth {
        if !state.frontier.iter().any(|is_frontier| *is_frontier) {
            break;
        }
        advance_local_evidence_depth(
            input,
            depth,
            &mut state,
            &mut evidence_scores,
            &mut sequence,
        )?;
        add_local_claim_evidence_scores(
            input,
            &state.entity_scores,
            &state.entity_distances,
            &state.entity_known,
            &mut evidence_scores,
            &mut sequence,
        );
    }

    evidence_scores.sort_by(compare_local_evidence_scores_descending);
    Some(evidence_scores)
}

/// mentioned match의 entity/evidence score를 초기화한다.
fn initialize_local_evidence_matches(
    input: &LocalEvidenceInput<'_>,
    state: &mut LocalEvidenceState,
    evidence_scores: &mut Vec<LocalEvidenceScore>,
    sequence: &mut usize,
) -> Option<()> {
    for match_index in 0..input.match_count {
        let entity_index = input.entity_index_for_match(match_index)?;
        let raw_score = input.match_scores.get(match_index).copied()?;
        let entity_score = clamp_unit_score(raw_score);
        if let Some(score_slot) = state.entity_scores.get_mut(entity_index) {
            *score_slot = score_slot.max(entity_score);
        }
        if let Some(known_slot) = state.entity_known.get_mut(entity_index) {
            *known_slot = true;
        }
        if let Some(distance_slot) = state.entity_distances.get_mut(entity_index) {
            *distance_slot = 0;
        }
        if let Some(frontier_slot) = state.frontier.get_mut(entity_index) {
            *frontier_slot = true;
        }
        push_evidence_scores_for_item(
            input.match_evidence_offsets,
            input.match_evidence_indices,
            match_index,
            clamp_unit_score(entity_score.mul_add(0.35, 0.55)),
            input.evidence_count,
            evidence_scores,
            sequence,
        );
    }
    Some(())
}

/// 한 traversal depth의 relation score propagation을 수행한다.
fn advance_local_evidence_depth(
    input: &LocalEvidenceInput<'_>,
    depth: usize,
    state: &mut LocalEvidenceState,
    evidence_scores: &mut Vec<LocalEvidenceScore>,
    sequence: &mut usize,
) -> Option<()> {
    let mut next_frontier = vec![false; input.entity_count];
    let depth_minus_one = usize_to_f64(depth.saturating_sub(1))?;
    let distance_factor = 1.0 / depth_minus_one.mul_add(0.45, 1.0);

    for relation_index in 0..input.relation_count {
        let source_index = input.entity_index_for_relation_source(relation_index)?;
        let target_index = input.entity_index_for_relation_target(relation_index)?;
        let source_score = state
            .entity_scores
            .get(source_index)
            .copied()
            .unwrap_or_default();
        let target_score = state
            .entity_scores
            .get(target_index)
            .copied()
            .unwrap_or_default();
        let touches_frontier = state.frontier.get(source_index).copied().unwrap_or(false)
            || state.frontier.get(target_index).copied().unwrap_or(false);
        if !touches_frontier || (source_score == 0.0 && target_score == 0.0) {
            continue;
        }

        let confidence = input.relation_confidences.get(relation_index).copied()?;
        let relation_score =
            clamp_unit_score(source_score.max(target_score) * confidence * distance_factor);
        push_evidence_scores_for_item(
            input.relation_evidence_offsets,
            input.relation_evidence_indices,
            relation_index,
            relation_score,
            input.evidence_count,
            evidence_scores,
            sequence,
        );
        update_relation_endpoint_scores(
            state,
            &mut next_frontier,
            source_index,
            target_index,
            depth,
            relation_score,
        );
    }

    state.frontier = next_frontier;
    Some(())
}

/// 새 relation endpoint entity의 score/frontier 상태를 갱신한다.
fn update_relation_endpoint_scores(
    state: &mut LocalEvidenceState,
    next_frontier: &mut [bool],
    source_index: usize,
    target_index: usize,
    depth: usize,
    relation_score: f64,
) {
    for entity_index in [source_index, target_index] {
        if state
            .entity_known
            .get(entity_index)
            .copied()
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(score_slot) = state.entity_scores.get_mut(entity_index) {
            *score_slot = clamp_unit_score(relation_score * 0.82);
        }
        if let Some(distance_slot) = state.entity_distances.get_mut(entity_index) {
            *distance_slot = depth;
        }
        if let Some(known_slot) = state.entity_known.get_mut(entity_index) {
            *known_slot = true;
        }
        if let Some(frontier_slot) = next_frontier.get_mut(entity_index) {
            *frontier_slot = true;
        }
    }
}

/// `GraphRAG` record snapshot을 local evidence numeric input으로 변환한다.
fn plan_local_evidence_input_from_records(
    matches: &[LocalEvidenceMatchRecord],
    relations: &[LocalEvidenceRelationRecord],
    claims: &[LocalEvidenceClaimRecord],
    traversal_depth: usize,
) -> Option<PlannedLocalEvidenceInput> {
    let mut entity_ids = Vec::<String>::new();
    let mut entity_index_by_id = BTreeMap::<String, u32>::new();
    let mut evidence_ids = Vec::<String>::new();
    let mut evidence_index_by_id = BTreeMap::<String, u32>::new();
    let mut input = OwnedLocalEvidenceInput {
        entity_count: 0,
        evidence_count: 0,
        traversal_depth,
        match_entity_indices: Vec::with_capacity(matches.len()),
        match_scores: Vec::with_capacity(matches.len()),
        match_evidence_offsets: vec![0],
        match_evidence_indices: Vec::new(),
        relation_source_indices: Vec::with_capacity(relations.len()),
        relation_target_indices: Vec::with_capacity(relations.len()),
        relation_confidences: Vec::with_capacity(relations.len()),
        relation_evidence_offsets: vec![0],
        relation_evidence_indices: Vec::new(),
        claim_entity_offsets: vec![0],
        claim_entity_indices: Vec::new(),
        claim_confidences: Vec::with_capacity(claims.len()),
        claim_evidence_offsets: vec![0],
        claim_evidence_indices: Vec::new(),
    };

    for record in matches {
        input.match_entity_indices.push(local_evidence_string_index(
            &mut entity_index_by_id,
            &mut entity_ids,
            &record.entity_id,
        )?);
        input.match_scores.push(clamp_unit_score(
            record.match_score * record.entity_confidence,
        ));
        push_local_evidence_indices(
            &record.evidence_ids,
            &mut evidence_index_by_id,
            &mut evidence_ids,
            &mut input.match_evidence_indices,
        )?;
        push_local_evidence_offset(
            &mut input.match_evidence_offsets,
            input.match_evidence_indices.len(),
        )?;
    }

    for record in relations {
        input
            .relation_source_indices
            .push(local_evidence_string_index(
                &mut entity_index_by_id,
                &mut entity_ids,
                &record.source_entity_id,
            )?);
        input
            .relation_target_indices
            .push(local_evidence_string_index(
                &mut entity_index_by_id,
                &mut entity_ids,
                &record.target_entity_id,
            )?);
        input.relation_confidences.push(record.confidence);
        push_local_evidence_indices(
            &record.evidence_ids,
            &mut evidence_index_by_id,
            &mut evidence_ids,
            &mut input.relation_evidence_indices,
        )?;
        push_local_evidence_offset(
            &mut input.relation_evidence_offsets,
            input.relation_evidence_indices.len(),
        )?;
    }

    for record in claims {
        input.claim_confidences.push(record.confidence);
        for entity_id in &record.entity_ids {
            input.claim_entity_indices.push(local_evidence_string_index(
                &mut entity_index_by_id,
                &mut entity_ids,
                entity_id,
            )?);
        }
        push_local_evidence_offset(
            &mut input.claim_entity_offsets,
            input.claim_entity_indices.len(),
        )?;
        push_local_evidence_indices(
            &record.evidence_ids,
            &mut evidence_index_by_id,
            &mut evidence_ids,
            &mut input.claim_evidence_indices,
        )?;
        push_local_evidence_offset(
            &mut input.claim_evidence_offsets,
            input.claim_evidence_indices.len(),
        )?;
    }

    input.entity_count = entity_ids.len();
    input.evidence_count = evidence_ids.len();
    Some(PlannedLocalEvidenceInput {
        input,
        evidence_ids,
    })
}

/// string id를 first-seen numeric index로 변환한다.
fn local_evidence_string_index(
    index_by_id: &mut BTreeMap<String, u32>,
    values: &mut Vec<String>,
    value: &str,
) -> Option<u32> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Some(index) = index_by_id.get(value).copied() {
        return Some(index);
    }
    let index = u32::try_from(values.len()).ok()?;
    index_by_id.insert(value.to_owned(), index);
    values.push(value.to_owned());
    Some(index)
}

/// evidence id 목록을 numeric evidence index로 변환해 output에 추가한다.
fn push_local_evidence_indices(
    evidence_ids: &[String],
    index_by_id: &mut BTreeMap<String, u32>,
    values: &mut Vec<String>,
    output: &mut Vec<u32>,
) -> Option<()> {
    for evidence_id in evidence_ids {
        let trimmed = evidence_id.trim();
        if trimmed.is_empty() {
            continue;
        }
        output.push(local_evidence_string_index(index_by_id, values, trimmed)?);
    }
    Some(())
}

/// current flat index len을 offset 배열에 추가한다.
fn push_local_evidence_offset(offsets: &mut Vec<u32>, len: usize) -> Option<()> {
    offsets.push(u32::try_from(len).ok()?);
    Some(())
}

/// `GraphRAG` local evidence scoring wire input을 parsing한다.
fn parse_local_evidence_input<'a>(
    config: &[u32],
    indices: &'a [u32],
    values: &'a [f64],
) -> Option<LocalEvidenceInput<'a>> {
    if config.len() != 10 || values.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let entity_count = u32_config_to_usize(config, 0)?;
    let evidence_count = u32_config_to_usize(config, 1)?;
    let traversal_depth = u32_config_to_usize(config, 2)?;
    let match_count = u32_config_to_usize(config, 3)?;
    let match_evidence_count = u32_config_to_usize(config, 4)?;
    let relation_count = u32_config_to_usize(config, 5)?;
    let relation_evidence_count = u32_config_to_usize(config, 6)?;
    let claim_count = u32_config_to_usize(config, 7)?;
    let claim_entity_count = u32_config_to_usize(config, 8)?;
    let claim_evidence_count = u32_config_to_usize(config, 9)?;

    let mut index_offset = 0_usize;
    let match_entity_indices = take_slice(indices, &mut index_offset, match_count)?;
    let match_evidence_offsets =
        take_slice(indices, &mut index_offset, match_count.saturating_add(1))?;
    let match_evidence_indices = take_slice(indices, &mut index_offset, match_evidence_count)?;
    let relation_source_indices = take_slice(indices, &mut index_offset, relation_count)?;
    let relation_target_indices = take_slice(indices, &mut index_offset, relation_count)?;
    let relation_evidence_offsets =
        take_slice(indices, &mut index_offset, relation_count.saturating_add(1))?;
    let relation_evidence_indices =
        take_slice(indices, &mut index_offset, relation_evidence_count)?;
    let claim_entity_offsets =
        take_slice(indices, &mut index_offset, claim_count.saturating_add(1))?;
    let claim_entity_indices = take_slice(indices, &mut index_offset, claim_entity_count)?;
    let claim_evidence_offsets =
        take_slice(indices, &mut index_offset, claim_count.saturating_add(1))?;
    let claim_evidence_indices = take_slice(indices, &mut index_offset, claim_evidence_count)?;
    if index_offset != indices.len() {
        return None;
    }

    let mut value_offset = 0_usize;
    let match_scores = take_slice(values, &mut value_offset, match_count)?;
    let relation_confidences = take_slice(values, &mut value_offset, relation_count)?;
    let claim_confidences = take_slice(values, &mut value_offset, claim_count)?;
    if value_offset != values.len() {
        return None;
    }

    if !are_offsets_valid(match_evidence_offsets, match_count, match_evidence_count)
        || !are_offsets_valid(
            relation_evidence_offsets,
            relation_count,
            relation_evidence_count,
        )
        || !are_offsets_valid(claim_entity_offsets, claim_count, claim_entity_count)
        || !are_offsets_valid(claim_evidence_offsets, claim_count, claim_evidence_count)
        || !are_indices_in_range(match_entity_indices, entity_count)
        || !are_indices_in_range(match_evidence_indices, evidence_count)
        || !are_indices_in_range(relation_source_indices, entity_count)
        || !are_indices_in_range(relation_target_indices, entity_count)
        || !are_indices_in_range(relation_evidence_indices, evidence_count)
        || !are_indices_in_range(claim_entity_indices, entity_count)
        || !are_indices_in_range(claim_evidence_indices, evidence_count)
    {
        return None;
    }

    Some(LocalEvidenceInput {
        entity_count,
        evidence_count,
        traversal_depth,
        match_count,
        match_entity_indices,
        match_scores,
        match_evidence_offsets,
        match_evidence_indices,
        relation_count,
        relation_source_indices,
        relation_target_indices,
        relation_confidences,
        relation_evidence_offsets,
        relation_evidence_indices,
        claim_count,
        claim_entity_offsets,
        claim_entity_indices,
        claim_confidences,
        claim_evidence_offsets,
        claim_evidence_indices,
    })
}

/// `GraphRAG` pruning wire input을 parsing한다.
fn parse_graph_prune_input<'a>(
    config: &[u32],
    indices: &'a [u32],
    wire_values: &'a str,
) -> Option<GraphPruneInput<'a>> {
    let counts = parse_graph_prune_counts(config)?;
    let strings = parse_graph_prune_strings(&counts, wire_values)?;
    let index_slices = parse_graph_prune_index_slices(&counts, indices)?;

    if !are_graph_prune_offsets_valid(&counts, &index_slices)
        || !are_graph_prune_indices_in_range(&counts, &index_slices)
    {
        return None;
    }

    Some(GraphPruneInput {
        file_paths: strings.file_paths,
        evidence_file_paths: strings.evidence_files,
        evidence_entry_ids: strings.evidence_entries,
        entity_schema_ids: strings.entity_schemas,
        entity_evidence_offsets: index_slices.entity_evidence_offsets,
        entity_evidence_indices: index_slices.entity_evidence,
        relation_schema_ids: strings.relation_schemas,
        relation_source_entity_indices: index_slices.relation_sources,
        relation_target_entity_indices: index_slices.relation_targets,
        relation_evidence_offsets: index_slices.relation_evidence_offsets,
        relation_evidence_indices: index_slices.relation_evidence,
        claim_entity_offsets: index_slices.claim_entity_offsets,
        claim_entity_indices: index_slices.claim_entities,
        claim_relation_offsets: index_slices.claim_relation_offsets,
        claim_relation_indices: index_slices.claim_relations,
        claim_evidence_offsets: index_slices.claim_evidence_offsets,
        claim_evidence_indices: index_slices.claim_evidence,
        community_schema_ids: strings.community_schemas,
        community_entity_offsets: index_slices.community_entity_offsets,
        community_entity_indices: index_slices.community_entities,
        community_relation_offsets: index_slices.community_relation_offsets,
        community_relation_indices: index_slices.community_relations,
        community_claim_offsets: index_slices.community_claim_offsets,
        community_claim_indices: index_slices.community_claims,
        rejected_fact_file_paths: strings.rejected_files,
        rejected_fact_entry_ids: strings.rejected_entries,
        extraction_cache_entry_ids: strings.cache_entries,
        pending_merge_existing_entity_indices: index_slices.pending_existing_entities,
        pending_merge_candidate_entity_indices: index_slices.pending_candidate_entities,
    })
}

/// Graph prune config를 count 구조로 변환한다.
fn parse_graph_prune_counts(config: &[u32]) -> Option<GraphPruneCounts> {
    if config.len() != 17 {
        return None;
    }
    Some(GraphPruneCounts {
        file_paths: u32_config_to_usize(config, 0)?,
        evidence: u32_config_to_usize(config, 1)?,
        entities: u32_config_to_usize(config, 2)?,
        entity_evidence_refs: u32_config_to_usize(config, 3)?,
        relations: u32_config_to_usize(config, 4)?,
        relation_evidence_refs: u32_config_to_usize(config, 5)?,
        claims: u32_config_to_usize(config, 6)?,
        claim_entity_refs: u32_config_to_usize(config, 7)?,
        claim_relation_refs: u32_config_to_usize(config, 8)?,
        claim_evidence_refs: u32_config_to_usize(config, 9)?,
        communities: u32_config_to_usize(config, 10)?,
        community_entity_refs: u32_config_to_usize(config, 11)?,
        community_relation_refs: u32_config_to_usize(config, 12)?,
        community_claim_refs: u32_config_to_usize(config, 13)?,
        rejected_facts: u32_config_to_usize(config, 14)?,
        extraction_cache: u32_config_to_usize(config, 15)?,
        pending_merges: u32_config_to_usize(config, 16)?,
    })
}

/// Graph prune wire 문자열을 타입 안전한 구조로 분리한다.
fn parse_graph_prune_strings<'a>(
    counts: &GraphPruneCounts,
    wire_values: &'a str,
) -> Option<GraphPruneStrings<'a>> {
    let sections = split_graph_prune_wire_sections(wire_values)?;
    let file_paths = sections.first()?;
    let evidence_file_paths = sections.get(1)?;
    let evidence_entry_ids = sections.get(2)?;
    let entity_schema_ids = sections.get(3)?;
    let relation_schema_ids = sections.get(4)?;
    let community_schema_ids = sections.get(5)?;
    let rejected_fact_file_paths = sections.get(6)?;
    let rejected_fact_entry_ids = sections.get(7)?;
    let extraction_cache_entry_ids = sections.get(8)?;

    if file_paths.len() != counts.file_paths
        || evidence_file_paths.len() != counts.evidence
        || evidence_entry_ids.len() != counts.evidence
        || entity_schema_ids.len() != counts.entities
        || relation_schema_ids.len() != counts.relations
        || community_schema_ids.len() != counts.communities
        || rejected_fact_file_paths.len() != counts.rejected_facts
        || rejected_fact_entry_ids.len() != counts.rejected_facts
        || extraction_cache_entry_ids.len() != counts.extraction_cache
    {
        return None;
    }

    Some(GraphPruneStrings {
        file_paths: file_paths.clone(),
        evidence_files: evidence_file_paths.clone(),
        evidence_entries: evidence_entry_ids.clone(),
        entity_schemas: entity_schema_ids.clone(),
        relation_schemas: relation_schema_ids.clone(),
        community_schemas: community_schema_ids.clone(),
        rejected_files: rejected_fact_file_paths.clone(),
        rejected_entries: rejected_fact_entry_ids.clone(),
        cache_entries: extraction_cache_entry_ids.clone(),
    })
}

/// Graph prune flattened 인덱스 배열을 offset/indices 섹션으로 분리한다.
fn parse_graph_prune_index_slices<'a>(
    counts: &GraphPruneCounts,
    indices: &'a [u32],
) -> Option<GraphPruneIndexSlices<'a>> {
    let mut index_offset = 0_usize;
    let entity_evidence_offsets = take_slice(
        indices,
        &mut index_offset,
        counts.entities.saturating_add(1),
    )?;
    let entity_evidence = take_slice(indices, &mut index_offset, counts.entity_evidence_refs)?;
    let relation_sources = take_slice(indices, &mut index_offset, counts.relations)?;
    let relation_targets = take_slice(indices, &mut index_offset, counts.relations)?;
    let relation_evidence_offsets = take_slice(
        indices,
        &mut index_offset,
        counts.relations.saturating_add(1),
    )?;
    let relation_evidence = take_slice(indices, &mut index_offset, counts.relation_evidence_refs)?;
    let claim_entity_offsets =
        take_slice(indices, &mut index_offset, counts.claims.saturating_add(1))?;
    let claim_entities = take_slice(indices, &mut index_offset, counts.claim_entity_refs)?;
    let claim_relation_offsets =
        take_slice(indices, &mut index_offset, counts.claims.saturating_add(1))?;
    let claim_relations = take_slice(indices, &mut index_offset, counts.claim_relation_refs)?;
    let claim_evidence_offsets =
        take_slice(indices, &mut index_offset, counts.claims.saturating_add(1))?;
    let claim_evidence = take_slice(indices, &mut index_offset, counts.claim_evidence_refs)?;
    let community_entity_offsets = take_slice(
        indices,
        &mut index_offset,
        counts.communities.saturating_add(1),
    )?;
    let community_entities = take_slice(indices, &mut index_offset, counts.community_entity_refs)?;
    let community_relation_offsets = take_slice(
        indices,
        &mut index_offset,
        counts.communities.saturating_add(1),
    )?;
    let community_relations =
        take_slice(indices, &mut index_offset, counts.community_relation_refs)?;
    let community_claim_offsets = take_slice(
        indices,
        &mut index_offset,
        counts.communities.saturating_add(1),
    )?;
    let community_claims = take_slice(indices, &mut index_offset, counts.community_claim_refs)?;
    let pending_merge_existing_entity_indices =
        take_slice(indices, &mut index_offset, counts.pending_merges)?;
    let pending_merge_candidate_entity_indices =
        take_slice(indices, &mut index_offset, counts.pending_merges)?;
    if index_offset != indices.len() {
        return None;
    }

    Some(GraphPruneIndexSlices {
        entity_evidence_offsets,
        entity_evidence,
        relation_sources,
        relation_targets,
        relation_evidence_offsets,
        relation_evidence,
        claim_entity_offsets,
        claim_entities,
        claim_relation_offsets,
        claim_relations,
        claim_evidence_offsets,
        claim_evidence,
        community_entity_offsets,
        community_entities,
        community_relation_offsets,
        community_relations,
        community_claim_offsets,
        community_claims,
        pending_existing_entities: pending_merge_existing_entity_indices,
        pending_candidate_entities: pending_merge_candidate_entity_indices,
    })
}

/// Graph prune offset 배열을 기본 유효성 규칙으로 검증한다.
fn are_graph_prune_offsets_valid(
    counts: &GraphPruneCounts,
    slices: &GraphPruneIndexSlices<'_>,
) -> bool {
    are_offsets_valid(
        slices.entity_evidence_offsets,
        counts.entities,
        counts.entity_evidence_refs,
    ) && are_offsets_valid(
        slices.relation_evidence_offsets,
        counts.relations,
        counts.relation_evidence_refs,
    ) && are_offsets_valid(
        slices.claim_entity_offsets,
        counts.claims,
        counts.claim_entity_refs,
    ) && are_offsets_valid(
        slices.claim_relation_offsets,
        counts.claims,
        counts.claim_relation_refs,
    ) && are_offsets_valid(
        slices.claim_evidence_offsets,
        counts.claims,
        counts.claim_evidence_refs,
    ) && are_offsets_valid(
        slices.community_entity_offsets,
        counts.communities,
        counts.community_entity_refs,
    ) && are_offsets_valid(
        slices.community_relation_offsets,
        counts.communities,
        counts.community_relation_refs,
    ) && are_offsets_valid(
        slices.community_claim_offsets,
        counts.communities,
        counts.community_claim_refs,
    )
}

/// Graph prune 인덱스 값들을 범위 및 unknown sentinel 규칙으로 검증한다.
fn are_graph_prune_indices_in_range(
    counts: &GraphPruneCounts,
    slices: &GraphPruneIndexSlices<'_>,
) -> bool {
    are_known_or_unknown_indices_in_range(slices.entity_evidence, counts.evidence)
        && are_known_or_unknown_indices_in_range(slices.relation_sources, counts.entities)
        && are_known_or_unknown_indices_in_range(slices.relation_targets, counts.entities)
        && are_known_or_unknown_indices_in_range(slices.relation_evidence, counts.evidence)
        && are_known_or_unknown_indices_in_range(slices.claim_entities, counts.entities)
        && are_known_or_unknown_indices_in_range(slices.claim_relations, counts.relations)
        && are_known_or_unknown_indices_in_range(slices.claim_evidence, counts.evidence)
        && are_known_or_unknown_indices_in_range(slices.community_entities, counts.entities)
        && are_known_or_unknown_indices_in_range(slices.community_relations, counts.relations)
        && are_known_or_unknown_indices_in_range(slices.community_claims, counts.claims)
        && are_known_or_unknown_indices_in_range(slices.pending_existing_entities, counts.entities)
        && are_known_or_unknown_indices_in_range(slices.pending_candidate_entities, counts.entities)
}

/// Graph prune wire string을 section/value 배열로 분리한다.
fn split_graph_prune_wire_sections(wire_values: &str) -> Option<Vec<Vec<&str>>> {
    let sections = wire_values
        .split('\u{1f}')
        .map(|section| {
            if section.is_empty() {
                Vec::new()
            } else {
                section.split('\0').collect::<Vec<_>>()
            }
        })
        .collect::<Vec<_>>();
    (sections.len() == 9).then_some(sections)
}

/// config의 `u32` 값을 `usize`로 변환한다.
fn u32_config_to_usize(config: &[u32], index: usize) -> Option<usize> {
    usize::try_from(config.get(index).copied()?).ok()
}

/// slice cursor에서 length만큼 안전하게 가져온다.
fn take_slice<'a, T>(values: &'a [T], offset: &mut usize, length: usize) -> Option<&'a [T]> {
    let end = offset.checked_add(length)?;
    let slice = values.get(*offset..end)?;
    *offset = end;
    Some(slice)
}

/// offset 배열이 item count와 flat count에 맞는지 확인한다.
fn are_offsets_valid(offsets: &[u32], item_count: usize, flat_count: usize) -> bool {
    if offsets.len() != item_count.saturating_add(1) {
        return false;
    }
    if offsets.first().copied() != Some(0) {
        return false;
    }

    let mut previous = 0_usize;
    for offset in offsets.iter().copied() {
        let Ok(current) = usize::try_from(offset) else {
            return false;
        };
        if current < previous || current > flat_count {
            return false;
        }
        previous = current;
    }
    previous == flat_count
}

/// 모든 index가 `max_exclusive` 범위 안에 있는지 확인한다.
fn are_indices_in_range(indices: &[u32], max_exclusive: usize) -> bool {
    indices
        .iter()
        .copied()
        .all(|index| bounded_u32_index(index, max_exclusive).is_some())
}

/// 모든 index가 범위 안에 있거나 unknown sentinel인지 확인한다.
fn are_known_or_unknown_indices_in_range(indices: &[u32], max_exclusive: usize) -> bool {
    indices.iter().copied().all(|index| {
        index == GRAPH_PRUNE_UNKNOWN_INDEX || bounded_u32_index(index, max_exclusive).is_some()
    })
}

/// `u32` index를 `usize`로 바꾸고 범위를 확인한다.
fn bounded_u32_index(index: u32, max_exclusive: usize) -> Option<usize> {
    let converted = usize::try_from(index).ok()?;
    (converted < max_exclusive).then_some(converted)
}

/// item offset 구간의 evidence score를 추가한다.
fn push_evidence_scores_for_item(
    offsets: &[u32],
    evidence_indices: &[u32],
    item_index: usize,
    score: f64,
    evidence_count: usize,
    evidence_scores: &mut Vec<LocalEvidenceScore>,
    sequence: &mut usize,
) {
    let Some(range) = offset_range(offsets, item_index, evidence_indices.len()) else {
        return;
    };
    let Some(indices) = evidence_indices.get(range) else {
        return;
    };
    for evidence_index_raw in indices {
        let Some(evidence_index) = bounded_u32_index(*evidence_index_raw, evidence_count) else {
            continue;
        };
        evidence_scores.push(LocalEvidenceScore {
            evidence_index,
            score,
            sequence: *sequence,
        });
        *sequence = sequence.saturating_add(1);
    }
}

/// offset 배열에서 item index가 가리키는 range를 반환한다.
fn offset_range(
    offsets: &[u32],
    item_index: usize,
    flat_len: usize,
) -> Option<std::ops::Range<usize>> {
    let start = usize::try_from(offsets.get(item_index).copied()?).ok()?;
    let end = usize::try_from(offsets.get(item_index.saturating_add(1)).copied()?).ok()?;
    (start <= end && end <= flat_len).then_some(start..end)
}

/// claim 기반 evidence score를 현재 entity score 상태에서 추가한다.
fn add_local_claim_evidence_scores(
    input: &LocalEvidenceInput<'_>,
    entity_scores: &[f64],
    entity_distances: &[usize],
    entity_known: &[bool],
    evidence_scores: &mut Vec<LocalEvidenceScore>,
    sequence: &mut usize,
) {
    for claim_index in 0..input.claim_count {
        let Some(range) = offset_range(
            input.claim_entity_offsets,
            claim_index,
            input.claim_entity_indices.len(),
        ) else {
            continue;
        };
        let Some(entity_indices) = input.claim_entity_indices.get(range) else {
            continue;
        };

        let mut best_score = 0.0_f64;
        let mut best_distance = 0_usize;
        for entity_index_raw in entity_indices {
            let Some(entity_index) = bounded_u32_index(*entity_index_raw, input.entity_count)
            else {
                continue;
            };
            if !entity_known.get(entity_index).copied().unwrap_or(false) {
                continue;
            }
            let score = entity_scores.get(entity_index).copied().unwrap_or_default();
            if score <= 0.0 || score <= best_score {
                continue;
            }
            best_score = score;
            best_distance = entity_distances
                .get(entity_index)
                .copied()
                .unwrap_or_default();
        }
        if best_score <= 0.0 {
            continue;
        }

        let Some(confidence) = input.claim_confidences.get(claim_index).copied() else {
            continue;
        };
        let Some(distance) = usize_to_f64(best_distance) else {
            continue;
        };
        let distance_factor = 1.0 / distance.mul_add(0.35, 1.0);
        let claim_score = clamp_unit_score(best_score * confidence * distance_factor);
        push_evidence_scores_for_item(
            input.claim_evidence_offsets,
            input.claim_evidence_indices,
            claim_index,
            claim_score,
            input.evidence_count,
            evidence_scores,
            sequence,
        );
    }
}

/// evidence score를 높은 score 우선, tie는 기존 생성 순서 우선으로 정렬한다.
fn compare_local_evidence_scores_descending(
    left: &LocalEvidenceScore,
    right: &LocalEvidenceScore,
) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.sequence.cmp(&right.sequence))
}

/// evidence score를 높은 score 우선, tie는 기존 생성 순서 우선으로 정렬한다.
fn compare_evidence_scores_by_id_descending(
    left: &EvidenceScoreById,
    right: &EvidenceScoreById,
) -> std::cmp::Ordering {
    right
        .score
        .total_cmp(&left.score)
        .then_with(|| left.sequence.cmp(&right.sequence))
}

/// file type count를 count 내림차순, label 오름차순으로 정렬한다.
fn compare_file_type_counts(
    left: &RagFileTypeCountPlan,
    right: &RagFileTypeCountPlan,
) -> std::cmp::Ordering {
    right
        .count
        .cmp(&left.count)
        .then_with(|| compare_file_type_extension_keys(&left.extension, &right.extension))
        .then_with(|| left.label.cmp(&right.label))
}

/// exclude recommendation을 count 내림차순, label 오름차순으로 정렬한다.
fn compare_recommendation_counts(
    left: &RagExcludeRecommendationPlan,
    right: &RagExcludeRecommendationPlan,
) -> std::cmp::Ordering {
    right
        .count
        .cmp(&left.count)
        .then_with(|| compare_file_type_extension_keys(&left.extension, &right.extension))
        .then_with(|| left.label.cmp(&right.label))
}

/// file type 동률 정렬에서 no-extension row를 먼저 둔다.
fn compare_file_type_extension_keys(left: &str, right: &str) -> std::cmp::Ordering {
    match (left == "(none)", right == "(none)") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => std::cmp::Ordering::Equal,
    }
}

/// evidence score list를 index/score pair 배열로 변환한다.
fn encode_local_evidence_scores(scores: &[LocalEvidenceScore]) -> Box<[f64]> {
    let mut pairs = Vec::with_capacity(scores.len().saturating_mul(2));
    for score in scores {
        let Some(index) = usize_to_f64(score.evidence_index) else {
            return Box::default();
        };
        pairs.push(index);
        pairs.push(score.score);
    }
    pairs.into_boxed_slice()
}

/// evidence id score list를 JSON 문자열로 serialize한다.
fn serialize_evidence_scores_json(scores: &[EvidenceScoreById]) -> String {
    let body = scores
        .iter()
        .map(|score| {
            format!(
                "{{\"evidenceId\":\"{}\",\"score\":{}}}",
                escape_json_string(&score.evidence_id),
                score.score,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// Graph evidence candidate lookup plan을 JSON 문자열로 serialize한다.
fn serialize_graph_evidence_candidate_lookup_plan_json(
    plan: &GraphEvidenceCandidateLookupPlan,
) -> String {
    format!(
        "{{\"scoreIndices\":{},\"evidenceIndices\":{},\"filePaths\":{}}}",
        serialize_usize_array_json(&plan.score_indices),
        serialize_usize_array_json(&plan.evidence_indices),
        serialize_string_array_json(&plan.file_paths),
    )
}

/// Graph evidence entry candidate plan을 JSON 문자열로 serialize한다.
fn serialize_graph_evidence_entry_candidate_plan_json(
    plan: &GraphEvidenceEntryCandidatePlan,
) -> String {
    format!(
        "{{\"candidateIndices\":{},\"entryIndices\":{}}}",
        serialize_usize_array_json(&plan.candidate_indices),
        serialize_usize_array_json(&plan.entry_indices),
    )
}

/// Graph mention context selection plan을 JSON 문자열로 serialize한다.
fn serialize_graph_mention_context_plan_json(plan: &GraphMentionContextPlan) -> String {
    format!(
        "{{\"matchedEntityIndices\":{},\"matchedRelationIndices\":{},\"contextLines\":{}}}",
        serialize_usize_array_json(&plan.matched_entity_indices),
        serialize_usize_array_json(&plan.matched_relation_indices),
        serialize_string_array_json(&plan.context_lines),
    )
}

/// file index record plan을 JSON 문자열로 serialize한다.
fn serialize_file_index_records_json(records: &[FileIndexRecordPlan]) -> String {
    let body = records
        .iter()
        .filter_map(serialize_file_index_record_json)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// file index record 하나를 JSON 문자열로 serialize한다.
fn serialize_file_index_record_json(record: &FileIndexRecordPlan) -> Option<String> {
    let mut fields = vec![format!(
        "\"filePath\":\"{}\"",
        escape_json_string(&record.file_path)
    )];
    if record.has_complete_metadata {
        fields.push(format!(
            "\"sourceMtime\":{}",
            finite_json_number(record.source_mtime?)?
        ));
        fields.push(format!(
            "\"sourceSize\":{}",
            finite_json_number(record.source_size?)?
        ));
        fields.push(format!(
            "\"contentHash\":\"{}\"",
            escape_json_string(record.content_hash.as_ref()?)
        ));
        fields.push(format!(
            "\"indexedAt\":{}",
            finite_json_number(record.indexed_at?)?
        ));
        fields.push(format!(
            "\"embeddingProvider\":\"{}\"",
            escape_json_string(record.embedding_provider.as_ref()?)
        ));
        fields.push(format!(
            "\"embeddingModel\":\"{}\"",
            escape_json_string(record.embedding_model.as_ref()?)
        ));
    }
    fields.push(format!(
        "\"hasCompleteMetadata\":{}",
        record.has_complete_metadata
    ));
    fields.push(format!("\"vectorCount\":{}", record.vector_count));
    fields.push(format!(
        "\"updated\":{}",
        finite_json_number(record.updated)?
    ));
    Some(format!("{{{}}}", fields.join(",")))
}

/// vector store mutation plan을 JSON 문자열로 serialize한다.
fn serialize_vector_store_mutation_plan_json(plan: &VectorStoreMutationPlan) -> String {
    let sources = plan
        .sources
        .iter()
        .map(|source| {
            format!(
                "{{\"source\":\"{}\",\"index\":{}}}",
                source.source.as_str(),
                source.index
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"sources\":[{sources}],\"removedCount\":{},\"changed\":{}}}",
        plan.removed_count, plan.changed
    )
}

/// vector store stats plan을 JSON 문자열로 serialize한다.
fn serialize_vector_store_stats_plan_json(plan: &VectorStoreStatsPlan) -> String {
    let last_updated = plan
        .last_updated
        .and_then(finite_json_number)
        .unwrap_or_else(|| "null".to_owned());
    format!(
        "{{\"totalEntries\":{},\"totalFiles\":{},\"totalVectors\":{},\"averageVectorsPerFile\":{},\"lastUpdated\":{},\"indexedFilePaths\":{}}}",
        plan.total_entries,
        plan.total_files,
        plan.total_vectors,
        finite_json_number(plan.average_vectors_per_file).unwrap_or_else(|| "0".to_owned()),
        last_updated,
        serialize_string_array_json(&plan.indexed_file_paths),
    )
}

/// RAG status summary plan을 JSON 문자열로 serialize한다.
fn serialize_rag_status_plan_json(plan: &RagStatusPlan) -> String {
    format!(
        "{{\"totalDocuments\":{},\"healthyDocuments\":{},\"missingDocuments\":{},\"staleDocuments\":{},\"unknownDocuments\":{},\"excludedDocuments\":{},\"totalVectors\":{},\"updateRequiredDocuments\":{}}}",
        plan.total_documents,
        plan.healthy_documents,
        plan.missing_documents,
        plan.stale_documents,
        plan.unknown_documents,
        plan.excluded_documents,
        plan.total_vectors,
        serialize_rag_document_updates_json(&plan.update_required_documents),
    )
}

/// RAG status update row 배열을 JSON 문자열로 serialize한다.
fn serialize_rag_document_updates_json(updates: &[RagDocumentUpdatePlan]) -> String {
    let body = updates
        .iter()
        .filter_map(serialize_rag_document_update_json)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// RAG status update row 하나를 JSON 문자열로 serialize한다.
fn serialize_rag_document_update_json(update: &RagDocumentUpdatePlan) -> Option<String> {
    Some(format!(
        "{{\"path\":\"{}\",\"status\":\"{}\",\"reason\":\"{}\",\"mtime\":{},\"size\":{}}}",
        escape_json_string(&update.path),
        update.status.as_str(),
        escape_json_string(&update.reason),
        finite_json_number(update.mtime)?,
        finite_json_number(update.size)?,
    ))
}

/// indexPending file selection plan을 JSON 문자열로 serialize한다.
fn serialize_index_pending_plan_json(plan: &IndexPendingPlan) -> String {
    format!(
        "{{\"fileIndices\":{},\"skipped\":{}}}",
        serialize_usize_array_json(&plan.file_indices),
        plan.skipped,
    )
}

/// `GraphRAG` run file selection plan을 `JSON` 문자열로 serialize한다.
/// RAG indexing ETA plan을 JSON 문자열로 serialize한다.
fn serialize_rag_indexing_eta_plan_json(plan: &RagIndexingEtaPlan) -> String {
    format!(
        "{{\"totalFiles\":{},\"completedFiles\":{},\"currentFileProgress\":{},\"progressRatio\":{},\"elapsedMs\":{},\"remainingMs\":{},\"estimatedCompletionMs\":{},\"confidence\":\"{}\",\"basis\":\"{}\",\"lowerRemainingMs\":{},\"upperRemainingMs\":{},\"confidenceReason\":\"{}\",\"etaConfidenceReason\":\"{}\"}}",
        plan.total_files,
        plan.completed_files,
        finite_json_number(plan.current_file_progress).unwrap_or_else(|| "0".to_owned()),
        finite_json_number(plan.progress_ratio).unwrap_or_else(|| "0".to_owned()),
        finite_json_number(plan.elapsed_ms).unwrap_or_else(|| "0".to_owned()),
        optional_finite_json_number_string(plan.remaining_ms),
        optional_finite_json_number_string(plan.estimated_completion_ms),
        plan.confidence.as_str(),
        plan.basis.as_str(),
        optional_finite_json_number_string(plan.lower_remaining_ms),
        optional_finite_json_number_string(plan.upper_remaining_ms),
        escape_json_string(plan.confidence_reason),
        escape_json_string(plan.confidence_reason),
    )
}

/// Optional finite JSON number를 문자열로 serialize한다.
fn optional_finite_json_number_string(value: Option<f64>) -> String {
    value
        .and_then(finite_json_number)
        .unwrap_or_else(|| "null".to_owned())
}

/// `GraphRAG` run file selection plan??`JSON` 臾몄옄?대줈 serialize?쒕떎.
fn serialize_graph_rag_run_file_selection_plan_json(plan: &GraphRagRunFileSelectionPlan) -> String {
    format!(
        "{{\"candidateFilePaths\":{},\"selectedFilePaths\":{}}}",
        serialize_string_array_json(&plan.candidate_file_paths),
        serialize_string_array_json(&plan.selected_file_paths),
    )
}

/// `GraphRAG` status file snapshot plan을 `JSON` 문자열로 serialize한다.
fn serialize_graph_rag_status_file_snapshot_plan_json(
    plan: &GraphRagStatusFileSnapshotPlan,
) -> String {
    format!(
        "{{\"fileRecordIndices\":{},\"totalCandidateFiles\":{}}}",
        serialize_usize_array_json(&plan.file_record_indices),
        plan.total_candidate_files,
    )
}

/// `GraphRAG` status entry snapshot plan을 `JSON` 문자열로 serialize한다.
fn serialize_graph_rag_status_entry_snapshot_plan_json(
    plan: &GraphRagStatusEntrySnapshotPlan,
) -> String {
    format!(
        "{{\"entryIndices\":{}}}",
        serialize_usize_array_json(&plan.entry_indices),
    )
}

/// `GraphRAG` status summary plan을 `JSON` 문자열로 serialize한다.
fn serialize_graph_rag_status_plan_json(plan: &GraphRagStatusPlan) -> String {
    format!(
        "{{\"state\":\"{}\",\"totalCandidateFiles\":{},\"graphEvidenceCount\":{},\"rejectedFactCount\":{},\"failedFileCount\":{},\"pendingMergeCount\":{},\"staleFileCount\":{},\"staleFilePaths\":{},\"maxFilesPerRun\":{}}}",
        plan.state.as_str(),
        plan.total_candidate_files,
        plan.graph_evidence_count,
        plan.rejected_fact_count,
        plan.failed_file_count,
        plan.pending_merge_count,
        plan.stale_file_count,
        serialize_string_array_json(&plan.stale_file_paths),
        plan.max_files_per_run,
    )
}

/// RAG query result score plan을 `JSON` 문자열로 serialize한다.
fn serialize_query_result_score_plan_json(plan: &QueryResultScorePlan) -> String {
    let Some(combined_base) = finite_json_number(plan.combined_base) else {
        return String::new();
    };
    let Some(rrf_score) = finite_json_number(plan.rrf_score) else {
        return String::new();
    };
    let Some(source_prior) = finite_json_number(plan.source_prior) else {
        return String::new();
    };
    let Some(source_evidence_score) = finite_json_number(plan.source_evidence_score) else {
        return String::new();
    };
    let best_evidence_rank =
        finite_json_number(plan.best_evidence_rank).unwrap_or_else(|| "null".to_owned());
    let Some(combined_score) = finite_json_number(plan.combined_score) else {
        return String::new();
    };
    format!(
        "{{\"combinedBase\":{},\"rrfScore\":{},\"sourcePrior\":{},\"sourceEvidenceScore\":{},\"bestEvidenceRank\":{},\"hasGraphOrStructuralEvidence\":{},\"hasStrongGraphOrStructuralEvidence\":{},\"combinedScore\":{},\"selectionReason\":\"{}\"}}",
        combined_base,
        rrf_score,
        source_prior,
        source_evidence_score,
        best_evidence_rank,
        plan.has_graph_or_structural_evidence,
        plan.has_strong_graph_or_structural_evidence,
        combined_score,
        plan.selection_reason,
    )
}

/// LLM reranker response plan을 JSON 문자열로 serialize한다.
fn serialize_rerank_response_plan_json(ranked_ids: &[String], rerank_status: &str) -> String {
    format!(
        "{{\"rankedIds\":{},\"rerankStatus\":\"{}\"}}",
        serialize_string_array_json(ranked_ids),
        escape_json_string(rerank_status),
    )
}

/// LLM reranker message plan을 JSON 문자열로 serialize한다.
fn serialize_rerank_messages_plan_json(plan: &RerankMessagesPlan) -> String {
    format!(
        "{{\"systemContent\":\"{}\",\"userContent\":\"{}\"}}",
        escape_json_string(&plan.system_content),
        escape_json_string(&plan.user_content),
    )
}

/// LLM reranker user message content JSON을 만든다.
fn serialize_rerank_user_content_json(
    question: &str,
    candidates: &[PlannedRerankCandidate],
) -> String {
    let candidate_json = candidates
        .iter()
        .map(serialize_planned_rerank_candidate_json)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"question\":\"{}\",\"candidates\":[{}]}}",
        escape_json_string(question),
        candidate_json,
    )
}

/// LLM reranker candidate row를 JSON 문자열로 serialize한다.
fn serialize_planned_rerank_candidate_json(candidate: &PlannedRerankCandidate) -> String {
    format!(
        "{{\"id\":\"{}\",\"index\":{},\"sourcePath\":\"{}\",\"heading\":\"{}\",\"text\":\"{}\"}}",
        escape_json_string(&candidate.id),
        candidate.index,
        escape_json_string(&candidate.source_path),
        escape_json_string(&candidate.heading),
        escape_json_string(&candidate.text),
    )
}

/// `GraphRAG` entity resolution plan을 `JSON` 문자열로 serialize한다.
fn serialize_entity_resolution_plan_json(plan: &EntityResolutionPlan) -> String {
    let Some(merge_score) = finite_json_number(plan.merge_score) else {
        return String::new();
    };
    let matched_entity_id = plan
        .matched_entity_id
        .as_ref()
        .map(|entity_id| format!(",\"matchedEntityId\":\"{}\"", escape_json_string(entity_id)))
        .unwrap_or_default();
    format!(
        "{{\"status\":\"{}\",\"entityId\":\"{}\",\"mergeScore\":{}{}}}",
        plan.status.as_str(),
        escape_json_string(&plan.entity_id),
        merge_score,
        matched_entity_id,
    )
}

/// `GraphRAG` entity merge plan을 `JSON` 문자열로 serialize한다.
fn serialize_graph_entity_merge_plan_json(plan: &GraphEntityMergePlan) -> String {
    let Some(confidence) = finite_json_number(plan.confidence) else {
        return String::new();
    };
    let Some(updated_at) = finite_json_number(plan.updated_at) else {
        return String::new();
    };
    format!(
        "{{\"aliases\":{},\"description\":\"{}\",\"confidence\":{},\"evidenceIds\":{},\"updatedAt\":{}}}",
        serialize_string_array_json(&plan.aliases),
        escape_json_string(&plan.description),
        confidence,
        serialize_string_array_json(&plan.evidence_ids),
        updated_at,
    )
}

/// RAG file type summary plan을 JSON 문자열로 serialize한다.
fn serialize_rag_file_type_summary_json(
    target_types: &[RagFileTypeCountPlan],
    recommendations: &[RagExcludeRecommendationPlan],
    total_target_files: usize,
) -> String {
    format!(
        "{{\"targetTypes\":{},\"excludeRecommendations\":{},\"totalTargetFiles\":{}}}",
        serialize_rag_file_type_counts_json(target_types),
        serialize_rag_exclude_recommendations_json(recommendations),
        total_target_files,
    )
}

/// RAG file type count rows를 JSON 문자열로 serialize한다.
fn serialize_rag_file_type_counts_json(rows: &[RagFileTypeCountPlan]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            format!(
                "{{\"extension\":\"{}\",\"label\":\"{}\",\"count\":{}}}",
                escape_json_string(&row.extension),
                escape_json_string(&row.label),
                row.count,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// RAG exclude recommendation rows를 JSON 문자열로 serialize한다.
fn serialize_rag_exclude_recommendations_json(rows: &[RagExcludeRecommendationPlan]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            format!(
                "{{\"extension\":\"{}\",\"label\":\"{}\",\"count\":{},\"reason\":\"{}\"}}",
                escape_json_string(&row.extension),
                escape_json_string(&row.label),
                row.count,
                escape_json_string(&row.reason),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// RAG 후보 판정 plan을 JSON object로 serialize한다.
fn serialize_rag_file_indexability_plan_json(
    candidate_indices: &[usize],
    summary_inputs: &[RagFileTypeInput],
) -> String {
    format!(
        "{{\"candidateIndices\":{},\"summaryInputs\":{}}}",
        serialize_usize_array_json(candidate_indices),
        serialize_rag_file_type_inputs_json(summary_inputs),
    )
}

/// RAG file type input rows를 JSON 문자열로 serialize한다.
fn serialize_rag_file_type_inputs_json(rows: &[RagFileTypeInput]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            let extension = row.extension.as_deref().unwrap_or_default();
            let reason_suffix =
                row.recommendation_reason
                    .as_deref()
                    .map_or_else(String::new, |reason| {
                        format!(
                            ",\"recommendationReason\":\"{}\"",
                            escape_json_string(reason)
                        )
                    });
            format!(
                "{{\"filePath\":\"{}\",\"extension\":\"{}\",\"indexable\":{}{}}}",
                escape_json_string(&row.file_path),
                escape_json_string(extension),
                row.indexable,
                reason_suffix,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// source reference plan rows를 JSON 문자열로 serialize한다.
fn serialize_source_references_json(rows: &[SourceReferencePlan]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            format!(
                "{{\"label\":\"{}\",\"target\":\"{}\",\"kind\":\"{}\",\"aliases\":{}}}",
                escape_json_string(&row.label),
                escape_json_string(&row.target),
                row.kind.as_str(),
                serialize_string_array_json(&row.aliases),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// source validation warning plan rows를 JSON 문자열로 serialize한다.
fn serialize_source_validation_warnings_json(rows: &[SourceValidationWarningPlan]) -> String {
    let body = rows
        .iter()
        .map(|row| {
            format!(
                "{{\"id\":\"{}\",\"label\":\"{}\",\"kind\":\"{}\"}}",
                escape_json_string(&row.id),
                escape_json_string(&row.label),
                row.kind.as_str(),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// source validation input plan을 TS wire format JSON 문자열로 serialize한다.
fn serialize_source_validation_input_plan_json(plan: &SourceValidationInputPlan) -> String {
    format!(
        "{{\"verifiedCitationIds\":{},\"verifiedPaths\":{},\"aliasCandidates\":{}}}",
        serialize_string_array_json(&plan.verified_citation_ids),
        serialize_string_array_json(&plan.verified_paths),
        serialize_string_array_json(&plan.alias_candidates),
    )
}

/// assistant answer classification을 JSON 문자열로 serialize한다.
fn serialize_assistant_answer_classification_json(content: &str, reasoning: &str) -> String {
    format!(
        "{{\"type\":\"answer\",\"content\":\"{}\",\"reasoning\":\"{}\"}}",
        escape_json_string(content),
        escape_json_string(reasoning),
    )
}

/// assistant question classification을 JSON 문자열로 serialize한다.
fn serialize_assistant_question_classification_json(
    content: &str,
    reasoning: &str,
    question: &AssistantQuestionPlan,
    original_content: &str,
) -> String {
    format!(
        "{{\"type\":\"question\",\"content\":\"{}\",\"reasoning\":\"{}\",\"question\":{},\"originalContent\":\"{}\"}}",
        escape_json_string(content),
        escape_json_string(reasoning),
        serialize_assistant_question_json(question),
        escape_json_string(original_content),
    )
}

/// assistant question plan을 JSON 문자열로 serialize한다.
fn serialize_assistant_question_json(question: &AssistantQuestionPlan) -> String {
    format!(
        "{{\"prompt\":\"{}\",\"choices\":{},\"selectionMode\":\"{}\",\"allowFreeText\":{},\"source\":\"{}\"}}",
        escape_json_string(&question.prompt),
        serialize_assistant_choices_json(&question.choices),
        question.selection_mode.as_str(),
        question.allow_free_text,
        question.source.as_str(),
    )
}

/// assistant question choices를 JSON 문자열로 serialize한다.
fn serialize_assistant_choices_json(choices: &[AssistantChoicePlan]) -> String {
    let body = choices
        .iter()
        .map(|choice| {
            format!(
                "{{\"id\":\"{}\",\"label\":\"{}\"}}",
                escape_json_string(&choice.id),
                escape_json_string(&choice.label),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// JSON value array를 문자열로 serialize한다.
fn serialize_json_array(values: &[JsonValue]) -> String {
    serde_json::to_string(values).unwrap_or_default()
}

/// JSON number로 안전하게 직렬화할 수 있는 finite number만 문자열로 반환한다.
fn finite_json_number(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    Some(value.to_string())
}

/// optional JSON value를 finite number로 파싱한다.
fn optional_finite_json_number(value: Option<&JsonValue>) -> Option<f64> {
    value
        .and_then(JsonValue::as_f64)
        .filter(|number| number.is_finite())
}

/// score를 기존 `TypeScript` 경로처럼 `[0, 1]` 범위로 제한한다.
const fn clamp_unit_score(score: f64) -> f64 {
    if !score.is_finite() {
        return 0.0;
    }
    if score < 0.0 {
        return 0.0;
    }
    if score > 1.0 {
        return 1.0;
    }
    score
}

/// entity wire 문자열을 `NUL` separator 기준으로 나눈다.
fn split_entity_wire_values(values: &str) -> impl Iterator<Item = &str> {
    values.split('\0')
}

/// ontology relation type row 문자열을 row separator 기준으로 나눈다.
fn split_ontology_relation_type_rows(rows: &str) -> Vec<&str> {
    if rows.is_empty() {
        Vec::new()
    } else {
        rows.split('\u{1f}').collect()
    }
}

/// ontology entity type id가 알려진 type인지 확인한다.
fn is_known_ontology_entity_type(entity_type_ids: &[&str], type_id: &str) -> bool {
    type_id == ONTOLOGY_ANY_ENTITY_TYPE || entity_type_ids.contains(&type_id)
}

/// relation domain/range row가 특정 entity type을 허용하는지 확인한다.
fn ontology_type_row_contains(type_row: &str, type_id: &str) -> bool {
    split_entity_wire_values(type_row)
        .any(|candidate| candidate == ONTOLOGY_ANY_ENTITY_TYPE || candidate == type_id)
}

/// `GraphRAG` entity 이름을 기존 `TypeScript` 정규화 규칙과 같게 만든다.
fn normalize_graph_entity_name(name: &str) -> String {
    let mut normalized = String::new();
    let mut last_was_space = true;

    for character in name.trim().to_lowercase().chars() {
        if is_entity_name_separator(character) || character.is_whitespace() {
            if !last_was_space {
                normalized.push(' ');
                last_was_space = true;
            }
            continue;
        }
        normalized.push(character);
        last_was_space = false;
    }

    if normalized.ends_with(' ') {
        normalized.pop();
    }
    normalized
}

/// `GraphRAG` extraction record id part를 현재 `TypeScript` regex 계약과 같게 만든다.
fn sanitize_graph_id_part_value(part: &str) -> String {
    let mut sanitized = String::new();
    let mut last_was_replacement = false;

    for character in part.trim().to_lowercase().chars() {
        if is_graph_id_part_character(character) {
            sanitized.push(character);
            last_was_replacement = false;
        } else if !last_was_replacement {
            sanitized.push('-');
            last_was_replacement = true;
        }
    }

    sanitized
}

/// Graph extraction payload를 정규화한다.
fn normalize_extracted_graph_payload(value: &JsonValue) -> Option<NormalizedGraphPayload> {
    let payload = value.as_object()?;
    let entity_items = collect_graph_entity_items(payload);
    let relation_items = payload
        .get("relations")
        .map_or_else(Vec::new, collect_graph_record_items);
    let claim_items = payload
        .get("claims")
        .map_or_else(Vec::new, collect_graph_record_items);
    let has_known_shape = payload.contains_key("entities")
        || payload.contains_key("relations")
        || payload.contains_key("claims")
        || entity_items.inferred_from_top_level;
    if !has_known_shape {
        return None;
    }

    let entities = entity_items
        .items
        .iter()
        .filter_map(normalize_extracted_graph_entity)
        .collect::<Vec<_>>();
    let entity_reference_lookup = build_graph_entity_reference_lookup(&entity_items.items);
    let relations = relation_items
        .iter()
        .filter_map(normalize_extracted_graph_relation)
        .map(|relation| normalize_graph_relation_references(relation, &entity_reference_lookup))
        .collect::<Vec<_>>();
    let claims = claim_items
        .iter()
        .filter_map(normalize_extracted_graph_claim)
        .map(|claim| normalize_graph_claim_references(claim, &entity_reference_lookup))
        .collect::<Vec<_>>();
    let raw_fact_count = entity_items
        .items
        .len()
        .saturating_add(relation_items.len())
        .saturating_add(claim_items.len());

    Some(NormalizedGraphPayload {
        entities,
        relations,
        claims,
        raw_fact_count,
    })
}

/// raw entity의 id/name/label/alias를 canonical entity name으로 연결한다.
fn build_graph_entity_reference_lookup(
    items: &[GraphPayloadItem<'_>],
) -> BTreeMap<String, Option<String>> {
    let mut lookup = BTreeMap::new();
    for item in items {
        let Some(entity) = normalize_extracted_graph_entity(item) else {
            continue;
        };
        let Some(canonical_name) = entity
            .as_object()
            .and_then(|object| object.get("name"))
            .and_then(JsonValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        let canonical_name = canonical_name.to_owned();
        insert_graph_entity_reference(&mut lookup, &canonical_name, &canonical_name);
        if let Some(fallback_name) = item.fallback_name {
            insert_graph_entity_reference(&mut lookup, fallback_name, &canonical_name);
        }
        let Some(object) = item.value.as_object() else {
            continue;
        };
        for key in GRAPH_ENTITY_NAME_KEYS {
            if let Some(reference) = object.get(*key).and_then(JsonValue::as_str) {
                insert_graph_entity_reference(&mut lookup, reference, &canonical_name);
            }
        }
        if let Some(aliases) = get_graph_string_array_field(object, GRAPH_ALIAS_KEYS) {
            for alias in aliases {
                insert_graph_entity_reference(&mut lookup, &alias, &canonical_name);
            }
        }
    }
    lookup
}

/// 하나의 normalized reference가 두 entity를 가리키면 ambiguous 상태로 보존한다.
fn insert_graph_entity_reference(
    lookup: &mut BTreeMap<String, Option<String>>,
    reference: &str,
    canonical_name: &str,
) {
    let normalized = normalize_graph_entity_name(reference);
    if normalized.is_empty() {
        return;
    }
    match lookup.get_mut(&normalized) {
        Some(existing) if existing.as_deref() != Some(canonical_name) => *existing = None,
        Some(_) => {}
        None => {
            lookup.insert(normalized, Some(canonical_name.to_owned()));
        }
    }
}

/// relation endpoint reference를 canonical entity name으로 바꾼다.
fn normalize_graph_relation_references(
    mut relation: JsonValue,
    lookup: &BTreeMap<String, Option<String>>,
) -> JsonValue {
    let Some(object) = relation.as_object_mut() else {
        return relation;
    };
    for key in ["source", "target"] {
        let Some(reference) = object.get(key).and_then(JsonValue::as_str) else {
            continue;
        };
        if let Some(canonical_name) = resolve_graph_entity_reference(reference, lookup) {
            object.insert(key.to_owned(), JsonValue::String(canonical_name.to_owned()));
        }
    }
    relation
}

/// claim entity reference 배열을 canonical entity name으로 바꾼다.
fn normalize_graph_claim_references(
    mut claim: JsonValue,
    lookup: &BTreeMap<String, Option<String>>,
) -> JsonValue {
    let Some(object) = claim.as_object_mut() else {
        return claim;
    };
    let Some(entity_names) = object
        .get_mut("entityNames")
        .and_then(JsonValue::as_array_mut)
    else {
        return claim;
    };
    for entity_name in entity_names {
        let Some(reference) = entity_name.as_str() else {
            continue;
        };
        if let Some(canonical_name) = resolve_graph_entity_reference(reference, lookup) {
            *entity_name = JsonValue::String(canonical_name.to_owned());
        }
    }
    claim
}

/// ambiguous하지 않은 entity reference만 canonical name으로 해석한다.
fn resolve_graph_entity_reference<'a>(
    reference: &str,
    lookup: &'a BTreeMap<String, Option<String>>,
) -> Option<&'a str> {
    lookup
        .get(&normalize_graph_entity_name(reference))
        .and_then(Option::as_deref)
}

/// Graph extraction entity 후보 item을 수집한다.
fn collect_graph_entity_items(payload: &JsonMap<String, JsonValue>) -> GraphEntityItems<'_> {
    if let Some(entities) = payload.get("entities") {
        return GraphEntityItems {
            items: collect_graph_record_items(entities),
            inferred_from_top_level: false,
        };
    }

    let items = payload
        .iter()
        .filter_map(|(key, value)| {
            let object = value.as_object()?;
            get_graph_string_field(object, GRAPH_ENTITY_TYPE_KEYS)?;
            Some(GraphPayloadItem {
                value,
                fallback_name: Some(key.as_str()),
            })
        })
        .collect::<Vec<_>>();
    let inferred_from_top_level = !items.is_empty();
    GraphEntityItems {
        items,
        inferred_from_top_level,
    }
}

/// Graph extraction array 또는 keyed object에서 record item을 수집한다.
fn collect_graph_record_items(value: &JsonValue) -> Vec<GraphPayloadItem<'_>> {
    if let Some(items) = value.as_array() {
        return items
            .iter()
            .map(|item| GraphPayloadItem {
                value: item,
                fallback_name: None,
            })
            .collect();
    }
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    object
        .iter()
        .map(|(key, item)| GraphPayloadItem {
            value: item,
            fallback_name: Some(key.as_str()),
        })
        .collect()
}

/// raw entity JSON을 normalized entity JSON으로 변환한다.
fn normalize_extracted_graph_entity(item: &GraphPayloadItem<'_>) -> Option<JsonValue> {
    let object = item.value.as_object()?;
    let name = get_graph_string_field(object, GRAPH_ENTITY_NAME_KEYS)
        .or_else(|| item.fallback_name.map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())?;
    let type_id = get_graph_string_field(object, GRAPH_ENTITY_TYPE_KEYS)?;

    let mut entity = JsonMap::new();
    insert_graph_string(&mut entity, "name", name);
    insert_graph_string(&mut entity, "typeId", type_id);
    insert_optional_graph_string(
        &mut entity,
        "description",
        get_graph_string_field(object, GRAPH_DESCRIPTION_KEYS),
    );
    insert_optional_graph_string_array(
        &mut entity,
        "aliases",
        get_graph_string_array_field(object, GRAPH_ALIAS_KEYS),
    );
    insert_optional_graph_number(
        &mut entity,
        "confidence",
        get_graph_number_field(object, GRAPH_CONFIDENCE_KEYS),
    );
    Some(JsonValue::Object(entity))
}

/// raw relation JSON을 normalized relation JSON으로 변환한다.
fn normalize_extracted_graph_relation(item: &GraphPayloadItem<'_>) -> Option<JsonValue> {
    let object = item.value.as_object()?;
    let source = get_graph_string_field(object, GRAPH_RELATION_SOURCE_KEYS)?;
    let target = get_graph_string_field(object, GRAPH_RELATION_TARGET_KEYS)?;
    let relation_type_id = get_graph_string_field(object, GRAPH_RELATION_TYPE_KEYS)?;

    let mut relation = JsonMap::new();
    insert_graph_string(&mut relation, "source", source);
    insert_graph_string(&mut relation, "target", target);
    insert_graph_string(&mut relation, "relationTypeId", relation_type_id);
    insert_optional_graph_string(
        &mut relation,
        "description",
        get_graph_string_field(object, GRAPH_DESCRIPTION_KEYS),
    );
    insert_optional_graph_number(
        &mut relation,
        "confidence",
        get_graph_number_field(object, GRAPH_CONFIDENCE_KEYS),
    );
    Some(JsonValue::Object(relation))
}

/// raw claim JSON을 normalized claim JSON으로 변환한다.
fn normalize_extracted_graph_claim(item: &GraphPayloadItem<'_>) -> Option<JsonValue> {
    let object = item.value.as_object()?;
    let text = get_graph_string_field(object, GRAPH_CLAIM_TEXT_KEYS)?;
    let claim_type_id = get_graph_string_field(object, GRAPH_CLAIM_TYPE_KEYS)?;

    let mut claim = JsonMap::new();
    insert_graph_string(&mut claim, "text", text);
    insert_graph_string(&mut claim, "claimTypeId", claim_type_id);
    insert_optional_graph_string_array(
        &mut claim,
        "entityNames",
        get_graph_claim_entity_names(object),
    );
    insert_optional_graph_string(
        &mut claim,
        "stance",
        get_graph_claim_stance(object.get("stance")).map(ToOwned::to_owned),
    );
    insert_optional_graph_number(
        &mut claim,
        "confidence",
        get_graph_number_field(object, GRAPH_CONFIDENCE_KEYS),
    );
    Some(JsonValue::Object(claim))
}

/// object에서 첫 번째 non-empty string field를 찾는다.
fn get_graph_string_field(object: &JsonMap<String, JsonValue>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        let value = object.get(*key)?.as_str()?.trim().to_owned();
        if value.is_empty() { None } else { Some(value) }
    })
}

/// object에서 첫 번째 non-empty string array field를 찾는다.
fn get_graph_string_array_field(
    object: &JsonMap<String, JsonValue>,
    keys: &[&str],
) -> Option<Vec<String>> {
    for key in keys {
        let Some(candidate) = object.get(*key) else {
            continue;
        };
        if let Some(text) = candidate.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(vec![trimmed.to_owned()]);
            }
            continue;
        }
        let Some(values) = candidate.as_array() else {
            continue;
        };
        let strings = values
            .iter()
            .filter_map(JsonValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if !strings.is_empty() {
            return Some(strings);
        }
    }
    None
}

/// object에서 첫 번째 finite number field를 찾는다.
fn get_graph_number_field(object: &JsonMap<String, JsonValue>, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .filter_map(|key| object.get(*key)?.as_f64())
        .find(|value| value.is_finite())
}

/// claim object에서 entity name 목록을 수집하고 순서 보존 dedupe를 적용한다.
fn get_graph_claim_entity_names(object: &JsonMap<String, JsonValue>) -> Option<Vec<String>> {
    let mut names =
        get_graph_string_array_field(object, GRAPH_CLAIM_ENTITY_LIST_KEYS).unwrap_or_default();
    for key in GRAPH_CLAIM_SINGLE_ENTITY_KEYS {
        if let Some(candidate) = get_graph_string_field(object, &[*key]) {
            push_unique_string(&mut names, candidate);
        }
    }
    if names.is_empty() { None } else { Some(names) }
}

/// claim stance를 graph store 계약 값으로 제한한다.
fn get_graph_claim_stance(value: Option<&JsonValue>) -> Option<&'static str> {
    match value.and_then(JsonValue::as_str) {
        Some("supports") => Some("supports"),
        Some("opposes") => Some("opposes"),
        Some("neutral") => Some("neutral"),
        Some("interprets") => Some("interprets"),
        _ => None,
    }
}

/// JSON object에 string field를 넣는다.
fn insert_graph_string(object: &mut JsonMap<String, JsonValue>, key: &str, value: String) {
    object.insert(key.to_owned(), JsonValue::String(value));
}

/// JSON object에 optional string field를 넣는다.
fn insert_optional_graph_string(
    object: &mut JsonMap<String, JsonValue>,
    key: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        insert_graph_string(object, key, value);
    }
}

/// JSON object에 optional string array field를 넣는다.
fn insert_optional_graph_string_array(
    object: &mut JsonMap<String, JsonValue>,
    key: &str,
    value: Option<Vec<String>>,
) {
    let Some(values) = value else {
        return;
    };
    object.insert(
        key.to_owned(),
        JsonValue::Array(values.into_iter().map(JsonValue::String).collect()),
    );
}

/// JSON object에 optional number field를 넣는다.
fn insert_optional_graph_number(
    object: &mut JsonMap<String, JsonValue>,
    key: &str,
    value: Option<f64>,
) {
    let Some(value) = value else {
        return;
    };
    let Some(number) = JsonNumber::from_f64(value) else {
        return;
    };
    object.insert(key.to_owned(), JsonValue::Number(number));
}

/// string 목록에 중복 없이 값을 추가한다.
fn push_unique_string(values: &mut Vec<String>, candidate: String) {
    if !values.iter().any(|value| value == &candidate) {
        values.push(candidate);
    }
}

/// normalized graph payload 안의 유효 fact 수를 계산한다.
const fn valid_graph_fact_count(payload: &NormalizedGraphPayload) -> usize {
    payload
        .entities
        .len()
        .saturating_add(payload.relations.len())
        .saturating_add(payload.claims.len())
}

/// normalized graph payload object를 만든다.
fn normalized_graph_payload_json_value(payload: &NormalizedGraphPayload) -> JsonValue {
    let mut payload_object = JsonMap::new();
    payload_object.insert(
        "entities".to_owned(),
        JsonValue::Array(payload.entities.clone()),
    );
    payload_object.insert(
        "relations".to_owned(),
        JsonValue::Array(payload.relations.clone()),
    );
    payload_object.insert(
        "claims".to_owned(),
        JsonValue::Array(payload.claims.clone()),
    );
    JsonValue::Object(payload_object)
}

/// normalized graph payload를 TS bridge JSON으로 직렬화한다.
fn serialize_normalized_graph_payload(payload: &NormalizedGraphPayload) -> String {
    let mut root = JsonMap::new();
    root.insert(
        "payload".to_owned(),
        normalized_graph_payload_json_value(payload),
    );
    root.insert(
        "rawFactCount".to_owned(),
        JsonValue::Number(usize_to_json_number(payload.raw_fact_count)),
    );
    serde_json::to_string(&JsonValue::Object(root)).unwrap_or_default()
}

/// graph payload parse 성공 결과를 TS bridge JSON으로 직렬화한다.
fn serialize_graph_payload_parse_success(payload: &NormalizedGraphPayload) -> String {
    let mut root = JsonMap::new();
    root.insert("ok".to_owned(), JsonValue::Bool(true));
    root.insert(
        "payload".to_owned(),
        normalized_graph_payload_json_value(payload),
    );
    serde_json::to_string(&JsonValue::Object(root)).unwrap_or_default()
}

/// graph payload parse 실패 결과를 TS bridge JSON으로 직렬화한다.
fn serialize_graph_payload_parse_rejection(reason: &str, raw_fact: &JsonValue) -> String {
    let mut root = JsonMap::new();
    root.insert("ok".to_owned(), JsonValue::Bool(false));
    root.insert("reason".to_owned(), JsonValue::String(reason.to_owned()));
    root.insert("rawFact".to_owned(), raw_fact.clone());
    serde_json::to_string(&JsonValue::Object(root)).unwrap_or_default()
}

/// usize 값을 JSON number로 변환한다.
fn usize_to_json_number(value: usize) -> JsonNumber {
    u64::try_from(value).map_or_else(|_| JsonNumber::from(u64::MAX), JsonNumber::from)
}

/// `GraphRAG` LLM 응답에서 JSON object slice를 찾는다.
fn extract_json_object(raw_response: &str) -> Option<&str> {
    let trimmed = raw_response.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    if let Some(fenced) = extract_fenced_json_object(trimmed) {
        return Some(fenced);
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    trimmed.get(start..=end)
}

/// Markdown fenced block에서 JSON object slice를 찾는다.
fn extract_fenced_json_object(trimmed: &str) -> Option<&str> {
    let fence_start = trimmed.find("```")?;
    let after_fence = trimmed.get(fence_start.saturating_add(3)..)?;
    let after_tag = strip_optional_json_fence_tag(after_fence).trim_start();
    let fence_end = after_tag.find("```")?;
    let fenced = after_tag.get(..fence_end)?.trim();
    if fenced.starts_with('{') && fenced.ends_with('}') {
        Some(fenced)
    } else {
        None
    }
}

/// fenced code block의 선택적 `json` 태그를 제거한다.
fn strip_optional_json_fence_tag(after_fence: &str) -> &str {
    if after_fence
        .get(..4)
        .is_some_and(|tag| tag.eq_ignore_ascii_case("json"))
    {
        after_fence.get(4..).unwrap_or_default()
    } else {
        after_fence
    }
}

/// `GraphRAG` extraction record id에 그대로 둘 수 있는 문자인지 확인한다.
const fn is_graph_id_part_character(character: char) -> bool {
    character.is_ascii_lowercase()
        || character.is_ascii_digit()
        || matches!(character, '_' | '.' | ':' | '-')
        || (character >= '\u{ac00}' && character <= '\u{d7a3}')
}

/// entity 이름에서 구분자로 취급하는 문자인지 확인한다.
const fn is_entity_name_separator(character: char) -> bool {
    matches!(
        character,
        '_' | '/'
            | '\\'
            | '|'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '"'
            | '\''
            | '「'
            | '」'
            | '『'
            | '』'
            | '【'
            | '】'
            | '《'
            | '》'
            | '.'
            | ','
            | ';'
            | ':'
            | '!'
            | '?'
    )
}

/// 두 문자열 목록이 공통 값을 갖는지 확인한다.
fn has_string_intersection(left: &[String], right: &[String]) -> bool {
    left.iter()
        .any(|left_value| right.iter().any(|right_value| left_value == right_value))
}

/// 두 entity name set 사이의 최대 이름 유사도를 계산한다.
fn max_entity_name_similarity(left: &[String], right: &[String]) -> f64 {
    let mut best = 0.0_f64;
    for left_name in left {
        for right_name in right {
            best = best.max(entity_name_similarity(left_name, right_name));
        }
    }
    best
}

/// 두 entity 이름의 token overlap/Jaccard 기반 유사도를 계산한다.
fn entity_name_similarity(left: &str, right: &str) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    if left == right {
        return 1.0;
    }

    let left_tokens = remove_weak_entity_name_tokens(&tokenize_entity_name(left));
    let right_tokens = remove_weak_entity_name_tokens(&tokenize_entity_name(right));
    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }

    let intersection = left_tokens
        .iter()
        .filter(|token| right_tokens.iter().any(|right_token| right_token == *token))
        .count();
    let Some(intersection_score) = usize_to_f64(intersection) else {
        return entity_jaccard_token_score(left, right);
    };
    let Some(denominator) = usize_to_f64(left_tokens.len().min(right_tokens.len())) else {
        return entity_jaccard_token_score(left, right);
    };
    let overlap = intersection_score / denominator;
    entity_jaccard_token_score(left, right).max(overlap)
}

/// 약한 entity 이름 token을 제거한다.
fn remove_weak_entity_name_tokens(tokens: &[String]) -> Vec<String> {
    tokens
        .iter()
        .filter(|token| !matches!(token.as_str(), "the" | "of" | "a" | "an"))
        .cloned()
        .collect()
}

/// 두 entity name set 사이의 최대 containment score를 계산한다.
fn max_entity_alias_containment_score(left: &[String], right: &[String]) -> f64 {
    let mut best = 0.0_f64;
    for left_name in left {
        for right_name in right {
            best = best.max(entity_containment_score(left_name, right_name));
        }
    }
    best
}

/// alias 부분 문자열 포함 score를 계산한다.
fn entity_containment_score(left: &str, right: &str) -> f64 {
    if left.is_empty() || right.is_empty() {
        return if left == right { 1.0 } else { 0.0 };
    }
    if left == right {
        return 1.0;
    }

    let (shorter, longer) = if left.len() <= right.len() {
        (left, right)
    } else {
        (right, left)
    };
    if !longer.contains(shorter) {
        return 0.0;
    }

    let Some(shorter_len) = usize_to_f64(shorter.len()) else {
        return 0.72;
    };
    let Some(longer_len) = usize_to_f64(longer.len()) else {
        return 0.72;
    };
    0.72_f64.max(shorter_len / longer_len)
}

/// entity evidence id에 공통 값이 있으면 1을 반환한다.
fn shared_entity_evidence_score(left: &str, right: &str) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let left_values = split_entity_wire_values(left).collect::<Vec<_>>();
    let right_values = split_entity_wire_values(right).collect::<Vec<_>>();
    if left_values.iter().any(|left_value| {
        right_values
            .iter()
            .any(|right_value| left_value == right_value)
    }) {
        1.0
    } else {
        0.0
    }
}

/// entity 텍스트의 token Jaccard score를 계산한다.
fn entity_jaccard_token_score(left: &str, right: &str) -> f64 {
    let left_tokens = unique_entity_tokens(left);
    let right_tokens = unique_entity_tokens(right);
    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }

    let intersection = left_tokens
        .iter()
        .filter(|token| right_tokens.contains(*token))
        .count();
    let union = left_tokens
        .iter()
        .chain(right_tokens.iter())
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .len();

    let Some(intersection_score) = usize_to_f64(intersection) else {
        return 0.0;
    };
    let Some(union_score) = usize_to_f64(union) else {
        return 0.0;
    };
    intersection_score / union_score
}

/// entity 텍스트를 정규화하고 공백 token으로 나눈다.
fn tokenize_entity_name(text: &str) -> Vec<String> {
    normalize_graph_entity_name(text)
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect()
}

/// entity 텍스트의 unique token set을 만든다.
fn unique_entity_tokens(text: &str) -> std::collections::BTreeSet<String> {
    tokenize_entity_name(text).into_iter().collect()
}

/// flat edge 배열에서 community detection graph를 만든다.
fn build_community_graph(
    source_indices: &[u32],
    target_indices: &[u32],
    weights: &[f64],
    node_count: usize,
) -> Option<CommunityGraph> {
    let mut adjacency = vec![Vec::<(usize, f64)>::new(); node_count];
    let mut degrees = vec![0.0_f64; node_count];
    let mut total_weight = 0.0_f64;

    for ((source_index, target_index), weight) in source_indices
        .iter()
        .copied()
        .zip(target_indices.iter().copied())
        .zip(weights.iter().copied())
    {
        if weight <= 0.0 {
            continue;
        }
        let Ok(source) = usize::try_from(source_index) else {
            return None;
        };
        let Ok(target) = usize::try_from(target_index) else {
            return None;
        };
        if source >= node_count || target >= node_count {
            return None;
        }

        add_weighted_neighbor(&mut adjacency, source, target, weight)?;
        add_weighted_neighbor(&mut adjacency, target, source, weight)?;
        if let Some(degree) = degrees.get_mut(source) {
            *degree += weight;
        }
        if let Some(degree) = degrees.get_mut(target) {
            *degree += weight;
        }
        total_weight = weight.mul_add(2.0, total_weight);
    }

    Some(CommunityGraph {
        adjacency,
        degrees,
        total_weight,
    })
}

/// adjacency list에 weight를 누적한다.
fn add_weighted_neighbor(
    adjacency: &mut [Vec<(usize, f64)>],
    source: usize,
    target: usize,
    weight: f64,
) -> Option<()> {
    let neighbors = adjacency.get_mut(source)?;
    if let Some((_, existing_weight)) = neighbors
        .iter_mut()
        .find(|(neighbor, _)| *neighbor == target)
    {
        *existing_weight += weight;
    } else {
        neighbors.push((target, weight));
    }
    Some(())
}

/// relation endpoint pair를 첫 출현 순서대로 집계한다.
fn aggregate_graph_edges(
    source_indices: &[u32],
    target_indices: &[u32],
    confidences: &[f64],
    node_count: usize,
) -> Option<Vec<AggregatedGraphEdge>> {
    let mut edges = Vec::<AggregatedGraphEdge>::new();
    let mut edge_position_by_pair = BTreeMap::<(usize, usize), usize>::new();

    for ((source_index, target_index), confidence) in source_indices
        .iter()
        .copied()
        .zip(target_indices.iter().copied())
        .zip(confidences.iter().copied())
    {
        let source = bounded_u32_index(source_index, node_count)?;
        let target = bounded_u32_index(target_index, node_count)?;
        let left = source.min(target);
        let right = source.max(target);

        match edge_position_by_pair.entry((left, right)) {
            Entry::Occupied(position) => {
                if let Some(edge) = edges.get_mut(*position.get()) {
                    edge.weight += confidence;
                }
            }
            Entry::Vacant(position) => {
                position.insert(edges.len());
                edges.push(AggregatedGraphEdge {
                    source_index: left,
                    target_index: right,
                    weight: confidence,
                });
            }
        }
    }

    Some(edges)
}

/// entity/relation string snapshot에서 aggregate 가능한 edge record를 만든다.
fn plan_graph_edge_records(
    entity_ids: &[String],
    relation_source_ids: &[String],
    relation_target_ids: &[String],
    confidences: &[f64],
) -> Option<Vec<CommunityEdgeRecord>> {
    if relation_source_ids.len() != relation_target_ids.len()
        || relation_source_ids.len() != confidences.len()
    {
        return None;
    }

    let sorted_entity_ids = entity_ids
        .iter()
        .filter(|id| !id.is_empty())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if sorted_entity_ids.is_empty() {
        return Some(Vec::new());
    }

    let entity_index_by_id = sorted_entity_ids
        .iter()
        .enumerate()
        .map(|(index, id)| Some((id.as_str(), u32::try_from(index).ok()?)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let mut source_indices = Vec::<u32>::new();
    let mut target_indices = Vec::<u32>::new();
    let mut edge_confidences = Vec::<f64>::new();

    for ((source_id, target_id), confidence) in relation_source_ids
        .iter()
        .zip(relation_target_ids.iter())
        .zip(confidences.iter().copied())
    {
        let Some(source_index) = entity_index_by_id.get(source_id.as_str()) else {
            continue;
        };
        let Some(target_index) = entity_index_by_id.get(target_id.as_str()) else {
            continue;
        };
        source_indices.push(*source_index);
        target_indices.push(*target_index);
        edge_confidences.push(confidence);
    }

    if source_indices.is_empty() {
        return Some(Vec::new());
    }

    let aggregated = aggregate_graph_edges(
        &source_indices,
        &target_indices,
        &edge_confidences,
        sorted_entity_ids.len(),
    )?;

    aggregated
        .iter()
        .map(|edge| {
            Some(CommunityEdgeRecord {
                source: sorted_entity_ids.get(edge.source_index)?.to_owned(),
                target: sorted_entity_ids.get(edge.target_index)?.to_owned(),
                weight: edge.weight,
            })
        })
        .collect()
}

/// string edge record에서 community detection plan을 계산한다.
fn detect_communities_from_edge_records(
    edges: &[CommunityEdgeRecord],
    max_iterations: usize,
) -> Option<CommunityDetectionPlan> {
    let entity_ids = sorted_community_entity_ids(edges);
    if entity_ids.is_empty() {
        return Some(CommunityDetectionPlan {
            assignments: Vec::new(),
            community_ids: Vec::new(),
            modularity: 0.0,
        });
    }

    let entity_index_by_id = entity_ids
        .iter()
        .enumerate()
        .map(|(index, id)| Some((id.as_str(), u32::try_from(index).ok()?)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let mut source_indices = Vec::with_capacity(edges.len());
    let mut target_indices = Vec::with_capacity(edges.len());
    let mut weights = Vec::with_capacity(edges.len());
    for edge in edges {
        let source_index = entity_index_by_id.get(edge.source.as_str()).copied()?;
        let target_index = entity_index_by_id.get(edge.target.as_str()).copied()?;
        source_indices.push(source_index);
        target_indices.push(target_index);
        weights.push(edge.weight);
    }

    let graph =
        build_community_graph(&source_indices, &target_indices, &weights, entity_ids.len())?;
    if graph.total_weight == 0.0 {
        return Some(CommunityDetectionPlan {
            assignments: Vec::new(),
            community_ids: Vec::new(),
            modularity: 0.0,
        });
    }
    let assignments =
        remap_community_assignments(&detect_community_assignments(&graph, max_iterations));
    let modularity = calculate_community_modularity(&graph, &assignments);
    let mut community_ids = assignments.clone();
    community_ids.sort_unstable();
    community_ids.dedup();
    let assignments = entity_ids
        .into_iter()
        .zip(assignments)
        .map(|(entity_id, community_id)| CommunityAssignmentById {
            entity_id,
            community_id,
        })
        .collect();

    Some(CommunityDetectionPlan {
        assignments,
        community_ids,
        modularity,
    })
}

/// community edge record의 endpoint id를 정렬된 unique 목록으로 만든다.
fn sorted_community_entity_ids(edges: &[CommunityEdgeRecord]) -> Vec<String> {
    let mut ids = BTreeSet::<String>::new();
    for edge in edges {
        ids.insert(edge.source.clone());
        ids.insert(edge.target.clone());
    }
    ids.into_iter().collect()
}

/// 집계 edge를 `[sourceIndex, targetIndex, weight]` flat triple로 변환한다.
fn encode_aggregated_graph_edges(edges: &[AggregatedGraphEdge]) -> Box<[f64]> {
    let mut output = Vec::with_capacity(edges.len().saturating_mul(3));
    for edge in edges {
        let Some(source_index) = usize_to_f64(edge.source_index) else {
            return Box::default();
        };
        let Some(target_index) = usize_to_f64(edge.target_index) else {
            return Box::default();
        };
        output.push(source_index);
        output.push(target_index);
        output.push(edge.weight);
    }
    output.into_boxed_slice()
}

/// Graph store snapshot에서 prune index plan을 계산한다.
fn compute_graph_prune_plan(input: &GraphPruneInput<'_>) -> GraphPrunePlan {
    let mut plan = GraphPrunePlan::default();
    let mut removed_evidence = vec![false; input.evidence_file_paths.len()];
    let file_path_set = input.file_paths.iter().copied().collect::<BTreeSet<_>>();
    let mut removed_entry_ids = BTreeSet::<&str>::new();
    let mut affected_schema_ids = BTreeSet::<&str>::new();

    collect_removed_evidence(
        input,
        &file_path_set,
        &mut plan,
        &mut removed_evidence,
        &mut removed_entry_ids,
    );
    let deleted_entities = collect_pruned_entities(
        input,
        &removed_evidence,
        &mut affected_schema_ids,
        &mut plan,
    );
    let deleted_relations = collect_pruned_relations(
        input,
        &removed_evidence,
        &deleted_entities,
        &mut affected_schema_ids,
        &mut plan,
    );
    let deleted_claims = collect_pruned_claims(
        input,
        &removed_evidence,
        &deleted_entities,
        &deleted_relations,
        &mut plan,
    );
    collect_pruned_communities(
        input,
        &affected_schema_ids,
        &deleted_entities,
        &deleted_relations,
        &deleted_claims,
        &mut plan,
    );
    collect_pruned_rejected_facts(input, &file_path_set, &mut removed_entry_ids, &mut plan);
    collect_pruned_extraction_cache(input, &file_path_set, &removed_entry_ids, &mut plan);
    collect_pruned_pending_merges(input, &deleted_entities, &mut plan);

    plan
}

/// 삭제 대상 file path에 속한 evidence를 수집한다.
fn collect_removed_evidence<'a>(
    input: &GraphPruneInput<'a>,
    file_path_set: &BTreeSet<&str>,
    plan: &mut GraphPrunePlan,
    removed_evidence: &mut [bool],
    removed_entry_ids: &mut BTreeSet<&'a str>,
) {
    for (evidence_index, file_path) in input.evidence_file_paths.iter().copied().enumerate() {
        if !file_path_set.contains(file_path) {
            continue;
        }
        plan.deleted_evidence.push(evidence_index);
        if let Some(slot) = removed_evidence.get_mut(evidence_index) {
            *slot = true;
        }
        if let Some(entry_id) = input.evidence_entry_ids.get(evidence_index).copied() {
            removed_entry_ids.insert(entry_id);
        }
    }
}

/// 삭제/갱신할 entity를 수집한다.
fn collect_pruned_entities<'a>(
    input: &GraphPruneInput<'a>,
    removed_evidence: &[bool],
    affected_schema_ids: &mut BTreeSet<&'a str>,
    plan: &mut GraphPrunePlan,
) -> Vec<bool> {
    let mut deleted_entities = vec![false; input.entity_schema_ids.len()];

    for entity_index in 0..input.entity_schema_ids.len() {
        let evidence_change = reference_range_contains_removed(
            input.entity_evidence_offsets,
            input.entity_evidence_indices,
            entity_index,
            removed_evidence,
        );
        if !evidence_change {
            continue;
        }
        if let Some(schema_id) = input.entity_schema_ids.get(entity_index).copied() {
            affected_schema_ids.insert(schema_id);
        }
        if reference_range_remaining_count(
            input.entity_evidence_offsets,
            input.entity_evidence_indices,
            entity_index,
            removed_evidence,
        ) == 0
        {
            plan.deleted_entities.push(entity_index);
            if let Some(slot) = deleted_entities.get_mut(entity_index) {
                *slot = true;
            }
        } else {
            plan.updated_entities.push(entity_index);
            plan.updated_entity_evidence
                .push(remaining_reference_indices(
                    input.entity_evidence_offsets,
                    input.entity_evidence_indices,
                    entity_index,
                    removed_evidence,
                ));
        }
    }

    deleted_entities
}

/// 삭제/갱신할 relation을 수집한다.
fn collect_pruned_relations<'a>(
    input: &GraphPruneInput<'a>,
    removed_evidence: &[bool],
    deleted_entities: &[bool],
    affected_schema_ids: &mut BTreeSet<&'a str>,
    plan: &mut GraphPrunePlan,
) -> Vec<bool> {
    let mut deleted_relations = vec![false; input.relation_schema_ids.len()];

    for relation_index in 0..input.relation_schema_ids.len() {
        let evidence_change = reference_range_contains_removed(
            input.relation_evidence_offsets,
            input.relation_evidence_indices,
            relation_index,
            removed_evidence,
        );
        let has_deleted_endpoint = index_points_to_removed(
            input
                .relation_source_entity_indices
                .get(relation_index)
                .copied()
                .unwrap_or(GRAPH_PRUNE_UNKNOWN_INDEX),
            deleted_entities,
        ) || index_points_to_removed(
            input
                .relation_target_entity_indices
                .get(relation_index)
                .copied()
                .unwrap_or(GRAPH_PRUNE_UNKNOWN_INDEX),
            deleted_entities,
        );
        if !evidence_change && !has_deleted_endpoint {
            continue;
        }
        if let Some(schema_id) = input.relation_schema_ids.get(relation_index).copied() {
            affected_schema_ids.insert(schema_id);
        }
        if has_deleted_endpoint
            || reference_range_remaining_count(
                input.relation_evidence_offsets,
                input.relation_evidence_indices,
                relation_index,
                removed_evidence,
            ) == 0
        {
            plan.deleted_relations.push(relation_index);
            if let Some(slot) = deleted_relations.get_mut(relation_index) {
                *slot = true;
            }
        } else {
            plan.updated_relations.push(relation_index);
            plan.updated_relation_evidence
                .push(remaining_reference_indices(
                    input.relation_evidence_offsets,
                    input.relation_evidence_indices,
                    relation_index,
                    removed_evidence,
                ));
        }
    }

    deleted_relations
}

/// 삭제/갱신할 claim을 수집한다.
fn collect_pruned_claims(
    input: &GraphPruneInput<'_>,
    removed_evidence: &[bool],
    deleted_entities: &[bool],
    deleted_relations: &[bool],
    plan: &mut GraphPrunePlan,
) -> Vec<bool> {
    let mut deleted_claims = vec![false; input.claim_evidence_offsets.len().saturating_sub(1)];

    for claim_index in 0..deleted_claims.len() {
        let evidence_change = reference_range_contains_removed(
            input.claim_evidence_offsets,
            input.claim_evidence_indices,
            claim_index,
            removed_evidence,
        );
        let entity_change = reference_range_contains_removed(
            input.claim_entity_offsets,
            input.claim_entity_indices,
            claim_index,
            deleted_entities,
        );
        let relation_change = reference_range_contains_removed(
            input.claim_relation_offsets,
            input.claim_relation_indices,
            claim_index,
            deleted_relations,
        );
        if !evidence_change && !entity_change && !relation_change {
            continue;
        }
        if reference_range_remaining_count(
            input.claim_evidence_offsets,
            input.claim_evidence_indices,
            claim_index,
            removed_evidence,
        ) == 0
        {
            plan.deleted_claims.push(claim_index);
            if let Some(slot) = deleted_claims.get_mut(claim_index) {
                *slot = true;
            }
        } else {
            plan.updated_claims.push(claim_index);
            plan.updated_claim_entities
                .push(remaining_reference_indices(
                    input.claim_entity_offsets,
                    input.claim_entity_indices,
                    claim_index,
                    deleted_entities,
                ));
            plan.updated_claim_relations
                .push(remaining_reference_indices(
                    input.claim_relation_offsets,
                    input.claim_relation_indices,
                    claim_index,
                    deleted_relations,
                ));
            plan.updated_claim_evidence
                .push(remaining_reference_indices(
                    input.claim_evidence_offsets,
                    input.claim_evidence_indices,
                    claim_index,
                    removed_evidence,
                ));
        }
    }

    deleted_claims
}

/// 삭제할 community를 수집한다.
fn collect_pruned_communities(
    input: &GraphPruneInput<'_>,
    affected_schema_ids: &BTreeSet<&str>,
    deleted_entities: &[bool],
    deleted_relations: &[bool],
    deleted_claims: &[bool],
    plan: &mut GraphPrunePlan,
) {
    for community_index in 0..input.community_schema_ids.len() {
        let affected_schema = input
            .community_schema_ids
            .get(community_index)
            .copied()
            .is_some_and(|schema_id| affected_schema_ids.contains(schema_id));
        let deleted_reference = reference_range_contains_removed(
            input.community_entity_offsets,
            input.community_entity_indices,
            community_index,
            deleted_entities,
        ) || reference_range_contains_removed(
            input.community_relation_offsets,
            input.community_relation_indices,
            community_index,
            deleted_relations,
        ) || reference_range_contains_removed(
            input.community_claim_offsets,
            input.community_claim_indices,
            community_index,
            deleted_claims,
        );
        if affected_schema || deleted_reference {
            plan.deleted_communities.push(community_index);
        }
    }
}

/// 삭제할 rejected fact를 수집하고 cache invalidation용 removed entry id에 추가한다.
fn collect_pruned_rejected_facts<'a>(
    input: &GraphPruneInput<'a>,
    file_path_set: &BTreeSet<&str>,
    removed_entry_ids: &mut BTreeSet<&'a str>,
    plan: &mut GraphPrunePlan,
) {
    for (index, file_path) in input.rejected_fact_file_paths.iter().copied().enumerate() {
        if !file_path_set.contains(file_path) {
            continue;
        }
        plan.deleted_rejected_facts.push(index);
        if let Some(entry_id) = input.rejected_fact_entry_ids.get(index).copied() {
            removed_entry_ids.insert(entry_id);
        }
    }
}

/// 삭제할 extraction cache entry를 수집한다.
fn collect_pruned_extraction_cache(
    input: &GraphPruneInput<'_>,
    file_path_set: &BTreeSet<&str>,
    removed_entry_ids: &BTreeSet<&str>,
    plan: &mut GraphPrunePlan,
) {
    for (index, entry_id) in input.extraction_cache_entry_ids.iter().copied().enumerate() {
        if removed_entry_ids.contains(entry_id)
            || file_path_set.contains(entry_id)
            || input
                .file_paths
                .iter()
                .copied()
                .any(|file_path| entry_id_matches_file_path(entry_id, file_path))
        {
            plan.deleted_extraction_cache.push(index);
        }
    }
}

/// 삭제할 pending entity merge를 수집한다.
fn collect_pruned_pending_merges(
    input: &GraphPruneInput<'_>,
    deleted_entities: &[bool],
    plan: &mut GraphPrunePlan,
) {
    for index in 0..input.pending_merge_existing_entity_indices.len() {
        let existing_deleted = index_points_to_removed(
            input
                .pending_merge_existing_entity_indices
                .get(index)
                .copied()
                .unwrap_or(GRAPH_PRUNE_UNKNOWN_INDEX),
            deleted_entities,
        );
        let candidate_deleted = index_points_to_removed(
            input
                .pending_merge_candidate_entity_indices
                .get(index)
                .copied()
                .unwrap_or(GRAPH_PRUNE_UNKNOWN_INDEX),
            deleted_entities,
        );
        if existing_deleted || candidate_deleted {
            plan.deleted_pending_merges.push(index);
        }
    }
}

/// offset range 안에 삭제된 참조가 하나라도 있는지 확인한다.
fn reference_range_contains_removed(
    offsets: &[u32],
    indices: &[u32],
    item_index: usize,
    removed: &[bool],
) -> bool {
    let Some(range) = offset_range(offsets, item_index, indices.len()) else {
        return false;
    };
    indices.get(range).is_some_and(|values| {
        values
            .iter()
            .copied()
            .any(|index| index_points_to_removed(index, removed))
    })
}

/// offset range 안에서 삭제되지 않은 참조 수를 계산한다.
fn reference_range_remaining_count(
    offsets: &[u32],
    indices: &[u32],
    item_index: usize,
    removed: &[bool],
) -> usize {
    let Some(range) = offset_range(offsets, item_index, indices.len()) else {
        return 0;
    };
    indices
        .get(range)
        .map(|values| {
            values
                .iter()
                .copied()
                .filter(|index| !index_points_to_removed(*index, removed))
                .count()
        })
        .unwrap_or_default()
}

/// offset range 안에서 삭제되지 않은 참조 위치를 기존 순서대로 반환한다.
fn remaining_reference_indices(
    offsets: &[u32],
    indices: &[u32],
    item_index: usize,
    removed: &[bool],
) -> Vec<usize> {
    let Some(range) = offset_range(offsets, item_index, indices.len()) else {
        return Vec::new();
    };
    let Some(values) = indices.get(range) else {
        return Vec::new();
    };
    values
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(position, index)| {
            (!index_points_to_removed(index, removed)).then_some(position)
        })
        .collect()
}

/// index가 삭제된 항목을 가리키는지 확인한다. unknown sentinel은 삭제되지 않은 것으로 취급한다.
fn index_points_to_removed(index: u32, removed: &[bool]) -> bool {
    if index == GRAPH_PRUNE_UNKNOWN_INDEX {
        return false;
    }
    bounded_u32_index(index, removed.len())
        .and_then(|value| removed.get(value).copied())
        .unwrap_or(false)
}

/// cache entry id가 file path 자체 또는 chunk id prefix에 매칭되는지 확인한다.
fn entry_id_matches_file_path(entry_id: &str, file_path: &str) -> bool {
    entry_id == file_path
        || entry_id
            .strip_prefix(file_path)
            .is_some_and(|suffix| suffix.starts_with("::"))
}

/// Louvain-style local move pass로 community assignment를 계산한다.
fn detect_community_assignments(graph: &CommunityGraph, max_iterations: usize) -> Vec<usize> {
    let node_count = graph.degrees.len();
    let mut community_of_node = (0..node_count).collect::<Vec<_>>();
    let mut community_degrees = graph.degrees.clone();
    let inv_total_weight = 1.0 / graph.total_weight;

    for _ in 0..max_iterations {
        let mut changed = false;

        for node_index in 0..node_count {
            let current_community = community_of_node
                .get(node_index)
                .copied()
                .unwrap_or(node_index);
            let degree = graph.degrees.get(node_index).copied().unwrap_or_default();
            let neighbor_communities =
                collect_neighbor_community_weights(node_index, graph, &community_of_node);
            if neighbor_communities.is_empty() {
                continue;
            }

            let current_neighbor_weight =
                get_weight_for_id(&neighbor_communities, current_community);
            let current_community_degree = community_degrees
                .get(current_community)
                .copied()
                .unwrap_or_default();
            let mut best_community = current_community;
            let mut best_delta = 0.0_f64;

            for (candidate_community, edge_weight_to_community) in &neighbor_communities {
                if *candidate_community == current_community {
                    continue;
                }
                let candidate_degree = community_degrees
                    .get(*candidate_community)
                    .copied()
                    .unwrap_or_default();
                let delta = (edge_weight_to_community - current_neighbor_weight).mul_add(
                    inv_total_weight,
                    (current_community_degree - candidate_degree)
                        * degree
                        * inv_total_weight
                        * inv_total_weight,
                );

                if delta > best_delta {
                    best_delta = delta;
                    best_community = *candidate_community;
                }
            }

            if best_community == current_community {
                continue;
            }
            if let Some(slot) = community_of_node.get_mut(node_index) {
                *slot = best_community;
            }
            if let Some(current_degree) = community_degrees.get_mut(current_community) {
                *current_degree -= degree;
            }
            if let Some(best_degree) = community_degrees.get_mut(best_community) {
                *best_degree += degree;
            }
            changed = true;
        }

        if !changed {
            break;
        }
    }

    community_of_node
}

/// node neighbor들을 현재 community별 weight로 합친다.
fn collect_neighbor_community_weights(
    node_index: usize,
    graph: &CommunityGraph,
    community_of_node: &[usize],
) -> Vec<(usize, f64)> {
    let mut neighbor_communities = Vec::<(usize, f64)>::new();
    let Some(neighbors) = graph.adjacency.get(node_index) else {
        return neighbor_communities;
    };

    for (neighbor, weight) in neighbors {
        let community = community_of_node
            .get(*neighbor)
            .copied()
            .unwrap_or(*neighbor);
        add_weight_for_id(&mut neighbor_communities, community, *weight);
    }

    neighbor_communities
}

/// `(id, weight)` list에 id별 weight를 누적하며 첫 출현 순서를 보존한다.
fn add_weight_for_id(items: &mut Vec<(usize, f64)>, id: usize, weight: f64) {
    if let Some((_, existing_weight)) = items.iter_mut().find(|(item_id, _)| *item_id == id) {
        *existing_weight += weight;
    } else {
        items.push((id, weight));
    }
}

/// `(id, weight)` list에서 id의 weight를 찾는다.
fn get_weight_for_id(items: &[(usize, f64)], id: usize) -> f64 {
    items
        .iter()
        .find_map(|(item_id, weight)| (*item_id == id).then_some(*weight))
        .unwrap_or_default()
}

/// raw community id를 0부터 시작하는 안정적인 id로 다시 매핑한다.
fn remap_community_assignments(raw_assignments: &[usize]) -> Vec<usize> {
    let mut unique_ids = raw_assignments.to_vec();
    unique_ids.sort_unstable();
    unique_ids.dedup();

    raw_assignments
        .iter()
        .map(|community_id| unique_ids.binary_search(community_id).unwrap_or_default())
        .collect()
}

/// community assignment의 modularity를 계산한다.
fn calculate_community_modularity(graph: &CommunityGraph, assignments: &[usize]) -> f64 {
    if graph.total_weight == 0.0 {
        return 0.0;
    }
    let mut score = 0.0_f64;

    for (node_index, neighbors) in graph.adjacency.iter().enumerate() {
        let community = assignments.get(node_index).copied().unwrap_or(node_index);
        for (neighbor, weight) in neighbors {
            let neighbor_community = assignments.get(*neighbor).copied().unwrap_or(*neighbor);
            if community != neighbor_community {
                continue;
            }
            let degree = graph.degrees.get(node_index).copied().unwrap_or_default();
            let neighbor_degree = graph.degrees.get(*neighbor).copied().unwrap_or_default();
            score += weight - (degree * neighbor_degree) / graph.total_weight;
        }
    }

    score / graph.total_weight
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
    let mut current_length = 0_usize;
    let mut current_heading = None;
    let mut start_line = 0_usize;
    let mut in_code_block = false;

    for (index, line) in lines.iter().enumerate() {
        if line.starts_with("```") {
            in_code_block = !in_code_block;
            push_chunk_line(&mut current_lines, &mut current_length, line);
            if !in_code_block && current_length > max_chunk_size {
                flush_chunk(
                    &mut chunks,
                    &mut current_lines,
                    current_heading.as_ref(),
                    start_line,
                    index,
                );
                current_length = 0;
                start_line = index.saturating_add(1);
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
                current_length = 0;
            }
            current_heading = Some(normalize_heading(line));
            start_line = index;
            set_chunk_lines(&mut current_lines, &mut current_length, vec![line.clone()]);
            continue;
        }

        push_chunk_line(&mut current_lines, &mut current_length, line);

        if !in_code_block && current_length >= max_chunk_size {
            let last_para_break = last_paragraph_break_len(&current_lines);
            if last_para_break
                .is_some_and(|break_index| break_index.saturating_mul(2) > max_chunk_size)
            {
                split_at_paragraph_break(
                    &mut chunks,
                    &mut current_lines,
                    &mut current_length,
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
                current_length = 0;
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
    let mut current_length = 0_usize;
    let mut start_line = 0_usize;

    for (index, line) in lines.iter().enumerate() {
        push_chunk_line(&mut current_lines, &mut current_length, line);
        if current_length < max_chunk_size {
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
            set_chunk_lines(&mut current_lines, &mut current_length, part);
            flush_chunk(
                &mut chunks,
                &mut current_lines,
                None,
                start_line,
                index.saturating_sub(rest.len()),
            );
            set_chunk_lines(&mut current_lines, &mut current_length, rest);
            start_line = index.saturating_sub(current_lines.len()).saturating_add(1);
            continue;
        }

        flush_chunk(&mut chunks, &mut current_lines, None, start_line, index);
        current_length = 0;
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

/// Obsidian wikilink와 Markdown link에서 vault 내부 target을 추출한다.
fn extract_vault_links(content: &str) -> Vec<String> {
    let mut links = Vec::<String>::new();
    extract_wiki_link_targets(content, &mut links);
    extract_markdown_link_targets(content, &mut links);
    links
}

/// assistant 답변에서 출처 참조를 추출한다.
fn extract_source_references(content: &str) -> Vec<SourceReferencePlan> {
    let mut references = Vec::<SourceReferencePlan>::new();
    collect_source_wiki_references(content, &mut references);
    collect_source_markdown_references(content, &mut references);
    collect_source_id_references(content, &mut references);
    references
}

/// `[[...]]` 출처 참조를 label/target/path alias plan으로 추출한다.
fn collect_source_wiki_references(content: &str, references: &mut Vec<SourceReferencePlan>) {
    let mut offset = 0_usize;
    while let Some(start) = content.get(offset..).and_then(|text| text.find("[[")) {
        let label_start = offset.saturating_add(start);
        let target_start = label_start.saturating_add(2);
        let Some(end) = content.get(target_start..).and_then(|text| text.find("]]")) else {
            break;
        };
        let target_end = target_start.saturating_add(end);
        let label_end = target_end.saturating_add(2);
        if let (Some(label), Some(raw_target)) = (
            content.get(label_start..label_end),
            content.get(target_start..target_end),
        ) {
            let target = normalize_vault_link_target(raw_target);
            if !target.is_empty() {
                references.push(SourceReferencePlan {
                    label: label.to_owned(),
                    aliases: source_path_aliases(&target),
                    target,
                    kind: SourceReferenceKind::Wikilink,
                });
            }
        }
        offset = label_end;
    }
}

/// `[label](target.md#heading)` 출처 참조를 label/target/path alias plan으로 추출한다.
fn collect_source_markdown_references(content: &str, references: &mut Vec<SourceReferencePlan>) {
    let mut offset = 0_usize;
    while let Some(start) = content.get(offset..).and_then(|text| text.find('[')) {
        let label_start = offset.saturating_add(start);
        let label_end_start = label_start.saturating_add(1);
        let Some(label_end_offset) = content
            .get(label_end_start..)
            .and_then(|text| text.find(']'))
        else {
            break;
        };
        let label_end = label_end_start.saturating_add(label_end_offset);
        let open_paren = label_end.saturating_add(1);
        if content.get(open_paren..open_paren.saturating_add(1)) != Some("(") {
            offset = label_end.saturating_add(1);
            continue;
        }

        let target_start = open_paren.saturating_add(1);
        let Some(target_end_offset) = content.get(target_start..).and_then(|text| text.find(')'))
        else {
            break;
        };
        let target_end = target_start.saturating_add(target_end_offset);
        let label_close = target_end.saturating_add(1);
        if let (Some(label), Some(raw_target)) = (
            content.get(label_start..label_close),
            content.get(target_start..target_end),
        ) && let Some(target) = normalize_source_markdown_target(raw_target)
        {
            references.push(SourceReferencePlan {
                label: label.to_owned(),
                aliases: source_path_aliases(&target),
                target,
                kind: SourceReferenceKind::MarkdownLink,
            });
        }
        offset = label_close;
    }
}

/// `Source rag-1` 같은 source id 참조를 추출한다.
fn collect_source_id_references(content: &str, references: &mut Vec<SourceReferencePlan>) {
    let mut offset = 0_usize;
    while let Some(relative_start) = content
        .get(offset..)
        .and_then(|text| find_ascii_case_insensitive(text, "source"))
    {
        let source_start = offset.saturating_add(relative_start);
        let source_end = source_start.saturating_add("source".len());
        if !is_source_word_boundary(content, source_start, source_end) {
            offset = source_end;
            continue;
        }

        let id_start = skip_whitespace(content, source_end);
        let Some(id_end) = parse_source_reference_id_end(content, id_start) else {
            offset = source_end;
            continue;
        };
        if !is_word_boundary_at(content, id_end) {
            offset = id_end;
            continue;
        }
        if let (Some(label), Some(target)) = (
            content.get(source_start..id_end),
            content.get(id_start..id_end),
        ) {
            references.push(SourceReferencePlan {
                label: label.to_owned(),
                target: target.to_owned(),
                kind: SourceReferenceKind::SourceId,
                aliases: Vec::new(),
            });
        }
        offset = id_end;
    }
}

/// Markdown source link target을 기존 `TypeScript` 계약과 같이 정규화한다.
fn normalize_source_markdown_target(raw_target: &str) -> Option<String> {
    if raw_target.chars().any(char::is_whitespace) {
        return None;
    }
    let without_heading = raw_target.split('#').next().unwrap_or_default();
    if !without_heading.to_lowercase().ends_with(".md") {
        return None;
    }
    let decoded =
        decode_uri_component(without_heading).unwrap_or_else(|| without_heading.to_owned());
    let target = decoded.trim().to_owned();
    if target.is_empty() {
        None
    } else {
        Some(target)
    }
}

/// 출처 검증용 path alias를 기존 UI 계약과 같은 순서로 만든다.
fn source_path_aliases(path: &str) -> Vec<String> {
    let without_heading = path.split('#').next().unwrap_or(path);
    let normalized = without_heading.trim_start_matches('/');
    let without_extension = strip_markdown_extension_case_insensitive(normalized);
    let file_name = normalized.rsplit('/').next().unwrap_or(normalized);
    let basename = strip_markdown_extension_case_insensitive(file_name);
    let mut aliases = Vec::<String>::new();
    push_unique_non_empty_string(&mut aliases, normalized.to_owned());
    push_unique_non_empty_string(&mut aliases, format!("{normalized}.md"));
    push_unique_non_empty_string(&mut aliases, without_extension.to_owned());
    push_unique_non_empty_string(&mut aliases, file_name.to_owned());
    push_unique_non_empty_string(&mut aliases, basename.to_owned());
    aliases
}

/// `.md` suffix를 case-insensitive로 제거한다.
fn strip_markdown_extension_case_insensitive(path: &str) -> &str {
    if path.len() >= 3
        && path
            .get(path.len().saturating_sub(3)..)
            .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".md"))
    {
        &path[..path.len().saturating_sub(3)]
    } else {
        path
    }
}

/// ASCII case-insensitive substring 위치를 찾는다.
fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .as_bytes()
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// `Source` token 양쪽이 JS `\b` word boundary에 맞는지 확인한다.
fn is_source_word_boundary(content: &str, start: usize, end: usize) -> bool {
    is_word_boundary_at(content, start) && is_word_boundary_at(content, end)
}

/// byte offset이 ASCII word boundary인지 확인한다.
fn is_word_boundary_at(content: &str, offset: usize) -> bool {
    let previous = content
        .get(..offset)
        .and_then(|prefix| prefix.chars().next_back())
        .is_some_and(is_ascii_word_char);
    let next = content
        .get(offset..)
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(is_ascii_word_char);
    previous != next
}

/// JS regex의 word char와 같은 ASCII 범위만 사용한다.
const fn is_ascii_word_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

/// source token 뒤 공백을 건너뛴다.
fn skip_whitespace(content: &str, offset: usize) -> usize {
    let mut cursor = offset;
    while cursor < content.len() {
        let Some(character) = content.get(cursor..).and_then(|tail| tail.chars().next()) else {
            break;
        };
        if !character.is_whitespace() {
            break;
        }
        cursor = cursor.saturating_add(character.len_utf8());
    }
    cursor
}

/// source id token 끝 byte offset을 반환한다.
fn parse_source_reference_id_end(content: &str, offset: usize) -> Option<usize> {
    let remaining = content.get(offset..)?;
    let prefix_len = ["rag-", "file-", "folder-"].iter().find_map(|prefix| {
        remaining
            .get(..prefix.len())
            .filter(|candidate| candidate.eq_ignore_ascii_case(prefix))
            .map(|_| prefix.len())
    })?;
    let digit_start = offset.saturating_add(prefix_len);
    let mut digit_end = digit_start;
    while digit_end < content.len() {
        let Some(byte) = content.as_bytes().get(digit_end).copied() else {
            break;
        };
        if !byte.is_ascii_digit() {
            break;
        }
        digit_end = digit_end.saturating_add(1);
    }
    if digit_end == digit_start {
        None
    } else {
        Some(digit_end)
    }
}

/// assistant 응답에서 질문 여부와 선택지 plan을 감지한다.
fn detect_assistant_question(
    text: &str,
    source: AssistantQuestionSource,
) -> Option<AssistantQuestionPlan> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return None;
    }
    if source == AssistantQuestionSource::Answer && is_assistant_follow_up_suggestion(normalized) {
        return None;
    }

    let choices = extract_assistant_choices(normalized);
    let prompt = extract_assistant_prompt(normalized, &choices);
    if source == AssistantQuestionSource::Answer
        && is_structured_assistant_answer(normalized, &prompt, &choices)
    {
        return None;
    }

    let has_question_signal = has_assistant_question_signal(&prompt);
    if choices.is_empty() && !has_question_signal {
        return None;
    }
    if !choices.is_empty()
        && !has_question_signal
        && !has_assistant_question_word_signal(normalized)
    {
        return None;
    }

    let selection_mode =
        if !choices.is_empty() && has_assistant_multiple_selection_signal(normalized) {
            AssistantSelectionMode::Multiple
        } else {
            AssistantSelectionMode::Single
        };

    Some(AssistantQuestionPlan {
        prompt: if prompt.is_empty() {
            normalized.to_owned()
        } else {
            prompt
        },
        choices,
        selection_mode,
        allow_free_text: true,
        source,
    })
}

/// assistant 답변의 선택지 행을 추출한다.
fn extract_assistant_choices(text: &str) -> Vec<AssistantChoicePlan> {
    let mut choices = Vec::<AssistantChoicePlan>::new();
    for line in text.lines() {
        let Some(label) = assistant_choice_label(line.trim()) else {
            continue;
        };
        if label.is_empty() {
            continue;
        }
        choices.push(AssistantChoicePlan {
            id: format!("choice-{}", choices.len().saturating_add(1)),
            label: label.to_owned(),
        });
    }
    choices
}

/// 선택지 목록 앞의 prompt block을 추출한다.
fn extract_assistant_prompt(text: &str, choices: &[AssistantChoicePlan]) -> String {
    if choices.is_empty() {
        return text.trim().to_owned();
    }

    let mut prompt_lines = Vec::<&str>::new();
    for line in text.lines() {
        if assistant_choice_label(line.trim()).is_some() {
            break;
        }
        prompt_lines.push(line);
    }
    prompt_lines.join("\n").trim().to_owned()
}

/// 선택지 marker를 제거한 label을 반환한다.
fn assistant_choice_label(trimmed: &str) -> Option<&str> {
    let mut chars = trimmed.char_indices();
    let (_first_index, first) = chars.next()?;
    if matches!(first, '-' | '*' | '•') {
        return trimmed
            .get(first.len_utf8()..)
            .and_then(strip_required_leading_whitespace);
    }

    if first.is_ascii_alphabetic() {
        let (marker_index, marker) = chars.next()?;
        if matches!(marker, '.' | ')') {
            return trimmed
                .get(marker_index.saturating_add(marker.len_utf8())..)
                .and_then(strip_required_leading_whitespace);
        }
        return None;
    }

    if first.is_ascii_digit() {
        for (index, character) in trimmed.char_indices().skip(1) {
            if character.is_ascii_digit() {
                continue;
            }
            if matches!(character, '.' | ')') {
                return trimmed
                    .get(index.saturating_add(character.len_utf8())..)
                    .and_then(strip_required_leading_whitespace);
            }
            return None;
        }
    }

    None
}

/// 선택지 marker 뒤에 필수 공백이 있으면 label을 반환한다.
fn strip_required_leading_whitespace(value: &str) -> Option<&str> {
    let first = value.chars().next()?;
    if !first.is_whitespace() {
        return None;
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// assistant prompt에 질문 신호가 있는지 확인한다.
fn has_assistant_question_signal(prompt: &str) -> bool {
    let trimmed = prompt.trim();
    trimmed.ends_with('?')
        || trimmed.ends_with('？')
        || contains_any(
            trimmed,
            &[
                "주세요",
                "할까요",
                "인가요",
                "일까요",
                "필요합니다",
                "필요해요",
                "확인해 주세요",
                "선택해 주세요",
            ],
        )
        || has_assistant_question_word_signal(trimmed)
}

/// assistant 질문 단어/표현이 있는지 확인한다.
fn has_assistant_question_word_signal(text: &str) -> bool {
    let lower = text.to_lowercase();
    let compact = lower.split_whitespace().collect::<String>();
    contains_any(
        &lower,
        &[
            "무엇",
            "어떤",
            "어느",
            "어떻게",
            "선택",
            "골라",
            "확인",
            "진행할까요",
            "필요",
            "범위",
            "방식",
            "항목",
            "옵션",
            "select",
            "choose",
            "which",
            "what",
            "confirm",
            "option",
            "apply",
        ],
    ) || compact.contains("알려주")
}

/// assistant 다중 선택 표현이 있는지 확인한다.
fn has_assistant_multiple_selection_signal(text: &str) -> bool {
    let lower = text.to_lowercase();
    contains_any(
        &lower,
        &[
            "여러",
            "복수",
            "해당되는",
            "모두",
            "전부",
            "다중",
            "2개 이상",
            "여러 개",
            "select all",
            "all that apply",
            "choose multiple",
            "multiple",
        ],
    )
}

/// 일반 답변 끝의 후속 제안 질문인지 확인한다.
fn is_assistant_follow_up_suggestion(text: &str) -> bool {
    if text.chars().count() <= 30 {
        return false;
    }
    let triggers = ["원하면", "원하시면", "필요하면", "괜찮다면", "추가로"];
    let endings = ["해드릴까요", "드릴까요", "할까요"];
    triggers.iter().any(|trigger| {
        let Some(start) = text.find(trigger) else {
            return false;
        };
        let tail = text.get(start..).unwrap_or_default().trim_end_matches('?');
        tail.chars().count() <= trigger.chars().count().saturating_add(35)
            && endings.iter().any(|ending| tail.ends_with(ending))
    })
}

/// answer content가 구조화된 긴 답변인지 확인한다.
fn is_structured_assistant_answer(
    text: &str,
    prompt: &str,
    choices: &[AssistantChoicePlan],
) -> bool {
    if choices.len() > 12 {
        return true;
    }
    if prompt.chars().count() > 800 {
        return true;
    }
    if text.lines().any(is_markdown_heading_line) {
        return true;
    }
    if contains_markdown_table(text) {
        return true;
    }
    text.contains("```")
}

/// Markdown heading line인지 확인한다.
fn is_markdown_heading_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    let heading_marks = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    (1..=6).contains(&heading_marks)
        && trimmed
            .chars()
            .nth(heading_marks)
            .is_some_and(char::is_whitespace)
}

/// Markdown table과 separator가 함께 있는지 확인한다.
fn contains_markdown_table(text: &str) -> bool {
    let has_row = text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with('|') && trimmed.ends_with('|')
    });
    let has_separator = text
        .lines()
        .any(|line| is_markdown_table_separator(line.trim()));
    has_row && has_separator
}

/// Markdown table separator line인지 확인한다.
fn is_markdown_table_separator(line: &str) -> bool {
    if !line.starts_with('|') || !line.ends_with('|') {
        return false;
    }
    line.split('|')
        .filter(|part| !part.trim().is_empty())
        .all(|part| {
            let trimmed = part.trim();
            let without_left = trimmed.strip_prefix(':').unwrap_or(trimmed);
            let without_right = without_left.strip_suffix(':').unwrap_or(without_left);
            !without_right.is_empty() && without_right.chars().all(|character| character == '-')
        })
}

/// reasoning에서 마지막 질문 block을 추출한다.
fn extract_last_assistant_question_block(reasoning: &str) -> String {
    let lines = reasoning
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let Some(start_index) = lines.iter().rposition(|line| {
        line.ends_with('?') || line.ends_with('？') || has_assistant_question_word_signal(line)
    }) else {
        return String::new();
    };
    let Some(first_line) = lines.get(start_index).copied() else {
        return String::new();
    };
    let first_question = assistant_question_sentence_suffix(first_line);
    let mut block = Vec::<String>::new();
    block.push(first_question);
    block.extend(
        lines
            .iter()
            .skip(start_index.saturating_add(1))
            .map(|line| (*line).to_owned()),
    );
    block.join("\n")
}

/// 한 줄 끝의 마지막 질문 문장을 추출한다.
fn assistant_question_sentence_suffix(line: &str) -> String {
    let trimmed = line.trim();
    if !(trimmed.ends_with('?') || trimmed.ends_with('？')) {
        return trimmed.to_owned();
    }
    let final_question_offset = trimmed
        .char_indices()
        .next_back()
        .map_or(trimmed.len(), |(index, _character)| index);
    let mut start = 0_usize;
    for (index, character) in trimmed
        .get(..final_question_offset)
        .unwrap_or(trimmed)
        .char_indices()
    {
        if matches!(character, '.' | '!' | '?' | '。' | '！' | '？') {
            start = index.saturating_add(character.len_utf8());
        }
    }
    trimmed.get(start..).unwrap_or(trimmed).trim().to_owned()
}

/// current-format chat message comment block을 모두 plan으로 파싱한다.
fn parse_chat_message_plans(
    body: &str,
    now_timestamp: f64,
    now_iso: &str,
    decode_failure_label: &str,
) -> Vec<JsonValue> {
    let mut messages = Vec::<JsonValue>::new();
    let mut offset = 0_usize;

    while let Some(marker) = find_next_chat_message_marker(body, offset) {
        let meta_start = marker.start.saturating_add(marker.open_marker.len());
        let Some(meta_end_relative) = body.get(meta_start..).and_then(|tail| tail.find("-->"))
        else {
            break;
        };
        let meta_end = meta_start.saturating_add(meta_end_relative);
        let block_start = meta_end.saturating_add("-->".len());
        let Some(close) = find_next_chat_message_close(body, block_start) else {
            break;
        };

        if let (Some(meta_raw), Some(block)) = (
            body.get(meta_start..meta_end),
            body.get(block_start..close.start),
        ) && let Some(message) = parse_chat_message_plan(
            meta_raw,
            block,
            now_timestamp,
            now_iso,
            decode_failure_label,
        ) {
            messages.push(message);
        }
        offset = close.end;
    }

    messages
}

/// chat list metadata plan.
struct ChatMetaPlan {
    /// 표시 title.
    title: String,
    /// 생성 시각 ISO 문자열.
    created: String,
    /// 수정 시각 ISO 문자열.
    updated: Option<String>,
    /// 메시지 수.
    message_count: usize,
    /// 첫 user message preview.
    preview: Option<String>,
    /// provider label/key.
    provider: Option<String>,
    /// model name.
    model: Option<String>,
}

/// 저장할 chat session metadata plan.
struct ChatSaveMetadataPlan {
    /// 저장 title.
    title: String,
    /// 생성 시각 ISO 문자열.
    created: String,
    /// citation 총합.
    source_count: usize,
    /// 마지막 provider label/key.
    provider: Option<String>,
    /// 마지막 model name.
    model: Option<String>,
    /// 저장 summary.
    summary: Option<String>,
}

/// RAG context source plan.
struct ContextSourcePlan {
    /// citation plan 목록.
    citations: Vec<JsonValue>,
    /// verified source block plan 목록.
    blocks: Vec<JsonValue>,
    /// verified citation id 목록.
    source_ids: Vec<String>,
    /// rejected source 수.
    rejected_count: usize,
}

/// Context budget append plan.
struct ContextBudgetAppendPlan {
    /// 실제 append할 text.
    text: String,
    /// append 이후 남은 UTF-16 char budget.
    remaining_chars: usize,
    /// 원문 전체가 append됐는지 여부.
    complete: bool,
    /// block을 추가해야 하는지 여부.
    appended: bool,
}

/// Chat context mention type별 index와 auto-RAG policy plan.
struct ChatContextMentionPlan {
    /// file mention index 목록.
    file_indices: Vec<usize>,
    /// folder mention index 목록.
    folder_indices: Vec<usize>,
    /// entity mention index 목록.
    entity_indices: Vec<usize>,
    /// server mention index 목록.
    server_indices: Vec<usize>,
    /// 자동 RAG 실행 여부.
    use_auto_rag: bool,
    /// 자동 RAG 실행/비실행 machine-readable reason.
    auto_rag_reason: &'static str,
}

/// `GraphRAG` virtual source verification plan.
struct ContextGraphVerificationPlan {
    /// Graph virtual source 여부.
    is_graph_source: bool,
    /// verification JSON object.
    verification: Option<JsonValue>,
}

/// Prompt 라이브러리 요약 count 행.
struct PromptLibrarySummaryCount {
    /// 라벨 이름.
    label: String,
    /// 개수.
    count: usize,
}

/// Prompt 라이브러리 representative 샘플.
struct PromptLibrarySummarySample {
    /// 파일 경로.
    file_path: String,
    /// heading 문자열.
    heading: String,
    /// 정규화된 preview 텍스트.
    preview: String,
}

/// Prompt 라이브러리 요약 plan.
struct PromptLibrarySummaryPlan {
    /// 전체 chunk 수.
    total_chunks: usize,
    /// 상위 folder count.
    top_folders: Vec<PromptLibrarySummaryCount>,
    /// 상위 file count.
    top_files: Vec<PromptLibrarySummaryCount>,
    /// 상위 heading count.
    top_headings: Vec<PromptLibrarySummaryCount>,
    /// 샘플 후보 행.
    samples: Vec<PromptLibrarySummarySample>,
}

/// Prompt 라이브러리 입력 행.
#[derive(Clone)]
struct PromptLibrarySummaryInput {
    /// 파일 경로.
    file_path: String,
    /// heading 문자열.
    heading: String,
    /// 텍스트 본문.
    text: String,
}

/// RAG query result와 verification snapshot에서 citation/block/source id를 계산한다.
fn plan_context_sources(
    results_json: &str,
    verifications_json: &str,
    first_index: usize,
    prefix: &str,
) -> ContextSourcePlan {
    let results = serde_json::from_str::<JsonValue>(results_json)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let verifications = serde_json::from_str::<JsonValue>(verifications_json)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();

    let mut citations = Vec::<JsonValue>::new();
    let mut blocks = Vec::<JsonValue>::new();
    let mut source_ids = Vec::<String>::new();
    let mut rejected_count = 0usize;
    let safe_prefix = if prefix.trim().is_empty() {
        "source"
    } else {
        prefix.trim()
    };

    for (index, result) in results.iter().enumerate() {
        let verification = verifications.get(index);
        let status = verification
            .and_then(|value| value.get("status"))
            .and_then(JsonValue::as_str)
            .filter(|value| is_context_source_status(value))
            .unwrap_or("missing");
        let id = format!("{}-{}", safe_prefix, first_index.saturating_add(index));
        let file_path = result
            .get("filePath")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        let text = result
            .get("text")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        let citation =
            context_source_citation_json(&id, result, verification, status, file_path, text);
        citations.push(citation);

        if status == "verified" {
            source_ids.push(id.clone());
            blocks.push(context_source_block_json(&id, result, file_path, text));
        } else {
            rejected_count = rejected_count.saturating_add(1);
        }
    }

    ContextSourcePlan {
        citations,
        blocks,
        source_ids,
        rejected_count,
    }
}

/// context block append 결과를 UTF-16 budget 기준으로 계산한다.
fn plan_context_budget_append(remaining_chars: usize, text: &str) -> ContextBudgetAppendPlan {
    if remaining_chars == 0 {
        return ContextBudgetAppendPlan {
            text: String::new(),
            remaining_chars: 0,
            complete: false,
            appended: false,
        };
    }

    let text_units = text.encode_utf16().count();
    if text_units <= remaining_chars {
        return ContextBudgetAppendPlan {
            text: text.to_owned(),
            remaining_chars: remaining_chars.saturating_sub(text_units),
            complete: true,
            appended: true,
        };
    }

    let (truncated, consumed_units) = truncate_utf16_scalar_boundary(text, remaining_chars);
    ContextBudgetAppendPlan {
        text: truncated.to_owned(),
        remaining_chars: 0,
        complete: false,
        appended: consumed_units > 0,
    }
}

/// UTF-16 unit budget 안에서 Unicode scalar boundary를 보존해 자른다.
fn truncate_utf16_scalar_boundary(text: &str, max_units: usize) -> (&str, usize) {
    let mut end_index = 0usize;
    let mut consumed_units = 0usize;
    for (index, character) in text.char_indices() {
        let next_units = character.len_utf16();
        if consumed_units.saturating_add(next_units) > max_units {
            break;
        }
        consumed_units += next_units;
        end_index = index + character.len_utf8();
    }
    (&text[..end_index], consumed_units)
}

/// chat context mention type별 index와 auto-RAG policy를 계산한다.
fn plan_chat_context_mentions(mention_types: &[String]) -> Option<ChatContextMentionPlan> {
    let mut file_indices = Vec::<usize>::new();
    let mut folder_indices = Vec::<usize>::new();
    let mut entity_indices = Vec::<usize>::new();
    let mut server_indices = Vec::<usize>::new();
    let mut has_server_mention = false;
    let mut has_vault_mention = false;

    for (index, mention_type) in mention_types.iter().enumerate() {
        match mention_type.as_str() {
            "file" => {
                file_indices.push(index);
                has_vault_mention = true;
            }
            "folder" => {
                folder_indices.push(index);
                has_vault_mention = true;
            }
            "entity" => entity_indices.push(index),
            "server" => {
                server_indices.push(index);
                has_server_mention = true;
            }
            _ => return None,
        }
    }

    let use_auto_rag = !has_server_mention || has_vault_mention;
    let auto_rag_reason = if mention_types.is_empty() {
        "no-mentions"
    } else if has_server_mention && !has_vault_mention {
        "server-only"
    } else if has_server_mention && has_vault_mention {
        "server-and-vault"
    } else if has_vault_mention {
        "vault-mention"
    } else if use_auto_rag {
        "implicit"
    } else {
        "disabled"
    };
    Some(ChatContextMentionPlan {
        file_indices,
        folder_indices,
        entity_indices,
        server_indices,
        use_auto_rag,
        auto_rag_reason,
    })
}

/// MCP server 후보 순서를 preferred/fallback 정책으로 계산한다.
fn plan_mcp_server_candidates(
    preferred_server_names: &[String],
    enabled_server_names: &[String],
    connection_statuses: &BTreeMap<String, String>,
) -> Vec<String> {
    let mut candidates = Vec::<String>::new();
    let mut seen = BTreeSet::<String>::new();
    for server_name in preferred_server_names {
        push_connected_mcp_candidate(server_name, connection_statuses, &mut seen, &mut candidates);
    }
    for server_name in enabled_server_names {
        push_connected_mcp_candidate(server_name, connection_statuses, &mut seen, &mut candidates);
    }
    candidates
}

/// connected server를 중복 없이 후보 목록에 추가한다.
fn push_connected_mcp_candidate(
    server_name: &str,
    connection_statuses: &BTreeMap<String, String>,
    seen: &mut BTreeSet<String>,
    candidates: &mut Vec<String>,
) {
    if connection_statuses
        .get(server_name)
        .is_some_and(|status| status == "connected")
        && seen.insert(server_name.to_owned())
    {
        candidates.push(server_name.to_owned());
    }
}

/// `GraphRAG` virtual source인지 판정하고 verification을 계산한다.
fn plan_context_graph_verification(
    file_path: &str,
    unsupported_detail: &str,
) -> ContextGraphVerificationPlan {
    const GRAPH_PREFIX: &str = "graph://";
    const GRAPH_COMMUNITY_PREFIX: &str = "graph://community/";
    if file_path.starts_with(GRAPH_COMMUNITY_PREFIX) {
        let mut verification = JsonMap::<String, JsonValue>::new();
        verification.insert(
            "status".to_owned(),
            JsonValue::String("verified".to_owned()),
        );
        verification.insert(
            "graphType".to_owned(),
            JsonValue::String("community".to_owned()),
        );
        return ContextGraphVerificationPlan {
            is_graph_source: true,
            verification: Some(JsonValue::Object(verification)),
        };
    }
    if file_path.starts_with(GRAPH_PREFIX) {
        let mut verification = JsonMap::<String, JsonValue>::new();
        verification.insert("status".to_owned(), JsonValue::String("missing".to_owned()));
        verification.insert(
            "detail".to_owned(),
            JsonValue::String(unsupported_detail.to_owned()),
        );
        return ContextGraphVerificationPlan {
            is_graph_source: true,
            verification: Some(JsonValue::Object(verification)),
        };
    }
    ContextGraphVerificationPlan {
        is_graph_source: false,
        verification: None,
    }
}

/// citation JSON object를 만든다.
fn context_source_citation_json(
    id: &str,
    result: &JsonValue,
    verification: Option<&JsonValue>,
    status: &str,
    file_path: &str,
    text: &str,
) -> JsonValue {
    let mut citation = JsonMap::<String, JsonValue>::new();
    citation.insert("id".to_owned(), JsonValue::String(id.to_owned()));
    citation.insert(
        "filePath".to_owned(),
        JsonValue::String(file_path.to_owned()),
    );
    copy_optional_json_string(result, &mut citation, "heading");
    copy_optional_json_number_as(result, &mut citation, "startLine", "line");
    copy_optional_json_number_as(result, &mut citation, "endLine", "endLine");
    copy_optional_json_number_as(result, &mut citation, "score", "score");
    copy_optional_json_number_as(result, &mut citation, "vectorScore", "vectorScore");
    copy_optional_json_number_as(result, &mut citation, "bm25Score", "bm25Score");
    copy_optional_json_string(result, &mut citation, "selectionReason");
    citation.insert("status".to_owned(), JsonValue::String(status.to_owned()));
    if let Some(verification) = verification {
        copy_optional_json_string(verification, &mut citation, "detail");
        copy_optional_json_string(verification, &mut citation, "graphType");
    }
    let preview = plan_context_preview(text);
    citation.insert("preview".to_owned(), JsonValue::String(preview.preview));
    citation.insert(
        "previewTruncated".to_owned(),
        JsonValue::Bool(preview.truncated),
    );
    JsonValue::Object(citation)
}

/// verified source block JSON object를 만든다.
fn context_source_block_json(
    id: &str,
    result: &JsonValue,
    file_path: &str,
    text: &str,
) -> JsonValue {
    let heading = result
        .get("heading")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" # {value}"))
        .unwrap_or_default();
    let mut block = JsonMap::<String, JsonValue>::new();
    block.insert("sourceId".to_owned(), JsonValue::String(id.to_owned()));
    block.insert(
        "text".to_owned(),
        JsonValue::String(format!("[Source {id}: {file_path}{heading}]\n{text}")),
    );
    JsonValue::Object(block)
}

/// source status union에 포함되는지 확인한다.
fn is_context_source_status(value: &str) -> bool {
    matches!(
        value,
        "candidate" | "verified" | "missing" | "stale" | "low-relevance"
    )
}

/// JSON string field를 object에 복사한다.
fn copy_optional_json_string(
    source: &JsonValue,
    target: &mut JsonMap<String, JsonValue>,
    key: &str,
) {
    if let Some(value) = source
        .get(key)
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
    {
        target.insert(key.to_owned(), JsonValue::String(value.to_owned()));
    }
}

/// JSON number field를 다른 key로 복사한다.
fn copy_optional_json_number_as(
    source: &JsonValue,
    target: &mut JsonMap<String, JsonValue>,
    source_key: &str,
    target_key: &str,
) {
    if let Some(value) = source.get(source_key).and_then(JsonValue::as_number) {
        target.insert(target_key.to_owned(), JsonValue::Number(value.clone()));
    }
}

/// Context preview plan.
struct ContextPreviewPlan {
    /// collapsed preview text.
    preview: String,
    /// whether the original collapsed preview exceeded the display budget.
    truncated: bool,
}

/// context preview를 whitespace collapse와 220자 제한으로 만든다.
fn build_context_preview(text: &str) -> String {
    plan_context_preview(text).preview
}

/// context preview와 truncation 여부를 계산한다.
fn plan_context_preview(text: &str) -> ContextPreviewPlan {
    const CONTEXT_PREVIEW_MAX_CHARS: usize = 220;
    let mut output = String::new();
    let mut previous_space = false;
    for character in text.chars() {
        if character.is_whitespace() {
            if !previous_space {
                output.push(' ');
                previous_space = true;
            }
            continue;
        }
        previous_space = false;
        output.push(character);
    }
    let trimmed = output.trim();
    ContextPreviewPlan {
        preview: truncate_context_preview(trimmed, CONTEXT_PREVIEW_MAX_CHARS),
        truncated: trimmed.chars().count() > CONTEXT_PREVIEW_MAX_CHARS,
    }
}

/// context preview를 max char 기준으로 자른다.
fn truncate_context_preview(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if index >= max_chars {
            return output;
        }
        output.push(character);
    }
    output
}

/// 저장할 chat session metadata를 message snapshot에서 계산한다.
fn plan_chat_save_metadata(
    messages_json: &str,
    existing_created: &str,
    option_title: &str,
    now_iso: &str,
) -> ChatSaveMetadataPlan {
    let messages = serde_json::from_str::<JsonValue>(messages_json)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let title = if option_title.trim().is_empty() {
        derive_chat_title_from_messages(&messages)
    } else {
        option_title.to_owned()
    };
    let created = normalize_chat_created_for_save(existing_created, &messages, now_iso);
    let source_count = messages
        .iter()
        .map(|message| {
            message
                .get("citations")
                .and_then(JsonValue::as_array)
                .map_or(0, Vec::len)
        })
        .sum();
    let (provider, model) = find_last_chat_provider_model(&messages);
    let summary = derive_chat_summary_from_messages(&messages);

    ChatSaveMetadataPlan {
        title,
        created,
        source_count,
        provider,
        model,
        summary,
    }
}

/// 첫 user message에서 chat title을 만든다.
fn derive_chat_title_from_messages(messages: &[JsonValue]) -> String {
    for message in messages {
        if message.get("role").and_then(JsonValue::as_str) != Some("user") {
            continue;
        }
        let Some(content) = message.get("content").and_then(JsonValue::as_str) else {
            continue;
        };
        let title = content.replace('\n', " ").trim().to_owned();
        if title.is_empty() {
            continue;
        }
        return truncate_chat_title(&title);
    }
    String::new()
}

/// 저장 metadata의 created 값을 계산한다.
fn normalize_chat_created_for_save(
    existing_created: &str,
    messages: &[JsonValue],
    now_iso: &str,
) -> String {
    let existing = existing_created.trim();
    if !existing.is_empty() {
        return normalize_chat_date_value(existing).unwrap_or_else(|| existing.to_owned());
    }
    if let Some(first) = messages.first() {
        if let Some(created_at) = first
            .get("createdAt")
            .and_then(JsonValue::as_str)
            .and_then(normalize_chat_date_value)
        {
            return created_at;
        }
        if let Some(timestamp) = first.get("timestamp").and_then(json_number_to_string)
            && let Some(created_at) = normalize_chat_date_value(&timestamp)
        {
            return created_at;
        }
    }
    now_iso.to_owned()
}

/// JSON number를 정수/실수 문자열로 만든다.
fn json_number_to_string(value: &JsonValue) -> Option<String> {
    let number = value.as_number()?;
    if let Some(unsigned) = number.as_u64() {
        return Some(unsigned.to_string());
    }
    if let Some(signed) = number.as_i64() {
        return Some(signed.to_string());
    }
    number.as_f64().map(|float| float.to_string())
}

/// 마지막 provider/model metadata를 찾는다.
fn find_last_chat_provider_model(messages: &[JsonValue]) -> (Option<String>, Option<String>) {
    for message in messages.iter().rev() {
        let provider = message
            .get("providerLabel")
            .and_then(JsonValue::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                message
                    .get("providerKey")
                    .and_then(JsonValue::as_str)
                    .filter(|value| !value.trim().is_empty())
            })
            .map(str::to_owned);
        let model = message
            .get("model")
            .and_then(JsonValue::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned);
        if provider.is_some() || model.is_some() {
            return (provider, model);
        }
    }
    (None, None)
}

/// 마지막 complete assistant 또는 첫 user message에서 summary를 만든다.
fn derive_chat_summary_from_messages(messages: &[JsonValue]) -> Option<String> {
    for message in messages.iter().rev() {
        if message.get("role").and_then(JsonValue::as_str) == Some("assistant")
            && message.get("status").and_then(JsonValue::as_str) == Some("complete")
            && let Some(summary) = message
                .get("content")
                .and_then(JsonValue::as_str)
                .and_then(clean_chat_summary)
        {
            return Some(summary);
        }
    }
    for message in messages {
        if message.get("role").and_then(JsonValue::as_str) == Some("user")
            && let Some(summary) = message
                .get("content")
                .and_then(JsonValue::as_str)
                .and_then(clean_chat_summary)
        {
            return Some(summary);
        }
    }
    None
}

/// chat session metadata를 frontmatter와 body에서 계산한다.
fn plan_chat_meta(content: &str, fallback_title: &str, fallback_created_iso: &str) -> ChatMetaPlan {
    let parsed = parse_chat_frontmatter(content);
    let title = parsed
        .values
        .get("title")
        .and_then(|value| parse_chat_frontmatter_scalar(value))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback_title.to_owned());
    let created = parsed
        .values
        .get("created")
        .and_then(|value| parse_chat_frontmatter_scalar(value))
        .and_then(|value| normalize_chat_date_value(&value))
        .unwrap_or_else(|| fallback_created_iso.to_owned());
    let updated = parsed
        .values
        .get("updated")
        .and_then(|value| parse_chat_frontmatter_scalar(value))
        .and_then(|value| normalize_chat_date_value(&value));
    let provider = parsed
        .values
        .get("provider")
        .and_then(|value| parse_chat_frontmatter_scalar(value))
        .filter(|value| !value.trim().is_empty());
    let model = parsed
        .values
        .get("model")
        .and_then(|value| parse_chat_frontmatter_scalar(value))
        .filter(|value| !value.trim().is_empty());
    let messages =
        parse_chat_message_plans(&parsed.body, 0.0, fallback_created_iso, "[decoding failed]");
    let message_count = parsed
        .values
        .get("messages")
        .and_then(|value| parse_chat_frontmatter_scalar(value))
        .and_then(|value| parse_leading_usize(&value))
        .unwrap_or(messages.len());
    let preview = extract_chat_preview(&parsed.body, &messages);

    ChatMetaPlan {
        title,
        created,
        updated,
        message_count,
        preview,
        provider,
        model,
    }
}

/// parsed chat frontmatter.
struct ParsedChatFrontmatter {
    /// body without frontmatter.
    body: String,
    /// raw frontmatter key/value map.
    values: BTreeMap<String, String>,
}

/// YAML-like frontmatter에서 단순 key/value를 파싱한다.
fn parse_chat_frontmatter(content: &str) -> ParsedChatFrontmatter {
    let Some(rest) = content.strip_prefix("---\n") else {
        return ParsedChatFrontmatter {
            body: content.to_owned(),
            values: BTreeMap::new(),
        };
    };
    let Some(end_relative) = rest.find("\n---") else {
        return ParsedChatFrontmatter {
            body: content.to_owned(),
            values: BTreeMap::new(),
        };
    };
    let frontmatter = &rest[..end_relative];
    let body_start = "---\n"
        .len()
        .saturating_add(end_relative)
        .saturating_add("\n---".len());
    let body = content
        .get(body_start..)
        .unwrap_or_default()
        .strip_prefix("\n\n")
        .or_else(|| {
            content
                .get(body_start..)
                .unwrap_or_default()
                .strip_prefix('\n')
        })
        .unwrap_or_else(|| content.get(body_start..).unwrap_or_default())
        .to_owned();
    let mut values = BTreeMap::<String, String>::new();
    for line in frontmatter.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        values.insert(key.to_owned(), value.trim().to_owned());
    }
    ParsedChatFrontmatter { body, values }
}

/// frontmatter scalar 값을 기존 JS load 계약과 같이 문자열로 만든다.
fn parse_chat_frontmatter_scalar(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    match serde_json::from_str::<JsonValue>(trimmed) {
        Ok(JsonValue::String(value)) => Some(value),
        Ok(JsonValue::Number(value)) => Some(value.to_string()),
        Ok(JsonValue::Bool(value)) => Some(value.to_string()),
        Ok(value) => Some(value.to_string()),
        Err(_) => Some(trimmed.to_owned()),
    }
}

/// chat date 값을 ISO 문자열로 정규화한다.
fn normalize_chat_date_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(milliseconds) = parse_integer_millis_string(trimmed) {
        return timestamp_millis_to_iso(milliseconds);
    }
    Some(trimmed.to_owned())
}

/// 정수 millisecond 문자열을 파싱한다.
fn parse_integer_millis_string(value: &str) -> Option<i64> {
    if value.is_empty() {
        return None;
    }
    let mut chars = value.chars();
    let mut normalized = String::new();
    if let Some(first) = chars.next() {
        if first == '-' || first == '+' || first.is_ascii_digit() {
            normalized.push(first);
        } else {
            return None;
        }
    }
    for character in chars {
        if !character.is_ascii_digit() {
            return None;
        }
        normalized.push(character);
    }
    normalized.parse::<i64>().ok()
}

/// leading integer를 usize로 파싱한다.
fn parse_leading_usize(value: &str) -> Option<usize> {
    let mut digits = String::new();
    for character in value.trim_start().chars() {
        if character.is_ascii_digit() {
            digits.push(character);
            continue;
        }
        break;
    }
    if digits.is_empty() {
        return None;
    }
    digits.parse::<usize>().ok()
}

/// millisecond timestamp를 UTC ISO 문자열로 변환한다.
fn timestamp_millis_to_iso(milliseconds: i64) -> Option<String> {
    let seconds = milliseconds.div_euclid(1_000);
    let millis = milliseconds.rem_euclid(1_000);
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days)?;
    let hour = seconds_of_day.div_euclid(3_600);
    let minute = seconds_of_day.rem_euclid(3_600).div_euclid(60);
    let second = seconds_of_day.rem_euclid(60);
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z"
    ))
}

/// Unix epoch day offset을 civil date로 변환한다.
fn civil_from_days(days: i64) -> Option<(i64, u32, u32)> {
    let z = days.checked_add(719_468)?;
    let era = if z >= 0 { z } else { z.checked_sub(146_096)? }.div_euclid(146_097);
    let doe = z.checked_sub(era.checked_mul(146_097)?)?;
    let yoe = (doe - doe.div_euclid(1_460) + doe.div_euclid(36_524) - doe.div_euclid(146_096))
        .div_euclid(365);
    let year_base = yoe.checked_add(era.checked_mul(400)?)?;
    let doy = doe.checked_sub(365 * yoe + yoe.div_euclid(4) - yoe.div_euclid(100))?;
    let mp = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * mp + 2).div_euclid(5) + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year_base + i64::from(month <= 2);
    Some((year, u32::try_from(month).ok()?, u32::try_from(day).ok()?))
}

/// chat body와 message plan에서 user preview를 추출한다.
fn extract_chat_preview(body: &str, messages: &[JsonValue]) -> Option<String> {
    for message in messages {
        let Some(object) = message.as_object() else {
            continue;
        };
        if object.get("role").and_then(JsonValue::as_str) != Some("user") {
            continue;
        }
        let Some(content) = object.get("content").and_then(JsonValue::as_str) else {
            continue;
        };
        if let Some(preview) = clean_chat_preview(content) {
            return Some(preview);
        }
    }
    extract_legacy_chat_preview(body)
}

/// legacy heading 기반 user section에서 preview를 추출한다.
fn extract_legacy_chat_preview(body: &str) -> Option<String> {
    let mut in_user_section = false;
    let mut lines = Vec::<String>::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if is_numbered_user_heading(trimmed) {
            in_user_section = true;
            continue;
        }
        if in_user_section {
            if is_numbered_chat_heading(trimmed) || trimmed == "---" {
                break;
            }
            if !trimmed.is_empty() {
                lines.push(trimmed.to_owned());
            }
        }
    }
    if lines.is_empty() {
        None
    } else {
        clean_chat_preview(&lines.join(" "))
    }
}

/// numbered user heading인지 확인한다.
fn is_numbered_user_heading(line: &str) -> bool {
    line.starts_with("### ") && line.contains(". User")
}

/// numbered chat heading인지 확인한다.
fn is_numbered_chat_heading(line: &str) -> bool {
    line.starts_with("### ")
        && line.get(4..).is_some_and(|tail| {
            let mut seen_digit = false;
            for character in tail.chars() {
                if character.is_ascii_digit() {
                    seen_digit = true;
                    continue;
                }
                return seen_digit && character == '.';
            }
            false
        })
}

/// preview 텍스트를 HTML tag 제거, whitespace collapse, 120자 제한으로 정리한다.
fn clean_chat_preview(content: &str) -> Option<String> {
    let mut text = String::new();
    let mut in_tag = false;
    let mut previous_space = false;
    for character in content.chars() {
        if character == '<' {
            in_tag = true;
            continue;
        }
        if in_tag {
            if character == '>' {
                in_tag = false;
            }
            continue;
        }
        if character.is_whitespace() {
            if !previous_space {
                text.push(' ');
                previous_space = true;
            }
            continue;
        }
        previous_space = false;
        text.push(character);
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_preview(trimmed, 120))
}

/// 저장 summary 텍스트를 whitespace collapse와 160자 제한으로 정리한다.
fn clean_chat_summary(content: &str) -> Option<String> {
    let mut text = String::new();
    let mut previous_space = false;
    for character in content.chars() {
        if character.is_whitespace() {
            if !previous_space {
                text.push(' ');
                previous_space = true;
            }
            continue;
        }
        previous_space = false;
        text.push(character);
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_chat_summary(trimmed))
}

/// title을 50자 기준으로 자른다.
fn truncate_chat_title(value: &str) -> String {
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if index >= 50 {
            output.push_str("...");
            return output;
        }
        output.push(character);
    }
    output
}

/// summary를 기존 저장 계약처럼 160자 초과 시 157자와 ellipsis로 자른다.
fn truncate_chat_summary(value: &str) -> String {
    if value.chars().count() <= 160 {
        return value.to_owned();
    }
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if index >= 157 {
            output.push_str("...");
            return output;
        }
        output.push(character);
    }
    output
}

/// preview를 max char 기준으로 자르고 ellipsis를 붙인다.
fn truncate_preview(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (index, character) in value.chars().enumerate() {
        if index >= max_chars {
            output.push_str("...");
            return output;
        }
        output.push(character);
    }
    output
}

/// chat meta plan을 JSON 문자열로 직렬화한다.
fn serialize_chat_meta_plan_json(plan: &ChatMetaPlan) -> String {
    let mut object = JsonMap::<String, JsonValue>::new();
    object.insert("title".to_owned(), JsonValue::String(plan.title.clone()));
    object.insert(
        "created".to_owned(),
        JsonValue::String(plan.created.clone()),
    );
    if let Some(updated) = &plan.updated {
        object.insert("updated".to_owned(), JsonValue::String(updated.clone()));
    }
    object.insert(
        "messageCount".to_owned(),
        JsonValue::Number(JsonNumber::from(plan.message_count)),
    );
    if let Some(preview) = &plan.preview {
        object.insert("preview".to_owned(), JsonValue::String(preview.clone()));
    }
    if let Some(provider) = &plan.provider {
        object.insert("provider".to_owned(), JsonValue::String(provider.clone()));
    }
    if let Some(model) = &plan.model {
        object.insert("model".to_owned(), JsonValue::String(model.clone()));
    }
    JsonValue::Object(object).to_string()
}

/// chat save metadata plan을 JSON 문자열로 직렬화한다.
fn serialize_chat_save_metadata_plan_json(plan: &ChatSaveMetadataPlan) -> String {
    let mut object = JsonMap::<String, JsonValue>::new();
    object.insert("title".to_owned(), JsonValue::String(plan.title.clone()));
    object.insert(
        "created".to_owned(),
        JsonValue::String(plan.created.clone()),
    );
    object.insert(
        "sourceCount".to_owned(),
        JsonValue::Number(JsonNumber::from(plan.source_count)),
    );
    if let Some(provider) = &plan.provider {
        object.insert("provider".to_owned(), JsonValue::String(provider.clone()));
    }
    if let Some(model) = &plan.model {
        object.insert("model".to_owned(), JsonValue::String(model.clone()));
    }
    if let Some(summary) = &plan.summary {
        object.insert("summary".to_owned(), JsonValue::String(summary.clone()));
    }
    JsonValue::Object(object).to_string()
}

/// context source plan을 JSON 문자열로 직렬화한다.
fn serialize_context_source_plan_json(plan: &ContextSourcePlan) -> String {
    let mut object = JsonMap::<String, JsonValue>::new();
    object.insert(
        "citations".to_owned(),
        JsonValue::Array(plan.citations.clone()),
    );
    object.insert("blocks".to_owned(), JsonValue::Array(plan.blocks.clone()));
    object.insert(
        "sourceIds".to_owned(),
        JsonValue::Array(
            plan.source_ids
                .iter()
                .map(|id| JsonValue::String(id.clone()))
                .collect(),
        ),
    );
    object.insert(
        "rejectedCount".to_owned(),
        JsonValue::Number(JsonNumber::from(plan.rejected_count)),
    );
    JsonValue::Object(object).to_string()
}

/// context budget append plan을 JSON 문자열로 직렬화한다.
fn serialize_context_budget_append_plan_json(plan: &ContextBudgetAppendPlan) -> String {
    format!(
        "{{\"text\":\"{}\",\"remainingChars\":{},\"complete\":{},\"appended\":{}}}",
        escape_json_string(&plan.text),
        plan.remaining_chars,
        plan.complete,
        plan.appended,
    )
}

/// chat context mention plan을 JSON 문자열로 직렬화한다.
fn serialize_chat_context_mention_plan_json(plan: &ChatContextMentionPlan) -> String {
    format!(
        "{{\"fileIndices\":{},\"folderIndices\":{},\"entityIndices\":{},\"serverIndices\":{},\"useAutoRag\":{},\"autoRagReason\":\"{}\"}}",
        serialize_usize_array_json(&plan.file_indices),
        serialize_usize_array_json(&plan.folder_indices),
        serialize_usize_array_json(&plan.entity_indices),
        serialize_usize_array_json(&plan.server_indices),
        plan.use_auto_rag,
        plan.auto_rag_reason,
    )
}

/// context graph verification plan을 JSON 문자열로 직렬화한다.
fn serialize_context_graph_verification_plan_json(plan: &ContextGraphVerificationPlan) -> String {
    let mut object = JsonMap::<String, JsonValue>::new();
    object.insert(
        "isGraphSource".to_owned(),
        JsonValue::Bool(plan.is_graph_source),
    );
    object.insert(
        "verification".to_owned(),
        plan.verification.clone().unwrap_or(JsonValue::Null),
    );
    JsonValue::Object(object).to_string()
}

/// chat message open marker 위치.
struct ChatMessageOpenMarker {
    /// marker 시작 byte offset.
    start: usize,
    /// marker 문자열.
    open_marker: &'static str,
}

/// chat message close marker 위치.
struct ChatMessageCloseMarker {
    /// close marker 시작 byte offset.
    start: usize,
    /// close marker 끝 byte offset.
    end: usize,
}

/// 다음 chat message open marker를 찾는다.
fn find_next_chat_message_marker(body: &str, offset: usize) -> Option<ChatMessageOpenMarker> {
    const OPEN_MARKERS: [&str; 2] = [
        "<!-- superpower-inside-message",
        "<!-- super-obsidian-message",
    ];
    OPEN_MARKERS
        .iter()
        .filter_map(|marker| {
            body.get(offset..)
                .and_then(|tail| tail.find(marker))
                .map(|relative| ChatMessageOpenMarker {
                    start: offset.saturating_add(relative),
                    open_marker: marker,
                })
        })
        .min_by_key(|marker| marker.start)
}

/// 다음 chat message close marker를 찾는다.
fn find_next_chat_message_close(body: &str, offset: usize) -> Option<ChatMessageCloseMarker> {
    const CLOSE_MARKERS: [&str; 2] = [
        "<!-- /superpower-inside-message -->",
        "<!-- /super-obsidian-message -->",
    ];
    CLOSE_MARKERS
        .iter()
        .filter_map(|marker| {
            body.get(offset..)
                .and_then(|tail| tail.find(marker))
                .map(|relative| {
                    let start = offset.saturating_add(relative);
                    ChatMessageCloseMarker {
                        start,
                        end: start.saturating_add(marker.len()),
                    }
                })
        })
        .min_by_key(|marker| marker.start)
}

/// 단일 chat message meta/block을 message JSON object로 변환한다.
fn parse_chat_message_plan(
    meta_raw: &str,
    block: &str,
    now_timestamp: f64,
    now_iso: &str,
    decode_failure_label: &str,
) -> Option<JsonValue> {
    let meta = serde_json::from_str::<JsonValue>(meta_raw.trim()).ok()?;
    let object = meta.as_object()?;
    let id = object.get("id")?.as_str()?.trim();
    let role = object.get("role")?.as_str()?.trim();
    if id.is_empty() || !is_chat_role(role) {
        return None;
    }

    let content =
        extract_chat_named_block(block, "content", decode_failure_label).unwrap_or_default();
    let reasoning = extract_chat_named_block(block, "reasoning", decode_failure_label);
    let error_block = extract_chat_named_block(block, "error", decode_failure_label);
    let final_content = if content.trim().is_empty() {
        reasoning.clone().unwrap_or_default()
    } else {
        content
    };

    let mut message = JsonMap::<String, JsonValue>::new();
    message.insert("id".to_owned(), JsonValue::String(id.to_owned()));
    copy_optional_chat_u64(object, &mut message, "schemaVersion");
    message.insert("role".to_owned(), JsonValue::String(role.to_owned()));
    message.insert("content".to_owned(), JsonValue::String(final_content));
    message.insert(
        "timestamp".to_owned(),
        finite_json_number_value(
            object
                .get("timestamp")
                .and_then(JsonValue::as_f64)
                .filter(|value| value.is_finite())
                .unwrap_or(now_timestamp),
        )?,
    );
    let created_at = object
        .get("createdAt")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(now_iso);
    let updated_at = object
        .get("updatedAt")
        .and_then(JsonValue::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(created_at);
    message.insert(
        "createdAt".to_owned(),
        JsonValue::String(created_at.to_owned()),
    );
    message.insert(
        "updatedAt".to_owned(),
        JsonValue::String(updated_at.to_owned()),
    );
    message.insert(
        "status".to_owned(),
        JsonValue::String(
            object
                .get("status")
                .and_then(JsonValue::as_str)
                .filter(|value| is_chat_status(value))
                .unwrap_or("complete")
                .to_owned(),
        ),
    );

    copy_optional_chat_string(object, &mut message, "providerKey");
    copy_optional_chat_string(object, &mut message, "providerLabel");
    copy_optional_chat_string(object, &mut message, "model");
    copy_optional_chat_string(object, &mut message, "branchOf");
    copy_optional_chat_string(object, &mut message, "branchRoot");
    copy_optional_chat_string(object, &mut message, "variantOf");
    copy_optional_chat_string(object, &mut message, "stopReason");
    copy_optional_chat_value(object, &mut message, "toolCalls");
    copy_optional_chat_value(object, &mut message, "citations");
    copy_optional_chat_value(object, &mut message, "sourceWarnings");
    copy_optional_chat_value(object, &mut message, "contextAttachments");
    copy_optional_chat_value(object, &mut message, "assistantQuestion");
    copy_optional_chat_value(object, &mut message, "providerCapability");
    copy_optional_chat_string(object, &mut message, "turnStage");
    copy_optional_chat_u64(object, &mut message, "toolRound");
    copy_optional_chat_value(object, &mut message, "toolRoundLogs");
    copy_optional_chat_value(object, &mut message, "contextBudgetSnapshot");
    copy_optional_chat_value(object, &mut message, "dataBoundarySnapshot");
    copy_optional_chat_string(object, &mut message, "errorKind");
    copy_optional_chat_value(object, &mut message, "actionHistory");

    let error_message = object
        .get("errorMessage")
        .and_then(JsonValue::as_str)
        .map(ToOwned::to_owned)
        .or(error_block);
    if let Some(error_message) = error_message.filter(|value| !value.trim().is_empty()) {
        message.insert("errorMessage".to_owned(), JsonValue::String(error_message));
    }
    if let Some(reasoning) = reasoning.filter(|value| !value.is_empty()) {
        message.insert("reasoning".to_owned(), JsonValue::String(reasoning));
    }

    Some(JsonValue::Object(message))
}

/// chat role 값이 런타임에서 허용되는 role인지 확인한다.
fn is_chat_role(role: &str) -> bool {
    matches!(role, "system" | "user" | "assistant" | "tool")
}

/// chat message status가 런타임 union에 포함되는지 확인한다.
fn is_chat_status(status: &str) -> bool {
    matches!(status, "pending" | "streaming" | "complete" | "error")
}

/// finite f64를 JSON number로 변환한다.
fn finite_json_number_value(value: f64) -> Option<JsonValue> {
    JsonNumber::from_f64(value).map(JsonValue::Number)
}

/// optional string meta field를 message object로 복사한다.
fn copy_optional_chat_string(
    source: &JsonMap<String, JsonValue>,
    target: &mut JsonMap<String, JsonValue>,
    key: &str,
) {
    let Some(value) = source
        .get(key)
        .and_then(JsonValue::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return;
    };
    target.insert(key.to_owned(), JsonValue::String(value.to_owned()));
}

/// optional JSON meta field를 message object로 복사한다.
fn copy_optional_chat_value(
    source: &JsonMap<String, JsonValue>,
    target: &mut JsonMap<String, JsonValue>,
    key: &str,
) {
    let Some(value) = source.get(key) else {
        return;
    };
    if value.is_null() {
        return;
    }
    target.insert(key.to_owned(), value.clone());
}

/// optional integer meta field를 message object로 복사한다.
fn copy_optional_chat_u64(
    source: &JsonMap<String, JsonValue>,
    target: &mut JsonMap<String, JsonValue>,
    key: &str,
) {
    let Some(value) = source.get(key).and_then(JsonValue::as_u64) else {
        return;
    };
    target.insert(key.to_owned(), JsonValue::Number(JsonNumber::from(value)));
}

/// named block comment에서 raw 또는 base64-decoded text를 추출한다.
fn extract_chat_named_block(block: &str, name: &str, decode_failure_label: &str) -> Option<String> {
    let marker = find_next_chat_named_block_start(block, name)?;
    let attr_start = marker.start.saturating_add(marker.open_marker.len());
    let tag_end_relative = block.get(attr_start..)?.find("-->")?;
    let tag_end = attr_start.saturating_add(tag_end_relative);
    let content_start = tag_end.saturating_add("-->".len());
    let close_marker = format!("<!-- {}-{name}-end -->", marker.prefix);
    let content_end_relative = block.get(content_start..)?.find(&close_marker)?;
    let content_end = content_start.saturating_add(content_end_relative);
    let attrs = block.get(attr_start..tag_end).unwrap_or_default();
    let raw = block
        .get(content_start..content_end)
        .unwrap_or_default()
        .trim();
    if attrs.contains("encoding=\"base64\"") {
        return Some(decode_base64_utf8(raw).unwrap_or_else(|| decode_failure_label.to_owned()));
    }
    Some(raw.to_owned())
}

/// named block start marker 위치.
struct ChatNamedBlockStart {
    /// marker 시작 byte offset.
    start: usize,
    /// marker prefix.
    prefix: &'static str,
    /// open marker 문자열.
    open_marker: String,
}

/// base64 decoder token.
#[derive(Clone, Copy)]
enum Base64Token {
    /// 6-bit sextet 값.
    Value(u8),
    /// `=` padding.
    Padding,
}

/// 다음 named block start marker를 찾는다.
fn find_next_chat_named_block_start(block: &str, name: &str) -> Option<ChatNamedBlockStart> {
    const PREFIXES: [&str; 2] = ["superpower-inside", "super-obsidian"];
    PREFIXES
        .iter()
        .filter_map(|prefix| {
            let open_marker = format!("<!-- {prefix}-{name}-start");
            block.find(&open_marker).map(|start| ChatNamedBlockStart {
                start,
                prefix,
                open_marker,
            })
        })
        .min_by_key(|marker| marker.start)
}

/// base64 UTF-8 text block을 decode한다.
fn decode_base64_utf8(value: &str) -> Option<String> {
    String::from_utf8(decode_base64_bytes(value)?).ok()
}

/// base64 문자열을 bytes로 decode한다.
fn decode_base64_bytes(value: &str) -> Option<Vec<u8>> {
    let sextets = value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .map(decode_base64_sextet)
        .collect::<Option<Vec<_>>>()?;
    let mut chunks = sextets.chunks_exact(4);
    if !chunks.remainder().is_empty() {
        return None;
    }
    let mut bytes = Vec::<u8>::with_capacity(sextets.len().saturating_div(4).saturating_mul(3));
    let mut seen_padding = false;
    for chunk in chunks.by_ref() {
        let [first, second, third, fourth] = chunk else {
            return None;
        };
        let (Base64Token::Value(first), Base64Token::Value(second)) = (first, second) else {
            return None;
        };
        if seen_padding
            && (matches!(third, Base64Token::Value(_)) || matches!(fourth, Base64Token::Value(_)))
        {
            return None;
        }
        let first_byte = (u32::from(*first) << 2) | (u32::from(*second) >> 4);
        bytes.push(u8::try_from(first_byte).ok()?);

        match (third, fourth) {
            (Base64Token::Value(third), Base64Token::Value(fourth)) => {
                let second_byte = ((u32::from(*second) & 0x0f) << 4) | (u32::from(*third) >> 2);
                let third_byte = ((u32::from(*third) & 0x03) << 6) | u32::from(*fourth);
                bytes.push(u8::try_from(second_byte).ok()?);
                bytes.push(u8::try_from(third_byte).ok()?);
            }
            (Base64Token::Value(third), Base64Token::Padding) => {
                let second_byte = ((u32::from(*second) & 0x0f) << 4) | (u32::from(*third) >> 2);
                bytes.push(u8::try_from(second_byte).ok()?);
                seen_padding = true;
            }
            (Base64Token::Padding, Base64Token::Padding) => {
                seen_padding = true;
            }
            (Base64Token::Padding, Base64Token::Value(_)) => return None,
        }
    }
    Some(bytes)
}

/// base64 character를 sextet 값으로 변환한다.
const fn decode_base64_sextet(byte: u8) -> Option<Base64Token> {
    match byte {
        b'A'..=b'Z' => Some(Base64Token::Value(byte - b'A')),
        b'a'..=b'z' => Some(Base64Token::Value(byte - b'a' + 26)),
        b'0'..=b'9' => Some(Base64Token::Value(byte - b'0' + 52)),
        b'+' => Some(Base64Token::Value(62)),
        b'/' => Some(Base64Token::Value(63)),
        b'=' => Some(Base64Token::Padding),
        _ => None,
    }
}

/// resolved reference file path에서 source와 중복을 제외한 index를 고른다.
fn plan_reference_file_indices(source_path: &str, file_paths: &[String]) -> Vec<usize> {
    let mut seen = BTreeSet::<&str>::new();
    let mut selected = Vec::<usize>::new();
    for (index, file_path) in file_paths.iter().enumerate() {
        if file_path == source_path {
            continue;
        }
        if seen.insert(file_path.as_str()) {
            selected.push(index);
        }
    }
    selected
}

/// basename fallback 후보에서 첫 번째 matching index를 고른다.
fn plan_vault_link_fallback_index(
    fallback_basename: &str,
    markdown_basenames: &[String],
) -> Option<usize> {
    markdown_basenames
        .iter()
        .position(|basename| basename == fallback_basename)
}

/// folder mention file selection 결과다.
struct FolderMentionFilePlan {
    /// markdown file path snapshot에서 선택된 index 목록이다.
    indices: Vec<usize>,
    /// folder 내부 파일이 max selection 개수를 초과했는지 여부다.
    partial: bool,
    /// folder 내부 전체 markdown file 수다.
    matched_count: usize,
    /// machine-readable limit reason.
    limit_reason: &'static str,
}

/// folder mention용 markdown file index와 초과 여부를 고른다.
fn plan_folder_mention_file_indices(
    folder_path: &str,
    markdown_file_paths: &[String],
    max_files: usize,
) -> FolderMentionFilePlan {
    let folder_prefix = format!("{folder_path}/");
    let mut matched_count = 0_usize;
    let mut indices = Vec::<usize>::new();

    for (index, file_path) in markdown_file_paths.iter().enumerate() {
        if !file_path.starts_with(&folder_prefix) {
            continue;
        }
        matched_count += 1;
        if indices.len() < max_files {
            indices.push(index);
        }
    }

    let partial = matched_count > indices.len();
    FolderMentionFilePlan {
        partial,
        matched_count,
        limit_reason: if partial { "max-files" } else { "complete" },
        indices,
    }
}

/// vault link target에서 직접/상대 path candidate를 만든다.
fn create_vault_link_path_candidates(
    source_path: &str,
    raw_target: &str,
    target: &str,
) -> Vec<String> {
    let source_folder = source_path.rsplit_once('/').map(|(folder, _)| folder);
    let target_with_extension = ensure_markdown_extension(target);
    let raw_target_with_extension = ensure_markdown_extension(raw_target);
    let mut candidates = Vec::new();
    push_unique_non_empty_string(&mut candidates, target.to_owned());
    push_unique_non_empty_string(&mut candidates, target_with_extension);
    if let Some(source_folder) = source_folder.filter(|folder| !folder.is_empty()) {
        push_unique_non_empty_string(
            &mut candidates,
            normalize_vault_path(&format!("{source_folder}/{raw_target}")),
        );
        push_unique_non_empty_string(
            &mut candidates,
            normalize_vault_path(&format!("{source_folder}/{raw_target_with_extension}")),
        );
    }
    candidates
}

/// Obsidian vault path의 `.`/`..` segment를 정규화한다.
fn normalize_vault_path(path: &str) -> String {
    let mut parts = Vec::<&str>::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    parts.join("/")
}

/// path에 Markdown 확장자가 없으면 `.md`를 붙인다.
fn ensure_markdown_extension(path: &str) -> String {
    if has_markdown_extension(path) {
        path.to_owned()
    } else {
        format!("{path}.md")
    }
}

/// path basename의 Markdown 확장자를 제거한다.
fn strip_markdown_extension(path: &str) -> &str {
    if has_markdown_extension(path) {
        path.rsplit_once('.')
            .map_or(path, |(stem, _extension)| stem)
    } else {
        path
    }
}

/// path가 Markdown 확장자를 갖는지 case-insensitive로 확인한다.
fn has_markdown_extension(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

/// file extension 문자열을 기존 UI 계약에 맞게 정규화한다.
fn normalize_file_extension(extension: &str) -> String {
    let trimmed = extension.trim();
    trimmed.strip_prefix('.').unwrap_or(trimmed).to_lowercase()
}

/// file path basename에서 확장자를 추출한다.
fn get_path_extension(file_path: &str) -> &str {
    let file_name = file_path.rsplit('/').next().unwrap_or(file_path);
    if !file_name.contains('.')
        || (file_name.starts_with('.')
            && !file_name.get(1..).is_some_and(|tail| tail.contains('.')))
    {
        return "";
    }
    file_name
        .rsplit_once('.')
        .map_or("", |(_stem, extension)| extension)
}

/// RAG 후보 판정에서 content read가 필요한 unknown text 후보 index를 계산한다.
fn plan_rag_file_content_probe_indices(
    files: &[RagFileEligibilityInput],
    exclude_paths: &[String],
    exclude_exts: &[String],
) -> Vec<usize> {
    let excluded_extensions = normalized_extension_set(exclude_exts);
    files
        .iter()
        .filter(|file| {
            !is_rag_file_excluded_before_probe(file, exclude_paths, &excluded_extensions)
                && classify_rag_file_without_probe(file) == RagFileProbeDecision::NeedsProbe
        })
        .map(|file| file.index)
        .collect()
}

/// RAG 후보 file index와 summary 입력 row를 계산한다.
fn plan_rag_file_indexability(
    files: &[RagFileEligibilityInput],
    exclude_paths: &[String],
    exclude_exts: &[String],
    text_probes: &[RagFileTextProbeInput],
) -> (Vec<usize>, Vec<RagFileTypeInput>) {
    let excluded_extensions = normalized_extension_set(exclude_exts);
    let probe_by_index = text_probes
        .iter()
        .map(|probe| (probe.index, probe))
        .collect::<BTreeMap<_, _>>();
    let mut candidate_indices = Vec::<usize>::new();
    let mut summary_inputs = Vec::<RagFileTypeInput>::new();

    for file in files {
        if is_rag_file_excluded_before_probe(file, exclude_paths, &excluded_extensions) {
            continue;
        }

        let indexable = match classify_rag_file_without_probe(file) {
            RagFileProbeDecision::Indexable => true,
            RagFileProbeDecision::NotIndexable(reason) => {
                summary_inputs.push(rag_file_type_input(file, false, Some(reason)));
                continue;
            }
            RagFileProbeDecision::NeedsProbe => probe_by_index
                .get(&file.index)
                .is_some_and(|probe| probe.readable && is_probably_text_sample(&probe.sample)),
        };

        if indexable {
            candidate_indices.push(file.index);
            summary_inputs.push(rag_file_type_input(file, true, None));
        } else {
            summary_inputs.push(rag_file_type_input(file, false, Some("unreadable")));
        }
    }

    (candidate_indices, summary_inputs)
}

/// RAG 후보 판정에서 file metadata만으로 결정할 수 있는 상태.
#[derive(Clone, Copy, PartialEq, Eq)]
enum RagFileProbeDecision {
    /// 바로 indexable로 판정한다.
    Indexable,
    /// content read probe가 필요하다.
    NeedsProbe,
    /// indexable이 아니며 summary reason을 가진다.
    NotIndexable(&'static str),
}

/// content probe 이전에 path/ext 제외가 적용되는지 확인한다.
fn is_rag_file_excluded_before_probe(
    file: &RagFileEligibilityInput,
    exclude_paths: &[String],
    excluded_extensions: &BTreeSet<String>,
) -> bool {
    is_vault_path_excluded(&file.file_path, exclude_paths.iter().map(String::as_str))
        || excluded_extensions.contains(&rag_file_extension(file))
}

/// file metadata만으로 RAG indexability를 분류한다.
fn classify_rag_file_without_probe(file: &RagFileEligibilityInput) -> RagFileProbeDecision {
    if is_sensitive_rag_file(file) {
        return RagFileProbeDecision::NotIndexable("sensitive");
    }
    if file.size == 0 {
        return RagFileProbeDecision::NotIndexable("unreadable");
    }
    if is_known_text_extension(&rag_file_extension(file))
        || is_known_text_file_name(&file.file_name)
    {
        return RagFileProbeDecision::Indexable;
    }
    RagFileProbeDecision::NeedsProbe
}

/// summary plan에 넘길 file type input row를 만든다.
fn rag_file_type_input(
    file: &RagFileEligibilityInput,
    indexable: bool,
    recommendation_reason: Option<&str>,
) -> RagFileTypeInput {
    RagFileTypeInput {
        file_path: file.file_path.clone(),
        extension: Some(file.extension.clone()),
        indexable,
        recommendation_reason: recommendation_reason.map(ToOwned::to_owned),
    }
}

/// exclude extension 목록을 정규화한다.
fn normalized_extension_set(values: &[String]) -> BTreeSet<String> {
    values
        .iter()
        .map(|value| normalize_file_extension(value))
        .filter(|value| !value.is_empty())
        .collect()
}

/// Obsidian extension 값이 비어 있으면 path에서 확장자를 추출한다.
fn rag_file_extension(file: &RagFileEligibilityInput) -> String {
    normalize_file_extension(if file.extension.trim().is_empty() {
        get_path_extension(&file.file_path)
    } else {
        &file.extension
    })
}

/// 민감 파일은 RAG 후보와 readable probe에서 제외한다.
fn is_sensitive_rag_file(file: &RagFileEligibilityInput) -> bool {
    let name = file.file_name.to_lowercase();
    let extension = rag_file_extension(file);
    name.starts_with(".env")
        || matches!(
            name.as_str(),
            ".npmrc" | ".pypirc" | ".netrc" | "id_rsa" | "id_ed25519"
        )
        || name.starts_with("secrets.")
        || name.starts_with("credentials.")
        || matches!(extension.as_str(), "env" | "pem" | "key")
}

/// 확장자 기반으로 바로 text file임을 판단한다.
fn is_known_text_extension(extension: &str) -> bool {
    matches!(
        extension,
        "md" | "txt"
            | "markdown"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "json"
            | "jsonc"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "html"
            | "htm"
            | "xml"
            | "svg"
            | "py"
            | "java"
            | "go"
            | "rs"
            | "rb"
            | "php"
            | "cs"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "swift"
            | "kt"
            | "kts"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
            | "ps1"
            | "sql"
            | "csv"
            | "tsv"
            | "yaml"
            | "yml"
            | "toml"
            | "ini"
            | "conf"
            | "config"
            | "log"
            | "gitignore"
            | "dockerignore"
    )
}

/// 확장자가 없는 dotfile 이름 기반 text file 판정.
fn is_known_text_file_name(file_name: &str) -> bool {
    let normalized = file_name.to_lowercase();
    let without_leading_dot = normalized.strip_prefix('.').unwrap_or(&normalized);
    is_known_text_extension(&normalized) || is_known_text_extension(without_leading_dot)
}

/// unknown extension file의 text sample을 판정한다.
fn is_probably_text_sample(sample: &str) -> bool {
    if sample.is_empty() || sample.contains('\0') {
        return false;
    }

    let mut total_chars = 0usize;
    let mut control_chars = 0usize;
    for character in sample.chars() {
        total_chars = total_chars.saturating_add(1);
        let code = u32::from(character);
        if code < 32 && code != 9 && code != 10 && code != 13 {
            control_chars = control_chars.saturating_add(1);
        }
    }
    total_chars > 0 && control_chars.saturating_mul(100) < total_chars.saturating_mul(2)
}

/// exclude recommendation으로 제안 가능한 확장자인지 확인한다.
fn is_recommendable_exclude_extension(extension: &str) -> bool {
    !extension.is_empty() && extension != "md" && extension != "markdown"
}

/// file type label을 만든다. `(none)`은 caller가 전달한 i18n label을 쓴다.
fn file_type_label(extension: &str, no_extension_label: &str) -> String {
    if extension == "(none)" {
        no_extension_label.to_owned()
    } else {
        format!(".{extension}")
    }
}

/// 빈 문자열을 제외하고 첫 등장 순서로 문자열을 추가한다.
fn push_unique_non_empty_string(values: &mut Vec<String>, candidate: String) {
    if candidate.is_empty() || values.iter().any(|value| value == &candidate) {
        return;
    }
    values.push(candidate);
}

/// 채팅 입력에서 mention 후보를 추출한다.
fn parse_mention_candidates(content: &str) -> Vec<MentionCandidate> {
    let mut candidates = Vec::<MentionCandidate>::new();
    let mut seen = Vec::<String>::new();
    let text_without_brackets =
        collect_bracket_mention_candidates(content, &mut candidates, &mut seen);
    collect_word_mention_candidates(&text_without_brackets, &mut candidates, &mut seen);
    candidates
}

/// bracket mention 후보를 추출하고, 해당 구간을 공백으로 치환한 텍스트를 반환한다.
fn collect_bracket_mention_candidates(
    content: &str,
    candidates: &mut Vec<MentionCandidate>,
    seen: &mut Vec<String>,
) -> String {
    let mut output = String::with_capacity(content.len());
    let mut offset = 0_usize;

    while offset < content.len() {
        if content
            .get(offset..)
            .is_some_and(|tail| tail.starts_with("@["))
        {
            let name_start = offset.saturating_add(2);
            if let Some(name_tail) = content.get(name_start..)
                && let Some(close_offset) = name_tail.find(']')
            {
                let close_index = name_start.saturating_add(close_offset);
                if let (Some(raw), Some(name)) = (
                    content.get(offset..=close_index),
                    content.get(name_start..close_index),
                ) {
                    push_mention_candidate(raw, name.trim(), candidates, seen);
                    output.push(' ');
                    offset = close_index.saturating_add(1);
                    continue;
                }
            }
        }

        let Some(character) = content.get(offset..).and_then(|tail| tail.chars().next()) else {
            break;
        };
        output.push(character);
        offset = offset.saturating_add(character.len_utf8());
    }

    output
}

/// word mention 후보를 추출한다.
fn collect_word_mention_candidates(
    content: &str,
    candidates: &mut Vec<MentionCandidate>,
    seen: &mut Vec<String>,
) {
    let mut offset = 0_usize;

    while offset < content.len() {
        let Some(character) = content.get(offset..).and_then(|tail| tail.chars().next()) else {
            break;
        };
        if character != '@' {
            offset = offset.saturating_add(character.len_utf8());
            continue;
        }

        let raw_start = offset;
        offset = offset.saturating_add(character.len_utf8());
        let name_start = offset;

        while offset < content.len() {
            let Some(next) = content.get(offset..).and_then(|tail| tail.chars().next()) else {
                break;
            };
            if next == '@' || next.is_whitespace() {
                break;
            }
            offset = offset.saturating_add(next.len_utf8());
        }

        if offset == name_start {
            continue;
        }
        if let (Some(raw), Some(name)) = (
            content.get(raw_start..offset),
            content.get(name_start..offset),
        ) {
            push_mention_candidate(raw, name.trim(), candidates, seen);
        }
    }
}

/// mention 후보를 기존 `TypeScript` dedupe 순서와 같게 추가한다.
fn push_mention_candidate(
    raw: &str,
    name: &str,
    candidates: &mut Vec<MentionCandidate>,
    seen: &mut Vec<String>,
) {
    let key = name.to_lowercase();
    if seen.iter().any(|item| item == &key) {
        return;
    }
    seen.push(key);
    candidates.push(MentionCandidate {
        raw: raw.to_owned(),
        name: name.to_owned(),
    });
}

/// path가 제외 pattern 목록에 매칭되는지 확인한다.
fn is_vault_path_excluded<'a>(
    file_path: &str,
    patterns: impl IntoIterator<Item = &'a str>,
) -> bool {
    let lower_path = normalize_exclude_path(file_path);
    for pattern in patterns {
        let normalized_pattern = normalize_exclude_path(pattern);
        if normalized_pattern.is_empty() {
            continue;
        }

        if let Some(segment_pattern) = normalized_pattern.strip_suffix("/**") {
            if matches_path_segment(&lower_path, segment_pattern) {
                return true;
            }
            continue;
        }

        if let Some(segment_pattern) = normalized_pattern.strip_prefix("**/") {
            if matches_path_segment(&lower_path, segment_pattern) {
                return true;
            }
            continue;
        }

        if normalized_pattern.contains('*') {
            if glob_matches_path(&lower_path, &normalized_pattern) {
                return true;
            }
            continue;
        }

        if matches_path_segment(&lower_path, &normalized_pattern) {
            return true;
        }

        if !normalized_pattern.contains('/')
            && lower_path.ends_with(&format!(".{normalized_pattern}"))
        {
            return true;
        }
    }
    false
}

/// `TypeScript` exclude path normalization과 같은 규칙을 적용한다.
fn normalize_exclude_path(path: &str) -> String {
    let replaced = path.trim().replace('\\', "/");
    let without_dot_slash = replaced
        .strip_prefix("./")
        .or_else(|| replaced.strip_prefix('/'))
        .unwrap_or(&replaced);
    without_dot_slash.trim_start_matches('/').to_lowercase()
}

/// file path가 pattern segment 또는 그 하위 path와 일치하는지 확인한다.
fn matches_path_segment(file_path: &str, pattern: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }
    file_path == pattern
        || file_path.starts_with(&format!("{pattern}/"))
        || file_path.ends_with(&format!("/{pattern}"))
        || file_path.contains(&format!("/{pattern}/"))
}

/// glob-like pattern이 slash boundary 안에서 path와 매칭되는지 확인한다.
fn glob_matches_path(file_path: &str, pattern: &str) -> bool {
    let starts = slash_boundary_starts(file_path);
    let ends = slash_boundary_ends(file_path);
    for start in starts {
        for end in ends.iter().copied().filter(|end| *end >= start) {
            let Some(candidate) = file_path.get(start..end) else {
                continue;
            };
            if wildcard_matches(pattern, candidate) {
                return true;
            }
        }
    }
    false
}

/// glob match가 시작될 수 있는 slash boundary byte offset을 반환한다.
fn slash_boundary_starts(path: &str) -> Vec<usize> {
    let mut starts = vec![0_usize];
    for (index, character) in path.char_indices() {
        if character == '/' {
            starts.push(index.saturating_add(1));
        }
    }
    starts
}

/// glob match가 끝날 수 있는 slash boundary byte offset을 반환한다.
fn slash_boundary_ends(path: &str) -> Vec<usize> {
    let mut ends = vec![path.len()];
    for (index, character) in path.char_indices() {
        if character == '/' {
            ends.push(index);
        }
    }
    ends
}

/// `*`는 slash를 제외한 0개 이상의 문자와 매칭한다.
fn wildcard_matches(pattern: &str, candidate: &str) -> bool {
    wildcard_matches_chars(
        &pattern.chars().collect::<Vec<_>>(),
        &candidate.chars().collect::<Vec<_>>(),
    )
}

/// 작은 glob pattern을 backtracking으로 매칭한다.
fn wildcard_matches_chars(pattern: &[char], candidate: &[char]) -> bool {
    let mut pattern_index = 0_usize;
    let mut candidate_index = 0_usize;
    let mut star_index = None::<usize>;
    let mut star_candidate_index = 0_usize;

    while candidate_index < candidate.len() {
        if pattern.get(pattern_index) == candidate.get(candidate_index) {
            pattern_index = pattern_index.saturating_add(1);
            candidate_index = candidate_index.saturating_add(1);
            continue;
        }
        if pattern.get(pattern_index) == Some(&'*') {
            star_index = Some(pattern_index);
            star_candidate_index = candidate_index;
            pattern_index = pattern_index.saturating_add(1);
            continue;
        }
        let Some(previous_star) = star_index else {
            return false;
        };
        if candidate.get(star_candidate_index) == Some(&'/') {
            return false;
        }
        pattern_index = previous_star.saturating_add(1);
        star_candidate_index = star_candidate_index.saturating_add(1);
        candidate_index = star_candidate_index;
    }

    pattern
        .iter()
        .skip(pattern_index)
        .all(|character| *character == '*')
}

/// `[[...]]` target을 추출한다.
fn extract_wiki_link_targets(content: &str, links: &mut Vec<String>) {
    let mut offset = 0_usize;
    while let Some(start) = content.get(offset..).and_then(|text| text.find("[[")) {
        let target_start = offset.saturating_add(start).saturating_add(2);
        let Some(end) = content.get(target_start..).and_then(|text| text.find("]]")) else {
            break;
        };
        let target_end = target_start.saturating_add(end);
        if let Some(raw) = content.get(target_start..target_end) {
            push_normalized_vault_link(links, raw);
        }
        offset = target_end.saturating_add(2);
    }
}

/// `[label](target)` target을 추출한다.
fn extract_markdown_link_targets(content: &str, links: &mut Vec<String>) {
    let mut offset = 0_usize;
    while let Some(start) = content.get(offset..).and_then(|text| text.find('[')) {
        let label_start = offset.saturating_add(start);
        let label_end_start = label_start.saturating_add(1);
        let Some(label_end_offset) = content
            .get(label_end_start..)
            .and_then(|text| text.find(']'))
        else {
            break;
        };
        let label_end = label_end_start.saturating_add(label_end_offset);
        let open_paren = label_end.saturating_add(1);
        if content.get(open_paren..open_paren.saturating_add(1)) != Some("(") {
            offset = label_end.saturating_add(1);
            continue;
        }

        let target_start = open_paren.saturating_add(1);
        let Some(target_end_offset) = content.get(target_start..).and_then(|text| text.find(')'))
        else {
            break;
        };
        let target_end = target_start.saturating_add(target_end_offset);
        if let Some(raw) = content.get(target_start..target_end) {
            push_normalized_vault_link(links, raw);
        }
        offset = target_end.saturating_add(1);
    }
}

/// link target을 정규화하고 중복 없이 추가한다.
fn push_normalized_vault_link(links: &mut Vec<String>, raw: &str) {
    let normalized = normalize_vault_link_target(raw);
    if normalized.is_empty() || should_ignore_vault_link_target(&normalized) {
        return;
    }
    let key = normalized.to_lowercase();
    if links.iter().any(|link| link.to_lowercase() == key) {
        return;
    }
    links.push(normalized);
}

/// alias, heading, block id를 제거하고 percent-encoded target을 decode한다.
fn normalize_vault_link_target(raw: &str) -> String {
    let without_alias = raw.split('|').next().unwrap_or_default();
    let without_heading = without_alias.split('#').next().unwrap_or_default();
    let without_block = without_heading.split('^').next().unwrap_or_default();
    let trimmed = without_block.trim();
    decode_uri_component(trimmed).unwrap_or_else(|| trimmed.to_owned())
}

/// vault 내부 링크로 처리하지 않을 target인지 확인한다.
fn should_ignore_vault_link_target(target: &str) -> bool {
    target.is_empty()
        || target.starts_with('#')
        || target.starts_with("mailto:")
        || has_uri_scheme(target)
}

/// `URI` scheme prefix가 있는지 확인한다.
fn has_uri_scheme(target: &str) -> bool {
    let mut chars = target.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    for character in chars {
        if character == ':' {
            return true;
        }
        if !character.is_ascii_alphanumeric() && !matches!(character, '+' | '.' | '-') {
            return false;
        }
    }
    false
}

/// `decodeURIComponent`와 같은 percent decoding을 시도한다.
fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::<u8>::with_capacity(bytes.len());
    let mut index = 0_usize;
    while index < bytes.len() {
        if bytes.get(index).copied() != Some(b'%') {
            decoded.push(*bytes.get(index)?);
            index = index.saturating_add(1);
            continue;
        }
        let high = *bytes.get(index.saturating_add(1))?;
        let low = *bytes.get(index.saturating_add(2))?;
        let byte = hex_value(high)?
            .saturating_mul(16)
            .saturating_add(hex_value(low)?);
        decoded.push(byte);
        index = index.saturating_add(3);
    }
    String::from_utf8(decoded).ok()
}

/// ASCII hex digit 값을 반환한다.
const fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// heading marker를 제거한다.
fn normalize_heading(line: &str) -> String {
    line.trim_start_matches('#').trim().to_owned()
}

/// chunk line buffer에 line을 추가하고 joined text의 UTF-16 길이를 누적한다.
fn push_chunk_line(current_lines: &mut Vec<String>, current_length: &mut usize, line: &str) {
    if !current_lines.is_empty() {
        *current_length = current_length.saturating_add(1);
    }
    *current_length = current_length.saturating_add(text_len(line));
    current_lines.push(line.to_owned());
}

/// chunk line buffer를 교체하고 joined text의 UTF-16 길이를 다시 계산한다.
fn set_chunk_lines(
    current_lines: &mut Vec<String>,
    current_length: &mut usize,
    lines: Vec<String>,
) {
    *current_length = joined_line_text_len(&lines);
    *current_lines = lines;
}

/// line 배열을 `\n`으로 join했을 때의 UTF-16 길이를 allocation 없이 계산한다.
fn joined_line_text_len(lines: &[String]) -> usize {
    lines
        .iter()
        .enumerate()
        .fold(0_usize, |length, (index, line)| {
            let newline = usize::from(index > 0);
            length
                .saturating_add(newline)
                .saturating_add(text_len(line))
        })
}

/// Markdown paragraph break 후보의 prefix UTF-16 길이를 allocation 없이 찾는다.
fn last_paragraph_break_len(lines: &[String]) -> Option<usize> {
    let mut joined_len_before_line = 0_usize;
    let mut break_len = None;

    for (index, line) in lines.iter().enumerate() {
        if index > 0 && index.saturating_add(1) < lines.len() && line.is_empty() {
            break_len = Some(joined_len_before_line);
        }
        joined_len_before_line = joined_len_before_line
            .saturating_add(usize::from(index > 0))
            .saturating_add(text_len(line));
    }

    break_len
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
    current_length: &mut usize,
    current_heading: Option<&String>,
    start_line: &mut usize,
    index: usize,
    last_para_break: usize,
) {
    let mut partial_length = 0_usize;
    let split_index = current_lines
        .iter()
        .enumerate()
        .find_map(|(line_index, line)| {
            partial_length = partial_length
                .saturating_add(usize::from(line_index > 0))
                .saturating_add(text_len(line));
            (partial_length >= last_para_break).then_some(line_index)
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
        set_chunk_lines(current_lines, current_length, part);
        flush_chunk(chunks, current_lines, current_heading, *start_line, index);
        set_chunk_lines(current_lines, current_length, rest);
        *start_line = index.saturating_sub(current_lines.len()).saturating_add(1);
    } else {
        flush_chunk(chunks, current_lines, current_heading, *start_line, index);
        *current_length = 0;
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

/// index 배열을 `wasm-bindgen`이 안정적으로 넘길 수 있는 `f64` 배열로 변환한다.
fn collect_indices_as_f64(indices: impl IntoIterator<Item = usize>) -> Box<[f64]> {
    let mut output = Vec::new();
    for index in indices {
        if let Some(value) = usize_to_f64(index) {
            output.push(value);
        }
    }
    output.into_boxed_slice()
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

/// 문자열 배열을 JSON 문자열로 serialize한다.
fn serialize_string_array_json(values: &[String]) -> String {
    let body = values
        .iter()
        .map(|value| format!("\"{}\"", escape_json_string(value)))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// bool 배열을 JSON 문자열로 serialize한다.
fn serialize_bool_array_json(values: &[bool]) -> String {
    let body = values
        .iter()
        .map(std::string::ToString::to_string)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// Graph extraction type validation plan을 JSON 문자열로 serialize한다.
fn serialize_graph_extraction_type_validation_plan_json(
    entity_type_known: &[bool],
    claim_type_known: &[bool],
) -> String {
    format!(
        "{{\"entityTypeKnown\":{},\"claimTypeKnown\":{}}}",
        serialize_bool_array_json(entity_type_known),
        serialize_bool_array_json(claim_type_known)
    )
}

/// Graph community summarizer grouping plan을 JSON 문자열로 serialize한다.
fn serialize_graph_community_summary_groups_json(
    groups: &[GraphCommunitySummaryGroupPlan],
) -> String {
    let body = groups
        .iter()
        .map(|group| {
            format!(
                "{{\"entityIndices\":{},\"relationIndices\":{},\"claimIndices\":{}}}",
                serialize_usize_array_json(&group.entities),
                serialize_usize_array_json(&group.relations),
                serialize_usize_array_json(&group.claims)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"groups\":[{body}]}}")
}

/// Graph extraction relation endpoint plan을 JSON 문자열로 serialize한다.
fn serialize_graph_relation_endpoint_plan_json(
    pairs: &[Option<GraphRelationEndpointPair>],
) -> String {
    let body = pairs
        .iter()
        .map(|pair| {
            pair.as_ref().map_or_else(
                || "null".to_owned(),
                |pair| {
                    format!(
                        "{{\"sourceEntityIndex\":{},\"targetEntityIndex\":{}}}",
                        pair.source_entity_index, pair.target_entity_index
                    )
                },
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{\"pairs\":[{body}]}}")
}

/// vault link candidate plan을 JSON 문자열로 serialize한다.
fn serialize_vault_link_candidate_plan_json(
    candidates: &[String],
    fallback_basename: &str,
) -> String {
    format!(
        "{{\"candidates\":{},\"fallbackBasename\":\"{}\"}}",
        serialize_string_array_json(candidates),
        escape_json_string(fallback_basename)
    )
}

/// BM25 hit lookup plan을 JSON 문자열로 serialize한다.
fn serialize_bm25_hit_lookup_plan_json(hits: &[Bm25Hit]) -> String {
    let lookup_doc_ids = hits
        .iter()
        .map(|hit| hit.doc_id.clone())
        .collect::<Vec<_>>();
    let max_score = hits
        .iter()
        .map(|hit| hit.score)
        .filter(|score| score.is_finite() && *score > 0.0)
        .fold(0.0, f64::max)
        .max(1.0e-12);
    let hit_body = hits
        .iter()
        .map(|hit| {
            format!(
                "{{\"docId\":\"{}\",\"sourcePath\":\"{}\",\"score\":{}}}",
                escape_json_string(&hit.doc_id),
                escape_json_string(&hit.source_path),
                hit.score,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"hits\":[{hit_body}],\"lookupDocIds\":{},\"maxScore\":{max_score}}}",
        serialize_string_array_json(&lookup_doc_ids),
    )
}

/// BM25 index data를 JSON 문자열로 serialize한다.
fn serialize_bm25_index_json(index: &Bm25IndexData) -> String {
    let total_docs = index.doc_lengths.len();
    format!(
        "{{\"tokenizerVersion\":{},\"inverted\":{},\"docLengths\":{},\"docSources\":{},\"totalDocs\":{},\"avgDocLength\":{}}}",
        index.tokenizer_version,
        serialize_bm25_inverted_json(&index.inverted),
        serialize_string_number_map_json(&index.doc_lengths),
        serialize_string_string_map_json(&index.doc_sources),
        total_docs,
        finite_json_number(bm25_average_doc_length(index)).unwrap_or_else(|| "1".to_owned()),
    )
}

/// BM25 index data를 compact v3 JSON 문자열로 serialize한다.
fn serialize_bm25_compact_index_json(index: &Bm25IndexData) -> String {
    let mut doc_index_by_id = BTreeMap::<&str, usize>::new();
    let mut docs = Vec::<String>::new();
    for (doc_id, length) in &index.doc_lengths {
        let Some(length_json) = finite_json_number(*length) else {
            continue;
        };
        let doc_index = docs.len();
        doc_index_by_id.insert(doc_id.as_str(), doc_index);
        let source_path = index.doc_sources.get(doc_id).unwrap_or(doc_id);
        docs.push(format!(
            "{{\"id\":\"{}\",\"sourcePath\":\"{}\",\"length\":{}}}",
            escape_json_string(doc_id),
            escape_json_string(source_path),
            length_json,
        ));
    }

    let mut terms = Vec::<String>::new();
    for (term, posting) in &index.inverted {
        let mut posting_values = Vec::<String>::new();
        for (doc_id, frequency) in posting {
            let Some(doc_index) = doc_index_by_id.get(doc_id.as_str()).copied() else {
                continue;
            };
            let Some(frequency_json) = finite_json_number(*frequency) else {
                continue;
            };
            posting_values.push(doc_index.to_string());
            posting_values.push(frequency_json);
        }
        if posting_values.is_empty() {
            continue;
        }
        terms.push(format!(
            "{{\"term\":\"{}\",\"postings\":[{}]}}",
            escape_json_string(term),
            posting_values.join(","),
        ));
    }

    format!(
        "{{\"schemaVersion\":{},\"tokenizerVersion\":{},\"docs\":[{}],\"terms\":[{}],\"totalDocs\":{},\"avgDocLength\":{}}}",
        BM25_COMPACT_SCHEMA_VERSION,
        index.tokenizer_version,
        docs.join(","),
        terms.join(","),
        docs.len(),
        finite_json_number(bm25_average_doc_length(index)).unwrap_or_else(|| "1".to_owned()),
    )
}

/// BM25 inverted index를 JSON 문자열로 serialize한다.
fn serialize_bm25_inverted_json(inverted: &BTreeMap<String, BTreeMap<String, f64>>) -> String {
    let body = inverted
        .iter()
        .map(|(term, posting)| {
            format!(
                "\"{}\":{}",
                escape_json_string(term),
                serialize_string_number_map_json(posting)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{body}}}")
}

/// string -> finite number map을 JSON 문자열로 serialize한다.
fn serialize_string_number_map_json(values: &BTreeMap<String, f64>) -> String {
    let body = values
        .iter()
        .filter_map(|(key, value)| {
            Some(format!(
                "\"{}\":{}",
                escape_json_string(key),
                finite_json_number(*value)?
            ))
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{body}}}")
}

/// string -> string map을 JSON 문자열로 serialize한다.
fn serialize_string_string_map_json(values: &BTreeMap<String, String>) -> String {
    let body = values
        .iter()
        .map(|(key, value)| {
            format!(
                "\"{}\":\"{}\"",
                escape_json_string(key),
                escape_json_string(value)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{body}}}")
}

/// BM25 search score list를 JSON 문자열로 serialize한다.
fn serialize_bm25_search_scores_json(scores: &[Bm25SearchScore]) -> String {
    let body = scores
        .iter()
        .filter_map(|score| {
            Some(format!(
                "{{\"docId\":\"{}\",\"score\":{}}}",
                escape_json_string(&score.doc_id),
                finite_json_number(score.score)?
            ))
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// BM25 candidate resolution plan을 JSON 문자열로 serialize한다.
fn serialize_bm25_candidate_resolution_json(candidates: &[Bm25CandidateResolution]) -> String {
    let body = candidates
        .iter()
        .map(|candidate| {
            format!(
                "{{\"entrySet\":\"{}\",\"entryIndex\":{},\"sourceScore\":{}}}",
                candidate.entry_set, candidate.entry_index, candidate.source_score,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// BM25 hit JSON array를 파싱한다.
fn parse_bm25_hits_json(payload: &str) -> Option<Vec<Bm25Hit>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut hits = Vec::with_capacity(values.len());
    for (sequence, value) in values.iter().enumerate() {
        let object = value.as_object()?;
        let doc_id = object.get("docId")?.as_str()?.trim().to_owned();
        let source_path = object
            .get("sourcePath")
            .and_then(JsonValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&doc_id)
            .to_owned();
        let score = object.get("score")?.as_f64()?;
        hits.push(Bm25Hit {
            doc_id,
            source_path,
            score,
            sequence,
        });
    }
    Some(hits)
}

/// BM25 index JSON object를 파싱한다.
fn parse_bm25_index_json(payload: &str) -> Option<Bm25IndexData> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    if object
        .get("schemaVersion")
        .and_then(JsonValue::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        == Some(BM25_COMPACT_SCHEMA_VERSION)
    {
        return parse_bm25_compact_index_object(object);
    }
    let tokenizer_version = object
        .get("tokenizerVersion")
        .and_then(JsonValue::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_default();
    let doc_lengths =
        parse_string_number_object(object.get("docLengths").and_then(JsonValue::as_object)?);
    let doc_sources = object
        .get("docSources")
        .and_then(JsonValue::as_object)
        .map_or_else(
            || {
                doc_lengths
                    .keys()
                    .map(|doc_id| (doc_id.clone(), doc_id.clone()))
                    .collect()
            },
            parse_string_string_object,
        );
    Some(Bm25IndexData {
        tokenizer_version,
        inverted: parse_bm25_inverted_object(
            object.get("inverted").and_then(JsonValue::as_object)?,
        ),
        doc_lengths,
        doc_sources,
    })
}

/// compact v3 BM25 index JSON object를 파싱한다.
fn parse_bm25_compact_index_object(object: &JsonMap<String, JsonValue>) -> Option<Bm25IndexData> {
    let tokenizer_version = object
        .get("tokenizerVersion")
        .and_then(JsonValue::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_default();
    let docs = object.get("docs")?.as_array()?;
    let mut doc_ids = Vec::<String>::with_capacity(docs.len());
    let mut doc_lengths = BTreeMap::<String, f64>::new();
    let mut doc_sources = BTreeMap::<String, String>::new();

    for doc in docs {
        let doc_object = doc.as_object()?;
        let id = doc_object.get("id")?.as_str()?.trim().to_owned();
        if id.is_empty() {
            return None;
        }
        let length = doc_object.get("length")?.as_f64()?;
        if !length.is_finite() || length < 0.0 {
            return None;
        }
        let source_path = doc_object
            .get("sourcePath")
            .and_then(JsonValue::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&id)
            .to_owned();
        doc_ids.push(id.clone());
        doc_lengths.insert(id.clone(), length);
        doc_sources.insert(id, source_path);
    }

    let mut inverted = BTreeMap::<String, BTreeMap<String, f64>>::new();
    for term_value in object.get("terms")?.as_array()? {
        let term_object = term_value.as_object()?;
        let term = term_object.get("term")?.as_str()?.trim().to_owned();
        if term.is_empty() {
            continue;
        }
        let postings = term_object.get("postings")?.as_array()?;
        let mut posting = BTreeMap::<String, f64>::new();
        for pair in postings.chunks(2) {
            let [doc_index_value, frequency_value] = pair else {
                return None;
            };
            let doc_index = doc_index_value
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())?;
            let frequency = frequency_value.as_f64()?;
            if !frequency.is_finite() || frequency <= 0.0 {
                continue;
            }
            let doc_id = doc_ids.get(doc_index)?;
            posting.insert(doc_id.clone(), frequency);
        }
        if !posting.is_empty() {
            inverted.insert(term, posting);
        }
    }

    Some(Bm25IndexData {
        tokenizer_version,
        inverted,
        doc_lengths,
        doc_sources,
    })
}

/// BM25 inverted object를 파싱한다.
fn parse_bm25_inverted_object(
    object: &JsonMap<String, JsonValue>,
) -> BTreeMap<String, BTreeMap<String, f64>> {
    let mut inverted = BTreeMap::new();
    for (term, posting_value) in object {
        let Some(posting_object) = posting_value.as_object() else {
            continue;
        };
        let posting = parse_string_number_object(posting_object);
        if !posting.is_empty() {
            inverted.insert(term.clone(), posting);
        }
    }
    inverted
}

/// string -> finite number JSON object를 파싱한다.
fn parse_string_number_object(object: &JsonMap<String, JsonValue>) -> BTreeMap<String, f64> {
    object
        .iter()
        .filter_map(|(key, value)| {
            let number = value.as_f64()?;
            number.is_finite().then_some((key.clone(), number))
        })
        .collect()
}

/// string -> string JSON object를 파싱한다.
fn parse_string_string_object(object: &JsonMap<String, JsonValue>) -> BTreeMap<String, String> {
    object
        .iter()
        .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
        .collect()
}

/// string -> string JSON object payload를 파싱한다.
fn parse_string_string_object_json(payload: &str) -> Option<BTreeMap<String, String>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    Some(parse_string_string_object(value.as_object()?))
}

/// BM25 entry JSON array를 파싱한다.
fn parse_bm25_entries_json(payload: &str) -> Option<Vec<Bm25Entry>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut entries = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        entries.push(Bm25Entry {
            id: object.get("id")?.as_str()?.trim().to_owned(),
            file_path: object.get("filePath")?.as_str()?.trim().to_owned(),
            compatible: object.get("compatible")?.as_bool()?,
        });
    }
    Some(entries)
}

/// string JSON array를 순서 보존 vector로 파싱한다.
fn parse_string_array_json(payload: &str) -> Option<Vec<String>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut strings = Vec::with_capacity(values.len());
    for value in values {
        let item = value.as_str()?.trim();
        if !item.is_empty() {
            strings.push(item.to_owned());
        }
    }
    Some(strings)
}

/// string JSON array를 index 보존 vector로 파싱한다.
fn parse_raw_string_array_json(payload: &str) -> Option<Vec<String>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut strings = Vec::with_capacity(values.len());
    for value in values {
        strings.push(value.as_str()?.to_owned());
    }
    Some(strings)
}

/// finite number JSON array를 파싱한다.
/// RAG indexing ETA input JSON을 파싱한다.
fn parse_rag_indexing_eta_input_json(payload: &str) -> Option<RagIndexingEtaInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    Some(RagIndexingEtaInput {
        now_ms: json_finite_number_field(object, "nowMs")?,
        started_at_ms: json_finite_number_field(object, "startedAtMs")?,
        total_files: json_usize_field(object, "totalFiles")?,
        completed_files: json_usize_field(object, "completedFiles")?,
        current_file_total_chunks: json_usize_field(object, "currentFileTotalChunks")?,
        current_file_embedded_chunks: json_usize_field(object, "currentFileEmbeddedChunks")?,
        total_estimated_chunks: json_usize_field(object, "totalEstimatedChunks")?,
        completed_estimated_chunks: json_usize_field(object, "completedEstimatedChunks")?,
        current_file_estimated_chunks: json_usize_field(object, "currentFileEstimatedChunks")?,
        total_planned_chunks: json_usize_field(object, "totalPlannedChunks")?,
        completed_planned_chunks: json_usize_field(object, "completedPlannedChunks")?,
        planning_complete: object.get("planningComplete")?.as_bool()?,
        completed_batch_durations_ms: parse_finite_number_array_value(
            object.get("completedBatchDurationsMs")?,
        )?,
        completed_batch_chunk_counts: parse_usize_array_value(
            object.get("completedBatchChunkCounts")?,
        )?,
        completed_file_durations_ms: parse_finite_number_array_value(
            object.get("completedFileDurationsMs")?,
        )?,
        completed_file_chunk_counts: parse_usize_array_value(
            object.get("completedFileChunkCounts")?,
        )?,
        completed_file_estimated_chunk_counts: parse_usize_array_value(
            object.get("completedFileEstimatedChunkCounts")?,
        )?,
        completed_file_actual_chunk_counts: parse_usize_array_value(
            object.get("completedFileActualChunkCounts")?,
        )?,
        completed_file_overhead_durations_ms: parse_finite_number_array_value(
            object.get("completedFileOverheadDurationsMs")?,
        )?,
        historical_ms_per_chunk: optional_finite_json_number(object.get("historicalMsPerChunk")),
        historical_chunk_estimate_ratio: optional_finite_json_number(
            object.get("historicalChunkEstimateRatio"),
        ),
        historical_variance: optional_finite_json_number(object.get("historicalVariance")),
    })
}

/// JSON object에서 required finite number field를 읽는다.
fn json_finite_number_field(object: &JsonMap<String, JsonValue>, key: &str) -> Option<f64> {
    object
        .get(key)
        .and_then(JsonValue::as_f64)
        .filter(|value| value.is_finite())
}

/// finite number JSON array瑜??뚯떛?쒕떎.
fn parse_finite_number_array_json(payload: &str) -> Option<Vec<f64>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    parse_finite_number_array_value(&value)
}

/// 숫자 JSON 배열을 non-negative 정수 배열로 파싱한다.
fn parse_non_negative_u64_array_json(payload: &str) -> Option<Vec<u64>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut numbers = Vec::with_capacity(values.len());
    for value in values {
        numbers.push(value.as_u64()?);
    }
    Some(numbers)
}

/// usize JSON array를 index 보존 vector로 파싱한다.
fn parse_usize_array_json(payload: &str) -> Option<Vec<usize>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    parse_usize_array_value(&value)
}

/// usize JSON array value를 index 보존 vector로 파싱한다.
fn parse_usize_array_value(value: &JsonValue) -> Option<Vec<usize>> {
    let values = value.as_array()?;
    let mut numbers = Vec::with_capacity(values.len());
    for value in values {
        numbers.push(usize::try_from(value.as_u64()?).ok()?);
    }
    Some(numbers)
}

/// string JSON array를 set으로 파싱한다.
fn parse_string_set_json(payload: &str) -> Option<BTreeSet<String>> {
    Some(parse_string_array_json(payload)?.into_iter().collect())
}

/// claim evidence score input JSON array를 파싱한다.
fn parse_claim_evidence_inputs_json(payload: &str) -> Option<Vec<ClaimEvidenceInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut claims = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let evidence_values = object.get("evidenceIds")?.as_array()?;
        let evidence_ids = evidence_values
            .iter()
            .filter_map(JsonValue::as_str)
            .map(str::trim)
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        claims.push(ClaimEvidenceInput {
            confidence: object.get("confidence")?.as_f64()?,
            evidence_ids,
        });
    }
    Some(claims)
}

/// local evidence match record JSON array를 파싱한다.
fn parse_local_evidence_match_records_json(payload: &str) -> Option<Vec<LocalEvidenceMatchRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let entity_confidence = finite_json_number_field(object, "entityConfidence")?;
        let match_score = finite_json_number_field(object, "matchScore")?;
        records.push(LocalEvidenceMatchRecord {
            entity_id: non_empty_json_string(object, "entityId")?,
            entity_confidence,
            match_score,
            evidence_ids: parse_string_array_value(object.get("evidenceIds")?)?,
        });
    }
    Some(records)
}

/// local evidence relation record JSON array를 파싱한다.
fn parse_local_evidence_relation_records_json(
    payload: &str,
) -> Option<Vec<LocalEvidenceRelationRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(LocalEvidenceRelationRecord {
            source_entity_id: non_empty_json_string(object, "sourceEntityId")?,
            target_entity_id: non_empty_json_string(object, "targetEntityId")?,
            confidence: finite_json_number_field(object, "confidence")?,
            evidence_ids: parse_string_array_value(object.get("evidenceIds")?)?,
        });
    }
    Some(records)
}

/// local evidence claim record JSON array를 파싱한다.
fn parse_local_evidence_claim_records_json(payload: &str) -> Option<Vec<LocalEvidenceClaimRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(LocalEvidenceClaimRecord {
            entity_ids: parse_string_array_value(object.get("entityIds")?)?,
            confidence: finite_json_number_field(object, "confidence")?,
            evidence_ids: parse_string_array_value(object.get("evidenceIds")?)?,
        });
    }
    Some(records)
}

/// evidence score JSON array를 파싱한다.
fn parse_evidence_scores_json(payload: &str) -> Option<Vec<EvidenceScoreById>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut scores = Vec::with_capacity(values.len());
    for (sequence, value) in values.iter().enumerate() {
        let object = value.as_object()?;
        let evidence_id = non_empty_json_string(object, "evidenceId")?;
        let score = clamp_unit_score(object.get("score")?.as_f64()?);
        scores.push(EvidenceScoreById {
            evidence_id,
            score,
            sequence,
        });
    }
    Some(scores)
}

/// Graph evidence lookup record JSON array를 파싱한다.
fn parse_graph_evidence_lookup_records_json(
    payload: &str,
) -> Option<Vec<GraphEvidenceLookupRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphEvidenceLookupRecord {
            id: non_empty_json_string(object, "id")?,
            file_path: non_empty_json_string(object, "filePath")?,
        });
    }
    Some(records)
}

/// Graph evidence vector entry record JSON array를 파싱한다.
fn parse_graph_evidence_entry_records_json(payload: &str) -> Option<Vec<GraphEvidenceEntryRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphEvidenceEntryRecord {
            id: non_empty_json_string(object, "id")?,
            compatible: object.get("compatible")?.as_bool()?,
        });
    }
    Some(records)
}

/// Graph mention context entity JSON array를 파싱한다.
fn parse_graph_mention_entities_json(payload: &str) -> Option<Vec<GraphMentionEntity>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphMentionEntity {
            id: non_empty_json_string(object, "id")?,
            canonical_name: non_empty_json_string(object, "canonicalName")?,
            aliases: parse_string_array_value(object.get("aliases")?)?,
            type_id: object
                .get("typeId")
                .and_then(JsonValue::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("entity")
                .to_owned(),
            description: object
                .get("description")
                .and_then(JsonValue::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
        });
    }
    Some(records)
}

/// Graph mention context relation JSON array를 파싱한다.
fn parse_graph_mention_relations_json(payload: &str) -> Option<Vec<GraphMentionRelation>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphMentionRelation {
            source_entity_id: non_empty_json_string(object, "sourceEntityId")?,
            target_entity_id: non_empty_json_string(object, "targetEntityId")?,
            relation_type_id: object
                .get("relationTypeId")
                .and_then(JsonValue::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("relation")
                .to_owned(),
            description: object
                .get("description")
                .and_then(JsonValue::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
        });
    }
    Some(records)
}

/// Graph extraction claim entity lookup JSON array를 파싱한다.
fn parse_graph_claim_entity_lookup_records_json(
    payload: &str,
) -> Option<Vec<GraphClaimEntityLookupRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphClaimEntityLookupRecord {
            name: non_empty_json_string(object, "name")?,
            entity_id: non_empty_json_string(object, "entityId")?,
        });
    }
    Some(records)
}

/// Graph extraction relation endpoint input JSON array를 파싱한다.
fn parse_graph_relation_endpoint_inputs_json(
    payload: &str,
) -> Option<Vec<GraphRelationEndpointInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphRelationEndpointInput {
            source: non_empty_json_string(object, "source")?,
            target: non_empty_json_string(object, "target")?,
        });
    }
    Some(records)
}

/// Graph extraction relation endpoint lookup JSON array를 파싱한다.
fn parse_graph_relation_endpoint_lookup_records_json(
    payload: &str,
) -> Option<Vec<GraphRelationEndpointLookupRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let entity_index = object
            .get("entityIndex")?
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())?;
        records.push(GraphRelationEndpointLookupRecord {
            name: non_empty_json_string(object, "name")?,
            entity_index,
        });
    }
    Some(records)
}

/// Graph community assignment JSON array를 파싱한다.
fn parse_graph_community_assignments_json(
    payload: &str,
) -> Option<Vec<GraphCommunityAssignmentInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphCommunityAssignmentInput {
            entity_id: non_empty_json_string(object, "entityId")?,
            community_id: json_usize_field(object, "communityId")?,
        });
    }
    Some(records)
}

/// Graph community summary relation JSON array를 파싱한다.
fn parse_graph_community_summary_relations_json(
    payload: &str,
) -> Option<Vec<GraphCommunitySummaryRelationInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphCommunitySummaryRelationInput {
            source_entity_id: non_empty_json_string(object, "sourceEntityId")?,
            target_entity_id: non_empty_json_string(object, "targetEntityId")?,
        });
    }
    Some(records)
}

/// Graph community summary claim JSON array를 파싱한다.
fn parse_graph_community_summary_claims_json(
    payload: &str,
) -> Option<Vec<GraphCommunitySummaryClaimInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphCommunitySummaryClaimInput {
            entity_ids: parse_string_array_value(object.get("entityIds")?)?,
        });
    }
    Some(records)
}

/// diverse result candidate JSON array를 파싱한다.
fn parse_diverse_result_candidates_json(payload: &str) -> Option<Vec<DiverseResultCandidate>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut candidates = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        candidates.push(DiverseResultCandidate {
            score: finite_json_number_field(object, "score")?,
            vector: parse_finite_number_array_value(object.get("vector")?)?,
            source_path: non_empty_json_string(object, "sourcePath")?,
            heading: optional_non_empty_json_string(object, "heading"),
        });
    }
    Some(candidates)
}

/// community edge record JSON array를 파싱한다.
fn parse_community_edge_records_json(payload: &str) -> Option<Vec<CommunityEdgeRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(CommunityEdgeRecord {
            source: non_empty_json_string(object, "source")?,
            target: non_empty_json_string(object, "target")?,
            weight: finite_json_number_field(object, "weight")?,
        });
    }
    Some(records)
}

/// Graph community replacement record JSON array를 파싱한다.
fn parse_graph_community_replacement_records_json(
    payload: &str,
) -> Option<Vec<GraphCommunityReplacementRecord>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphCommunityReplacementRecord {
            id: non_empty_json_string(object, "id")?,
            ontology_schema_id: non_empty_json_string(object, "ontologySchemaId")?,
        });
    }
    Some(records)
}

/// file index entry metadata JSON array를 파싱한다.
fn parse_file_index_entries_json(payload: &str) -> Option<Vec<FileIndexEntryInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut entries = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        entries.push(FileIndexEntryInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            source_mtime: object.get("sourceMtime").and_then(JsonValue::as_f64),
            source_size: object.get("sourceSize").and_then(JsonValue::as_f64),
            content_hash: object
                .get("contentHash")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            indexed_at: object.get("indexedAt").and_then(JsonValue::as_f64),
            end_line: object.get("endLine").and_then(JsonValue::as_f64),
            embedding_provider: object
                .get("embeddingProvider")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            embedding_model: object
                .get("embeddingModel")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            updated: object.get("updated").and_then(JsonValue::as_f64),
        });
    }
    Some(entries)
}

/// RAG status input JSON object를 파싱한다.
fn parse_rag_status_input_json(payload: &str) -> Option<RagStatusInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    let included_files =
        parse_rag_status_files(object.get("includedFiles").and_then(JsonValue::as_array)?)?;
    let records = parse_rag_status_records(object.get("records").and_then(JsonValue::as_array)?)?;
    let total_vault_files = usize::try_from(object.get("totalVaultFiles")?.as_u64()?).ok()?;
    let reasons = object.get("reasons")?.as_object()?;

    Some(RagStatusInput {
        included_files,
        records,
        total_vault_files,
        embedding_provider: object.get("embeddingProvider")?.as_str()?.to_owned(),
        embedding_model: object.get("embeddingModel")?.as_str()?.to_owned(),
        reasons: RagStatusReasonLabels {
            missing: reasons.get("missing")?.as_str()?.to_owned(),
            legacy: reasons.get("legacy")?.as_str()?.to_owned(),
            stale_file: reasons.get("staleFile")?.as_str()?.to_owned(),
            embedding_changed: reasons.get("embeddingChanged")?.as_str()?.to_owned(),
        },
    })
}

/// RAG status file snapshot 배열을 파싱한다.
fn parse_rag_status_files(values: &[JsonValue]) -> Option<Vec<RagStatusFileInput>> {
    let mut files = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let mtime = object.get("mtime")?.as_f64()?;
        let size = object.get("size")?.as_f64()?;
        if !mtime.is_finite() || !size.is_finite() {
            return None;
        }
        files.push(RagStatusFileInput {
            path: object.get("path")?.as_str()?.to_owned(),
            mtime,
            size,
        });
    }
    Some(files)
}

/// RAG status file index record snapshot 배열을 파싱한다.
fn parse_rag_status_records(values: &[JsonValue]) -> Option<Vec<RagStatusRecordInput>> {
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let vector_count = usize::try_from(object.get("vectorCount")?.as_u64()?).ok()?;
        records.push(RagStatusRecordInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            source_mtime: optional_finite_json_number(object.get("sourceMtime")),
            source_size: optional_finite_json_number(object.get("sourceSize")),
            content_hash: object
                .get("contentHash")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            indexed_at: optional_finite_json_number(object.get("indexedAt")),
            embedding_provider: object
                .get("embeddingProvider")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            embedding_model: object
                .get("embeddingModel")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            has_complete_metadata: object
                .get("hasCompleteMetadata")
                .and_then(JsonValue::as_bool),
            vector_count,
        });
    }
    Some(records)
}

/// `GraphRAG` run file selection input `JSON` object를 파싱한다.
fn parse_graph_rag_run_file_selection_input_json(
    payload: &str,
) -> Option<GraphRagRunFileSelectionInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    Some(GraphRagRunFileSelectionInput {
        mode: parse_graph_rag_run_file_selection_mode(object.get("mode")?.as_str()?)?,
        failed_file_paths: parse_graph_rag_status_string_array(
            object.get("failedFilePaths")?.as_array()?,
        )?,
        stale_file_paths: parse_graph_rag_status_string_array(
            object.get("staleFilePaths")?.as_array()?,
        )?,
        record_file_paths: parse_graph_rag_run_file_path_inputs(
            object.get("recordFilePaths")?.as_array()?,
        )?,
        indexed_file_paths: parse_graph_rag_run_file_path_inputs(
            object.get("indexedFilePaths")?.as_array()?,
        )?,
        max_files_per_run: usize::try_from(object.get("maxFilesPerRun")?.as_u64()?).ok()?,
    })
}

/// `GraphRAG` run mode wire-format을 파싱한다.
fn parse_graph_rag_run_file_selection_mode(value: &str) -> Option<GraphRagRunFileSelectionMode> {
    match value {
        "failed" => Some(GraphRagRunFileSelectionMode::Failed),
        "stale" => Some(GraphRagRunFileSelectionMode::Stale),
        "full" => Some(GraphRagRunFileSelectionMode::Full),
        _ => None,
    }
}

/// `GraphRAG` run file path input 배열을 파싱한다.
fn parse_graph_rag_run_file_path_inputs_json(
    payload: &str,
) -> Option<Vec<GraphRagRunFilePathInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    parse_graph_rag_run_file_path_inputs(value.as_array()?)
}

/// `GraphRAG` run file path input JSON array value를 파싱한다.
fn parse_graph_rag_run_file_path_inputs(
    values: &[JsonValue],
) -> Option<Vec<GraphRagRunFilePathInput>> {
    let mut rows = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        rows.push(GraphRagRunFilePathInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            processable: object.get("processable")?.as_bool()?,
        });
    }
    Some(rows)
}

/// `GraphRAG` status input `JSON` object를 파싱한다.
fn parse_graph_rag_status_input_json(payload: &str) -> Option<GraphRagStatusInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    let graph_rag_max_files_per_run = object.get("graphRagMaxFilesPerRun")?.as_f64()?;
    if !graph_rag_max_files_per_run.is_finite() {
        return None;
    }
    Some(GraphRagStatusInput {
        graph_rag_enabled: object.get("graphRagEnabled")?.as_bool()?,
        is_running: object.get("isRunning")?.as_bool()?,
        schema_error_count: usize::try_from(object.get("schemaErrorCount")?.as_u64()?).ok()?,
        total_candidate_files: usize::try_from(object.get("totalCandidateFiles")?.as_u64()?)
            .ok()?,
        graph_rag_max_files_per_run,
        graph_rag_model: object.get("graphRagModel")?.as_str()?.to_owned(),
        ontology_schema_id: object.get("ontologySchemaId")?.as_str()?.to_owned(),
        ontology_version: u32::try_from(object.get("ontologyVersion")?.as_u64()?).ok()?,
        extraction_contract_version: u32::try_from(
            object.get("extractionContractVersion")?.as_u64()?,
        )
        .ok()?,
        file_records: parse_graph_rag_status_file_records(object.get("fileRecords")?.as_array()?)?,
        evidence: parse_graph_rag_status_evidence(object.get("evidence")?.as_array()?)?,
        rejected_fact_file_paths: parse_graph_rag_status_string_array(
            object.get("rejectedFactFilePaths")?.as_array()?,
        )?,
        pending_merge_count: usize::try_from(object.get("pendingMergeCount")?.as_u64()?).ok()?,
        cache_records: parse_graph_rag_status_cache_records(
            object.get("cacheRecords")?.as_array()?,
        )?,
        entries: parse_graph_rag_status_entries(object.get("entries")?.as_array()?)?,
    })
}

/// `GraphRAG` status file record 배열을 파싱한다.
fn parse_graph_rag_status_file_records(
    values: &[JsonValue],
) -> Option<Vec<GraphRagStatusFileRecordInput>> {
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphRagStatusFileRecordInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            vector_count: usize::try_from(object.get("vectorCount")?.as_u64()?).ok()?,
        });
    }
    Some(records)
}

/// `GraphRAG` status file snapshot record 배열 payload를 파싱한다.
fn parse_graph_rag_status_file_snapshot_records_json(
    payload: &str,
) -> Option<Vec<GraphRagStatusFileSnapshotRecordInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphRagStatusFileSnapshotRecordInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            vector_count: usize::try_from(object.get("vectorCount")?.as_u64()?).ok()?,
            processable: object.get("processable")?.as_bool()?,
        });
    }
    Some(records)
}

/// `GraphRAG` status entry snapshot 후보 배열 payload를 파싱한다.
fn parse_graph_rag_status_entry_snapshot_inputs_json(
    payload: &str,
) -> Option<Vec<GraphRagStatusEntrySnapshotInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut entries = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        entries.push(GraphRagStatusEntrySnapshotInput {
            id: non_empty_json_string(object, "id")?,
            file_path: non_empty_json_string(object, "filePath")?,
            processable: object.get("processable")?.as_bool()?,
        });
    }
    Some(entries)
}

/// `GraphRAG` status evidence 배열을 파싱한다.
fn parse_graph_rag_status_evidence(
    values: &[JsonValue],
) -> Option<Vec<GraphRagStatusEvidenceInput>> {
    let mut evidence = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        evidence.push(GraphRagStatusEvidenceInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            entry_id: object.get("entryId")?.as_str()?.to_owned(),
            content_hash: object.get("contentHash")?.as_str()?.to_owned(),
            extraction_model_key: object.get("extractionModelKey")?.as_str()?.to_owned(),
            processable: object.get("processable")?.as_bool()?,
        });
    }
    Some(evidence)
}

/// `GraphRAG` status cache record 배열을 파싱한다.
fn parse_graph_rag_status_cache_records(
    values: &[JsonValue],
) -> Option<Vec<GraphRagStatusCacheInput>> {
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        records.push(GraphRagStatusCacheInput {
            entry_id: object.get("entryId")?.as_str()?.to_owned(),
            content_hash: object.get("contentHash")?.as_str()?.to_owned(),
            extraction_model_key: object.get("extractionModelKey")?.as_str()?.to_owned(),
            ontology_schema_id: object.get("ontologySchemaId")?.as_str()?.to_owned(),
            ontology_version: u32::try_from(object.get("ontologyVersion")?.as_u64()?).ok()?,
            extraction_contract_version: u32::try_from(
                object.get("extractionContractVersion")?.as_u64()?,
            )
            .ok()?,
        });
    }
    Some(records)
}

/// `GraphRAG` status vector entry 배열을 파싱한다.
fn parse_graph_rag_status_entries(values: &[JsonValue]) -> Option<Vec<GraphRagStatusEntryInput>> {
    let mut entries = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        entries.push(GraphRagStatusEntryInput {
            id: object.get("id")?.as_str()?.to_owned(),
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            content_hash: object
                .get("contentHash")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            text: object.get("text")?.as_str()?.to_owned(),
        });
    }
    Some(entries)
}

/// `GraphRAG` status string 배열을 파싱한다.
fn parse_graph_rag_status_string_array(values: &[JsonValue]) -> Option<Vec<String>> {
    let mut strings = Vec::with_capacity(values.len());
    for value in values {
        strings.push(value.as_str()?.to_owned());
    }
    Some(strings)
}

/// `GraphRAG` entity resolution plan 입력 `JSON` object를 파싱한다.
fn parse_entity_resolution_input_json(payload: &str) -> Option<EntityResolutionInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    let auto_merge_threshold = finite_json_number_field(object, "autoMergeThreshold")?;
    let pending_merge_threshold = finite_json_number_field(object, "pendingMergeThreshold")?;
    Some(EntityResolutionInput {
        ontology_schema_id: non_empty_json_string(object, "ontologySchemaId")?,
        type_id: non_empty_json_string(object, "typeId")?,
        candidate_entity_id: non_empty_json_string(object, "candidateEntityId")?,
        auto_merge_threshold,
        pending_merge_threshold,
        candidates: parse_entity_resolution_candidates_json(object.get("candidates")?)?,
    })
}

/// `GraphRAG` entity resolution 후보 배열을 파싱한다.
fn parse_entity_resolution_candidates_json(
    value: &JsonValue,
) -> Option<Vec<EntityResolutionCandidate>> {
    let values = value.as_array()?;
    let mut candidates = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        candidates.push(EntityResolutionCandidate {
            entity_id: non_empty_json_string(object, "entityId")?,
            ontology_schema_id: non_empty_json_string(object, "ontologySchemaId")?,
            type_id: non_empty_json_string(object, "typeId")?,
            score: finite_json_number_field(object, "score")?,
        });
    }
    Some(candidates)
}

/// RAG query result score plan 입력 `JSON` object를 파싱한다.
fn parse_query_result_score_input_json(payload: &str) -> Option<QueryResultScoreInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    Some(QueryResultScoreInput {
        cosine_score: finite_json_number_field(object, "cosineScore")?,
        bm25_score: finite_json_number_field(object, "bm25Score")?,
        bm25_weight: finite_json_number_field(object, "bm25Weight")?,
        has_bm25: object.get("hasBm25")?.as_bool()?,
        source_scores: parse_source_metric_map(object.get("sourceScores")?)?,
        source_ranks: parse_source_metric_map(object.get("sourceRanks")?)?,
        retrieval_sources: parse_graph_rag_status_string_array(
            object.get("retrievalSources")?.as_array()?,
        )?,
    })
}

/// source metric JSON object를 string/finite number map으로 파싱한다.
fn parse_source_metric_map(value: &JsonValue) -> Option<BTreeMap<String, f64>> {
    let object = value.as_object()?;
    let mut map = BTreeMap::<String, f64>::new();
    for (source, value) in object {
        let score = value.as_f64()?;
        if !score.is_finite() {
            return None;
        }
        map.insert(source.clone(), score);
    }
    Some(map)
}

/// `GraphRAG` entity merge input `JSON` object를 파싱한다.
fn parse_graph_entity_merge_input_json(payload: &str) -> Option<GraphEntityMergeInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    let confidence = object.get("confidence")?.as_f64()?;
    let updated_at = object.get("updatedAt")?.as_f64()?;
    if !confidence.is_finite() || !updated_at.is_finite() {
        return None;
    }
    Some(GraphEntityMergeInput {
        aliases: parse_graph_rag_status_string_array(object.get("aliases")?.as_array()?)?,
        description: object.get("description")?.as_str()?.to_owned(),
        confidence,
        evidence_ids: parse_graph_rag_status_string_array(object.get("evidenceIds")?.as_array()?)?,
        updated_at,
    })
}

/// `GraphRAG` extraction cache key `JSON` object를 파싱한다.
fn parse_graph_extraction_cache_key_json(payload: &str) -> Option<GraphExtractionCacheKey> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    parse_graph_extraction_cache_key_value(&value)
}

/// `GraphRAG` extraction cache key value를 파싱한다.
fn parse_graph_extraction_cache_key_value(value: &JsonValue) -> Option<GraphExtractionCacheKey> {
    let object = value.as_object()?;
    Some(GraphExtractionCacheKey {
        entry_id: object.get("entryId")?.as_str()?.to_owned(),
        content_hash: object.get("contentHash")?.as_str()?.to_owned(),
        extraction_model_key: object.get("extractionModelKey")?.as_str()?.to_owned(),
        ontology_schema_id: object.get("ontologySchemaId")?.as_str()?.to_owned(),
        ontology_version: u32::try_from(object.get("ontologyVersion")?.as_u64()?).ok()?,
        extraction_contract_version: u32::try_from(
            object.get("extractionContractVersion")?.as_u64()?,
        )
        .ok()?,
    })
}

/// RAG file type summary input JSON array를 파싱한다.
fn parse_rag_file_type_inputs_json(payload: &str) -> Option<Vec<RagFileTypeInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut files = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        files.push(RagFileTypeInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            extension: object
                .get("extension")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
            indexable: object.get("indexable")?.as_bool()?,
            recommendation_reason: object
                .get("recommendationReason")
                .and_then(JsonValue::as_str)
                .map(ToOwned::to_owned),
        });
    }
    Some(files)
}

/// Prompt 라이브러리 summary 입력 JSON 배열을 파싱한다.
fn parse_prompt_library_inputs_json(payload: &str) -> Option<Vec<PromptLibrarySummaryInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut inputs = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        inputs.push(PromptLibrarySummaryInput {
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            heading: object
                .get("heading")
                .and_then(JsonValue::as_str)
                .map_or("", str::trim)
                .to_owned(),
            text: object
                .get("text")
                .and_then(JsonValue::as_str)
                .map_or("", str::trim)
                .to_owned(),
        });
    }
    Some(inputs)
}

/// RAG file eligibility input JSON array를 파싱한다.
fn parse_rag_file_eligibility_inputs_json(payload: &str) -> Option<Vec<RagFileEligibilityInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut files = Vec::with_capacity(values.len());
    for (index, value) in values.iter().enumerate() {
        let object = value.as_object()?;
        files.push(RagFileEligibilityInput {
            index,
            file_path: object.get("filePath")?.as_str()?.to_owned(),
            file_name: object.get("fileName")?.as_str()?.to_owned(),
            extension: object
                .get("extension")
                .and_then(JsonValue::as_str)
                .unwrap_or_default()
                .to_owned(),
            size: object.get("size")?.as_u64()?,
        });
    }
    Some(files)
}

/// RAG unknown text probe input JSON array를 파싱한다.
fn parse_rag_file_text_probe_inputs_json(payload: &str) -> Option<Vec<RagFileTextProbeInput>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut probes = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        probes.push(RagFileTextProbeInput {
            index: usize::try_from(object.get("index")?.as_u64()?).ok()?,
            readable: object.get("readable")?.as_bool()?,
            sample: object
                .get("sample")
                .and_then(JsonValue::as_str)
                .unwrap_or_default()
                .to_owned(),
        });
    }
    Some(probes)
}

/// source reference plan JSON array를 파싱한다.
fn parse_source_references_json(payload: &str) -> Option<Vec<SourceReferencePlan>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut references = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let kind = match object.get("kind")?.as_str()? {
            "wikilink" => SourceReferenceKind::Wikilink,
            "markdown-link" => SourceReferenceKind::MarkdownLink,
            "source-id" => SourceReferenceKind::SourceId,
            _ => return None,
        };
        let aliases = object
            .get("aliases")?
            .as_array()?
            .iter()
            .map(|value| value.as_str().map(ToOwned::to_owned))
            .collect::<Option<Vec<_>>>()?;
        references.push(SourceReferencePlan {
            label: object.get("label")?.as_str()?.to_owned(),
            target: object.get("target")?.as_str()?.to_owned(),
            kind,
            aliases,
        });
    }
    Some(references)
}

/// source validation wrapper 입력을 Rust에서 선택한다.
fn plan_source_validation_inputs(
    references: &[SourceReferencePlan],
    citation_ids: &[String],
    citation_paths: &[String],
    citation_statuses: &[String],
) -> Option<SourceValidationInputPlan> {
    if citation_ids.len() != citation_paths.len() || citation_ids.len() != citation_statuses.len() {
        return None;
    }

    let mut verified_citation_ids = Vec::<String>::new();
    let mut verified_paths = Vec::<String>::new();
    for ((id, path), status) in citation_ids
        .iter()
        .zip(citation_paths.iter())
        .zip(citation_statuses.iter())
    {
        if status == "verified" {
            verified_citation_ids.push(id.clone());
            verified_paths.push(path.clone());
        }
    }

    let mut alias_candidates = Vec::<String>::new();
    for reference in references {
        if reference.kind == SourceReferenceKind::SourceId {
            continue;
        }
        alias_candidates.extend(reference.aliases.iter().cloned());
    }

    Some(SourceValidationInputPlan {
        verified_citation_ids,
        verified_paths,
        alias_candidates,
    })
}

/// reranker JSON object에서 허용된 ranked id만 순서 보존 dedupe로 추출한다.
fn extract_allowed_rerank_ids(value: &JsonValue, allowed_ids: &BTreeSet<String>) -> Vec<String> {
    let Some(values) = value
        .as_object()
        .and_then(|object| object.get("rankedIds"))
        .and_then(JsonValue::as_array)
    else {
        return Vec::new();
    };

    let mut seen = BTreeSet::new();
    let mut ranked_ids = Vec::new();
    for value in values {
        let Some(id) = value.as_str().map(str::trim).filter(|id| !id.is_empty()) else {
            continue;
        };
        if allowed_ids.contains(id) && seen.insert(id.to_owned()) {
            ranked_ids.push(id.to_owned());
        }
    }
    ranked_ids
}

/// LLM reranker message candidate JSON array를 파싱한다.
fn parse_rerank_message_candidates_json(payload: &str) -> Option<Vec<RerankMessageCandidate>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut candidates = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        candidates.push(RerankMessageCandidate {
            id: object.get("id")?.as_str()?.to_owned(),
            source_path: object.get("sourcePath")?.as_str()?.to_owned(),
            heading: object.get("heading")?.as_str()?.to_owned(),
            text: object.get("text")?.as_str()?.to_owned(),
        });
    }
    Some(candidates)
}

/// structural link edge JSON array를 파싱한다.
fn parse_structural_link_edges_json(payload: &str) -> Option<Vec<StructuralLinkEdge>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut edges = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        let source_path = non_empty_json_string(object, "sourcePath")?;
        let target_path = non_empty_json_string(object, "targetPath")?;
        edges.push(StructuralLinkEdge {
            source_path,
            target_path,
        });
    }
    Some(edges)
}

/// structural heading seed JSON array를 파싱한다.
fn parse_structural_heading_seeds_json(payload: &str) -> Option<Vec<StructuralHeadingSeed>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut seeds = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        seeds.push(StructuralHeadingSeed {
            id: non_empty_json_string(object, "id")?,
            file_path: non_empty_json_string(object, "filePath")?,
            start_line: json_usize_field(object, "startLine")?,
            end_line: json_usize_field(object, "endLine")?,
            heading: optional_non_empty_json_string(object, "heading"),
        });
    }
    Some(seeds)
}

/// structural entry JSON array를 파싱한다.
fn parse_structural_entries_json(payload: &str) -> Option<Vec<StructuralEntry>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut entries = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        entries.push(StructuralEntry {
            id: non_empty_json_string(object, "id")?,
            file_path: non_empty_json_string(object, "filePath")?,
            start_line: json_usize_field(object, "startLine")?,
            heading: optional_non_empty_json_string(object, "heading"),
            compatible: object.get("compatible")?.as_bool()?,
        });
    }
    Some(entries)
}

/// structural heading JSON array를 파싱한다.
fn parse_structural_headings_json(payload: &str) -> Option<Vec<StructuralHeading>> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let values = value.as_array()?;
    let mut headings = Vec::with_capacity(values.len());
    for value in values {
        let object = value.as_object()?;
        headings.push(StructuralHeading {
            file_path: non_empty_json_string(object, "filePath")?,
            start_line: json_usize_field(object, "startLine")?,
            level: json_usize_field(object, "level")?,
        });
    }
    Some(headings)
}

/// JSON object에서 non-empty string field를 읽는다.
fn non_empty_json_string(object: &JsonMap<String, JsonValue>, key: &str) -> Option<String> {
    let value = object.get(key)?.as_str()?.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

/// JSON object에서 finite number field를 읽는다.
fn finite_json_number_field(object: &JsonMap<String, JsonValue>, key: &str) -> Option<f64> {
    object
        .get(key)?
        .as_f64()
        .filter(|number| number.is_finite())
}

/// JSON value에서 string array를 읽고 빈 문자열을 제거한다.
fn parse_string_array_value(value: &JsonValue) -> Option<Vec<String>> {
    let values = value.as_array()?;
    let mut strings = Vec::with_capacity(values.len());
    for value in values {
        let item = value.as_str()?.trim();
        if !item.is_empty() {
            strings.push(item.to_owned());
        }
    }
    Some(strings)
}

/// JSON value에서 finite number array를 읽는다.
fn parse_finite_number_array_value(value: &JsonValue) -> Option<Vec<f64>> {
    let values = value.as_array()?;
    let mut numbers = Vec::with_capacity(values.len());
    for value in values {
        let number = value.as_f64()?;
        if !number.is_finite() {
            return None;
        }
        numbers.push(number);
    }
    Some(numbers)
}

/// JSON object에서 optional non-empty string field를 읽는다.
fn optional_non_empty_json_string(
    object: &JsonMap<String, JsonValue>,
    key: &str,
) -> Option<String> {
    object
        .get(key)
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// JSON object에서 usize field를 읽는다.
fn json_usize_field(object: &JsonMap<String, JsonValue>, key: &str) -> Option<usize> {
    usize::try_from(object.get(key)?.as_u64()?).ok()
}

/// seen set과 함께 string을 순서 보존 dedupe로 추가한다.
fn push_unique_string_with_seen(
    values: &mut Vec<String>,
    seen: &mut BTreeSet<String>,
    value: String,
) {
    if value.is_empty() || !seen.insert(value.clone()) {
        return;
    }
    values.push(value);
}

/// mention 후보 배열을 `JSON` 문자열로 serialize한다.
fn serialize_mention_candidates_json(candidates: &[MentionCandidate]) -> String {
    let body = candidates
        .iter()
        .map(|candidate| {
            format!(
                "{{\"raw\":\"{}\",\"name\":\"{}\"}}",
                escape_json_string(&candidate.raw),
                escape_json_string(&candidate.name),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// deterministic `GraphRAG` query plan을 `JSON` 문자열로 serialize한다.
fn serialize_graph_query_plan_json(
    query_type: &str,
    query_mode: &str,
    traversal_depth: usize,
    evidence_first: bool,
    entity_hints: &[String],
) -> String {
    format!(
        "{{\"type\":\"{}\",\"queryMode\":\"{}\",\"traversalDepth\":{},\"evidenceFirst\":{},\"entityHints\":{}}}",
        escape_json_string(query_type),
        escape_json_string(query_mode),
        traversal_depth,
        evidence_first,
        serialize_string_array_json(entity_hints),
    )
}

/// Graph query execution plan을 JSON 문자열로 serialize한다.
fn serialize_graph_query_execution_plan_json(plan: &GraphQueryExecutionPlan) -> String {
    format!(
        "{{\"action\":\"{}\",\"requiresPlanner\":{}}}",
        escape_json_string(plan.action),
        plan.requires_planner,
    )
}

/// `GraphRAG` planner JSON object를 normalized query plan JSON으로 serialize한다.
fn serialize_normalized_graph_query_plan_from_object(
    object: &JsonMap<String, JsonValue>,
) -> String {
    let query_type = normalize_graph_query_plan_type(object);
    let query_mode = normalize_graph_query_mode(object);
    let traversal_depth = normalize_graph_query_traversal_depth(object);
    let evidence_first = object
        .get("evidenceFirst")
        .and_then(JsonValue::as_bool)
        .unwrap_or(false);
    let entity_hints = normalize_graph_query_entity_hints(object);

    serialize_graph_query_plan_json(
        query_type,
        query_mode,
        traversal_depth,
        evidence_first,
        &entity_hints,
    )
}

/// `GraphRAG` planner type field를 허용 값으로 정규화한다.
fn normalize_graph_query_plan_type(object: &JsonMap<String, JsonValue>) -> &'static str {
    match object.get("type").and_then(JsonValue::as_str) {
        Some("factual") => "factual",
        Some("relational") => "relational",
        Some("thematic") => "thematic",
        Some("comparative") => "comparative",
        Some("source-seeking") => "source-seeking",
        _ => "ordinary-rag",
    }
}

/// `GraphRAG` planner queryMode field를 허용 값으로 정규화한다.
fn normalize_graph_query_mode(object: &JsonMap<String, JsonValue>) -> &'static str {
    match object.get("queryMode").and_then(JsonValue::as_str) {
        Some("global") => "global",
        Some("hybrid") => "hybrid",
        Some("none") => "none",
        _ => "local",
    }
}

/// `GraphRAG` planner traversalDepth field를 non-negative integer로 정규화한다.
fn normalize_graph_query_traversal_depth(object: &JsonMap<String, JsonValue>) -> usize {
    let Some(value) = object.get("traversalDepth") else {
        return 1;
    };
    if let Some(depth) = value.as_u64() {
        return usize::try_from(depth).unwrap_or(usize::MAX);
    }
    let Some(depth) = value.as_f64() else {
        return 1;
    };
    if !depth.is_finite() || depth <= 0.0 {
        return 0;
    }
    let floored = depth.floor();
    format!("{floored:.0}")
        .parse::<usize>()
        .unwrap_or(usize::MAX)
}

/// `GraphRAG` planner entityHints field에서 non-empty string만 추출한다.
fn normalize_graph_query_entity_hints(object: &JsonMap<String, JsonValue>) -> Vec<String> {
    let Some(values) = object.get("entityHints").and_then(JsonValue::as_array) else {
        return Vec::new();
    };
    values
        .iter()
        .filter_map(JsonValue::as_str)
        .map(str::trim)
        .filter(|hint| !hint.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

/// Graph prune plan을 JSON 문자열로 serialize한다.
fn serialize_graph_prune_plan_json(plan: &GraphPrunePlan) -> String {
    format!(
        "{{\"deletedEvidenceIndices\":{},\"deletedEntityIndices\":{},\"updatedEntityIndices\":{},\"updatedEntityEvidenceIndices\":{},\"deletedRelationIndices\":{},\"updatedRelationIndices\":{},\"updatedRelationEvidenceIndices\":{},\"deletedClaimIndices\":{},\"updatedClaimIndices\":{},\"updatedClaimEntityIndices\":{},\"updatedClaimRelationIndices\":{},\"updatedClaimEvidenceIndices\":{},\"deletedCommunityIndices\":{},\"deletedRejectedFactIndices\":{},\"deletedExtractionCacheIndices\":{},\"deletedPendingMergeIndices\":{}}}",
        serialize_usize_array_json(&plan.deleted_evidence),
        serialize_usize_array_json(&plan.deleted_entities),
        serialize_usize_array_json(&plan.updated_entities),
        serialize_nested_usize_array_json(&plan.updated_entity_evidence),
        serialize_usize_array_json(&plan.deleted_relations),
        serialize_usize_array_json(&plan.updated_relations),
        serialize_nested_usize_array_json(&plan.updated_relation_evidence),
        serialize_usize_array_json(&plan.deleted_claims),
        serialize_usize_array_json(&plan.updated_claims),
        serialize_nested_usize_array_json(&plan.updated_claim_entities),
        serialize_nested_usize_array_json(&plan.updated_claim_relations),
        serialize_nested_usize_array_json(&plan.updated_claim_evidence),
        serialize_usize_array_json(&plan.deleted_communities),
        serialize_usize_array_json(&plan.deleted_rejected_facts),
        serialize_usize_array_json(&plan.deleted_extraction_cache),
        serialize_usize_array_json(&plan.deleted_pending_merges),
    )
}

/// usize 배열을 JSON number array로 serialize한다.
fn serialize_usize_array_json(values: &[usize]) -> String {
    let body = values
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// optional index plan을 JSON object로 serialize한다.
fn serialize_optional_index_plan_json(index: Option<usize>) -> String {
    index.map_or_else(
        || "{\"index\":null}".to_owned(),
        |index| format!("{{\"index\":{index}}}"),
    )
}

/// folder mention file plan을 JSON object로 serialize한다.
fn serialize_folder_mention_file_plan_json(plan: &FolderMentionFilePlan) -> String {
    format!(
        "{{\"indices\":{},\"partial\":{},\"matchedCount\":{},\"limitReason\":\"{}\"}}",
        serialize_usize_array_json(&plan.indices),
        if plan.partial { "true" } else { "false" },
        plan.matched_count,
        plan.limit_reason,
    )
}

/// 중첩 usize 배열을 JSON number matrix로 serialize한다.
fn serialize_nested_usize_array_json(values: &[Vec<usize>]) -> String {
    let body = values
        .iter()
        .map(|row| serialize_usize_array_json(row))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// community detection plan을 JSON 문자열로 serialize한다.
fn serialize_community_detection_plan_json(plan: &CommunityDetectionPlan) -> String {
    let assignments = plan
        .assignments
        .iter()
        .map(|assignment| {
            format!(
                "{{\"entityId\":\"{}\",\"communityId\":{}}}",
                escape_json_string(&assignment.entity_id),
                assignment.community_id,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"assignmentsById\":[{assignments}],\"communityIds\":{},\"modularity\":{}}}",
        serialize_usize_array_json(&plan.community_ids),
        plan.modularity,
    )
}

/// community edge record를 JSON 문자열로 serialize한다.
fn serialize_community_edge_records_json(edges: &[CommunityEdgeRecord]) -> String {
    let body = edges
        .iter()
        .map(|edge| {
            format!(
                "{{\"source\":\"{}\",\"target\":\"{}\",\"weight\":{}}}",
                escape_json_string(&edge.source),
                escape_json_string(&edge.target),
                edge.weight,
            )
        })
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
    if tokens.len() <= DEDUPE_LINEAR_SCAN_LIMIT {
        return dedupe_in_order_linear(tokens);
    }

    let mut deduped = Vec::with_capacity(tokens.len());
    let mut seen = HashSet::with_capacity(tokens.len());
    for token in tokens {
        if seen.contains(&token) {
            continue;
        }
        seen.insert(token.clone());
        deduped.push(token);
    }
    deduped
}

/// 작은 token 목록에서는 추가 할당 없이 첫 출현 순서를 보존하면서 중복을 제거한다.
fn dedupe_in_order_linear(tokens: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::with_capacity(tokens.len());
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
        BM25_B, BM25_K1, Bm25RuntimeIndex, Bm25SearchScore, IvfRuntimeIndex, JsonValue, SOURCE_ANN,
        SOURCE_BM25, SOURCE_GRAPH_EVIDENCE, SOURCE_STRUCTURAL, SOURCE_VECTOR, VectorRuntimeIndex,
        accumulate_token_frequencies, aggregate_graph_edges_flat, analyze_retrieval_sources,
        assign_vector_clusters, bm25_score_pairs, build_initial_centroids, chunk_markdown,
        chunk_plain_text, classify_mcp_tool_error_json, cosine_similarity,
        count_files_by_extensions_json, count_keyword_matches, create_content_hash,
        create_entity_id, create_graph_id, dedupe_in_order, detect_communities_flat,
        detect_communities_from_edges_json, extract_json_object_text, extract_vault_links_json,
        find_mentioned_entity_matches, format_mcp_json, get_mcp_connection_state_rust,
        hybrid_score_or_nan, is_excluded_ext_json, is_excluded_path,
        is_graph_extraction_cache_hit_json, is_mcp_tool_name_available,
        is_mcp_tool_result_empty_json, is_relevant_result, is_same_graph_entity_pair,
        normalize_entity_name, normalize_extracted_graph_payload_json,
        normalize_graph_confidence_or_default, normalize_graph_name,
        normalize_mcp_tool_result_json, parse_extracted_graph_payload_json,
        parse_mcp_tool_arguments_json, parse_mention_candidates_json,
        plan_assistant_response_classification_json, plan_bm25_candidate_resolution_json,
        plan_bm25_hit_lookup_json, plan_bm25_index_add_document_json,
        plan_bm25_index_remove_document_json, plan_bm25_index_remove_source_json,
        plan_bm25_search_json, plan_bm25_source_lookups_json, plan_chat_context_mentions_json,
        plan_chat_messages_json, plan_chat_meta_json, plan_chat_save_metadata_json,
        plan_claim_evidence_scores_json, plan_context_budget_append_json,
        plan_context_graph_verification_json, plan_context_sources_json,
        plan_diverse_result_indices_json, plan_entity_resolution_json,
        plan_evidence_candidate_order_json, plan_file_index_records_json,
        plan_folder_mention_file_indices_json, plan_graph_claim_entity_ids_json,
        plan_graph_community_replacement_delete_ids_json, plan_graph_community_summary_groups_json,
        plan_graph_deletion_indices_json, plan_graph_edge_records_json,
        plan_graph_entity_merge_json, plan_graph_evidence_candidate_lookup_json,
        plan_graph_evidence_entry_candidates_json, plan_graph_extraction_type_validation_json,
        plan_graph_mention_context_json, plan_graph_query_execution_json, plan_graph_query_json,
        plan_graph_query_response_json, plan_graph_rag_markdown_file_paths_json,
        plan_graph_rag_run_file_selection_json, plan_graph_rag_status_entry_lookups_json,
        plan_graph_rag_status_entry_snapshot_json, plan_graph_rag_status_file_snapshot_json,
        plan_graph_rag_status_json, plan_graph_rag_unsupported_prune_paths_json,
        plan_graph_relation_endpoint_indices_json, plan_graph_schema_community_indices_json,
        plan_graph_schema_relation_indices_json, plan_index_pending_files_json,
        plan_local_evidence_scores_json, plan_mcp_server_candidates_json,
        plan_merged_retrieval_candidates, plan_merged_retrieval_candidates_by_entry_id,
        plan_query_result_score_json, plan_rag_file_content_probe_indices_json,
        plan_rag_file_indexability_json, plan_rag_file_type_summary_json,
        plan_rag_indexing_eta_json, plan_rag_status_json, plan_reference_file_indices_json,
        plan_rerank_messages_json, plan_rerank_response_json, plan_rerank_result_order_json,
        plan_source_references_json, plan_source_validation_inputs_json,
        plan_source_validation_warnings_json, plan_structural_heading_neighbors_json,
        plan_structural_linked_paths_json, plan_vault_link_candidates_json,
        plan_vault_link_fallback_index_json, plan_vector_store_add_json,
        plan_vector_store_lookup_by_file_paths_json, plan_vector_store_lookup_by_ids_json,
        plan_vector_store_remove_file_json, plan_vector_store_replace_file_json,
        plan_vector_store_stats_json, prune_graph_indexes_json, rank_top_k_pairs, recall_at_k,
        recompute_centroids, rewrite_graph_entity_references_json, rrf_score_or_nan,
        sanitize_graph_id_part, score_entity_match_or_nan, score_local_evidence_pairs,
        select_diverse_indices, select_relevant_result_indices, should_append_mcp_path_hint_rust,
        should_rebuild_graph_runtime_for_graph_status, token_frequencies_json, tokenize,
        validate_mcp_json, validate_ontology_relation, validate_ontology_schema_json,
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

    /// BM25 frequency 누적은 total token 수와 token별 중복 횟수를 한 번에 계산해야 한다.
    #[test]
    fn accumulate_token_frequencies_counts_total_and_terms() {
        let (total_tokens, frequencies) =
            accumulate_token_frequencies(tokenize("OpenRouter OpenRouter freeLLMApi"));

        assert_eq!(total_tokens, 10, "전체 tokenizer output 수를 보존해야 한다");
        assert_eq!(
            frequencies.get("openrouter"),
            Some(&2),
            "compound token frequency를 보존해야 한다",
        );
        assert_eq!(
            frequencies.get("api"),
            Some(&1),
            "camel-case segment frequency를 보존해야 한다",
        );
    }

    /// 대형 vault 인덱싱에서는 token dedupe가 unique token 수에 대해 이차 지연을 만들면 안 된다.
    #[test]
    fn dedupe_in_order_keeps_large_unique_token_sets_under_latency_budget() {
        let tokens = (0..20_000_usize)
            .map(|index| format!("token-{index}"))
            .collect::<Vec<_>>();

        let started = std::time::Instant::now();
        let deduped = dedupe_in_order(tokens);
        let elapsed = started.elapsed();
        let latency_budget = if cfg!(debug_assertions) {
            std::time::Duration::from_secs(1)
        } else {
            std::time::Duration::from_millis(100)
        };

        assert_eq!(
            deduped.len(),
            20_000,
            "unique token은 손실 없이 보존해야 한다"
        );
        assert!(
            elapsed <= latency_budget,
            "dedupe는 대형 token set에서 latency budget 안에 끝나야 한다: elapsed={elapsed:?}, budget={latency_budget:?}",
        );
    }

    /// BM25 index mutation/search plan은 add, replace, source prune 계약을 보존해야 한다.
    #[test]
    fn bm25_index_mutation_and_search_are_planned_in_rust() {
        let empty = r#"{"tokenizerVersion":2,"inverted":{},"docLengths":{},"docSources":{},"totalDocs":0,"avgDocLength":1}"#;
        let with_api = plan_bm25_index_add_document_json(
            empty,
            "api.md::0",
            "OpenRouter API access key",
            "api.md",
            2,
        );
        assert!(
            with_api.contains(r#""openrouter":{"api.md::0":1}"#),
            "OpenRouter compound token posting이 필요하다: {with_api}",
        );
        assert!(
            with_api.contains(r#""docLengths":{"api.md::0":6}"#),
            "문서 token length가 필요하다: {with_api}",
        );

        let with_both = plan_bm25_index_add_document_json(
            &with_api,
            "other.md::0",
            "Ollama local model",
            "other.md",
            2,
        );
        assert_eq!(
            plan_bm25_search_json(&with_both, "open router"),
            r#"[{"docId":"api.md::0","score":1.219939037785504}]"#,
        );

        let replaced = plan_bm25_index_add_document_json(
            &with_both,
            "api.md::0",
            "Ollama remote endpoint",
            "api.md",
            2,
        );
        assert_eq!(plan_bm25_search_json(&replaced, "open router"), "[]");
        assert_eq!(
            plan_bm25_index_remove_source_json(&replaced, "api.md", 2),
            r#"{"tokenizerVersion":2,"inverted":{"local":{"other.md::0":1},"model":{"other.md::0":1},"ollama":{"other.md::0":1}},"docLengths":{"other.md::0":3},"docSources":{"other.md::0":"other.md"},"totalDocs":1,"avgDocLength":3}"#,
        );
        assert_eq!(
            plan_bm25_index_remove_document_json(
                &plan_bm25_index_remove_source_json(&replaced, "api.md", 2),
                "other.md::0",
                2,
            ),
            empty,
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

    /// keyword 매칭은 소문자 비교 기준 substring 카운팅을 유지해야 한다.
    #[test]
    fn count_keyword_matches_is_case_insensitive_and_substring_based() {
        assert_eq!(
            count_keyword_matches("apple\u{1f}open\u{1f}router", "Apple router"),
            2
        );
        assert_eq!(
            count_keyword_matches("llm\u{1f}api", "No API docs, but LLM exists."),
            2
        );
        assert_eq!(count_keyword_matches("missing", "No match here"), 0);
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

    /// vault link 추출은 wikilink/Markdown link 정규화와 중복 제거를 보존해야 한다.
    #[test]
    fn extract_vault_links_json_normalizes_and_dedupes_targets() {
        let links = extract_vault_links_json(
            "[[제품 개념 정리]]\n\
             ![[Monithub%EC%9D%98%20%EA%B0%80%EC%B9%98.md#핵심]]\n\
             [[제품 개념 정리|alias]]\n\
             [기획](../제품%20개념%20정리.md)\n\
             [외부](https://example.com)",
        );

        assert_eq!(
            links, "[\"제품 개념 정리\",\"Monithub의 가치.md\",\"../제품 개념 정리.md\"]",
            "vault link JSON은 기존 TypeScript 추출 계약과 같아야 한다",
        );
    }

    /// vault link resolve 후보 생성은 상대 path 정규화와 basename fallback을 보존해야 한다.
    #[test]
    fn vault_link_candidate_plan_normalizes_relative_targets() {
        assert_eq!(
            plan_vault_link_candidates_json(
                "제품문서/고객 입장에서의 제품/데모 및 제품 기획.md",
                "../제품 개념 정리.md",
            ),
            "{\"candidates\":[\"제품 개념 정리.md\",\"제품문서/제품 개념 정리.md\"],\"fallbackBasename\":\"제품 개념 정리\"}",
        );
    }

    /// vault link basename fallback은 첫 번째 basename match index를 Rust에서 계산해야 한다.
    #[test]
    fn vault_link_fallback_index_is_planned_in_rust() {
        assert_eq!(
            plan_vault_link_fallback_index_json("Romans", r#"["Paul","Romans","Romans"]"#),
            "{\"index\":1}",
        );
        assert_eq!(
            plan_vault_link_fallback_index_json("Missing", r#"["Paul","Romans"]"#),
            "{\"index\":null}",
        );
    }

    /// 파일 확장자 집계는 요청 키를 정규화해 0으로 시작하는 카운트를 반환해야 한다.
    #[test]
    fn count_files_by_extensions_respects_normalized_extension_keys() {
        assert_eq!(
            count_files_by_extensions_json(
                r#"["md","TS",".png","md",".env",".","not.extension"]"#,
                r#"["MD"," .png","ts"]"#,
            ),
            "{\"md\":2,\"png\":1,\"ts\":1}",
        );
    }

    /// 파일 확장자 제외는 경로 확장자 정규화와 동일한 규칙으로 판정된다.
    #[test]
    fn is_excluded_ext_checks_normalized_path_extension_match() {
        assert!(is_excluded_ext_json("Docs/README.MD", r#"["md"]"#));
        assert!(is_excluded_ext_json("notes/image.PNG", r#"["png"]"#));
        assert!(!is_excluded_ext_json("notes/.env", r#"["env"]"#));
        assert!(!is_excluded_ext_json("notes/noext", r#"["", "noext"]"#));
    }

    /// folder mention 대상 파일 index와 partial 여부는 Rust에서 계산해야 한다.
    #[test]
    fn folder_mention_file_indices_are_planned_in_rust() {
        assert_eq!(
            plan_folder_mention_file_indices_json(
                "Notes",
                r#"["Notes/a.md","Other/a.md","Notes/nested/b.md","NotesExtra/c.md"]"#,
                1,
            ),
            "{\"indices\":[0],\"partial\":true,\"matchedCount\":2,\"limitReason\":\"max-files\"}",
        );
        assert_eq!(
            plan_folder_mention_file_indices_json("Missing", r#"["Notes/a.md"]"#, 12),
            "{\"indices\":[],\"partial\":false,\"matchedCount\":0,\"limitReason\":\"complete\"}",
        );
    }

    /// 참조 확장 대상 self-skip과 dedupe는 Rust index plan을 따른다.
    #[test]
    fn reference_file_indices_are_planned_in_rust() {
        assert_eq!(
            plan_reference_file_indices_json(
                "Notes/source.md",
                r#"["Notes/first.md","Notes/source.md","Notes/first.md","Notes/second.md"]"#,
            ),
            "[0,3]",
        );
    }

    /// RAG file type summary는 확장자 정규화, protected 문서 제외, 정렬을 Rust에서 계산해야 한다.
    #[test]
    fn rag_file_type_summary_is_planned_in_rust() {
        assert_eq!(
            plan_rag_file_type_summary_json(
                r#"[{"filePath":"notes/a.md","extension":"MD","indexable":true},{"filePath":"src/main.ts","extension":"ts","indexable":true},{"filePath":"src/other.ts","extension":".TS","indexable":true},{"filePath":".env","extension":"","indexable":false,"recommendationReason":"sensitive"},{"filePath":"empty.markdown","extension":"markdown","indexable":false,"recommendationReason":"empty"},{"filePath":"image.PNG","extension":"PNG","indexable":false,"recommendationReason":"binary"}]"#,
                "확장자 없음",
            ),
            "{\"targetTypes\":[{\"extension\":\"ts\",\"label\":\".ts\",\"count\":2},{\"extension\":\"md\",\"label\":\".md\",\"count\":1}],\"excludeRecommendations\":[{\"extension\":\"(none)\",\"label\":\"확장자 없음\",\"count\":1,\"reason\":\"sensitive\"},{\"extension\":\"png\",\"label\":\".png\",\"count\":1,\"reason\":\"binary\"}],\"totalTargetFiles\":3}",
        );
    }

    /// RAG 후보 파일 판정과 unknown text probe 선택은 Rust에서 계산해야 한다.
    #[test]
    fn rag_file_indexability_is_planned_in_rust() {
        let files = r#"[{"filePath":"note.md","fileName":"note.md","extension":"MD","size":10},{"filePath":"src/main.ts","fileName":"main.ts","extension":"ts","size":10},{"filePath":".env","fileName":".env","extension":"","size":10},{"filePath":"empty.md","fileName":"empty.md","extension":"md","size":0},{"filePath":"custom.weird","fileName":"custom.weird","extension":"weird","size":10},{"filePath":"bin.weird","fileName":"bin.weird","extension":"weird","size":10},{"filePath":"Archive/old.txt","fileName":"old.txt","extension":"txt","size":10},{"filePath":"image.png","fileName":"image.png","extension":"png","size":10},{"filePath":"empty.txt","fileName":"empty.txt","extension":"txt","size":0}]"#;

        assert_eq!(
            plan_rag_file_content_probe_indices_json(files, r#"["Archive"]"#, r#"["png"]"#),
            "[4,5]",
        );
        assert_eq!(
            plan_rag_file_indexability_json(
                files,
                r#"["Archive"]"#,
                r#"["png"]"#,
                r#"[{"index":4,"readable":true,"sample":"plain text content"},{"index":5,"readable":true,"sample":"\u0000binary"}]"#,
            ),
            "{\"candidateIndices\":[0,1,4],\"summaryInputs\":[{\"filePath\":\"note.md\",\"extension\":\"MD\",\"indexable\":true},{\"filePath\":\"src/main.ts\",\"extension\":\"ts\",\"indexable\":true},{\"filePath\":\".env\",\"extension\":\"\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"empty.md\",\"extension\":\"md\",\"indexable\":false,\"recommendationReason\":\"unreadable\"},{\"filePath\":\"custom.weird\",\"extension\":\"weird\",\"indexable\":true},{\"filePath\":\"bin.weird\",\"extension\":\"weird\",\"indexable\":false,\"recommendationReason\":\"unreadable\"},{\"filePath\":\"empty.txt\",\"extension\":\"txt\",\"indexable\":false,\"recommendationReason\":\"unreadable\"}]}",
        );
    }

    /// 민감한 설정/키 파일은 사용자가 따로 제외하지 않아도 기본 RAG 후보에서 빠져야 한다.
    #[test]
    fn rag_file_indexability_excludes_sensitive_secret_files_by_default() {
        let files = r#"[{"filePath":".npmrc","fileName":".npmrc","extension":"","size":10},{"filePath":"id_ed25519","fileName":"id_ed25519","extension":"","size":10},{"filePath":"cert.pem","fileName":"cert.pem","extension":"pem","size":10},{"filePath":"private.key","fileName":"private.key","extension":"key","size":10},{"filePath":"secrets.json","fileName":"secrets.json","extension":"json","size":10},{"filePath":"credentials.toml","fileName":"credentials.toml","extension":"toml","size":10},{"filePath":"app.config","fileName":"app.config","extension":"config","size":10},{"filePath":"app.log","fileName":"app.log","extension":"log","size":10}]"#;

        assert_eq!(
            plan_rag_file_indexability_json(files, "[]", "[]", "[]"),
            "{\"candidateIndices\":[6,7],\"summaryInputs\":[{\"filePath\":\".npmrc\",\"extension\":\"\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"id_ed25519\",\"extension\":\"\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"cert.pem\",\"extension\":\"pem\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"private.key\",\"extension\":\"key\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"secrets.json\",\"extension\":\"json\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"credentials.toml\",\"extension\":\"toml\",\"indexable\":false,\"recommendationReason\":\"sensitive\"},{\"filePath\":\"app.config\",\"extension\":\"config\",\"indexable\":true},{\"filePath\":\"app.log\",\"extension\":\"log\",\"indexable\":true}]}",
        );
    }

    /// 답변 출처 참조 파싱과 warning key plan은 Rust에서 계산해야 한다.
    #[test]
    fn source_validation_references_and_warnings_are_planned_in_rust() {
        let references = plan_source_references_json(
            "참고 [[Existing]] 및 [[Missing.md#섹션|누락]]\n[문서](Docs%20A.md#head)\nSource rag-9 그리고 Source rag-1",
        );

        assert_eq!(
            references,
            "[{\"label\":\"[[Existing]]\",\"target\":\"Existing\",\"kind\":\"wikilink\",\"aliases\":[\"Existing\",\"Existing.md\"]},{\"label\":\"[[Missing.md#섹션|누락]]\",\"target\":\"Missing.md\",\"kind\":\"wikilink\",\"aliases\":[\"Missing.md\",\"Missing.md.md\",\"Missing\"]},{\"label\":\"[문서](Docs%20A.md#head)\",\"target\":\"Docs A.md\",\"kind\":\"markdown-link\",\"aliases\":[\"Docs A.md\",\"Docs A.md.md\",\"Docs A\"]},{\"label\":\"Source rag-9\",\"target\":\"rag-9\",\"kind\":\"source-id\",\"aliases\":[]},{\"label\":\"Source rag-1\",\"target\":\"rag-1\",\"kind\":\"source-id\",\"aliases\":[]}]",
        );
        assert_eq!(
            plan_source_validation_warnings_json(
                &references,
                r#"["rag-1"]"#,
                r#"["Existing.md"]"#,
                r#"["Docs A.md"]"#,
            ),
            "[{\"id\":\"link:Missing.md\",\"label\":\"[[Missing.md#섹션|누락]]\",\"kind\":\"missing-link\"},{\"id\":\"source:rag-9\",\"label\":\"Source rag-9\",\"kind\":\"unverified-source\"}]",
        );
    }

    /// source validation 입력 선택과 alias probe 후보는 Rust에서 계산해야 한다.
    #[test]
    fn source_validation_inputs_are_planned_in_rust() {
        let references = plan_source_references_json(
            "참고 [[Existing]] 및 [[Missing.md#섹션|누락]]\n[문서](Docs%20A.md#head)\nSource rag-9 그리고 Source rag-1",
        );

        assert_eq!(
            plan_source_validation_inputs_json(
                &references,
                r#"["rag-1","rag-2"]"#,
                r#"["Notes/Existing.md","Draft.md"]"#,
                r#"["verified","missing"]"#,
            ),
            "{\"verifiedCitationIds\":[\"rag-1\"],\"verifiedPaths\":[\"Notes/Existing.md\"],\"aliasCandidates\":[\"Existing\",\"Existing.md\",\"Missing.md\",\"Missing.md.md\",\"Missing\",\"Docs A.md\",\"Docs A.md.md\",\"Docs A\"]}",
        );
    }

    /// assistant 응답 질문 분류는 prompt/choice/reasoning leak 계약을 Rust에서 계산해야 한다.
    #[test]
    fn assistant_response_classification_is_planned_in_rust() {
        assert_eq!(
            plan_assistant_response_classification_json(
                "해당되는 항목을 모두 선택해 주세요.\n- 성능\n- 보안",
                "  생각 중  ",
            ),
            "{\"type\":\"question\",\"content\":\"\",\"reasoning\":\"생각 중\",\"question\":{\"prompt\":\"해당되는 항목을 모두 선택해 주세요.\",\"choices\":[{\"id\":\"choice-1\",\"label\":\"성능\"},{\"id\":\"choice-2\",\"label\":\"보안\"}],\"selectionMode\":\"multiple\",\"allowFreeText\":true,\"source\":\"answer\"},\"originalContent\":\"해당되는 항목을 모두 선택해 주세요.\\n- 성능\\n- 보안\"}",
        );
        assert_eq!(
            plan_assistant_response_classification_json(
                "",
                "사용자에게 물어봐야겠다. 어떤 범위를 분석할까요?\nA) 전체\nB) 변경분만",
            ),
            "{\"type\":\"question\",\"content\":\"\",\"reasoning\":\"사용자에게 물어봐야겠다. 어떤 범위를 분석할까요?\\nA) 전체\\nB) 변경분만\",\"question\":{\"prompt\":\"어떤 범위를 분석할까요?\",\"choices\":[{\"id\":\"choice-1\",\"label\":\"전체\"},{\"id\":\"choice-2\",\"label\":\"변경분만\"}],\"selectionMode\":\"single\",\"allowFreeText\":true,\"source\":\"reasoning-leak\"},\"originalContent\":\"\"}",
        );
    }

    /// 저장된 chat message block 파싱은 meta 기본값, base64 decode, content fallback을 Rust에서 계산해야 한다.
    #[test]
    fn chat_message_blocks_are_planned_in_rust() {
        let body = [
            "<!-- superpower-inside-message",
            r#"{"id":"msg-1","role":"assistant","providerKey":"openai","turnStage":"streaming-answer","toolRound":2,"providerCapability":{"providerKey":"openai","model":"gpt-test","streaming":true,"transport":"fetch-sse","toolCalling":true,"reasoning":true,"abort":"native","fileReference":true,"maxToolRounds":10,"knownLimitations":[]}}"#,
            "-->",
            "<!-- superpower-inside-reasoning-start encoding=\"base64\" -->",
            "7IOd6rCB7J2YIOqzvOygleyeheuLiOuLpC4=",
            "<!-- superpower-inside-reasoning-end -->",
            "<!-- superpower-inside-content-start encoding=\"base64\" -->",
            "7JuQ67O4IOuLteuzgCDrgrTsmqk=",
            "<!-- superpower-inside-content-end -->",
            "<!-- /superpower-inside-message -->",
            "<!-- superpower-inside-message",
            r#"{"id":"msg-2","role":"assistant"}"#,
            "-->",
            "<!-- superpower-inside-reasoning-start encoding=\"base64\" -->",
            "7IOd6rCB7J2YIOqzvOygleyeheuLiOuLpC4=",
            "<!-- superpower-inside-reasoning-end -->",
            "<!-- superpower-inside-content-start encoding=\"base64\" -->",
            "",
            "<!-- superpower-inside-content-end -->",
            "<!-- /superpower-inside-message -->",
        ]
        .join("\n");

        assert_eq!(
            plan_chat_messages_json(
                &body,
                1_700_000_000_000.0,
                "2026-01-01T00:00:00.000Z",
                "[decoding failed]",
            ),
            "[{\"id\":\"msg-1\",\"role\":\"assistant\",\"content\":\"원본 답변 내용\",\"timestamp\":1700000000000.0,\"createdAt\":\"2026-01-01T00:00:00.000Z\",\"updatedAt\":\"2026-01-01T00:00:00.000Z\",\"status\":\"complete\",\"providerKey\":\"openai\",\"providerCapability\":{\"providerKey\":\"openai\",\"model\":\"gpt-test\",\"streaming\":true,\"transport\":\"fetch-sse\",\"toolCalling\":true,\"reasoning\":true,\"abort\":\"native\",\"fileReference\":true,\"maxToolRounds\":10,\"knownLimitations\":[]},\"turnStage\":\"streaming-answer\",\"toolRound\":2,\"reasoning\":\"생각의 과정입니다.\"},{\"id\":\"msg-2\",\"role\":\"assistant\",\"content\":\"생각의 과정입니다.\",\"timestamp\":1700000000000.0,\"createdAt\":\"2026-01-01T00:00:00.000Z\",\"updatedAt\":\"2026-01-01T00:00:00.000Z\",\"status\":\"complete\",\"reasoning\":\"생각의 과정입니다.\"}]",
        );
    }

    /// 채팅 목록 metadata는 frontmatter, 날짜 정규화, 메시지 수, preview를 Rust에서 계산해야 한다.
    #[test]
    fn chat_list_metadata_is_planned_in_rust() {
        let content = [
            "---",
            "title: \"저장된 세션\"",
            "created: 1700000000000",
            "updated: \"2026-05-16T01:02:03.000Z\"",
            "messages: not-a-number",
            "provider: \"OpenAI\"",
            "model: \"gpt-4.1\"",
            "---",
            "",
            "## Messages",
            "",
            "<!-- superpower-inside-message",
            r#"{"id":"msg-user","role":"user"}"#,
            "-->",
            "### 1. User",
            "",
            "<!-- superpower-inside-content-start encoding=\"base64\" -->",
            "7LKrIOuyiOynuCDsgqzsmqnsnpAg66mU7Iuc7KeA7J6F64uI64ukLiDssqsg67KI7Ke4IOyCrOyaqeyekCDrqZTsi5zsp4DsnoXri4jri6QuIOyyqyDrsojsp7gg7IKs7Jqp7J6QIOuplOyLnOyngOyeheuLiOuLpC4g7LKrIOuyiOynuCDsgqzsmqnsnpAg66mU7Iuc7KeA7J6F64uI64ukLiDssqsg67KI7Ke4IOyCrOyaqeyekCDrqZTsi5zsp4DsnoXri4jri6QuIOyyqyDrsojsp7gg7IKs7Jqp7J6QIOuplOyLnOyngOyeheuLiOuLpC4g7LKrIOuyiOynuCDsgqzsmqnsnpAg66mU7Iuc7KeA7J6F64uI64ukLiDssqsg67KI7Ke4IOyCrOyaqeyekCDrqZTsi5zsp4DsnoXri4jri6QuIOyyqyDrsojsp7gg7IKs7Jqp7J6QIOuplOyLnOyngOyeheuLiOuLpC4g7LKrIOuyiOynuCDsgqzsmqnsnpAg66mU7Iuc7KeA7J6F64uI64ukLiA=",
            "<!-- superpower-inside-content-end -->",
            "<!-- /superpower-inside-message -->",
            "",
            "<!-- superpower-inside-message",
            r#"{"id":"msg-assistant","role":"assistant"}"#,
            "-->",
            "<!-- superpower-inside-content-start encoding=\"base64\" -->",
            "64u17IOA",
            "<!-- superpower-inside-content-end -->",
            "<!-- /superpower-inside-message -->",
        ]
        .join("\n");

        assert_eq!(
            plan_chat_meta_json(&content, "fallback.md", "2023-03-28T10:40:00.000Z"),
            "{\"title\":\"저장된 세션\",\"created\":\"2023-11-14T22:13:20.000Z\",\"updated\":\"2026-05-16T01:02:03.000Z\",\"messageCount\":2,\"preview\":\"첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫 번째 사용자 메시지입니다. 첫...\",\"provider\":\"OpenAI\",\"model\":\"gpt-4.1\"}",
        );
    }

    /// 채팅 저장 metadata의 title/summary/provider/source count는 Rust에서 계산해야 한다.
    #[test]
    fn chat_save_metadata_is_planned_in_rust() {
        let messages = r#"[
          {
            "role":"user",
            "content":"사용자 첫 질문입니다.\n두 번째 줄",
            "timestamp":1700000000000,
            "createdAt":"2023-11-14T22:13:20.000Z"
          },
          {
            "role":"assistant",
            "content":"이전 답변",
            "status":"complete",
            "providerKey":"openai",
            "model":"gpt-4.1-mini",
            "citations":[{"id":"rag-1"},{"id":"rag-2"}]
          },
          {
            "role":"assistant",
            "content":"최종 완료 답변",
            "status":"complete",
            "providerLabel":"OpenAI",
            "model":"gpt-4.1",
            "citations":[{"id":"rag-3"}]
          }
        ]"#;

        assert_eq!(
            plan_chat_save_metadata_json(messages, "1700000000000", "", "2026-01-01T00:00:00.000Z",),
            "{\"title\":\"사용자 첫 질문입니다. 두 번째 줄\",\"created\":\"2023-11-14T22:13:20.000Z\",\"sourceCount\":3,\"provider\":\"OpenAI\",\"model\":\"gpt-4.1\",\"summary\":\"최종 완료 답변\"}",
        );
    }

    /// RAG context source citation/block/source id plan은 Rust에서 계산해야 한다.
    #[test]
    fn context_sources_are_planned_in_rust() {
        let results = r#"[
          {
            "filePath":"note.md",
            "heading":"핵심",
            "startLine":3,
            "endLine":5,
            "text":"  긴   본문\n\n요약 ",
            "score":0.91,
            "vectorScore":0.8,
            "bm25Score":0.2
          },
          {
            "filePath":"stale.md",
            "startLine":0,
            "text":"오래된 본문",
            "score":0.6,
            "vectorScore":0.4,
            "bm25Score":0.3
          }
        ]"#;
        let verifications = r#"[
          {"status":"verified"},
          {"status":"stale","detail":"파일이 변경됨"}
        ]"#;

        assert_eq!(
            plan_context_sources_json(results, verifications, 7, "rag"),
            "{\"citations\":[{\"id\":\"rag-7\",\"filePath\":\"note.md\",\"heading\":\"핵심\",\"line\":3,\"endLine\":5,\"score\":0.91,\"vectorScore\":0.8,\"bm25Score\":0.2,\"status\":\"verified\",\"preview\":\"긴 본문 요약\",\"previewTruncated\":false},{\"id\":\"rag-8\",\"filePath\":\"stale.md\",\"line\":0,\"score\":0.6,\"vectorScore\":0.4,\"bm25Score\":0.3,\"status\":\"stale\",\"detail\":\"파일이 변경됨\",\"preview\":\"오래된 본문\",\"previewTruncated\":false}],\"blocks\":[{\"sourceId\":\"rag-7\",\"text\":\"[Source rag-7: note.md # 핵심]\\n  긴   본문\\n\\n요약 \"}],\"sourceIds\":[\"rag-7\"],\"rejectedCount\":1}",
        );
    }

    /// context source preview는 잘림 여부를 별도 flag로 알려야 한다.
    #[test]
    fn context_sources_mark_truncated_preview() {
        let long_text = "가".repeat(221);
        let results = format!(r#"[{{"filePath":"long.md","text":"{long_text}","score":0.9}}]"#);
        let output = plan_context_sources_json(&results, r#"[{"status":"verified"}]"#, 1, "rag");
        let value = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);
        let null = JsonValue::Null;
        let citation = value
            .get("citations")
            .and_then(JsonValue::as_array)
            .and_then(|citations| citations.first())
            .unwrap_or(&null);

        assert_eq!(
            citation
                .get("previewTruncated")
                .and_then(JsonValue::as_bool),
            Some(true),
        );
        assert_eq!(
            citation
                .get("preview")
                .and_then(JsonValue::as_str)
                .map(str::chars)
                .map(Iterator::count),
            Some(220),
        );
    }

    /// context budget append는 Rust에서 계산하고 surrogate pair를 깨지 않는다.
    #[test]
    fn context_budget_append_is_planned_in_rust() {
        assert_eq!(
            plan_context_budget_append_json(4, "de😀f"),
            "{\"text\":\"de😀\",\"remainingChars\":0,\"complete\":false,\"appended\":true}",
        );
        assert_eq!(
            plan_context_budget_append_json(1, "😀A"),
            "{\"text\":\"\",\"remainingChars\":0,\"complete\":false,\"appended\":false}",
        );
    }

    /// chat context mention type selection과 auto-RAG policy는 Rust에서 계산해야 한다.
    #[test]
    fn chat_context_mentions_are_planned_in_rust() {
        assert_eq!(
            plan_chat_context_mentions_json(r#"["server","file","folder","entity","server"]"#),
            "{\"fileIndices\":[1],\"folderIndices\":[2],\"entityIndices\":[3],\"serverIndices\":[0,4],\"useAutoRag\":true,\"autoRagReason\":\"server-and-vault\"}",
        );
        assert_eq!(
            plan_chat_context_mentions_json(r#"["server"]"#),
            "{\"fileIndices\":[],\"folderIndices\":[],\"entityIndices\":[],\"serverIndices\":[0],\"useAutoRag\":false,\"autoRagReason\":\"server-only\"}",
        );
    }

    /// MCP server 후보와 tool name matching은 Rust에서 계산해야 한다.
    #[test]
    fn mcp_tool_server_candidates_are_planned_in_rust() {
        assert_eq!(
            plan_mcp_server_candidates_json(
                r#"["serper","context7","serper"]"#,
                r#"["filesystem","serper","context7","local"]"#,
                r#"{"context7":"disconnected","filesystem":"connected","local":"connected","serper":"connected"}"#,
            ),
            r#"["serper","filesystem","local"]"#,
        );
        assert!(is_mcp_tool_name_available(
            "search",
            r#"["lookup_docs","search"]"#,
        ));
        assert!(!is_mcp_tool_name_available("search", r#"["search_v2"]"#));
    }

    #[test]
    fn mcp_tool_result_plan_and_error_classification_is_in_rust() {
        assert_eq!(
            parse_mcp_tool_arguments_json(r#"{"name":"search"}"#),
            r#"{"name":"search"}"#,
        );

        assert_eq!(
            parse_mcp_tool_arguments_json("raw input"),
            r#"{"input":"raw input"}"#,
        );

        assert_eq!(
            normalize_mcp_tool_result_json(
                r#"{"content":[{"type":"text","text":"alpha"},{"notes":1}] }"#,
            ),
            r#"{"displayText":"alpha\n\n{\"notes\":1}","modelText":"alpha\n\n{\"notes\":1}"}"#,
        );

        assert!(is_mcp_tool_result_empty_json(
            r#"{"content":[{"type":"text","text":""}] }"#,
            "",
            "",
        ));
        assert!(!is_mcp_tool_result_empty_json(
            r#"{"content":[{"type":"text","text":"ok"}] }"#,
            "ok",
            "ok",
        ));

        let classify = |msg: &str| {
            serde_json::from_str::<JsonValue>(&classify_mcp_tool_error_json(msg))
                .unwrap_or_else(|_| JsonValue::Null)
        };

        assert_eq!(
            classify("Input validation error: does not match '\\d+'"),
            serde_json::json!({"kind":"validation-pattern","pattern":"\\d+"}),
        );
        assert_eq!(
            classify("Input validation error: unknown field 'path'"),
            serde_json::json!({"field":"path","kind":"validation-field"}),
        );
        assert_eq!(
            classify("required path is missing"),
            serde_json::json!({"kind":"validation-required"}),
        );
        assert_eq!(
            classify("Input validation error: malformed payload"),
            serde_json::json!({"kind":"validation-generic"}),
        );
    }

    /// `GraphRAG` virtual source verification은 Rust에서 계산해야 한다.
    #[test]
    fn context_graph_verification_is_planned_in_rust() {
        assert_eq!(
            plan_context_graph_verification_json(
                "graph://community/community::mission",
                "지원하지 않는 GraphRAG 출처입니다.",
            ),
            "{\"isGraphSource\":true,\"verification\":{\"status\":\"verified\",\"graphType\":\"community\"}}",
        );
        assert_eq!(
            plan_context_graph_verification_json(
                "graph://unknown/source",
                "지원하지 않는 GraphRAG 출처입니다.",
            ),
            "{\"isGraphSource\":true,\"verification\":{\"status\":\"missing\",\"detail\":\"지원하지 않는 GraphRAG 출처입니다.\"}}",
        );
        assert_eq!(
            plan_context_graph_verification_json("note.md", "지원하지 않는 GraphRAG 출처입니다.",),
            "{\"isGraphSource\":false,\"verification\":null}",
        );
    }

    /// `GraphRAG` mention context의 entity/relation selection은 Rust index plan을 따른다.
    #[test]
    fn graph_mention_context_is_planned_in_rust() {
        assert_eq!(
            plan_graph_mention_context_json(
                r#"["PAUL","apostle"]"#,
                r#"[{"id":"entity::paul","canonicalName":"Paul","aliases":["Saul","Apostle"],"typeId":"person","description":"사도 바울"},{"id":"entity::barnabas","canonicalName":"Barnabas","aliases":[],"typeId":"person","description":"동역자"},{"id":"entity::mark","canonicalName":"Mark","aliases":["John Mark"],"typeId":"person","description":"마가"}]"#,
                r#"[{"sourceEntityId":"entity::paul","targetEntityId":"entity::barnabas","relationTypeId":"worked_with","description":"함께 사역함"},{"sourceEntityId":"entity::mark","targetEntityId":"entity::barnabas","relationTypeId":"worked_with","description":"바나바와 동행"},{"sourceEntityId":"entity::mark","targetEntityId":"entity::paul","relationTypeId":"wrote_about","description":"Paul 관련 기록"}]"#,
            ),
            "{\"matchedEntityIndices\":[0],\"matchedRelationIndices\":[0,2],\"contextLines\":[\"[Graph Knowledge Context]\",\"\",\"## Matched Entities\",\"- [person] Paul (aka Saul, Apostle)\",\"  사도 바울\",\"\",\"## Related Relations\",\"- Paul → [worked_with] → Barnabas\",\"  함께 사역함\",\"- Mark → [wrote_about] → Paul\",\"  Paul 관련 기록\"]}",
        );
    }

    /// Graph extraction claim entity id lookup은 Rust normalization plan을 따른다.
    #[test]
    fn graph_claim_entity_ids_are_planned_in_rust() {
        assert_eq!(
            plan_graph_claim_entity_ids_json(
                r#"[" PAUL ","Saul","Missing","Romans"]"#,
                r#"[{"name":"Paul","entityId":"entity::paul"},{"name":"Saul","entityId":"entity::paul"},{"name":"Romans","entityId":"entity::romans"}]"#,
            ),
            r#"["entity::paul","entity::paul","entity::romans"]"#,
        );
    }

    /// Graph extraction relation endpoint lookup은 Rust normalization plan을 따른다.
    #[test]
    fn graph_relation_endpoint_indices_are_planned_in_rust() {
        assert_eq!(
            plan_graph_relation_endpoint_indices_json(
                r#"[{"source":"Saul","target":"Romans"},{"source":"Paul","target":"Missing"}]"#,
                r#"[{"name":"Paul","entityIndex":0},{"name":"Saul","entityIndex":0},{"name":"Romans","entityIndex":1}]"#,
                2,
            ),
            "{\"pairs\":[{\"sourceEntityIndex\":0,\"targetEntityIndex\":1},null]}",
        );
    }

    /// Graph extraction entity/claim type membership 검증은 Rust schema plan을 따른다.
    #[test]
    fn graph_extraction_type_validation_is_planned_in_rust() {
        assert_eq!(
            plan_graph_extraction_type_validation_json(
                r#"["person","unknown_entity"]"#,
                r#"["factual_claim","unknown_claim"]"#,
                r#"["person","work"]"#,
                r#"["factual_claim"]"#,
            ),
            "{\"entityTypeKnown\":[true,false],\"claimTypeKnown\":[true,false]}",
        );
    }

    /// Graph community summarizer grouping은 Rust index plan을 따른다.
    #[test]
    fn graph_community_summary_groups_are_planned_in_rust() {
        assert_eq!(
            plan_graph_community_summary_groups_json(
                r#"[{"entityId":"entity::paul","communityId":7},{"entityId":"entity::romans","communityId":7},{"entityId":"entity::grace","communityId":8}]"#,
                r#"["entity::paul","entity::romans","entity::grace"]"#,
                r#"[{"sourceEntityId":"entity::paul","targetEntityId":"entity::romans"},{"sourceEntityId":"entity::paul","targetEntityId":"entity::grace"}]"#,
                r#"[{"entityIds":["entity::romans"]},{"entityIds":["entity::grace","entity::paul"]},{"entityIds":["entity::missing"]}]"#,
                r"[7,8,9]",
            ),
            "{\"groups\":[{\"entityIndices\":[0,1],\"relationIndices\":[0],\"claimIndices\":[0]},{\"entityIndices\":[2],\"relationIndices\":[],\"claimIndices\":[1]},{\"entityIndices\":[],\"relationIndices\":[],\"claimIndices\":[]}]}",
        );
    }

    /// `GraphRAG` markdown file path 판정은 Rust path plan을 따른다.
    #[test]
    fn graph_rag_markdown_file_paths_are_planned_in_rust() {
        assert_eq!(
            plan_graph_rag_markdown_file_paths_json(
                r#"["Notes/Paul.md","Notes/Romans.MD","Notes/archive.txt","Notes/.md",""]"#,
            ),
            r#"["Notes/Paul.md","Notes/Romans.MD","Notes/.md"]"#,
        );
    }

    /// `GraphRAG` run의 후보 선택, 정렬, dedupe, max window는 Rust에서 계산해야 한다.
    #[test]
    fn graph_rag_run_file_selection_is_planned_in_rust() {
        assert_eq!(
            plan_graph_rag_run_file_selection_json(
                r#"{"mode":"full","failedFilePaths":["failed.md"],"staleFilePaths":["stale.md"],"recordFilePaths":[{"filePath":"z.md","processable":true},{"filePath":"Base.base","processable":true},{"filePath":"a.md","processable":false},{"filePath":"m.md","processable":true},{"filePath":"z.md","processable":true}],"indexedFilePaths":[{"filePath":"fallback.md","processable":true}],"maxFilesPerRun":1}"#,
            ),
            r#"{"candidateFilePaths":["m.md","z.md"],"selectedFilePaths":["m.md"]}"#,
        );
        assert_eq!(
            plan_graph_rag_run_file_selection_json(
                r#"{"mode":"failed","failedFilePaths":["b.md","a.base","a.md","b.md"],"staleFilePaths":["stale.md"],"recordFilePaths":[],"indexedFilePaths":[],"maxFilesPerRun":8}"#,
            ),
            r#"{"candidateFilePaths":["a.md","b.md"],"selectedFilePaths":["a.md","b.md"]}"#,
        );
        assert_eq!(
            plan_graph_rag_run_file_selection_json(
                r#"{"mode":"stale","failedFilePaths":["failed.md"],"staleFilePaths":["deleted.md","Base.base","stale.md","stale.md"],"recordFilePaths":[],"indexedFilePaths":[],"maxFilesPerRun":1}"#,
            ),
            r#"{"candidateFilePaths":["deleted.md","stale.md"],"selectedFilePaths":["deleted.md"]}"#,
        );
    }

    /// unsupported `GraphRAG` graph data pruning 대상 path는 Rust에서 계산해야 한다.
    #[test]
    fn graph_rag_unsupported_prune_paths_are_planned_in_rust() {
        assert_eq!(
            plan_graph_rag_unsupported_prune_paths_json(
                r#"[{"filePath":"Base.base","processable":false},{"filePath":"current.md","processable":true},{"filePath":"foreign.md","processable":false}]"#,
                r#"[{"filePath":"foreign.md","processable":false},{"filePath":"old.canvas","processable":false},{"filePath":"current.md","processable":true}]"#,
            ),
            r#"["Base.base","foreign.md","old.canvas"]"#,
        );
    }

    /// 채팅 mention 후보 추출은 bracket 우선, word 후순위, case-insensitive dedupe를 보존해야 한다.
    #[test]
    fn parse_mention_candidates_json_preserves_typescript_order_and_dedupe() {
        let candidates = parse_mention_candidates_json(
            "@browser @[Project Plan.md] @[Project Plan.md] @[entity: Paul] @Notes/today.md @missing",
        );

        assert_eq!(
            candidates,
            "[{\"raw\":\"@[Project Plan.md]\",\"name\":\"Project Plan.md\"},{\"raw\":\"@[entity: Paul]\",\"name\":\"entity: Paul\"},{\"raw\":\"@browser\",\"name\":\"browser\"},{\"raw\":\"@Notes/today.md\",\"name\":\"Notes/today.md\"},{\"raw\":\"@missing\",\"name\":\"missing\"}]",
        );
    }

    /// vault exclude path matching은 기존 `TypeScript` pattern 계약을 보존해야 한다.
    #[test]
    fn is_excluded_path_matches_typescript_patterns() {
        assert!(is_excluded_path("Archive/old.txt", "archive"));
        assert!(is_excluded_path("foo/.git/config", "**/.git"));
        assert!(is_excluded_path(".git/config", ".git/**"));
        assert!(is_excluded_path("Projects/drafts/note.md", "**/drafts"));
        assert!(is_excluded_path("src/main.test.ts", "src/*.test.ts"));
        assert!(is_excluded_path("images/logo.PNG", "png"));
        assert!(!is_excluded_path("notes/today.md", "png\0jpg"));
    }

    /// `GraphRAG` entity resolver의 이름 정규화와 merge score 수식을 보존해야 한다.
    #[test]
    fn entity_match_score_preserves_typescript_contract() {
        assert_eq!(
            normalize_entity_name("  Saul / Paul【Apostle】  "),
            "saul paul apostle",
        );
        assert_eq!(
            create_entity_id("default", "person", "  Saul / Paul【Apostle】  "),
            "entity::default::person::saul-paul-apostle",
        );
        assert_float_close(
            score_entity_match_or_nan(
                "Saul",
                "Paul\0Saul",
                "Paul Apostle\u{1f}Apostle",
                "\u{1f}",
                true,
                0.0,
            ),
            1.0,
            "exact canonical/alias match는 즉시 1이어야 한다",
        );

        let score = score_entity_match_or_nan(
            "Apostle Paul",
            "Paul the Apostle",
            "Paul missionary\u{1f}Apostle missionary",
            "evidence::acts\u{1f}evidence::acts",
            true,
            0.0,
        );

        assert!(
            (0.72..1.0).contains(&score),
            "이름 순서 차이와 공통 evidence는 pending merge 수준 score여야 한다: {score}",
        );

        assert_eq!(
            plan_entity_resolution_json(
                r#"{"ontologySchemaId":"default","typeId":"person","candidateEntityId":"entity::default::person::saul","autoMergeThreshold":0.88,"pendingMergeThreshold":0.72,"candidates":[{"entityId":"entity::default::person::paul","ontologySchemaId":"default","typeId":"person","score":0.71},{"entityId":"entity::default::person::barnabas","ontologySchemaId":"default","typeId":"person","score":0.73},{"entityId":"entity::default::place::paul","ontologySchemaId":"default","typeId":"place","score":1}]}"#,
            ),
            r#"{"status":"pending-merge","entityId":"entity::default::person::saul","mergeScore":0.73,"matchedEntityId":"entity::default::person::barnabas"}"#,
        );
    }

    /// Graph extraction record 정규화는 이름, confidence, id 계약을 Rust에서 계산해야 한다.
    #[test]
    fn graph_extraction_normalizers_match_existing_contract() {
        assert_eq!(
            normalize_graph_name("  Saul / Paul【Apostle】  "),
            "saul paul apostle",
            "extraction name normalization mismatch",
        );
        assert_float_close(
            normalize_graph_confidence_or_default(1.4),
            1.0,
            "confidence upper clamp mismatch",
        );
        assert_float_close(
            normalize_graph_confidence_or_default(-0.2),
            0.0,
            "confidence lower clamp mismatch",
        );
        assert_float_close(
            normalize_graph_confidence_or_default(f64::NAN),
            0.5,
            "confidence default mismatch",
        );
        assert_eq!(
            sanitize_graph_id_part("  A+B 가/나:1.2  "),
            "a-b-가-나:1.2",
            "graph id sanitizer mismatch",
        );
        assert_eq!(
            sanitize_graph_id_part("!!!"),
            "-",
            "invalid run should collapse to dash",
        );
        assert_eq!(
            create_graph_id("claim\0factual claim\0가 나\0!!!"),
            "claim::factual-claim::가-나::-",
            "graph id join mismatch",
        );
        assert_eq!(
            create_entity_id("Def@ult", "type/1", "Paul & the apostle"),
            "entity::def-ult::type-1::paul---the-apostle",
            "entity id creation mismatch",
        );
    }

    /// Graph extraction은 LLM 응답에서 JSON object 문자열만 안정적으로 잘라내야 한다.
    #[test]
    fn extract_json_object_text_preserves_llm_response_contract() {
        assert_eq!(
            extract_json_object_text("  {\"entities\":[]}  "),
            "{\"entities\":[]}",
            "bare JSON object extraction mismatch",
        );
        assert_eq!(
            extract_json_object_text("결과입니다.\n```json\n{\"claims\":[]}\n```"),
            "{\"claims\":[]}",
            "fenced JSON extraction mismatch",
        );
        assert_eq!(
            extract_json_object_text("prefix {\"relations\":[]} suffix"),
            "{\"relations\":[]}",
            "inline JSON extraction mismatch",
        );
        assert_eq!(
            extract_json_object_text("not-json"),
            "",
            "invalid JSON extraction should return empty sentinel",
        );
    }

    /// Graph extraction payload normalization은 대체 필드명과 keyed object를 보존해야 한다.
    #[test]
    fn normalize_extracted_graph_payload_json_preserves_schema_contract() {
        let normalized = normalize_extracted_graph_payload_json(
            r#"{"entities":{"Base":{"type":"work","aliases":"Base.base","confidence":1.2},"표":{"type_id":"concept","desc":"  Table view  "}},"relations":{"r1":{"from":"표","to":"Base","relation":"part_of","score":0.8}},"claims":[{"subject":"Base","object":"표","claim":"The work titled 'Base' contains a table view named '표'.","type":"factual_claim","stance":"supports","confidence":0.7}]}"#,
        );

        assert_eq!(
            normalized,
            r#"{"payload":{"entities":[{"name":"Base","typeId":"work","aliases":["Base.base"],"confidence":1.2},{"name":"표","typeId":"concept","description":"Table view"}],"relations":[{"source":"표","target":"Base","relationTypeId":"part_of","confidence":0.8}],"claims":[{"text":"The work titled 'Base' contains a table view named '표'.","claimTypeId":"factual_claim","entityNames":["Base","표"],"stance":"supports","confidence":0.7}]},"rawFactCount":4}"#,
            "normalized graph payload mismatch",
        );
        assert_eq!(
            normalize_extracted_graph_payload_json(
                r#"{"Paul":{"typeId":"person","description":"Apostle"}}"#,
            ),
            r#"{"payload":{"entities":[{"name":"Paul","typeId":"person","description":"Apostle"}],"relations":[],"claims":[]},"rawFactCount":1}"#,
            "top-level inferred entity payload mismatch",
        );
        assert_eq!(
            normalize_extracted_graph_payload_json(r#"{"unexpected":true}"#),
            "",
            "unknown shape should return empty sentinel",
        );
    }

    #[test]
    fn normalize_extracted_graph_payload_resolves_entity_id_references() {
        assert_eq!(
            normalize_extracted_graph_payload_json(
                r#"{"entities":[{"id":"E1","typeId":"person","label":"바오로"},{"id":"E2","typeId":"work","label":"로마서"}],"relations":[{"source":"E1","target":"E2","relationTypeId":"authored"}],"claims":[{"text":"바오로는 로마서를 저술했다.","claimTypeId":"factual_claim","entityNames":["E1","E2"]}]}"#,
            ),
            r#"{"payload":{"entities":[{"name":"바오로","typeId":"person"},{"name":"로마서","typeId":"work"}],"relations":[{"source":"바오로","target":"로마서","relationTypeId":"authored"}],"claims":[{"text":"바오로는 로마서를 저술했다.","claimTypeId":"factual_claim","entityNames":["바오로","로마서"]}]},"rawFactCount":4}"#,
        );
    }

    #[test]
    fn normalize_extracted_graph_payload_does_not_guess_ambiguous_references() {
        assert_eq!(
            normalize_extracted_graph_payload_json(
                r#"{"entities":[{"id":"E1","typeId":"person","label":"바오로"},{"id":"E1","typeId":"work","label":"바오로 서간"}],"relations":[{"source":"E1","target":"바오로 서간","relationTypeId":"authored"}],"claims":[]}"#,
            ),
            r#"{"payload":{"entities":[{"name":"바오로","typeId":"person"},{"name":"바오로 서간","typeId":"work"}],"relations":[{"source":"E1","target":"바오로 서간","relationTypeId":"authored"}],"claims":[]},"rawFactCount":3}"#,
        );
    }

    /// Graph extraction raw 응답 parse plan은 TS wrapper에 JSON 판정을 남기지 않는다.
    #[test]
    fn parse_extracted_graph_payload_json_returns_store_ready_plan() {
        assert_eq!(
            parse_extracted_graph_payload_json(
                "결과입니다.\n```json\n{\"entities\":[{\"name\":\"Paul\",\"typeId\":\"person\"}],\"relations\":[],\"claims\":[]}\n```",
            ),
            r#"{"ok":true,"payload":{"entities":[{"name":"Paul","typeId":"person"}],"relations":[],"claims":[]}}"#,
            "valid raw LLM response parse plan mismatch",
        );
        assert_eq!(
            parse_extracted_graph_payload_json("not-json"),
            r#"{"ok":false,"reason":"invalid-json","rawFact":"not-json"}"#,
            "invalid raw LLM response should preserve raw response",
        );
        assert_eq!(
            parse_extracted_graph_payload_json(r#"{"unexpected":true}"#),
            r#"{"ok":false,"reason":"schema-shape-mismatch","rawFact":{"unexpected":true}}"#,
            "unknown parsed shape should preserve parsed raw fact",
        );
        assert_eq!(
            parse_extracted_graph_payload_json(r#"{"entities":[{"name":"Missing type"}]}"#),
            r#"{"ok":false,"reason":"schema-shape-mismatch","rawFact":{"entities":[{"name":"Missing type"}]}}"#,
            "raw fact candidates with zero valid facts should be rejected in Rust",
        );
    }

    /// MCP JSON 설정 검증과 포맷은 Rust에서 처리한다.
    #[test]
    fn mcp_json_is_validated_and_formatted_in_rust() {
        let valid = r#"{"mcpServers":{"context7":{"command":"node","args":["-y","@upstash/context7-mcp"],"env":{"A":"1"}}}}"#;
        let expected_plan = serde_json::json!({
            "valid": true,
            "data": {
                "mcpServers": {
                    "context7": {
                        "command": "node",
                        "args": ["-y", "@upstash/context7-mcp"],
                        "env": {"A": "1"}
                    }
                }
            }
        });
        let parse_json = |json_text: &str, label: &str| -> JsonValue {
            let result = serde_json::from_str::<JsonValue>(json_text);
            assert!(result.is_ok(), "{label} should be valid JSON");
            result.unwrap_or_else(|_| JsonValue::Null)
        };

        let valid_plan = parse_json(&validate_mcp_json(valid), "valid MCP plan");
        assert_eq!(valid_plan, expected_plan);

        let formatted_plan = parse_json(&format_mcp_json(valid), "formatted MCP plan");
        let Some(expected_data) = expected_plan.get("data") else {
            assert!(
                expected_plan.get("data").is_some(),
                "expected plan should include data"
            );
            return;
        };
        assert_eq!(
            formatted_plan,
            expected_data.clone(),
            "valid MCP 설정은 pretty JSON을 반환해야 함",
        );
        assert_eq!(
            parse_json(&validate_mcp_json(r"{}"), "invalid root plan")
                .get("valid")
                .and_then(JsonValue::as_bool),
            Some(false),
        );
        assert_eq!(
            parse_json(
                &validate_mcp_json(r#"{"mcpServers":[]}"#),
                "invalid mcpServers type plan"
            )
            .get("errorCode")
            .and_then(|value| value.as_str()),
            Some("invalid-mcp-servers"),
        );
    }

    /// Ontology relation validation은 relation lookup, entity type 존재, domain/range를 Rust에서 판정한다.
    #[test]
    fn validate_ontology_relation_preserves_schema_contract() {
        let entity_type_ids = "person\0work\0place";
        let relation_type_ids = "authored\0mentions";
        let source_rows = "person\u{1f}any";
        let target_rows = "work\u{1f}any";

        assert_eq!(
            validate_ontology_relation(
                entity_type_ids,
                relation_type_ids,
                source_rows,
                target_rows,
                "authored",
                "person",
                "work",
            ),
            "valid",
            "valid domain/range relation should pass",
        );
        assert_eq!(
            validate_ontology_relation(
                entity_type_ids,
                relation_type_ids,
                source_rows,
                target_rows,
                "mentions",
                "place",
                "person",
            ),
            "valid",
            "any wildcard relation should pass",
        );
        assert_eq!(
            validate_ontology_relation(
                entity_type_ids,
                relation_type_ids,
                source_rows,
                target_rows,
                "missing",
                "person",
                "work",
            ),
            "unknown-relation-type",
            "unknown relation type mismatch",
        );
        assert_eq!(
            validate_ontology_relation(
                entity_type_ids,
                relation_type_ids,
                source_rows,
                target_rows,
                "authored",
                "person",
                "missing",
            ),
            "unknown-entity-type",
            "unknown entity type mismatch",
        );
        assert_eq!(
            validate_ontology_relation(
                entity_type_ids,
                relation_type_ids,
                source_rows,
                target_rows,
                "authored",
                "place",
                "person",
            ),
            "relation-domain-range-mismatch",
            "domain/range mismatch",
        );
    }

    /// Ontology schema validation은 기본 계약(필수 필드, 타입 참조 유효성)을 Rust에서 판정한다.
    #[test]
    fn validate_ontology_schema_json_reports_schema_contract_violations() {
        assert_eq!(
            validate_ontology_schema_json(
                r#"{"id":"default","name":"Default","version":1,"entityTypes":[{"id":"person"},{"id":"work"}],"relationTypes":[{"id":"authored","sourceTypeIds":["person"],"targetTypeIds":["work"]},{"id":"mentions","inverseRelationTypeId":"missing"}]}"#,
            ),
            r#"["unknown inverse relation type: missing"]"#,
            "unknown inverse relation should be reported",
        );
        assert_eq!(
            validate_ontology_schema_json(
                r#"{"id":"default","name":"Default","version":1,"entityTypes":[{"id":"person","parentTypeId":"missing"},{"id":"work"}],"relationTypes":[{"id":"authored","sourceTypeIds":["person"],"targetTypeIds":["place"]}]}"#,
            ),
            r#"["unknown parent entity type: missing","unknown relation target type: place"]"#,
            "parent/type references should be validated",
        );
        assert_eq!(
            validate_ontology_schema_json(
                "{\"id\":\"\",\"name\":\"\",\"version\":0,\"entityTypes\":[],\"relationTypes\":[]}"
            ),
            r#"["schema.id is required","schema.name is required","schema.version must be a positive integer"]"#,
            "required schema fields should be validated",
        );
        assert_eq!(
            validate_ontology_schema_json("{}"),
            r#"["schema.id is required","schema.name is required","schema.version must be a positive integer"]"#,
            "missing schema fields should be validated",
        );
        assert_eq!(
            validate_ontology_schema_json(
                r#"{"id":"default","name":"Default","version":1,"entityTypes":[{"id":"person"}],"relationTypes":[{"id":"authored","sourceTypeIds":["person"],"targetTypeIds":["work"]}]}"#,
            ),
            r#"["unknown relation target type: work"]"#,
            "target type not in entityType should fail",
        );
        assert_eq!(
            validate_ontology_schema_json(
                "{\"id\":\"default\",\"name\":\"Default\",\"version\":1,\"entityTypes\":[{\"id\":\"person\"}],\"relationTypes\":[]}",
            ),
            r"[]",
            "valid schema should pass",
        );
    }

    /// `GraphRAG` entity mention matching은 hint, 한국어 조사, schema filtering, 짧은 이름 boundary를 보존해야 한다.
    #[test]
    fn find_mentioned_entity_matches_preserves_query_contract() {
        let pairs = find_mentioned_entity_matches(
            "바울과 Barnabas 관계를 알려줘",
            "default",
            "default\0default\0other\0default",
            "Paul\0Barnabas\0Paul\0A",
            "바울\u{1f}바나바\u{1f}바울\u{1f}",
            "바울",
        );

        assert_eq!(pairs.len(), 4, "2개 entity match pair가 필요하다");
        for (offset, expected) in [0.0_f64, 1.0, 1.0, 0.94].iter().copied().enumerate() {
            assert_float_close(
                pair_value(&pairs, offset),
                expected,
                "entity match pair mismatch",
            );
        }

        assert!(
            find_mentioned_entity_matches(
                "Apostle에 대해 알려줘",
                "default",
                "default",
                "A",
                "",
                "",
            )
            .is_empty(),
            "짧은 이름은 단어 경계 없이 부분 문자열로 매칭되면 안 된다",
        );
    }

    /// deterministic `GraphRAG` query planner는 기존 query mode와 Latin entity hint 계약을 보존해야 한다.
    #[test]
    fn plan_graph_query_json_preserves_query_mode_contract() {
        assert_eq!(
            plan_graph_query_json("근거가 어디에 있어?"),
            "{\"type\":\"source-seeking\",\"queryMode\":\"local\",\"traversalDepth\":1,\"evidenceFirst\":true,\"entityHints\":[]}",
        );
        assert_eq!(
            plan_graph_query_json("Paul과 Barnabas의 차이를 비교해줘"),
            "{\"type\":\"comparative\",\"queryMode\":\"hybrid\",\"traversalDepth\":2,\"evidenceFirst\":false,\"entityHints\":[\"Paul\",\"Barnabas\"]}",
        );
        assert_eq!(
            plan_graph_query_json("평범한 질문"),
            "{\"type\":\"ordinary-rag\",\"queryMode\":\"none\",\"traversalDepth\":0,\"evidenceFirst\":false,\"entityHints\":[]}",
        );
    }

    /// `GraphRAG` query 실행 mode branching은 Rust policy plan을 따른다.
    #[test]
    fn plan_graph_query_execution_json_preserves_mode_policy() {
        assert_eq!(
            plan_graph_query_execution_json("global", "local", true),
            "{\"action\":\"global\",\"requiresPlanner\":false}",
        );
        assert_eq!(
            plan_graph_query_execution_json("local", "global", false),
            "{\"action\":\"local\",\"requiresPlanner\":true}",
        );
        assert_eq!(
            plan_graph_query_execution_json("hybrid", "none", false),
            "{\"action\":\"hybrid\",\"requiresPlanner\":true}",
        );
        assert_eq!(
            plan_graph_query_execution_json("auto", "none", false),
            "{\"action\":\"none\",\"requiresPlanner\":true}",
        );
        assert_eq!(
            plan_graph_query_execution_json("auto", "hybrid", false),
            "{\"action\":\"hybrid\",\"requiresPlanner\":true}",
        );
        assert_eq!(
            plan_graph_query_execution_json("auto", "global", true),
            "{\"action\":\"global\",\"requiresPlanner\":true}",
        );
        assert_eq!(
            plan_graph_query_execution_json("auto", "local", true),
            "{\"action\":\"evidence-first\",\"requiresPlanner\":true}",
        );
    }

    /// `GraphRAG` relation schema filtering은 Rust index plan을 따른다.
    #[test]
    fn plan_graph_schema_relation_indices_json_selects_matching_schema_rows() {
        assert_eq!(
            plan_graph_schema_relation_indices_json(
                r#"["daily-notes","project-notes","daily-notes","archive"]"#,
                "daily-notes",
            ),
            "[0,2]",
        );
        assert_eq!(
            plan_graph_schema_relation_indices_json(
                r#"["daily-notes","project-notes","daily-notes","archive"]"#,
                "missing-schema",
            ),
            "[]",
        );
    }

    /// `GraphRAG` community schema filtering은 Rust index plan을 따른다.
    #[test]
    fn plan_graph_schema_community_indices_json_selects_matching_schema_rows() {
        assert_eq!(
            plan_graph_schema_community_indices_json(
                r#"["daily-notes","project-notes","daily-notes","archive"]"#,
                "daily-notes",
            ),
            "[0,2]",
        );
        assert_eq!(
            plan_graph_schema_community_indices_json(
                r#"["daily-notes","project-notes","daily-notes","archive"]"#,
                "missing-schema",
            ),
            "[]",
        );
    }

    /// `GraphRAG` community replacement 삭제 id 선택은 Rust plan을 따른다.
    #[test]
    fn plan_graph_community_replacement_delete_ids_json_selects_matching_schema_ids() {
        assert_eq!(
            plan_graph_community_replacement_delete_ids_json(
                r#"[{"id":"community-a","ontologySchemaId":"daily-notes"},{"id":"community-b","ontologySchemaId":"project-notes"},{"id":"community-c","ontologySchemaId":"daily-notes"}]"#,
                "daily-notes",
            ),
            r#"["community-a","community-c"]"#,
        );
        assert_eq!(
            plan_graph_community_replacement_delete_ids_json(
                r#"[{"id":"community-a","ontologySchemaId":"daily-notes"}]"#,
                "missing-schema",
            ),
            "[]",
        );
    }

    /// `GraphRAG` LLM planner 응답 parse/normalization은 Rust가 담당한다.
    #[test]
    fn plan_graph_query_response_json_normalizes_llm_response() {
        assert_eq!(
            plan_graph_query_response_json(
                "응답입니다.\n```json\n{\"type\":\"relational\",\"queryMode\":\"hybrid\",\"traversalDepth\":2.8,\"evidenceFirst\":true,\"entityHints\":[\"Paul\",3,\" \",\"Barnabas\"]}\n```",
                "평범한 질문",
            ),
            "{\"type\":\"relational\",\"queryMode\":\"hybrid\",\"traversalDepth\":2,\"evidenceFirst\":true,\"entityHints\":[\"Paul\",\"Barnabas\"]}",
            "valid planner response should be normalized in Rust",
        );
        assert_eq!(
            plan_graph_query_response_json(
                "{\"type\":\"unknown\",\"queryMode\":\"bad\",\"traversalDepth\":-2,\"evidenceFirst\":true,\"entityHints\":[\"Paul\"]}",
                "평범한 질문",
            ),
            "{\"type\":\"ordinary-rag\",\"queryMode\":\"local\",\"traversalDepth\":0,\"evidenceFirst\":true,\"entityHints\":[\"Paul\"]}",
            "invalid fields should use planner parse defaults",
        );
        assert_eq!(
            plan_graph_query_response_json("not-json", "근거가 어디에 있어?"),
            "{\"type\":\"source-seeking\",\"queryMode\":\"local\",\"traversalDepth\":1,\"evidenceFirst\":true,\"entityHints\":[]}",
            "invalid raw response should use deterministic fallback plan",
        );
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

    /// vector runtime index는 row normalization을 한 번만 수행하고 top-k 계약을 보존해야 한다.
    #[test]
    fn vector_runtime_index_matches_exact_top_k_and_filter_contract() {
        let vectors = [
            0.0_f32, 1.0, // index 0, score 0
            1.0, 0.0, // index 1, score 1
            0.6, 0.8, // index 2, score 0.6
            0.0, 0.0, // index 3, invalid zero vector
        ];
        let index = VectorRuntimeIndex::new(&vectors, 2);

        assert_eq!(
            index.row_count(),
            4,
            "runtime index should retain row count"
        );
        assert_eq!(
            index.dimensions(),
            2,
            "runtime index should expose dimensions"
        );

        let pairs = index.rank_top_k(&[1.0_f32, 0.0], 3);
        assert_eq!(pairs.len(), 6, "top 3 rows should produce 3 pairs");
        assert_float_close(pair_value(&pairs, 0), 1.0, "best row index");
        assert_float_close(pair_value(&pairs, 1), 1.0, "best score");
        assert_float_near(pair_value(&pairs, 2), 2.0, "second row index");
        assert_float_close_f32(pair_value(&pairs, 3), 0.6, "second score");
        assert_float_close(pair_value(&pairs, 4), 0.0, "third row index");
        assert_float_close(pair_value(&pairs, 5), 0.0, "third score");

        let filtered = index.rank_top_k_filtered(&[1.0_f32, 0.0], &[2, 0], 4);
        assert_eq!(
            filtered.len(),
            4,
            "filter should limit candidates to requested rows"
        );
        assert_float_close(pair_value(&filtered, 0), 2.0, "filtered best row index");
        assert_float_close_f32(pair_value(&filtered, 1), 0.6, "filtered best score");
        assert_float_close(pair_value(&filtered, 2), 0.0, "filtered second row index");
        assert_float_close(pair_value(&filtered, 3), 0.0, "filtered second score");
    }

    /// IVF runtime index는 build/probe/scoring을 내부 상태로 처리하고 global row index를 반환해야 한다.
    #[test]
    fn ivf_runtime_index_queries_cluster_candidates_with_global_row_indices() {
        let vectors = [
            1.0_f32, 0.0, // index 0
            0.95, 0.05, // index 1
            0.0, 1.0, // index 2
            0.05, 0.95, // index 3
            0.0, 0.0, // index 4, invalid zero vector
        ];
        let index = IvfRuntimeIndex::new(&vectors, 2, 2, 4);

        assert_eq!(index.row_count(), 5, "IVF runtime should retain row count");
        assert_eq!(
            index.dimensions(),
            2,
            "IVF runtime should expose dimensions"
        );
        assert_eq!(
            index.cluster_count(),
            2,
            "requested cluster count should be applied"
        );

        let pairs = index.query(&[1.0_f32, 0.0], 2, 1);
        assert_eq!(pairs.len(), 4, "top 2 IVF rows should produce 2 pairs");
        assert_float_close(pair_value(&pairs, 0), 0.0, "best row index");
        assert_float_close(pair_value(&pairs, 1), 1.0, "best score");
        assert_float_close(pair_value(&pairs, 2), 1.0, "second row index");
        assert_float_close_f32(pair_value(&pairs, 3), 0.998_617_8, "second score");

        let wide_probe = index.query(&[0.0_f32, 1.0], 2, 2);
        assert_eq!(wide_probe.len(), 4, "wide probe should return 2 valid rows");
        assert_float_close(pair_value(&wide_probe, 0), 2.0, "wide probe best row");
        assert_float_close(pair_value(&wide_probe, 1), 1.0, "wide probe best score");
    }

    /// BM25 runtime index는 legacy JSON을 읽고 저장 시 compact v3 포맷으로 마이그레이션해야 한다.
    #[test]
    fn bm25_runtime_index_loads_legacy_and_serializes_compact_v3() {
        let legacy = r#"{"tokenizerVersion":2,"inverted":{"open":{"api.md::0":1},"router":{"api.md::0":1},"ollama":{"local.md::0":1}},"docLengths":{"api.md::0":3,"local.md::0":2},"docSources":{"api.md::0":"api.md","local.md::0":"local.md"},"totalDocs":2,"avgDocLength":2.5}"#;
        let mut index = Bm25RuntimeIndex::from_json(legacy, 2);

        assert!(
            index.is_ready(),
            "legacy payload should hydrate runtime state"
        );
        assert_eq!(
            index.total_docs(),
            2,
            "legacy doc count should be preserved"
        );
        let before = index.search_json("open router");
        assert!(
            before.contains("\"docId\":\"api.md::0\""),
            "legacy search should find migrated document; got {before}",
        );

        index.add_document("new.md::0", "GraphRAG open router evidence", "new.md", 2);
        index.remove_document("local.md::0", 2);
        let after = index.search_json("graph rag open");
        assert!(
            after.contains("\"docId\":\"new.md::0\""),
            "runtime mutation should affect searches without reloading JSON; got {after}",
        );
        assert!(
            !after.contains("local.md::0"),
            "removed document should not appear in runtime search; got {after}",
        );

        let serialized = index.to_json();
        let parsed = serde_json::from_str::<JsonValue>(&serialized).unwrap_or(JsonValue::Null);
        assert!(parsed.is_object(), "compact BM25 JSON should parse");
        assert_eq!(
            parsed.get("schemaVersion").and_then(JsonValue::as_u64),
            Some(3),
            "persisted BM25 payload should use compact v3 schema",
        );
        assert!(
            parsed.get("docs").and_then(JsonValue::as_array).is_some(),
            "compact v3 payload should contain docs array",
        );
        assert!(
            parsed.get("terms").and_then(JsonValue::as_array).is_some(),
            "compact v3 payload should contain terms array",
        );
        assert!(
            parsed.get("inverted").is_none(),
            "compact v3 payload should not persist legacy inverted object",
        );
    }

    /// BM25 runtime append 경로는 새 문서를 교체 스캔 없이 추가해 검색 가능하게 해야 한다.
    #[test]
    fn bm25_runtime_index_add_new_document_appends_searchable_document() {
        let mut index = Bm25RuntimeIndex::new(2);

        index.add_new_document("api.md::0", "OpenRouter API access key", "api.md", 2);
        index.add_new_document("local.md::0", "Ollama local model", "local.md", 2);

        let open_router = index.search_json("open router");
        assert!(
            open_router.contains("\"docId\":\"api.md::0\""),
            "append 경로는 첫 번째 문서를 검색 가능하게 만들어야 한다: {open_router}",
        );

        let ollama = index.search_json("ollama");
        assert!(
            ollama.contains("\"docId\":\"local.md::0\""),
            "append 경로는 두 번째 문서를 검색 가능하게 만들어야 한다: {ollama}",
        );
    }

    /// BM25 제한 검색은 전체 검색 결과 중 상위 score만 WASM 경계 밖으로 내보내야 한다.
    #[test]
    fn bm25_runtime_index_search_top_json_limits_to_highest_scores() {
        let mut index = Bm25RuntimeIndex::new(2);
        for doc_index in 0..8_usize {
            let doc_id = format!("doc-{doc_index}.md::0");
            let source_path = format!("doc-{doc_index}.md");
            let repeated_terms = "alpha ".repeat(doc_index.saturating_add(1));
            let text = format!("{repeated_terms}beta");
            index.add_new_document(&doc_id, &text, &source_path, 2);
        }

        let all_scores = parse_bm25_score_test_json(&index.search_json("alpha beta"));
        let mut ranked_scores = all_scores.iter().enumerate().collect::<Vec<_>>();
        ranked_scores.sort_by(|(left_sequence, left), (right_sequence, right)| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left_sequence.cmp(right_sequence))
        });
        let expected_doc_ids = ranked_scores
            .iter()
            .take(3)
            .map(|(_, score)| score.doc_id.clone())
            .collect::<Vec<_>>();
        let limited_doc_ids = parse_bm25_score_test_json(&index.search_top_json("alpha beta", 3))
            .into_iter()
            .map(|score| score.doc_id)
            .collect::<Vec<_>>();

        assert_eq!(
            limited_doc_ids, expected_doc_ids,
            "제한 검색은 전체 결과를 JS로 넘기지 않고 상위 BM25 hit만 반환해야 한다",
        );
    }

    /// RAG core hot path의 deterministic median benchmark를 출력한다.
    #[ignore = "manual benchmark: run fish scripts/bench-rag-core.fish"]
    #[test]
    fn bench_rag_core_runtime_medians() {
        let dimensions = 64_usize;
        let row_count = 2_048_usize;
        let vectors = fixture_vectors_f32(row_count, dimensions);
        let query = fixture_query_f32(dimensions);
        let vector_index = VectorRuntimeIndex::new(&vectors, dimensions);
        let vector_exact_ns = measure_median_nanos(40, || {
            std::hint::black_box(vector_index.rank_top_k(&query, 16));
        });

        let ivf_build_ns = measure_median_nanos(12, || {
            let index = IvfRuntimeIndex::new(&vectors, dimensions, 32, 4);
            std::hint::black_box(index.cluster_count());
        });
        let ivf_index = IvfRuntimeIndex::new(&vectors, dimensions, 32, 4);
        let ivf_query_ns = measure_median_nanos(40, || {
            std::hint::black_box(ivf_index.query(&query, 16, 4));
        });

        let bm25_add_search_ns = measure_median_nanos(12, || {
            let mut index = Bm25RuntimeIndex::new(2);
            for doc_index in 0..1_000_usize {
                let doc_id = format!("doc-{doc_index}.md::0");
                let source_path = format!("doc-{doc_index}.md");
                let group = doc_index
                    .checked_rem(17)
                    .map_or_else(|| "0".to_owned(), |value| value.to_string());
                let text = format!("alpha beta graph rag evidence group-{group} doc-{doc_index}");
                index.add_new_document(&doc_id, &text, &source_path, 2);
            }
            std::hint::black_box(index.search_json("alpha graph evidence"));
        });

        let markdown = fixture_markdown_2mb();
        let markdown_chunk_ns = measure_median_nanos(12, || {
            std::hint::black_box(chunk_markdown(&markdown, 1_200, 120));
        });

        let mut stdout = std::io::stdout().lock();
        if !write_bench_line(&mut stdout, "vector_exact_query", vector_exact_ns) {
            return;
        }
        if !write_bench_line(&mut stdout, "ivf_build", ivf_build_ns) {
            return;
        }
        if !write_bench_line(&mut stdout, "ivf_query", ivf_query_ns) {
            return;
        }
        if !write_bench_line(&mut stdout, "bm25_add_search", bm25_add_search_ns) {
            return;
        }
        let _ = write_bench_line(&mut stdout, "markdown_chunk_2mb", markdown_chunk_ns);
    }

    /// recall@k는 exact top-k unique set 대비 approximate top-k hit 비율을 계산해야 한다.
    #[test]
    fn recall_at_k_preserves_ann_metric_contract() {
        assert_float_close(
            recall_at_k(&[0, 1, 2], &[2, u32::MAX, 0], 3),
            2.0 / 3.0,
            "two approximate hits out of three exact ids",
        );
        assert_float_close(
            recall_at_k(&[0, 0, 1], &[0, 1], 3),
            1.0,
            "duplicate exact ids should only count once in denominator",
        );
        assert_float_close(recall_at_k(&[0], &[0], 0), 0.0, "k=0 recall should be zero");
    }

    /// ANN cluster assignment는 기존 `TypeScript` IVF build의 nearest-centroid 선택을 보존해야 한다.
    #[test]
    fn assign_vector_clusters_matches_typescript_ivf_assignment() {
        let vectors = [
            1.0, 0.0, // cluster 0
            0.0, 1.0, // cluster 1
            0.8, 0.2, // cluster 0
            0.0, 0.0, // invalid cosine, TS 기본값 cluster 0
        ];
        let centroids = [
            1.0, 0.0, // cluster 0
            0.0, 1.0, // cluster 1
        ];

        let assignments = assign_vector_clusters(&vectors, &centroids, 2);

        assert_eq!(assignments.len(), 4, "4개 vector assignment가 필요하다");
        for (offset, expected) in [0.0_f64, 1.0, 0.0, 0.0].iter().copied().enumerate() {
            assert_float_close(
                pair_value(&assignments, offset),
                expected,
                "cluster assignment mismatch",
            );
        }
    }

    /// ANN 초기 centroid 선택은 cluster 수 결정과 균등 샘플링을 Rust에서 담당해야 한다.
    #[test]
    fn build_initial_centroids_resolves_count_and_samples_evenly() {
        let vectors = [
            1.0, 0.0, // index 0
            0.7, 0.3, // index 1
            0.0, 1.0, // index 2
            -1.0, 0.0, // index 3
            0.0, -1.0, // index 4
        ];

        let centroids = build_initial_centroids(&vectors, 2, 3);

        assert_eq!(centroids.len(), 6, "3개 centroid의 flat matrix가 필요하다");
        for (offset, expected) in [1.0_f64, 0.0, 0.0, 1.0, 0.0, -1.0]
            .iter()
            .copied()
            .enumerate()
        {
            assert_float_close(
                pair_value(&centroids, offset),
                expected,
                "initial centroid mismatch",
            );
        }

        let auto_vectors = (0..20)
            .flat_map(|index| [f64::from(index), f64::from(index + 1)])
            .collect::<Vec<_>>();
        let auto_centroids = build_initial_centroids(&auto_vectors, 2, 0);

        assert_eq!(
            auto_centroids.len(),
            8,
            "sqrt(20) 반올림으로 4개 centroid가 필요하다",
        );
        assert_float_close(pair_value(&auto_centroids, 0), 0.0, "first x");
        assert_float_close(pair_value(&auto_centroids, 1), 1.0, "first y");
        assert_float_close(pair_value(&auto_centroids, 6), 19.0, "last x");
        assert_float_close(pair_value(&auto_centroids, 7), 20.0, "last y");
    }

    /// ANN centroid recompute는 빈 cluster의 이전 centroid 보존 계약을 유지해야 한다.
    #[test]
    fn recompute_centroids_preserves_empty_clusters() {
        let vectors = [
            1.0, 0.0, // cluster 0
            0.5, 0.5, // cluster 0
            0.0, 1.0, // cluster 2
        ];
        let assignments = [0_u32, 0, 2];
        let previous_centroids = [
            9.0, 9.0, // overwritten by average
            8.0, 8.0, // preserved because cluster 1 is empty
            7.0, 7.0, // overwritten by average
        ];

        let centroids = recompute_centroids(&vectors, &assignments, &previous_centroids, 2);

        assert_eq!(centroids.len(), 6, "3개 centroid의 flat matrix가 필요하다");
        for (offset, expected) in [0.75_f64, 0.25, 8.0, 8.0, 0.0, 1.0]
            .iter()
            .copied()
            .enumerate()
        {
            assert_float_close(
                pair_value(&centroids, offset),
                expected,
                "recomputed centroid mismatch",
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

    /// RRF score는 retrieval source별 weight와 rank smoothing을 보존해야 한다.
    #[test]
    fn rrf_score_matches_typescript_source_weights() {
        let score = rrf_score_or_nan(
            &[SOURCE_VECTOR, SOURCE_BM25, SOURCE_STRUCTURAL],
            &[1.0, 3.0, 2.0],
            0.3,
        );
        let weighted = 0.12_f64.mul_add(
            1.0 / (60.0 + 2.0),
            0.3_f64.mul_add(1.0 / (60.0 + 3.0), 0.7 * (1.0 / (60.0 + 1.0))),
        );
        let total = 0.12_f64.mul_add(
            1.0 / (60.0 + 1.0),
            0.3_f64.mul_add(1.0 / (60.0 + 1.0), 0.7 * (1.0 / (60.0 + 1.0))),
        );

        assert_float_close(score, weighted / total, "RRF score mismatch");
    }

    /// 강한 graph/evidence source는 hybrid score floor/cap 경로를 적용해야 한다.
    #[test]
    fn hybrid_score_preserves_strong_graph_evidence_floor() {
        let score = hybrid_score_or_nan(0.2, 0.5, 0.1, 0.8, 3.0, &[SOURCE_GRAPH_EVIDENCE]);

        assert_float_close(
            score,
            0.5_f64.mul_add(0.08, 0.8_f64.mul_add(0.25, 0.58)),
            "strong graph evidence score mismatch",
        );
    }

    /// retrieval source 요약은 graph/structural/ANN 보정을 Rust에서 계산해야 한다.
    #[test]
    fn analyze_retrieval_sources_returns_evidence_and_prior_summary() {
        let analysis = analyze_retrieval_sources(
            &[SOURCE_ANN, SOURCE_STRUCTURAL, SOURCE_GRAPH_EVIDENCE],
            &[0.7, 0.9, 0.8],
            &[f64::NAN, 4.0, 2.0],
        );

        assert_eq!(
            analysis.len(),
            5,
            "source analysis는 5개 값을 반환해야 한다"
        );
        assert_float_close(
            pair_value(&analysis, 0),
            0.28,
            "graph prior가 가장 커야 한다",
        );
        assert_float_close(
            pair_value(&analysis, 1),
            0.9,
            "structural score도 evidence score에 포함한다",
        );
        assert_float_close(
            pair_value(&analysis, 2),
            2.0,
            "best evidence rank는 최솟값이어야 한다",
        );
        assert_float_close(
            pair_value(&analysis, 3),
            1.0,
            "graph/structural flag가 켜져야 한다",
        );
        assert_float_close(
            pair_value(&analysis, 4),
            1.0,
            "강한 근거 flag가 켜져야 한다",
        );
    }

    /// RAG query result score row는 base/source/RRF/hybrid 계산을 Rust plan 하나로 만든다.
    #[test]
    fn query_result_score_plan_is_planned_in_rust() {
        let rrf = rrf_score_or_nan(
            &[SOURCE_GRAPH_EVIDENCE, SOURCE_STRUCTURAL, SOURCE_VECTOR],
            &[2.0, 4.0, 1.0],
            0.3,
        );
        let output = plan_query_result_score_json(
            r#"{"cosineScore":0.2,"bm25Score":0.4,"bm25Weight":0.3,"hasBm25":true,"sourceScores":{"ann":0.7,"structural":0.9,"graph-local":0.8},"sourceRanks":{"vector":1,"structural":4,"graph-local":2},"retrievalSources":["vector","graph-local"]}"#,
        );
        let value = serde_json::from_str::<JsonValue>(&output).unwrap_or(JsonValue::Null);

        assert_float_close(
            json_number_field(&value, "combinedBase"),
            0.26,
            "combined base mismatch",
        );
        assert_float_close(
            json_number_field(&value, "rrfScore"),
            rrf,
            "RRF plan mismatch",
        );
        assert_float_close(
            json_number_field(&value, "sourcePrior"),
            0.28,
            "source prior mismatch",
        );
        assert_float_close(
            json_number_field(&value, "sourceEvidenceScore"),
            0.9,
            "source evidence mismatch",
        );
        assert_float_close(
            json_number_field(&value, "bestEvidenceRank"),
            2.0,
            "best evidence rank mismatch",
        );
        assert_eq!(
            json_bool_field(&value, "hasGraphOrStructuralEvidence"),
            Some(true),
            "graph evidence flag mismatch",
        );
        assert_eq!(
            json_bool_field(&value, "hasStrongGraphOrStructuralEvidence"),
            Some(true),
            "strong evidence flag mismatch",
        );
        assert_float_close(
            json_number_field(&value, "combinedScore"),
            rrf.mul_add(0.08, 0.9_f64.mul_add(0.25, 0.58)).min(0.88),
            "combined score mismatch",
        );
        assert_eq!(
            value.get("selectionReason").and_then(JsonValue::as_str),
            Some("strong-graph-evidence"),
            "selection reason should explain graph evidence priority",
        );
    }

    /// RAG relevance 판단은 graph/evidence, BM25 keyword, semantic threshold 계약을 보존해야 한다.
    #[test]
    fn is_relevant_result_preserves_rag_filtering_contract() {
        assert!(
            is_relevant_result(
                &[0.1, -1.0, 0.0, 0.0, 0.5, 0.0, 0.8, 3.0],
                &[SOURCE_GRAPH_EVIDENCE],
            ),
            "강한 graph evidence 후보는 낮은 vector score라도 유지되어야 한다",
        );
        assert!(
            is_relevant_result(
                &[0.6, 0.2, 0.5, 1.0, 0.5, 1.0, 0.0, f64::NAN],
                &[SOURCE_BM25],
            ),
            "BM25 점수와 keyword match가 함께 있으면 유지되어야 한다",
        );
        assert!(
            !is_relevant_result(
                &[0.2, 0.2, 0.0, 0.0, 0.5, 1.0, 0.0, f64::NAN],
                &[SOURCE_BM25],
            ),
            "점수와 keyword 근거가 모두 약하면 제외되어야 한다",
        );
    }

    /// RAG 최종 후보 선택은 score 정렬, relative threshold, graph source-aware threshold를 Rust에서 계산한다.
    #[test]
    fn select_relevant_result_indices_preserves_query_window_contract() {
        let source_offsets = [0_u32, 1, 2, 3, 4, 5];
        let source_codes = [
            SOURCE_VECTOR,
            SOURCE_VECTOR,
            SOURCE_GRAPH_EVIDENCE,
            SOURCE_BM25,
            SOURCE_VECTOR,
        ];
        let indexes = select_relevant_result_indices(
            &[0.5, 1.0],
            &source_offsets,
            &source_codes,
            &[
                0.9,
                0.9,
                0.0,
                0.0,
                0.0,
                f64::NAN, // index 0
                0.7,
                0.7,
                0.0,
                0.0,
                0.0,
                f64::NAN, // index 1
                0.5,
                0.2,
                0.0,
                0.0,
                0.7,
                2.0, // index 2
                0.49,
                0.2,
                0.7,
                1.0,
                0.0,
                f64::NAN, // index 3
                0.3,
                0.3,
                0.0,
                0.0,
                0.0,
                f64::NAN, // index 4
            ],
        );

        assert_eq!(indexes.len(), 2, "2개 result index가 필요하다");
        assert_float_close(
            pair_value(&indexes, 0),
            0.0,
            "best vector result should stay first",
        );
        assert_float_close(
            pair_value(&indexes, 1),
            2.0,
            "strong graph result should survive source-aware threshold",
        );
    }

    /// retrieval 후보 병합은 entry 첫 등장 순서, source 첫 등장 순서, score/rank merge 계약을 보존해야 한다.
    #[test]
    fn plan_merged_retrieval_candidates_preserves_source_merge_contract() {
        let plan = plan_merged_retrieval_candidates(
            &[0_u32, 1, 0, 0],
            &[SOURCE_VECTOR, SOURCE_BM25, SOURCE_BM25, SOURCE_VECTOR],
            &[0.4, 0.8, 0.9, 0.6],
            &[2.0, 1.0, 1.0, 3.0],
        );

        let expected = [
            0.0,
            0.0,
            2.0,
            3.0,
            f64::from(SOURCE_VECTOR),
            0.6,
            2.0,
            f64::from(SOURCE_BM25),
            0.9,
            1.0,
            0.0,
            2.0,
            3.0,
            1.0,
            1.0,
            1.0,
            1.0,
            f64::from(SOURCE_BM25),
            0.8,
            1.0,
            1.0,
        ];
        assert_eq!(
            plan.len(),
            expected.len(),
            "merge plan length가 같아야 한다"
        );
        for (index, expected_value) in expected.iter().copied().enumerate() {
            assert_float_close(
                pair_value(&plan, index),
                expected_value,
                "merge plan value should match",
            );
        }
    }

    /// retrieval 후보 병합은 `entry id` first-seen grouping도 Rust에서 계산해야 한다.
    #[test]
    fn plan_merged_retrieval_candidates_by_entry_id_preserves_grouping_contract() {
        let plan = plan_merged_retrieval_candidates_by_entry_id(
            r#"["note-a#1","note-b#1","note-a#1","note-a#1"]"#,
            &[SOURCE_VECTOR, SOURCE_BM25, SOURCE_BM25, SOURCE_VECTOR],
            &[0.4, 0.8, 0.9, 0.6],
            &[2.0, 1.0, 1.0, 3.0],
        );

        let expected = [
            0.0,
            0.0,
            2.0,
            3.0,
            f64::from(SOURCE_VECTOR),
            0.6,
            2.0,
            f64::from(SOURCE_BM25),
            0.9,
            1.0,
            0.0,
            2.0,
            3.0,
            1.0,
            1.0,
            1.0,
            1.0,
            f64::from(SOURCE_BM25),
            0.8,
            1.0,
            1.0,
        ];
        assert_eq!(
            plan.len(),
            expected.len(),
            "entry id merge plan length가 같아야 한다"
        );
        for (index, expected_value) in expected.iter().copied().enumerate() {
            assert_float_close(
                pair_value(&plan, index),
                expected_value,
                "entry id merge plan value should match",
            );
        }
    }

    /// BM25 provider의 hit 제한, stale id repair, source score 계산은 Rust plan이 담당한다.
    #[test]
    fn bm25_candidate_resolution_repairs_stale_document_ids() {
        let lookup = plan_bm25_hit_lookup_json(
            r#"[{"docId":"low","sourcePath":"low.md","score":0.2},{"docId":"stale","sourcePath":"keyword.md","score":0.8},{"docId":"high","sourcePath":"high.md","score":1.2}]"#,
            1,
            2,
        );

        assert_eq!(
            lookup,
            r#"{"hits":[{"docId":"high","sourcePath":"high.md","score":1.2},{"docId":"stale","sourcePath":"keyword.md","score":0.8}],"lookupDocIds":["high","stale"],"maxScore":1.2}"#,
            "상위 BM25 hit lookup plan이 score 순서를 보존해야 한다",
        );
        assert_eq!(
            plan_bm25_source_lookups_json(
                r#"[{"docId":"high","sourcePath":"high.md","score":1.2},{"docId":"stale","sourcePath":"keyword.md","score":0.8}]"#,
                r#"["high"]"#,
            ),
            r#"["keyword.md"]"#,
            "id lookup에서 빠진 hit의 source path만 조회해야 한다",
        );
        assert_eq!(
            plan_bm25_candidate_resolution_json(
                r#"[{"docId":"high","sourcePath":"high.md","score":1.2},{"docId":"stale","sourcePath":"keyword.md","score":0.8}]"#,
                r#"[{"id":"high","filePath":"high.md","compatible":true}]"#,
                r#"[{"id":"keyword.md::1","filePath":"keyword.md","compatible":true},{"id":"keyword.md::2","filePath":"keyword.md","compatible":true}]"#,
                2,
                1.2,
            ),
            r#"[{"entrySet":"found","entryIndex":0,"sourceScore":1},{"entrySet":"path","entryIndex":0,"sourceScore":0.6666666666666667}]"#,
            "stale hit은 source file path의 현재 entry로 복구되어야 한다",
        );
    }

    /// structural retrieval의 link/backlink/heading-neighbor 선택은 Rust plan이 담당한다.
    #[test]
    fn structural_retrieval_plans_links_and_heading_neighbors() {
        assert_eq!(
            plan_structural_linked_paths_json(
                r#"["seed.md"]"#,
                r#"[{"sourcePath":"seed.md","targetPath":"linked.md"},{"sourcePath":"backlink.md","targetPath":"seed.md"},{"sourcePath":"seed.md","targetPath":"linked.md"},{"sourcePath":"seed.md","targetPath":"seed.md"},{"sourcePath":"seed.md","targetPath":"cache-target.md"}]"#,
            ),
            r#"["linked.md","backlink.md","cache-target.md"]"#,
            "link/backlink target path는 순서 보존 dedupe를 적용해야 한다",
        );
        assert_eq!(
            plan_structural_heading_neighbors_json(
                r#"[{"id":"seed.md::12","filePath":"seed.md","startLine":12,"endLine":12,"heading":"Main"}]"#,
                r#"[{"id":"seed.md::12","filePath":"seed.md","startLine":12,"compatible":true,"heading":"Main"},{"id":"seed.md::18","filePath":"seed.md","startLine":18,"compatible":true,"heading":"Main"},{"id":"seed.md::24","filePath":"seed.md","startLine":24,"compatible":true,"heading":"Sub"},{"id":"seed.md::40","filePath":"seed.md","startLine":40,"compatible":true,"heading":"Other"},{"id":"seed.md::41","filePath":"seed.md","startLine":41,"compatible":false,"heading":"Main"}]"#,
                r#"[{"filePath":"seed.md","startLine":10,"level":2},{"filePath":"seed.md","startLine":20,"level":3},{"filePath":"seed.md","startLine":35,"level":2}]"#,
            ),
            "[1]",
            "seed와 같은 heading range/heading label을 만족하는 entry index만 반환해야 한다",
        );
    }

    /// LLM reranker 응답 파싱과 최종 result order plan은 Rust가 담당한다.
    #[test]
    fn reranker_response_and_result_order_are_planned_in_rust() {
        assert_eq!(
            plan_rerank_messages_json(
                "What changed?",
                r#"[{"id":"a.md::0","sourcePath":"a.md","heading":"Intro","text":"short text"},{"id":"b.md::0","sourcePath":"b.md","heading":"","text":"  abcdefghij  "}]"#,
                6,
            ),
            r#"{"systemContent":"You rerank retrieval candidates for an Obsidian RAG answer. Return JSON only: {\"rankedIds\":[\"candidate-id\"]}. Rank candidates by direct usefulness as answer evidence. Do not invent ids.","userContent":"{\"question\":\"What changed?\",\"candidates\":[{\"id\":\"a.md::0\",\"index\":0,\"sourcePath\":\"a.md\",\"heading\":\"Intro\",\"text\":\"short...\"},{\"id\":\"b.md::0\",\"index\":1,\"sourcePath\":\"b.md\",\"heading\":\"\",\"text\":\"abcd...\"}]}"}"#,
        );
        assert_eq!(
            plan_rerank_response_json(
                "결과입니다.\n```json\n{\"rankedIds\":[\"b\",\"missing\",\"a\",\"b\",3,\"c\"]}\n```",
                r#"["a","b","c"]"#,
            ),
            r#"{"rankedIds":["b","a","c"],"rerankStatus":"applied"}"#,
            "허용 id만 순서 보존 dedupe로 반환해야 한다",
        );
        assert_eq!(
            plan_rerank_response_json("not-json", r#"["a"]"#),
            r#"{"rankedIds":[],"rerankStatus":"invalid-json"}"#,
            "invalid LLM JSON 응답은 빈 rank plan으로 닫혀야 한다",
        );
        assert_eq!(
            plan_rerank_result_order_json(r#"["a","b","c","d"]"#, r#"["b","a","b","missing"]"#),
            "[1,0,2,3]",
            "ranked id 이후 나머지 후보는 원래 순서로 붙어야 한다",
        );
        assert_eq!(
            plan_rerank_result_order_json(r#"["a","b"]"#, "[]"),
            "[0,1]",
            "ranked id가 없으면 원래 순서를 유지해야 한다",
        );
    }

    /// MMR diversity selection은 같은 파일/heading 후보보다 다른 파일 후보를 우선할 수 있어야 한다.
    #[test]
    fn select_diverse_indices_applies_same_file_penalty() {
        let scores = [1.0, 0.99, 0.96];
        let vectors = [
            1.0, 0.0, // index 0
            0.999, 0.001, // index 1
            0.96, 0.28, // index 2
        ];
        let source_keys = [1_u32, 1, 2];
        let heading_keys = [1_u32, 1, 0];

        let indexes = select_diverse_indices(&scores, &vectors, 2, &source_keys, &heading_keys, 2);

        assert_eq!(indexes.len(), 2, "top 2 index가 필요하다");
        assert_float_close(
            pair_value(&indexes, 0),
            0.0,
            "첫 후보는 최고 score여야 한다",
        );
        assert_float_close(
            pair_value(&indexes, 1),
            2.0,
            "두 번째 후보는 같은 파일 중복보다 다른 파일이어야 한다",
        );
    }

    /// MMR diversity selection의 source/heading string keying도 `Rust`가 담당한다.
    #[test]
    fn plan_diverse_result_indices_json_keys_source_and_heading_strings() {
        assert_eq!(
            plan_diverse_result_indices_json(
                r#"[{"score":1,"vector":[1,0],"sourcePath":"same.md","heading":"A"},{"score":0.99,"vector":[0.999,0.001],"sourcePath":"same.md","heading":"A"},{"score":0.96,"vector":[0.96,0.28],"sourcePath":"other.md"}]"#,
                2,
            ),
            "[0,2]",
        );
    }

    /// `GraphRAG` community detection은 강한 내부 edge를 기준으로 node assignment를 나눠야 한다.
    #[test]
    fn detect_communities_flat_returns_assignments_and_modularity() {
        let source_indices = [0_u32, 2, 1];
        let target_indices = [1_u32, 3, 2];
        let weights = [1.0, 1.0, 0.1];

        let output = detect_communities_flat(&source_indices, &target_indices, &weights, 4, 20);

        assert_eq!(
            output.len(),
            5,
            "modularity와 4개 node assignment가 필요하다",
        );
        assert!(
            pair_value(&output, 0) > 0.0,
            "두 cluster graph의 modularity는 양수여야 한다; got {output:?}",
        );
        for (offset, expected) in [0.0_f64, 0.0, 1.0, 1.0].iter().copied().enumerate() {
            assert_float_close(
                pair_value(&output, offset.saturating_add(1)),
                expected,
                "community assignment mismatch",
            );
        }
    }

    /// `GraphRAG` community detection의 string edge keying과 assignment mapping은 `Rust`가 담당한다.
    #[test]
    fn detect_communities_from_edges_json_maps_string_edges_to_assignments() {
        let plan = detect_communities_from_edges_json(
            r#"[{"source":"paul","target":"barnabas","weight":1},{"source":"mark","target":"luke","weight":1},{"source":"barnabas","target":"mark","weight":0.1}]"#,
            20,
        );

        assert_eq!(
            plan,
            r#"{"assignmentsById":[{"entityId":"barnabas","communityId":1},{"entityId":"luke","communityId":0},{"entityId":"mark","communityId":0},{"entityId":"paul","communityId":1}],"communityIds":[0,1],"modularity":0.7029478458049887}"#,
        );
    }

    /// `GraphRAG` relation edge 집계는 무방향 endpoint pair와 첫 출현 순서를 보존해야 한다.
    #[test]
    fn aggregate_graph_edges_flat_sums_unordered_endpoint_pairs() {
        let source_indices = [2_u32, 1, 2, 0];
        let target_indices = [1_u32, 2, 0, 3];
        let confidences = [0.4, 0.6, 0.2, 0.9];

        let output = aggregate_graph_edges_flat(&source_indices, &target_indices, &confidences, 4);

        assert_eq!(output.len(), 9, "3개 edge triple이 필요하다");
        for (offset, expected) in [1.0_f64, 2.0, 1.0, 0.0, 2.0, 0.2, 0.0, 3.0, 0.9]
            .iter()
            .copied()
            .enumerate()
        {
            assert_float_near(
                pair_value(&output, offset),
                expected,
                "aggregated edge triple mismatch",
            );
        }
    }

    /// `GraphRAG` relation edge record는 entity id 정렬과 endpoint lookup을 Rust에서 계산해야 한다.
    #[test]
    fn graph_edge_records_are_planned_from_string_endpoints() {
        assert_eq!(
            plan_graph_edge_records_json(
                r#"["entity::b","entity::a","entity::c"]"#,
                r#"["entity::b","entity::a","entity::b","entity::c"]"#,
                r#"["entity::a","entity::b","missing","entity::a"]"#,
                r"[0.4,0.6,0.9,0.2]",
            ),
            r#"[{"source":"entity::a","target":"entity::b","weight":1},{"source":"entity::a","target":"entity::c","weight":0.2}]"#,
        );
    }

    /// Graph store pruning은 삭제/업데이트할 record index를 기존 TypeScript 계약과 같이 계산해야 한다.
    #[test]
    fn prune_graph_indexes_json_matches_store_pruning_contract() {
        let config = [
            1_u32, // file paths
            2,     // evidence
            3,     // entities
            4,     // entity evidence refs
            2,     // relations
            3,     // relation evidence refs
            2,     // claims
            4,     // claim entity refs
            3,     // claim relation refs
            3,     // claim evidence refs
            2,     // communities
            2,     // community entity refs
            1,     // community relation refs
            1,     // community claim refs
            2,     // rejected facts
            2,     // extraction cache
            2,     // pending merges
        ];
        let indices = [
            0, 1, 3, 4, // entity evidence offsets
            0, 0, 1, 1, // entity evidence indices
            0, 1, // relation source entities
            1, 2, // relation target entities
            0, 1, 3, // relation evidence offsets
            0, 0, 1, // relation evidence indices
            0, 1, 4, // claim entity offsets
            0, 0, 1, 2, // claim entity indices
            0, 1, 3, // claim relation offsets
            0, 0, 1, // claim relation indices
            0, 1, 3, // claim evidence offsets
            0, 0, 1, // claim evidence indices
            0, 1, 2, // community entity offsets
            0, 2, // community entity indices
            0, 1, 1, // community relation offsets
            0, // community relation indices
            0, 1, 1, // community claim offsets
            0, // community claim indices
            0, 2, // pending existing entity indices
            2, 1, // pending candidate entity indices
        ];
        let wire_values = [
            "old.md",
            "old.md\0keep.md",
            "old.md::0\0keep.md::0",
            "default\0default\0default",
            "default\0default",
            "default\0other",
            "old.md\0keep.md",
            "old.md::0\0keep.md::0",
            "old.md::0\0keep.md::0",
        ]
        .join("\u{1f}");

        let plan = prune_graph_indexes_json(&config, &indices, &wire_values);

        assert_eq!(
            plan,
            "{\"deletedEvidenceIndices\":[0],\"deletedEntityIndices\":[0],\"updatedEntityIndices\":[1],\"updatedEntityEvidenceIndices\":[[1]],\"deletedRelationIndices\":[0],\"updatedRelationIndices\":[1],\"updatedRelationEvidenceIndices\":[[1]],\"deletedClaimIndices\":[0],\"updatedClaimIndices\":[1],\"updatedClaimEntityIndices\":[[1,2]],\"updatedClaimRelationIndices\":[[1]],\"updatedClaimEvidenceIndices\":[[1]],\"deletedCommunityIndices\":[0],\"deletedRejectedFactIndices\":[0],\"deletedExtractionCacheIndices\":[0],\"deletedPendingMergeIndices\":[0]}",
        );
    }

    /// `GraphRAG` local evidence scoring은 entity/relation/claim evidence 점수를 보존해야 한다.
    #[test]
    fn score_local_evidence_pairs_matches_typescript_formula() {
        let config = [3_u32, 5, 2, 1, 1, 2, 2, 2, 2, 2];
        let indices = [
            0_u32, // match entity
            0, 1, // match evidence offsets
            0, // match evidence
            0, 1, // relation sources
            1, 2, // relation targets
            0, 1, 2, // relation evidence offsets
            1, 2, // relation evidence
            0, 1, 2, // claim entity offsets
            0, 1, // claim entities
            0, 1, 2, // claim evidence offsets
            3, 4, // claim evidence
        ];
        let values = [
            0.9, // match score
            0.8, 0.7, // relation confidence
            0.6, 0.5, // claim confidence
        ];

        let pairs = score_local_evidence_pairs(&config, &indices, &values);

        assert_eq!(
            pairs.len(),
            18,
            "9개 raw evidence index/score pair가 필요하다"
        );
        for (offset, expected_index) in [0.0_f64, 1.0, 3.0, 3.0, 3.0, 1.0, 2.0, 4.0, 4.0]
            .iter()
            .copied()
            .enumerate()
        {
            assert_float_close(
                pair_value(&pairs, offset.saturating_mul(2)),
                expected_index,
                "evidence index mismatch",
            );
        }
        assert_float_near(
            pair_value(&pairs, 1),
            0.865,
            "direct evidence score mismatch",
        );
        assert_float_near(
            pair_value(&pairs, 3),
            0.72,
            "relation evidence score mismatch",
        );
        assert_float_near(pair_value(&pairs, 5), 0.54, "direct claim score mismatch");
        assert_float_near(
            pair_value(&pairs, 7),
            0.54,
            "repeated direct claim score mismatch",
        );
        assert_float_near(
            pair_value(&pairs, 9),
            0.54,
            "second repeated direct claim score mismatch",
        );
        assert_float_near(
            pair_value(&pairs, 11),
            (0.9_f64 * 0.8) / 1.45,
            "depth 2 repeated relation score mismatch",
        );
        assert_float_near(
            pair_value(&pairs, 13),
            (0.72_f64 * 0.82 * 0.7) / 1.45,
            "depth 2 relation score mismatch",
        );
        assert_float_near(
            pair_value(&pairs, 15),
            (0.72_f64 * 0.82 * 0.5) / 1.35,
            "depth 1 claim score mismatch",
        );
        assert_float_near(
            pair_value(&pairs, 17),
            (0.72_f64 * 0.82 * 0.5) / 1.35,
            "repeated depth 1 claim score mismatch",
        );
    }

    /// `GraphRAG` local evidence record snapshot 정규화와 scoring은 `Rust`가 함께 담당한다.
    #[test]
    fn plan_local_evidence_scores_json_maps_graph_records_to_scored_evidence() {
        let scores = plan_local_evidence_scores_json(
            r#"[{"entityId":"entity::paul","entityConfidence":0.9,"matchScore":1,"evidenceIds":["evidence::mention"]}]"#,
            r#"[{"sourceEntityId":"entity::paul","targetEntityId":"entity::barnabas","confidence":0.8,"evidenceIds":["evidence::relation-1"]},{"sourceEntityId":"entity::barnabas","targetEntityId":"entity::mark","confidence":0.7,"evidenceIds":["evidence::relation-2"]}]"#,
            r#"[{"entityIds":["entity::paul"],"confidence":0.6,"evidenceIds":["evidence::paul-claim"]},{"entityIds":["entity::barnabas"],"confidence":0.5,"evidenceIds":["evidence::barnabas-claim"]}]"#,
            2,
        );
        let parsed_result = serde_json::from_str::<serde_json::Value>(&scores);
        assert!(parsed_result.is_ok(), "valid evidence score JSON expected");
        let parsed = parsed_result.unwrap_or(serde_json::Value::Null);
        let Some(values) = parsed.as_array() else {
            assert_eq!(scores, "[]", "evidence score array expected");
            return;
        };
        let ids = values
            .iter()
            .map(|value| {
                value
                    .get("evidenceId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            [
                "evidence::mention",
                "evidence::relation-1",
                "evidence::paul-claim",
                "evidence::paul-claim",
                "evidence::paul-claim",
                "evidence::relation-1",
                "evidence::relation-2",
                "evidence::barnabas-claim",
                "evidence::barnabas-claim",
            ],
        );
        assert_float_near(
            values
                .first()
                .and_then(|value| value.get("score"))
                .and_then(serde_json::Value::as_f64)
                .unwrap_or_default(),
            0.865,
            "direct evidence score mismatch",
        );
        assert_float_near(
            values
                .get(6)
                .and_then(|value| value.get("score"))
                .and_then(serde_json::Value::as_f64)
                .unwrap_or_default(),
            (0.72_f64 * 0.82 * 0.7) / 1.45,
            "second-hop relation evidence score mismatch",
        );
    }

    /// mention 없는 evidence-first claim score와 candidate order plan은 Rust가 담당한다.
    #[test]
    fn claim_evidence_scores_and_candidate_order_are_planned_in_rust() {
        let scores = plan_claim_evidence_scores_json(
            r#"[{"confidence":0.8,"evidenceIds":["a","b"]},{"confidence":2,"evidenceIds":["b","c"]},{"confidence":-1,"evidenceIds":["","d"]}]"#,
        );

        assert_eq!(
            scores,
            r#"[{"evidenceId":"a","score":0.6000000000000001},{"evidenceId":"b","score":0.6000000000000001},{"evidenceId":"b","score":1},{"evidenceId":"c","score":1},{"evidenceId":"d","score":0}]"#,
            "claim confidence score plan mismatch",
        );
        assert_eq!(
            plan_evidence_candidate_order_json(&scores, r#"["a","b","c","d"]"#),
            r#"[{"evidenceId":"b","score":1},{"evidenceId":"c","score":1},{"evidenceId":"a","score":0.6000000000000001},{"evidenceId":"d","score":0}]"#,
            "evidence candidate order plan mismatch",
        );
    }

    /// Graph evidence candidate lookup은 score 순서와 file path dedupe를 Rust에서 계산한다.
    #[test]
    fn graph_evidence_candidate_lookup_is_planned_in_rust() {
        assert_eq!(
            plan_graph_evidence_candidate_lookup_json(
                r#"[{"evidenceId":"ev-b","score":0.9},{"evidenceId":"missing","score":0.8},{"evidenceId":"ev-a","score":0.7},{"evidenceId":"ev-b","score":0.6}]"#,
                r#"[{"id":"ev-a","filePath":"a.md"},{"id":"ev-b","filePath":"b.md"}]"#,
            ),
            r#"{"scoreIndices":[0,2,3],"evidenceIndices":[1,0,1],"filePaths":["b.md","a.md"]}"#,
        );
    }

    /// Graph evidence entry candidate selection은 compatibility, dedupe, limit을 Rust에서 계산한다.
    #[test]
    fn graph_evidence_entry_candidates_are_planned_in_rust() {
        assert_eq!(
            plan_graph_evidence_entry_candidates_json(
                r#"["entry-b","missing","entry-a","entry-b","entry-c"]"#,
                r#"[{"id":"entry-a","compatible":true},{"id":"entry-b","compatible":true},{"id":"entry-c","compatible":false}]"#,
                3,
            ),
            r#"{"candidateIndices":[0,2],"entryIndices":[1,0]}"#,
        );
        assert_eq!(
            plan_graph_evidence_entry_candidates_json(
                r#"["entry-a"]"#,
                r#"[{"id":"entry-a","compatible":true}]"#,
                0,
            ),
            r#"{"candidateIndices":[],"entryIndices":[]}"#,
        );
    }

    /// vector metadata의 file index record grouping과 complete 판정은 Rust가 담당한다.
    #[test]
    fn file_index_records_are_planned_in_rust() {
        assert_eq!(
            plan_file_index_records_json(
                r#"[{"filePath":"a.md","sourceMtime":100,"sourceSize":10,"contentHash":"hash-a","indexedAt":200,"endLine":4,"embeddingProvider":"openai","embeddingModel":"small"},{"filePath":"a.md","sourceMtime":100,"sourceSize":10,"contentHash":"hash-a","indexedAt":200,"endLine":8,"embeddingProvider":"openai","embeddingModel":"small"},{"filePath":"b.md","sourceMtime":300,"sourceSize":30,"contentHash":"hash-b","indexedAt":400,"endLine":2,"embeddingProvider":"openai"}]"#,
                999.0,
            ),
            r#"[{"filePath":"a.md","sourceMtime":100,"sourceSize":10,"contentHash":"hash-a","indexedAt":200,"embeddingProvider":"openai","embeddingModel":"small","hasCompleteMetadata":true,"vectorCount":2,"updated":999},{"filePath":"b.md","hasCompleteMetadata":false,"vectorCount":1,"updated":999}]"#,
        );
    }

    /// vector store mutation과 lookup source index plan은 Rust가 담당한다.
    #[test]
    fn vector_store_mutations_are_planned_in_rust() {
        assert_eq!(
            plan_vector_store_add_json(r#"["a","b"]"#, r#"["b","c","c"]"#),
            r#"{"sources":[{"source":"existing","index":0},{"source":"incoming","index":0},{"source":"incoming","index":2}],"removedCount":0,"changed":true}"#,
        );
        assert_eq!(
            plan_vector_store_replace_file_json(r#"["a.md","b.md","a.md"]"#, "a.md", 2),
            r#"{"sources":[{"source":"existing","index":1},{"source":"incoming","index":0},{"source":"incoming","index":1}],"removedCount":2,"changed":true}"#,
        );
        assert_eq!(
            plan_vector_store_remove_file_json(r#"["a.md","b.md","a.md"]"#, "a.md"),
            r#"{"sources":[{"source":"existing","index":1}],"removedCount":2,"changed":true}"#,
        );
        assert_eq!(
            plan_vector_store_lookup_by_file_paths_json(r#"["a.md","b.md","a.md"]"#, r#"["a.md"]"#),
            "[0,2]",
        );
        assert_eq!(
            plan_vector_store_lookup_by_ids_json(r#"["a","b","c"]"#, r#"["c","missing","a"]"#),
            "[2,0]",
        );
    }

    /// vector store stats와 indexed path 정렬은 Rust가 담당한다.
    #[test]
    fn vector_store_stats_are_planned_in_rust() {
        assert_eq!(
            plan_vector_store_stats_json(r#"["b.md","a.md","b.md"]"#, 1234.0),
            r#"{"totalEntries":3,"totalFiles":2,"totalVectors":3,"averageVectorsPerFile":1.5,"lastUpdated":1234,"indexedFilePaths":["a.md","b.md"]}"#,
        );
        assert_eq!(
            plan_vector_store_stats_json("[]", 1234.0),
            r#"{"totalEntries":0,"totalFiles":0,"totalVectors":0,"averageVectorsPerFile":0,"lastUpdated":null,"indexedFilePaths":[]}"#,
        );
    }

    /// RAG index 상태 분류, count, update row 정렬은 Rust가 담당한다.
    #[test]
    fn rag_status_summary_is_planned_in_rust() {
        assert_eq!(
            plan_rag_status_json(
                r#"{"includedFiles":[{"path":"healthy.md","mtime":100,"size":10},{"path":"missing.md","mtime":200,"size":20},{"path":"stale.md","mtime":300,"size":30},{"path":"legacy.md","mtime":400,"size":40},{"path":"embedding.md","mtime":500,"size":50}],"records":[{"filePath":"healthy.md","sourceMtime":100,"sourceSize":10,"contentHash":"healthy-hash","indexedAt":900,"embeddingProvider":"openai","embeddingModel":"text-embedding-3-small","hasCompleteMetadata":true,"vectorCount":2},{"filePath":"stale.md","sourceMtime":299,"sourceSize":30,"contentHash":"stale-hash","indexedAt":900,"embeddingProvider":"openai","embeddingModel":"text-embedding-3-small","hasCompleteMetadata":true,"vectorCount":3},{"filePath":"legacy.md","hasCompleteMetadata":false,"vectorCount":4},{"filePath":"embedding.md","sourceMtime":500,"sourceSize":50,"contentHash":"embedding-hash","indexedAt":900,"embeddingProvider":"ollama","embeddingModel":"nomic-embed-text","hasCompleteMetadata":true,"vectorCount":5}],"totalVaultFiles":7,"embeddingProvider":"openai","embeddingModel":"text-embedding-3-small","reasons":{"missing":"missing reason","legacy":"legacy reason","staleFile":"stale file reason","embeddingChanged":"embedding changed reason"}}"#
            ),
            r#"{"totalDocuments":5,"healthyDocuments":1,"missingDocuments":1,"staleDocuments":2,"unknownDocuments":1,"excludedDocuments":2,"totalVectors":14,"updateRequiredDocuments":[{"path":"missing.md","status":"missing","reason":"missing reason","mtime":200,"size":20},{"path":"embedding.md","status":"stale","reason":"embedding changed reason","mtime":500,"size":50},{"path":"stale.md","status":"stale","reason":"stale file reason","mtime":300,"size":30},{"path":"legacy.md","status":"unknown","reason":"legacy reason","mtime":400,"size":40}]}"#,
        );
    }

    /// pending index 대상 file index와 skipped count는 Rust가 담당한다.
    #[test]
    fn index_pending_files_are_planned_in_rust() {
        assert_eq!(
            plan_index_pending_files_json(
                r#"["b.md","a.md","c.md","a.md"]"#,
                r#"["a.md","missing.md"]"#,
            ),
            r#"{"fileIndices":[1,3],"skipped":2}"#,
        );
        assert_eq!(
            plan_index_pending_files_json(r#"["a.md"]"#, "[]"),
            r#"{"fileIndices":[],"skipped":1}"#,
        );
    }

    /// `GraphRAG` status의 entry lookup과 stale/partial/ready 판정은 `Rust`가 담당한다.
    /// ETA planner test input with the accuracy-upgrade fields populated.
    fn rag_eta_test_input(body: &str) -> String {
        format!(
            "{{{body},\"completedFileOverheadDurationsMs\":[],\"historicalMsPerChunk\":null,\"historicalChunkEstimateRatio\":null,\"historicalVariance\":null}}"
        )
    }

    /// Parses the ETA planner output for field-level assertions.
    fn rag_eta_test_plan(input_json: &str) -> JsonValue {
        serde_json::from_str::<JsonValue>(&plan_rag_indexing_eta_json(input_json))
            .unwrap_or(JsonValue::Null)
    }

    /// Reads a string field from an ETA test JSON object.
    fn rag_eta_test_string<'a>(plan: &'a JsonValue, key: &str) -> Option<&'a str> {
        plan.as_object()?.get(key)?.as_str()
    }

    /// Reads a number field from an ETA test JSON object.
    fn rag_eta_test_number(plan: &JsonValue, key: &str) -> Option<f64> {
        plan.as_object()?.get(key)?.as_f64()
    }

    /// Compares a finite number field with a tolerance.
    fn rag_eta_test_number_matches(plan: &JsonValue, key: &str, expected: f64) -> bool {
        rag_eta_test_number(plan, key)
            .is_some_and(|actual| (actual - expected).abs() <= f64::EPSILON)
    }

    #[test]
    fn rag_indexing_eta_is_planned_in_rust() {
        let calculating = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":1000,"startedAtMs":0,"totalFiles":10,"completedFiles":0,"currentFileTotalChunks":0,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":10,"completedEstimatedChunks":0,"currentFileEstimatedChunks":0,"totalPlannedChunks":0,"completedPlannedChunks":0,"planningComplete":false,"completedBatchDurationsMs":[],"completedBatchChunkCounts":[],"completedFileDurationsMs":[],"completedFileChunkCounts":[],"completedFileEstimatedChunkCounts":[],"completedFileActualChunkCounts":[]"#,
        ));
        assert_eq!(
            rag_eta_test_string(&calculating, "confidence"),
            Some("calculating"),
        );
        assert_eq!(
            rag_eta_test_string(&calculating, "basis"),
            Some("elapsed-rate")
        );
        assert_eq!(
            rag_eta_test_string(&calculating, "confidenceReason"),
            Some("insufficient-samples"),
        );
        assert_eq!(
            rag_eta_test_string(&calculating, "etaConfidenceReason"),
            Some("insufficient-samples"),
        );

        let batch_rate = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":5000,"startedAtMs":1000,"totalFiles":4,"completedFiles":0,"currentFileTotalChunks":8,"currentFileEmbeddedChunks":4,"totalEstimatedChunks":32,"completedEstimatedChunks":0,"currentFileEstimatedChunks":8,"totalPlannedChunks":0,"completedPlannedChunks":0,"planningComplete":false,"completedBatchDurationsMs":[1000,1200],"completedBatchChunkCounts":[2,2],"completedFileDurationsMs":[],"completedFileChunkCounts":[],"completedFileEstimatedChunkCounts":[],"completedFileActualChunkCounts":[]"#,
        ));
        assert_eq!(
            rag_eta_test_string(&batch_rate, "basis"),
            Some("batch-rate")
        );
        assert_eq!(rag_eta_test_string(&batch_rate, "confidence"), Some("low"));
        assert!(
            rag_eta_test_number_matches(&batch_rate, "remainingMs", 15400.0),
            "batch ETA should use completed embedding batch ms/chunk",
        );

        let calibrated = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":10000,"startedAtMs":0,"totalFiles":10,"completedFiles":3,"currentFileTotalChunks":1,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":10,"completedEstimatedChunks":3,"currentFileEstimatedChunks":1,"totalPlannedChunks":0,"completedPlannedChunks":0,"planningComplete":false,"completedBatchDurationsMs":[500],"completedBatchChunkCounts":[1],"completedFileDurationsMs":[2000,3000,2500],"completedFileChunkCounts":[1,1,1],"completedFileEstimatedChunkCounts":[1,1,1],"completedFileActualChunkCounts":[1,1,1]"#,
        ));
        assert_eq!(
            rag_eta_test_string(&calibrated, "basis"),
            Some("calibrated-estimate"),
        );
        assert_eq!(
            rag_eta_test_string(&calibrated, "confidence"),
            Some("medium")
        );
        assert!(
            rag_eta_test_number_matches(&calibrated, "remainingMs", 17500.0),
            "calibrated ETA should preserve completed-file rate",
        );

        let complete = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":9000,"startedAtMs":0,"totalFiles":0,"completedFiles":0,"currentFileTotalChunks":0,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":0,"completedEstimatedChunks":0,"currentFileEstimatedChunks":0,"totalPlannedChunks":0,"completedPlannedChunks":0,"planningComplete":true,"completedBatchDurationsMs":[],"completedBatchChunkCounts":[],"completedFileDurationsMs":[],"completedFileChunkCounts":[],"completedFileEstimatedChunkCounts":[],"completedFileActualChunkCounts":[]"#,
        ));
        assert_eq!(
            rag_eta_test_string(&complete, "confidence"),
            Some("complete")
        );
        assert_eq!(
            rag_eta_test_string(&complete, "basis"),
            Some("planned-chunks")
        );
        assert!(
            rag_eta_test_number_matches(&complete, "remainingMs", 0.0),
            "completed jobs should have no remaining work",
        );
    }

    #[test]
    fn rag_indexing_eta_uses_planned_chunk_work_instead_of_current_file_shape() {
        let plan = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":5000,"startedAtMs":0,"totalFiles":4,"completedFiles":1,"currentFileTotalChunks":4,"currentFileEmbeddedChunks":2,"totalEstimatedChunks":100,"completedEstimatedChunks":25,"currentFileEstimatedChunks":50,"totalPlannedChunks":10,"completedPlannedChunks":3,"planningComplete":true,"completedBatchDurationsMs":[1000,1000,1000],"completedBatchChunkCounts":[1,1,1],"completedFileDurationsMs":[1200],"completedFileChunkCounts":[3],"completedFileEstimatedChunkCounts":[25],"completedFileActualChunkCounts":[3]"#,
        ));
        assert_eq!(rag_eta_test_string(&plan, "basis"), Some("planned-chunks"));
        assert!(
            rag_eta_test_number_matches(&plan, "progressRatio", 0.5),
            "planned chunks should override byte-estimated chunk skew",
        );
        assert!(
            rag_eta_test_number_matches(&plan, "currentFileProgress", 0.5),
            "current file progress should stay on actual chunk counts",
        );
    }

    #[test]
    fn rag_indexing_eta_high_confidence_requires_stable_planned_work() {
        let unplanned = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":20000,"startedAtMs":0,"totalFiles":10,"completedFiles":5,"currentFileTotalChunks":1,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":10,"completedEstimatedChunks":5,"currentFileEstimatedChunks":1,"totalPlannedChunks":0,"completedPlannedChunks":0,"planningComplete":false,"completedBatchDurationsMs":[1000,1000,1000,1000,1000],"completedBatchChunkCounts":[1,1,1,1,1],"completedFileDurationsMs":[1000,1000,1000,1000,1000],"completedFileChunkCounts":[1,1,1,1,1],"completedFileEstimatedChunkCounts":[1,1,1,1,1],"completedFileActualChunkCounts":[1,1,1,1,1]"#,
        ));
        assert_eq!(
            rag_eta_test_string(&unplanned, "confidence"),
            Some("medium"),
            "sample count alone must not grant high confidence",
        );
    }

    #[test]
    fn rag_indexing_eta_confidence_tracks_rate_variance_interval() {
        let stable = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":50000,"startedAtMs":0,"totalFiles":10,"completedFiles":5,"currentFileTotalChunks":10,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":100,"completedEstimatedChunks":50,"currentFileEstimatedChunks":10,"totalPlannedChunks":100,"completedPlannedChunks":50,"planningComplete":true,"completedBatchDurationsMs":[1000,1020,980,1010,990],"completedBatchChunkCounts":[10,10,10,10,10],"completedFileDurationsMs":[1100,1120,1080,1110,1090],"completedFileChunkCounts":[10,10,10,10,10],"completedFileEstimatedChunkCounts":[10,10,10,10,10],"completedFileActualChunkCounts":[10,10,10,10,10]"#,
        ));
        assert_eq!(rag_eta_test_string(&stable, "confidence"), Some("high"));
        assert_eq!(
            rag_eta_test_string(&stable, "confidenceReason"),
            Some("planned-stable"),
        );
        assert_eq!(
            rag_eta_test_string(&stable, "etaConfidenceReason"),
            Some("planned-stable"),
        );

        let variable = rag_eta_test_plan(&rag_eta_test_input(
            r#""nowMs":50000,"startedAtMs":0,"totalFiles":10,"completedFiles":5,"currentFileTotalChunks":10,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":100,"completedEstimatedChunks":50,"currentFileEstimatedChunks":10,"totalPlannedChunks":100,"completedPlannedChunks":50,"planningComplete":true,"completedBatchDurationsMs":[200,2000,400,1800,600],"completedBatchChunkCounts":[10,10,10,10,10],"completedFileDurationsMs":[300,2100,500,1900,700],"completedFileChunkCounts":[10,10,10,10,10],"completedFileEstimatedChunkCounts":[10,10,10,10,10],"completedFileActualChunkCounts":[10,10,10,10,10]"#,
        ));
        assert_eq!(rag_eta_test_string(&variable, "confidence"), Some("medium"));
        assert_eq!(
            rag_eta_test_string(&variable, "confidenceReason"),
            Some("planned-variable-rate"),
        );
        assert_eq!(
            rag_eta_test_string(&variable, "etaConfidenceReason"),
            Some("planned-variable-rate"),
        );
    }

    #[test]
    fn rag_indexing_eta_uses_historical_calibration_when_current_samples_are_missing() {
        let input = r#"{"nowMs":1000,"startedAtMs":0,"totalFiles":10,"completedFiles":0,"currentFileTotalChunks":0,"currentFileEmbeddedChunks":0,"totalEstimatedChunks":100,"completedEstimatedChunks":0,"currentFileEstimatedChunks":10,"totalPlannedChunks":0,"completedPlannedChunks":0,"planningComplete":false,"completedBatchDurationsMs":[],"completedBatchChunkCounts":[],"completedFileDurationsMs":[],"completedFileChunkCounts":[],"completedFileEstimatedChunkCounts":[],"completedFileActualChunkCounts":[],"completedFileOverheadDurationsMs":[],"historicalMsPerChunk":25,"historicalChunkEstimateRatio":0.5,"historicalVariance":0.01}"#;
        let plan = rag_eta_test_plan(input);
        assert_eq!(
            rag_eta_test_string(&plan, "basis"),
            Some("calibrated-estimate"),
        );
        assert_eq!(rag_eta_test_string(&plan, "confidence"), Some("low"));
        assert!(
            rag_eta_test_number_matches(&plan, "remainingMs", 1250.0),
            "historical calibration should shrink raw estimated chunks",
        );
    }

    /// `GraphRAG` status??entry lookup怨?stale/partial/ready ?먯젙? `Rust`媛 ?대떦?쒕떎.
    #[test]
    fn graph_rag_status_is_planned_in_rust() {
        assert_eq!(
            plan_graph_rag_status_entry_lookups_json(
                r#"["note.md::0","stale.md::0"]"#,
                r#"["note.md::0","cache-only.md::0"]"#,
            ),
            r#"["note.md::0","stale.md::0","cache-only.md::0"]"#,
        );
        assert_eq!(
            plan_graph_rag_status_file_snapshot_json(
                r#"[{"filePath":"z.md","vectorCount":2,"processable":true},{"filePath":"Base.base","vectorCount":1,"processable":true},{"filePath":"foreign.md","vectorCount":1,"processable":false},{"filePath":"a.md","vectorCount":1,"processable":true},{"filePath":"z.md","vectorCount":3,"processable":true}]"#,
                r#"[{"filePath":"fallback.md","processable":true},{"filePath":"clip.png","processable":true}]"#,
            ),
            r#"{"fileRecordIndices":[0,3],"totalCandidateFiles":2}"#,
        );
        assert_eq!(
            plan_graph_rag_status_file_snapshot_json(
                r#"[{"filePath":"Base.base","vectorCount":1,"processable":true},{"filePath":"foreign.md","vectorCount":1,"processable":false}]"#,
                r#"[{"filePath":"fallback.md","processable":true},{"filePath":"fallback.md","processable":true},{"filePath":"clip.png","processable":true},{"filePath":"blocked.md","processable":false},{"filePath":"second.md","processable":true}]"#,
            ),
            r#"{"fileRecordIndices":[],"totalCandidateFiles":2}"#,
        );
        assert_eq!(
            plan_graph_rag_status_entry_snapshot_json(
                r#"[{"id":"fresh.md::0","filePath":"fresh.md","processable":true},{"id":"Base.base::0","filePath":"Base.base","processable":true},{"id":"foreign.md::0","filePath":"foreign.md","processable":false},{"id":"fresh.md::0","filePath":"fresh.md","processable":true},{"id":"second.md::0","filePath":"second.md","processable":true}]"#,
            ),
            r#"{"entryIndices":[0,4]}"#,
        );
        assert_eq!(
            plan_graph_rag_status_json(
                r#"{"graphRagEnabled":true,"isRunning":false,"schemaErrorCount":0,"totalCandidateFiles":2,"graphRagMaxFilesPerRun":50,"graphRagModel":"model-new","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1,"fileRecords":[{"filePath":"fresh.md","vectorCount":2},{"filePath":"stale.md","vectorCount":1}],"evidence":[{"filePath":"fresh.md","entryId":"fresh.md::0","contentHash":"hash-a","extractionModelKey":"model-new","processable":true},{"filePath":"deleted.md","entryId":"deleted.md::0","contentHash":"old","extractionModelKey":"model-new","processable":true},{"filePath":"foreign.md","entryId":"foreign.md::0","contentHash":"foreign","extractionModelKey":"model-new","processable":false}],"rejectedFactFilePaths":["fresh.md","fresh.md","bad.md"],"pendingMergeCount":2,"cacheRecords":[{"entryId":"fresh.md::0","contentHash":"hash-a","extractionModelKey":"model-new","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1},{"entryId":"fresh.md::1","contentHash":"hash-b","extractionModelKey":"model-new","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1},{"entryId":"stale.md::0","contentHash":"old-stale","extractionModelKey":"model-old","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1}],"entries":[{"id":"fresh.md::0","filePath":"fresh.md","contentHash":"hash-a","text":"unused"},{"id":"fresh.md::1","filePath":"fresh.md","contentHash":"hash-b","text":"unused"},{"id":"stale.md::0","filePath":"stale.md","text":"changed body"}]}"#
            ),
            r#"{"state":"stale","totalCandidateFiles":2,"graphEvidenceCount":3,"rejectedFactCount":3,"failedFileCount":2,"pendingMergeCount":2,"staleFileCount":3,"staleFilePaths":["deleted.md","foreign.md","stale.md"],"maxFilesPerRun":50}"#,
        );
        assert_eq!(
            plan_graph_rag_status_json(
                r#"{"graphRagEnabled":false,"isRunning":false,"schemaErrorCount":0,"totalCandidateFiles":3,"graphRagMaxFilesPerRun":0,"graphRagModel":"model-new","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1,"fileRecords":[],"evidence":[],"rejectedFactFilePaths":[],"pendingMergeCount":0,"cacheRecords":[],"entries":[]}"#,
            ),
            r#"{"state":"disabled","totalCandidateFiles":3,"graphEvidenceCount":0,"rejectedFactCount":0,"failedFileCount":0,"pendingMergeCount":0,"staleFileCount":0,"staleFilePaths":[],"maxFilesPerRun":1}"#,
        );
    }

    /// `GraphRAG` 런타임 재구성 판단은 `Rust`가 담당한다.
    #[test]
    fn should_rebuild_graph_runtime_for_graph_status_is_planned_in_rust() {
        assert!(should_rebuild_graph_runtime_for_graph_status(
            true,
            "openai:gpt-4.1-mini",
            "stale",
            "ready",
            false,
        ));
        assert!(!should_rebuild_graph_runtime_for_graph_status(
            true, "", "stale", "ready", false,
        ));
        assert!(!should_rebuild_graph_runtime_for_graph_status(
            true,
            "openai:gpt-4.1-mini",
            "stale",
            "stale",
            false,
        ));
        assert!(!should_rebuild_graph_runtime_for_graph_status(
            true,
            "openai:gpt-4.1-mini",
            "ready",
            "partial",
            false,
        ));
        assert!(!should_rebuild_graph_runtime_for_graph_status(
            true,
            "openai:gpt-4.1-mini",
            "ready",
            "ready",
            false,
        ));
        assert!(!should_rebuild_graph_runtime_for_graph_status(
            true,
            "openai:gpt-4.1-mini",
            "stale",
            "ready",
            true,
        ));
    }

    /// MCP 연결 상태 계산은 `Rust`가 담당한다.
    #[test]
    fn mcp_connection_state_is_planned_in_rust() {
        assert_eq!(
            get_mcp_connection_state_rust(0, 0, 0, false),
            "idle".to_owned(),
        );
        assert_eq!(
            get_mcp_connection_state_rust(2, 1, 1, true),
            "connecting".to_owned(),
        );
        assert_eq!(
            get_mcp_connection_state_rust(2, 2, 0, false),
            "connected".to_owned(),
        );
        assert_eq!(
            get_mcp_connection_state_rust(2, 1, 1, false),
            "partial-error".to_owned(),
        );
        assert_eq!(
            get_mcp_connection_state_rust(2, 0, 2, false),
            "error".to_owned(),
        );
    }

    /// MCP 경로 힌트 판정은 `Rust`가 담당한다.
    #[test]
    fn mcp_path_hint_is_planned_in_rust() {
        assert!(should_append_mcp_path_hint_rust("npx", "spawn npx ENOENT"));
        assert!(should_append_mcp_path_hint_rust("uvx", "spawn uvx ENOENT"));
        assert!(!should_append_mcp_path_hint_rust(
            "/opt/homebrew/bin/npx",
            "spawn npx ENOENT"
        ));
        assert!(!should_append_mcp_path_hint_rust(
            "npx",
            "permission denied"
        ));
    }

    /// `GraphRAG` entity upsert merge field plan은 `Rust`가 담당한다.
    #[test]
    fn graph_entity_merge_is_planned_in_rust() {
        assert_eq!(
            plan_graph_entity_merge_json(
                r#"{"aliases":["Paul","Saul"],"description":"apostle","confidence":0.6,"evidenceIds":["ev-1","ev-2"],"updatedAt":1000}"#,
                r#"{"aliases":["Paul","Apostle Paul"],"description":"updated","confidence":0.9,"evidenceIds":["ev-2","ev-3"],"updatedAt":2000}"#,
            ),
            r#"{"aliases":["Paul","Saul","Apostle Paul"],"description":"updated","confidence":0.9,"evidenceIds":["ev-1","ev-2","ev-3"],"updatedAt":2000}"#,
        );
        assert_eq!(
            plan_graph_entity_merge_json(
                r#"{"aliases":["Paul"],"description":"existing description","confidence":0.95,"evidenceIds":["ev-1"],"updatedAt":1000}"#,
                r#"{"aliases":["Paul"],"description":"","confidence":0.5,"evidenceIds":["ev-1"],"updatedAt":3000}"#,
            ),
            r#"{"aliases":["Paul"],"description":"existing description","confidence":0.95,"evidenceIds":["ev-1"],"updatedAt":3000}"#,
        );
    }

    /// entity 병합의 참조 교체와 중복 제거는 `Rust`가 담당한다.
    #[test]
    fn graph_entity_references_are_rewritten_in_rust() {
        assert_eq!(
            rewrite_graph_entity_references_json(
                r#"["entity-a","entity-b","entity-a"]"#,
                "entity-b",
                "entity-a",
                true,
            ),
            r#"["entity-a"]"#,
        );
        assert_eq!(
            rewrite_graph_entity_references_json(
                r#"["entity-b","entity-c"]"#,
                "entity-b",
                "entity-a",
                false,
            ),
            r#"["entity-a","entity-c"]"#,
        );
    }

    #[test]
    fn graph_entity_pair_comparison_is_order_independent() {
        assert!(is_same_graph_entity_pair(
            "entity-a", "entity-b", "entity-b", "entity-a"
        ));
        assert!(!is_same_graph_entity_pair(
            "entity-a", "entity-b", "entity-a", "entity-c"
        ));
    }

    /// `GraphRAG` extraction cache hit 판정은 `Rust`가 담당한다.
    #[test]
    fn graph_extraction_cache_hit_is_checked_in_rust() {
        let cached = r#"{"entryId":"note.md::0","contentHash":"hash-a","extractionModelKey":"model-a","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1}"#;

        assert_eq!(is_graph_extraction_cache_hit_json(cached, cached), "true");
        assert_eq!(
            is_graph_extraction_cache_hit_json(
                cached,
                r#"{"entryId":"note.md::0","contentHash":"hash-b","extractionModelKey":"model-a","ontologySchemaId":"default","ontologyVersion":1,"extractionContractVersion":1}"#,
            ),
            "false",
        );
        assert_eq!(is_graph_extraction_cache_hit_json("null", cached), "false");
    }

    /// graph store deletion selection은 `Rust`가 record 순서 기준 index plan으로 계산한다.
    #[test]
    fn graph_deletion_indices_are_planned_in_rust() {
        assert_eq!(
            plan_graph_deletion_indices_json(
                r#"["old.md","keep.md","old.md","other.md"]"#,
                r#"["old.md","missing.md"]"#,
            ),
            "[0,2]",
        );
        assert_eq!(plan_graph_deletion_indices_json(r#"["a","b"]"#, "[]"), "[]",);
        assert_eq!(plan_graph_deletion_indices_json("[]", r#"["a"]"#), "[]",);
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

    /// 부동소수점 근사값을 확인한다.
    fn assert_float_near(actual: f64, expected: f64, message: &str) {
        assert!(
            (actual - expected).abs() <= 1.0e-12,
            "{message}; expected {expected}, got {actual}",
        );
    }

    /// f32 runtime 경로의 부동소수점 근사값을 확인한다.
    fn assert_float_close_f32(actual: f64, expected: f64, message: &str) {
        assert!(
            (actual - expected).abs() <= 1.0e-6,
            "{message}; expected {expected}, got {actual}",
        );
    }

    /// 반복 실행 duration median을 nanoseconds로 반환한다.
    fn measure_median_nanos<F>(sample_count: usize, mut operation: F) -> u128
    where
        F: FnMut(),
    {
        let mut samples = Vec::with_capacity(sample_count.max(1));
        for _ in 0..sample_count.max(1) {
            let started_at = std::time::Instant::now();
            operation();
            samples.push(started_at.elapsed().as_nanos());
        }
        samples.sort_unstable();
        let middle = samples.len().checked_div(2).unwrap_or_default();
        samples.get(middle).copied().unwrap_or_default()
    }

    /// benchmark line을 stdout에 기록한다.
    fn write_bench_line(stdout: &mut std::io::StdoutLock<'_>, name: &str, median_ns: u128) -> bool {
        use std::io::Write as _;

        writeln!(stdout, "{name}: median_ns={median_ns}").is_ok()
    }

    /// deterministic f32 vector matrix fixture를 만든다.
    fn fixture_vectors_f32(row_count: usize, dimensions: usize) -> Vec<f32> {
        let mut values = Vec::with_capacity(row_count.saturating_mul(dimensions));
        for row_index in 0..row_count {
            for dimension_index in 0..dimensions {
                let seed = row_index
                    .saturating_mul(131)
                    .saturating_add(dimension_index.saturating_mul(17));
                values.push(deterministic_unit_f32(seed));
            }
        }
        values
    }

    /// deterministic f32 query fixture를 만든다.
    fn fixture_query_f32(dimensions: usize) -> Vec<f32> {
        (0..dimensions)
            .map(|dimension_index| {
                deterministic_unit_f32(dimension_index.saturating_mul(29).saturating_add(7))
            })
            .collect()
    }

    /// usize seed를 [-1, 1) 범위의 deterministic f32 값으로 변환한다.
    fn deterministic_unit_f32(seed: usize) -> f32 {
        let raw = u16::try_from(seed.checked_rem(1_000).unwrap_or_default()).unwrap_or_default();
        f32::from(raw) / 500.0 - 1.0
    }

    /// 약 2MB Markdown fixture를 만든다.
    fn fixture_markdown_2mb() -> String {
        let segment = "# Heading\nalpha beta graph rag evidence paragraph.\n\n\
            beta gamma delta with korean 요고49 포인트 페이백 tokens.\n\n\
            ```ts\nconst value = 42;\n```\n";
        let mut markdown = String::new();
        while markdown.len() < 2_000_000 {
            markdown.push_str(segment);
        }
        markdown
    }

    /// 테스트에서 BM25 score JSON을 간단히 읽는다.
    fn parse_bm25_score_test_json(payload: &str) -> Vec<Bm25SearchScore> {
        let value = serde_json::from_str::<JsonValue>(payload).unwrap_or(JsonValue::Null);
        let Some(items) = value.as_array() else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                Some(Bm25SearchScore {
                    doc_id: object.get("docId")?.as_str()?.to_owned(),
                    score: object.get("score")?.as_f64()?,
                })
            })
            .collect()
    }

    /// pair 배열에서 값을 안전하게 읽는다.
    fn pair_value(pairs: &[f64], offset: usize) -> f64 {
        pairs.get(offset).copied().unwrap_or(f64::NAN)
    }

    /// JSON object의 numeric field를 읽는다.
    fn json_number_field(value: &JsonValue, field: &str) -> f64 {
        value
            .as_object()
            .and_then(|object| object.get(field))
            .and_then(JsonValue::as_f64)
            .unwrap_or(f64::NAN)
    }

    /// JSON object의 boolean field를 읽는다.
    fn json_bool_field(value: &JsonValue, field: &str) -> Option<bool> {
        value
            .as_object()
            .and_then(|object| object.get(field))
            .and_then(JsonValue::as_bool)
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
