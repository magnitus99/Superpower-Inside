//! 검색 조건 검증과 본문을 보존하지 않는 제한된 묶음 검색.

use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

/// 외부 도구 인자의 검색 방식을 검증한다. 생략된 값은 레거시 wire를 유지한다.
pub fn normalize_search_options(
    object: &Map<String, Value>,
) -> Result<Map<String, Value>, &'static str> {
    let mut result = Map::new();
    for (key, allowed) in [
        ("mode", &["auto", "exact", "word"][..]),
        ("field", &["both", "content", "path"][..]),
    ] {
        if let Some(value) = object.get(key) {
            if !value.as_str().is_some_and(|value| allowed.contains(&value)) {
                return Err("invalid_request");
            }
            result.insert(key.to_owned(), value.clone());
        }
    }
    if let Some(filters) = normalize_filters(object.get("filters"))? {
        result.insert("filters".to_owned(), filters);
    }
    Ok(result)
}

/// 모델이 보낸 날짜·태그·단순 속성 필터의 타입과 크기를 검증한다.
pub fn normalize_filters(value: Option<&Value>) -> Result<Option<Value>, &'static str> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value.as_object().ok_or("invalid_request")?;
    let mut result = Map::new();
    for (key, value) in object {
        match key.as_str() {
            "modified_after" | "modified_before" => {
                let timestamp = value
                    .as_u64()
                    .filter(|value| *value <= 9_007_199_254_740_991)
                    .ok_or("invalid_request")?;
                result.insert(
                    if key == "modified_after" {
                        "modifiedAfter"
                    } else {
                        "modifiedBefore"
                    }
                    .to_owned(),
                    json!(timestamp),
                );
            }
            "tags" => {
                let tags = value
                    .as_array()
                    .filter(|tags| tags.len() <= 16)
                    .ok_or("invalid_request")?;
                let mut normalized = BTreeSet::new();
                for tag in tags {
                    let tag = tag
                        .as_str()
                        .ok_or("invalid_request")?
                        .trim()
                        .trim_start_matches('#');
                    if tag.is_empty() || tag.chars().count() > 128 {
                        return Err("invalid_request");
                    }
                    normalized.insert(tag.to_lowercase());
                }
                result.insert(key.clone(), json!(normalized));
            }
            "properties" => {
                let properties = value
                    .as_object()
                    .filter(|properties| properties.len() <= 16)
                    .ok_or("invalid_request")?;
                for (name, value) in properties {
                    if name.is_empty()
                        || name.chars().count() > 128
                        || !(value.is_boolean()
                            || value.is_number()
                            || value
                                .as_str()
                                .is_some_and(|text| text.chars().count() <= 512))
                    {
                        return Err("invalid_request");
                    }
                }
                result.insert(key.clone(), value.clone());
            }
            _ => return Err("invalid_request"),
        }
    }
    if let (Some(after), Some(before)) = (
        result.get("modifiedAfter").and_then(Value::as_u64),
        result.get("modifiedBefore").and_then(Value::as_u64),
    ) && after > before
    {
        return Err("invalid_request");
    }
    Ok(Some(Value::Object(result)))
}

