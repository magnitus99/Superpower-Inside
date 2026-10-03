//! 파일의 현재 원문 revision을 기준으로 모든 소비자의 처리 상태를 집계합니다.

use super::{JsonValue, source_revision_matches};
use std::collections::{BTreeMap, BTreeSet};
use wasm_bindgen::prelude::wasm_bindgen;

/// 공통 원문·BM25·임베딩·선택적 그래프의 준비 상태를 파일별로 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_processing_json(input_json: &str) -> String {
    parse_processing(input_json)
        .and_then(|result| serde_json::to_string(&result).ok())
        .unwrap_or_else(|| "null".to_owned())
}

/// 파일별 문서 목록을 인덱싱합니다.
fn by_path<'a>(
    values: &'a [JsonValue],
    field: &str,
) -> Option<BTreeMap<&'a str, Vec<&'a JsonValue>>> {
    let mut result = BTreeMap::<&str, Vec<&JsonValue>>::new();
    for value in values {
        result
            .entry(value.get(field)?.as_str()?)
            .or_default()
            .push(value);
    }
    Some(result)
}

/// 호스트 메타데이터와 원문 해시를 동일한 revision 계약으로 비교합니다.
fn current_revision(file: &JsonValue, record: &JsonValue, hash: &str) -> bool {
    let Some(path) = file.get("filePath").and_then(JsonValue::as_str) else {
        return false;
    };
    let values = ["sourceMtime", "sourceSize"].map(|field| {
        (
            file.get(field).and_then(JsonValue::as_f64),
            record.get(field).and_then(JsonValue::as_f64),
        )
    });
    let [
        (Some(mtime), Some(record_mtime)),
        (Some(size), Some(record_size)),
    ] = values
    else {
        return false;
    };
    source_revision_matches(
        path,
        record
            .get("filePath")
            .or_else(|| record.get("sourcePath"))
            .and_then(JsonValue::as_str)
            .unwrap_or_default(),
        hash,
        record
            .get("contentHash")
            .and_then(JsonValue::as_str)
            .unwrap_or_default(),
        &[mtime, record_mtime, size, record_size],
    )
}

