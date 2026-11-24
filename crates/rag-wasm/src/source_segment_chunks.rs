//! 추출 구간을 넘지 않는 청킹의 단일 계산 진입점입니다.
use super::{JsonValue, source_document::plan_source_chunks_json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 0부터 시작하는 비중첩 구간을 검증하고 1부터 시작하는 절대 행 청크를 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_segment_chunks_json(
    path: &str,
    extension: &str,
    content: &str,
    max_size: usize,
    overlap: usize,
    segments_json: &str,
) -> String {
    plan(path, extension, content, max_size, overlap, segments_json)
        .unwrap_or_else(|| "null".to_owned())
}

/// 입력 크기·구간 순서를 검증하고 기존 구조 청커를 구간마다 호출합니다.
fn plan(
    path: &str,
    extension: &str,
    content: &str,
    max_size: usize,
    overlap: usize,
    segments_json: &str,
) -> Option<String> {
    if segments_json.len() > 8 * 1024 * 1024 {
        return None;
    }
    let segments: JsonValue = serde_json::from_str(segments_json).ok()?;
    let segments = segments.as_array()?;
    if segments.is_empty() {
        return Some(plan_source_chunks_json(
            path, extension, content, max_size, overlap,
        ));
    }
    if content.len() > 32 * 1024 * 1024
        || path.len() > 4096
        || segments.len() > 100_000
        || max_size == 0
        || overlap >= max_size
        || content.len().checked_div(max_size - overlap)? > 200_000
    {
        return None;
    }
    let mut offsets = vec![0];
    offsets.extend(content.match_indices('\n').map(|(index, _)| index + 1));
    let ranges = segment_ranges(segments, offsets.len())?;
    let mut output = Vec::new();
    let mut output_bytes = 0_usize;
    let mut occurrences = std::collections::BTreeMap::<String, usize>::new();
    for (start, end, label, source_segment) in ranges {
        let byte_end = offsets
            .get(end + 1)
            .map_or(content.len(), |offset| offset - 1);
        let raw = content.get(*offsets.get(start)?..byte_end)?;
        // 기존 평문 청커는 앞 빈 줄을 trim하면서 시작 좌표를 옮기지 않으므로
        // 구간 경계에서는 제거한 줄 수를 먼저 절대 주소에 반영합니다.
        let trimmed_start = raw.trim_start_matches(['\n', '\r']);
        let leading = raw.get(..raw.len() - trimmed_start.len())?;
        let start = start.checked_add(leading.bytes().filter(|byte| *byte == b'\n').count())?;
        let raw = trimmed_start.trim_end_matches(['\n', '\r']);
        let local: JsonValue = serde_json::from_str(&plan_source_chunks_json(
            path, extension, raw, max_size, overlap,
        ))
        .ok()?;
        for mut chunk in local.as_array()?.iter().cloned() {
            let text_bytes = chunk.get("text")?.as_str()?.len();
            let hash = chunk.get("chunkHash")?.as_str()?.to_owned();
            let ordinal = occurrences.entry(hash.clone()).or_default();
            chunk.as_object_mut()?.insert(
                "id".to_owned(),
                serde_json::json!(format!("{path}::chunk::{hash}::{ordinal}")),
            );
            *ordinal += 1;
            let metadata = chunk.get_mut("metadata")?.as_object_mut()?;
            for key in ["startLine", "endLine"] {
                let absolute = metadata
                    .get(key)?
                    .as_u64()?
                    .checked_add(u64::try_from(start).ok()?)?;
                if absolute == 0 || absolute > u64::try_from(end + 1).ok()? {
                    return None;
                }
                metadata.insert(key.to_owned(), serde_json::json!(absolute));
            }
            if let Some(index) = source_segment {
                metadata.insert("sourceSegment".to_owned(), serde_json::json!(index));
            }
            if let Some(label) = label {
                let heading = metadata
                    .get("heading")
                    .and_then(JsonValue::as_str)
                    .map_or_else(
                        || label.to_owned(),
                        |heading| format!("{label} · {heading}"),
                    );
                metadata.insert("heading".to_owned(), serde_json::json!(heading));
            }
            output_bytes = output_bytes
                .checked_add(text_bytes)?
                .checked_add(
                    metadata
                        .get("heading")
                        .and_then(JsonValue::as_str)
                        .map_or(0, str::len),
                )?
                .checked_add(path.len())?
                .checked_add(256)?;
            if output_bytes > 32 * 1024 * 1024 || output.len() >= 200_000 {
                return None;
            }
            output.push(chunk);
        }
    }
    serde_json::to_string(&output).ok()
}

/// 절대 행 범위와 파일 수준 출처 원장 참조입니다.
type SegmentRange<'a> = (usize, usize, Option<&'a str>, Option<usize>);

