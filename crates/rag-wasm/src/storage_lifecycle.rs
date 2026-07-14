//! Deterministic IndexedDB storage lifecycle policy.
//!
//! Host code supplies vault identity and database snapshots. This module decides names and
//! deletions without opening IndexedDB or depending on Obsidian APIs.

use std::collections::BTreeSet;

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Current `IndexedDB` storage contract. A version change starts a fresh database generation.
// Contract v3 was shipped briefly in 1.5.2, but it hid otherwise valid v2 indexes and forced
// users to rebuild them. Version 1.5.3 deliberately resumes the stable v2 generation. A v3
// database is never opened as active data and is deleted only after v2 coverage and health pass.
const STORAGE_CONTRACT_VERSION: u32 = 2;
/// Legacy global embedding cache database created before per-vault generations.
const LEGACY_EMBEDDING_CACHE_NAME: &str = "SuperpowerInsideEmbeddingCache";
/// First stable 64-bit FNV-1a offset used for storage identities.
const STORAGE_HASH_LEFT_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
/// Independent second offset used to widen storage identities to 128 bits.
const STORAGE_HASH_RIGHT_OFFSET: u64 = 0x8422_2325_cbf2_9ce4;
/// Stable 64-bit FNV-1a prime.
const STORAGE_HASH_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Builds database names isolated by vault, storage contract, and embedding generation.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_db_storage_layout_json(
    plugin_id: &str,
    vault_identity: &str,
    legacy_vault_name: &str,
    embedding_namespace: &str,
) -> String {
    let plugin = sanitize_database_component(plugin_id);
    let legacy_vault = sanitize_database_component(legacy_vault_name);
    if plugin.is_empty()
        || vault_identity.trim().is_empty()
        || legacy_vault.is_empty()
        || embedding_namespace.trim().is_empty()
    {
        return String::new();
    }

    let vault_hash = storage_key(&["vault", vault_identity.trim()]);
    let embedding_hash = storage_key(&["embedding", embedding_namespace.trim()]);
    let current_vault_prefix = format!("{plugin}:rag-v{STORAGE_CONTRACT_VERSION}:{vault_hash}:");
    let owned_vault_prefixes = [
        current_vault_prefix.clone(),
        format!("{plugin}:rag-v3:{vault_hash}:"),
    ];
    let active = json!({
        "vector": format!("{current_vault_prefix}{embedding_hash}:vectors"),
        "embeddingCache": format!("{current_vault_prefix}{embedding_hash}:embedding-cache"),
        "bm25": format!("{current_vault_prefix}bm25"),
        "graph": format!("{current_vault_prefix}graph"),
    });
    let legacy_names = [
        format!("{plugin}:{legacy_vault}:VectorStore"),
        format!("{plugin}:{legacy_vault}:KnowledgeGraph"),
        format!("{plugin}:{legacy_vault}:BM25Index"),
        LEGACY_EMBEDDING_CACHE_NAME.to_owned(),
    ];
    let cleanup_legacy_names = legacy_names.iter().take(3).cloned().collect::<Vec<_>>();

    json!({
        "contractVersion": STORAGE_CONTRACT_VERSION,
        "currentVaultPrefix": current_vault_prefix,
        "ownedVaultPrefixes": owned_vault_prefixes,
        "active": active,
        "cleanupLegacyNames": cleanup_legacy_names,
        "legacyNames": legacy_names,
    })
    .to_string()
}

