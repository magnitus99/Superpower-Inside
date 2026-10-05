//! Deterministic IndexedDB storage lifecycle policy.
//!
//! Host code supplies vault identity and database snapshots. This module decides names and
//! deletions without opening IndexedDB or depending on Obsidian APIs.

use std::collections::{BTreeMap, BTreeSet};

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
///
/// `index_namespace`가 비어 있으면 기존 세대를 유지한다. 값이 있으면 청킹 계약이 바뀐 것이므로
/// 공통 원문·vector·BM25를 새 세대로 옮기고 임베딩 캐시는 재사용합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_db_storage_layout_json(
    plugin_id: &str,
    vault_identity: &str,
    legacy_vault_name: &str,
    embedding_namespace: &str,
    index_namespace: &str,
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
    let index_generation = index_namespace.trim();
    let (vector_hash, bm25_name) = if index_generation.is_empty() {
        (
            embedding_hash.clone(),
            format!("{current_vault_prefix}bm25"),
        )
    } else {
        let index_hash = storage_key(&["index", index_generation]);
        (
            index_hash.clone(),
            format!("{current_vault_prefix}{index_hash}:bm25"),
        )
    };
    let active = json!({
        "vector": format!("{current_vault_prefix}{vector_hash}:vectors"),
        "embeddingCache": format!("{current_vault_prefix}{embedding_hash}:embedding-cache"),
        "bm25": bm25_name,
        "corpus": format!("{current_vault_prefix}{}:corpus", storage_key(&["corpus", index_generation])),
    });
    let legacy_names = [
        format!("{plugin}:{legacy_vault}:VectorStore"),
        format!("{plugin}:{legacy_vault}:BM25Index"),
        LEGACY_EMBEDDING_CACHE_NAME.to_owned(),
    ];
    let cleanup_legacy_names = legacy_names.iter().take(2).cloned().collect::<Vec<_>>();

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

/// Plans a bounded set difference between persisted source paths and current vault paths.
#[must_use]
#[wasm_bindgen]
pub fn plan_stale_index_source_paths_json(
    indexed_paths_json: &str,
    valid_paths_json: &str,
    max_deletions: usize,
) -> String {
    let Some(indexed_paths) = parse_string_array(indexed_paths_json) else {
        return String::new();
    };
    let Some(valid_paths) = parse_string_array(valid_paths_json) else {
        return String::new();
    };
    let valid = valid_paths.into_iter().collect::<BTreeSet<_>>();
    let stale = indexed_paths
        .into_iter()
        .filter(|path| !valid.contains(path))
        .collect::<BTreeSet<_>>();
    let delete_paths = stale
        .iter()
        .take(max_deletions)
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "deletePaths": delete_paths,
        "remainingDeleteCount": stale.len().saturating_sub(delete_paths.len()),
    })
    .to_string()
}

/// Tracks plugin-owned databases across vaults and retires generations unseen past a grace age.
#[must_use]
#[wasm_bindgen]
pub fn plan_inactive_indexed_db_cleanup_json(input_json: &str) -> String {
    let Some(input) = parse_inactive_database_input(input_json) else {
        return String::new();
    };
    build_inactive_database_plan(input)
}

