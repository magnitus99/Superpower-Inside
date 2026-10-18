//! 제외 경로 항목 하나의 팝오버 메타데이터를 결정적으로 계산하는 정책.

use serde_json::{Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{is_vault_path_excluded, normalize_exclude_path};

/// 폴더 아래 규칙 일치 파일 집계 입력 하나의 통계.
struct ExcludePathFileInput {
    /// 볼트 기준 상대 파일 경로.
    path: String,
    /// 파일 크기(바이트).
    size_bytes: f64,
    /// 최종 수정 시각(ms).
    mtime_ms: f64,
}

/// 제외 경로 메타데이터 계산 입력 전체.
struct ExcludePathMetadataInput {
    /// 저장된 원본 값.
    entry: String,
    /// 볼트 폴더 경로 목록.
    folders: Vec<String>,
    /// 볼트 파일 통계 목록.
    files: Vec<ExcludePathFileInput>,
}

/// 폴더 하나 아래 규칙 일치 파일 집계 결과.
struct ExcludePathMatchStats {
    /// 규칙과 일치하는 파일 수.
    file_count: usize,
    /// 일치 파일 크기 합(바이트).
    size_bytes: f64,
    /// 일치 파일 중 최신 수정 시각(ms).
    latest_mtime_ms: Option<f64>,
}

/// 설정의 제외 경로 항목 하나에 대한 팝오버 메타데이터를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_exclude_path_metadata_json(input_json: &str) -> String {
    let Some(input) = parse_input_json(input_json) else {
        return String::new();
    };
    plan_metadata(&input).to_string()
}

/// 입력 `JSON` object를 파싱한다. 유한하지 않은 수는 계산에서 제외한다.
fn parse_input_json(payload: &str) -> Option<ExcludePathMetadataInput> {
    let value = serde_json::from_str::<JsonValue>(payload).ok()?;
    let object = value.as_object()?;
    let entry = object.get("entry")?.as_str()?.to_owned();
    let folders = object
        .get("folders")?
        .as_array()?
        .iter()
        .map(|folder| folder.as_str().map(ToOwned::to_owned))
        .collect::<Option<Vec<String>>>()?;
    let files = object
        .get("files")?
        .as_array()?
        .iter()
        .map(parse_file_input)
        .collect::<Option<Vec<ExcludePathFileInput>>>()?;

    Some(ExcludePathMetadataInput {
        entry,
        folders,
        files,
    })
}

/// 파일 통계 입력 하나를 파싱한다.
fn parse_file_input(value: &JsonValue) -> Option<ExcludePathFileInput> {
    let object = value.as_object()?;
    let size_bytes = object.get("sizeBytes")?.as_f64()?;
    let mtime_ms = object.get("mtimeMs")?.as_f64()?;
    if !size_bytes.is_finite() || !mtime_ms.is_finite() {
        return None;
    }

    Some(ExcludePathFileInput {
        path: object.get("path")?.as_str()?.to_owned(),
        size_bytes,
        mtime_ms,
    })
}

/// 표시용 정규화 경로를 기준으로 항목 하나의 메타데이터를 계산한다.
fn plan_metadata(input: &ExcludePathMetadataInput) -> JsonValue {
    let display_path = normalize_display_path(&input.entry);
    let is_pattern = display_path.contains(['*', '?']);
    let matched_folders = if is_pattern {
        matching_pattern_folders(&display_path, &input.folders)
    } else {
        lookup_folder(&display_path, &input.folders)
            .into_iter()
            .collect::<Vec<String>>()
    };

    let mut matches = Vec::with_capacity(matched_folders.len());
    let mut total_file_count = 0_usize;
    let mut total_size_bytes = 0.0_f64;
    let mut latest_mtime_ms = None::<f64>;
    for folder_path in matched_folders {
        let stats = collect_match_stats(&folder_path, &display_path, &input.files);
        total_file_count = total_file_count.saturating_add(stats.file_count);
        total_size_bytes += stats.size_bytes;
        latest_mtime_ms = latest_of(latest_mtime_ms, stats.latest_mtime_ms);
        matches.push(json!({
            "path": folder_path,
            "fileCount": stats.file_count,
            "sizeBytes": stats.size_bytes,
            "latestMtimeMs": stats.latest_mtime_ms,
        }));
    }

    let match_count = matches.len();
    json!({
        "entry": input.entry,
        "kind": if is_pattern { "pattern" } else { "folder" },
        "displayPath": display_path,
        "exists": match_count > 0,
        "matches": matches,
        "matchCount": match_count,
        "totalFileCount": total_file_count,
        "totalSizeBytes": total_size_bytes,
        "latestMtimeMs": latest_mtime_ms,
    })
}

/// 표시용 경로를 정규화한다. 와일드카드 문자는 그대로 보존한다.
fn normalize_display_path(value: &str) -> String {
    value
        .trim()
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/")
}

