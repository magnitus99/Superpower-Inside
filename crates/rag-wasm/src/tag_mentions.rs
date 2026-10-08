//! Obsidian 태그 지목의 정규화·자동완성·하위 태그 범위 선택.

use serde_json::json;
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

/// 공백·문장 구분자는 태그에 포함하지 않으며 숫자만 있는 태그는 거부한다.
pub fn normalize_tag(value: &str) -> Option<String> {
    let name = value.strip_prefix('#')?;
    if name.is_empty()
        || name.chars().all(char::is_numeric)
        || name.chars().any(|character| {
            character.is_whitespace()
                || character.is_ascii_punctuation() && !matches!(character, '_' | '-' | '/')
        })
    {
        return None;
    }
    Some(format!("#{}", name.to_lowercase()))
}

/// 정규화한 태그는 동일 이름 또는 `/`로 구분한 하위 태그만 포함한다.
pub fn matches_tag(candidate: &str, selected: &str) -> bool {
    candidate == selected || candidate.starts_with(&format!("{selected}/"))
}

/// 호스트 메타데이터로 자동완성과 정확한 태그·하위 태그 파일 범위를 계산한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_tag_mentions_json(file_tags_json: &str, query: &str, max_files: usize) -> String {
    let Ok(file_tags) = serde_json::from_str::<Vec<Vec<String>>>(file_tags_json) else {
        return String::new();
    };
    let query = query.to_lowercase();
    let selected = normalize_tag(&query);
    let mut tags = BTreeSet::new();
    let mut indices = Vec::new();
    for (index, file) in file_tags.iter().enumerate() {
        let normalized = file
            .iter()
            .filter_map(|tag| normalize_tag(tag))
            .collect::<Vec<_>>();
        for tag in &normalized {
            tags.insert(tag.clone());
            for (offset, _) in tag.match_indices('/') {
                if let Some(parent) = tag.get(..offset) {
                    tags.insert(parent.to_owned());
                }
            }
        }
        if selected
            .as_ref()
            .is_some_and(|selected| normalized.iter().any(|tag| matches_tag(tag, selected)))
        {
            indices.push(index);
        }
    }
    json!({
        "tags": tags.into_iter().filter(|tag| tag.contains(&query)).take(20).collect::<Vec<_>>(),
        "fileIndices": indices.iter().take(max_files).collect::<Vec<_>>(),
        "matchedCount": indices.len(),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_preserve_hierarchy_case_and_bounds() {
        let input =
            r##"[["#Research/設計","#research/設計"],["#RESEARCH"],["#researcher"],["#다른"]]"##;
        assert_eq!(plan_tag_mentions_json(input, "#research", 1),
            json!({"tags":["#research", "#research/設計", "#researcher"], "fileIndices":[0], "matchedCount":2}).to_string());
        assert_eq!(normalize_tag("#1984"), None);
        assert_eq!(normalize_tag("#two words"), None);
        assert_eq!(normalize_tag("#"), None);
        assert_eq!(normalize_tag("#📚/notes"), Some("#📚/notes".to_owned()));
        assert_eq!(plan_tag_mentions_json("invalid", "#tag", 12), "");
        assert_eq!(
            plan_tag_mentions_json(input, "#missing", 12),
            json!({"tags":[], "fileIndices":[], "matchedCount":0}).to_string()
        );
    }
}
