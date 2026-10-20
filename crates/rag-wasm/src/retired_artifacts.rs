use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 현행 저장소와 폐기 범위를 구분하는 호스트 스냅샷입니다.
struct Context {
    /// 전역 생성물을 소유한 플러그인 식별자입니다.
    plugin_id: String,
    /// 현재 볼트의 구형 저장소 이름입니다.
    legacy_names: Vec<String>,
    /// 현재 볼트가 소유한 세대별 접두사입니다.
    vault_prefixes: Vec<String>,
    /// 폐기 규칙보다 우선하여 보호할 사용 중인 저장소입니다.
    active_names: Vec<String>,
    /// 현행 인덱스의 정상 복구·마이그레이션이 확인되었는지 나타냅니다.
    legacy_files_safe: bool,
    /// 조회 이후 재초기화를 감지할 런타임 세대입니다.
    revision: u64,
    /// 전체 제품에서 선언한 기능의 지원 상태입니다. 비활성화 설정과 구분합니다.
    features: BTreeMap<String, FeaturePolicy>,
    /// 공통 저장 계층이 생성 시 기록한 소유권입니다.
    tracked: Vec<TrackedArtifact>,
    /// 현재 열려 있거나 쓰는 생성물입니다.
    active_artifacts: Vec<(String, String)>,
}

/// 생성물의 내용을 포함하지 않는 측정 메타데이터입니다.
#[derive(Clone)]
struct Record {
    /// 파일 또는 데이터베이스 구분입니다.
    kind: String,
    /// 파일 경로 또는 데이터베이스 이름입니다.
    id: String,
    /// 호스트가 측정한 데이터 크기입니다.
    bytes: u64,
    /// 파일 변경을 감지할 수정 시각입니다.
    modified: f64,
    /// 같은 크기로 다시 생성된 데이터도 구별하는 소유권 기록 세대입니다.
    stamp: String,
}

/// 파일명 규칙과 독립된 생성물 소유권 기록입니다.
#[derive(Clone)]
struct TrackedArtifact {
    /// 저장 매체 종류입니다.
    kind: String,
    /// 실제 저장 위치입니다.
    id: String,
    /// 기능 구현이 제거된 뒤에도 유지하는 안정적인 소유 기능 식별자입니다.
    feature_id: String,
    /// 생성·재개방 시 호스트가 갱신하는 기록 세대입니다.
    stamp: String,
    /// 저장 매체가 선언한 형식 버전입니다.
    format_version: f64,
}

/// 기능 전체와 특정 저장 형식의 지원 종료를 구분합니다.
struct FeaturePolicy {
    /// 기능 전체의 지원 종료 여부입니다.
    retired: bool,
    /// 지원 종료가 확인된 형식 버전입니다. 알려지지 않은 버전은 보존합니다.
    retired_versions: Vec<f64>,
}

/// 한 번의 폐기 정책 평가 입력입니다.
struct Input {
    /// 현재 저장소 보호 조건입니다.
    context: Context,
    /// 호스트가 발견한 생성물의 메타데이터입니다.
    records: Vec<Record>,
    /// 사용자가 이미 본 대상과 당시 런타임 세대입니다.
    approval: Option<Approval>,
}

/// 삭제 동의가 적용되는 스냅샷입니다.
struct Approval {
    /// 동의 이후 새로 생긴 생성물을 제외하기 위한 원래 대상입니다.
    records: Vec<Record>,
    /// 동의 이후 재초기화를 감지하는 세대입니다.
    revision: u64,
}

/// 소유권과 보호 조건을 통과한 삭제 후보입니다.
struct Plan {
    /// 삭제 가능한 생성물입니다.
    records: Vec<Record>,
    /// 중복을 제거한 총용량입니다.
    bytes: u64,
    /// 사용자에게 표시할 소수 둘째 자리까지의 MB 용량입니다.
    capacity: String,
    /// 동의 당시의 대상 또는 보호 조건이 바뀌었는지 나타냅니다.
    changed: bool,
}

/// 폐기 정책을 한곳에 등록합니다. 기능 코드와 정리 화면은 개별 정책을 알 필요가 없습니다.
/// 근거: 1.0.0 전역 인덱스, ca1c07c 볼트별 세대, 1bbfbfa 그래프 검색 제거.
const RETIRED_GLOBAL_DATABASES: &[&str] = &[
    "SuperObsidianVectorStore",
    "SuperpowerInsideVectorStore",
    "SuperpowerInsideBM25Index",
    "SuperpowerInsideEmbeddingCache",
    "SuperpowerInsideKnowledgeGraphStore",
];
/// 마이그레이션 확인 후 폐기할 파일과 그 원자적 쓰기 임시 파일의 기본 경로입니다.
const RETIRED_FILES: &[&str] = &[
    ".superpower-inside/vectors.json",
    ".superpower-inside/bm25-index.json",
];

