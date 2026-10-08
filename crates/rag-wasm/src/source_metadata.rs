//! 파일 경로나 폴더를 저자·문서 유형으로 추측하지 않고 원문 메타데이터와 출처를 보존한다.
use regex::Regex;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::LazyLock;
use wasm_bindgen::prelude::wasm_bindgen;

/// 같은 메타데이터 날짜 패턴을 모든 파일에서 재사용한다.
static DATE_PATTERN: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b|(?i:\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b|\b\d{1,2}-(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)-(?:19|20)\d{2}\b)").ok()
});

/// 원문 표기는 보존하고 유효한 달력 날짜의 비교 키만 계산한다.
fn canonical_date(raw: &str) -> Option<String> {
    let components = raw
        .trim()
        .split(['-', ' ', ','])
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let [first, second, third] = components.as_slice() else {
        return None;
    };
    let (year, month, day) =
        if first.len() == 4 && first.chars().all(|value| value.is_ascii_digit()) {
            (
                first.parse::<u32>().ok()?,
                second.parse::<u32>().ok()?,
                third.parse::<u32>().ok()?,
            )
        } else if first.chars().all(|value| value.is_ascii_digit()) {
            (
                third.parse::<u32>().ok()?,
                english_month(second)?,
                first.parse::<u32>().ok()?,
            )
        } else {
            (
                third.parse::<u32>().ok()?,
                english_month(first)?,
                second.parse::<u32>().ok()?,
            )
        };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => return None,
    };
    (year > 0 && day > 0 && day <= days).then(|| format!("{year:04}-{month:02}-{day:02}"))
}

/// 영문 월 전체 이름과 정확한 3글자 약어만 허용한다.
fn english_month(raw: &str) -> Option<u32> {
    let normalized = raw.to_lowercase();
    let month = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ]
    .iter()
    .position(|month| *month == normalized || month.get(..3) == Some(normalized.as_str()))?
        + 1;
    u32::try_from(month).ok()
}

/// 제목·날짜·저자·유형의 원문 행과 날짜 충돌 상태를 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_metadata_json(content: &str) -> String {
    let lines = content.lines().take(16).collect::<Vec<_>>();
    let mut entries = Vec::new();
    let mut header_end = 0;
    for (index, line) in lines.iter().enumerate() {
        let text = line.trim();
        if let Some((key, value)) = text.split_once(':') {
            let key = key.trim().to_lowercase();
            let field = match key.as_str() {
                "title" | "제목" => Some("title"),
                "date" | "날짜" => Some("date"),
                "author" | "저자" => Some("author"),
                "type" | "유형" => Some("type"),
                _ => None,
            };
            if let Some(field) = field {
                let value = value.trim();
                let known = if field == "date" {
                    canonical_date(value).is_some()
                } else {
                    !value.is_empty()
                };
                entries.push(json!({"field":field,"value":value,"line":index+1,"origin":"header","status":if known {"known"}else{"unknown"}}));
            }
            if index == header_end {
                header_end = index + 1;
            }
        }
        if let Some(author) = text
            .strip_prefix("by ")
            .or_else(|| text.strip_prefix("By "))
            && author.chars().count() <= 120
        {
            entries.push(json!({"field":"author","value":author,"line":index+1,"origin":"byline","status":"known"}));
        }
        if let Some(pattern) = &*DATE_PATTERN {
            for date in pattern.find_iter(text) {
                if !entries.iter().any(|entry| {
                    entry.get("field").unwrap_or(&Value::Null) == "date"
                        && entry.get("line") == Some(&json!(index + 1))
                        && entry.get("value").unwrap_or(&Value::Null) == date.as_str()
                }) {
                    entries.push(json!({"field":"date","value":date.as_str(),"line":index+1,"origin":if index < header_end {"header"}else{"body"},"status":"known"}));
                }
            }
        }
    }
    let dates = entries
        .iter()
        .filter(|entry| {
            entry.get("field").unwrap_or(&Value::Null) == "date"
                && entry.get("status").unwrap_or(&Value::Null) == "known"
        })
        .filter_map(|entry| {
            entry
                .get("value")
                .unwrap_or(&Value::Null)
                .as_str()
                .and_then(canonical_date)
        })
        .collect::<BTreeSet<_>>();
    let date_status = if dates.len() > 1 {
        "conflict"
    } else if dates.is_empty() {
        "unknown"
    } else {
        "known"
    };
    let (header, evidence) = metadata_evidence(&lines, header_end, &entries);
    json!({"entries":entries,"dateStatus":date_status,"header":header,"evidence":evidence})
        .to_string()
}