/// Selects a bounded page of inactive databases owned by the current vault.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_db_bounded_cleanup_json(
    database_names_json: &str,
    active_names_json: &str,
    owned_vault_prefixes_json: &str,
    legacy_names_json: &str,
    max_deletions: usize,
) -> String {
    let Some(database_names) = parse_string_array(database_names_json) else {
        return String::new();
    };
    let Some(active_names) = parse_string_array(active_names_json) else {
        return String::new();
    };
    let Some(owned_vault_prefixes) = parse_string_array(owned_vault_prefixes_json) else {
        return String::new();
    };
    let Some(legacy_names) = parse_string_array(legacy_names_json) else {
        return String::new();
    };
    if owned_vault_prefixes.is_empty() {
        return String::new();
    }

    let active = active_names.into_iter().collect::<BTreeSet<_>>();
    let legacy = legacy_names.into_iter().collect::<BTreeSet<_>>();
    let stale = database_names
        .into_iter()
        .filter(|name| {
            !active.contains(name)
                && (owned_vault_prefixes
                    .iter()
                    .any(|prefix| name.starts_with(prefix))
                    || legacy.contains(name))
        })
        .collect::<BTreeSet<_>>();
    let delete_names = stale
        .iter()
        .take(max_deletions)
        .cloned()
        .collect::<Vec<_>>();

    json!({
        "deleteNames": delete_names,
        "remainingDeleteCount": stale.len().saturating_sub(delete_names.len()),
    })
    .to_string()
}

/// Plans one oldest-first bounded cache retention batch from a paged access snapshot.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_db_bounded_retention_json(
    oldest_records_json: &str,
    total_record_count: usize,
    max_records: usize,
    now: f64,
    max_age_ms: f64,
    max_deletions: usize,
) -> String {
    let Some(mut records) = parse_retention_records(oldest_records_json) else {
        return String::new();
    };
    if !now.is_finite() || !max_age_ms.is_finite() || max_age_ms < 0.0 {
        return String::new();
    }
    records.sort_by(|left, right| {
        left.updated
            .total_cmp(&right.updated)
            .then_with(|| left.id.cmp(&right.id))
    });
    let expiration_cutoff = now - max_age_ms;
    let expired_count = records
        .iter()
        .take_while(|record| max_age_ms > 0.0 && record.updated < expiration_cutoff)
        .count();
    let overflow_count = total_record_count.saturating_sub(max_records);
    let requested_count = expired_count.max(overflow_count).min(max_deletions);
    let delete_ids = records
        .iter()
        .take(requested_count)
        .map(|record| record.id.clone())
        .collect::<Vec<_>>();
    let remaining_record_count = total_record_count.saturating_sub(delete_ids.len());
    let oldest_remaining_is_expired = records
        .get(delete_ids.len())
        .is_some_and(|record| max_age_ms > 0.0 && record.updated < expiration_cutoff);

    let page_was_fully_deleted = !delete_ids.is_empty() && delete_ids.len() == records.len();
    json!({
        "deleteIds": delete_ids,
        "remainingWork": remaining_record_count > max_records
            || oldest_remaining_is_expired
            || (max_age_ms > 0.0 && page_was_fully_deleted && remaining_record_count > 0),
        "remainingRecordCount": remaining_record_count,
    })
    .to_string()
}

/// Plans stale file-index paths from a bounded host page.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_file_index_batch_json(
    records_json: &str,
    embedding_provider: &str,
    embedding_model: &str,
    max_deletions: usize,
) -> String {
    let Ok(values) = serde_json::from_str::<JsonValue>(records_json) else {
        return String::new();
    };
    let Some(records) = values.as_array() else {
        return String::new();
    };
    if embedding_provider.is_empty() || embedding_model.is_empty() {
        return String::new();
    }
    let mut stale_paths = BTreeSet::new();
    for value in records {
        let Some(record) = value.as_object() else {
            return String::new();
        };
        let Some(file_path) = record.get("filePath").and_then(JsonValue::as_str) else {
            return String::new();
        };
        let is_eligible = record
            .get("isEligible")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let is_complete = record
            .get("hasCompleteMetadata")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let provider_matches =
            record.get("embeddingProvider").and_then(JsonValue::as_str) == Some(embedding_provider);
        let model_matches =
            record.get("embeddingModel").and_then(JsonValue::as_str) == Some(embedding_model);
        if !is_eligible || !is_complete || !provider_matches || !model_matches {
            stale_paths.insert(file_path.to_owned());
        }
    }
    let delete_file_paths = stale_paths
        .into_iter()
        .take(max_deletions)
        .collect::<Vec<_>>();
    json!({ "deleteFilePaths": delete_file_paths }).to_string()
}