/// Builds the cross-vault database observation and deletion plan.
fn build_inactive_database_plan(mut input: InactiveDatabaseInput) -> String {
    let mut database_groups = BTreeMap::<String, Vec<String>>::new();
    for name in input.database_names {
        if input.active_names.contains(&name)
            || input.current_legacy_names.contains(&name)
            || input
                .current_prefixes
                .iter()
                .any(|prefix| name.starts_with(prefix))
        {
            continue;
        }
        if let Some(group) = inactive_database_group(&name, &input.plugin_id) {
            database_groups.entry(group).or_default().push(name);
        }
    }
    input
        .records
        .retain(|key, _| database_groups.contains_key(key) || input.current_prefixes.contains(key));
    for key in database_groups.keys() {
        input
            .records
            .entry(key.clone())
            .or_insert((input.now, None));
    }
    for prefix in &input.current_prefixes {
        let record = input
            .records
            .entry(prefix.clone())
            .or_insert((input.now, Some(input.now)));
        record.1 = Some(input.now);
    }
    let expired_groups = input
        .records
        .iter()
        .filter(|(_, (first_seen, last_seen))| {
            input.now - last_seen.unwrap_or(*first_seen) >= input.max_inactive_age_ms
        })
        .map(|(key, _)| key.clone())
        .collect::<BTreeSet<_>>();
    let stale_names = database_groups
        .iter()
        .filter(|(group, _)| expired_groups.contains(*group))
        .flat_map(|(_, names)| names.iter().cloned())
        .collect::<BTreeSet<_>>();
    let delete_names = stale_names
        .iter()
        .take(input.max_deletions)
        .cloned()
        .collect::<Vec<_>>();
    let record_values = input
        .records
        .into_iter()
        .map(|(key, (first_seen, last_seen))| {
            json!({"key": key, "firstSeen": first_seen, "lastSeen": last_seen})
        })
        .collect::<Vec<_>>();
    json!({
        "records": record_values,
        "deleteNames": delete_names,
        "remainingDeleteCount": stale_names.len().saturating_sub(delete_names.len()),
    })
    .to_string()
}

/// Plans bounded cleanup for files whose names prove that this plugin owns them.
#[must_use]
#[wasm_bindgen]
pub fn plan_plugin_owned_file_maintenance_json(input_json: &str) -> String {
    let Ok(input) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(input) = input.as_object() else {
        return String::new();
    };
    let Some(input) = parse_plugin_file_maintenance_input(input) else {
        return String::new();
    };
    build_plugin_file_maintenance_plan(&input)
}

/// Validated borrowed input for one plugin-file maintenance planning pass.
struct PluginFileMaintenanceInput<'a> {
    /// Host file snapshots from plugin-owned directories.
    records: &'a [JsonValue],
    /// Current plugin installation directory.
    plugin_directory: String,
    /// Legacy derived-data directory in the vault.
    legacy_data_directory: String,
    /// Current detailed diagnostics event log path.
    event_log_path: &'a str,
    /// Current host timestamp in milliseconds.
    now: f64,
    /// Minimum age before an interrupted temp file is stale.
    stale_temp_age_ms: f64,
    /// Maximum retained detailed diagnostics log size.
    max_event_log_bytes: u64,
    /// Whether health-gated legacy derived files may be retired.
    allow_legacy_cleanup: bool,
    /// Maximum number of files selected in one pass.
    max_deletions: usize,
}

/// Parses and validates the maintenance policy envelope.
fn parse_plugin_file_maintenance_input(
    input: &serde_json::Map<String, JsonValue>,
) -> Option<PluginFileMaintenanceInput<'_>> {
    let records = input.get("records").and_then(JsonValue::as_array)?;
    let plugin_directory = input
        .get("pluginDirectory")
        .and_then(JsonValue::as_str)
        .and_then(normalize_directory)?;
    let legacy_data_directory = input
        .get("legacyDataDirectory")
        .and_then(JsonValue::as_str)
        .and_then(normalize_directory)?;
    let event_log_path = input.get("eventLogPath").and_then(JsonValue::as_str)?;
    let now = input.get("now").and_then(JsonValue::as_f64)?;
    let stale_temp_age_ms = input.get("staleTempAgeMs").and_then(JsonValue::as_f64)?;
    let max_event_log_bytes = input.get("maxEventLogBytes").and_then(JsonValue::as_u64)?;
    let allow_legacy_cleanup = input
        .get("allowLegacyCleanup")
        .and_then(JsonValue::as_bool)?;
    let max_deletions = input
        .get("maxDeletions")
        .and_then(JsonValue::as_u64)
        .and_then(|value| usize::try_from(value).ok())?;
    if !now.is_finite()
        || !stale_temp_age_ms.is_finite()
        || now < 0.0
        || stale_temp_age_ms < 0.0
        || event_log_path.trim().is_empty()
    {
        return None;
    }
    Some(PluginFileMaintenanceInput {
        records,
        plugin_directory,
        legacy_data_directory,
        event_log_path,
        now,
        stale_temp_age_ms,
        max_event_log_bytes,
        allow_legacy_cleanup,
        max_deletions,
    })
}