/// 파일 원문을 기준으로 준비 상태를 계산하며 출력 한도와 집계 분모를 분리합니다.
fn parse_processing(input_json: &str) -> Option<JsonValue> {
    let input: JsonValue = serde_json::from_str(input_json).ok()?;
    let config = input.get("config")?;
    let documents = by_path(input.get("documents")?.as_array()?, "sourcePath")?;
    let bm25 = input
        .get("bm25")?
        .as_array()?
        .iter()
        .map(|document| Some((document.get("id")?.as_str()?, document)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let vectors = by_path(input.get("vectors")?.as_array()?, "filePath")?;
    let evidence = by_path(input.get("evidence")?.as_array()?, "filePath")?;
    let caches = input
        .get("cache")?
        .as_array()?
        .iter()
        .map(|record| Some((record.get("entryId")?.as_str()?, record)))
        .collect::<Option<BTreeMap<_, _>>>()?;
    let failed_embedding = input
        .get("failedEmbeddingPaths")?
        .as_array()?
        .iter()
        .map(JsonValue::as_str)
        .collect::<Option<BTreeSet<_>>>()?;
    let failed_graph = input
        .get("failedGraphPaths")?
        .as_array()?
        .iter()
        .map(JsonValue::as_str)
        .collect::<Option<BTreeSet<_>>>()?;
    let mut states = Vec::new();
    for file in input.get("files")?.as_array()? {
        let path = file.get("filePath")?.as_str()?;
        let docs = documents.get(path).map_or(&[][..], Vec::as_slice);
        let source = if file.get("readFailed")?.as_bool()? {
            "failed"
        } else if file.get("readPending")?.as_bool()? || docs.is_empty() {
            "pending"
        } else if docs.iter().all(|document| {
            current_revision(
                file,
                document,
                document
                    .get("contentHash")
                    .and_then(JsonValue::as_str)
                    .unwrap_or_default(),
            )
        }) {
            "ready"
        } else {
            "stale"
        };
        let bm25_state = if !config.get("bm25Enabled")?.as_bool()? {
            "disabled"
        } else if source != "ready" {
            "stale"
        } else if docs.iter().all(|document| {
            document
                .get("id")
                .and_then(JsonValue::as_str)
                .and_then(|id| bm25.get(id))
                .is_some_and(|record| {
                    current_revision(
                        file,
                        record,
                        document
                            .get("contentHash")
                            .and_then(JsonValue::as_str)
                            .unwrap_or_default(),
                    )
                })
        }) {
            "ready"
        } else {
            "pending"
        };
        let embedding = embedding_state(
            file,
            source,
            docs,
            vectors.get(path),
            config,
            failed_embedding.contains(path),
        )?;
        let graph = graph_state(
            source,
            docs,
            &caches,
            config,
            failed_graph.contains(path),
            evidence.get(path).map_or(&[], Vec::as_slice),
        )?;
        states.push(serde_json::json!({ "filePath": path, "source": source, "bm25": bm25_state, "embedding": embedding, "graph": graph, "chat": if source == "ready" { "ready" } else { "pending" } }));
    }
    Some(summarize_processing(
        states,
        usize::try_from(input.get("limit")?.as_u64()?).ok()?,
    ))
}

/// 상세 출력이 잘려도 모든 지원 파일의 준비 상태를 집계합니다.
fn summarize_processing(mut states: Vec<JsonValue>, limit: usize) -> JsonValue {
    let total = states.len();
    let ready = states
        .iter()
        .filter(|state| state.get("chat").and_then(JsonValue::as_str) == Some("ready"))
        .count();
    let complete = states
        .iter()
        .filter(|state| {
            ["source", "bm25", "embedding", "graph"]
                .iter()
                .all(|field| {
                    matches!(
                        state.get(*field).and_then(JsonValue::as_str),
                        Some("ready" | "disabled")
                    )
                })
        })
        .count();
    states.truncate(limit);
    serde_json::json!({ "totalFiles": total, "chatReadyFiles": ready, "completeFiles": complete, "truncated": states.len() < total, "files": states })
}

/// 벡터의 revision·프로바이더·청크 수를 함께 검사합니다.
fn embedding_state(
    file: &JsonValue,
    source: &str,
    docs: &[&JsonValue],
    records: Option<&Vec<&JsonValue>>,
    config: &JsonValue,
    failed: bool,
) -> Option<&'static str> {
    if !config.get("embeddingEnabled")?.as_bool()? {
        return Some("disabled");
    }
    if failed {
        return Some("failed");
    }
    if source != "ready" {
        return Some("stale");
    }
    let hash = docs.first()?.get("contentHash")?.as_str()?;
    let ready = records.is_some_and(|records| {
        records.iter().any(|record| {
            current_revision(file, record, hash)
                && record.get("embeddingProvider") == config.get("embeddingProvider")
                && record.get("embeddingModel") == config.get("embeddingModel")
                && record
                    .get("vectorCount")
                    .and_then(JsonValue::as_u64)
                    .is_some_and(|count| usize::try_from(count).ok() == Some(docs.len()))
        })
    });
    Some(if ready { "ready" } else { "pending" })
}

/// 관계가 없는 정상 추출도 캐시 계약이 일치하면 준비 완료로 인정합니다.
fn graph_state(
    source: &str,
    docs: &[&JsonValue],
    caches: &BTreeMap<&str, &JsonValue>,
    config: &JsonValue,
    failed: bool,
    evidence: &[&JsonValue],
) -> Option<&'static str> {
    if !config.get("graphEnabled")?.as_bool()? {
        return Some("disabled");
    }
    if failed {
        return Some("failed");
    }
    if source != "ready" {
        return Some("stale");
    }
    let hash = docs.first()?.get("contentHash")?.as_str()?;
    if evidence.iter().any(|record| {
        record.get("contentHash").and_then(JsonValue::as_str) != Some(hash)
            || !docs
                .iter()
                .any(|document| document.get("id") == record.get("entryId"))
    }) {
        return Some("stale");
    }
    let ready = docs.iter().all(|document| {
        document
            .get("id")
            .and_then(JsonValue::as_str)
            .and_then(|id| caches.get(id))
            .is_some_and(|cache| {
                cache
                    .get("contentHash")
                    .and_then(JsonValue::as_str)
                    .is_some_and(|hash| {
                        Some(hash) == document.get("chunkHash").and_then(JsonValue::as_str)
                    })
                    && cache.get("extractionModelKey") == config.get("graphModel")
                    && cache.get("ontologySchemaId") == config.get("ontologySchemaId")
                    && cache.get("ontologyVersion") == config.get("ontologyVersion")
                    && cache.get("extractionContractVersion")
                        == config.get("extractionContractVersion")
                    && (config.get("providerEpochId").is_none()
                        || cache.get("providerEpochId") == config.get("providerEpochId"))
            })
    });
    Some(if ready { "ready" } else { "pending" })
}