/// 생성물 소유권을 검증하고 저장·이동·삭제 기록을 갱신합니다.
#[must_use]
#[wasm_bindgen]
pub fn update_generated_artifact_registry_json(
    raw: &str,
    change_raw: &str,
    roots_raw: &str,
    remove: bool,
) -> String {
    let Some(records) = update_registry(raw, change_raw, roots_raw, remove) else {
        return String::new();
    };
    json!(records.iter().map(|record| json!({"kind": record.kind, "id": record.id, "featureId": record.feature_id, "stamp": record.stamp, "formatVersion": record.format_version})).collect::<Vec<_>>()).to_string()
}

/// 저장된 추적 정보가 손상되었으면 덮어쓰기를 거부합니다.
fn update_registry(
    raw: &str,
    change_raw: &str,
    roots_raw: &str,
    remove: bool,
) -> Option<Vec<TrackedArtifact>> {
    let roots = strings(&serde_json::from_str::<Value>(roots_raw).ok()?)?;
    let mut records = parse_tracked(&serde_json::from_str::<Value>(raw).ok()?, &roots)?;
    if !change_raw.is_empty() {
        let change = parse_tracked(
            &json!([serde_json::from_str::<Value>(change_raw).ok()?]),
            &roots,
        )?
        .into_iter()
        .next()?;
        records.retain(|record| {
            record.kind != change.kind
                || record.id != change.id
                || (remove && record.feature_id != change.feature_id)
        });
        if !remove {
            records.push(change);
        }
    }
    Some(records)
}

/// 생성물 기록의 종류·소유자·전용 저장 경로를 확인합니다.
fn parse_tracked(value: &Value, roots: &[String]) -> Option<Vec<TrackedArtifact>> {
    let mut seen = BTreeSet::new();
    value
        .as_array()?
        .iter()
        .map(|value| {
            let record = TrackedArtifact {
                kind: value.get("kind")?.as_str()?.to_owned(),
                id: value.get("id")?.as_str()?.to_owned(),
                feature_id: value.get("featureId")?.as_str()?.to_owned(),
                stamp: value.get("stamp")?.as_str()?.to_owned(),
                format_version: value
                    .get("formatVersion")
                    .map_or(Some(1.0), Value::as_f64)?,
            };
            let valid_location = match record.kind.as_str() {
                "database" => !record.id.is_empty(),
                "file" => {
                    valid_relative_path(&record.id)
                        && roots.iter().any(|root| {
                            valid_relative_path(root) && record.id.starts_with(&format!("{root}/"))
                        })
                }
                _ => false,
            };
            if !valid_location
                || record.feature_id.is_empty()
                || record.stamp.is_empty()
                || !record.format_version.is_finite()
                || record.format_version <= 0.0
                || !seen.insert((record.kind.clone(), record.id.clone()))
            {
                return None;
            }
            Some(record)
        })
        .collect()
}

/// 볼트 외부 이동과 모호한 상대 경로를 거부합니다.
fn valid_relative_path(path: &str) -> bool {
    !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// 호스트가 제공한 메타데이터만으로 소유권·현행 데이터 보호·용량을 판정합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_retired_artifacts_json(raw: &str) -> String {
    let Some(input) = parse_input(raw) else {
        return String::new();
    };
    let result = plan(&input);
    json!({
        "records": result.records.iter().map(|record| json!({
            "kind": record.kind, "id": record.id, "bytes": record.bytes,
            "modified": record.modified,
            "stamp": record.stamp,
        })).collect::<Vec<_>>(),
        "bytes": result.bytes,
        "capacity": result.capacity,
        "revision": input.context.revision,
        "changed": result.changed,
    })
    .to_string()
}