/// Builds a deterministic bounded deletion and log-rotation plan.
fn build_plugin_file_maintenance_plan(input: &PluginFileMaintenanceInput<'_>) -> String {
    let mut stale_paths = BTreeSet::new();
    let mut rotate_event_log_path = None;
    for record in input.records {
        let Some(record) = record.as_object() else {
            return String::new();
        };
        let Some(path) = record.get("path").and_then(JsonValue::as_str) else {
            return String::new();
        };
        let Some(mtime) = record.get("mtime").and_then(JsonValue::as_f64) else {
            return String::new();
        };
        let Some(size) = record.get("size").and_then(JsonValue::as_u64) else {
            return String::new();
        };
        if path.trim().is_empty() || !mtime.is_finite() || mtime < 0.0 {
            return String::new();
        }
        if path == input.event_log_path && size > input.max_event_log_bytes {
            rotate_event_log_path = Some(path.to_owned());
        }
        let stale = input.now - mtime >= input.stale_temp_age_ms;
        if let Some(file_name) = direct_child_name(path, &input.plugin_directory) {
            if stale && is_owned_plugin_temporary_file(file_name) {
                stale_paths.insert(path.to_owned());
            }
            continue;
        }
        if let Some(file_name) = direct_child_name(path, &input.legacy_data_directory)
            && ((stale && is_owned_legacy_temporary_file(file_name))
                || (input.allow_legacy_cleanup && is_owned_legacy_derived_file(file_name)))
        {
            stale_paths.insert(path.to_owned());
        }
    }

    let delete_paths = stale_paths
        .iter()
        .take(input.max_deletions)
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "deletePaths": delete_paths,
        "remainingDeleteCount": stale_paths.len().saturating_sub(delete_paths.len()),
        "rotateEventLogPath": rotate_event_log_path,
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

/// Validated host snapshot for cross-vault database retention.
struct InactiveDatabaseInput {
    /// Browser-visible database names.
    database_names: Vec<String>,
    /// Exact database names used by the current runtime.
    active_names: BTreeSet<String>,
    /// Prefixes owned by the current vault.
    current_prefixes: BTreeSet<String>,
    /// Pre-contract names owned by the current vault.
    current_legacy_names: BTreeSet<String>,
    /// Sanitized plugin identifier used to prove ownership.
    plugin_id: String,
    /// Prior first-seen and optional last-seen observations.
    records: BTreeMap<String, (f64, Option<f64>)>,
    /// Current host timestamp in milliseconds.
    now: f64,
    /// Grace age before an unobserved generation becomes stale.
    max_inactive_age_ms: f64,
    /// Maximum databases selected in one batch.
    max_deletions: usize,
}

/// Parses and validates the cross-vault database lifecycle envelope.
fn parse_inactive_database_input(payload: &str) -> Option<InactiveDatabaseInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let input = value.as_object()?;
    let plugin_id = sanitize_database_component(input.get("pluginId")?.as_str()?);
    let now = input.get("now")?.as_f64()?;
    let max_inactive_age_ms = input.get("maxInactiveAgeMs")?.as_f64()?;
    if plugin_id.is_empty()
        || !now.is_finite()
        || !max_inactive_age_ms.is_finite()
        || max_inactive_age_ms < 0.0
    {
        return None;
    }
    Some(InactiveDatabaseInput {
        database_names: parse_string_field(input, "databaseNames")?,
        active_names: parse_string_field(input, "activeNames")?
            .into_iter()
            .collect(),
        current_prefixes: parse_string_field(input, "currentVaultPrefixes")?
            .into_iter()
            .collect(),
        current_legacy_names: parse_string_field(input, "currentLegacyNames")?
            .into_iter()
            .collect(),
        plugin_id,
        records: parse_inactive_database_records(input.get("records"))?,
        now,
        max_inactive_age_ms,
        max_deletions: parse_limit(input, "maxDeletions")?,
    })
}

