use wasm_bindgen::prelude::wasm_bindgen;

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