/// Obsidian이 제공한 메타데이터에서 모든 조건이 일치하는 파일 index를 선택한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_filtered_indices_json(files_json: &str, filters_json: &str) -> String {
    let Ok(files) = serde_json::from_str::<Vec<Value>>(files_json) else {
        return String::new();
    };
    let Ok(filters) = serde_json::from_str::<Map<String, Value>>(filters_json) else {
        return String::new();
    };
    let external = filters
        .into_iter()
        .map(|(key, value)| {
            let key = match key.as_str() {
                "modifiedAfter" => "modified_after".to_owned(),
                "modifiedBefore" => "modified_before".to_owned(),
                _ => key,
            };
            (key, value)
        })
        .collect::<Map<_, _>>();
    let Ok(Some(Value::Object(filters))) = normalize_filters(Some(&Value::Object(external))) else {
        return String::new();
    };
    let mut indices = Vec::new();
    for (index, file) in files.iter().enumerate() {
        let Some(file) = file.as_object() else {
            return String::new();
        };
        let Some(modified) = file.get("modifiedAt").and_then(Value::as_u64) else {
            return String::new();
        };
        let matches_date = filters
            .get("modifiedAfter")
            .and_then(Value::as_u64)
            .is_none_or(|after| modified >= after)
            && filters
                .get("modifiedBefore")
                .and_then(Value::as_u64)
                .is_none_or(|before| modified <= before);
        let tags = file.get("tags").and_then(Value::as_array);
        let matches_tags = filters
            .get("tags")
            .and_then(Value::as_array)
            .is_none_or(|required| {
                required.iter().all(|tag| {
                    let Some(tag) = tag.as_str() else {
                        return false;
                    };
                    tags.is_some_and(|tags| {
                        tags.iter().any(|candidate| {
                            candidate.as_str().is_some_and(|candidate| {
                                super::tag_mentions::matches_tag(
                                    &candidate.trim_start_matches('#').to_lowercase(),
                                    tag,
                                )
                            })
                        })
                    })
                })
            });
        let properties = file.get("properties").and_then(Value::as_object);
        let matches_properties = filters
            .get("properties")
            .and_then(Value::as_object)
            .is_none_or(|required| {
                required.iter().all(|(key, value)| {
                    properties.and_then(|properties| properties.get(key)) == Some(value)
                })
            });
        if matches_date && matches_tags && matches_properties {
            indices.push(index);
        }
    }
    json!(indices).to_string()
}

/// 이전 상위 후보와 최대 8개 본문을 결합한다. 본문은 다음 묶음으로 넘기지 않는다.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_lexical_batch_json(
    request_json: &str,
    samples_json: &str,
    previous_json: &str,
) -> String {
    let Some(plan) = lexical_batch(request_json, samples_json, previous_json) else {
        return String::new();
    };
    plan.to_string()
}

/// wire 입력을 검증하고 파일당 일치 수와 질의별 상위 후보를 누적한다.
fn lexical_batch(request_json: &str, samples_json: &str, previous_json: &str) -> Option<Value> {
    let request = serde_json::from_str::<Value>(request_json).ok()?;
    let queries = request.get("queries")?.as_array()?;
    let limit = usize::try_from(request.get("limit")?.as_u64()?).ok()?;
    let match_mode = request.get("match")?.as_str()?;
    let field = request
        .get("field")
        .and_then(Value::as_str)
        .unwrap_or("both");
    let exact = request.get("mode").and_then(Value::as_str) == Some("exact");
    if !(1..=20).contains(&limit)
        || !(1..=4).contains(&queries.len())
        || !matches!(match_mode, "all" | "any" | "phrase")
        || !matches!(field, "both" | "content" | "path")
        || request
            .get("mode")
            .is_some_and(|mode| !matches!(mode.as_str(), Some("auto" | "exact" | "word")))
        || queries.iter().any(|query| {
            !query
                .as_str()
                .is_some_and(|query| !query.is_empty() && query.chars().count() <= 512)
        })
    {
        return None;
    }
    let prepared_queries = prepare_lexical_queries(queries, exact);
    let word_queries = prepare_word_queries(
        queries,
        request.get("mode").and_then(Value::as_str) == Some("word"),
        match_mode,
    );
    let samples = serde_json::from_str::<Vec<Value>>(samples_json).ok()?;
    if samples.len() > 8 {
        return None;
    }
    let previous = serde_json::from_str::<Value>(previous_json).ok()?;
    let mut streams = parse_lexical_streams(&previous, queries.len(), limit)?;
    let mut total_hits = previous
        .get("totalHits")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let scanned_files = previous
        .get("scannedFiles")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .checked_add(u64::try_from(samples.len()).ok()?)?;
    let mut unreadable_files = previous
        .get("unreadableFiles")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    for sample in samples {
        let path = sample.get("path")?.as_str()?;
        let content = sample.get("content")?;
        if content.is_null() {
            unreadable_files = unreadable_files.checked_add(1)?;
            continue;
        }
        let content = content.as_str()?;
        let passages = combined_matching_passages(
            queries,
            &word_queries,
            if field == "path" { "" } else { content },
            match_mode,
            exact,
        );
        let mut matched = false;
        for (((query, prepared), word), stream) in queries
            .iter()
            .zip(&prepared_queries)
            .zip(&word_queries)
            .zip(&mut streams)
        {
            let query = query.as_str()?;
            if let Some(candidate) = lexical_candidate(
                query,
                prepared.as_ref(),
                path,
                content,
                match_mode,
                field,
                (exact, word.as_deref(), &passages),
            ) {
                matched = true;
                stream.push(candidate);
                stream.sort_by(|left, right| {
                    right["score"]
                        .as_u64()
                        .cmp(&left["score"].as_u64())
                        .then_with(|| left["path"].as_str().cmp(&right["path"].as_str()))
                });
                stream.truncate(limit);
            }
        }
        total_hits = total_hits.checked_add(u64::from(matched))?;
    }
    Some(
        json!({ "streams": streams, "totalHits": total_hits, "scannedFiles": scanned_files, "unreadableFiles": unreadable_files }),
    )
}