/// Parses a non-negative integer limit.
fn parse_limit(input: &serde_json::Map<String, JsonValue>, field: &str) -> Option<usize> {
    input
        .get(field)?
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
}

/// Parses persisted inactive-database observations keyed by owned prefix or legacy name.
fn parse_inactive_database_records(
    value: Option<&JsonValue>,
) -> Option<BTreeMap<String, (f64, Option<f64>)>> {
    let values = value?.as_array()?;
    let mut records = BTreeMap::new();
    for value in values {
        let object = value.as_object()?;
        let key = object.get("key")?.as_str()?.trim();
        let first_seen = object.get("firstSeen")?.as_f64()?;
        let last_seen = match object.get("lastSeen") {
            None | Some(JsonValue::Null) => None,
            Some(value) => Some(value.as_f64()?),
        };
        if key.is_empty()
            || !first_seen.is_finite()
            || last_seen.is_some_and(|value| !value.is_finite())
        {
            return None;
        }
        records.insert(key.to_owned(), (first_seen, last_seen));
    }
    Some(records)
}

/// Identifies a plugin-owned database group without claiming unrelated `IndexedDB` names.
fn inactive_database_group(name: &str, plugin_id: &str) -> Option<String> {
    if name == LEGACY_EMBEDDING_CACHE_NAME {
        return Some(format!("legacy:{name}"));
    }
    let prefix = format!("{plugin_id}:");
    let suffix = name.strip_prefix(&prefix)?;
    for contract in ["rag-v2:", "rag-v3:"] {
        if let Some(remainder) = suffix.strip_prefix(contract) {
            let (vault_hash, _) = remainder.split_once(':')?;
            if vault_hash.len() == 32
                && vault_hash
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
            {
                return Some(format!("{prefix}{contract}{vault_hash}:"));
            }
            return None;
        }
    }
    [":VectorStore", ":BM25Index"]
        .iter()
        .any(|ending| suffix.ends_with(ending))
        .then(|| format!("legacy:{name}"))
}

/// Parses a JSON value array containing only non-empty strings.
fn parse_string_values(values: &[JsonValue]) -> Option<Vec<String>> {
    let mut parsed = Vec::with_capacity(values.len());
    for value in values {
        let value = value.as_str()?.trim();
        if value.is_empty() {
            return None;
        }
        parsed.push(value.to_owned());
    }
    Some(parsed)
}

/// Parses a named array containing only non-empty strings.
fn parse_string_field(
    input: &serde_json::Map<String, JsonValue>,
    field: &str,
) -> Option<Vec<String>> {
    input
        .get(field)
        .and_then(JsonValue::as_array)
        .and_then(|values| parse_string_values(values))
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

/// Normalizes a non-empty directory without accepting a root-like empty value.
fn normalize_directory(path: &str) -> Option<String> {
    let normalized = path.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return None;
    }
    Some(normalized.to_owned())
}

/// Returns a direct child name while rejecting nested or unrelated paths.
fn direct_child_name<'a>(path: &'a str, directory: &str) -> Option<&'a str> {
    let file_name = path.strip_prefix(directory)?.strip_prefix('/')?;
    if file_name.is_empty() || file_name.contains('/') {
        return None;
    }
    Some(file_name)
}

/// Recognizes interrupted writes owned by the current plugin installation.
fn is_owned_plugin_temporary_file(file_name: &str) -> bool {
    is_atomic_json_temporary_file(file_name, "agent-diagnostics.json")
        || is_atomic_json_temporary_file(file_name, "agent-diagnostics-safe-mode.json")
        || (file_name.starts_with("tern_engine_bg.wasm.download-")
            && file_name
                .rsplit_once('.')
                .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("tmp")))
}

/// Recognizes interrupted atomic writes in the legacy derived-data directory.
fn is_owned_legacy_temporary_file(file_name: &str) -> bool {
    is_atomic_json_temporary_file(file_name, "vectors.json")
        || is_atomic_json_temporary_file(file_name, "bm25-index.json")
}