/// 불완전하거나 타입이 잘못된 스냅샷을 거부합니다.
fn parse_input(raw: &str) -> Option<Input> {
    let input: Value = serde_json::from_str(raw).ok()?;
    let context = input.get("context")?;
    let roots = context
        .get("artifactFileRoots")
        .map_or_else(|| Some(Vec::new()), strings)?;
    let tracked = context
        .get("tracked")
        .map_or_else(|| Some(Vec::new()), |value| parse_tracked(value, &roots))?;
    let mut features = BTreeMap::new();
    if let Some(values) = context.get("features") {
        for feature in values.as_array()? {
            let id = feature.get("id")?.as_str()?;
            let retired = match feature.get("state")?.as_str()? {
                "supported" => false,
                "retired" => true,
                _ => return None,
            };
            let retired_versions = feature.get("retiredVersions").map_or_else(
                || Some(Vec::new()),
                |value| {
                    value
                        .as_array()?
                        .iter()
                        .map(Value::as_f64)
                        .collect::<Option<Vec<_>>>()
                },
            )?;
            if retired_versions
                .iter()
                .any(|version| !version.is_finite() || *version <= 0.0)
            {
                return None;
            }
            if id.is_empty()
                || features
                    .insert(
                        id.to_owned(),
                        FeaturePolicy {
                            retired,
                            retired_versions,
                        },
                    )
                    .is_some()
            {
                return None;
            }
        }
    }
    let active_artifacts = context.get("activeArtifacts").map_or_else(
        || Some(Vec::new()),
        |value| {
            value
                .as_array()?
                .iter()
                .map(|record| {
                    Some((
                        record.get("kind")?.as_str()?.to_owned(),
                        record.get("id")?.as_str()?.to_owned(),
                    ))
                })
                .collect::<Option<Vec<_>>>()
        },
    )?;
    let context = Context {
        plugin_id: context.get("pluginId")?.as_str()?.to_owned(),
        legacy_names: strings(context.get("legacyNames")?)?,
        vault_prefixes: strings(context.get("vaultPrefixes")?)?,
        active_names: strings(context.get("activeNames")?)?,
        legacy_files_safe: context.get("legacyFilesSafe")?.as_bool()?,
        revision: context.get("revision")?.as_u64()?,
        features,
        tracked,
        active_artifacts,
    };
    if context.plugin_id.is_empty() || context.vault_prefixes.is_empty() {
        return None;
    }
    let records = parse_records(input.get("records")?)?;
    let approval = if let Some(approval) = input.get("approval") {
        Some(Approval {
            records: parse_records(approval.get("records")?)?,
            revision: approval.get("revision")?.as_u64()?,
        })
    } else {
        None
    };
    Some(Input {
        context,
        records,
        approval,
    })
}

