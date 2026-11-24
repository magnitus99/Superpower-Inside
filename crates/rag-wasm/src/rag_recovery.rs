//! Deterministic policy for quietly restoring complete RAG coverage.
//!
//! The host supplies only eligible file metadata and the last completed fingerprint. This
//! module decides whether work is needed and how retries are spaced; it never performs I/O.

use std::collections::BTreeMap;

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::storage_lifecycle::storage_key;

/// Maximum automatic recovery attempts allowed in one plugin session.
const MAX_SESSION_ATTEMPTS: u32 = 3;
/// Quiet startup delay followed by bounded retry backoff.
const RETRY_DELAYS_MS: [u32; 3] = [2_000, 30_000, 120_000];
/// Automatic recovery never takes more than this many files in one opportunity.
/// 사용자가 본 대기열이 큰 볼트에서 기회당 대기 문서를 실제로 소진하도록 넉넉히 잡는다.
const MAX_AUTOMATIC_BATCH_FILES: usize = 256;
/// Automatic recovery keeps each opportunity bounded while allowing one large source.
const MAX_AUTOMATIC_BATCH_SOURCE_BYTES: u64 = 16 * 1024 * 1024;

/// JavaScript wire가 정확히 표현하는 가장 큰 정수입니다.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Hash8 형식이 없는 legacy 행은 자동 재시도 억제 근거가 아닙니다.
fn valid_hash(value: &str) -> bool {
    value.len() == 8
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// byte 계수와 달리 원문 시각의 소수를 버리면 다른 revision을 같은 것으로 볼 수 있습니다.
fn source_mtime(value: &JsonValue) -> Option<f64> {
    let mtime = value.as_f64()?;
    (mtime.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(&mtime))
        .then_some(mtime.max(0.0))
}

/// 새 wire는 알려진 scalar만 받고 byte는 정수, 시각은 유한 소수로 검증합니다.
fn valid_recovery_record(value: &JsonValue, source: bool) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let required = if source {
        ["path", "mtime", "size"].as_slice()
    } else {
        ["partial", "hasCompleteMetadata"].as_slice()
    };
    required.iter().all(|key| object.contains_key(*key))
        && object.iter().all(|(key, value)| match key.as_str() {
            "path" => source && value.as_str().is_some_and(|path| !path.trim().is_empty()),
            "mtime" => source_mtime(value).is_some(),
            "size" => value
                .as_u64()
                .is_some_and(|number| number <= MAX_SAFE_INTEGER),
            "contentHash" | "sourceMetadataHash" => value.is_string(),
            "invalidated" => source && value.is_boolean(),
            "partial" | "hasCompleteMetadata" => !source && value.is_boolean(),
            "corpusRecord" | "vectorRecord" => source && valid_recovery_record(value, false),
            _ => false,
        })
}

/// cold cache 부재는 변경 증거나 현재 원문 proof가 아닌 stat 기반 억제 힌트입니다.
fn defers_partial(file: &JsonValue, record: &JsonValue) -> bool {
    file.get("invalidated").and_then(JsonValue::as_bool) != Some(true)
        && record.get("partial").and_then(JsonValue::as_bool) == Some(true)
        && record
            .get("hasCompleteMetadata")
            .and_then(JsonValue::as_bool)
            == Some(true)
        && record.get("mtime").and_then(source_mtime) == file.get("mtime").and_then(source_mtime)
        && record.get("size") == file.get("size")
        && ["contentHash", "sourceMetadataHash"].iter().all(|key| {
            record
                .get(*key)
                .and_then(JsonValue::as_str)
                .is_some_and(valid_hash)
                && file
                    .get(*key)
                    .is_none_or(|hash| Some(hash) == record.get(*key))
        })
}