/// folder 항목에 해당하는 실제 폴더 경로를 정확 일치 우선으로 찾는다.
fn lookup_folder(display_path: &str, folders: &[String]) -> Option<String> {
    if display_path.is_empty() {
        return None;
    }
    if let Some(exact) = folders
        .iter()
        .find(|folder| folder.as_str() == display_path)
    {
        return Some(exact.clone());
    }

    let normalized_target = normalize_exclude_path(display_path);
    if normalized_target.is_empty() {
        return None;
    }

    folders
        .iter()
        .filter(|folder| normalize_exclude_path(folder) == normalized_target)
        .min()
        .cloned()
}

/// pattern 항목과 일치하는 폴더를 부모 기준으로 고른 뒤 경로 오름차순으로 정렬한다.
fn matching_pattern_folders(pattern: &str, folders: &[String]) -> Vec<String> {
    let matching = folders
        .iter()
        .filter(|folder| is_vault_path_excluded(folder.as_str(), [pattern]))
        .map(|folder| (normalize_exclude_path(folder), folder.clone()))
        .filter(|(normalized, _)| !normalized.is_empty())
        .collect::<Vec<(String, String)>>();
    // 부모 폴더가 이미 일치하면 하위 폴더는 중복 집계를 막기 위해 제외한다.
    let mut selected = matching
        .iter()
        .filter(|(normalized, _)| {
            !matching.iter().any(|(ancestor, _)| {
                normalized
                    .strip_prefix(ancestor.as_str())
                    .is_some_and(|suffix| suffix.starts_with('/'))
            })
        })
        .map(|(_, path)| path.clone())
        .collect::<Vec<String>>();
    selected.sort();

    selected
}

/// 폴더 하나 아래에서 규칙과 일치하는 파일만 집계한다.
fn collect_match_stats(
    folder_path: &str,
    rule: &str,
    files: &[ExcludePathFileInput],
) -> ExcludePathMatchStats {
    let mut stats = ExcludePathMatchStats {
        file_count: 0,
        size_bytes: 0.0,
        latest_mtime_ms: None,
    };
    let normalized_folder = normalize_exclude_path(folder_path);
    for file in files {
        if !is_under_folder(&file.path, &normalized_folder) {
            continue;
        }
        if !is_vault_path_excluded(&file.path, [rule]) {
            continue;
        }
        stats.file_count = stats.file_count.saturating_add(1);
        stats.size_bytes += file.size_bytes;
        stats.latest_mtime_ms = Some(
            stats
                .latest_mtime_ms
                .map_or(file.mtime_ms, |current| current.max(file.mtime_ms)),
        );
    }

    stats
}

