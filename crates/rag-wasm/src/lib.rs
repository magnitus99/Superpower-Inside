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
/// BM25 retrieval source.
const SOURCE_BM25: u8 = 1;
/// vector/ANN retrieval source.
const SOURCE_VECTOR: u8 = 2;
/// graph-local/graph-global/evidence retrieval source.
const SOURCE_GRAPH_EVIDENCE: u8 = 3;
/// structural retrieval source.
const SOURCE_STRUCTURAL: u8 = 4;
/// 기존 `TypeScript` MMR selection의 relevance 가중치.
const MMR_RELEVANCE_WEIGHT: f64 = 0.72;
/// 같은 파일 후보를 연속 선택하지 않기 위한 penalty.
const SAME_FILE_DIVERSITY_PENALTY: f64 = 0.12;
/// 같은 heading 후보를 연속 선택하지 않기 위한 추가 penalty.
const SAME_HEADING_DIVERSITY_PENALTY: f64 = 0.06;

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
    if top_k == 0 || scores.is_empty() {
        return Box::default();
    }
    if dimensions == 0
        || vectors.len() != scores.len().saturating_mul(dimensions)
        || source_keys.len() != scores.len()
        || heading_keys.len() != scores.len()
        || scores.iter().any(|score| !score.is_finite())
        || vectors.iter().any(|value| !value.is_finite())
    {
        return Box::default();
    }
    if scores.len() <= top_k {
        return collect_indices_as_f64(0..scores.len());
    }

    let rows = vectors.chunks_exact(dimensions).collect::<Vec<_>>();
    if rows.len() != scores.len() {
        return Box::default();
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

    collect_indices_as_f64(selected)
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

/// retrieval source별 RRF weight를 반환한다.
fn rrf_source_weight(source_code: u8, bm25_weight: f64) -> f64 {
    match source_code {
        SOURCE_BM25 => bm25_weight.max(0.05),
        SOURCE_VECTOR => (1.0 - bm25_weight).max(0.05),
        SOURCE_GRAPH_EVIDENCE => 0.2,
        SOURCE_STRUCTURAL => 0.12,
        _ => 0.05,
    }
}

/// graph/evidence source가 있는지 반환한다.
fn has_graph_evidence_source(source_codes: &[u8]) -> bool {
    source_codes.contains(&SOURCE_GRAPH_EVIDENCE)
}

/// graph/evidence score가 강한 근거인지 반환한다.
fn is_strong_evidence_score(evidence_score: f64, rank: f64) -> bool {
    evidence_score >= 0.7 || (rank.is_finite() && rank <= 2.0)
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

        if let Some(edge) = edges
            .iter_mut()
            .find(|edge| edge.source_index == left && edge.target_index == right)
        {
            edge.weight += confidence;
        } else {
            edges.push(AggregatedGraphEdge {
                source_index: left,
                target_index: right,
                weight: confidence,
            });
        }
    }

    Some(edges)
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

/// Obsidian wikilink와 Markdown link에서 vault 내부 target을 추출한다.
fn extract_vault_links(content: &str) -> Vec<String> {
    let mut links = Vec::<String>::new();
    extract_wiki_link_targets(content, &mut links);
    extract_markdown_link_targets(content, &mut links);
    links
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
        BM25_B, BM25_K1, SOURCE_BM25, SOURCE_GRAPH_EVIDENCE, SOURCE_STRUCTURAL, SOURCE_VECTOR,
        aggregate_graph_edges_flat, bm25_score_pairs, chunk_markdown, chunk_plain_text,
        cosine_similarity, create_content_hash, detect_communities_flat, extract_vault_links_json,
        hybrid_score_or_nan, rank_top_k_pairs, rrf_score_or_nan, score_local_evidence_pairs,
        select_diverse_indices, token_frequencies_json, tokenize,
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