/// Plans stale vector ids from a bounded metadata-only host page.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_record_batch_json(
    records_json: &str,
    embedding_provider: &str,
    embedding_model: &str,
    expected_dimension: usize,
    max_deletions: usize,
) -> String {
    let Ok(values) = serde_json::from_str::<JsonValue>(records_json) else {
        return String::new();
    };
    let Some(records) = values.as_array() else {
        return String::new();
    };
    if embedding_provider.is_empty() || embedding_model.is_empty() || expected_dimension == 0 {
        return String::new();
    }
    let mut delete_ids = BTreeSet::new();
    for value in records {
        let Some(record) = value.as_object() else {
            return String::new();
        };
        let Some(id) = record.get("id").and_then(JsonValue::as_str) else {
            return String::new();
        };
        let provider_matches =
            record.get("embeddingProvider").and_then(JsonValue::as_str) == Some(embedding_provider);
        let model_matches =
            record.get("embeddingModel").and_then(JsonValue::as_str) == Some(embedding_model);
        let dimension_matches = record
            .get("dimension")
            .and_then(JsonValue::as_u64)
            .and_then(|dimension| usize::try_from(dimension).ok())
            == Some(expected_dimension);
        let linked = record
            .get("fileIndexExists")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let metadata_complete = record
            .get("metadataComplete")
            .and_then(JsonValue::as_bool)
            .unwrap_or(false);
        let generation_matches = record.get("contentHash") == record.get("fileContentHash")
            && record.get("updated") == record.get("fileUpdated");
        if !provider_matches
            || !model_matches
            || !dimension_matches
            || !linked
            || !metadata_complete
            || !generation_matches
        {
            delete_ids.insert(id.to_owned());
        }
    }
    let delete_ids = delete_ids
        .into_iter()
        .take(max_deletions)
        .collect::<Vec<_>>();
    json!({ "deleteIds": delete_ids }).to_string()
}

/// Creates a collision-resistant deterministic key for one namespaced `IndexedDB` record.
#[must_use]
#[wasm_bindgen]
pub fn create_indexed_db_record_key(namespace: &str, value: &str) -> String {
    let namespace = namespace.trim();
    if namespace.is_empty() {
        return String::new();
    }
    storage_key(&["record", namespace, value])
}

/// Minimal record metadata used by generic retention policy.
struct RetentionRecord {
    /// Stable `IndexedDB` primary key.
    id: String,
    /// Last-use or last-write timestamp in milliseconds.
    updated: f64,
}

/// Parses a JSON array of strings without accepting mixed or empty entries.
fn parse_string_array(payload: &str) -> Option<Vec<String>> {
    let values = serde_json::from_str::<JsonValue>(payload).ok()?;
    let array = values.as_array()?;
    let mut parsed = Vec::with_capacity(array.len());
    for value in array {
        let item = value.as_str()?.trim();
        if item.is_empty() {
            return None;
        }
        parsed.push(item.to_owned());
    }
    Some(parsed)
}

/// Parses generic cache retention records and rejects invalid timestamps.
fn parse_retention_records(payload: &str) -> Option<Vec<RetentionRecord>> {
    let values = serde_json::from_str::<JsonValue>(payload).ok()?;
    let array = values.as_array()?;
    let mut parsed = Vec::with_capacity(array.len());
    for value in array {
        let object = value.as_object()?;
        let id = object.get("id")?.as_str()?.trim();
        let updated = object.get("updated")?.as_f64()?;
        if id.is_empty() || !updated.is_finite() {
            return None;
        }
        parsed.push(RetentionRecord {
            id: id.to_owned(),
            updated,
        });
    }
    Some(parsed)
}