/// Selects the files eligible for quiet recovery and one bounded smallest/oldest-first batch.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_automatic_recovery_batch_json(files_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(files_json) else {
        return String::new();
    };
    let Some(records) = value.as_array() else {
        return String::new();
    };
    let mut eligible = Vec::<(usize, String, f64, u64)>::new();
    let mut deferred_indices = Vec::new();
    let mut paths = std::collections::BTreeSet::new();
    for (index, file) in records.iter().enumerate() {
        if !valid_recovery_record(file, true) {
            return String::new();
        }
        let Some(path) = file.get("path").and_then(JsonValue::as_str) else {
            return String::new();
        };
        let Some(mtime) = file.get("mtime").and_then(source_mtime) else {
            return String::new();
        };
        let Some(size) = file.get("size").and_then(JsonValue::as_u64) else {
            return String::new();
        };
        if !paths.insert(path) {
            return String::new();
        }
        // lexical-first corpus가 있으면 이전 vector partial로 새 corpus 실패를 가리지 않습니다.
        if file
            .get("corpusRecord")
            .or_else(|| file.get("vectorRecord"))
            .is_some_and(|record| defers_partial(file, record))
        {
            deferred_indices.push(index);
        } else {
            eligible.push((index, path.to_owned(), mtime, size));
        }
    }
    let eligible_indices = eligible.iter().map(|record| record.0).collect::<Vec<_>>();
    eligible.sort_by(|left, right| {
        left.3
            .cmp(&right.3)
            .then_with(|| left.2.total_cmp(&right.2))
            .then_with(|| left.1.encode_utf16().cmp(right.1.encode_utf16()))
    });
    let mut selected_source_bytes = 0_u64;
    let mut batch_indices = Vec::new();
    for (index, _path, _mtime, size) in eligible {
        if batch_indices.len() >= MAX_AUTOMATIC_BATCH_FILES {
            break;
        }
        // 첫 파일은 크기와 무관하게 넣어 큰 문서가 차례를 영영 못 잡지 않게 한다.
        if !batch_indices.is_empty()
            && selected_source_bytes.saturating_add(size) > MAX_AUTOMATIC_BATCH_SOURCE_BYTES
        {
            continue;
        }
        selected_source_bytes = selected_source_bytes.saturating_add(size);
        batch_indices.push(index);
    }

    json!({
        "pendingDocumentCount": records.len(),
        "actionableDocumentCount": eligible_indices.len(),
        "deferredDocumentCount": deferred_indices.len(),
        "deferredIndices": deferred_indices,
        "eligibleIndices": eligible_indices,
        "batchIndices": batch_indices,
        "selectedSourceBytes": selected_source_bytes,
    })
    .to_string()
}

/// Plans automatic recovery from a canonical snapshot of eligible vault files.
///
/// Invalid payloads return an empty string so the host wrapper can fail closed without
/// reimplementing policy in TypeScript.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_automatic_recovery_json(
    files_json: &str,
    completed_fingerprint: &str,
    attempt: u32,
    pending_document_count: u32,
) -> String {
    let Some(files) = parse_file_snapshot(files_json) else {
        return String::new();
    };
    let fingerprint = snapshot_fingerprint(&files);
    let current = completed_fingerprint == fingerprint && pending_document_count == 0;
    let retry_delay_ms = rag_automatic_recovery_delay_ms(attempt);
    let retry_allowed = retry_delay_ms > 0;
    let file_count = files.len();

    json!({
        "fingerprint": fingerprint,
        "requiresRecovery": !current && file_count > 0 && retry_allowed,
        "shouldRecordCompletion": !current && file_count == 0 && pending_document_count == 0,
        "retryAllowed": retry_allowed,
        "retryDelayMs": retry_delay_ms,
        "fileCount": file_count,
    })
    .to_string()
}

/// Returns the Rust-owned delay for a recovery attempt, or zero when the session is exhausted.
#[must_use]
#[wasm_bindgen]
pub fn rag_automatic_recovery_delay_ms(attempt: u32) -> u32 {
    if attempt >= MAX_SESSION_ATTEMPTS {
        return 0;
    }
    RETRY_DELAYS_MS
        .get(usize::try_from(attempt).unwrap_or(usize::MAX))
        .copied()
        .unwrap_or(0)
}

