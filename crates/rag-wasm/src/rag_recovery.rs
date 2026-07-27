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
const MAX_AUTOMATIC_BATCH_FILES: usize = 32;
/// Automatic recovery keeps each opportunity small enough to remain background work.
const MAX_AUTOMATIC_BATCH_SOURCE_BYTES: u64 = 512 * 1024;
/// Larger sources remain available to explicit indexing but never monopolize quiet recovery.
const MAX_AUTOMATIC_FILE_BYTES: u64 = 512 * 1024;

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
    let mut eligible = Vec::<(usize, String, u64, u64)>::new();
    for (index, record) in records.iter().enumerate() {
        let Some(object) = record.as_object() else {
            return String::new();
        };
        let Some(path) = object.get("path").and_then(JsonValue::as_str) else {
            return String::new();
        };
        let Some(mtime) = object.get("mtime").and_then(JsonValue::as_u64) else {
            return String::new();
        };
        let Some(size) = object.get("size").and_then(JsonValue::as_u64) else {
            return String::new();
        };
        if path.trim().is_empty() {
            return String::new();
        }
        if size <= MAX_AUTOMATIC_FILE_BYTES {
            eligible.push((index, path.to_owned(), mtime, size));
        }
    }
    let eligible_indices = eligible.iter().map(|record| record.0).collect::<Vec<_>>();
    eligible.sort_by(|left, right| {
        left.3
            .cmp(&right.3)
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.1.cmp(&right.1))
    });
    let mut selected_source_bytes = 0_u64;
    let mut batch_indices = Vec::new();
    for (index, _path, _mtime, size) in eligible {
        if batch_indices.len() >= MAX_AUTOMATIC_BATCH_FILES {
            break;
        }
        if !batch_indices.is_empty()
            && selected_source_bytes.saturating_add(size) > MAX_AUTOMATIC_BATCH_SOURCE_BYTES
        {
            continue;
        }
        selected_source_bytes = selected_source_bytes.saturating_add(size);
        batch_indices.push(index);
    }

    json!({
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
fn parse_file_snapshot(payload: &str) -> Option<BTreeMap<String, (u64, u64)>> {
    let values = serde_json::from_str::<JsonValue>(payload).ok()?;
    let records = values.as_array()?;
    let mut files = BTreeMap::new();
    for record in records {
        let object = record.as_object()?;
        let path = object.get("path")?.as_str()?.trim();
        let mtime = object.get("mtime")?.as_u64()?;
        let size = object.get("size")?.as_u64()?;
        if path.is_empty() || files.insert(path.to_owned(), (mtime, size)).is_some() {
            return None;
        }
    }
    Some(files)
}

/// Hashes canonical file metadata without reading note content.
fn snapshot_fingerprint(files: &BTreeMap<String, (u64, u64)>) -> String {
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
    fn automatic_batches_are_bounded_and_leave_large_sources_for_explicit_indexing() {
        let files = r#"[{"path":"large.md","mtime":1,"size":600000},{"path":"new.md","mtime":3,"size":100},{"path":"old.md","mtime":2,"size":200}]"#;
        let plan = plan_rag_automatic_recovery_batch_json(files);
        let plan: JsonValue = serde_json::from_str(&plan).unwrap_or_default();
        assert_eq!(plan.get("eligibleIndices"), Some(&json!([1, 2])));
        assert_eq!(plan.get("batchIndices"), Some(&json!([1, 2])));
        assert_eq!(plan.get("selectedSourceBytes"), Some(&json!(300)));
    }
}