/// Recognizes the temp suffixes used by current and earlier atomic JSON writers.
fn is_atomic_json_temporary_file(file_name: &str, base_name: &str) -> bool {
    file_name
        .strip_prefix(base_name)
        .is_some_and(|suffix| suffix.starts_with(".tmp.") || suffix.starts_with(".tmp-"))
}

/// Recognizes rebuildable legacy index files after the active-store health gate.
fn is_owned_legacy_derived_file(file_name: &str) -> bool {
    matches!(file_name, "vectors.json" | "bm25-index.json")
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
    use super::*;
    use serde_json::Value as JsonValue;

    /// 청킹 계약이 바뀌면 vector와 BM25만 새 세대로 옮기고 임베딩 캐시는 재사용해야 한다.
    #[test]
    fn generation_scoped_layout_isolates_chunking_contract() {
        let legacy_layout = plan_indexed_db_storage_layout_json(
            "plugin",
            "vault",
            "Vault",
            "profile:local::embedding-v2",
            "",
        );
        let generation_layout = plan_indexed_db_storage_layout_json(
            "plugin",
            "vault",
            "Vault",
            "profile:local::embedding-v2",
            "idx-v1:500:100",
        );
        assert_ne!(
            &legacy_layout, &generation_layout,
            "청킹 계약이 다르면 저장 레이아웃도 달라야 합니다"
        );
        let legacy_document = serde_json::from_str::<JsonValue>(&legacy_layout).unwrap_or_default();
        let generation_document =
            serde_json::from_str::<JsonValue>(&generation_layout).unwrap_or_default();
        let legacy_active = legacy_document.get("active").cloned().unwrap_or_default();
        let generation_active = generation_document
            .get("active")
            .cloned()
            .unwrap_or_default();
        assert_ne!(
            legacy_active.get("vector"),
            generation_active.get("vector"),
            "청킹 계약이 바뀌면 vector 저장소는 새 세대여야 합니다: {generation_layout}"
        );
        assert_ne!(
            legacy_active.get("bm25"),
            generation_active.get("bm25"),
            "청킹 계약이 바뀌면 BM25 posting도 새 세대여야 합니다: {generation_layout}"
        );
        assert_eq!(
            legacy_active.get("embeddingCache"),
            generation_active.get("embeddingCache"),
            "임베딩 캐시는 청킹 계약과 무관하게 재사용해야 합니다: {generation_layout}"
        );
    }

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
    fn stale_index_paths_are_sorted_bounded_and_deduplicated() {
        let plan = plan_stale_index_source_paths_json(
            r#"["z.md","keep.md","a.md","a.md"]"#,
            r#"["keep.md"]"#,
            1,
        );
        let plan: JsonValue = serde_json::from_str(&plan).unwrap_or_default();
        assert_eq!(plan.get("deletePaths"), Some(&serde_json::json!(["a.md"])));
        assert_eq!(
            plan.get("remainingDeleteCount").and_then(JsonValue::as_u64),
            Some(1)
        );
    }

    #[test]
    fn inactive_database_cleanup_observes_before_deleting_and_heartbeats_current_vault() {
        let first = r#"{
          "databaseNames":[
            "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:vectors",
            "plugin:rag-v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:vectors",
            "SuperpowerInsideEmbeddingCache",
            "unrelated"
          ],
          "activeNames":["plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:vectors"],
          "currentVaultPrefixes":["plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:"],
          "currentLegacyNames":[],
          "pluginId":"plugin",
          "records":[],
          "now":100,
          "maxInactiveAgeMs":50,
          "maxDeletions":4
        }"#;
        let first: JsonValue =
            serde_json::from_str(&plan_inactive_indexed_db_cleanup_json(first)).unwrap_or_default();
        assert_eq!(first.get("deleteNames"), Some(&serde_json::json!([])));
        let records = first.get("records").cloned().unwrap_or_default();
        assert!(records.to_string().contains("bbbbbbbb"));
        assert!(records.to_string().contains("lastSeen\":100"));

        let second = serde_json::json!({
          "databaseNames":[
            "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:vectors",
            "plugin:rag-v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:vectors",
            "SuperpowerInsideEmbeddingCache"
          ],
          "activeNames":["plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:vectors"],
          "currentVaultPrefixes":["plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:"],
          "currentLegacyNames":[],
          "pluginId":"plugin",
          "records": records,
          "now":151,
          "maxInactiveAgeMs":50,
          "maxDeletions":4
        });
        let second: JsonValue =
            serde_json::from_str(&plan_inactive_indexed_db_cleanup_json(&second.to_string()))
                .unwrap_or_default();
        let delete_names = second.get("deleteNames").cloned().unwrap_or_default();
        assert!(delete_names.to_string().contains("bbbbbbbb"));
        assert!(
            delete_names
                .to_string()
                .contains("SuperpowerInsideEmbeddingCache")
        );
        assert!(!delete_names.to_string().contains("aaaaaaaa"));
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

    #[test]
    fn plugin_file_maintenance_deletes_only_owned_stale_artifacts() {
        let input = r#"{
          "records": [
            {"path":".obsidian/plugins/superpower-inside/agent-diagnostics.json.tmp-1","mtime":1,"size":10},
            {"path":".obsidian/plugins/superpower-inside/tern_engine_bg.wasm.download-1.tmp","mtime":1,"size":10},
            {"path":".obsidian/plugins/superpower-inside/data.json.tmp-user","mtime":1,"size":10},
            {"path":".superpower-inside/vectors.json.tmp-1","mtime":1,"size":10},
            {"path":".superpower-inside/vectors.json","mtime":1,"size":10},
            {"path":"notes/user.md","mtime":1,"size":10}
          ],
          "pluginDirectory":".obsidian/plugins/superpower-inside",
          "legacyDataDirectory":".superpower-inside",
          "eventLogPath":".obsidian/plugins/superpower-inside/agent-diagnostics.ndjson",
          "now":10000,
          "staleTempAgeMs":1000,
          "maxEventLogBytes":1024,
          "allowLegacyCleanup":true,
          "maxDeletions":16
        }"#;

        let plan = plan_plugin_owned_file_maintenance_json(input);

        assert!(plan.contains("agent-diagnostics.json.tmp-1"));
        assert!(plan.contains("tern_engine_bg.wasm.download-1.tmp"));
        assert!(plan.contains("vectors.json.tmp-1"));
        assert!(plan.contains("vectors.json"));
        assert!(!plan.contains("data.json.tmp-user"));
        assert!(!plan.contains("notes/user.md"));
    }

    #[test]
    fn plugin_file_maintenance_preserves_recent_temps_and_bounds_diagnostics_log() {
        let input = r#"{
          "records": [
            {"path":".obsidian/plugins/superpower-inside/agent-diagnostics.json.tmp-recent","mtime":9500,"size":10},
            {"path":".obsidian/plugins/superpower-inside/agent-diagnostics.ndjson","mtime":9500,"size":2048},
            {"path":".superpower-inside/bm25-index.json","mtime":1,"size":10}
          ],
          "pluginDirectory":".obsidian/plugins/superpower-inside",
          "legacyDataDirectory":".superpower-inside",
          "eventLogPath":".obsidian/plugins/superpower-inside/agent-diagnostics.ndjson",
          "now":10000,
          "staleTempAgeMs":1000,
          "maxEventLogBytes":1024,
          "allowLegacyCleanup":false,
          "maxDeletions":16
        }"#;

        let plan: JsonValue = serde_json::from_str(&plan_plugin_owned_file_maintenance_json(input))
            .unwrap_or_default();

        assert_eq!(
            plan.get("deletePaths")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(0)
        );
        assert_eq!(
            plan.get("rotateEventLogPath").and_then(JsonValue::as_str),
            Some(".obsidian/plugins/superpower-inside/agent-diagnostics.ndjson")
        );
    }
}