/// Applies the storage health gate before reconciliation or generation deletion.
#[must_use]
#[wasm_bindgen]
pub fn plan_rag_storage_health_json(health_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(health_json) else {
        return String::new();
    };
    let Some(health_input) = value.as_object() else {
        return String::new();
    };
    let Some(coverage_checked) = health_input
        .get("coverageChecked")
        .and_then(JsonValue::as_bool)
    else {
        return String::new();
    };
    let Some(pending_document_count) = health_input
        .get("pendingDocumentCount")
        .and_then(JsonValue::as_u64)
    else {
        return String::new();
    };
    let Some(embedding_contract_matches) = health_input
        .get("embeddingContractMatches")
        .and_then(JsonValue::as_bool)
    else {
        return String::new();
    };
    let Some(completion_fingerprint_matches) = health_input
        .get("completionFingerprintMatches")
        .and_then(JsonValue::as_bool)
    else {
        return String::new();
    };
    let Some(active_store_queryable) = health_input
        .get("activeStoreQueryable")
        .and_then(JsonValue::as_bool)
    else {
        return String::new();
    };
    let Some(reconciliation_complete) = health_input
        .get("reconciliationComplete")
        .and_then(JsonValue::as_bool)
    else {
        return String::new();
    };
    let healthy = coverage_checked
        && pending_document_count == 0
        && embedding_contract_matches
        && completion_fingerprint_matches
        && active_store_queryable;
    json!({
        "canReconcile": healthy,
        "canDeleteStaleGenerations": healthy && reconciliation_complete,
    })
    .to_string()
}

/// Parses and path-sorts a unique eligible-file snapshot.
fn parse_file_snapshot(payload: &str) -> Option<BTreeMap<String, (f64, u64)>> {
    let values = serde_json::from_str::<JsonValue>(payload).ok()?;
    let records = values.as_array()?;
    let mut files = BTreeMap::new();
    for record in records {
        let object = record.as_object()?;
        let path = object.get("path")?.as_str()?.trim();
        let mtime = object.get("mtime").and_then(source_mtime)?;
        let size = object
            .get("size")?
            .as_u64()
            .filter(|size| *size <= MAX_SAFE_INTEGER)?;
        if path.is_empty() || files.insert(path.to_owned(), (mtime, size)).is_some() {
            return None;
        }
    }
    Some(files)
}

/// Hashes canonical file metadata without reading note content.
fn snapshot_fingerprint(files: &BTreeMap<String, (f64, u64)>) -> String {
    let mut owned_parts = Vec::with_capacity(1 + files.len() * 3);
    owned_parts.push("rag-automatic-recovery-v1".to_owned());
    for (path, (mtime, size)) in files {
        owned_parts.push(path.clone());
        owned_parts.push(mtime.to_string());
        owned_parts.push(size.to_string());
    }
    let parts = owned_parts.iter().map(String::as_str).collect::<Vec<_>>();
    storage_key(&parts)
}

#[cfg(test)]
mod tests {
    use super::plan_rag_automatic_recovery_batch_json;
    use super::plan_rag_automatic_recovery_json;
    use super::plan_rag_storage_health_json;
    use serde_json::{Value as JsonValue, json};

