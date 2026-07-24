//! 네이티브 Vault lexical 검색 결과의 실제 근거 행을 고르는 결정적 정책.

use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

use super::{build_context_preview, count_keyword_matches, is_token_part_character, tokenize_part};

/// 파일 단위 lexical 일치 결과에서 가장 관련 있는 실제 행과 검증 상태를 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn plan_native_vault_lexical_hit_json(query: &str, content: &str, match_mode: &str) -> String {
    if !matches!(match_mode, "all" | "any" | "phrase") {
        return String::new();
    }
    let tokens = primary_query_terms(query);
    if tokens.is_empty() {
        return String::new();
    }

    let joined_tokens = tokens.join("\u{1f}");
    let normalized_phrase = query.trim().to_lowercase();
    let best = content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let normalized_line = line.to_lowercase();
            let matched_tokens = count_keyword_matches(&joined_tokens, &normalized_line);
            let phrase_match =
                match_mode == "phrase" && normalized_line.contains(&normalized_phrase);
            if matched_tokens == 0 && !phrase_match {
                return None;
            }
            let verified = match match_mode {
                "all" => usize::try_from(matched_tokens).ok() == Some(tokens.len()),
                "any" => matched_tokens > 0,
                "phrase" => phrase_match,
                _ => false,
            };
            Some((index, line, matched_tokens, verified))
        })
        .max_by(|left, right| {
            left.3
                .cmp(&right.3)
                .then_with(|| left.2.cmp(&right.2))
                .then_with(|| right.0.cmp(&left.0))
        });

    let Some((index, line, _matched_tokens, verified)) = best else {
        return String::new();
    };
    let line_number = index.saturating_add(1);
    let Some(line_number) = u64::try_from(line_number).ok() else {
        return String::new();
    };
    let mut output = JsonMap::new();
    output.insert(
        "startLine".to_owned(),
        JsonValue::Number(JsonNumber::from(line_number)),
    );
    output.insert(
        "endLine".to_owned(),
        JsonValue::Number(JsonNumber::from(line_number)),
    );
    output.insert(
        "preview".to_owned(),
        JsonValue::String(build_context_preview(line)),
    );
    output.insert(
        "status".to_owned(),
        JsonValue::String(if verified { "verified" } else { "candidate" }.to_owned()),
    );
    serde_json::to_string(&JsonValue::Object(output)).unwrap_or_default()
}

/// Extracts stable primary terms without the tokenizer's Unicode n-gram expansions.
fn primary_query_terms(query: &str) -> Vec<String> {
    let mut terms = BTreeSet::new();
    let mut part = String::new();
    for character in query.chars() {
        if is_token_part_character(character) {
            part.push(character);
        } else {
            push_primary_query_term(&part, &mut terms);
            part.clear();
        }
    }
    push_primary_query_term(&part, &mut terms);
    terms.into_iter().collect()
}

/// Adds one non-Boolean primary query term to the deterministic term set.
fn push_primary_query_term(part: &str, terms: &mut BTreeSet<String>) {
    let Some(term) = tokenize_part(part).into_iter().next() else {
        return;
    };
    if !matches!(term.as_str(), "or" | "and") {
        terms.insert(term);
    }
}

#[cfg(test)]
mod tests {
    use super::plan_native_vault_lexical_hit_json;

    #[test]
    fn lexical_hit_points_to_the_matching_line() {
        assert_eq!(
            plan_native_vault_lexical_hit_json(
                "고객 이탈",
                "# 제목\n무관한 내용\n고객 이탈의 원인은 느린 온보딩이다.",
                "all",
            ),
            r#"{"startLine":3,"endLine":3,"preview":"고객 이탈의 원인은 느린 온보딩이다.","status":"verified"}"#,
        );
    }

    #[test]
    fn lexical_hit_is_only_a_candidate_when_all_terms_are_spread_across_lines() {
        assert_eq!(
            plan_native_vault_lexical_hit_json("고객 이탈", "고객 인터뷰\n이탈 원인", "all",),
            r#"{"startLine":1,"endLine":1,"preview":"고객 인터뷰","status":"candidate"}"#,
        );
    }

    #[test]
    fn any_match_does_not_verify_a_unicode_ngram_fragment() {
        assert_eq!(
            plan_native_vault_lexical_hit_json("창세기", "20세기 역사", "any"),
            "",
        );
    }

    #[test]
    fn phrase_match_requires_the_original_phrase_on_one_line() {
        assert_eq!(
            plan_native_vault_lexical_hit_json("고객 이탈", "고객 인터뷰와 이탈 원인", "phrase",),
            r#"{"startLine":1,"endLine":1,"preview":"고객 인터뷰와 이탈 원인","status":"candidate"}"#,
        );
        assert_eq!(
            plan_native_vault_lexical_hit_json("고객 이탈", "직접적인 고객 이탈 근거", "phrase"),
            r#"{"startLine":1,"endLine":1,"preview":"직접적인 고객 이탈 근거","status":"verified"}"#,
        );
    }
}