/// 정렬된 비중첩 구간과 라벨 없는 틈을 원문 행 범위로 구성합니다.
fn segment_ranges(segments: &[JsonValue], line_count: usize) -> Option<Vec<SegmentRange<'_>>> {
    let mut ranges = Vec::new();
    let mut next = 0;
    for (index, segment) in segments.iter().enumerate() {
        let start = usize::try_from(segment.get("startLine")?.as_u64()?).ok()?;
        let end = usize::try_from(segment.get("endLine")?.as_u64()?).ok()?;
        let label = segment.get("label")?.as_str()?;
        if label.trim().is_empty()
            || label.len() > 4096
            || start < next
            || end < start
            || end >= line_count
        {
            return None;
        }
        if next < start {
            ranges.push((next, start - 1, None, None));
        }
        ranges.push((start, end, Some(label), Some(index)));
        next = end.checked_add(1)?;
    }
    if next < line_count {
        ranges.push((next, line_count - 1, None, None));
    }
    Some(ranges)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan(content: &str, segments: &JsonValue) -> JsonValue {
        serde_json::from_str(&plan_source_segment_chunks_json(
            "synthetic.pdf",
            "pdf",
            content,
            1000,
            50,
            &segments.to_string(),
        ))
        .unwrap_or(JsonValue::Null)
    }
    #[test]
    fn source_segment_chunks_preserve_absolute_lines_and_boundaries() {
        let result = plan(
            "first\n\nsecond\nlast",
            &serde_json::json!([
                {"label":"Page 1","startLine":0,"endLine":0},
                {"label":"Page 2","startLine":2,"endLine":3}
            ]),
        );
        assert_eq!(result.as_array().map_or(0, Vec::len), 2);
        assert_eq!(
            result.pointer("/0/metadata/sourceSegment"),
            Some(&serde_json::json!(0))
        );
        assert_eq!(
            result.pointer("/1/metadata/sourceSegment"),
            Some(&serde_json::json!(1))
        );
        assert_eq!(
            result.pointer("/0/text").unwrap_or(&JsonValue::Null),
            "first"
        );
        assert_eq!(
            result.pointer("/1/text").unwrap_or(&JsonValue::Null),
            "second\nlast"
        );
        assert_eq!(
            result
                .pointer("/1/metadata/startLine")
                .unwrap_or(&JsonValue::Null),
            3
        );
        assert_eq!(
            result
                .pointer("/1/metadata/endLine")
                .unwrap_or(&JsonValue::Null),
            4
        );
        assert_eq!(
            result
                .pointer("/1/metadata/heading")
                .unwrap_or(&JsonValue::Null),
            "Page 2"
        );
    }
    #[test]
    fn source_segment_chunks_reject_overlap_and_invalid_ranges() {
        for segments in [
            &serde_json::json!([{"label":"bad","startLine":1,"endLine":0}]),
            &serde_json::json!([{"label":"bad","startLine":0,"endLine":9}]),
            &serde_json::json!([{"label":"a","startLine":0,"endLine":1},{"label":"b","startLine":1,"endLine":1}]),
            &serde_json::json!([{"label":"bad","startLine":-1,"endLine":0}]),
        ] {
            assert!(plan("a\nb", segments).is_null());
        }
    }
    #[test]
    fn source_segment_chunks_large_plaintext_does_not_gain_segment_limit() {
        let text = "x".repeat(32 * 1024 * 1024 + 1);
        let output =
            plan_source_segment_chunks_json("large.txt", "txt", &text, 1024 * 1024, 0, "[]");
        let parsed: JsonValue = serde_json::from_str(&output).unwrap_or(JsonValue::Null);
        let restored_bytes = parsed.as_array().map(|chunks| {
            chunks
                .iter()
                .filter_map(|chunk| chunk.get("text").and_then(JsonValue::as_str))
                .map(str::len)
                .sum::<usize>()
        });
        assert_eq!(restored_bytes, Some(text.len()));
    }

    #[test]
    fn source_segment_chunks_empty_segments_are_legacy_identical() {
        let text = "# Heading\n\n[[Link]] ![[Embed]]\n\n```ts\nconst a = 1;\n```";
        assert_eq!(
            plan_source_segment_chunks_json("a.md", "md", text, 100, 20, "[]"),
            plan_source_chunks_json("a.md", "md", text, 100, 20)
        );
    }
}

