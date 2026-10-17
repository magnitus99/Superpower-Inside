use std::cmp::Reverse;
use std::collections::HashMap;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
/// 동일 문자열을 재사용하도록 글자수순 입력, 원순서 복원과 누적 처리 수를 반환한다.
#[must_use]
pub fn plan_embedding_inputs_json(texts_json: &str) -> Option<String> {
    let texts: Vec<String> = serde_json::from_str(texts_json).ok()?;
    let mut occurrences: HashMap<&str, (usize, usize)> = HashMap::new();
    for (index, text) in texts.iter().enumerate() {
        occurrences
            .entry(text)
            .and_modify(|(_, count)| *count += 1)
            .or_insert((index, 1));
    }
    let mut unique_inputs: Vec<_> = occurrences
        .iter()
        .map(|(&text, &(index, count))| (text, index, count, text.chars().count()))
        .collect();
    unique_inputs.sort_unstable_by_key(|&(_, index, _, length)| (Reverse(length), index));

    let mut input_indices = Vec::with_capacity(unique_inputs.len());
    let mut cumulative_chunk_counts = Vec::with_capacity(unique_inputs.len());
    let mut output_slots = HashMap::with_capacity(unique_inputs.len());
    let mut completed = 0;
    for (slot, (text, index, count, _)) in unique_inputs.into_iter().enumerate() {
        input_indices.push(index);
        completed += count;
        cumulative_chunk_counts.push(completed);
        output_slots.insert(text, slot);
    }
    let output_indices: Option<Vec<_>> = texts
        .iter()
        .map(|text| output_slots.get(text.as_str()).copied())
        .collect();
    Some(
        serde_json::json!({
            "inputIndices": input_indices,
            "outputIndices": output_indices?,
            "cumulativeChunkCounts": cumulative_chunk_counts,
        })
        .to_string(),
    )
}

#[wasm_bindgen]
/// 검색 질의와 문서에 공식 `EmbeddingGemma` 접두사를 적용한다.
#[must_use]
pub fn embedding_gemma_inputs_json(texts_json: &str, kind: &str) -> Option<String> {
    let texts: Vec<String> = serde_json::from_str(texts_json).ok()?;
    let prefix = match kind {
        "query" => "task: search result | query: ",
        "document" => "title: none | text: ",
        _ => return None,
    };
    serde_json::to_string(
        &texts
            .into_iter()
            .map(|text| format!("{prefix}{text}"))
            .collect::<Vec<_>>(),
    )
    .ok()
}

#[wasm_bindgen]
/// 다운로드 응답의 HTTP 상태, 구간과 길이가 요청과 일치하는지 검사한다.
#[must_use]
pub fn local_model_range_matches(
    start: u32,
    end: u32,
    total: u32,
    status: u16,
    length: u32,
    content_range: &str,
) -> bool {
    if total == 0 || end < start || end >= total {
        return false;
    }
    if status == 200 {
        return start == 0 && length == total;
    }
    status == 206
        && length == end - start + 1
        && content_range == format!("bytes {start}-{end}/{total}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedding_plan_sorts_unique_inputs_and_restores_duplicates() {
        assert_eq!(
            plan_embedding_inputs_json(r#"["a","long","a","bb","long",""]"#).as_deref(),
            Some(
                r#"{"inputIndices":[1,3,0,5],"outputIndices":[2,0,2,1,0,3],"cumulativeChunkCounts":[2,3,5,6]}"#
            )
        );
    }

    #[test]
    fn embedding_plan_counts_unicode_scalars_and_preserves_equal_length_order() {
        assert_eq!(
            plan_embedding_inputs_json(r#"["😀","ab","가","é","e\u0301","😀",""]"#).as_deref(),
            Some(
                r#"{"inputIndices":[1,4,0,2,3,6],"outputIndices":[2,0,3,4,1,2,5],"cumulativeChunkCounts":[1,2,4,5,6,7]}"#
            )
        );
    }

    #[test]
    fn embedding_plan_handles_empty_and_identical_inputs() {
        assert_eq!(
            plan_embedding_inputs_json("[]").as_deref(),
            Some(r#"{"inputIndices":[],"outputIndices":[],"cumulativeChunkCounts":[]}"#)
        );
        assert_eq!(
            plan_embedding_inputs_json(r#"["","",""]"#).as_deref(),
            Some(r#"{"inputIndices":[0],"outputIndices":[0,0,0],"cumulativeChunkCounts":[3]}"#)
        );
        for invalid in ["", "null", "{}", r#"["a",1]"#] {
            assert!(plan_embedding_inputs_json(invalid).is_none());
        }
    }

    #[test]
    fn prefixes_distinguish_query_and_document() {
        assert_eq!(
            embedding_gemma_inputs_json(r#"["한국어 질문"]"#, "query").as_deref(),
            Some(r#"["task: search result | query: 한국어 질문"]"#)
        );
        assert_eq!(
            embedding_gemma_inputs_json(r#"["본문"]"#, "document").as_deref(),
            Some(r#"["title: none | text: 본문"]"#)
        );
        assert!(embedding_gemma_inputs_json("[]", "unknown").is_none());
    }

    #[test]
    fn rejects_mismatched_download_ranges() {
        assert!(local_model_range_matches(0, 1, 4, 206, 2, "bytes 0-1/4"));
        assert!(local_model_range_matches(0, 1, 4, 200, 4, ""));
        assert!(!local_model_range_matches(2, 3, 4, 200, 4, ""));
        assert!(!local_model_range_matches(0, 1, 4, 206, 2, "bytes 2-3/4"));
    }
}
