//! 바이트 판정부터 hash·원장 signature·청킹까지 source 작업 하나의 계산 경계.
use crate::{JsonValue, create_content_hash, source_extract, source_segment_chunks, text_decode};
use serde_json::json;
use wasm_bindgen::prelude::wasm_bindgen;

/// 본문 없는 명시적 실패 wire입니다.
fn failure(reason: &str) -> JsonValue {
    json!({"ok":false,"format":"text","text":"","segments":[],"reason":reason})
}

/// 실제 바이너리는 평문 64MiB 한도를 적용하기 전에 구조 추출기로 보냅니다.
/// PDF의 입력은 worker가 소유한 같은 buffer를 PDF worker에 이동해야 합니다.
#[must_use]
#[wasm_bindgen]
pub fn prepare_source_bytes_json(extension: &str, bytes: &[u8], preparation_json: &str) -> String {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if bytes.len() > 128 * 1024 * 1024 || preparation_json.len() > 16 * 1024 {
        return failure(if extension == "pdf" {
            "too-large"
        } else {
            "memory-budget"
        })
        .to_string();
    }
    let source = if text_decode::has_binary_magic(bytes) {
        if extension == "pdf" && bytes.starts_with(b"%PDF-") {
            if bytes.len() > 128 * 1024 * 1024 {
                failure("too-large")
            } else {
                json!({"ok":true,"format":"pdf","text":"","segments":[],"reason":null,"binary":true})
            }
        } else if source_extract::is_extractable_source_extension(&extension) && extension != "pdf"
        {
            match source_extract::extract_for_preparation(&extension, bytes) {
                Ok((text, segments, metadata)) => {
                    let mut result = json!({"ok":true,"format":extension,"text":text,"segments":segments,"reason":null});
                    if !metadata.is_empty() {
                        insert(&mut result, "metadataParts", JsonValue::Array(metadata));
                    }
                    result
                }
                Err(reason) => failure(reason),
            }
        } else {
            failure("binary")
        }
    } else {
        match text_decode::decode_for_preparation(bytes) {
            Ok(text) => json!({"ok":true,"format":"text","text":text,"segments":[],"reason":null}),
            Err(reason) => failure(reason),
        }
    };
    finish(source, &extension, preparation_json).to_string()
}

/// PDF 추출·완전성 및 캐시 결과도 동일한 Rust 준비 계약으로 계산합니다.
#[must_use]
#[wasm_bindgen]
pub fn prepare_source_text_json(
    extension: &str,
    source_json: &str,
    preparation_json: &str,
) -> String {
    if source_json.len() > 256 * 1024 * 1024 || preparation_json.len() > 16 * 1024 {
        return failure("memory-budget").to_string();
    }
    let source = serde_json::from_str(source_json).unwrap_or_else(|_| failure("invalid-source"));
    finish(source, extension, preparation_json).to_string()
}

