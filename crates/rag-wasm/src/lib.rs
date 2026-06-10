//! `RAG` 인덱싱과 검색을 위한 `Rust WebAssembly` 코어.
//!
//! `JavaScript`는 `Obsidian UI`와 호스트 `I/O`만 담당한다. 이 크레이트는
//! `WebAssembly`에서 실행 가능한 이식성 있는 결정적 계산 커널을 담당한다.

#![forbid(unsafe_code)]

use wasm_bindgen::prelude::wasm_bindgen;

/// 기존 `TypeScript` 해시가 쓰는 `FNV-1a` 32비트 오프셋 기준값.
const FNV_OFFSET_BASIS: u32 = 0x811c_9dc5;
/// 기존 `TypeScript` 해시가 쓰는 `FNV-1a` 32비트 소수.
const FNV_PRIME: u32 = 0x0100_0193;

/// `TypeScript` 호스트에 노출할 `Rust` 코어 버전을 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// 현재 `TypeScript` 경로와 같은 32비트 `FNV-1a` 콘텐츠 해시를 만든다.
#[must_use]
#[wasm_bindgen]
pub fn create_content_hash(content: &str) -> String {
    let mut hash = FNV_OFFSET_BASIS;
    for unit in content.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:08x}")
}

/// 현재 `TypeScript BM25` 경로와 같은 검색 토큰 규칙으로 텍스트를 토큰화한다.
#[must_use]
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut part = String::new();

    for character in text.chars() {
        if is_token_part_character(character) {
            part.push(character);
        } else {
            tokens.extend(tokenize_part(&part));
            part.clear();
        }
    }
    tokens.extend(tokenize_part(&part));
    tokens
}

/// 텍스트를 토큰화하고 `JavaScript` 호스트 브리지를 위한 `JSON` 문자열로 반환한다.
#[must_use]
#[wasm_bindgen]
pub fn tokenize_json(text: &str) -> String {
    let tokens = tokenize(text);
    let body = tokens
        .iter()
        .map(|token| format!("\"{}\"", escape_json_string(token)))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{body}]")
}

/// 문자가 `BM25` 토큰 부분 문자 클래스에 속하는지 반환한다.
fn is_token_part_character(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '/' | '\\' | '@' | '.')
}

/// 하나의 연속 부분을 토큰화하고 지역 중복 토큰을 삽입 순서대로 제거한다.
fn tokenize_part(part: &str) -> Vec<String> {
    let trimmed = part.trim();
    if !trimmed.chars().any(char::is_alphanumeric) {
        return Vec::new();
    }

    let mut tokens = Vec::new();
    let normalized = normalize_token(trimmed);
    push_token(&mut tokens, &normalized);

    if trimmed.is_ascii() {
        tokenize_ascii_part(trimmed, &mut tokens);
    } else {
        tokenize_unicode_part(&normalized, &mut tokens);
    }

    dedupe_in_order(tokens)
}

/// `ASCII` 부분을 압축 토큰, 구분자 토큰, `camel-case` 토큰으로 나눈다.
fn tokenize_ascii_part(part: &str, tokens: &mut Vec<String>) {
    let segments = part
        .split(is_ascii_separator)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    if segments.len() > 1 {
        push_token(tokens, &segments.join("").to_lowercase());
    }

    for segment in segments {
        let camel_parts = split_ascii_identifier(segment);
        if camel_parts.len() > 1 {
            push_token(tokens, &camel_parts.join("").to_lowercase());
        }
        for camel_part in camel_parts {
            push_token(tokens, &camel_part.to_lowercase());
        }
    }
}

/// `BM25` 매칭에서 압축 처리되는 `ASCII` 구분자인지 반환한다.
const fn is_ascii_separator(character: char) -> bool {
    matches!(character, '_' | '-' | '/' | '\\' | '@' | '.')
}