/// 파일 경로가 정규화된 폴더 경로 아래에 있는지 확인한다.
fn is_under_folder(file_path: &str, normalized_folder: &str) -> bool {
    if normalized_folder.is_empty() {
        return false;
    }

    normalize_exclude_path(file_path)
        .strip_prefix(normalized_folder)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

/// 두 최신 mtime 후보 중 더 큰 값을 고른다.
const fn latest_of(current: Option<f64>, candidate: Option<f64>) -> Option<f64> {
    match (current, candidate) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value as JsonValue;

    use super::plan_exclude_path_metadata_json;

    /// 잘못된 JSON을 panic 뒤에 숨기지 않고 테스트 결과를 파싱한다.
    fn parse_json(raw: &str) -> JsonValue {
        serde_json::from_str::<JsonValue>(raw)
            .unwrap_or_else(|error| JsonValue::String(format!("invalid JSON: {error}")))
    }

    /// folder 항목은 실제 폴더 표기와 그 아래 일치 파일 집계를 돌려준다.
    #[test]
    fn folder_entry_aggregates_matching_files() {
        let raw = plan_exclude_path_metadata_json(
            r#"{"entry":" ./Archive/ ","folders":["Archive","Notes"],"files":[{"path":"Archive/a.md","sizeBytes":10,"mtimeMs":100},{"path":"Archive/Sub/b.md","sizeBytes":20,"mtimeMs":200},{"path":"Archive.md","sizeBytes":30,"mtimeMs":300},{"path":"Notes/c.md","sizeBytes":40,"mtimeMs":400}]}"#,
        );

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": " ./Archive/ ",
                "kind": "folder",
                "displayPath": "Archive",
                "exists": true,
                "matches": [
                    {"path":"Archive","fileCount":2,"sizeBytes":30.0,"latestMtimeMs":200.0}
                ],
                "matchCount": 1,
                "totalFileCount": 2,
                "totalSizeBytes": 30.0,
                "latestMtimeMs": 200.0
            })
        );
    }

    /// folder 항목은 대소문자가 다르면 실제 표기 폴더 경로로 폴백한다.
    #[test]
    fn folder_entry_falls_back_to_actual_case() {
        let raw = plan_exclude_path_metadata_json(
            r#"{"entry":"archive","folders":["Archive"],"files":[{"path":"Archive/a.md","sizeBytes":10,"mtimeMs":100}]}"#,
        );

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": "archive",
                "kind": "folder",
                "displayPath": "archive",
                "exists": true,
                "matches": [
                    {"path":"Archive","fileCount":1,"sizeBytes":10.0,"latestMtimeMs":100.0}
                ],
                "matchCount": 1,
                "totalFileCount": 1,
                "totalSizeBytes": 10.0,
                "latestMtimeMs": 100.0
            })
        );
    }

    /// pattern 항목은 부모 폴더만 고르고 경로 오름차순으로 정렬한다.
    #[test]
    fn pattern_entry_selects_sorted_parent_folders() {
        let raw = plan_exclude_path_metadata_json(
            r#"{"entry":"**/drafts/**","folders":["Projects/Zeta/drafts","Projects/Atlas/drafts/nested","Projects/Atlas/notes","Projects/Atlas/drafts","Projects/Zeta/drafts/2024"],"files":[{"path":"Projects/Zeta/drafts/z.md","sizeBytes":10,"mtimeMs":100},{"path":"Projects/Atlas/drafts/a.md","sizeBytes":20,"mtimeMs":200},{"path":"Projects/Atlas/drafts/nested/b.md","sizeBytes":30,"mtimeMs":300},{"path":"Projects/Atlas/notes/c.md","sizeBytes":40,"mtimeMs":400}]}"#,
        );

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": "**/drafts/**",
                "kind": "pattern",
                "displayPath": "**/drafts/**",
                "exists": true,
                "matches": [
                    {"path":"Projects/Atlas/drafts","fileCount":2,"sizeBytes":50.0,"latestMtimeMs":300.0},
                    {"path":"Projects/Zeta/drafts","fileCount":1,"sizeBytes":10.0,"latestMtimeMs":100.0}
                ],
                "matchCount": 2,
                "totalFileCount": 3,
                "totalSizeBytes": 60.0,
                "latestMtimeMs": 300.0
            })
        );
    }

    /// 일치가 없으면 예외 없이 빈 메타데이터를 돌려준다.
    #[test]
    fn missing_entry_returns_empty_metadata() {
        let raw = plan_exclude_path_metadata_json(
            r#"{"entry":"Missing","folders":["Notes"],"files":[{"path":"Notes/a.md","sizeBytes":10,"mtimeMs":100}]}"#,
        );

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": "Missing",
                "kind": "folder",
                "displayPath": "Missing",
                "exists": false,
                "matches": [],
                "matchCount": 0,
                "totalFileCount": 0,
                "totalSizeBytes": 0.0,
                "latestMtimeMs": null
            })
        );
    }

    /// 볼트 루트("")는 상대 폴더 경로가 아니므로 일치 대상에서 제외한다.
    #[test]
    fn root_folder_path_is_ignored() {
        let raw = plan_exclude_path_metadata_json(
            r#"{"entry":"*","folders":["","Notes"],"files":[{"path":"Notes/a.md","sizeBytes":10,"mtimeMs":100}]}"#,
        );

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": "*",
                "kind": "pattern",
                "displayPath": "*",
                "exists": true,
                "matches": [
                    {"path":"Notes","fileCount":1,"sizeBytes":10.0,"latestMtimeMs":100.0}
                ],
                "matchCount": 1,
                "totalFileCount": 1,
                "totalSizeBytes": 10.0,
                "latestMtimeMs": 100.0
            })
        );
    }

    /// 일치 폴더에 파일이 없어도 존재로 보고 0 집계를 돌려준다.
    #[test]
    fn empty_matching_folder_is_reported_as_existing() {
        let raw = plan_exclude_path_metadata_json(
            r#"{"entry":"**/drafts/**","folders":["Projects/Atlas/drafts"],"files":[]}"#,
        );

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": "**/drafts/**",
                "kind": "pattern",
                "displayPath": "**/drafts/**",
                "exists": true,
                "matches": [
                    {"path":"Projects/Atlas/drafts","fileCount":0,"sizeBytes":0.0,"latestMtimeMs":null}
                ],
                "matchCount": 1,
                "totalFileCount": 0,
                "totalSizeBytes": 0.0,
                "latestMtimeMs": null
            })
        );
    }

    /// 볼트가 비어 있으면 빈 메타데이터를 돌려준다.
    #[test]
    fn empty_vault_returns_empty_metadata() {
        let raw =
            plan_exclude_path_metadata_json(r#"{"entry":"**/drafts/**","folders":[],"files":[]}"#);

        assert_eq!(
            parse_json(&raw),
            serde_json::json!({
                "entry": "**/drafts/**",
                "kind": "pattern",
                "displayPath": "**/drafts/**",
                "exists": false,
                "matches": [],
                "matchCount": 0,
                "totalFileCount": 0,
                "totalSizeBytes": 0.0,
                "latestMtimeMs": null
            })
        );
    }

    /// 계약을 어긴 입력은 계산 없이 빈 문자열로 돌려준다.
    #[test]
    fn invalid_input_returns_empty_string() {
        assert_eq!(plan_exclude_path_metadata_json("not-json"), "");
        assert_eq!(
            plan_exclude_path_metadata_json(r#"{"entry":"Archive","folders":[]}"#),
            ""
        );
        assert_eq!(
            plan_exclude_path_metadata_json(
                r#"{"entry":"Archive","folders":[],"files":[{"path":"a.md","sizeBytes":1,"mtimeMs":null}]}"#
            ),
            ""
        );
    }
}