#[cfg(test)]
mod additional_tests {
    use super::*;
    #[test]
    fn source_segment_chunks_labels_do_not_enter_hashes_and_duplicates_have_global_ordinals() {
        let segments = serde_json::json!([
            {"label":"Page 1","startLine":0,"endLine":0},
            {"label":"Page 2","startLine":2,"endLine":2}
        ]);
        let result: JsonValue = serde_json::from_str(&plan_source_segment_chunks_json(
            "a.pdf",
            "pdf",
            "same\n\nsame",
            100,
            0,
            &segments.to_string(),
        ))
        .unwrap_or(JsonValue::Null);
        assert_eq!(
            result.pointer("/0/chunkHash").unwrap_or(&JsonValue::Null),
            result.pointer("/1/chunkHash").unwrap_or(&JsonValue::Null)
        );
        assert_ne!(
            result.pointer("/0/id").unwrap_or(&JsonValue::Null),
            result.pointer("/1/id").unwrap_or(&JsonValue::Null)
        );
        assert!(
            result
                .pointer("/0/id")
                .unwrap_or(&JsonValue::Null)
                .as_str()
                .unwrap_or_default()
                .ends_with("::0")
        );
        assert!(
            result
                .pointer("/1/id")
                .unwrap_or(&JsonValue::Null)
                .as_str()
                .unwrap_or_default()
                .ends_with("::1")
        );
        let legacy: JsonValue =
            serde_json::from_str(&plan_source_chunks_json("a.pdf", "pdf", "same", 100, 0))
                .unwrap_or(JsonValue::Null);
        assert_eq!(
            result.pointer("/0/id").unwrap_or(&JsonValue::Null),
            legacy.pointer("/0/id").unwrap_or(&JsonValue::Null)
        );
    }
    #[test]
    fn source_segment_chunks_keep_unlabelled_gaps_and_blank_lines() {
        let result: JsonValue = serde_json::from_str(&plan_source_segment_chunks_json(
            "a.pdf",
            "pdf",
            "before\n\nlabelled\n\nafter\n",
            100,
            0,
            r#"[{"label":"Stored part","startLine":2,"endLine":2}]"#,
        ))
        .unwrap_or(JsonValue::Null);
        let chunks = &result;
        assert_eq!(chunks.as_array().map_or(0, Vec::len), 3);
        assert_eq!(
            chunks.pointer("/0/text").unwrap_or(&JsonValue::Null),
            "before"
        );
        assert_eq!(
            chunks.pointer("/1/text").unwrap_or(&JsonValue::Null),
            "labelled"
        );
        assert_eq!(
            chunks
                .pointer("/1/metadata/startLine")
                .unwrap_or(&JsonValue::Null),
            3
        );
        assert_eq!(
            chunks.pointer("/2/text").unwrap_or(&JsonValue::Null),
            "after"
        );
        assert_eq!(
            chunks
                .pointer("/2/metadata/startLine")
                .unwrap_or(&JsonValue::Null),
            5
        );
        assert!(
            chunks
                .pointer("/2/metadata")
                .unwrap_or(&JsonValue::Null)
                .get("heading")
                .is_none()
        );
    }
    #[test]
    fn source_segment_chunks_bounded_failures_and_markdown_structure() {
        let segment = r#"[{"label":"Page 1","startLine":0,"endLine":0}]"#;
        assert_eq!(
            plan_source_segment_chunks_json("a", "pdf", "a", 0, 0, segment),
            "null"
        );
        assert_eq!(
            plan_source_segment_chunks_json("a", "pdf", "a", 10, 10, segment),
            "null"
        );
        assert_eq!(
            plan_source_segment_chunks_json("a", "pdf", "a", 10, 0, "{}"),
            "null"
        );
        assert_eq!(
            plan_source_segment_chunks_json("a", "pdf", &"a".repeat(200_001), 1, 0, segment),
            "null"
        );
        let text = "# Heading\n\n[[Link]] ![[Embed]]\n\n```ts\nconst a = 1;\n```";
        let segments = serde_json::json!([{"label":"Chapter","startLine":0,"endLine":6}]);
        let result: JsonValue = serde_json::from_str(&plan_source_segment_chunks_json(
            "a.md",
            "md",
            text,
            1000,
            0,
            &segments.to_string(),
        ))
        .unwrap_or(JsonValue::Null);
        let legacy: JsonValue =
            serde_json::from_str(&plan_source_chunks_json("a.md", "md", text, 1000, 0))
                .unwrap_or(JsonValue::Null);
        assert_eq!(
            result.pointer("/0/id").unwrap_or(&JsonValue::Null),
            legacy.pointer("/0/id").unwrap_or(&JsonValue::Null)
        );
        assert_eq!(
            result.pointer("/0/text").unwrap_or(&JsonValue::Null),
            legacy.pointer("/0/text").unwrap_or(&JsonValue::Null)
        );
        assert_eq!(
            result
                .pointer("/0/metadata/heading")
                .unwrap_or(&JsonValue::Null),
            "Chapter · Heading"
        );
    }
}
