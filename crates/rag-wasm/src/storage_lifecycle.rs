//! Deterministic IndexedDB storage lifecycle policy.
//!
//! Host code supplies vault identity and database snapshots. This module decides names and
//! deletions without opening IndexedDB or depending on Obsidian APIs.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Current `IndexedDB` storage contract. A version change starts a fresh database generation.
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

    json!({
        "contractVersion": STORAGE_CONTRACT_VERSION,
        "currentVaultPrefix": current_vault_prefix,
        "active": active,
        "legacyNames": legacy_names,
    })
    .to_string()
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

/// Selects stale current-vault generations and explicit legacy databases for deletion.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_db_cleanup_json(
    database_names_json: &str,
    active_names_json: &str,
    current_vault_prefix: &str,
    legacy_names_json: &str,
) -> String {
    let Some(database_names) = parse_string_array(database_names_json) else {
        return String::new();
    };
    let Some(active_names) = parse_string_array(active_names_json) else {
        return String::new();
    };
    let Some(legacy_names) = parse_string_array(legacy_names_json) else {
        return String::new();
    };
    if current_vault_prefix.is_empty() {
        return String::new();
    }

    let active = active_names.into_iter().collect::<BTreeSet<_>>();
    let legacy = legacy_names.into_iter().collect::<BTreeSet<_>>();
    let mut delete_names = BTreeSet::new();
    let mut kept_names = BTreeSet::new();
    for name in database_names {
        if active.contains(&name) {
            kept_names.insert(name);
        } else if name.starts_with(current_vault_prefix) || legacy.contains(&name) {
            delete_names.insert(name);
        }
    }

    json!({
        "deleteNames": delete_names,
        "keptNames": kept_names,
    })
    .to_string()
}

/// Selects expired records and oldest capacity overflow for bounded `IndexedDB` caches.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_db_record_retention_json(
    records_json: &str,
    max_records: usize,
    now: f64,
    max_age_ms: f64,
) -> String {
    let Some(records) = parse_retention_records(records_json) else {
        return String::new();
    };
    if !now.is_finite() || !max_age_ms.is_finite() || max_age_ms < 0.0 {
        return String::new();
    }

    let newest_by_id = records
        .into_iter()
        .fold(BTreeMap::new(), |mut records, record| {
            records
                .entry(record.id)
                .and_modify(|updated: &mut f64| *updated = updated.max(record.updated))
                .or_insert(record.updated);
            records
        });
    let expiration_cutoff = now - max_age_ms;
    let mut delete_ids = newest_by_id
        .iter()
        .filter(|(_, updated)| max_age_ms > 0.0 && **updated < expiration_cutoff)
        .map(|(id, _)| id.clone())
        .collect::<BTreeSet<_>>();
    let mut retained = newest_by_id
        .iter()
        .filter(|(id, _)| !delete_ids.contains(*id))
        .map(|(id, updated)| (id.clone(), *updated))
        .collect::<Vec<_>>();
    retained.sort_by(|left, right| {
        left.1
            .total_cmp(&right.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    let overflow = retained.len().saturating_sub(max_records);
    delete_ids.extend(retained.iter().take(overflow).map(|(id, _)| id.clone()));
    let retained_count = newest_by_id.len().saturating_sub(delete_ids.len());

    json!({
        "deleteIds": delete_ids,
        "retainedCount": retained_count,
    })
    .to_string()
}

/// Selects stale vector file records for a bounded reconciliation pass.
#[must_use]
#[wasm_bindgen]
pub fn plan_vector_store_reconciliation_json(
    records_json: &str,
    valid_file_paths_json: &str,
    embedding_provider: &str,
    embedding_model: &str,
    max_deletions: usize,
) -> String {
    let Some(records) = parse_vector_records(records_json) else {
        return String::new();
    };
    let Some(valid_file_paths) = parse_string_array(valid_file_paths_json) else {
        return String::new();
    };
    if embedding_provider.is_empty() || embedding_model.is_empty() {
        return String::new();
    }

    let valid_paths = valid_file_paths.into_iter().collect::<BTreeSet<_>>();
    let stale_paths = records
        .into_iter()
        .filter(|record| {
            !valid_paths.contains(&record.file_path)
                || record.embedding_provider.as_deref() != Some(embedding_provider)
                || record.embedding_model.as_deref() != Some(embedding_model)
        })
        .map(|record| record.file_path)
        .collect::<BTreeSet<_>>();
    let delete_file_paths = stale_paths
        .iter()
        .take(max_deletions)
        .cloned()
        .collect::<Vec<_>>();
    let remaining_stale_count = stale_paths.len().saturating_sub(delete_file_paths.len());

    json!({
        "deleteFilePaths": delete_file_paths,
        "remainingStaleCount": remaining_stale_count,
    })
    .to_string()
}

/// Minimal vector file-index metadata needed for reconciliation policy.
struct VectorRecord {
    /// Indexed vault-relative path.
    file_path: String,
    /// Embedding provider generation that created the vectors.
    embedding_provider: Option<String>,
    /// Embedding model generation that created the vectors.
    embedding_model: Option<String>,
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

/// Parses only the vector file-index fields used by reconciliation.
fn parse_vector_records(payload: &str) -> Option<Vec<VectorRecord>> {
    let values = serde_json::from_str::<JsonValue>(payload).ok()?;
    let array = values.as_array()?;
    let mut parsed = Vec::with_capacity(array.len());
    for value in array {
        let object = value.as_object()?;
        let file_path = object.get("filePath")?.as_str()?.trim();
        if file_path.is_empty() {
            return None;
        }
        parsed.push(VectorRecord {
            file_path: file_path.to_owned(),
            embedding_provider: optional_trimmed_string(object.get("embeddingProvider")),
            embedding_model: optional_trimmed_string(object.get("embeddingModel")),
        });
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

/// Reads an optional non-empty string field.
fn optional_trimmed_string(value: Option<&JsonValue>) -> Option<String> {
    value
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
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
fn storage_key(parts: &[&str]) -> String {
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