/// 파일의 소수 밀리초 시각을 보존하고 유효하지 않은 측정값을 거부합니다.
fn parse_records(value: &Value) -> Option<Vec<Record>> {
    let records = value
        .as_array()?
        .iter()
        .map(|record| {
            Some(Record {
                kind: record.get("kind")?.as_str()?.to_owned(),
                id: record.get("id")?.as_str()?.to_owned(),
                bytes: record.get("bytes")?.as_u64()?,
                modified: record.get("modified")?.as_f64()?,
                stamp: record.get("stamp").map_or_else(
                    || Some(String::new()),
                    |value| value.as_str().map(str::to_owned),
                )?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    if records
        .iter()
        .any(|record| !record.modified.is_finite() || record.modified < 0.0)
    {
        return None;
    }
    Some(records)
}

/// 전부 문자열인 배열만 저장소 식별자로 받아들입니다.
fn strings(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_owned))
        .collect()
}

/// 폐기 후보를 중복 없이 선택하고 총용량을 계산합니다.
fn plan(input: &Input) -> Plan {
    let mut seen = BTreeSet::new();
    let mut records = input
        .records
        .iter()
        .filter(|record| {
            is_retired(record, &input.context) && seen.insert((&record.kind, &record.id))
        })
        .cloned()
        .collect::<Vec<_>>();
    for record in &mut records {
        if let Some(tracked) = input
            .context
            .tracked
            .iter()
            .find(|tracked| tracked.kind == record.kind && tracked.id == record.id)
        {
            record.stamp.clone_from(&tracked.stamp);
        }
    }
    let mut changed = false;
    if let Some(approval) = &input.approval {
        if approval.revision == input.context.revision {
            records.retain(|record| {
                approval.records.iter().any(|approved| {
                    record.kind == approved.kind
                        && record.id == approved.id
                        && record.bytes == approved.bytes
                        && record.modified.to_bits() == approved.modified.to_bits()
                        && record.stamp == approved.stamp
                })
            });
            changed = records.len() != approval.records.len();
        } else {
            records.clear();
            changed = true;
        }
    }
    let bytes = records
        .iter()
        .fold(0_u64, |sum, record| sum.saturating_add(record.bytes));
    let hundredths = bytes.saturating_mul(100).div_ceil(1_000_000);
    Plan {
        records,
        bytes,
        capacity: format!(
            "{}.{:02}",
            hundredths.checked_div(100).unwrap_or_default(),
            hundredths % 100
        ),
        changed,
    }
}

/// 소유권이 확인된 지원 종료 생성물만 선택하며 활성 저장소 보호를 우선합니다.
fn is_retired(record: &Record, context: &Context) -> bool {
    if context
        .active_artifacts
        .iter()
        .any(|(kind, id)| kind == &record.kind && id == &record.id)
        || (record.kind == "database" && context.active_names.contains(&record.id))
    {
        return false;
    }
    if let Some(tracked) = context
        .tracked
        .iter()
        .find(|tracked| tracked.kind == record.kind && tracked.id == record.id)
    {
        let explicitly_retired = context
            .features
            .get(&tracked.feature_id)
            .is_some_and(|policy| {
                policy.retired
                    || policy
                        .retired_versions
                        .iter()
                        .any(|version| version.to_bits() == tracked.format_version.to_bits())
            });
        if explicitly_retired {
            return true;
        }
        // 파일은 명시적으로 폐기된 경우에만 지웁니다. DB는 아래 generation 규칙까지
        // 확인해, registry가 지원 기능으로 기록한 과거 index generation도 정리합니다.
        if record.kind == "file" {
            return false;
        }
    }
    if record.kind == "file" {
        return (context.legacy_files_safe && RETIRED_FILES.contains(&record.id.as_str()))
            || RETIRED_FILES.iter().any(|base| {
                record.id.strip_prefix(base).is_some_and(|suffix| {
                    !suffix.contains('/')
                        && (suffix.starts_with(".tmp.") || suffix.starts_with(".tmp-"))
                })
            });
    }
    if record.kind != "database" || context.active_names.contains(&record.id) {
        return false;
    }
    if RETIRED_GLOBAL_DATABASES.contains(&record.id.as_str()) {
        return context.plugin_id == "superpower-inside";
    }
    if context.plugin_id == "superpower-inside"
        && record
            .id
            .strip_prefix("SuperpowerInsideEmbeddingCache-v2:")
            .is_some_and(is_storage_hash)
    {
        return true;
    }
    if context.legacy_names.contains(&record.id) {
        return true;
    }
    context.vault_prefixes.iter().any(|prefix| {
        let Some(suffix) = record.id.strip_prefix(prefix) else {
            return false;
        };
        // 현재 active 세대는 위 active_names에서 보호됩니다. 그 밖의 과거 index
        // generation은 현재 storage 계약 아래에서도 재사용할 수 없으므로 폐기합니다.
        // 모델별 embedding cache는 과거 index generation과 별개이므로 유지합니다.
        suffix == "graph"
            || is_obsolete_index_suffix(suffix)
            || (prefix.starts_with(&format!("{}:rag-v3:", context.plugin_id))
                && is_known_generation_suffix(suffix))
    })
}

/// 현재 storage 계약 아래에서 폐기할 과거 index generation suffix입니다.
fn is_obsolete_index_suffix(suffix: &str) -> bool {
    let Some((hash, kind)) = suffix.split_once(':') else {
        return false;
    };
    is_storage_hash(hash) && matches!(kind, "vectors" | "corpus" | "bm25")
}

/// 과거에 실제로 배포된 저장소 종류와 해시 형식만 인정합니다.
fn is_known_generation_suffix(suffix: &str) -> bool {
    if suffix == "bm25" {
        return true;
    }
    let Some((hash, kind)) = suffix.split_once(':') else {
        return false;
    };
    is_storage_hash(hash) && matches!(kind, "vectors" | "embedding-cache" | "bm25" | "corpus")
}

/// 저장소 식별자 계약인 128비트 16진수 해시를 확인합니다.
fn is_storage_hash(hash: &str) -> bool {
    hash.len() == 32 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> Context {
        Context {
            plugin_id: "plugin".into(),
            legacy_names: vec!["plugin:vault:KnowledgeGraph".into()],
            vault_prefixes: vec![
                "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:".into(),
                "plugin:rag-v3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:".into(),
            ],
            active_names: vec!["plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:graph".into()],
            legacy_files_safe: false,
            revision: 1,
            features: BTreeMap::new(),
            tracked: Vec::new(),
            active_artifacts: Vec::new(),
        }
    }

    #[test]
    fn ownership_and_active_data_take_precedence_over_retirement() {
        let input = Input {
            context: context(),
            approval: None,
            records: vec![
                record("database", "plugin:vault:KnowledgeGraph", 100),
                record(
                    "database",
                    "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:graph",
                    100,
                ),
                record(
                    "database",
                    "other:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:graph",
                    100,
                ),
                record(
                    "database",
                    "plugin:rag-v3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:unknown",
                    100,
                ),
                record("file", ".superpower-inside/vectors.json", 100),
                record("file", ".superpower-inside/user.json", 100),
                record("file", ".superpower-inside/../vectors.json", 100),
            ],
        };
        let plan = plan(&input);
        assert_eq!(plan.records.len(), 1);
        assert_eq!(plan.bytes, 100);
    }

    #[test]
    fn healthy_migration_retires_obsolete_index_generations_and_legacy_files() {
        let mut input = Input {
            context: context(),
            approval: None,
            records: vec![
                record("file", ".superpower-inside/bm25-index.json", 25),
                record("file", ".superpower-inside/vectors.json", 75),
                record("file", ".superpower-inside/vectors.json", 75),
                record(
                    "database",
                    "plugin:rag-v3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:vectors",
                    100,
                ),
                record(
                    "database",
                    "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:vectors",
                    100,
                ),
                record(
                    "database",
                    "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cccccccccccccccccccccccccccccccc:embedding-cache",
                    100,
                ),
            ],
        };
        input.context.legacy_files_safe = true;
        let plan = plan(&input);
        assert_eq!(plan.records.len(), 4);
        assert_eq!(plan.bytes, 300);
        assert_eq!(plan.capacity, "0.01");
    }

    #[test]
    fn tracked_supported_old_index_generation_is_still_retired() {
        let mut context = context();
        context.features.insert(
            "rag-vectors".into(),
            FeaturePolicy {
                retired: false,
                retired_versions: Vec::new(),
            },
        );
        context.tracked.push(TrackedArtifact {
            kind: "database".into(),
            id: "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:vectors"
                .into(),
            feature_id: "rag-vectors".into(),
            stamp: "tracked".into(),
            format_version: 1.0,
        });
        let old = record(
            "database",
            "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:vectors",
            100,
        );
        let current = record(
            "database",
            "plugin:rag-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:dddddddddddddddddddddddddddddddd:vectors",
            100,
        );
        context.active_names = vec![current.id.clone()];
        let input = Input {
            context,
            approval: None,
            records: vec![old, current],
        };
        let result = plan(&input);
        assert_eq!(result.records.len(), 1);
        assert!(
            result
                .records
                .first()
                .is_some_and(|record| record.id.contains("bbbbbbbbbbbbbbbb"))
        );
    }

    #[test]
    fn global_retirement_rejects_lookalikes_and_protects_active_cache() {
        let mut context = context();
        context.plugin_id = "superpower-inside".into();
        context.active_names = vec!["SuperpowerInsideEmbeddingCache".into()];
        let input = Input {
            context,
            approval: None,
            records: vec![
                record("database", "SuperObsidianVectorStore", 10),
                record("database", "SuperpowerInsideEmbeddingCache", 20),
                record(
                    "database",
                    "SuperpowerInsideEmbeddingCache-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    30,
                ),
                record("database", "SuperpowerInsideEmbeddingCache-v2:unknown", 40),
                record("database", "SuperpowerInsideVectorStore-user", 50),
                record("file", ".superpower-inside/vectors.json.tmp-1", 60),
                record("file", ".superpower-inside/vectors.json.tmp-1/user", 70),
            ],
        };
        let result = plan(&input);
        assert_eq!(result.records.len(), 3);
        assert_eq!(result.bytes, 100);
    }

    #[test]
    fn approval_excludes_changed_and_new_artifacts_and_reinitialized_storage() {
        let approved = record("database", "plugin:vault:KnowledgeGraph", 100);
        let mut input = Input {
            context: context(),
            records: vec![approved.clone()],
            approval: Some(Approval {
                records: vec![approved.clone()],
                revision: 1,
            }),
        };
        assert!(!plan(&input).changed);
        assert_eq!(plan(&input).records.len(), 1);
        input
            .records
            .push(record("file", ".superpower-inside/vectors.json.tmp-1", 60));
        assert_eq!(plan(&input).records.len(), 1);
        input.records = vec![Record {
            modified: 1.5,
            ..approved.clone()
        }];
        assert!(plan(&input).changed);
        assert!(plan(&input).records.is_empty());
        input.records = vec![approved];
        input.context.revision = 2;
        assert!(plan(&input).changed);
        assert!(plan(&input).records.is_empty());
    }

    #[test]
    fn malformed_wire_input_never_returns_a_deletion_plan() {
        assert!(plan_retired_artifacts_json("{}").is_empty());
        assert!(plan_retired_artifacts_json("not json").is_empty());
    }

    fn record(kind: &str, id: &str, bytes: u64) -> Record {
        Record {
            kind: kind.into(),
            id: id.into(),
            bytes,
            modified: 1.25,
            stamp: String::new(),
        }
    }
}