/// `Unicode` 부분을 압축 스크립트 그룹과 짧은 `n-gram`으로 나눈다.
fn tokenize_unicode_part(part: &str, tokens: &mut Vec<String>) {
    let compact = part
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect::<String>();
    push_token(tokens, &compact);

    let mut group = String::new();
    let mut group_kind = None;
    for character in compact.chars() {
        let next_kind = unicode_group_kind(character);
        if group_kind.is_some() && group_kind != Some(next_kind) {
            push_token(tokens, &group.to_lowercase());
            group.clear();
        }
        group_kind = Some(next_kind);
        group.push(character);
    }
    push_token(tokens, &group.to_lowercase());

    let chars = compact.chars().collect::<Vec<_>>();
    for size in [2_usize, 3_usize] {
        for window in chars.windows(size) {
            let token = window.iter().collect::<String>();
            push_token(tokens, &token);
        }
    }
}

/// `TypeScript` 토크나이저의 대체 그룹과 맞추는 `Unicode` 그룹 종류.
#[derive(Clone, Copy, Eq, PartialEq)]
enum UnicodeGroupKind {
    /// 한글 글자와 호환 자모.
    Hangul,
    /// CJK 통합 한자.
    Han,
    /// 히라가나 글자.
    Hiragana,
    /// 가타카나 글자.
    Katakana,
    /// `Unicode` 숫자 문자.
    Number,
    /// `ASCII` 알파벳 문자.
    AsciiAlpha,
    /// 그 밖의 영숫자 문자.
    Other,
}

/// 문자를 토크나이저의 거친 `Unicode` 스크립트 그룹으로 분류한다.
fn unicode_group_kind(character: char) -> UnicodeGroupKind {
    if is_hangul(character) {
        UnicodeGroupKind::Hangul
    } else if is_han(character) {
        UnicodeGroupKind::Han
    } else if is_hiragana(character) {
        UnicodeGroupKind::Hiragana
    } else if is_katakana(character) {
        UnicodeGroupKind::Katakana
    } else if character.is_numeric() {
        UnicodeGroupKind::Number
    } else if character.is_ascii_alphabetic() {
        UnicodeGroupKind::AsciiAlpha
    } else {
        UnicodeGroupKind::Other
    }
}

/// 일반 vault 텍스트에서 쓰이는 한글 스크립트 범위인지 반환한다.
const fn is_hangul(character: char) -> bool {
    matches!(
        character,
        '\u{1100}'..='\u{11FF}'
            | '\u{3130}'..='\u{318F}'
            | '\u{A960}'..='\u{A97F}'
            | '\u{AC00}'..='\u{D7AF}'
            | '\u{D7B0}'..='\u{D7FF}'
    )
}

/// 일반 vault 텍스트에서 쓰이는 한자 스크립트 범위인지 반환한다.
const fn is_han(character: char) -> bool {
    matches!(
        character,
        '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{20000}'..='\u{2A6DF}'
            | '\u{2A700}'..='\u{2B73F}'
            | '\u{2B740}'..='\u{2B81F}'
            | '\u{2B820}'..='\u{2CEAF}'
            | '\u{2CEB0}'..='\u{2EBEF}'
            | '\u{30000}'..='\u{3134F}'
    )
}

/// 히라가나 스크립트 범위인지 반환한다.
const fn is_hiragana(character: char) -> bool {
    matches!(character, '\u{3040}'..='\u{309F}')
}

/// 가타카나 스크립트 범위인지 반환한다.
const fn is_katakana(character: char) -> bool {
    matches!(character, '\u{30A0}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}')
}

/// `TypeScript` 정규식과 같은 `camel-case` 규칙으로 `ASCII` 식별자를 나눈다.
fn split_ascii_identifier(segment: &str) -> Vec<String> {
    let chars = segment.chars().collect::<Vec<_>>();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut previous = None;

    for (index, character) in chars.iter().copied().enumerate() {
        let next = chars.get(index.saturating_add(1)).copied();
        if should_split_ascii_identifier(previous, character, next) && !current.is_empty() {
            parts.push(current);
            current = String::new();
        }
        current.push(character);
        previous = Some(character);
    }

    if !current.is_empty() {
        parts.push(current);
    }

    if parts.is_empty() {
        vec![segment.to_owned()]
    } else {
        parts
    }
}