/// 메타데이터가 나온 원문 범위를 제한된 크기의 인용 근거로 만든다.
fn metadata_evidence(lines: &[&str], header_end: usize, entries: &[Value]) -> (Value, Vec<Value>) {
    let header = lines
        .iter()
        .take(header_end)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    let header = if !header.is_empty() && header.chars().count() <= 1600 {
        json!({"startLine":1,"endLine":header_end,"content":header})
    } else {
        Value::Null
    };
    let mut evidence = if header.is_null() {
        Vec::new()
    } else {
        vec![header.clone()]
    };
    let mut seen = BTreeSet::new();
    for entry in entries {
        if let Some(line) = entry
            .get("line")
            .unwrap_or(&Value::Null)
            .as_u64()
            .and_then(|line| usize::try_from(line).ok())
            && (header.is_null() || line > header_end)
            && seen.insert(line)
            && let Some(text) = lines.get(line.saturating_sub(1))
            && text.chars().count() <= 1600
        {
            evidence.push(json!({"startLine":line,"endLine":line,"content":text}));
        }
    }
    (header, evidence)
}

/// 잘림 후 남아 있는 검색 구간·메타데이터만 출처로 남기고 중복 ID는 검증된 값을 우선한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_source_citation_indices_json(hits: &str, citations: &str) -> String {
    let (Ok(hits), Ok(citations)) = (
        serde_json::from_str::<Vec<Value>>(hits),
        serde_json::from_str::<Vec<Value>>(citations),
    ) else {
        return String::new();
    };
    let mut selected = std::collections::BTreeMap::<String, usize>::new();
    for (index, citation) in citations.iter().enumerate() {
        let covered = hits.iter().any(|hit| {
            if hit.get("path").unwrap_or(&Value::Null)
                != citation.get("filePath").unwrap_or(&Value::Null)
            {
                return false;
            }
            let same_range = |range: &Value| {
                range.get("startLine") == citation.get("line")
                    && range.get("endLine") == citation.get("endLine")
            };
            same_range(hit)
                || hit
                    .get("passages")
                    .unwrap_or(&Value::Null)
                    .as_array()
                    .is_some_and(|ranges| ranges.iter().any(same_range))
                || hit
                    .pointer("/metadata/evidence")
                    .unwrap_or(&Value::Null)
                    .as_array()
                    .is_some_and(|ranges| ranges.iter().any(same_range))
        });
        if covered
            && let Some(id) = citation.get("id").unwrap_or(&Value::Null).as_str()
            && (!selected.contains_key(id)
                || citation.get("status").unwrap_or(&Value::Null) == "verified")
        {
            selected.insert(id.to_owned(), index);
        }
    }
    let mut indices = selected.into_values().collect::<Vec<_>>();
    indices.sort_unstable();
    json!(indices).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Value {
        serde_json::from_str(&plan_source_metadata_json(text)).unwrap_or(Value::Null)
    }

    #[test]
    fn metadata_preserves_explicit_fields_without_classifying_titles() {
        for content in [
            "title: Synthetic inspection\ntype: maintenance\ndate: not-recorded\n\nauthor: Test writer A",
            "제목: 합성 부품 목록\n유형: inventory\n날짜: 미기록\n\n저자: 합성 작성자 B",
        ] {
            let metadata = parse(content);
            assert!(metadata.get("documentType").is_none());
            assert_eq!(metadata.get("dateStatus"), Some(&json!("unknown")));
            assert_eq!(metadata.pointer("/entries/1/field"), Some(&json!("type")));
            assert_eq!(
                metadata.pointer("/entries/2/status"),
                Some(&json!("unknown"))
            );
            assert_eq!(metadata.pointer("/evidence/1/startLine"), Some(&json!(5)));
        }
        let title_only = parse("title: Synthetic inspection");
        assert_eq!(
            title_only.pointer("/entries/0/value"),
            Some(&json!("Synthetic inspection"))
        );
        assert!(
            title_only
                .get("entries")
                .and_then(Value::as_array)
                .is_some_and(|entries| {
                    !entries
                        .iter()
                        .any(|entry| entry.get("field") == Some(&json!("type")))
                })
        );
    }

    #[test]
    fn calendar_formats_and_conflicts_do_not_depend_on_document_topics() {
        assert_eq!(
            parse("date: 2041-04-02\n\nApril 3, 2041").get("dateStatus"),
            Some(&json!("conflict"))
        );
        assert_eq!(
            parse("date: 2041-04-02\n\n2-Apr-2041").get("dateStatus"),
            Some(&json!("known"))
        );
        assert_eq!(
            parse("date: 2040-02-29\n\nFebruary 29, 2040").get("dateStatus"),
            Some(&json!("known"))
        );
        assert_eq!(
            parse("date: 2041-02-29").get("dateStatus"),
            Some(&json!("unknown"))
        );
        assert_eq!(parse("no metadata").get("entries"), Some(&json!([])));
    }
}