    #[test]
    fn fingerprint_is_order_independent_and_completion_skips_work() {
        let first = plan_rag_automatic_recovery_json(
            r#"[{"path":"b.md","mtime":2,"size":20},{"path":"a.md","mtime":1,"size":10}]"#,
            "",
            0,
            0,
        );
        let first: JsonValue = serde_json::from_str(&first).unwrap_or_default();
        let fingerprint = first
            .get("fingerprint")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        let second = plan_rag_automatic_recovery_json(
            r#"[{"path":"a.md","mtime":1,"size":10},{"path":"b.md","mtime":2,"size":20}]"#,
            fingerprint,
            0,
            0,
        );
        let second: JsonValue = serde_json::from_str(&second).unwrap_or_default();

        assert_eq!(first.get("fingerprint"), second.get("fingerprint"));
        assert_eq!(
            first.get("requiresRecovery").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            second.get("requiresRecovery").and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn retry_policy_is_bounded() {
        let files = r#"[{"path":"a.md","mtime":1,"size":10}]"#;
        let attempts = [(0_u32, 2_000_u64), (1, 30_000), (2, 120_000)];
        for (attempt, delay) in attempts {
            let plan = plan_rag_automatic_recovery_json(files, "", attempt, 0);
            let plan: JsonValue = serde_json::from_str(&plan).unwrap_or_default();
            assert_eq!(
                plan.get("retryDelayMs").and_then(JsonValue::as_u64),
                Some(delay)
            );
            assert_eq!(
                plan.get("requiresRecovery").and_then(JsonValue::as_bool),
                Some(true)
            );
        }
        let exhausted = plan_rag_automatic_recovery_json(files, "", 3, 0);
        let exhausted: JsonValue = serde_json::from_str(&exhausted).unwrap_or_default();
        assert_eq!(
            exhausted.get("retryAllowed").and_then(JsonValue::as_bool),
            Some(false)
        );
        assert_eq!(
            exhausted
                .get("requiresRecovery")
                .and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn pending_documents_override_a_matching_completion_marker() {
        let files = r#"[{"path":"a.md","mtime":1,"size":10}]"#;
        let initial = plan_rag_automatic_recovery_json(files, "", 0, 0);
        let initial: JsonValue = serde_json::from_str(&initial).unwrap_or_default();
        let fingerprint = initial
            .get("fingerprint")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        let damaged = plan_rag_automatic_recovery_json(files, fingerprint, 0, 1);
        let damaged: JsonValue = serde_json::from_str(&damaged).unwrap_or_default();
        assert_eq!(
            damaged.get("requiresRecovery").and_then(JsonValue::as_bool),
            Some(true)
        );
    }

    #[test]
    fn storage_health_gate_blocks_cleanup_until_reconciliation_finishes() {
        let before = plan_rag_storage_health_json(
            r#"{"coverageChecked":true,"pendingDocumentCount":0,"embeddingContractMatches":true,"completionFingerprintMatches":true,"activeStoreQueryable":true,"reconciliationComplete":false}"#,
        );
        let before: JsonValue = serde_json::from_str(&before).unwrap_or_default();
        assert_eq!(
            before.get("canReconcile").and_then(JsonValue::as_bool),
            Some(true)
        );
        assert_eq!(
            before
                .get("canDeleteStaleGenerations")
                .and_then(JsonValue::as_bool),
            Some(false)
        );
        let after = plan_rag_storage_health_json(
            r#"{"coverageChecked":true,"pendingDocumentCount":0,"embeddingContractMatches":true,"completionFingerprintMatches":true,"activeStoreQueryable":true,"reconciliationComplete":true}"#,
        );
        let after: JsonValue = serde_json::from_str(&after).unwrap_or_default();
        assert_eq!(
            after
                .get("canDeleteStaleGenerations")
                .and_then(JsonValue::as_bool),
            Some(true)
        );
        let unhealthy = plan_rag_storage_health_json(
            r#"{"coverageChecked":true,"pendingDocumentCount":1,"embeddingContractMatches":true,"completionFingerprintMatches":true,"activeStoreQueryable":true,"reconciliationComplete":true}"#,
        );
        let unhealthy: JsonValue = serde_json::from_str(&unhealthy).unwrap_or_default();
        assert_eq!(
            unhealthy.get("canReconcile").and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn recovery_preserves_fractional_source_clock_without_rounding_counts() {
        let files = json!([{"path": "fractional.pdf", "mtime": 1.25, "size": 10, "corpusRecord": {"mtime": 1.25, "size": 10, "contentHash": "1234abcd", "sourceMetadataHash": "abcd1234", "partial": true, "hasCompleteMetadata": true}}]);
        let batch: JsonValue =
            serde_json::from_str(&plan_rag_automatic_recovery_batch_json(&files.to_string()))
                .unwrap_or_default();
        assert_eq!(batch.get("deferredIndices"), Some(&json!([0])));
        let first: JsonValue = serde_json::from_str(&plan_rag_automatic_recovery_json(
            &files.to_string(),
            "",
            0,
            1,
        ))
        .unwrap_or_default();
        let changed = json!([{"path": "fractional.pdf", "mtime": 1.5, "size": 10}]);
        let next: JsonValue = serde_json::from_str(&plan_rag_automatic_recovery_json(
            &changed.to_string(),
            "",
            0,
            1,
        ))
        .unwrap_or_default();
        assert!(first.get("fingerprint").is_some());
        assert!(next.get("fingerprint").is_some());
        assert_ne!(first.get("fingerprint"), next.get("fingerprint"));
        let fractional_size = json!([{"path": "fractional.pdf", "mtime": 1.5, "size": 1.5}]);
        assert!(plan_rag_automatic_recovery_batch_json(&fractional_size.to_string()).is_empty());
    }

    #[test]
    fn corpus_partial_is_deferred_without_completing_coverage_debt() {
        let record = json!({"mtime": 1, "size": 10, "contentHash": "1234abcd", "sourceMetadataHash": "abcd1234", "partial": true, "hasCompleteMetadata": true});
        let file = json!({"path": "partial.pdf", "mtime": 1, "size": 10, "corpusRecord": record});
        let plan: JsonValue = serde_json::from_str(&plan_rag_automatic_recovery_batch_json(
            &json!([file]).to_string(),
        ))
        .unwrap_or_default();
        assert_eq!(plan.get("deferredIndices"), Some(&json!([0])));
        assert_eq!(plan.get("batchIndices"), Some(&json!([])));
        assert_eq!(plan.get("pendingDocumentCount"), Some(&json!(1)));
        assert_eq!(plan.get("actionableDocumentCount"), Some(&json!(0)));
    }

    #[test]
    fn partial_hints_allow_changes_and_uncertified_legacy() {
        let base = json!({"path": "partial.pdf", "mtime": 1, "size": 10, "corpusRecord": {"mtime": 1, "size": 10, "contentHash": "1234abcd", "sourceMetadataHash": "abcd1234", "partial": true, "hasCompleteMetadata": true}});
        let cases = [
            ("", JsonValue::Null, true),
            ("mtime", json!(2), false),
            ("size", json!(11), false),
            ("invalidated", json!(true), false),
            ("contentHash", json!("8765abcd"), false),
            ("sourceMetadataHash", json!("abcd4321"), false),
            ("contentHash", json!("1234abcd"), true),
            ("corpusRecord.sourceMetadataHash", json!(""), false),
            ("corpusRecord.contentHash", json!("malformed"), false),
            ("corpusRecord.partial", json!(false), false),
            ("corpusRecord.hasCompleteMetadata", json!(false), false),
            ("corpusRecord.mtime", json!(2), false),
        ];
        for (key, value, deferred) in cases {
            let mut file = base.clone();
            if let Some((parent, child)) = key.split_once('.') {
                if let Some(object) = file.get_mut(parent).and_then(JsonValue::as_object_mut) {
                    object.insert(child.to_owned(), value);
                }
            } else if !key.is_empty()
                && let Some(object) = file.as_object_mut()
            {
                object.insert(key.to_owned(), value);
            }
            let plan: JsonValue = serde_json::from_str(&plan_rag_automatic_recovery_batch_json(
                &json!([file]).to_string(),
            ))
            .unwrap_or_default();
            assert_eq!(
                plan.get("deferredIndices"),
                Some(&if deferred { json!([0]) } else { json!([]) }),
                "{key}"
            );
            assert_eq!(plan.get("pendingDocumentCount"), Some(&json!(1)), "{key}");
        }
        let legacy = json!([{"path": "legacy.pdf", "mtime": 1, "size": 10, "vectorRecord": {"mtime": 1, "size": 10, "partial": true, "hasCompleteMetadata": true, "contentHash": "1234abcd"}}]);
        let plan: JsonValue =
            serde_json::from_str(&plan_rag_automatic_recovery_batch_json(&legacy.to_string()))
                .unwrap_or_default();
        assert_eq!(plan.get("eligibleIndices"), Some(&json!([0])));
        let vector_partial = json!({"mtime": 1, "size": 10, "contentHash": "1234abcd", "sourceMetadataHash": "abcd1234", "partial": true, "hasCompleteMetadata": true});
        let files = json!([
            {"path": "vector.pdf", "mtime": 1, "size": 10, "vectorRecord": vector_partial},
            {"path": "new-complete.pdf", "mtime": 1, "size": 10, "vectorRecord": vector_partial, "corpusRecord": {"mtime": 1, "size": 10, "contentHash": "1234abcd", "sourceMetadataHash": "abcd4321", "partial": false, "hasCompleteMetadata": true}}
        ]);
        let plan: JsonValue =
            serde_json::from_str(&plan_rag_automatic_recovery_batch_json(&files.to_string()))
                .unwrap_or_default();
        assert_eq!(plan.get("deferredIndices"), Some(&json!([0])));
        assert_eq!(plan.get("eligibleIndices"), Some(&json!([1])));
    }

    #[test]
    fn batch_wire_is_strict_and_ties_use_utf16_paths() {
        for input in [
            r"[null]",
            r"[{}]",
            r#"[{"path":"a","mtime":1,"size":1.5}]"#,
            r#"[{"path":"a","mtime":1,"size":9007199254740992}]"#,
            r#"[{"path":"a","mtime":1,"size":1,"unknown":true}]"#,
            r#"[{"path":"a","mtime":1,"size":1,"corpusRecord":{"partial":"partial","hasCompleteMetadata":true}}]"#,
            r#"[{"path":"a","mtime":1,"size":1},{"path":"a","mtime":2,"size":2}]"#,
        ] {
            assert!(
                plan_rag_automatic_recovery_batch_json(input).is_empty(),
                "{input}"
            );
        }
        let files = json!([{"path": "\u{E000}.pdf", "mtime": 1, "size": 1}, {"path": "😀.pdf", "mtime": 1, "size": 1}]);
        let plan: JsonValue =
            serde_json::from_str(&plan_rag_automatic_recovery_batch_json(&files.to_string()))
                .unwrap_or_default();
        assert_eq!(plan.get("batchIndices"), Some(&json!([1, 0])));
    }

    #[test]
    fn automatic_batches_are_bounded_and_include_large_supported_sources() {
        let files = r#"[{"path":"large.md","mtime":1,"size":600000},{"path":"new.md","mtime":3,"size":100},{"path":"old.md","mtime":2,"size":200}]"#;
        let plan = plan_rag_automatic_recovery_batch_json(files);
        let plan: JsonValue = serde_json::from_str(&plan).unwrap_or_default();
        // 큰 문서도 대기열에 남겨 영구 미색인으로 끝나지 않게 한다.
        assert_eq!(plan.get("eligibleIndices"), Some(&json!([0, 1, 2])));
        assert_eq!(plan.get("batchIndices"), Some(&json!([1, 2, 0])));
        assert_eq!(plan.get("selectedSourceBytes"), Some(&json!(600_300)));
    }

    #[test]
    fn automatic_batches_drain_a_large_backlog_per_opportunity() {
        let mut records = Vec::new();
        for index in 0..600 {
            records.push(json!({
                "path": format!("notes/{index:04}.md"),
                "mtime": index,
                "size": 1_000,
            }));
        }
        let plan = plan_rag_automatic_recovery_batch_json(&JsonValue::Array(records).to_string());
        let plan: JsonValue = serde_json::from_str(&plan).unwrap_or_default();
        assert_eq!(
            plan.get("batchIndices")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(256),
            "한 기회에 처리하는 파일 수를 넉넉히 늘린다"
        );
        assert_eq!(
            plan.get("selectedSourceBytes").and_then(JsonValue::as_u64),
            Some(256_000)
        );
    }
}