/// 리터럴 검색 외의 정규화된 어휘는 파일 순회 전에 한 번만 준비한다.
fn prepare_lexical_queries(
    queries: &[Value],
    exact: bool,
) -> Vec<Option<super::FolderLexicalQuery>> {
    queries
        .iter()
        .map(|query| {
            if exact {
                None
            } else {
                super::prepare_folder_lexical_query(query.as_str().unwrap_or_default())
            }
        })
        .collect()
}

/// 이전 묶음의 계수와 후보 상한을 검증한다. 잘못된 wire는 초기 상태로 대체하지 않는다.
fn parse_lexical_streams(
    previous: &Value,
    query_count: usize,
    limit: usize,
) -> Option<Vec<Vec<Value>>> {
    if previous.is_null() {
        return Some(vec![Vec::new(); query_count]);
    }
    let total = previous.get("totalHits")?.as_u64()?;
    let scanned = previous.get("scannedFiles")?.as_u64()?;
    let unreadable = previous.get("unreadableFiles")?.as_u64()?;
    if total > scanned || unreadable > scanned {
        return None;
    }
    let streams = previous.get("streams")?.as_array()?;
    if streams.len() != query_count {
        return None;
    }
    streams
        .iter()
        .map(|stream| {
            stream
                .as_array()
                .cloned()
                .filter(|stream| stream.len() <= limit)
        })
        .collect()
}

/// 지정한 검색 필드만 평가하고 현재 원문에서 행 위치를 선택한다.
fn lexical_candidate(
    query: &str,
    prepared: Option<&super::FolderLexicalQuery>,
    path: &str,
    content: &str,
    match_mode: &str,
    field: &str,
    literal: (bool, Option<&[regex::Regex]>, &[Value]),
) -> Option<Value> {
    let (exact, word, passages) = literal;
    let searchable_path = if field == "content" { "" } else { path };
    let searchable_content = if field == "path" { "" } else { content };
    let score = if let Some(word) = word {
        if word_match_count(word, searchable_path, match_mode) > 0 {
            10_000
        } else {
            let count = word_match_count(word, searchable_content, match_mode);
            if count == 0 {
                return None;
            }
            u32::try_from(count.min(9_999)).ok()?
        }
    } else if exact {
        if searchable_path.contains(query) {
            10_000
        } else if searchable_content.contains(query) {
            1
        } else {
            return None;
        }
    } else {
        super::score_folder_lexical_sample(
            prepared?,
            searchable_path,
            searchable_content,
            match_mode,
        )?
    };
    let evidence = word.map_or_else(
        || {
            if exact {
                exact_evidence(query, searchable_content)
            } else {
                serde_json::from_str::<Value>(
                    &super::native_lexical_hit::plan_native_vault_lexical_hit_json(
                        query,
                        searchable_content,
                        match_mode,
                    ),
                )
                .ok()
            }
        },
        |word| {
            word.iter()
                .filter_map(|pattern| pattern.find(searchable_content))
                .min_by_key(regex::Match::start)
                .and_then(|found| {
                    searchable_content
                        .get(found.start()..found.end())
                        .and_then(|query| exact_evidence(query, searchable_content))
                })
        },
    );
    Some(json!({
        "path": path, "score": score,
        "passages": passages,
        "metadata": serde_json::from_str::<Value>(&super::plan_source_metadata_json(searchable_content)).ok(),
        "startLine": evidence.as_ref().and_then(|evidence| evidence.get("startLine")).cloned().unwrap_or_else(|| json!(1)),
        "endLine": evidence.as_ref().and_then(|evidence| evidence.get("endLine")).cloned().unwrap_or_else(|| json!(1)),
        "preview": evidence.as_ref().and_then(|evidence| evidence.get("preview")).cloned().unwrap_or_else(|| json!(if field == "path" { path.to_owned() } else { super::build_context_preview(content) })),
    }))
}