/// 이미 복원한 원문에 파일 수준 signature와 선택적인 청크 계획을 결합합니다.
fn finish(mut source: JsonValue, extension: &str, preparation_json: &str) -> JsonValue {
    if at(&source, "/ok") != true || at(&source, "/binary") == true || preparation_json.is_empty() {
        return source;
    }
    let Ok(config) = serde_json::from_str::<JsonValue>(preparation_json) else {
        return failure("invalid-preparation");
    };
    let Some(path) = at(&config, "/path")
        .as_str()
        .filter(|path| path.len() <= 4096)
    else {
        return failure("invalid-preparation");
    };
    let Some((max_charge, max_chunks)) = preparation_limits(&config) else {
        return failure("invalid-preparation");
    };
    let Some(text) = at(&source, "/text").as_str() else {
        return failure("invalid-source");
    };
    let Some(segments) = at(&source, "/segments").as_array() else {
        return failure("invalid-source");
    };
    let Some(metadata_json) = preparation_metadata_json(&source) else {
        return failure("invalid-source");
    };
    let metadata_bytes = metadata_json.encode_utf16().count().saturating_mul(2);
    let base_charge = text
        .encode_utf16()
        .count()
        .saturating_mul(8)
        .saturating_add(metadata_bytes.saturating_mul(2));
    if base_charge > max_charge {
        return failure("memory-budget");
    }
    let Some(body_plan) = crate::literal_inventory::source_body_plan(text) else {
        return failure("memory-budget");
    };
    let Some(plan_charge) = crate::literal_inventory::body_plan_metadata_charge(&body_plan) else {
        return failure("memory-budget");
    };
    if base_charge
        .checked_add(plan_charge)
        .is_none_or(|charge| charge > max_charge)
    {
        return failure("memory-budget");
    }
    let mut chunk_charge = 0_usize;
    let chunks = if let Some(size) = config.get("chunkSize") {
        let Some(size) = size.as_u64().and_then(|value| usize::try_from(value).ok()) else {
            return failure("invalid-preparation");
        };
        let Some(overlap) = config
            .get("overlap")
            .map_or(Some(0), JsonValue::as_u64)
            .and_then(|value| usize::try_from(value).ok())
        else {
            return failure("invalid-preparation");
        };
        let small: Vec<_> = segments.iter().map(|segment| json!({"label":at(segment, "/label"),"startLine":at(segment, "/startLine"),"endLine":at(segment, "/endLine")})).collect();
        let planned = source_segment_chunks::plan_source_segment_chunks_json(
            path,
            extension,
            text,
            size,
            overlap,
            &json!(small).to_string(),
        );
        chunk_charge = planned.encode_utf16().count().saturating_mul(4);
        let Ok(chunks) = serde_json::from_str::<JsonValue>(&planned) else {
            return failure("chunking-unavailable");
        };
        let Some(chunk_array) = chunks.as_array() else {
            return failure("chunking-unavailable");
        };
        if max_chunks.is_some_and(|limit| {
            u64::try_from(chunk_array.len()).unwrap_or(u64::MAX) > u64::from(limit)
        }) {
            return failure("memory-budget");
        }
        Some(chunks)
    } else {
        None
    };
    // UTF-16 호스트 값·wire·작업 사본의 보수적 charge이며 실제 RSS 상한이 아닙니다.
    let mut prepared = json!({"contentHash":create_content_hash(text),"sourceMetadataHash":create_content_hash(&metadata_json),"sourceMetadataBytes":metadata_bytes});
    if let Some(chunks) = chunks {
        insert(&mut prepared, "chunks", chunks);
    }
    let Some(charge) = base_charge
        .checked_add(chunk_charge)
        .and_then(|charge| charge.checked_add(plan_charge))
    else {
        return failure("memory-budget");
    };
    if charge > max_charge {
        return failure("memory-budget");
    }
    insert(&mut prepared, "bodyPlan", body_plan);
    insert(&mut prepared, "chargeBytes", json!(charge));
    insert(&mut source, "prepared", prepared);
    source
}

/// 큰 locator 원장은 파일 수준으로 한 번만 직렬화합니다.
fn preparation_metadata_json(source: &JsonValue) -> Option<String> {
    let mut metadata = vec![b'{'];
    for key in ["completeness", "metadataParts", "segments"] {
        if let Some(value) = source.get(key) {
            if metadata.len() > 1 {
                metadata.push(b',');
            }
            serde_json::to_writer(&mut metadata, key).ok()?;
            metadata.push(b':');
            serde_json::to_writer(&mut metadata, value).ok()?;
        }
    }
    metadata.push(b'}');
    String::from_utf8(metadata).ok()
}

/// 선택 예산은 기존 상한을 완화하지 않고, 잘못된 값은 기본값으로 보정하지 않습니다.
fn preparation_limits(config: &JsonValue) -> Option<(usize, Option<u32>)> {
    let max_charge = config
        .get("maxChargeBytes")
        .map_or(Some(1024 * 1024 * 1024), |value| {
            value
                .as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .filter(|value| *value <= 1024 * 1024 * 1024)
        })?;
    let max_chunks = match config.get("maxPreparedChunks") {
        Some(value) => Some(u32::try_from(value.as_u64()?).ok()?),
        None => None,
    };
    Some((max_charge, max_chunks))
}

/// 잘못된 JSON 좌표는 panic 대신 null로 닫습니다.
fn at<'a>(value: &'a JsonValue, pointer: &str) -> &'a JsonValue {
    value.pointer(pointer).unwrap_or(&JsonValue::Null)
}