/// `camel-case` 식별자를 현재 문자 앞에서 나눠야 하는지 반환한다.
fn should_split_ascii_identifier(
    previous: Option<char>,
    current: char,
    next: Option<char>,
) -> bool {
    let Some(previous) = previous else {
        return false;
    };

    if previous.is_ascii_digit() != current.is_ascii_digit() {
        return true;
    }
    if previous.is_ascii_lowercase() && current.is_ascii_uppercase() {
        return true;
    }
    previous.is_ascii_uppercase()
        && current.is_ascii_uppercase()
        && next.is_some_and(|next_character| next_character.is_ascii_lowercase())
}

/// 영숫자가 아닌 가장자리를 제거하고 소문자화해 토큰을 정규화한다.
fn normalize_token(token: &str) -> String {
    token
        .trim()
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_lowercase()
}

/// `Unicode` 스칼라 값이 2개 이상인 정규화 토큰만 추가한다.
fn push_token(tokens: &mut Vec<String>, token: &str) {
    let normalized = normalize_token(token);
    if normalized.chars().count() < 2 {
        return;
    }
    tokens.push(normalized);
}

/// 첫 출현 순서를 보존하면서 중복 토큰을 제거한다.
fn dedupe_in_order(tokens: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for token in tokens {
        if !deduped.iter().any(|existing| existing == &token) {
            deduped.push(token);
        }
    }
    deduped
}

/// `JSON` 의존성을 코어에 끌어오지 않고 토큰을 `JSON` 문자열 리터럴용으로 이스케이프한다.
fn escape_json_string(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                let code = u32::from(character);
                push_json_unicode_escape(&mut escaped, code);
            }
            character => escaped.push(character),
        }
    }
    escaped
}

/// 네 자리 `JSON unicode escape`를 추가한다.
fn push_json_unicode_escape(output: &mut String, code: u32) {
    output.push_str("\\u");
    for shift in [12_u32, 8, 4, 0] {
        output.push(hex_digit((code >> shift) & 0x0f));
    }
}

/// 16진수 `nibble`을 소문자 `ASCII` 숫자로 변환한다.
const fn hex_digit(nibble: u32) -> char {
    match nibble {
        0 => '0',
        1 => '1',
        2 => '2',
        3 => '3',
        4 => '4',
        5 => '5',
        6 => '6',
        7 => '7',
        8 => '8',
        9 => '9',
        10 => 'a',
        11 => 'b',
        12 => 'c',
        13 => 'd',
        14 => 'e',
        _ => 'f',
    }
}

#[cfg(test)]
mod tests {
    //! `TypeScript`에서 옮기는 계산 커널의 `Rust` 동등성 테스트.

    use super::{create_content_hash, tokenize};

    /// 콘텐츠 해시는 현재 `TypeScript UTF-16 FNV-1a` 계약을 보존해야 한다.
    #[test]
    fn content_hash_matches_typescript_fnv1a_utf16_units() {
        assert_eq!(
            create_content_hash("hello"),
            "4f9f2cab",
            "ASCII 해시는 TypeScript 구현과 같아야 한다",
        );
        assert_eq!(
            create_content_hash("요고49 포인트 페이백"),
            "d30c670d",
            "한국어 해시는 TypeScript 구현과 같아야 한다",
        );
    }

    /// `ASCII` 토크나이저 동작은 복합어와 `camel-case` 검색 재현율을 보존해야 한다.
    #[test]
    fn tokenizer_preserves_ascii_compounds_and_camel_case_parts() {
        let tokens = tokenize("OpenRouter freeLLMApi open-router");

        for expected in [
            "openrouter",
            "open",
            "router",
            "freellmapi",
            "free",
            "llm",
            "api",
        ] {
            assert!(
                tokens.iter().any(|token| token == expected),
                "missing expected token {expected}; got {tokens:?}",
            );
        }
    }

    /// `Unicode` 토크나이저 동작은 한국어 숫자 그룹과 짧은 `n-gram`을 보존해야 한다.
    #[test]
    fn tokenizer_preserves_korean_digits_and_unicode_ngrams() {
        let tokens = tokenize("요고49 포인트 페이백");

        for expected in ["요고49", "요고", "49", "포인트", "포인", "인트", "페이백"] {
            assert!(
                tokens.iter().any(|token| token == expected),
                "missing expected token {expected}; got {tokens:?}",
            );
        }
    }
}