/// 질의마다 한 구간씩 먼저 선택해 대표 후보가 다른 변형의 근거를 지우지 않게 한다.
fn combined_matching_passages(
    queries: &[Value],
    words: &[Option<Vec<regex::Regex>>],
    content: &str,
    mode: &str,
    exact: bool,
) -> Vec<Value> {
    let streams = queries
        .iter()
        .zip(words)
        .map(|(query, word)| {
            matching_passages(
                query.as_str().unwrap_or_default(),
                content,
                mode,
                exact,
                word.as_deref(),
            )
        })
        .collect::<Vec<_>>();
    let mut ranges = Vec::<(usize, usize)>::new();
    for depth in 0..4 {
        for stream in &streams {
            let Some(passage) = stream.get(depth) else {
                continue;
            };
            let Some((start, end)) = passage
                .get("startLine")
                .and_then(Value::as_u64)
                .and_then(|line| usize::try_from(line).ok())
                .zip(
                    passage
                        .get("endLine")
                        .and_then(Value::as_u64)
                        .and_then(|line| usize::try_from(line).ok()),
                )
            else {
                continue;
            };
            if let Some(previous) = ranges
                .iter_mut()
                .find(|range| start <= range.1 && end >= range.0)
            {
                previous.0 = previous.0.min(start);
                previous.1 = previous.1.max(end);
            } else if ranges.len() < 4 {
                ranges.push((start, end));
            }
        }
    }
    ranges.sort_unstable();
    let mut merged = Vec::<(usize, usize)>::new();
    for (start, end) in ranges {
        if let Some(previous) = merged.last_mut()
            && start <= previous.1
        {
            previous.1 = previous.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    let lines = content.split('\n').collect::<Vec<_>>();
    merged
        .into_iter()
        .filter_map(|(start, end)| {
            let text = lines.get(start.saturating_sub(1)..end)?.join("\n");
            (text.encode_utf16().count() <= 2400)
                .then(|| json!({"startLine":start,"endLine":end,"content":text}))
        })
        .collect()
}

/// 같은 파일의 서로 다른 일치를 유지하고 겹치는 문맥만 합친다. 원문은 최대 4구간이다.
fn matching_passages(
    query: &str,
    content: &str,
    match_mode: &str,
    exact: bool,
    word: Option<&[regex::Regex]>,
) -> Vec<Value> {
    let lines = content.split('\n').collect::<Vec<_>>();
    let mut ranges = Vec::<(usize, usize)>::new();
    let primary = super::native_lexical_hit::primary_query_terms(query).join("\u{1f}");
    for (index, line) in lines.iter().enumerate() {
        let matched = word.map_or_else(
            || {
                if exact {
                    line.contains(query)
                } else if match_mode == "phrase" {
                    line.to_lowercase().contains(&query.to_lowercase())
                } else {
                    super::count_keyword_matches(&primary, line) > 0
                }
            },
            |patterns| word_match_count(patterns, line, match_mode) > 0,
        );
        if !matched {
            continue;
        }
        let start = index.saturating_sub(1);
        let end = (index + 1).min(lines.len().saturating_sub(1));
        if let Some(previous) = ranges.last_mut()
            && start <= previous.1
        {
            previous.1 = end;
        } else if ranges.len() < 4 {
            ranges.push((start, end));
        } else {
            break;
        }
    }
    ranges
        .into_iter()
        .filter_map(|(start, end)| {
            let text = lines.get(start..=end)?.join("\n");
            // 긴 한 행을 임의로 자르고 전체 문단을 읽었다고 표시하지 않는다.
            (text.encode_utf16().count() <= 2400)
                .then(|| json!({"startLine":start+1,"endLine":end+1,"content":text}))
        })
        .collect()
}

/// 리터럴 구간의 실제 행 번호를 보존한다. 대소문자와 공백을 바꾸지 않는다.
fn exact_evidence(query: &str, content: &str) -> Option<Value> {
    let offset = content.find(query)?;
    let start_line = content
        .get(..offset)?
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        .checked_add(1)?;
    let end_line = start_line.checked_add(query.bytes().filter(|byte| *byte == b'\n').count())?;
    let line_start = content
        .get(..offset)?
        .rfind('\n')
        .map_or(0, |offset| offset + 1);
    let line_end = content
        .get(offset..)?
        .find('\n')
        .map_or(content.len(), |end| offset + end);
    Some(
        json!({ "startLine": start_line, "endLine": end_line, "preview": match_preview(content.get(line_start..line_end)?, offset.saturating_sub(line_start)) }),
    )
}

/// 긴 행의 앞부분 대신 실제 일치 위치 주변을 표시한다.
fn match_preview(line: &str, offset: usize) -> String {
    let before = line.get(..offset).unwrap_or_default().chars().count();
    line.chars()
        .skip(before.saturating_sub(80))
        .take(220)
        .collect()
}

/// 단어 검색의 정규식은 묶음마다 한 번만 준비한다.
fn prepare_word_queries(
    queries: &[Value],
    word: bool,
    match_mode: &str,
) -> Vec<Option<Vec<regex::Regex>>> {
    queries
        .iter()
        .map(|query| {
            if word {
                let query = query.as_str().unwrap_or_default();
                let terms = if match_mode == "phrase" {
                    vec![query]
                } else {
                    query.split_whitespace().collect()
                };
                terms
                    .into_iter()
                    .map(|term| {
                        regex::Regex::new(&format!(r"(?i)\b{}\b", regex::escape(term))).ok()
                    })
                    .collect()
            } else {
                None
            }
        })
        .collect()
}

/// any는 한 단어 이상, all은 모든 단어의 정확한 경계 일치를 요구한다.
fn word_match_count(patterns: &[regex::Regex], text: &str, match_mode: &str) -> usize {
    let mut total = 0_usize;
    for pattern in patterns {
        let count = pattern.find_iter(text).count();
        if match_mode == "all" && count == 0 {
            return 0;
        }
        total = total.saturating_add(count);
    }
    total
}

#[cfg(test)]
mod tests {
    /// 모델이 추가 조사해도 채팅 태그 지목과 같은 하위 태그 범위를 유지한다.
    #[test]
    fn tag_filters_include_nested_tags_without_prefix_collisions() {
        assert_eq!(
            super::plan_native_vault_filtered_indices_json(
                r##"[{"modifiedAt":0,"tags":["#Research/設計"]},{"modifiedAt":0,"tags":["#RESEARCH"]},{"modifiedAt":0,"tags":["#researcher"]}]"##,
                r#"{"tags":["research"]}"#
            ),
            "[0,1]"
        );
    }
    use super::*;

    #[test]
    fn word_search_respects_any_all_and_phrase_for_multiple_terms() {
        let samples = json!([
            {"path":"a.txt", "content":"No accident happens."},
            {"path":"b.txt", "content":"Luck and accident are discussed."},
            {"path":"c.txt", "content":"No accident luck here."},
            {"path":"d.txt", "content":"Unlucky accidental events."}
        ]);
        for (mode, expected) in [("any", 3), ("all", 2), ("phrase", 1)] {
            let request = json!({"queries":["accident luck"],"limit":10,"match":mode,"mode":"word","field":"content"});
            let value: Value = serde_json::from_str(&plan_native_vault_lexical_batch_json(
                &request.to_string(),
                &samples.to_string(),
                "null",
            ))
            .unwrap_or(Value::Null);
            assert_eq!(value.get("totalHits"), Some(&json!(expected)), "{mode}");
        }
    }

    #[test]
    fn word_search_avoids_substrings_and_preserves_late_match_preview() {
        let samples = json!([{"path":"a.txt", "content":"strawberries"}, {"path":"b.txt", "content":format!("intro\n{} STRAW is not chance", "x".repeat(400))}]);
        let raw = plan_native_vault_lexical_batch_json(
            r#"{"queries":["straw"],"limit":10,"match":"phrase","mode":"word","field":"content"}"#,
            &samples.to_string(),
            "null",
        );
        let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        assert_eq!(value.get("totalHits"), Some(&json!(1)));
        assert_eq!(value.pointer("/streams/0/0/startLine"), Some(&json!(2)));
        assert!(
            value
                .pointer("/streams/0/0/preview")
                .and_then(Value::as_str)
                .is_some_and(|preview| preview.contains("STRAW"))
        );
    }

    #[test]
    fn bounded_batches_keep_late_high_rank_and_count_each_file_once() {
        let request = r#"{"queries":["alpha","beta"],"limit":1,"match":"any"}"#;
        let first = plan_native_vault_lexical_batch_json(
            request,
            r#"[{"path":"a.md","content":"alpha"},{"path":"b.md","content":"beta"}]"#,
            "null",
        );
        let next = plan_native_vault_lexical_batch_json(
            request,
            r#"[{"path":"alpha-beta.md","content":"alpha beta"},{"path":"bad.md","content":null}]"#,
            &first,
        );
        let value: Value = serde_json::from_str(&next).unwrap_or(Value::Null);
        assert_eq!(
            value.pointer("/streams/0/0/path"),
            Some(&json!("alpha-beta.md"))
        );
        assert_eq!(
            value.pointer("/streams/1/0/path"),
            Some(&json!("alpha-beta.md"))
        );
        assert_eq!(value.get("totalHits"), Some(&json!(3)));
        assert_eq!(value.get("scannedFiles"), Some(&json!(4)));
        assert_eq!(value.get("unreadableFiles"), Some(&json!(1)));
    }

    #[test]
    fn exact_search_preserves_case_whitespace_and_multiline_positions() {
        let request = r#"{"queries":["API  Key\nvalue"],"limit":2,"match":"phrase","mode":"exact","field":"content"}"#;
        let raw = plan_native_vault_lexical_batch_json(
            request,
            r#"[{"path":"a.md","content":"intro\nAPI  Key\nvalue"},{"path":"b.md","content":"api key\nvalue"}]"#,
            "null",
        );
        let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        assert_eq!(
            value
                .pointer("/streams/0")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(value.pointer("/streams/0/0/startLine"), Some(&json!(2)));
        assert_eq!(value.pointer("/streams/0/0/endLine"), Some(&json!(3)));
    }

    #[test]
    fn filters_keep_typed_equality_and_missing_properties_fail_closed() {
        let files = r##"[{"modifiedAt":100,"tags":["#Project"],"properties":{"priority":1}},{"modifiedAt":10,"tags":["#Project"],"properties":{"priority":1}},{"modifiedAt":100,"tags":["#Project"],"properties":{}}]"##;
        assert_eq!(
            plan_native_vault_filtered_indices_json(
                files,
                r#"{"modifiedAfter":50,"tags":["project"],"properties":{"priority":1}}"#
            ),
            "[0]"
        );
        assert_eq!(
            plan_native_vault_filtered_indices_json(files, r#"{"properties":{"priority":"1"}}"#),
            "[]"
        );
    }

    #[test]
    fn malformed_filters_and_batch_state_do_not_broaden_search() {
        let files = r#"[{"modifiedAt":100,"tags":[],"properties":{}}]"#;
        for filters in [
            r#"{"modifiedAfter":"50"}"#,
            r#"{"unknown":true}"#,
            r#"{"properties":{"priority":[1]}}"#,
        ] {
            assert_eq!(plan_native_vault_filtered_indices_json(files, filters), "");
        }
        let request = r#"{"queries":["alpha"],"limit":1,"match":"all"}"#;
        assert_eq!(
            plan_native_vault_lexical_batch_json(request, "[]", r#"{"streams":[[]]}"#),
            ""
        );
        assert_eq!(
            plan_native_vault_lexical_batch_json(
                r#"{"queries":[""],"limit":1,"match":"all"}"#,
                "[]",
                "null"
            ),
            ""
        );
    }
    #[test]
    fn lexical_all_matches_identifiers_and_paths_without_requiring_expanded_tokens() {
        for (query, path, content, field) in [
            (
                "IDENT_2 Exact",
                "record.md",
                "IDENT_2 Exact: value",
                "content",
            ),
            ("set/Target-1.md", "set/Target-1.md", "value", "path"),
            (
                "with space/Target-1.md",
                "with space/Target-1.md",
                "value",
                "path",
            ),
            ("자료/Target-1.md", "자료/Target-1.md", "value", "path"),
        ] {
            let request = json!({"queries":[query],"limit":3,"match":"all","field":field});
            let samples = json!([{"path":path,"content":content}]);
            let raw = plan_native_vault_lexical_batch_json(
                &request.to_string(),
                &samples.to_string(),
                "null",
            );
            let result: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            assert_eq!(result.get("totalHits"), Some(&json!(1)), "{query}");
        }
    }
}