/// 내부 object에만 새 필드를 이동하며 원장 본문을 복제하지 않습니다.
fn insert(value: &mut JsonValue, key: &str, field: JsonValue) {
    if let Some(object) = value.as_object_mut() {
        object.insert(key.to_owned(), field);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 합성 JSON을 파싱하며 손상 응답은 assertion에서 실패합니다.
    fn parse(wire: &str) -> JsonValue {
        serde_json::from_str(wire).unwrap_or(JsonValue::Null)
    }

    /// 외부 자료 없이 저장 방식 ZIP을 만듭니다.
    fn zip(entries: &[(&str, &str)]) -> Vec<u8> {
        use std::io::{Cursor, Write};
        let mut buffer = Vec::new();
        let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, text) in entries {
            assert!(writer.start_file(*name, options).is_ok(), "합성 ZIP 항목");
            assert!(writer.write_all(text.as_bytes()).is_ok(), "합성 ZIP 본문");
        }
        assert!(writer.finish().is_ok(), "합성 ZIP 완료");
        buffer
    }

    /// 모든 선언 suffix의 실제 평문은 같은 hash와 청크를 만듭니다.
    #[test]
    fn all_declared_suffixes_use_actual_plain_content() {
        for extension in [
            "pdf", "epub", "docx", "dotx", "odt", "odp", "ods", "pptx", "potx", "ppsx", "xlsx",
            "xltx", "hwpx",
        ] {
            let result = parse(&prepare_source_bytes_json(
                extension,
                "합성 𐀀 evidence".as_bytes(),
                r#"{"path":"synthetic","chunkSize":1000,"overlap":20}"#,
            ));
            assert_eq!(at(&result, "/ok"), true, "평문 {extension}");
            assert_eq!(at(&result, "/format"), "text", "평문 형식");
            assert_eq!(
                at(&result, "/prepared/contentHash"),
                &json!(create_content_hash("합성 𐀀 evidence")),
                "단일 본문 hash"
            );
            assert_eq!(
                at(&result, "/prepared/chunks").as_array().map(Vec::len),
                Some(1),
                "단일 청크"
            );
        }
    }

    /// 손상·모호한 Unicode와 64MiB 초과 평문은 성공이 아닙니다.
    #[test]
    fn corruption_and_plain_budget_stay_closed() {
        for bytes in [
            &b"PK\x03\x04broken"[..],
            &[0xc3, 0x28],
            &[0xff, 0xfe, 0, 0xd8],
        ] {
            assert_eq!(
                at(&parse(&prepare_source_bytes_json("docx", bytes, "")), "/ok"),
                false,
                "손상 실패"
            );
        }
        let bytes = vec![b'a'; 64 * 1024 * 1024 + 1];
        assert_eq!(
            at(
                &parse(&prepare_source_bytes_json("xlsx", &bytes, "")),
                "/reason"
            ),
            "memory-budget",
            "평문 예산"
        );
    }

    /// 진짜 XLSX에는 평문 decoder의 64MiB 상한을 적용하지 않습니다.
    #[test]
    fn large_xlsx_keeps_its_source_budget() {
        let padding = "x".repeat(64 * 1024 * 1024 + 1);
        let bytes = zip(&[
            (
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c t=\"inlineStr\"><is><t>stored cell</t></is></c></row></worksheet>",
            ),
            ("xl/media/padding.bin", &padding),
        ]);
        let result = parse(&prepare_source_bytes_json(
            "xlsx",
            &bytes,
            r#"{"path":"synthetic.xlsx","chunkSize":1000,"overlap":20}"#,
        ));
        assert_eq!(at(&result, "/ok"), true, "구조 문서 예산");
        assert!(
            at(&result, "/text")
                .as_str()
                .is_some_and(|text| text.contains("stored cell")),
            "실제 본문"
        );
        assert_eq!(
            at(&result, "/prepared/chunks/0/metadata/sourceSegment"),
            0,
            "작은 구간 참조"
        );
        assert!(
            at(&result, "/prepared/chunks/0/metadata/locator").is_null(),
            "청크에 원장 미복제"
        );
    }

    /// 암호 flag와 실제 구조 PDF는 평문 성공으로 바뀌지 않습니다.
    #[test]
    fn encrypted_and_pdf_routes_stay_binary() {
        let mut encrypted = zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>secret</w:t></w:p></w:document>",
        )]);
        if let Some(flag) = encrypted.get_mut(6) {
            *flag |= 1;
        }
        if let Some(central) = encrypted
            .windows(4)
            .position(|bytes| bytes == b"PK\x01\x02")
            && let Some(flag) = encrypted.get_mut(central + 8)
        {
            *flag |= 1;
        }
        let result = parse(&prepare_source_bytes_json("docx", &encrypted, ""));
        assert_eq!(at(&result, "/ok"), false, "암호 문서 실패");
        assert_eq!(at(&result, "/reason"), "encrypted", "암호 사유");
        let result = parse(&prepare_source_bytes_json(
            "pdf",
            b"%PDF-1.7\nsynthetic broken document\n%%EOF",
            "",
        ));
        assert_eq!(at(&result, "/binary"), true, "PDF worker 소유 경로");
        assert_eq!(at(&result, "/text"), "", "가짜 평문 없음");
    }

    /// metadata-only workbook은 실제 producer의 원장을 보존하고 quote를 만들지 않습니다.
    #[test]
    fn metadata_only_has_no_fake_quote() {
        let bytes = zip(&[(
            "xl/worksheets/sheet1.xml",
            "<worksheet><row><c r=\"B2\"/></row></worksheet>",
        )]);
        let result = parse(&prepare_source_bytes_json(
            "xlsx",
            &bytes,
            r#"{"path":"synthetic.xlsx","chunkSize":1000,"overlap":20}"#,
        ));
        assert_eq!(at(&result, "/ok"), true, "실제 producer 성공");
        assert_eq!(at(&result, "/text"), "", "가짜 본문 없음");
        assert_eq!(
            at(&result, "/prepared/chunks"),
            &json!([]),
            "인용 청크 없음"
        );
        assert_eq!(
            at(&result, "/metadataParts/0/locator/cells/0/address"),
            "B2",
            "파일 원장 유지"
        );
        assert!(
            at(&result, "/prepared/sourceMetadataBytes")
                .as_u64()
                .is_some_and(|size| size > 0),
            "원장 charge"
        );
    }

    /// 큰 원장의 signature만 바뀌어도 본문 hash·청크는 재사용 가능하며 청크에 원장을 복제하지 않습니다.
    #[test]
    fn large_metadata_signature_is_file_level() {
        let cells: Vec<_> = (0..10_000)
            .map(|row| json!({"address":format!("B{row}"),"kind":"stored-cell"}))
            .collect();
        let source = json!({"ok":true,"format":"xlsx","text":"alpha evidence\nbeta evidence\ngamma evidence","segments":[{"label":"Sheet","startLine":0,"endLine":2,"locator":{"cells":cells}}],"reason":null});
        let config = r#"{"path":"synthetic.xlsx","chunkSize":24,"overlap":2}"#;
        let first = parse(&prepare_source_text_json(
            "xlsx",
            &source.to_string(),
            config,
        ));
        let mut changed = source;
        if let Some(cell) = changed.pointer_mut("/segments/0/locator/cells/0") {
            insert(cell, "address", json!("C0"));
        }
        let second = parse(&prepare_source_text_json(
            "xlsx",
            &changed.to_string(),
            config,
        ));
        assert_eq!(at(&first, "/ok"), true, "큰 원장 준비");
        assert!(
            at(&first, "/prepared/sourceMetadataBytes")
                .as_u64()
                .is_some_and(|bytes| bytes > 100_000),
            "실제 큰 원장 charge"
        );
        assert_eq!(
            at(&first, "/prepared/contentHash"),
            at(&second, "/prepared/contentHash"),
            "본문 hash 유지"
        );
        assert_ne!(
            at(&first, "/prepared/sourceMetadataHash"),
            at(&second, "/prepared/sourceMetadataHash"),
            "위치 변경 signature"
        );
        assert_eq!(
            at(&first, "/prepared/chunks"),
            at(&second, "/prepared/chunks"),
            "원장만 변경 시 청크 재사용"
        );
        assert!(
            at(&first, "/prepared/chunks")
                .as_array()
                .is_some_and(|chunks| chunks.len() > 1
                    && chunks
                        .iter()
                        .all(|chunk| at(chunk, "/metadata/locator").is_null()
                            && at(chunk, "/metadata/sourceSegment") == 0)),
            "작은 sourceSegment만 청크에 보존"
        );
    }

    /// 다음 source의 준비 charge는 남은 공유 예산을 넘으면 본문 없는 실패로 닫습니다.
    #[test]
    fn optional_prepared_charge_limit_keeps_exact_boundary_and_metadata() {
        for source in [
            json!({"ok":true,"format":"text","text":"synthetic 𐀀 evidence","segments":[],"reason":null}),
            json!({"ok":true,"format":"xlsx","text":"","segments":[],"metadataParts":[{"sourcePart":"sheet.xml","locator":{"cells":[{"address":"B2"}]}}],"reason":null}),
        ] {
            let source_wire = source.to_string();
            let mut config = json!({"path":"synthetic","chunkSize":1000,"overlap":20});
            let full = parse(&prepare_source_text_json(
                "txt",
                &source_wire,
                &config.to_string(),
            ));
            let charge = at(&full, "/prepared/chargeBytes").as_u64().unwrap_or(0);
            assert!(charge > 0);
            insert(&mut config, "maxChargeBytes", json!(charge));
            assert_eq!(
                parse(&prepare_source_text_json(
                    "txt",
                    &source_wire,
                    &config.to_string()
                )),
                full
            );
            insert(&mut config, "maxChargeBytes", json!(charge - 1));
            let limited = parse(&prepare_source_text_json(
                "txt",
                &source_wire,
                &config.to_string(),
            ));
            assert_eq!(at(&limited, "/ok"), false, "예산 초과는 성공이 아님");
            assert_eq!(at(&limited, "/reason"), "memory-budget");
            assert_eq!(at(&limited, "/text"), "");
            assert!(at(&limited, "/prepared").is_null(), "큰 준비물 미반환");
        }
    }

    /// 잘못된 선택 예산도 묵시적 기본 상한으로 바꾸지 않습니다.
    #[test]
    fn optional_prepared_charge_limit_rejects_malformed_limits() {
        for limit in [
            JsonValue::Null,
            json!(-1),
            json!(1.5),
            json!("100"),
            json!(1024_u64 * 1024 * 1024 + 1),
        ] {
            let config = json!({"path":"synthetic","chunkSize":1000,"maxChargeBytes":limit});
            let result = parse(&prepare_source_bytes_json(
                "md",
                b"synthetic evidence",
                &config.to_string(),
            ));
            assert_eq!(at(&result, "/ok"), false);
            assert_eq!(at(&result, "/reason"), "invalid-preparation");
        }
    }

    /// 겹친 준비도 같은 window의 남은 청크 개수만 반환합니다.
    #[test]
    fn optional_prepared_chunk_limit_preserves_boundary_and_rejects_bad_input() {
        let source = json!({"ok":true,"format":"text","text":"synthetic evidence line\n".repeat(8),"segments":[],"reason":null});
        let mut config = json!({"path":"synthetic","chunkSize":24,"overlap":2});
        let full = parse(&prepare_source_text_json(
            "md",
            &source.to_string(),
            &config.to_string(),
        ));
        let count = at(&full, "/prepared/chunks").as_array().map_or(0, Vec::len);
        assert!(count > 1);
        insert(&mut config, "maxPreparedChunks", json!(count));
        assert_eq!(
            parse(&prepare_source_text_json(
                "md",
                &source.to_string(),
                &config.to_string()
            )),
            full
        );
        insert(&mut config, "maxPreparedChunks", json!(count - 1));
        let limited = parse(&prepare_source_text_json(
            "md",
            &source.to_string(),
            &config.to_string(),
        ));
        assert_eq!(at(&limited, "/ok"), false);
        assert_eq!(at(&limited, "/reason"), "memory-budget");
        for limit in [
            JsonValue::Null,
            json!(-1),
            json!(1.5),
            json!("1"),
            json!(u64::from(u32::MAX) + 1),
        ] {
            insert(&mut config, "maxPreparedChunks", limit);
            assert_eq!(
                at(
                    &parse(&prepare_source_text_json(
                        "md",
                        &source.to_string(),
                        &config.to_string()
                    )),
                    "/reason"
                ),
                "invalid-preparation"
            );
        }
    }

    /// metadata-only 계획은 미확인 바이너리를 unsupported나 실패로 꾸미지 않습니다.
    #[test]
    fn manifest_is_explicitly_unverified() {
        let plan = parse(&crate::plan_rag_indexing_manifest_json(
            r#"[{"filePath":"good.md","fileName":"good.md","extension":"md","size":12},{"filePath":"image.png","fileName":"image.png","extension":"png","size":12},{"filePath":".env","fileName":".env","extension":"","size":12},{"filePath":"private/a.txt","fileName":"a.txt","extension":"txt","size":12}]"#,
            r#"["private"]"#,
            "[]",
        ));
        assert_eq!(
            at(&plan, "/candidateIndices"),
            &json!([0, 1]),
            "미판정 후보"
        );
        assert_eq!(
            at(&plan, "/policyExcludedIndices"),
            &json!([2, 3]),
            "읽기 전 정책 제외"
        );
        assert_eq!(
            at(&plan, "/unsupportedIndices"),
            &json!([]),
            "확정 binary 없음"
        );
        assert_eq!(at(&plan, "/failures"), &json!([]), "I/O 전 실패 없음");
    }
}