/// Replaces characters unsupported by the existing database-name contract.
fn sanitize_database_component(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, ':' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

/// Hashes length-delimited UTF-8 parts into two independent 64-bit lanes.
pub fn storage_key(parts: &[&str]) -> String {
    let mut left = STORAGE_HASH_LEFT_OFFSET;
    let mut right = STORAGE_HASH_RIGHT_OFFSET;
    for part in parts {
        let part_length = u64::try_from(part.len()).unwrap_or(u64::MAX);
        for byte in part_length.to_le_bytes().iter().chain(part.as_bytes()) {
            left ^= u64::from(*byte);
            left = left.wrapping_mul(STORAGE_HASH_PRIME);
            right ^= u64::from(*byte);
            right = right.wrapping_mul(STORAGE_HASH_PRIME).rotate_left(7);
        }
    }
    format!("{left:016x}{right:016x}")
}

#[cfg(test)]
mod tests {
    use super::{
        plan_indexed_db_bounded_cleanup_json, plan_indexed_db_bounded_retention_json,
        plan_vector_file_index_batch_json, plan_vector_record_batch_json,
    };
    use serde_json::Value as JsonValue;

    #[test]
    fn bounded_cleanup_deletes_v3_and_foreign_model_only_for_current_vault() {
        let databases = r#"["plugin:rag-v2:vault:active:vectors","plugin:rag-v2:vault:old:vectors","plugin:rag-v3:vault:old:vectors","plugin:rag-v3:other:old:vectors","unrelated"]"#;
        let active = r#"["plugin:rag-v2:vault:active:vectors"]"#;
        let prefixes = r#"["plugin:rag-v2:vault:","plugin:rag-v3:vault:"]"#;
        let plan_text = plan_indexed_db_bounded_cleanup_json(databases, active, prefixes, "[]", 1);
        assert!(!plan_text.contains("other"));
        assert!(!plan_text.contains("unrelated"));
        let plan: JsonValue = serde_json::from_str(&plan_text).unwrap_or_default();
        assert_eq!(
            plan.get("deleteNames")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            plan.get("remainingDeleteCount").and_then(JsonValue::as_u64),
            Some(1)
        );
    }

    #[test]
    fn bounded_retention_uses_only_the_supplied_oldest_page() {
        let records = r#"[{"id":"old","updated":1},{"id":"middle","updated":2}]"#;
        let plan = plan_indexed_db_bounded_retention_json(records, 5, 3, 10.0, 0.0, 2);
        let plan: JsonValue = serde_json::from_str(&plan).unwrap_or_default();
        assert_eq!(
            plan.get("deleteIds")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(2)
        );
        assert_eq!(
            plan.get("remainingWork").and_then(JsonValue::as_bool),
            Some(false)
        );
    }

    #[test]
    fn vector_batches_reject_ineligible_or_mismatched_generations() {
        let file_records = r#"[{"filePath":"notes/a.md","isEligible":true,"hasCompleteMetadata":true,"embeddingProvider":"current","embeddingModel":"model"},{"filePath":"notes/b.md","isEligible":false,"hasCompleteMetadata":true,"embeddingProvider":"current","embeddingModel":"model"}]"#;
        let file_plan = plan_vector_file_index_batch_json(file_records, "current", "model", 8);
        assert!(file_plan.contains("notes/b.md"));
        assert!(!file_plan.contains("notes/a.md"));

        let vectors = r#"[{"id":"keep","embeddingProvider":"current","embeddingModel":"model","dimension":2,"fileIndexExists":true,"metadataComplete":true,"contentHash":"generation","fileContentHash":"generation","updated":5,"fileUpdated":5},{"id":"orphan","embeddingProvider":"current","embeddingModel":"model","dimension":2,"fileIndexExists":false,"metadataComplete":true,"contentHash":"generation","fileContentHash":"generation","updated":5,"fileUpdated":5}]"#;
        let vector_plan = plan_vector_record_batch_json(vectors, "current", "model", 2, 8);
        assert!(vector_plan.contains("orphan"));
        assert!(!vector_plan.contains("keep"));
    }
}
