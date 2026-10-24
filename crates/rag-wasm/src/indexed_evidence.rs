//! LLM 없이 질의 관련 원문 구절과 출처 상태를 결정적으로 선택·검증합니다.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// 한 번의 bridge 호출이 받는 `JSON` byte 상한입니다.
const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;
/// 문서 항목 하나의 본문 `UTF-8` byte 상한입니다.
const MAX_DOCUMENT_TEXT_BYTES: usize = 2 * 1024 * 1024;
/// 한 번의 계획 입력이 가질 수 있는 문서 항목 수 상한입니다.
const MAX_INPUT_DOCUMENTS: usize = 4096;
/// 기본 후보 문서 깊이입니다.
const DEFAULT_MAX_DOCUMENTS: usize = 64;
/// 후보 문서 깊이 하드 상한입니다.
const HARD_MAX_DOCUMENTS: usize = 1024;
/// 기본 채택 구절 수입니다.
const DEFAULT_MAX_PASSAGES: usize = 12;
/// 채택 구절 수 하드 상한입니다.
const HARD_MAX_PASSAGES: usize = 64;
/// 기본 인용 문자 예산입니다.
const DEFAULT_MAX_CHARS: usize = 262_144;
/// 인용 문자 예산 하드 상한입니다.
const HARD_MAX_CHARS: usize = 4 * 1024 * 1024;
/// 구절 창 반경(`UTF-8` byte)입니다.
const PASSAGE_RADIUS_BYTES: usize = 480;
/// 구절 앞뒤 문맥 최대 길이(`UTF-8` byte)입니다.
const PASSAGE_CONTEXT_BYTES: usize = 120;
/// 구절 하나가 가질 수 있는 강조 구간 수 상한입니다.
const MAX_HIGHLIGHTS: usize = 32;
/// `exact` 숫자·식별자 일치마다 더하는 가중치입니다.
const EXACT_SIGNAL_BONUS: f64 = 0.6;
/// 정확 구문 일치마다 더하는 가중치입니다.
const PHRASE_SIGNAL_BONUS: f64 = 0.8;
/// 부정 토큰이 구절 안에 있을 때 곱하는 감쇠입니다.
/// 문서 본문의 자연어 부정·예외 표현은 감지하지 않고 반례 근거를 그대로 보존합니다.
/// 계수는 합성 계약 테스트로만 고정하며 heldout 평가 전 정확도 개선으로 단정하지 않습니다.
const NEGATION_PENALTY_FACTOR: f64 = 0.5;
/// 후보 신호 `RRF`의 smoothing 상수입니다.
const CANDIDATE_RRF_K: f64 = 8.0;
/// 후보 RRF 점수를 문서 lexical 점수와 비교 가능한 범위로 끌어올리는 배율입니다.
const CANDIDATE_PRIOR_SCALE: f64 = 6.0;
/// 후보 prior 안에서 순위 `RRF` 성분이 차지하는 배분입니다.
const CANDIDATE_RRF_SHARE: f64 = 0.5;
/// 후보 prior 안에서 신호별 최고 점수 대비 비율 성분이 차지하는 배분입니다.
const CANDIDATE_SCORE_SHARE: f64 = 0.5;
/// 상위 후보 순위 상한입니다. 이 범위의 후보는 positive 매칭이 있으면 보존합니다.
const PROTECTED_CANDIDATE_RANK: usize = 16;
/// 접두 없는 일반 토큰의 title 필드 가중치입니다.
const TITLE_FIELD_WEIGHT: f64 = 0.55;
/// 접두 없는 일반 토큰의 path 필드 가중치입니다.
const PATH_FIELD_WEIGHT: f64 = 0.45;
/// 접두 없는 일반 토큰의 heading 필드 가중치입니다.
const HEADING_FIELD_WEIGHT: f64 = 0.5;
/// 접두 없는 일반 토큰의 tag 필드 가중치입니다.
const TAG_FIELD_WEIGHT: f64 = 0.35;
/// 접두 없는 일반 토큰의 alias 필드 가중치입니다.
const ALIASES_FIELD_WEIGHT: f64 = 0.5;
/// 접두 없는 일반 토큰의 code block 필드 가중치입니다.
const CODE_FIELD_WEIGHT: f64 = 0.4;
/// 명시 필드 접두(`title:`)가 맞을 때의 추가 가중치입니다.
const EXPLICIT_FIELD_BONUS: f64 = 1.5;
/// 같은 토큰이 여러 보조 필드에 겹칠 때 대표 필드 외 가중치에 곱하는 감쇠 계수입니다.
const SECONDARY_FIELD_DAMPING: f64 = 0.25;
/// 점수 분포와 무관하게 보존하는 최소 후보 깊이입니다.
const MIN_CANDIDATE_DEPTH: usize = 8;
/// 상위 점수 대비 후보 깊이를 정하는 비율입니다.
const CANDIDATE_DEPTH_RATIO: f64 = 0.5;
/// 병합 시 배치 내부 순위를 전역 순위로 완만하게 반영하는 `RRF` 상수입니다.
const MERGE_RRF_K: f64 = 60.0;
/// 검색 계획 facet query index의 wire 상한입니다.
const MAX_CANDIDATE_QUERY_INDEX: usize = 3;
/// 본문이 아니라 경로만 같은 문서를 근거로 인정하지 않는 규칙의 설명입니다.
/// 링크 목록 비중이 이 값보다 낮으면 색인 문서로 보지 않습니다.
const NAVIGATION_LINK_RATIO_FLOOR: f64 = 0.35;
/// 링크 목록 비중이 최대일 때 남길 점수 비율입니다.
const NAVIGATION_PENALTY: f64 = 0.5;
/// 질의의 텍스트 토큰을 하나도 담지 않고 숫자·식별자만 맞은 문서에 곱하는 감쇠입니다.
/// `51장`만 맞는 다른 책의 장들은 질의의 의미를 담지 않았습니다.
const NUMBER_ONLY_DEMOTION: f64 = 0.45;
/// 텍스트 토큰을 모두 담은 문서에 주는 추가 배율입니다.
const TEXT_COVERAGE_BONUS: f64 = 0.6;

/// 질의에서 파싱한 토큰 하나입니다.
struct QueryToken {
    /// 정규화된 토큰입니다.
    text: String,
    /// 질의 내 토큰 순번입니다.
    position: usize,
    /// 정확 구문 안 토큰이면 구문 index입니다.
    phrase_index: Option<usize>,
    /// `-`/`!` 접두가 붙었는지입니다.
    negated: bool,
    /// `term`/`number`/`identifier`/`quoted` 구분입니다.
    kind: &'static str,
    /// 식별자 run 전체를 정규화한 원자 비교 문자열입니다. 아니면 `None`입니다.
    atomic: Option<String>,
    /// `field:` 접두 또는 `body` 필드입니다.
    field: String,
    /// `field:` 접두가 명시됐는지입니다.
    explicit_field: bool,
}

/// 질의에서 파싱한 정확 구문입니다.
struct QueryPhrase {
    /// 소문자·단일 공백으로 정규화한 비교 문자열입니다.
    text: String,
    /// 부정 접두가 붙었는지입니다.
    negated: bool,
    /// 구문 필드입니다.
    field: String,
    /// 구문을 토큰화한 목록입니다.
    tokens: Vec<String>,
}

/// 문서 안 필드별 토큰 빈도입니다.
struct FieldFrequencies {
    /// 제목 토큰 빈도입니다.
    title: BTreeMap<String, usize>,
    /// 경로 토큰 빈도입니다(확장자 포함 원문 경로).
    path: BTreeMap<String, usize>,
    /// heading 토큰 빈도입니다.
    headings: BTreeMap<String, usize>,
    /// 태그 토큰 빈도입니다.
    tags: BTreeMap<String, usize>,
    /// 별칭(aliases) 토큰 빈도입니다.
    aliases: BTreeMap<String, usize>,
    /// 코드 블록 토큰 빈도입니다.
    code: BTreeMap<String, usize>,
}

/// 필드 빈도에 텍스트를 누적합니다.
fn add_field_text(target: &mut BTreeMap<String, usize>, text: &str) {
    for token in crate::tokenize(text) {
        *target.entry(token).or_default() += 1;
    }
}

/// 문자열 목록을 필드 빈도에 누적합니다.
fn add_field_values(target: &mut BTreeMap<String, usize>, values: &[String]) {
    for value in values {
        add_field_text(target, value);
    }
}

/// 경로의 basename에서 확장자를 제거한 제목을 만듭니다.
fn title_from_path(path: &str) -> String {
    let basename = path.rsplit('/').next().unwrap_or(path);
    basename
        .rsplit_once('.')
        .map_or(basename, |(stem, _)| stem)
        .to_owned()
}

impl FieldFrequencies {
    /// 문서 필드에서 빈도 지도를 만듭니다.
    fn new(
        path: &str,
        title: &str,
        headings: &[String],
        tags: &[String],
        aliases: &[String],
        code_blocks: &[String],
    ) -> Self {
        let mut fields = Self {
            title: BTreeMap::new(),
            path: BTreeMap::new(),
            headings: BTreeMap::new(),
            tags: BTreeMap::new(),
            aliases: BTreeMap::new(),
            code: BTreeMap::new(),
        };
        add_field_text(&mut fields.title, title);
        add_field_text(&mut fields.path, path);
        add_field_values(&mut fields.headings, headings);
        add_field_values(&mut fields.tags, tags);
        add_field_values(&mut fields.aliases, aliases);
        add_field_values(&mut fields.code, code_blocks);
        fields
    }

    /// 지정 필드의 빈도 지도입니다.
    fn get(&self, field: &str) -> &BTreeMap<String, usize> {
        match field {
            "title" => &self.title,
            "path" => &self.path,
            "heading" | "headings" => &self.headings,
            "tag" | "tags" => &self.tags,
            "alias" | "aliases" => &self.aliases,
            _ => &self.code,
        }
    }
}
/// 문서 안 토큰 위치 하나입니다.
struct TokenOccurrence {
    /// 정규화된 토큰입니다.
    token: String,
    /// 토큰이 시작한 `UTF-8` byte 위치입니다.
    byte_start: usize,
    /// 원문 토큰 run이 끝난 `UTF-8` byte 위치입니다.
    byte_end: usize,
}

/// 검증을 통과한 문서 입력입니다.
struct ScannedDocument {
    /// 볼트 상대 경로입니다.
    path: String,
    /// 색인 기록 리비전입니다.
    revision: Option<String>,
    /// 색인 포함 여부입니다.
    indexed: bool,
    /// `reviewed`/`unreviewed` 상태입니다.
    review_state: &'static str,
    /// 원문 본문입니다.
    text: String,
    /// 본문 첫 행의 절대 행 번호입니다.
    start_line: u64,
    /// 문서 태그입니다.
    tags: Vec<String>,
    /// 수정 시각(ms)입니다.
    modified_at: Option<u64>,
    /// 토큰 위치 목록입니다.
    occurrences: Vec<TokenOccurrence>,
    /// 토큰별 빈도입니다.
    frequencies: BTreeMap<String, usize>,
    /// 문서 필드(제목·경로·heading·태그·코드) 토큰 빈도입니다.
    field_frequencies: FieldFrequencies,
    /// 원자 식별자 대조용 필드 원문(소문자)입니다.
    field_texts: FieldTexts,
    /// 행 시작 `byte` 위치 목록입니다.
    line_starts: Vec<usize>,
}

/// 후보가 지목한 facet query와 실제 절대 행 범위입니다.
struct CandidateFacetRange {
    /// 검색 계획 facet query index입니다.
    query_index: usize,
    /// 후보가 지목한 시작 행입니다.
    start_line: u64,
    /// 후보가 지목한 끝 행입니다.
    end_line: u64,
}

/// 후보 신호(기존 hybrid 검색 결과)를 `path`별로 병합한 사전 점수입니다.
struct CandidatePrior {
    /// `RRF` 사전 점수입니다.
    prior: f64,
    /// 가장 좋은 후보 순위(1부터)입니다.
    best_rank: usize,
    /// 후보가 지목한 가장 이른 절대 행 번호입니다.
    start_line: Option<u64>,
    /// 이 경로에서 후보가 지목한 검색 facet별 행 범위입니다.
    query_ranges: Vec<CandidateFacetRange>,
    /// 행 범위가 없어도 비교 subject facet 후보임을 보존합니다.
    has_comparison_facet: bool,
}

/// 계획 입력에서 검증한 필터·예산·문서 묶음입니다.
struct PlanInput {
    /// 현재 질문입니다.
    question: String,
    /// 필터를 통과한 문서입니다.
    documents: Vec<ScannedDocument>,
    /// `path`별 후보 사전 점수입니다.
    candidates: BTreeMap<String, CandidatePrior>,
    /// 전체 색인 기준 검토 집계입니다.
    inventory: Option<InventoryCounts>,
    /// 후보 문서 깊이입니다.
    max_documents: usize,
    /// 채택 구절 수입니다.
    max_passages: usize,
    /// 인용 문자 예산입니다.
    max_chars: usize,
    /// 필터로 제외한 문서 수입니다.
    filtered_documents: usize,
}

/// 전체 색인 기준 검토 집계입니다.
struct InventoryCounts {
    /// 색인 문서 수입니다.
    indexed: usize,
    /// 미검토 문서 수입니다.
    unreviewed: usize,
    /// 미색인 문서 수입니다.
    not_indexed: usize,
}

/// 채택 구절의 출처·위치 표시입니다.
struct EvidenceRef {
    /// 호스트가 붙인 출처 id입니다.
    source_id: String,
    /// 볼트 상대 경로입니다.
    path: String,
    /// 색인 기록 리비전입니다.
    revision: Option<String>,
    /// 선택적 시작 행입니다.
    start_line: Option<u64>,
    /// 선택적 끝 행입니다.
    end_line: Option<u64>,
    /// 원문 인용입니다.
    quote: String,
}

/// 검증 입력 문서 하나입니다(청크 단위).
struct VerifyDocument {
    /// 볼트 상대 경로입니다.
    path: String,
    /// 색인 또는 원문 read 스냅샷 리비전입니다.
    revision: Option<String>,
    /// 이 청크의 원문 본문입니다.
    text: String,
    /// 청크 첫 행의 절대 행 번호입니다.
    start_line: u64,
    /// 색인 포함 여부입니다.
    indexed: bool,
    /// `reviewed`/`unreviewed` 상태입니다.
    review_state: &'static str,
    /// 이 청크 문서에 붙은 스코프입니다.
    scopes: Vec<String>,
}

/// 문서 하나에서 검증한 구절 상태입니다.
struct VerifiedQuote {
    /// 원문 포함 여부입니다.
    exists: bool,
    /// 행 일치 여부입니다. 시작 행이 없으면 `None`입니다.
    line_matches: Option<bool>,
    /// `match`/`mismatch`/`unknown` 리비전 상태입니다.
    revision_state: &'static str,
    /// `in-scope`/`out-of-scope`/`unknown` 스코프 상태입니다.
    scope_state: &'static str,
    /// `reviewed`/`unreviewed`/`not-indexed` 검토 상태입니다.
    review_state: &'static str,
}

/// 질의 관련 원문 구절·진단 계획을 결정적으로 계산합니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_indexed_evidence_json(input: &str) -> String {
    if input.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    let Some(value) = serde_json::from_str::<Value>(input).ok() else {
        return String::new();
    };
    plan_evidence(&value).map_or_else(String::new, |plan| plan.to_string())
}

/// 채택 구절의 원문 존재·위치·리비전·스코프·검토 상태를 결정적으로 검증합니다.
#[must_use]
#[wasm_bindgen]
pub fn verify_indexed_evidence_json(input: &str) -> String {
    if input.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    let Some(value) = serde_json::from_str::<Value>(input).ok() else {
        return String::new();
    };
    verify_evidence(&value).map_or_else(String::new, |report| report.to_string())
}

/// 볼트 상대 경로만 허용합니다.
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

/// `path`의 소문자 확장자를 반환합니다.
fn path_extension(path: &str) -> Option<String> {
    let (_, extension) = path.rsplit_once('.')?;
    (!extension.is_empty()).then(|| extension.to_lowercase())
}

/// `path`가 스코프 접두 안에 있는지 반환합니다.
fn path_in_scopes(path: &str, scopes: &[String]) -> bool {
    scopes.is_empty()
        || scopes.iter().any(|scope| {
            path == scope
                || path
                    .strip_prefix(scope)
                    .is_some_and(|tail| tail.starts_with('/'))
        })
}

/// 소문자·단일 공백·`NFC`로 구문 비교 문자열을 만듭니다.
fn normalize_phrase(text: &str) -> String {
    crate::normalize_nfc(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// 영문 `field:` 접두가 알려진 필드면 (필드명, 다음 위치)을 반환합니다.
fn read_field_prefix(characters: &[char], start: usize) -> Option<(String, usize)> {
    let mut cursor = start;
    while characters
        .get(cursor)
        .is_some_and(char::is_ascii_alphabetic)
    {
        cursor += 1;
    }
    if cursor == start || characters.get(cursor) != Some(&':') {
        return None;
    }
    let name = characters
        .get(start..cursor)?
        .iter()
        .collect::<String>()
        .to_lowercase();
    matches!(
        name.as_str(),
        "body" | "heading" | "title" | "path" | "tag" | "code" | "alias" | "aliases"
    )
    .then_some((name, cursor + 1))
}

/// 질의 run을 `term`/`number`/`identifier`로 분류합니다.
fn classify_query_run(run: &str) -> &'static str {
    let has_digit = run.chars().any(|character| character.is_ascii_digit());
    let has_ascii_alpha = run.chars().any(|character| character.is_ascii_alphabetic());
    let has_non_ascii_alpha = run
        .chars()
        .any(|character| character.is_alphabetic() && !character.is_ascii());
    let has_separator = run
        .chars()
        .any(|character| matches!(character, '_' | '-' | '/' | '\\' | '@' | '.'));
    if has_digit && !has_ascii_alpha && !has_non_ascii_alpha {
        "number"
    } else if !has_non_ascii_alpha && has_ascii_alpha && (has_digit || has_separator) {
        "identifier"
    } else {
        "term"
    }
}

/// 따옴표 구문 하나를 질의 토큰·구문으로 확장합니다.
fn push_phrase_tokens(
    tokens: &mut Vec<QueryToken>,
    phrases: &mut Vec<QueryPhrase>,
    raw: &str,
    negated: bool,
    field: &str,
    explicit_field: bool,
    position: &mut usize,
) {
    let phrase_tokens = crate::tokenize(raw);
    if phrase_tokens.is_empty() {
        return;
    }
    let phrase_index = phrases.len();
    phrases.push(QueryPhrase {
        text: normalize_phrase(raw),
        negated,
        field: field.to_owned(),
        tokens: phrase_tokens.clone(),
    });
    for token in phrase_tokens {
        tokens.push(QueryToken {
            text: token,
            position: *position,
            phrase_index: Some(phrase_index),
            negated,
            kind: "quoted",
            atomic: None,
            field: field.to_owned(),
            explicit_field,
        });
        *position = position.saturating_add(1);
    }
}

/// run 하나를 질의 토큰으로 확장합니다.
fn push_run_tokens(
    tokens: &mut Vec<QueryToken>,
    run: &str,
    negated: bool,
    field: &str,
    explicit_field: bool,
    position: &mut usize,
) {
    let kind = classify_query_run(run);
    // 식별자 run은 조각 토큰과 별개로 전체 문자열을 남겨 필드 원자 대조에 씁니다.
    let atomic = (kind == "identifier").then(|| crate::normalize_token(run));
    for token in crate::tokenize(run) {
        tokens.push(QueryToken {
            text: token,
            position: *position,
            phrase_index: None,
            negated,
            kind,
            atomic: atomic.clone(),
            field: field.to_owned(),
            explicit_field,
        });
        *position = position.saturating_add(1);
    }
}

/// 질의를 순서대로 스캔해 토큰·구문·부정·필드 신호를 만듭니다.
fn parse_query(question: &str) -> (Vec<QueryToken>, Vec<QueryPhrase>) {
    let characters = question.chars().collect::<Vec<char>>();
    let mut tokens = Vec::new();
    let mut phrases = Vec::new();
    let mut cursor = 0_usize;
    let mut position = 0_usize;

    while cursor < characters.len() {
        if characters
            .get(cursor)
            .is_some_and(|character| character.is_whitespace())
        {
            cursor += 1;
            continue;
        }
        let mut negated = false;
        if characters
            .get(cursor)
            .is_some_and(|character| matches!(character, '-' | '!'))
        {
            negated = true;
            cursor += 1;
        }
        let field_prefix = read_field_prefix(&characters, cursor);
        let explicit_field = field_prefix.is_some();
        let field = field_prefix
            .as_ref()
            .map_or_else(|| String::from("body"), |(name, _)| name.clone());
        if let Some((_, next)) = field_prefix {
            cursor = next;
        }
        let Some(&next_character) = characters.get(cursor) else {
            break;
        };
        if next_character == '"' {
            cursor += 1;
            let mut raw = String::new();
            while characters
                .get(cursor)
                .is_some_and(|character| *character != '"')
            {
                raw.push(characters.get(cursor).copied().unwrap_or('"'));
                cursor += 1;
            }
            if cursor < characters.len() {
                cursor += 1;
            }
            push_phrase_tokens(
                &mut tokens,
                &mut phrases,
                &raw,
                negated,
                &field,
                explicit_field,
                &mut position,
            );
            continue;
        }
        let run_start = cursor;
        while characters
            .get(cursor)
            .copied()
            .is_some_and(crate::is_token_part_character)
        {
            cursor += 1;
        }
        if run_start == cursor {
            cursor += 1;
            continue;
        }
        let run = characters
            .get(run_start..cursor)
            .map_or(String::new(), |slice| slice.iter().collect());
        push_run_tokens(
            &mut tokens,
            &run,
            negated,
            &field,
            explicit_field,
            &mut position,
        );
    }
    prune_function_words(&mut tokens);
    (tokens, phrases)
}

/// 한국어 의문사·지시사·접속사·계사·경량동사·화행동사입니다.
const KOREAN_FUNCTION_WORDS: &[&str] = &[
    "어느",
    "어떤",
    "어떻게",
    "어떻",
    "어디",
    "언제",
    "누구",
    "무엇",
    "왜",
    "서로",
    "그리고",
    "그런데",
    "하지만",
    "그러나",
    "그래서",
    "때문에",
    "위해",
    "통해",
    "대한",
    "대해",
    "관해",
    "관한",
    "설명",
    "설명해줘",
    "알려",
    "알려줘",
    "정리",
    "소개",
    "비교",
    "말해",
    "말하는",
    "말한다",
    "있는",
    "있다",
    "있어",
    "없어",
    "없다",
    "입니다",
    "습니다",
    "해줘",
    "해주세요",
    "같은",
    "같은지",
    "다르고",
    "다르게",
    "개념적으로",
    "내용",
    "의미",
];

/// 일반 검색어와 함께 쓰였을 때 변별력이 낮은 기능어인지 반환합니다.
fn is_function_word(token: &str) -> bool {
    matches!(
        token,
        "a" | "am"
            | "an"
            | "and"
            | "are"
            | "as"
            | "at"
            | "be"
            | "been"
            | "being"
            | "but"
            | "by"
            | "can"
            | "could"
            | "did"
            | "do"
            | "does"
            | "for"
            | "from"
            | "had"
            | "has"
            | "have"
            | "he"
            | "her"
            | "hers"
            | "him"
            | "his"
            | "how"
            | "i"
            | "if"
            | "in"
            | "into"
            | "is"
            | "it"
            | "its"
            | "may"
            | "me"
            | "might"
            | "my"
            | "of"
            | "on"
            | "onto"
            | "or"
            | "our"
            | "over"
            | "she"
            | "should"
            | "than"
            | "that"
            | "the"
            | "their"
            | "them"
            | "then"
            | "these"
            | "they"
            | "this"
            | "those"
            | "to"
            | "was"
            | "we"
            | "were"
            | "what"
            | "when"
            | "where"
            | "which"
            | "who"
            | "whom"
            | "whose"
            | "why"
            | "will"
            | "with"
            | "within"
            | "without"
            | "would"
            | "you"
            | "your"
    ) || KOREAN_FUNCTION_WORDS.contains(&token)
}

/// 기능어·파편 제거 뒤에도 남겨야 하는 토큰인지 반환합니다.
fn is_preserved_token(token: &QueryToken) -> bool {
    token.negated
        || token.phrase_index.is_some()
        || token.explicit_field
        || matches!(token.kind, "number" | "identifier")
}

/// 다른 보존 토큰의 진부분 문자열인 `n-gram` 파편인지 반환합니다.
fn is_token_fragment(text: &str, tokens: &[QueryToken]) -> bool {
    tokens
        .iter()
        .any(|other| other.text.len() > text.len() && other.text.contains(text))
}

/// 내용어가 있는 질의에서만 변별력 없는 비인용 기능어와 `n-gram` 파편을 제거합니다.
///
/// `the`처럼 기능어만 검색한 경우에는 사용자가 그 단어 자체를 찾는
/// Ctrl-F식 검색일 수 있으므로 그대로 보존합니다.
fn prune_function_words(tokens: &mut Vec<QueryToken>) {
    let has_content = tokens.iter().any(|token| {
        (is_preserved_token(token) || !is_function_word(&token.text))
            && !is_token_fragment(&token.text, tokens)
    });
    if !has_content {
        return;
    }
    tokens.retain(|token| is_preserved_token(token) || !is_function_word(&token.text));
    let kept = tokens
        .iter()
        .map(|token| token.text.clone())
        .collect::<Vec<_>>();
    tokens.retain(|token| {
        is_preserved_token(token)
            || !kept
                .iter()
                .any(|text| text.len() > token.text.len() && text.contains(&token.text))
    });
}

/// 문서 본문에서 토큰 위치·빈도·행 시작점을 수집합니다.
fn scan_document(
    text: &str,
    start_line: u64,
) -> (Vec<TokenOccurrence>, BTreeMap<String, usize>, Vec<usize>) {
    let mut occurrences = Vec::new();
    let mut frequencies = BTreeMap::<String, usize>::new();
    let mut line_starts = vec![0_usize];
    let mut run = String::new();
    let mut run_start = 0_usize;
    let mut line = start_line;

    for (index, character) in text.char_indices() {
        if character == '\n' {
            if !run.is_empty() {
                push_occurrences(&run, run_start, &mut occurrences, &mut frequencies);
                run.clear();
            }
            line = line.saturating_add(1);
            line_starts.push(index.saturating_add(1));
            continue;
        }
        if crate::is_token_part_character(character) {
            if run.is_empty() {
                run_start = index;
            }
            run.push(character);
        } else if !run.is_empty() {
            push_occurrences(&run, run_start, &mut occurrences, &mut frequencies);
            run.clear();
        }
    }
    if !run.is_empty() {
        push_occurrences(&run, run_start, &mut occurrences, &mut frequencies);
    }
    (occurrences, frequencies, line_starts)
}

/// 하나의 run을 토큰 위치로 확장해 등록합니다.
fn push_occurrences(
    run: &str,
    byte_start: usize,
    occurrences: &mut Vec<TokenOccurrence>,
    frequencies: &mut BTreeMap<String, usize>,
) {
    for token in crate::tokenize(run) {
        *frequencies.entry(token.clone()).or_default() += 1;
        occurrences.push(TokenOccurrence {
            token,
            byte_start,
            byte_end: byte_start.saturating_add(run.len()),
        });
    }
}

/// `byte` 위치를 감싸는 `char` 경계로 내립니다.
fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut cursor = index.min(text.len());
    while cursor > 0 && !text.is_char_boundary(cursor) {
        cursor -= 1;
    }
    cursor
}

/// `byte` 위치를 감싸는 `char` 경계로 올립니다.
fn ceil_char_boundary(text: &str, index: usize) -> usize {
    let mut cursor = index.min(text.len());
    while cursor < text.len() && !text.is_char_boundary(cursor) {
        cursor += 1;
    }
    cursor
}

/// 문서 안 `byte` 위치의 절대 행 번호를 계산합니다.
fn line_of(text: &str, start_line: u64, index: usize) -> u64 {
    let precedent = text
        .get(..floor_char_boundary(text, index))
        .map_or(0_u64, |prefix| {
            u64::try_from(prefix.bytes().filter(|byte| *byte == b'\n').count()).unwrap_or(u64::MAX)
        });
    start_line.saturating_add(precedent)
}

/// 후보 신호 종류별 `RRF` 가중치입니다.
fn candidate_source_weight(source: &str) -> f64 {
    match source {
        "bm25" | "lexical" | "vector" => 1.0,
        "ann" => 0.9,
        "structural" => 0.6,
        _ => 0.5,
    }
}

/// `JSON` 값이 없으면 빈 문자열 배열로, 있으면 검증해 반환합니다.
fn optional_string_array(value: Option<&Value>) -> Option<Vec<String>> {
    let Some(item) = value else {
        return Some(Vec::new());
    };
    let array = item.as_array()?;
    array
        .iter()
        .map(|entry| entry.as_str().map(str::to_owned))
        .collect()
}

/// 선택 문자열 필드를 검증하고 읽습니다.
fn read_optional_string(value: Option<&Value>) -> Result<Option<String>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(item) => item.as_str().map(|text| Some(text.to_owned())).ok_or(()),
    }
}

/// 선택 `bool` 필드를 기본값과 함께 검증합니다.
fn optional_bool_value(value: Option<&Value>, default: bool) -> Option<bool> {
    match value {
        None | Some(Value::Null) => Some(default),
        Some(item) => item.as_bool(),
    }
}

/// 선택 개수 필드(문서 수·문자 예산 같은)를 `usize`로 검증하고 읽습니다.
fn read_optional_usize(value: Option<&Value>) -> Result<Option<usize>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(item) => item
            .as_u64()
            .and_then(|raw| usize::try_from(raw).ok())
            .map(Some)
            .ok_or(()),
    }
}

/// 선택 타임스탬프 필드(ms epoch)를 `u64`로 검증하고 읽습니다.
/// wasm32의 `usize`(u32) 폭에 묶이지 않아 ms epoch를 그대로 받습니다.
/// 음수·소수·문자열·`u64` 초과 값은 `Err`로 거절합니다.
fn read_optional_timestamp(value: Option<&Value>) -> Result<Option<u64>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(item) => item.as_u64().map(Some).ok_or(()),
    }
}

/// 질의 토큰에서 긍정 토큰 집합을 만듭니다.
fn positive_terms(tokens: &[QueryToken]) -> BTreeSet<String> {
    tokens
        .iter()
        .filter(|token| !token.negated)
        .map(|token| token.text.clone())
        .collect()
}

/// 질의 토큰에서 부정 토큰 집합을 만듭니다.
fn negated_terms(tokens: &[QueryToken]) -> BTreeSet<String> {
    tokens
        .iter()
        .filter(|token| token.negated)
        .map(|token| token.text.clone())
        .collect()
}

/// 긍정 토큰별 `exact` 신호 종류를 모읍니다.
fn term_kinds(tokens: &[QueryToken]) -> BTreeMap<String, &'static str> {
    let mut kinds = BTreeMap::new();
    for token in tokens.iter().filter(|token| !token.negated) {
        let entry = kinds.entry(token.text.clone()).or_insert("term");
        let priority = |kind: &str| match kind {
            "number" => 2_u8,
            "identifier" => 1_u8,
            _ => 0_u8,
        };
        if priority(token.kind) > priority(entry) {
            *entry = token.kind;
        }
    }
    kinds
}

/// 문서 배치 안에서 용어별 `IDF`와 평균 문서 길이를 계산합니다.
fn batch_statistics(
    documents: &[ScannedDocument],
    terms: &BTreeSet<String>,
) -> Option<(BTreeMap<String, f64>, f64)> {
    let document_count = crate::usize_to_f64(documents.len())?.max(1.0);
    let mut total_length = 0_usize;
    for document in documents {
        total_length = total_length.checked_add(document.occurrences.len())?;
    }
    let average_length = (crate::usize_to_f64(total_length)?.max(1.0)) / document_count;
    let mut idf = BTreeMap::new();
    for term in terms {
        let frequency = documents
            .iter()
            .filter(|document| document.frequencies.contains_key(term))
            .count();
        let frequency = crate::usize_to_f64(frequency)?;
        idf.insert(
            term.clone(),
            ((document_count - frequency + 0.5) / (frequency + 0.5)).ln_1p(),
        );
    }
    Some((idf, average_length.max(1.0)))
}

/// 문서 하나의 `lexical` 점수·일치 용어·`exact`·필드 신호입니다.
struct DocumentScore {
    /// 최종 문서 점수입니다.
    score: f64,
    /// 일치한 긍정 용어입니다.
    matched: BTreeSet<String>,
    /// 일치한 `number`/`identifier` 종류입니다.
    exact: BTreeSet<String>,
    /// 필드 일치 가중치 합입니다.
    field_score: f64,
    /// 일치한 보조 필드 이름입니다.
    field_matches: BTreeSet<String>,
}

/// 긍정 토큰별 허용 필드 집합을 만듭니다.
///
/// 접두 없는 토큰은 본문과 보조 필드를 모두 허용하고, `field:` 접두가 있으면
/// 그 필드에서만 매칭합니다.
fn allowed_fields(tokens: &[QueryToken]) -> BTreeMap<String, BTreeSet<String>> {
    let mut allowed = BTreeMap::new();
    for token in tokens.iter().filter(|token| !token.negated) {
        let entry = allowed
            .entry(token.text.clone())
            .or_insert_with(BTreeSet::new);
        if token.explicit_field {
            entry.insert(token.field.clone());
        } else {
            entry.insert("body".to_owned());
            for field in ["title", "path", "heading", "tag", "alias"] {
                entry.insert(field.to_owned());
            }
        }
    }
    allowed
}

/// 긍정 토큰별 질의 식별자 원자 문자열을 모읍니다.
fn atomic_identifiers(tokens: &[QueryToken]) -> BTreeMap<String, BTreeSet<String>> {
    let mut map = BTreeMap::<String, BTreeSet<String>>::new();
    for token in tokens.iter().filter(|token| !token.negated) {
        let Some(atomic) = token.atomic.as_ref() else {
            continue;
        };
        map.entry(token.text.clone())
            .or_default()
            .insert(atomic.clone());
    }
    map
}

/// 원자 식별자 존재를 대조할 필드 원문(소문자)입니다.
struct FieldTexts {
    /// 제목 원문입니다.
    title: String,
    /// 경로 원문입니다.
    path: String,
    /// 경로의 마지막 조각(파일명) 원문입니다. 노트 이름은 제목과 같은 정보로 다롑니다.
    basename: String,
    /// heading 원문입니다.
    headings: String,
    /// 태그 원문입니다.
    tags: String,
    /// 별칭(aliases) 원문입니다.
    aliases: String,
    /// 코드 블록 원문입니다.
    code: String,
}

impl FieldTexts {
    /// 문서 필드 원문을 소문자로 보존합니다.
    fn new(
        path: &str,
        title: &str,
        headings: &[String],
        tags: &[String],
        aliases: &[String],
        code_blocks: &[String],
    ) -> Self {
        Self {
            title: title.to_lowercase(),
            path: path.to_lowercase(),
            basename: path.rsplit('/').next().unwrap_or(path).to_lowercase(),
            headings: headings.join("\n").to_lowercase(),
            tags: tags.join("\n").to_lowercase(),
            aliases: aliases.join("\n").to_lowercase(),
            code: code_blocks.join("\n").to_lowercase(),
        }
    }

    /// 지정 필드의 원문입니다.
    fn get(&self, field: &str) -> &str {
        match field {
            "title" => &self.title,
            "path" => &self.path,
            "heading" | "headings" => &self.headings,
            "tag" | "tags" => &self.tags,
            "alias" | "aliases" => &self.aliases,
            _ => &self.code,
        }
    }
}

/// `needle`이 `haystack` 안에서 영숫자 경계에 둘러싸여 통째로 나타나는지 반환합니다.
///
/// 식별자 조각이 더 긴 토큰에 섞여 있는 경우를 원자 일치로 보지 않기 위해
/// 앞뒤 문자도 함께 확인합니다.
fn contains_atomic_identifier(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut cursor = 0;
    while let Some(offset) = haystack.get(cursor..).and_then(|rest| rest.find(needle)) {
        let start = cursor.saturating_add(offset);
        let end = start.saturating_add(needle.len());
        let before = haystack
            .get(..start)
            .and_then(|prefix| prefix.chars().next_back());
        let after = haystack.get(end..).and_then(|suffix| suffix.chars().next());
        let boundary =
            |character: Option<char>| character.is_none_or(|item| !item.is_alphanumeric());
        if boundary(before) && boundary(after) {
            return true;
        }
        cursor = end;
    }
    false
}

/// 보조 필드 이름에 해당하는 가중치입니다.
fn field_weight(field: &str) -> f64 {
    match field {
        "title" => TITLE_FIELD_WEIGHT,
        "path" => PATH_FIELD_WEIGHT,
        "heading" | "headings" => HEADING_FIELD_WEIGHT,
        "tag" | "tags" => TAG_FIELD_WEIGHT,
        "alias" | "aliases" => ALIASES_FIELD_WEIGHT,
        "code" => CODE_FIELD_WEIGHT,
        _ => 0.0,
    }
}

/// 보조 필드 원문에 이 토큰의 원자 식별자 run이 통째로 들어 있는지 반환합니다.
fn atomic_identifier_in_field(
    document: &ScannedDocument,
    term: &str,
    field: &str,
    atomic: &BTreeMap<String, BTreeSet<String>>,
) -> bool {
    atomic.get(term).is_some_and(|atoms| {
        atoms.contains(term)
            && atoms
                .iter()
                .any(|atom| contains_atomic_identifier(document.field_texts.get(field), atom))
    })
}

/// 문서 하나의 `BM25`·필드·`exact`·후보 사전 점수를 계산합니다.
fn score_document(
    document: &ScannedDocument,
    allowed: &BTreeMap<String, BTreeSet<String>>,
    kinds: &BTreeMap<String, &'static str>,
    atomic: &BTreeMap<String, BTreeSet<String>>,
    statistics: &(BTreeMap<String, f64>, f64),
    prior: f64,
) -> DocumentScore {
    let (idf, average_length) = statistics;
    let document_length = crate::usize_to_f64(document.occurrences.len())
        .unwrap_or(1.0)
        .max(1.0);
    let mut score = prior;
    let mut matched = BTreeSet::new();
    let mut exact = BTreeSet::new();
    let mut field_score = 0.0;
    let mut field_matches = BTreeSet::new();
    let mut has_text_evidence = false;
    let mut text_terms_matched = 0_usize;
    let mut body_numeric_matched = false;
    let total_text_terms = allowed
        .iter()
        .filter(|(term, _)| idf.contains_key(*term) && !is_atomic_kind(kinds.get(*term).copied()))
        .count();
    for (term, fields) in allowed {
        let Some(&term_idf) = idf.get(term) else {
            continue;
        };
        let body_frequency = document.frequencies.get(term).copied().unwrap_or(0);
        let body_matched = fields.contains("body") && body_frequency > 0;
        if body_matched {
            has_text_evidence = true;
            body_numeric_matched |= is_atomic_kind(kinds.get(term).copied());
            let frequency = crate::usize_to_f64(body_frequency).unwrap_or(0.0);
            score += crate::bm25_score_value(term_idf, frequency, document_length, *average_length);
        }
        let bonus = term_field_bonus(document, term, fields, atomic, term_idf);
        let term_matched = body_matched || bonus.best > 0.0;
        if term_matched {
            let field_add = SECONDARY_FIELD_DAMPING.mul_add(bonus.secondary, bonus.best);
            score += field_add;
            field_score += field_add;
            matched.insert(term.clone());
            if is_atomic_kind(kinds.get(term).copied()) {
                score += EXACT_SIGNAL_BONUS;
                exact.insert(kinds.get(term).copied().unwrap_or("number").to_owned());
            }
        }
        // 경로 일치는 디렉터리 이름만 같아도 생깁니다. 파일명(노트 이름)에 들어 있는
        // 토큰은 제목과 같은 비중의 본문성 신호로 다룹니다. 본문·제목·헤딩 등이 전혀
        // 맞지 않고 경로의 숫자·식별자도 없으면, 같은 디렉터리에 있다는 이유만으로
        // 후보가 된 문서이므로 근거에서 제외합니다.
        let basename_atomic = is_atomic_kind(kinds.get(term).copied())
            && document.field_texts.basename.contains(term.as_str());
        if body_matched || bonus.text_field_matched || basename_atomic {
            has_text_evidence = true;
        }
        field_matches.extend(bonus.fields);
        if term_matched && !is_atomic_kind(kinds.get(term).copied()) {
            text_terms_matched = text_terms_matched.saturating_add(1);
        }
    }
    finalize_score(
        DocumentScore {
            score,
            matched,
            exact,
            field_score,
            field_matches,
        },
        prior,
        &MatchCoverage {
            has_text_evidence,
            text_terms_matched,
            body_numeric_matched,
            total_text_terms,
        },
        &document.text,
    )
}

/// 숫자·식별자 kind인지 반환합니다.
fn is_atomic_kind(kind: Option<&'static str>) -> bool {
    matches!(kind, Some("number" | "identifier"))
}

/// 한 토큰의 보조 필드 가중 보너스입니다.
struct FieldBonus {
    /// 대표 필드 보너스입니다.
    best: f64,
    /// 보조 필드 보너스 합입니다.
    secondary: f64,
    /// 본문성 필드(제목·헤딩·태그·별칭·파일명)에서 맞았는지 여부입니다.
    text_field_matched: bool,
    /// 일치한 필드 이름입니다.
    fields: Vec<String>,
}

/// 한 토큰의 보조 필드 가중 보너스를 계산합니다.
fn term_field_bonus(
    document: &ScannedDocument,
    term: &str,
    fields: &BTreeSet<String>,
    atomic: &BTreeMap<String, BTreeSet<String>>,
    term_idf: f64,
) -> FieldBonus {
    let explicit = fields.len() == 1 && !fields.contains("body");
    let mut bonus = FieldBonus {
        best: 0.0,
        secondary: 0.0,
        text_field_matched: false,
        fields: Vec::new(),
    };
    for field in fields.iter().filter(|field| field.as_str() != "body") {
        let mut frequency = document
            .field_frequencies
            .get(field)
            .get(term)
            .copied()
            .unwrap_or(0);
        if atomic_identifier_in_field(document, term, field, atomic) {
            frequency = frequency.max(1);
        }
        if frequency == 0 {
            continue;
        }
        let weight = field_weight(field);
        let weight = if weight <= 0.0 { 0.2 } else { weight };
        let weight = if explicit {
            weight * (1.0 + EXPLICIT_FIELD_BONUS)
        } else {
            weight
        };
        let extra = crate::usize_to_f64(frequency.saturating_sub(1))
            .unwrap_or(0.0)
            .ln_1p();
        let value = term_idf * weight * (1.0 + extra);
        if value > bonus.best {
            bonus.secondary += bonus.best;
            bonus.best = value;
        } else {
            bonus.secondary += value;
        }
        bonus.fields.push(field.clone());
        if field.as_str() != "path" || document.field_texts.basename.contains(term) {
            bonus.text_field_matched = true;
        }
    }
    bonus
}

/// 본문 근거가 없는 문서를 걸러 내고, 일치 범위·링크 목록 감쇠를 적용합니다.
///
/// 경로만 같은 문서는 디렉터리 소속만으로 근거가 될 수 없고, 링크 목록은
/// 안내 문서이며, 숫자만 맞은 문서는 질의의 의미를 담지 않았습니다.
fn finalize_score(
    mut score: DocumentScore,
    prior: f64,
    coverage: &MatchCoverage,
    text: &str,
) -> DocumentScore {
    if !coverage.has_text_evidence {
        score.matched.clear();
        score.field_matches.clear();
        score.exact.clear();
        score.field_score = 0.0;
        score.score = prior;
    }
    // 본문에 숫자만 있고 질의의 텍스트 토큰이 없는 문서는, 다른 책의 같은 번호
    // 장처럼 이름만 겹친 경우입니다. 다만 본문이 그 숫자를 실제로 다루면(교차 언어
    // 질의의 `51`처럼) 감쇠하지 않습니다.
    if coverage.text_terms_matched == 0
        && coverage.total_text_terms > 0
        && !coverage.body_numeric_matched
    {
        score.score *= NUMBER_ONLY_DEMOTION;
    }
    if coverage.total_text_terms > 0 {
        let covered =
            crate::usize_to_f64(coverage.text_terms_matched.min(coverage.total_text_terms))
                .unwrap_or(0.0)
                / crate::usize_to_f64(coverage.total_text_terms).unwrap_or(1.0);
        score.score *= TEXT_COVERAGE_BONUS.mul_add(covered, 1.0);
    }
    let navigation = navigation_factor(text);
    score.score *= navigation;
    score.field_score *= navigation;
    score
}

/// 질의 토큰을 얼마나 넓게 담았는지 나타내는 신호입니다.
struct MatchCoverage {
    /// 본문·제목 등 텍스트 근거가 있는지 여부입니다.
    has_text_evidence: bool,
    /// 일치한 텍스트 토큰 수입니다.
    text_terms_matched: usize,
    /// 본문에서 숫자·식별자 토큰이 맞았는지 여부입니다.
    body_numeric_matched: bool,
    /// 질의의 텍스트 토큰 수입니다.
    total_text_terms: usize,
}

/// 링크 목록(목차·색인) 비중에 따른 감쇠 계수입니다.
///
/// 이런 문서는 다른 문서를 안내할 뿐 근거가 아니므로, 링크만 있는 줄의 비율이
/// 높을수록 점수를 낮춥니다.
fn navigation_factor(text: &str) -> f64 {
    let mut total = 0_usize;
    let mut linked = 0_usize;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        total = total.saturating_add(1);
        if !trimmed.contains("[[") {
            continue;
        }
        let is_link_line = trimmed.starts_with("[[")
            || (trimmed.starts_with('-') || trimmed.starts_with('*') || trimmed.starts_with('|'))
                && trimmed.contains("[[");
        if is_link_line {
            linked = linked.saturating_add(1);
        }
    }
    if total == 0 {
        return 1.0;
    }
    let ratio =
        crate::usize_to_f64(linked).unwrap_or(0.0) / crate::usize_to_f64(total).unwrap_or(1.0);
    if ratio <= NAVIGATION_LINK_RATIO_FLOOR {
        return 1.0;
    }
    let excess = (ratio - NAVIGATION_LINK_RATIO_FLOOR) / (1.0 - NAVIGATION_LINK_RATIO_FLOOR);
    NAVIGATION_PENALTY.mul_add(excess, 1.0 - NAVIGATION_PENALTY)
}

/// 문서에서 긍정 구문이 처음 나타난 `byte` 위치 목록입니다.
fn phrase_hit_offsets(document: &ScannedDocument, phrases: &[QueryPhrase]) -> Vec<usize> {
    let haystack = document.text.to_lowercase();
    phrases
        .iter()
        .filter(|phrase| !phrase.negated && !phrase.text.is_empty())
        .filter_map(|phrase| haystack.find(&phrase.text))
        .collect()
}

/// 후보가 지목한 절대 행 번호를 문서 안 `byte` 위치로 바꿉니다.
fn candidate_start_byte(document: &ScannedDocument, candidate_line: u64) -> Option<usize> {
    let offset = candidate_line.checked_sub(document.start_line)?;
    let index = usize::try_from(offset).ok()?;
    document.line_starts.get(index).copied()
}

/// 정확 구문을 우선하고, 반복 빈도 대신 구절 안의 서로 다른 질의어 수를 최대화합니다.
fn select_anchor(
    document: &ScannedDocument,
    matched: &BTreeSet<String>,
    phrase_offsets: &[usize],
    candidate_start: Option<usize>,
) -> Option<usize> {
    if let Some(offset) = phrase_offsets.iter().min() {
        return Some(*offset);
    }
    let positions = document
        .occurrences
        .iter()
        .filter(|occurrence| matched.contains(&occurrence.token))
        .collect::<Vec<_>>();
    let mut anchor = candidate_start;
    let mut counts = BTreeMap::<&str, usize>::new();
    let mut left = 0;
    let mut best_count = 0;
    let mut best_span = usize::MAX;
    for (right, occurrence) in positions.iter().enumerate() {
        *counts.entry(&occurrence.token).or_default() += 1;
        while left < right {
            let first = positions.get(left)?;
            let span = occurrence.byte_end.saturating_sub(first.byte_start);
            let repeated = counts.get(first.token.as_str()).copied().unwrap_or(0) > 1;
            if span <= PASSAGE_RADIUS_BYTES.saturating_mul(2) && !repeated {
                break;
            }
            if let Some(count) = counts.get_mut(first.token.as_str()) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    counts.remove(first.token.as_str());
                }
            }
            left = left.saturating_add(1);
        }
        let start = positions.get(left)?.byte_start;
        let span = occurrence.byte_end.saturating_sub(start);
        let center = start.saturating_add(span.div_euclid(2));
        let nearer_candidate = candidate_start.is_some_and(|candidate| {
            center.abs_diff(candidate) < anchor.unwrap_or(candidate).abs_diff(candidate)
        });
        if counts.len() > best_count
            || (counts.len() == best_count
                && (span < best_span || (span == best_span && nearer_candidate)))
        {
            anchor = Some(center);
            best_count = counts.len();
            best_span = span;
        }
    }
    anchor
}

/// 원문 구절 초안입니다.
struct PassageDraft {
    /// 볼트 상대 경로입니다.
    path: String,
    /// 문서 리비전입니다.
    revision: Option<String>,
    /// 구절 시작 행입니다.
    start_line: u64,
    /// 구절 끝 행입니다.
    end_line: u64,
    /// 원문 인용입니다.
    quote: String,
    /// 앞 문맥입니다.
    context_before: String,
    /// 뒤 문맥입니다.
    context_after: String,
    /// 최종 점수입니다.
    score: f64,
    /// 신호 요약입니다.
    signal: String,
    /// 일치한 정확 구문 수입니다.
    phrase_matches: usize,
    /// 부정 토큰이 구절 근처에 있는지입니다.
    negated_nearby: bool,
    /// `exact` 신호 목록입니다.
    exact: BTreeSet<String>,
    /// quote 기준 `UTF-16` 강조 구간입니다.
    highlights: Vec<(usize, usize)>,
    /// 필드 일치 가중치 합입니다.
    field_score: f64,
    /// 일치한 필드 이름입니다.
    field_matches: BTreeSet<String>,
    /// 긍정 질의 토큰이 하나 이상 매칭됐는지입니다.
    matched: bool,
    /// 후보 신호의 가장 좋은 순위(없으면 `usize::MAX`)입니다.
    candidate_rank: usize,
    /// 이 구절을 지목한 검색 facet query index 합집합입니다.
    query_indexes: BTreeSet<usize>,
}
/// 원문 구절을 만들고 `phrase`·부정 신호를 반영합니다.
fn build_passage(
    document: &ScannedDocument,
    anchor: usize,
    score: &DocumentScore,
    prior: f64,
    phrases: &[QueryPhrase],
    negated: &BTreeSet<String>,
) -> PassageDraft {
    let start = floor_char_boundary(&document.text, anchor.saturating_sub(PASSAGE_RADIUS_BYTES));
    let end = ceil_char_boundary(&document.text, anchor.saturating_add(PASSAGE_RADIUS_BYTES));
    let quote = document.text.get(start..end).unwrap_or_default().to_owned();
    let context_before = document
        .text
        .get(
            floor_char_boundary(&document.text, start.saturating_sub(PASSAGE_CONTEXT_BYTES))..start,
        )
        .unwrap_or_default()
        .to_owned();
    let context_after = document
        .text
        .get(end..ceil_char_boundary(&document.text, end.saturating_add(PASSAGE_CONTEXT_BYTES)))
        .unwrap_or_default()
        .to_owned();
    let lowered = quote.to_lowercase();
    let normalized_quote = normalize_phrase(&quote);
    let mut needles = score.matched.iter().cloned().collect::<Vec<_>>();
    needles.extend(
        phrases
            .iter()
            .filter(|phrase| !phrase.negated && !phrase.text.is_empty())
            .map(|phrase| phrase.text.clone()),
    );
    let highlights = highlight_ranges(&lowered, &needles);
    let phrase_matches = phrases
        .iter()
        .filter(|phrase| {
            !phrase.negated && !phrase.text.is_empty() && normalized_quote.contains(&phrase.text)
        })
        .count();
    let negated_phrase = phrases.iter().any(|phrase| {
        phrase.negated && !phrase.text.is_empty() && normalized_quote.contains(&phrase.text)
    });
    let negated_token = document.occurrences.iter().any(|occurrence| {
        negated.contains(&occurrence.token)
            && occurrence.byte_start >= start
            && occurrence.byte_start < end
    });
    let negated_nearby = negated_phrase || negated_token;
    let phrase_weight = crate::usize_to_f64(phrase_matches).unwrap_or(0.0);
    let mut final_score = phrase_weight.mul_add(PHRASE_SIGNAL_BONUS, score.score);
    if negated_nearby {
        final_score *= NEGATION_PENALTY_FACTOR;
    }
    let mut components = vec!["lexical"];
    if phrase_matches > 0 {
        components.push("phrase");
    }
    if !score.exact.is_empty() {
        components.push("exact");
    }
    if prior > 0.0 {
        components.push("candidate");
    }
    PassageDraft {
        path: document.path.clone(),
        revision: document.revision.clone(),
        start_line: line_of(&document.text, document.start_line, start),
        end_line: line_of(
            &document.text,
            document.start_line,
            end.saturating_sub(1).max(start),
        ),
        quote,
        context_before,
        context_after,
        score: final_score,
        signal: components.join("+"),
        phrase_matches,
        negated_nearby,
        exact: score.exact.clone(),
        field_score: score.field_score,
        matched: !score.matched.is_empty(),
        candidate_rank: usize::MAX,
        query_indexes: BTreeSet::new(),
        field_matches: score.field_matches.clone(),
        highlights,
    }
}

/// 점수 분포와 매칭 보호를 함께 반영해 후보 깊이를 정합니다.
///
/// 긍정 토큰이 하나 이상 매칭된 문서는 적응 임계로 탈락시키지 않고,
/// 상위 후보 순위 안의 매칭 문서도 보존합니다.
fn candidate_depth(drafts: &[PassageDraft], max_documents: usize, max_passages: usize) -> usize {
    if drafts.is_empty() {
        return 0;
    }
    let top = drafts.first().map_or(0.0, |draft| draft.score);
    let threshold = top * CANDIDATE_DEPTH_RATIO;
    let adaptive = drafts
        .iter()
        .take_while(|draft| draft.score >= threshold)
        .count()
        .max(MIN_CANDIDATE_DEPTH);
    let matched = drafts.iter().filter(|draft| draft.matched).count();
    let protected = drafts
        .iter()
        .filter(|draft| {
            draft.matched
                && draft.candidate_rank != usize::MAX
                && draft.candidate_rank <= PROTECTED_CANDIDATE_RANK
        })
        .count();
    let mut facet_indexes = BTreeSet::new();
    let mut facet_depth = 0;
    for (index, draft) in drafts.iter().enumerate() {
        for query_index in draft.query_indexes.iter().filter(|index| **index > 0) {
            if facet_indexes.len() >= max_passages {
                break;
            }
            if facet_indexes.insert(*query_index) {
                facet_depth = index.saturating_add(1);
            }
        }
        if facet_indexes.len() >= max_passages {
            break;
        }
    }
    adaptive
        .max(matched)
        .max(protected)
        .max(facet_depth)
        .min(max_documents)
        .min(drafts.len())
}

/// 후보 신호 `path`별 병합 상태입니다.
struct CandidateSourceBest {
    /// 신호 안에서 가장 좋은 순위입니다.
    rank: usize,
    /// 신호가 지목한 절대 시작 행입니다.
    start_line: Option<u64>,
    /// 신호가 제공한 가장 높은 점수입니다.
    score: Option<f64>,
}

/// 후보 순위 `RRF`와 신호별 최고 점수 대비 비율을 섞은 prior 배분입니다.
///
/// 신호가 점수를 주지 않으면 기존처럼 순위 `RRF`만 씁니다.
fn candidate_prior_share(rank: f64, score: Option<f64>, source_best: Option<f64>) -> f64 {
    let rrf = 1.0 / (CANDIDATE_RRF_K + rank);
    let Some(best) = source_best.filter(|best| best.is_finite() && *best > 0.0) else {
        return rrf;
    };
    let ratio = score
        .filter(|score| score.is_finite())
        .map_or(0.0, |score| (score / best).clamp(0.0, 1.0));
    CANDIDATE_RRF_SHARE.mul_add(rrf, CANDIDATE_SCORE_SHARE * ratio)
}

/// 후보 queryIndex를 검증합니다.
fn candidate_query_index(entry: &Value) -> Result<Option<usize>, ()> {
    match entry.get("queryIndex") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let index = usize::try_from(value.as_u64().ok_or(())?).map_err(|_| ())?;
            if index > MAX_CANDIDATE_QUERY_INDEX {
                return Err(());
            }
            Ok(Some(index))
        }
    }
}

/// 후보 신호 하나를 path·source별 최고 순위와 점수로 병합합니다.
fn merge_candidate_source(
    merged: &mut BTreeMap<String, BTreeMap<String, CandidateSourceBest>>,
    path: &str,
    source: &str,
    rank: usize,
    score: Option<f64>,
    start_line: Option<u64>,
) {
    let sources = merged.entry(path.to_owned()).or_default();
    match sources.get_mut(source) {
        Some(best) => {
            best.rank = best.rank.min(rank);
            best.score = match (best.score, score) {
                (Some(left), Some(right)) => Some(left.max(right)),
                (Some(left), None) => Some(left),
                (None, Some(right)) => Some(right),
                (None, None) => None,
            };
            if best.start_line.is_none() {
                best.start_line = start_line;
            }
        }
        None => {
            sources.insert(
                source.to_owned(),
                CandidateSourceBest {
                    rank,
                    start_line,
                    score,
                },
            );
        }
    }
}

/// 후보 신호 입력을 `path`별 사전 점수로 병합합니다.
fn parse_candidates(value: Option<&Value>) -> Option<BTreeMap<String, CandidatePrior>> {
    let Some(item) = value else {
        return Some(BTreeMap::new());
    };
    let array = item.as_array()?;
    if array.len() > MAX_INPUT_DOCUMENTS {
        return None;
    }
    let mut merged = BTreeMap::<String, BTreeMap<String, CandidateSourceBest>>::new();
    let mut source_best_scores = BTreeMap::<String, f64>::new();
    let mut query_ranges = BTreeMap::<String, Vec<CandidateFacetRange>>::new();
    let mut comparison_facet_paths = BTreeSet::<String>::new();
    for entry in array {
        let path = entry.get("path")?.as_str()?;
        if !safe_path(path) {
            return None;
        }
        let source = entry.get("source")?.as_str()?.to_lowercase();
        let rank = usize::try_from(entry.get("rank")?.as_u64()?).ok()?;
        let score = match entry.get("score") {
            None | Some(Value::Null) => None,
            Some(value) => Some(value.as_f64()?),
        };
        if let Some(score) = score.filter(|score| score.is_finite()) {
            let best = source_best_scores.entry(source.clone()).or_insert(score);
            *best = best.max(score);
        }
        let start_line = entry.get("startLine").and_then(Value::as_u64);
        let end_line = entry.get("endLine").and_then(Value::as_u64);
        let query_index = candidate_query_index(entry).ok()?;
        if query_index.is_some_and(|query_index| query_index > 0) {
            comparison_facet_paths.insert(path.to_owned());
        }
        if let (Some(query_index), Some(start_line), Some(end_line)) =
            (query_index, start_line, end_line)
            && start_line >= 1
            && end_line >= start_line
        {
            query_ranges
                .entry(path.to_owned())
                .or_default()
                .push(CandidateFacetRange {
                    query_index,
                    start_line,
                    end_line,
                });
        }
        merge_candidate_source(&mut merged, path, &source, rank, score, start_line);
    }
    let mut candidates = BTreeMap::new();
    for (path, sources) in merged {
        let mut prior = 0.0;
        let mut best_rank = usize::MAX;
        let mut start_line = None;
        for (source, best) in sources {
            best_rank = best_rank.min(best.rank.max(1));
            let rank = crate::usize_to_f64(best.rank.max(1))?;
            let share =
                candidate_prior_share(rank, best.score, source_best_scores.get(&source).copied());
            prior =
                (candidate_source_weight(&source) * CANDIDATE_PRIOR_SCALE).mul_add(share, prior);
            if start_line.is_none() {
                start_line = best.start_line;
            }
        }
        let path_query_ranges = query_ranges.remove(&path).unwrap_or_default();
        let has_comparison_facet = comparison_facet_paths.contains(&path);
        candidates.insert(
            path,
            CandidatePrior {
                prior,
                best_rank,
                start_line,
                query_ranges: path_query_ranges,
                has_comparison_facet,
            },
        );
    }
    Some(candidates)
}
/// 문서 입력 하나를 검증해 스캔합니다.
///
/// `title`이 없으면 경로 basename에서 확장자를 제거해 유도합니다.
fn scan_input_document(value: &Value) -> Option<ScannedDocument> {
    let path = value.get("path")?.as_str()?.to_owned();
    if !safe_path(&path) {
        return None;
    }
    let text = value.get("text")?.as_str()?;
    if text.len() > MAX_DOCUMENT_TEXT_BYTES {
        return None;
    }
    let start_line = match value.get("startLine") {
        None | Some(Value::Null) => 1,
        Some(item) => item.as_u64()?.max(1),
    };
    let revision = read_optional_string(value.get("revision")).ok()?;
    let indexed = optional_bool_value(value.get("indexed"), true)?;
    let review_state = match value.get("reviewState") {
        None | Some(Value::Null) => "reviewed",
        Some(item) => match item.as_str()? {
            "reviewed" => "reviewed",
            "unreviewed" => "unreviewed",
            _ => return None,
        },
    };
    let tags = optional_string_array(value.get("tags"))?;
    let aliases = optional_string_array(value.get("aliases"))?;
    let modified_at = read_optional_timestamp(value.get("modifiedAt")).ok()?;
    let title = read_optional_string(value.get("title"))
        .ok()?
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| title_from_path(&path));
    let headings = optional_string_array(value.get("headings"))?;
    let code_blocks = optional_string_array(value.get("codeBlocks"))?;
    let (occurrences, frequencies, line_starts) = scan_document(text, start_line);
    let field_frequencies =
        FieldFrequencies::new(&path, &title, &headings, &tags, &aliases, &code_blocks);
    let field_texts = FieldTexts::new(&path, &title, &headings, &tags, &aliases, &code_blocks);
    Some(ScannedDocument {
        path,
        revision,
        indexed,
        review_state,
        text: text.to_owned(),
        start_line,
        tags,
        modified_at,
        occurrences,
        frequencies,
        field_frequencies,
        field_texts,
        line_starts,
    })
}

/// 문서가 경로·확장자·태그·수정 시각 필터를 통과하는지 반환합니다.
fn document_passes_filters(
    document: &ScannedDocument,
    scopes: &[String],
    path_prefixes: &[String],
    extensions: &BTreeSet<String>,
    tags: &BTreeSet<String>,
    modified_after: Option<u64>,
) -> bool {
    if !path_in_scopes(&document.path, scopes) {
        return false;
    }
    if !path_prefixes.is_empty()
        && !path_prefixes
            .iter()
            .any(|prefix| document.path.starts_with(prefix.as_str()))
    {
        return false;
    }
    if !extensions.is_empty() {
        let Some(extension) = path_extension(&document.path) else {
            return false;
        };
        if !extensions.contains(&extension) {
            return false;
        }
    }
    if !tags.is_empty() && !tags.iter().any(|tag| document.tags.contains(tag)) {
        return false;
    }
    if let Some(threshold) = modified_after {
        let Some(modified) = document.modified_at else {
            return false;
        };
        if modified < threshold {
            return false;
        }
    }
    true
}

/// 예산 값을 기본값·상한과 함께 검증합니다.
fn budget_value(value: Option<&Value>, default: usize, hard_max: usize) -> Option<usize> {
    let Some(item) = value else {
        return Some(default);
    };
    let raw = item.as_u64()?;
    Some(usize::try_from(raw).unwrap_or(hard_max).clamp(1, hard_max))
}

/// 계획 입력 전체를 검증합니다.
fn plan_input(value: &Value) -> Option<PlanInput> {
    let question = value.get("question")?.as_str()?;
    if question.len() > 16_384 {
        return None;
    }
    let document_values = value.get("documents")?.as_array()?;
    if document_values.len() > MAX_INPUT_DOCUMENTS {
        return None;
    }
    let filters = value.get("filters");
    let scopes = optional_string_array(value.get("scopes"))?;
    let path_prefixes = optional_string_array(filters.and_then(|item| item.get("pathPrefixes")))?;
    let extensions = optional_string_array(filters.and_then(|item| item.get("extensions")))?
        .into_iter()
        .map(|extension| extension.to_lowercase())
        .collect::<BTreeSet<_>>();
    let tags = optional_string_array(filters.and_then(|item| item.get("tags")))?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let modified_after =
        read_optional_timestamp(filters.and_then(|item| item.get("modifiedAfter"))).ok()?;
    let mut documents = Vec::new();
    let mut filtered_documents = 0_usize;
    for item in document_values {
        let document = scan_input_document(item)?;
        if document_passes_filters(
            &document,
            &scopes,
            &path_prefixes,
            &extensions,
            &tags,
            modified_after,
        ) {
            documents.push(document);
        } else {
            filtered_documents = filtered_documents.saturating_add(1);
        }
    }
    let budget = value.get("budget");
    let max_documents = budget_value(
        budget.and_then(|item| item.get("maxDocuments")),
        DEFAULT_MAX_DOCUMENTS,
        HARD_MAX_DOCUMENTS,
    )?;
    let max_passages = budget_value(
        budget.and_then(|item| item.get("maxPassages")),
        DEFAULT_MAX_PASSAGES,
        HARD_MAX_PASSAGES,
    )?;
    let max_chars = budget_value(
        budget.and_then(|item| item.get("maxChars")),
        DEFAULT_MAX_CHARS,
        HARD_MAX_CHARS,
    )?;
    let inventory = match value.get("inventory") {
        None | Some(Value::Null) => None,
        Some(item) => Some(InventoryCounts {
            indexed: usize::try_from(item.get("indexedCount")?.as_u64()?).ok()?,
            unreviewed: usize::try_from(item.get("unreviewedCount")?.as_u64()?).ok()?,
            not_indexed: usize::try_from(item.get("notIndexedCount")?.as_u64()?).ok()?,
        }),
    };
    Some(PlanInput {
        question: question.to_owned(),
        documents,
        candidates: parse_candidates(value.get("candidates"))?,
        inventory,
        max_documents,
        max_passages,
        max_chars,
        filtered_documents,
    })
}

/// 원문 구절·진단 계획을 조립합니다.
/// 계획 후보를 점수·경로·행 순으로 정렬하고 후보 깊이를 반환합니다.
fn sort_drafts(drafts: &mut [PassageDraft], max_documents: usize, max_passages: usize) -> usize {
    drafts.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.start_line.cmp(&right.start_line))
    });
    candidate_depth(drafts, max_documents, max_passages)
}

/// 구절 행의 인용·문맥 문자 수입니다.
fn draft_chars(draft: &PassageDraft) -> usize {
    draft.quote.encode_utf16().count()
        + draft.context_before.encode_utf16().count()
        + draft.context_after.encode_utf16().count()
}

/// facet 예약·문서 다양성·점수 순서로 선택할 구절 인덱스를 정합니다.
fn select_evidence_indices(
    drafts: &[PassageDraft],
    depth: usize,
    max_passages: usize,
    max_chars: usize,
) -> (BTreeSet<usize>, usize) {
    let mut used_chars = 0_usize;
    let mut selected = BTreeSet::<usize>::new();
    let mut selected_paths = BTreeSet::<String>::new();
    let nonzero_query_indexes = drafts
        .iter()
        .take(depth)
        .flat_map(|draft| draft.query_indexes.iter().copied())
        .filter(|index| *index > 0)
        .collect::<BTreeSet<_>>();
    for query_index in nonzero_query_indexes {
        if selected.len() >= max_passages {
            break;
        }
        if selected.iter().any(|index| {
            drafts
                .get(*index)
                .is_some_and(|draft| draft.query_indexes.contains(&query_index))
        }) {
            continue;
        }
        if let Some((index, draft)) =
            drafts
                .iter()
                .take(depth)
                .enumerate()
                .find(|(index, draft)| {
                    !selected.contains(index)
                        && draft.query_indexes.contains(&query_index)
                        && used_chars.saturating_add(draft_chars(draft)) <= max_chars
                })
        {
            used_chars = used_chars.saturating_add(draft_chars(draft));
            selected.insert(index);
            selected_paths.insert(draft.path.clone());
        }
    }
    // 같은 문서의 여러 구간이 예산을 독점하지 않도록 문서별 최상위 구간을 먼저 채웁니다.
    // 이 단계 뒤에 남는 칸은 원래 점수 순서로 채워 깊은 문서 근거를 버리지 않습니다.
    for (index, draft) in drafts.iter().take(depth).enumerate() {
        if selected.len() >= max_passages {
            break;
        }
        if selected.contains(&index) || selected_paths.contains(&draft.path) {
            continue;
        }
        let chars = draft_chars(draft);
        if used_chars.saturating_add(chars) > max_chars {
            continue;
        }
        used_chars = used_chars.saturating_add(chars);
        selected.insert(index);
        selected_paths.insert(draft.path.clone());
    }
    for (index, draft) in drafts.iter().take(depth).enumerate() {
        if selected.len() >= max_passages {
            break;
        }
        if selected.contains(&index) {
            continue;
        }
        let chars = draft_chars(draft);
        if used_chars.saturating_add(chars) > max_chars {
            break;
        }
        used_chars = used_chars.saturating_add(chars);
        selected.insert(index);
    }
    (selected, used_chars)
}

/// 정렬된 후보 앞부분에서 증거 행과 예산 사용량을 만듭니다.
fn collect_evidence_rows(
    drafts: &[PassageDraft],
    depth: usize,
    max_passages: usize,
    max_chars: usize,
) -> (Vec<Value>, usize, bool) {
    let (selected, used_chars) = select_evidence_indices(drafts, depth, max_passages, max_chars);
    let mut evidence = Vec::new();
    let mut seen_quotes = BTreeMap::<String, String>::new();
    for draft in drafts
        .iter()
        .take(depth)
        .enumerate()
        .filter_map(|(index, draft)| selected.contains(&index).then_some(draft))
    {
        let key = normalize_phrase(&draft.quote);
        let duplicate_of = seen_quotes.get(&key).cloned();
        if duplicate_of.is_none() {
            seen_quotes.insert(key, source_id(draft));
        }
        let rank = evidence.len().saturating_add(1);
        evidence.push(json!({
            "sourceId": source_id(draft),
            "path": draft.path,
            "revision": draft.revision,
            "startLine": draft.start_line,
            "endLine": draft.end_line,
            "quote": draft.quote,
            "contextBefore": draft.context_before,
            "contextAfter": draft.context_after,
            "score": draft.score,
            "rank": rank,
            "signal": draft.signal,
            "phraseMatches": draft.phrase_matches,
            "fieldScore": draft.field_score,
            "fieldMatches": draft.field_matches.iter().collect::<Vec<_>>(),
            "proximityScore": 0.0,
            "exactSignals": draft.exact.iter().collect::<Vec<_>>(),
            "highlights": draft
                .highlights
                .iter()
                .map(|(start, end)| json!({"start": start, "end": end}))
                .collect::<Vec<_>>(),
            "negatedNearby": draft.negated_nearby,
            "duplicateOf": duplicate_of,
            "queryIndexes": draft.query_indexes.iter().copied().collect::<Vec<_>>(),
        }));
    }
    (
        evidence,
        used_chars,
        drafts.len() > depth || selected.len() < depth,
    )
}
/// 정렬된 후보에서 증거 행을 만듭니다.
fn build_evidence_rows(
    drafts: &mut [PassageDraft],
    max_documents: usize,
    max_passages: usize,
    max_chars: usize,
) -> (Vec<Value>, usize, usize, bool, usize) {
    let depth = sort_drafts(drafts, max_documents, max_passages);
    let threshold = drafts
        .first()
        .map_or(0.0, |draft| draft.score * CANDIDATE_DEPTH_RATIO);
    let below_threshold = drafts
        .iter()
        .filter(|draft| !draft.matched && draft.score < threshold)
        .count();
    let (evidence, used_chars, truncated) =
        collect_evidence_rows(drafts, depth, max_passages, max_chars);
    (evidence, depth, used_chars, truncated, below_threshold)
}

/// 원문 구절·진단 계획을 조립합니다.
fn plan_evidence(value: &Value) -> Option<Value> {
    let input = plan_input(value)?;
    let (mut tokens, phrases) = parse_query(&input.question);
    let variants = optional_string_array(value.get("queryVariants"))?;
    if variants.len() > 3
        || variants
            .iter()
            .any(|query| query.trim().is_empty() || query.len() > 16_384)
    {
        return None;
    }
    // 기존 번역 구문은 후보 수집뿐 아니라 원문 구절의 lexical 평가에도 사용합니다.
    // 번역은 검색 힌트이므로 원래 부정·필드 연산자를 덮거나 직접 인용 구문을 만들지 않습니다.
    for variant in &variants {
        let (variant_tokens, _) = parse_query(variant);
        for mut token in variant_tokens {
            if token.negated || tokens.iter().any(|existing| existing.text == token.text) {
                continue;
            }
            token.position = tokens
                .last()
                .map_or(0, |last| last.position.saturating_add(1));
            token.phrase_index = None;
            "body".clone_into(&mut token.field);
            token.explicit_field = false;
            if token.kind == "quoted" {
                token.kind = "term";
            }
            tokens.push(token);
        }
    }
    let terms = positive_terms(&tokens);
    let kinds = term_kinds(&tokens);
    let negated = negated_terms(&tokens);
    let has_positive_phrase = phrases
        .iter()
        .any(|phrase| !phrase.negated && !phrase.text.is_empty());
    let has_comparison_facets = input
        .candidates
        .values()
        .any(|candidate| candidate.has_comparison_facet);
    let statistics = batch_statistics(&input.documents, &terms)?;
    let allowed = allowed_fields(&tokens);
    let atomic = atomic_identifiers(&tokens);
    let mut drafts = Vec::new();
    for document in &input.documents {
        let prior = input
            .candidates
            .get(&document.path)
            .map_or(0.0, |candidate| candidate.prior);
        let score = score_document(document, &allowed, &kinds, &atomic, &statistics, prior);
        let prior_rank = input
            .candidates
            .get(&document.path)
            .map_or(usize::MAX, |candidate| candidate.best_rank);
        let forced = input.candidates.contains_key(&document.path);
        if score.matched.is_empty() && !forced {
            continue;
        }
        let candidate_start = input
            .candidates
            .get(&document.path)
            .and_then(|candidate| candidate.start_line)
            .and_then(|line| candidate_start_byte(document, line));
        let phrase_offsets = phrase_hit_offsets(document, &phrases);
        let anchor =
            select_anchor(document, &score.matched, &phrase_offsets, candidate_start).unwrap_or(0);
        let mut draft = build_passage(document, anchor, &score, prior, &phrases, &negated);
        draft.candidate_rank = prior_rank;
        if let Some(candidate) = input.candidates.get(&document.path) {
            draft.query_indexes.extend(
                candidate
                    .query_ranges
                    .iter()
                    .filter(|range| {
                        draft.start_line <= range.end_line && draft.end_line >= range.start_line
                    })
                    .map(|range| range.query_index),
            );
        }
        drafts.push(draft);
    }
    // 구문 일치 초안이 하나라도 있으면 그 초안만 채택합니다. 배치 안에 전부
    // 미일치면 구문이 코퍼스에 없는 경우이므로 토큰 일치 초안을 유지하고,
    // 구문 보너스(`PHRASE_SIGNAL_BONUS`)만 받지 못하게 합니다.
    if has_positive_phrase
        && !has_comparison_facets
        && drafts.iter().any(|draft| draft.phrase_matches > 0)
    {
        drafts.retain(|draft| draft.phrase_matches > 0);
    }
    let (evidence, depth, used_chars, truncated, below_threshold) = build_evidence_rows(
        &mut drafts,
        input.max_documents,
        input.max_passages,
        input.max_chars,
    );
    let summary = PlanSummary {
        depth,
        drafts_len: drafts.len(),
        used_chars,
        truncated,
        below_threshold,
    };
    Some(plan_report(&input, &tokens, &phrases, &summary, &evidence))
}

/// quote 안에서 질의 토큰·구문이 나타난 `UTF-16` 구간을 병합합니다.
fn highlight_ranges(lowered: &str, needles: &[String]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for needle in needles {
        let mut offset = 0_usize;
        while let Some(found) = lowered.get(offset..).and_then(|tail| tail.find(needle)) {
            let start = offset.saturating_add(found);
            let end = start.saturating_add(needle.len());
            if !lowered.is_char_boundary(start) || !lowered.is_char_boundary(end) {
                break;
            }
            let start_utf16 = crate::text_len(lowered.get(..start).unwrap_or_default());
            let end_utf16 = crate::text_len(lowered.get(..end).unwrap_or_default());
            ranges.push((start_utf16, end_utf16));
            if ranges.len() >= MAX_HIGHLIGHTS {
                break;
            }
            offset = end.max(start.saturating_add(1));
        }
    }
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        match merged.last_mut() {
            Some((_, last_end)) if start <= *last_end => {
                *last_end = (*last_end).max(end);
            }
            _ => merged.push((start, end)),
        }
    }
    merged
}
/// 구절의 안정적인 출처 id를 만듭니다.
fn source_id(draft: &PassageDraft) -> String {
    format!("{}#L{}-L{}", draft.path, draft.start_line, draft.end_line)
}

/// 계획 조립 중 계산한 요약 값입니다.
struct PlanSummary {
    /// 적응적으로 정한 후보 깊이입니다.
    depth: usize,
    /// 구절 초안 수입니다.
    drafts_len: usize,
    /// 사용한 인용 문자 수입니다.
    used_chars: usize,
    /// 절단 발생 여부입니다.
    truncated: bool,
    /// 상위 점수 대비 임계 미만 문서 수입니다.
    below_threshold: usize,
}

/// 질의 토큰 JSON 행을 만듭니다.
fn query_token_rows(tokens: &[QueryToken]) -> Vec<Value> {
    tokens
        .iter()
        .map(|token| {
            json!({
                "text": &token.text,
                "position": token.position,
                "field": &token.field,
                "kind": token.kind,
                "negated": token.negated,
                "phraseIndex": token.phrase_index,
            })
        })
        .collect()
}

/// 질의 구문 JSON 행을 만듭니다.
fn phrase_rows(phrases: &[QueryPhrase]) -> Vec<Value> {
    phrases
        .iter()
        .map(|phrase| {
            json!({
                "tokens": &phrase.tokens,
                "negated": phrase.negated,
                "field": &phrase.field,
            })
        })
        .collect()
}

/// 배치 안에서 등장하지 않은 긍정 토큰을 모읍니다.
fn unmatched_terms(input: &PlanInput, tokens: &[QueryToken]) -> Vec<String> {
    let mut unmatched = Vec::new();
    for token in tokens.iter().filter(|token| !token.negated) {
        if !input
            .documents
            .iter()
            .any(|document| document.frequencies.contains_key(&token.text))
            && !unmatched.contains(&token.text)
        {
            unmatched.push(token.text.clone());
        }
    }
    unmatched
}

/// 배치 문서의 `path` 고유 수입니다.
fn unique_document_count(documents: &[ScannedDocument]) -> usize {
    documents
        .iter()
        .map(|document| document.path.as_str())
        .collect::<BTreeSet<_>>()
        .len()
}

/// 전체 색인 또는 배치 `path` 고유 기준 검토 집계를 돌려줍니다.
fn coverage_counts(input: &PlanInput) -> (usize, usize, usize) {
    if let Some(inventory) = &input.inventory {
        return (
            inventory.indexed.saturating_sub(inventory.unreviewed),
            inventory.unreviewed,
            inventory.not_indexed,
        );
    }
    let mut ranks = BTreeMap::<&str, u8>::new();
    for document in &input.documents {
        let rank = if document.indexed {
            u8::from(document.review_state == "unreviewed")
        } else {
            2_u8
        };
        let entry = ranks.entry(document.path.as_str()).or_insert(0);
        *entry = (*entry).max(rank);
    }
    let mut reviewed = 0_usize;
    let mut unreviewed = 0_usize;
    let mut not_indexed = 0_usize;
    for rank in ranks.values() {
        match rank {
            2 => not_indexed = not_indexed.saturating_add(1),
            1 => unreviewed = unreviewed.saturating_add(1),
            _ => reviewed = reviewed.saturating_add(1),
        }
    }
    (reviewed, unreviewed, not_indexed)
}

/// 히트가 없을 때의 결정적 이유를 고릅니다.
fn zero_hit_reason(
    input: &PlanInput,
    tokens: &[QueryToken],
    unmatched: &[String],
    selected: usize,
) -> Option<&'static str> {
    if selected > 0 {
        return None;
    }
    if input.documents.is_empty() {
        return Some("no-documents");
    }
    let positive = tokens.iter().filter(|token| !token.negated).count();
    if unmatched.len() == positive {
        return Some("no-token-match");
    }
    Some("no-passage")
}

/// 계획 요약·진단·coverage를 조립합니다.
fn plan_report(
    input: &PlanInput,
    tokens: &[QueryToken],
    phrases: &[QueryPhrase],
    summary: &PlanSummary,
    evidence: &[Value],
) -> Value {
    let order = evidence
        .iter()
        .filter_map(|item| item.get("sourceId").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let selected_documents = evidence
        .iter()
        .filter_map(|item| item.get("path").and_then(Value::as_str))
        .collect::<BTreeSet<_>>()
        .len();
    let budget_cut = summary.drafts_len.saturating_sub(selected_documents);
    let below_threshold = summary.below_threshold.min(budget_cut);
    let (reviewed, unreviewed, not_indexed) = coverage_counts(input);
    let coverage_status = if summary.truncated {
        "budget-exhausted"
    } else if unreviewed > 0 || not_indexed > 0 {
        "incomplete"
    } else {
        "supported"
    };
    let unmatched = unmatched_terms(input, tokens);
    let zero_hit = zero_hit_reason(input, tokens, &unmatched, selected_documents);
    let missing_candidate_paths = input
        .candidates
        .keys()
        .filter(|path| {
            !input
                .documents
                .iter()
                .any(|document| document.path == **path)
        })
        .count();
    json!({
        "queryTokens": query_token_rows(tokens),
        "phrases": phrase_rows(phrases),
        "evidence": evidence,
        "order": order,
        "diagnostics": {
            "candidateDepth": summary.depth,
            "candidateDocuments": unique_document_count(&input.documents),
            "candidateChunks": input.documents.len(),
            "selectedDocuments": selected_documents,
            "selectedChunks": evidence.len(),
            "truncated": summary.truncated,
            "droppedDocuments": {
                "budget": budget_cut,
                "belowThreshold": below_threshold,
                "filtered": input.filtered_documents,
            },
            "unmatchedTerms": unmatched,
            "missingCandidatePaths": missing_candidate_paths,
            "zeroHitReason": zero_hit,
        },
        "coverage": {
            "status": coverage_status,
            "reviewedDocuments": reviewed,
            "unreviewedDocuments": unreviewed,
            "notIndexedDocuments": not_indexed,
        },
        "budget": {
            "maxDocuments": input.max_documents,
            "maxPassages": input.max_passages,
            "maxChars": input.max_chars,
            "usedChars": summary.used_chars,
        },
    })
}
/// 채택 구절 참조를 검증합니다.
fn parse_evidence_refs(value: Option<&Value>) -> Option<Vec<EvidenceRef>> {
    let array = value?.as_array()?;
    if array.len() > MAX_INPUT_DOCUMENTS {
        return None;
    }
    let mut refs = Vec::new();
    for item in array {
        let source_id = item.get("sourceId")?.as_str()?.to_owned();
        let path = item.get("path")?.as_str()?.to_owned();
        if !safe_path(&path) {
            return None;
        }
        let quote = item.get("quote")?.as_str()?.to_owned();
        let revision = read_optional_string(item.get("revision")).ok()?;
        let start_line = read_optional_usize(item.get("startLine")).ok()?;
        let end_line = read_optional_usize(item.get("endLine")).ok()?;
        refs.push(EvidenceRef {
            source_id,
            path,
            revision,
            start_line: start_line.map(|value| u64::try_from(value).unwrap_or(u64::MAX)),
            end_line: end_line.map(|value| u64::try_from(value).unwrap_or(u64::MAX)),
            quote,
        });
    }
    Some(refs)
}

/// 검증 입력 문서를 파싱합니다.
fn parse_verify_documents(value: Option<&Value>) -> Option<Vec<VerifyDocument>> {
    let array = value?.as_array()?;
    if array.len() > MAX_INPUT_DOCUMENTS {
        return None;
    }
    let mut documents = Vec::new();
    for item in array {
        let path = item.get("path")?.as_str()?.to_owned();
        if !safe_path(&path) {
            return None;
        }
        let text = item.get("text")?.as_str()?;
        if text.len() > MAX_DOCUMENT_TEXT_BYTES {
            return None;
        }
        let start_line = match item.get("startLine") {
            None | Some(Value::Null) => 1,
            Some(entry) => entry.as_u64()?.max(1),
        };
        let review_state = match item.get("reviewState") {
            None | Some(Value::Null) => "reviewed",
            Some(entry) => match entry.as_str()? {
                "reviewed" => "reviewed",
                "unreviewed" => "unreviewed",
                _ => return None,
            },
        };
        documents.push(VerifyDocument {
            path,
            revision: read_optional_string(item.get("revision")).ok()?,
            text: text.to_owned(),
            start_line,
            indexed: optional_bool_value(item.get("indexed"), true)?,
            review_state,
            scopes: optional_string_array(item.get("scopes"))?,
        });
    }
    Some(documents)
}

/// 같은 구절이 여러 번 나와도 요청한 절대 행과 일치하는 위치가 있는지 확인합니다.
fn quote_line_matches(
    document: &VerifyDocument,
    quote: &str,
    start_line: Option<u64>,
    end_line: Option<u64>,
) -> bool {
    let Some(expected_start) = start_line else {
        return false;
    };
    !quote.is_empty()
        && document.text.match_indices(quote).any(|(index, _)| {
            let start_ok = line_of(&document.text, document.start_line, index) == expected_start;
            let end_ok = end_line.is_none_or(|expected_end| {
                line_of(
                    &document.text,
                    document.start_line,
                    index.saturating_add(quote.len()).saturating_sub(1),
                ) == expected_end
            });
            start_ok && end_ok
        })
}

/// 후보 문서 하나의 구절 상태를 검증합니다.
fn verify_quote(
    item: &EvidenceRef,
    candidates: &[&VerifyDocument],
    scopes: &[String],
) -> VerifiedQuote {
    let mut best: Option<(u8, VerifiedQuote)> = None;
    for document in candidates {
        let exists = !item.quote.is_empty() && document.text.contains(&item.quote);
        let line_matches = item
            .start_line
            .map(|_| quote_line_matches(document, &item.quote, item.start_line, item.end_line));
        let revision_state = match (item.revision.as_deref(), document.revision.as_deref()) {
            (Some(left), Some(right)) if left == right => "match",
            (Some(_), Some(_)) => "mismatch",
            _ => "unknown",
        };
        let effective_scopes = if document.scopes.is_empty() {
            scopes
        } else {
            document.scopes.as_slice()
        };
        let scope_state = if !document.indexed {
            "unknown"
        } else if path_in_scopes(&document.path, effective_scopes) {
            "in-scope"
        } else {
            "out-of-scope"
        };
        let review_state = if document.indexed {
            document.review_state
        } else {
            "not-indexed"
        };
        let line_rank = match line_matches {
            Some(true) => 2_u8,
            None => 1,
            Some(false) => 0,
        };
        let revision_rank = match revision_state {
            "match" => 2_u8,
            "unknown" => 1,
            _ => 0,
        };
        let rank = u8::from(exists) * 32
            + line_rank * 8
            + revision_rank * 4
            + u8::from(scope_state == "in-scope") * 2
            + u8::from(review_state == "reviewed");
        let verified = VerifiedQuote {
            exists,
            line_matches,
            revision_state,
            scope_state,
            review_state,
        };
        if best.as_ref().is_none_or(|(best_rank, _)| rank > *best_rank) {
            best = Some((rank, verified));
        }
    }
    best.map_or(
        VerifiedQuote {
            exists: false,
            line_matches: None,
            revision_state: "unknown",
            scope_state: "unknown",
            review_state: "not-indexed",
        },
        |(_, verified)| verified,
    )
}

/// 구절 상태를 우선순위에 따라 이름 짓습니다.
fn status_name(verified: &VerifiedQuote) -> &'static str {
    if verified.review_state == "not-indexed" {
        "not-indexed"
    } else if !verified.exists {
        "quote-missing"
    } else if verified.revision_state == "mismatch" {
        "revision-mismatch"
    } else if verified.line_matches == Some(false) {
        "position-mismatch"
    } else if verified.scope_state == "out-of-scope" {
        "out-of-scope"
    } else if verified.review_state == "unreviewed" {
        "unreviewed"
    } else {
        "verified"
    }
}

/// 현재 원문에 유일하게 남은 구절의 주소만 제안하며 검증 상태는 바꾸지 않습니다.
fn relocate_quote(
    item: &EvidenceRef,
    documents: &[&VerifyDocument],
    scopes: &[String],
) -> Option<Value> {
    if item.quote.is_empty() {
        return None;
    }
    let mut locations = BTreeSet::new();
    for document in documents {
        let effective_scopes = if document.scopes.is_empty() {
            scopes
        } else {
            &document.scopes
        };
        if !document.indexed
            || document.review_state != "reviewed"
            || !path_in_scopes(&document.path, effective_scopes)
        {
            continue;
        }
        let revision = document.revision.as_deref()?;
        for (index, _) in document.text.match_indices(&item.quote) {
            locations.insert((
                line_of(&document.text, document.start_line, index),
                line_of(
                    &document.text,
                    document.start_line,
                    index + item.quote.len() - 1,
                ),
                revision,
            ));
        }
    }
    if locations.len() != 1 {
        return None;
    }
    let (start, end, revision) = locations.into_iter().next()?;
    Some(json!({"startLine": start, "endLine": end, "revision": revision}))
}

/// 모든 채택 구절의 상태를 결정적으로 검증합니다.
fn verify_evidence(value: &Value) -> Option<Value> {
    let evidence = parse_evidence_refs(value.get("evidence"))?;
    let documents = parse_verify_documents(value.get("documents"))?;
    let scopes = optional_string_array(value.get("scopes"))?;
    let mut seen = BTreeMap::<(String, String, Option<u64>), String>::new();
    let mut statuses = Vec::new();
    for item in &evidence {
        let candidates = documents
            .iter()
            .filter(|document| document.path == item.path)
            .collect::<Vec<_>>();
        let verified = verify_quote(item, &candidates, &scopes);
        let key = (
            item.path.clone(),
            normalize_phrase(&item.quote),
            item.start_line,
        );
        let duplicate_of = seen.get(&key).cloned();
        seen.entry(key).or_insert_with(|| item.source_id.clone());
        statuses.push(json!({
            "sourceId": &item.source_id,
            "path": &item.path,
            "status": status_name(&verified),
            "exists": verified.exists,
            "lineMatches": verified.line_matches,
            "offsetMatches": Value::Null,
            "revisionState": verified.revision_state,
            "scopeState": verified.scope_state,
            "reviewState": verified.review_state,
            "duplicateOf": duplicate_of,
            "relocation": if status_name(&verified) == "verified" { None } else { relocate_quote(item, &candidates, &scopes) },
        }));
    }
    Some(json!({"statuses": statuses}))
}

/// 여러 배치 계획을 배치 내부 순위 `RRF`·`path` stable 순으로 병합합니다.
///
/// 배치 순서와 무관하게 같은 결과를 내며, 원문 구절은 다시 할당하지 않고
/// 계획 JSON의 증거 행만 재정렬·중복 제거해 전체 corpus 메모리 축적을 피합니다.
#[must_use]
#[wasm_bindgen]
pub fn merge_indexed_evidence_plans_json(input: &str) -> String {
    if input.len() > MAX_INPUT_BYTES {
        return String::new();
    }
    let Some(value) = serde_json::from_str::<Value>(input).ok() else {
        return String::new();
    };
    merge_plans(&value).map_or_else(String::new, |merged| merged.to_string())
}

/// 병합 대상 구절 하나의 정렬·중복 키입니다.
struct MergeEntry {
    /// 원래 출력용 증거 JSON입니다.
    value: Value,
    /// 배치 원본 점수입니다.
    score: f64,
    /// 배치 최고 점수로 나눈 `0..=1` 점수입니다.
    local_score: f64,
    /// 배치 내부 유효 순위로 계산한 `RRF` 점수입니다.
    rrf_score: f64,
    /// 배치 내부 유효 순위입니다.
    rank: usize,
    /// 부정 토큰이 구절 근처에 있는지입니다.
    negated_nearby: bool,
    /// 신호에 `candidate`가 포함됐는지입니다.
    has_candidate: bool,
    /// 일치한 정확 구문 수입니다.
    phrase_matches: u64,
    /// `exact` 신호 수입니다.
    exact_signal_count: usize,
    /// 필드 일치 가중치 합입니다.
    field_score: f64,
    /// 볼트 상대 경로입니다.
    path: String,
    /// 시작 행입니다.
    start_line: u64,
    /// 끝 행입니다.
    end_line: u64,
    /// 원문 인용입니다.
    quote: String,
    /// 원래 출처 id입니다.
    source_id: String,
    /// 이 구절을 지목한 검색 facet query index입니다.
    query_indexes: BTreeSet<usize>,
    /// 인용과 문맥의 `UTF-16` 문자 수입니다.
    chars: usize,
}

/// merge 출력용 실제 구절 정보입니다.
fn merge_entry(value: &Value) -> Option<MergeEntry> {
    let path = value.get("path")?.as_str()?.to_owned();
    if !safe_path(&path) {
        return None;
    }
    let score = value.get("score")?.as_f64()?;
    if !score.is_finite() || score < 0.0 {
        return None;
    }
    let start_line = value.get("startLine")?.as_u64()?;
    let end_line = value.get("endLine")?.as_u64()?;
    if start_line < 1 || end_line < start_line {
        return None;
    }
    let quote = value.get("quote")?.as_str()?.to_owned();
    let source_id = value.get("sourceId")?.as_str()?.to_owned();
    let rank = value
        .get("rank")
        .and_then(Value::as_u64)
        .and_then(|rank| usize::try_from(rank).ok())
        .filter(|rank| *rank > 0)
        .unwrap_or(0);
    let negated_nearby = value
        .get("negatedNearby")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_candidate = value
        .get("signal")
        .and_then(Value::as_str)
        .is_some_and(|signal| signal.split('+').any(|signal| signal == "candidate"));
    let phrase_matches = value
        .get("phraseMatches")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let exact_signal_count = value
        .get("exactSignals")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let field_score = value
        .get("fieldScore")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let context_before = value
        .get("contextBefore")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let context_after = value
        .get("contextAfter")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let query_indexes = match value.get("queryIndexes") {
        None | Some(Value::Null) => BTreeSet::new(),
        Some(values) => values
            .as_array()?
            .iter()
            .map(|value| {
                let index = usize::try_from(value.as_u64()?).ok()?;
                (index <= MAX_CANDIDATE_QUERY_INDEX).then_some(index)
            })
            .collect::<Option<BTreeSet<_>>>()?,
    };
    let chars = crate::text_len(&quote)
        .saturating_add(crate::text_len(context_before))
        .saturating_add(crate::text_len(context_after));
    Some(MergeEntry {
        value: value.clone(),
        score,
        local_score: 0.0,
        rrf_score: 0.0,
        rank,
        negated_nearby,
        has_candidate,
        phrase_matches,
        exact_signal_count,
        field_score,
        path,
        start_line,
        end_line,
        quote,
        source_id,
        query_indexes,
        chars,
    })
}

/// 병합에 쓰는 계획 coverage 요약입니다.
struct MergeCoverage {
    /// `budget-exhausted`(2)/`incomplete`(1)/그 외(0) 심각도입니다.
    rank: u8,
    /// 검토 완료 문서 수입니다.
    reviewed: usize,
    /// 미검토 문서 수입니다.
    unreviewed: usize,
    /// 미색인 문서 수입니다.
    not_indexed: usize,
}

/// 계획 배열에서 증거·coverage를 모아 정렬 전 상태로 만듭니다.
fn collect_merge_entries(plans: &[Value]) -> Option<(Vec<MergeEntry>, MergeCoverage)> {
    let mut entries = Vec::new();
    let mut coverage_rank = 0_u8;
    let mut reviewed = 0_usize;
    let mut unreviewed = 0_usize;
    let mut not_indexed = 0_usize;
    for plan in plans {
        let evidence = plan.get("evidence")?.as_array()?;
        let mut plan_entries = evidence
            .iter()
            .map(merge_entry)
            .collect::<Option<Vec<_>>>()?;
        let mut ranks = BTreeSet::new();
        let ranks_valid = plan_entries
            .iter()
            .all(|entry| entry.rank > 0 && ranks.insert(entry.rank))
            && ranks.iter().copied().eq(1..=plan_entries.len());
        if !ranks_valid {
            plan_entries.sort_by(|left, right| {
                right
                    .score
                    .total_cmp(&left.score)
                    .then_with(|| left.path.cmp(&right.path))
                    .then_with(|| left.start_line.cmp(&right.start_line))
                    .then_with(|| left.end_line.cmp(&right.end_line))
                    .then_with(|| left.quote.cmp(&right.quote))
                    .then_with(|| left.source_id.cmp(&right.source_id))
            });
            for (index, entry) in plan_entries.iter_mut().enumerate() {
                entry.rank = index.saturating_add(1);
            }
        }
        let max_score = plan_entries
            .iter()
            .map(|entry| entry.score)
            .fold(0.0_f64, f64::max);
        let denominator = max_score.max(1e-12);
        for entry in &mut plan_entries {
            entry.local_score = (entry.score / denominator).clamp(0.0, 1.0);
            let rank = crate::usize_to_f64(entry.rank).unwrap_or(f64::MAX);
            entry.rrf_score = (MERGE_RRF_K + 1.0) / (MERGE_RRF_K + rank);
        }
        entries.extend(plan_entries);
        if let Some(coverage) = plan.get("coverage") {
            let status = coverage.get("status").and_then(Value::as_str).unwrap_or("");
            let rank = match status {
                "budget-exhausted" => 2_u8,
                "incomplete" => 1_u8,
                _ => 0_u8,
            };
            coverage_rank = coverage_rank.max(rank);
            let count = |key: &str| {
                coverage
                    .get(key)
                    .and_then(Value::as_u64)
                    .and_then(|raw| usize::try_from(raw).ok())
                    .unwrap_or(0)
            };
            reviewed = reviewed.max(count("reviewedDocuments"));
            unreviewed = unreviewed.max(count("unreviewedDocuments"));
            not_indexed = not_indexed.max(count("notIndexedDocuments"));
        }
    }
    Some((
        entries,
        MergeCoverage {
            rank: coverage_rank,
            reviewed,
            unreviewed,
            not_indexed,
        },
    ))
}

/// 정렬·중복 제거·예산 절단을 적용해 최종 증거를 고릅니다.
fn select_merge_entries(
    entries: Vec<MergeEntry>,
    max_passages: usize,
    max_chars: usize,
) -> (Vec<MergeEntry>, usize, usize, usize, bool) {
    let mut sorted = entries;
    sorted.sort_by(|left, right| {
        right
            .rrf_score
            .total_cmp(&left.rrf_score)
            .then_with(|| left.negated_nearby.cmp(&right.negated_nearby))
            .then_with(|| right.local_score.total_cmp(&left.local_score))
            .then_with(|| right.has_candidate.cmp(&left.has_candidate))
            .then_with(|| right.phrase_matches.cmp(&left.phrase_matches))
            .then_with(|| right.exact_signal_count.cmp(&left.exact_signal_count))
            .then_with(|| right.field_score.total_cmp(&left.field_score))
            .then_with(|| right.score.total_cmp(&left.score))
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.start_line.cmp(&right.start_line))
            .then_with(|| left.end_line.cmp(&right.end_line))
            .then_with(|| left.quote.cmp(&right.quote))
            .then_with(|| left.source_id.cmp(&right.source_id))
    });
    let mut seen = BTreeSet::<(String, u64, u64, String)>::new();
    let mut duplicates_dropped = 0_usize;
    let mut unique = Vec::with_capacity(sorted.len());
    for entry in sorted {
        let key = (
            entry.path.clone(),
            entry.start_line,
            entry.end_line,
            normalize_phrase(&entry.quote),
        );
        if !seen.insert(key) {
            duplicates_dropped = duplicates_dropped.saturating_add(1);
            continue;
        }
        unique.push(entry);
    }
    let mut selected_indices = BTreeSet::new();
    let mut reserved_query_indexes = BTreeSet::new();
    let mut used_chars = 0_usize;
    for (index, entry) in unique.iter().enumerate() {
        let has_unreserved = entry
            .query_indexes
            .iter()
            .any(|query_index| *query_index > 0 && !reserved_query_indexes.contains(query_index));
        if !has_unreserved {
            continue;
        }
        if selected_indices.len() >= max_passages {
            break;
        }
        if used_chars.saturating_add(entry.chars) > max_chars {
            continue;
        }
        used_chars = used_chars.saturating_add(entry.chars);
        selected_indices.insert(index);
        reserved_query_indexes.extend(
            entry
                .query_indexes
                .iter()
                .copied()
                .filter(|query_index| *query_index > 0),
        );
    }
    for (index, entry) in unique.iter().enumerate() {
        if selected_indices.contains(&index) {
            continue;
        }
        if selected_indices.len() >= max_passages {
            break;
        }
        if used_chars.saturating_add(entry.chars) > max_chars {
            continue;
        }
        used_chars = used_chars.saturating_add(entry.chars);
        selected_indices.insert(index);
    }
    let budget_dropped = unique.len().saturating_sub(selected_indices.len());
    let truncated = budget_dropped > 0;
    let selected = unique
        .into_iter()
        .enumerate()
        .filter_map(|(index, entry)| selected_indices.contains(&index).then_some(entry))
        .collect::<Vec<_>>();
    (
        selected,
        duplicates_dropped,
        budget_dropped,
        used_chars,
        truncated,
    )
}

/// 계획 배열에서 증거 행과 coverage를 모은 뒤 전역 정렬합니다.
fn merge_plans(value: &Value) -> Option<Value> {
    let plans = value.get("plans")?.as_array()?;
    if plans.len() > MAX_INPUT_DOCUMENTS {
        return None;
    }
    let budget = value.get("budget");
    let max_passages = budget_value(
        budget.and_then(|item| item.get("maxPassages")),
        DEFAULT_MAX_PASSAGES,
        HARD_MAX_PASSAGES,
    )?;
    let max_chars = budget_value(
        budget.and_then(|item| item.get("maxChars")),
        DEFAULT_MAX_CHARS,
        HARD_MAX_CHARS,
    )?;
    let (entries, merged_coverage) = collect_merge_entries(plans)?;
    let coverage_rank = merged_coverage.rank;
    let reviewed = merged_coverage.reviewed;
    let unreviewed = merged_coverage.unreviewed;
    let not_indexed = merged_coverage.not_indexed;
    let evaluated_chunks = entries.len();
    let (selected, duplicates_dropped, budget_dropped, used_chars, truncated) =
        select_merge_entries(entries, max_passages, max_chars);
    let source_total = selected.len();
    let mut source_counts = BTreeMap::<String, usize>::new();
    let mut evidence = Vec::with_capacity(selected.len());
    let mut order = Vec::with_capacity(selected.len());
    for (index, entry) in selected.into_iter().enumerate() {
        let count = source_counts.entry(entry.source_id.clone()).or_insert(0);
        *count = count.saturating_add(1);
        let source_id = if *count == 1 {
            entry.source_id
        } else {
            format!("{}#{}", entry.source_id, *count)
        };
        let rank = index.saturating_add(1);
        let mut row = entry.value;
        if let Some(object) = row.as_object_mut() {
            object.insert("sourceId".to_owned(), json!(source_id));
            object.insert("rank".to_owned(), json!(rank));
        }
        order.push(source_id);
        evidence.push(row);
    }
    let coverage_status = if coverage_rank == 2 || truncated {
        "budget-exhausted"
    } else if coverage_rank == 1 || unreviewed > 0 || not_indexed > 0 {
        "incomplete"
    } else {
        "supported"
    };
    Some(json!({
        "evidence": evidence,
        "order": order,
        "coverage": {
            "status": coverage_status,
            "reviewedDocuments": reviewed,
            "unreviewedDocuments": unreviewed,
            "notIndexedDocuments": not_indexed,
        },
        "diagnostics": {
            "truncated": truncated || coverage_rank == 2,
            "budgetDropped": budget_dropped,
            "duplicatesDropped": duplicates_dropped,
            "evaluatedChunks": evaluated_chunks,
            "selectedDocuments": evidence
                .iter()
                .filter_map(|row| row.get("path").and_then(Value::as_str))
                .collect::<BTreeSet<_>>()
                .len(),
            "selectedChunks": source_total,
        },
        "budget": {
            "maxPassages": max_passages,
            "maxChars": max_chars,
            "usedChars": used_chars,
        },
    }))
}
#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use unicode_normalization::UnicodeNormalization;

    use std::collections::BTreeSet;

    use super::{
        PASSAGE_RADIUS_BYTES, ceil_char_boundary, floor_char_boundary, plan_indexed_evidence_json,
        scan_input_document, select_anchor, verify_indexed_evidence_json,
    };

    /// 없는 값을 대신하는 공유 `null`입니다.
    static NULL: Value = Value::Null;

    fn parse(input: &str) -> Value {
        serde_json::from_str(input).unwrap_or(Value::Null)
    }

    fn plan_of(input: &Value) -> Value {
        parse(&plan_indexed_evidence_json(&input.to_string()))
    }

    fn verify_of(input: &Value) -> Value {
        parse(&verify_indexed_evidence_json(&input.to_string()))
    }

    /// 객체 키를 읽고 없으면 `null`을 돌려줍니다.
    fn get<'a>(value: &'a Value, key: &str) -> &'a Value {
        value.get(key).unwrap_or(&NULL)
    }

    /// 배열 키를 복사합니다.
    fn rows(value: &Value, key: &str) -> Vec<Value> {
        get(value, key).as_array().cloned().unwrap_or_default()
    }

    /// 배열의 첫 행을 복사하고 없으면 `null`입니다.
    fn first_row(value: &Value, key: &str) -> Value {
        rows(value, key).first().cloned().unwrap_or(Value::Null)
    }

    /// 문자열 값을 복사하고 아니면 빈 문자열입니다.
    fn text(value: &Value) -> String {
        value.as_str().unwrap_or_default().to_owned()
    }

    /// 키 값이 기대 문자열인 첫 행입니다.
    fn find_row<'a>(rows: &'a [Value], key: &str, expected: &str) -> Option<&'a Value> {
        rows.iter()
            .find(|row| get(row, key).as_str() == Some(expected))
    }

    #[test]
    fn plan_query_tokens_preserve_position_kind_negation_and_phrase() {
        let plan = plan_of(&json!({
            "question": "\"설치 방법\" -deprecated runbook.md 2024",
            "documents": [{"path": "a.md", "text": "설치 방법 deprecated runbook.md 2024"}],
        }));
        let tokens = rows(&plan, "queryTokens");
        let install = find_row(&tokens, "text", "설치").unwrap_or(&NULL);
        assert_eq!(get(install, "position"), &json!(0));
        assert_eq!(get(install, "kind"), &json!("quoted"));
        assert_eq!(get(install, "phraseIndex"), &json!(0));
        let method = find_row(&tokens, "text", "방법").unwrap_or(&NULL);
        assert_eq!(get(method, "phraseIndex"), &json!(0));
        let negated = find_row(&tokens, "text", "deprecated").unwrap_or(&NULL);
        assert_eq!(get(negated, "negated"), &json!(true));
        let identifier = find_row(&tokens, "text", "runbook.md").unwrap_or(&NULL);
        assert_eq!(get(identifier, "kind"), &json!("identifier"));
        let number = find_row(&tokens, "text", "2024").unwrap_or(&NULL);
        assert_eq!(get(number, "kind"), &json!("number"));
        assert!(get(install, "field").is_string(), "field is a string");
    }

    #[test]
    fn plan_prefers_distinct_query_terms_over_repetition_or_candidate_start() {
        for with_candidate in [false, true] {
            let input = json!({
                "question": "cobalt longitudinal throughput",
                "documents": [{
                    "path": "synthetic.md",
                    "text": format!(
                        "{}\nA separate section explains cobalt longitudinal throughput together.",
                        "cobalt cobalt ".repeat(160)
                    ),
                    "startLine": 1,
                }],
                "budget": {"maxPassages": 1},
                "candidates": if with_candidate { json!([{
                    "path": "synthetic.md", "score": 0.8, "rank": 1,
                    "source": "vector", "queryIndex": 0, "startLine": 1, "endLine": 1,
                }]) } else { json!([]) },
            });
            let evidence = first_row(&plan_of(&input), "evidence");
            let quote = text(get(&evidence, "quote"));
            assert!(quote.contains("longitudinal throughput"));
        }
    }

    #[test]
    fn anchor_keeps_utf8_term_spans_inside_the_passage_window() -> Result<(), &'static str> {
        let document = scan_input_document(&json!({
            "path": "synthetic.md",
            "text": format!("{}은하 관측 조건", "잡음 ".repeat(400)),
        }))
        .ok_or("합성 문서")?;
        let matched = ["은하", "관측", "조건"]
            .into_iter()
            .map(str::to_owned)
            .collect();
        let anchor = select_anchor(&document, &matched, &[], Some(0)).ok_or("구절 위치")?;
        let start =
            floor_char_boundary(&document.text, anchor.saturating_sub(PASSAGE_RADIUS_BYTES));
        let end = ceil_char_boundary(&document.text, anchor.saturating_add(PASSAGE_RADIUS_BYTES));
        if !document
            .text
            .get(start..end)
            .unwrap_or_default()
            .contains("은하 관측 조건")
        {
            return Err("구절이 서로 다른 질의어를 포함해야 함");
        }
        if select_anchor(&document, &matched, &[0], None) != Some(0) {
            return Err("정확 구문 우선순위를 보존해야 함");
        }
        if select_anchor(&document, &BTreeSet::new(), &[], Some(7)) != Some(7) {
            return Err("본문 일치가 없을 때 후보 위치를 보존해야 함");
        }
        Ok(())
    }

    #[test]
    fn anchor_does_not_combine_terms_beyond_the_passage_width() -> Result<(), &'static str> {
        let document = scan_input_document(&json!({
            "path": "synthetic.md",
            "text": format!("alpha {} beta", "filler ".repeat(400)),
        }))
        .ok_or("합성 문서")?;
        let matched = ["alpha", "beta"].into_iter().map(str::to_owned).collect();
        let candidate = document.text.find("beta").ok_or("후보 위치")?;
        let anchor = select_anchor(&document, &matched, &[], Some(candidate)).ok_or("구절 위치")?;
        if anchor.abs_diff(candidate) >= PASSAGE_RADIUS_BYTES {
            return Err("멀리 떨어진 질의어를 한 구절로 합치지 않아야 함");
        }
        Ok(())
    }

    #[test]
    fn plan_uses_cross_language_variants_for_passage_scoring_not_phrase_claims() {
        let input = json!({
            "question": "저장소 지연",
            "queryVariants": ["\"storage latency\""],
            "documents": [
                {"path":"unrelated.md","text":"Storage room decoration and shelves.","revision":"1:1","indexed":true},
                {"path":"performance.md","text":"Storage latency depends on write batching. Storage latency improves with sequential writes.","revision":"1:1","indexed":true}
            ]
        });
        let plan = plan_of(&input);
        assert_eq!(
            plan.pointer("/evidence/0/path"),
            Some(&json!("performance.md"))
        );
        assert!(
            plan.get("phrases")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        );
        assert_eq!(plan.pointer("/evidence/0/phraseMatches"), Some(&json!(0)));
        assert!(
            plan.get("queryTokens")
                .and_then(Value::as_array)
                .is_some_and(|tokens| tokens
                    .iter()
                    .any(|token| token.get("text") == Some(&json!("latency"))))
        );
    }

    #[test]
    fn plan_bounds_variants_and_preserves_original_operators() {
        let mut input = json!({
            "question":"title:copper -glass \"write queue\"",
            "queryVariants":["copper glass \"storage latency\""],
            "documents":[{"path":"copper.md","text":"write queue storage latency","revision":"1:1","indexed":true}]
        });
        let plan = plan_of(&input);
        let tokens = plan
            .get("queryTokens")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        let glass = tokens
            .iter()
            .filter(|token| token.get("text") == Some(&json!("glass")))
            .collect::<Vec<_>>();
        assert_eq!(glass.len(), 1);
        assert_eq!(
            glass.first().and_then(|token| token.get("negated")),
            Some(&json!(true))
        );
        let copper = tokens
            .iter()
            .filter(|token| token.get("text") == Some(&json!("copper")))
            .collect::<Vec<_>>();
        assert_eq!(copper.len(), 1);
        assert_eq!(
            copper.first().and_then(|token| token.get("field")),
            Some(&json!("title"))
        );
        assert_eq!(
            plan.get("phrases").and_then(Value::as_array).map(Vec::len),
            Some(1)
        );
        for invalid in [
            json!(["a", "b", "c", "d"]),
            json!([5]),
            json!([""]),
            json!(["a".repeat(16_385)]),
        ] {
            if let Some(variants) = input.get_mut("queryVariants") {
                *variants = invalid;
            }
            assert!(plan_indexed_evidence_json(&input.to_string()).is_empty());
        }
    }

    #[test]
    fn plan_selects_ranked_passage_with_context_and_lines() {
        let plan = plan_of(&json!({
            "question": "설치 방법",
            "documents": [
                {"path": "a.md", "text": "프로젝트 소개\n설치 방법은 npm run build 입니다."},
                {"path": "b.md", "text": "설치 안내만 있습니다."},
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        let first = evidence.first().unwrap_or(&NULL);
        assert_eq!(get(first, "rank"), &json!(1));
        assert_eq!(get(first, "path"), &json!("a.md"));
        let quote = text(get(first, "quote"));
        assert!(quote.contains("설치"), "quote keeps the query token");
        assert!(
            get(first, "startLine").as_u64().unwrap_or_default() >= 1,
            "startLine is positive"
        );
        assert!(
            get(first, "endLine").as_u64().unwrap_or_default() >= 1,
            "endLine is positive"
        );
        assert!(
            get(first, "score").as_f64().unwrap_or_default() > 0.0,
            "score is positive"
        );
        assert!(
            text(get(first, "sourceId")).contains("a.md"),
            "sourceId keeps the path"
        );
        assert_eq!(get(first, "duplicateOf"), &Value::Null);
        assert!(
            get(first, "contextBefore").is_string(),
            "contextBefore is a string"
        );
        assert!(
            get(first, "contextAfter").is_string(),
            "contextAfter is a string"
        );
        let highlights = rows(first, "highlights");
        assert!(!highlights.is_empty(), "highlights are reported");
    }

    #[test]
    fn plan_reserves_one_passage_per_document_before_repeating_a_document() {
        let plan = plan_of(&json!({
            "question": "alpha",
            "documents": [
                {"path": "a.md", "text": "alpha ".repeat(12)},
                {"path": "a.md", "text": "alpha ".repeat(8)},
                {"path": "b.md", "text": "alpha"},
            ],
            "budget": {"maxDocuments": 3, "maxPassages": 2, "maxChars": 100_000},
        }));
        let paths = rows(&plan, "evidence")
            .into_iter()
            .filter_map(|row| row.get("path").and_then(Value::as_str).map(str::to_owned))
            .collect::<std::collections::BTreeSet<_>>();
        assert!(paths.contains("a.md"));
        assert!(paths.contains("b.md"));
    }

    #[test]
    fn plan_marks_duplicate_passages() {
        let plan = plan_of(&json!({
            "question": "설치 방법",
            "documents": [
                {"path": "a.md", "text": "설치 방법 안내"},
                {"path": "b.md", "text": "설치 방법 안내"},
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        let first = evidence.first().unwrap_or(&NULL);
        let second = evidence.get(1).unwrap_or(&NULL);
        assert_eq!(get(second, "duplicateOf"), get(first, "sourceId"));
    }

    #[test]
    fn plan_reports_budget_truncation_and_coverage() {
        let plan = plan_of(&json!({
            "question": "설치",
            "documents": [
                {"path": "a.md", "text": "설치 안내"},
                {"path": "b.md", "text": "설치 안내"},
                {"path": "c.md", "text": "설치 안내"},
            ],
            "budget": {"maxDocuments": 1, "maxPassages": 1},
        }));
        assert_eq!(rows(&plan, "evidence").len(), 1);
        let diagnostics = get(&plan, "diagnostics");
        assert_eq!(get(diagnostics, "truncated"), &json!(true));
        assert!(
            get(get(diagnostics, "droppedDocuments"), "budget")
                .as_u64()
                .unwrap_or_default()
                >= 1,
            "budget drops are reported"
        );
        assert_eq!(
            get(get(&plan, "coverage"), "status"),
            &json!("budget-exhausted")
        );
    }

    #[test]
    fn plan_reports_unmatched_terms_and_zero_hits() {
        let plan = plan_of(&json!({
            "question": "설치 알파베타",
            "documents": [{"path": "a.md", "text": "설치 안내"}],
        }));
        let unmatched = rows(get(&plan, "diagnostics"), "unmatchedTerms");
        assert!(
            unmatched.contains(&json!("알파베타")),
            "unmatched term is reported"
        );
        let empty = plan_of(&json!({
            "question": "감마델타",
            "documents": [{"path": "a.md", "text": "설치 안내"}],
        }));
        assert_eq!(rows(&empty, "evidence").len(), 0);
        assert!(
            get(get(&empty, "diagnostics"), "zeroHitReason").is_string(),
            "zero hit reason is reported"
        );
    }

    #[test]
    fn plan_ignores_english_function_words_when_content_terms_exist() {
        let plan = plan_of(&json!({
            "question": "When does the copper valve close?",
            "documents": [
                {"path": "function-only.md", "text": "The answer is not recorded."},
                {"path": "content.md", "text": "The copper valve closes after three pulses."},
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 1);
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("content.md")
        );
        let tokens = rows(&plan, "queryTokens");
        assert!(find_row(&tokens, "text", "the").is_none());
        assert!(find_row(&tokens, "text", "copper").is_some());
    }

    #[test]
    fn plan_preserves_a_query_that_contains_only_a_function_word() {
        let plan = plan_of(&json!({
            "question": "the",
            "documents": [{"path": "a.md", "text": "The exact word appears here."}],
        }));
        assert_eq!(rows(&plan, "evidence").len(), 1);
        assert!(find_row(&rows(&plan, "queryTokens"), "text", "the").is_some());
    }

    #[test]
    fn quoted_phrase_absent_from_batch_keeps_token_evidence() {
        let plan = plan_of(&json!({
            "question": "\"amber signal\" copper valve",
            "documents": [
                {"path": "a.md", "text": "Copper valve notes without the requested wording."},
                {"path": "b.md", "text": "Unrelated maintenance log."},
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert!(
            !evidence.is_empty(),
            "token evidence must survive a missing phrase"
        );
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("a.md")
        );
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "phraseMatches"),
            &json!(0)
        );
    }

    #[test]
    fn plan_prunes_korean_function_words_and_n_gram_fragments() {
        let plan = plan_of(&json!({
            "question": "가톨릭 고다드는 51장 51 설명해줘",
            "documents": [{"path": "a.md", "text": "가톨릭 전승과 고다드는 서로 다른 설명을 담는다."}],
        }));
        let tokens = rows(&plan, "queryTokens");
        assert!(find_row(&tokens, "text", "가톨릭").is_some());
        assert!(find_row(&tokens, "text", "고다드는").is_some());
        assert!(find_row(&tokens, "text", "51장").is_some());
        assert!(find_row(&tokens, "text", "가톨").is_none());
        assert!(find_row(&tokens, "text", "톨릭").is_none());
        assert!(find_row(&tokens, "text", "드는").is_none());
        assert!(find_row(&tokens, "text", "1장").is_none());
        assert!(find_row(&tokens, "text", "설명해줘").is_none());
        let number = find_row(&tokens, "text", "51");
        assert_eq!(
            number.and_then(|row| get(row, "kind").as_str()),
            Some("number")
        );
    }

    #[test]
    fn plan_preserves_a_query_that_contains_only_korean_function_words() {
        let plan = plan_of(&json!({
            "question": "설명해줘",
            "documents": [{"path": "a.md", "text": "설명해줘"}],
        }));
        assert!(find_row(&rows(&plan, "queryTokens"), "text", "설명해줘").is_some());
        assert_eq!(rows(&plan, "evidence").len(), 1);
    }

    #[test]
    fn plan_skips_documents_that_only_share_a_directory_name() {
        // 같은 디렉터리에 있다는 이유만으로 본문이 다른 문서를 근거로 올리지 않습니다.
        let plan = plan_of(&json!({
            "question": "시편 51장",
            "documents": [
                {
                    "path": "bible/psalms/051.md",
                    "title": "051장",
                    "text": "다윗의 고백이 시작된다."
                },
                {
                    "path": "bible/psalms/052.md",
                    "title": "052장",
                    "text": "다른 장의 본문만 있다."
                },
                {
                    "path": "bible/psalms/125.md",
                    "title": "125장",
                    "text": "또 다른 장의 본문만 있다."
                }
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 1, "only the matching chapter is evidence");
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("bible/psalms/051.md")
        );
    }

    #[test]
    fn plan_demotes_link_index_documents_below_content() {
        // 목차·색인 문서는 다른 문서를 안내할 뿐이므로 같은 단어를 담은 본문보다 낮습니다.
        let index_lines = (1..=20)
            .map(|number| format!("- [[bible/psalms/{number:03}|{number}장]]"))
            .collect::<Vec<_>>()
            .join("\n");
        let plan = plan_of(&json!({
            "question": "시편 51장",
            "documents": [
                {"path": "bible/psalms/000-목차.md", "title": "000-목차", "text": index_lines},
                {
                    "path": "bible/psalms/051.md",
                    "title": "051장",
                    "text": "시편 51장 다윗의 고백\n주님, 저를 불쌍히 여기소서."
                }
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("bible/psalms/051.md"),
            "content outranks a link index"
        );
    }

    #[test]
    fn plan_filters_documents_deterministically() {
        let plan = plan_of(&json!({
            "question": "설치",
            "documents": [
                {"path": "a.md", "text": "설치 안내"},
                {"path": "b.txt", "text": "설치 안내"},
                {"path": "folder/c.md", "text": "설치 안내"},
            ],
            "filters": {"pathPrefixes": ["folder"], "extensions": ["md"]},
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 1);
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("folder/c.md")
        );
        assert_eq!(
            get(
                get(get(&plan, "diagnostics"), "droppedDocuments"),
                "filtered"
            ),
            &json!(2)
        );
    }

    #[test]
    fn plan_flags_negated_terms_near_passage() {
        let plan = plan_of(&json!({
            "question": "설치 -deprecated",
            "documents": [{"path": "a.md", "text": "설치 deprecated 안내"}],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "negatedNearby"),
            &json!(true)
        );
    }

    #[test]
    fn plan_keeps_exception_evidence_for_positive_query() {
        let plan = plan_of(&json!({
            "question": "알파",
            "documents": [{"path": "e.md", "text": "알파 원칙 안내\n알파 예외 조건"}],
        }));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        assert_eq!(get(first, "negatedNearby"), &json!(false));
        assert!(
            text(get(first, "quote")).contains("알파"),
            "exception source keeps query evidence"
        );
        assert!(
            get(first, "score").as_f64().unwrap_or_default() > 0.0,
            "exception source is not penalized"
        );
    }

    #[test]
    fn plan_negative_operator_keeps_evidence_visible() {
        let plan = plan_of(&json!({
            "question": "알파 -베타",
            "documents": [{"path": "n.md", "text": "알파 베타 혼합"}],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 1);
        let first = evidence.first().unwrap_or(&NULL);
        assert_eq!(get(first, "negatedNearby"), &json!(true));
        assert!(
            text(get(first, "quote")).contains("알파"),
            "evidence stays visible despite the negation penalty"
        );
    }

    #[test]
    fn verify_reports_every_quote_status() {
        let documents = json!([
            {"path": "a.md", "revision": "h1", "text": "프로젝트\n설치 방법 안내", "indexed": true, "reviewState": "reviewed"},
            {"path": "u.md", "text": "설치 방법", "indexed": true, "reviewState": "unreviewed"},
            {"path": "folder/s.md", "text": "설치 방법", "indexed": true, "reviewState": "reviewed"},
        ]);
        let verified = verify_of(&json!({
            "evidence": [{"sourceId": "a.md#L2-L2", "path": "a.md", "revision": "h1", "startLine": 2, "endLine": 2, "quote": "설치 방법"}],
            "documents": documents,
            "scopes": [],
        }));
        let status = first_row(&verified, "statuses");
        assert_eq!(get(&status, "status"), &json!("verified"));
        assert_eq!(get(&status, "exists"), &json!(true));
        assert_eq!(get(&status, "lineMatches"), &json!(true));
        assert_eq!(get(&status, "revisionState"), &json!("match"));
        assert_eq!(get(&status, "reviewState"), &json!("reviewed"));

        let missing = verify_of(&json!({
            "evidence": [{"sourceId": "a.md#L2-L2", "path": "a.md", "revision": "h1", "startLine": 2, "endLine": 2, "quote": "없는 문장"}],
            "documents": documents,
        }));
        let status = first_row(&missing, "statuses");
        assert_eq!(get(&status, "status"), &json!("quote-missing"));
        assert_eq!(get(&status, "exists"), &json!(false));

        let misplaced = verify_of(&json!({
            "evidence": [{"sourceId": "a.md#L9-L9", "path": "a.md", "revision": "h1", "startLine": 9, "endLine": 9, "quote": "설치 방법"}],
            "documents": documents,
        }));
        let status = first_row(&misplaced, "statuses");
        assert_eq!(get(&status, "status"), &json!("position-mismatch"));
        assert_eq!(get(&status, "lineMatches"), &json!(false));

        let stale = verify_of(&json!({
            "evidence": [{"sourceId": "a.md#L2-L2", "path": "a.md", "revision": "h2", "startLine": 2, "endLine": 2, "quote": "설치 방법"}],
            "documents": documents,
        }));
        let status = first_row(&stale, "statuses");
        assert_eq!(get(&status, "status"), &json!("revision-mismatch"));
        assert_eq!(get(&status, "revisionState"), &json!("mismatch"));

        let unknown_revision = verify_of(&json!({
            "evidence": [{"sourceId": "a.md#L2-L2", "path": "a.md", "startLine": 2, "endLine": 2, "quote": "설치 방법"}],
            "documents": documents,
        }));
        let status = first_row(&unknown_revision, "statuses");
        assert_eq!(get(&status, "status"), &json!("verified"));
        assert_eq!(get(&status, "revisionState"), &json!("unknown"));

        let unreviewed = verify_of(&json!({
            "evidence": [{"sourceId": "u.md#L1-L1", "path": "u.md", "startLine": 1, "endLine": 1, "quote": "설치 방법"}],
            "documents": documents,
        }));
        let status = first_row(&unreviewed, "statuses");
        assert_eq!(get(&status, "status"), &json!("unreviewed"));
        assert_eq!(get(&status, "reviewState"), &json!("unreviewed"));

        let out_of_scope = verify_of(&json!({
            "evidence": [{"sourceId": "folder/s.md#L1-L1", "path": "folder/s.md", "startLine": 1, "endLine": 1, "quote": "설치 방법"}],
            "documents": documents,
            "scopes": ["other"],
        }));
        let status = first_row(&out_of_scope, "statuses");
        assert_eq!(get(&status, "status"), &json!("out-of-scope"));
        assert_eq!(get(&status, "scopeState"), &json!("out-of-scope"));

        let not_indexed = verify_of(&json!({
            "evidence": [{"sourceId": "z.md#L1-L1", "path": "z.md", "startLine": 1, "endLine": 1, "quote": "설치 방법"}],
            "documents": documents,
        }));
        assert_eq!(
            get(&first_row(&not_indexed, "statuses"), "status"),
            &json!("not-indexed")
        );
    }

    #[test]
    fn verify_suggests_only_unique_current_quote_addresses_without_accepting_them() {
        let evidence = json!([{"sourceId": "old", "path": "a.md", "revision": "old", "startLine": 2, "endLine": 2, "quote": "고유 구절"}]);
        let document = json!({"path": "a.md", "revision": "new", "startLine": 10, "text": "도입\n고유 구절", "indexed": true, "reviewState": "reviewed"});
        let result = verify_of(&json!({"evidence": evidence, "documents": [document]}));
        let status = first_row(&result, "statuses");
        assert_eq!(get(&status, "status"), &json!("revision-mismatch"));
        assert_eq!(
            get(&status, "relocation"),
            &json!({"startLine": 11, "endLine": 11, "revision": "new"})
        );
        // 겹치는 청크에서 같은 절대 주소를 두 번 보아도 하나의 위치입니다.
        let overlap = verify_of(&json!({"evidence": evidence, "documents": [document, document]}));
        assert_eq!(
            get(&first_row(&overlap, "statuses"), "relocation"),
            get(&status, "relocation")
        );
        for documents in [
            json!([{"path": "a.md", "revision": "new", "text": "고유 구절\n고유 구절"}]),
            json!([{"path": "a.md", "revision": "new", "text": "고유 구절", "reviewState": "unreviewed"}]),
            json!([{"path": "a.md", "revision": "new", "text": "고유 구절", "indexed": false}]),
            json!([{"path": "a.md", "text": "고유 구절"}]),
        ] {
            let result = verify_of(&json!({"evidence": evidence, "documents": documents}));
            assert!(get(&first_row(&result, "statuses"), "relocation").is_null());
        }
        let excluded = verify_of(
            &json!({"evidence": evidence, "documents": [document], "scopes": ["elsewhere"]}),
        );
        assert!(get(&first_row(&excluded, "statuses"), "relocation").is_null());
    }

    #[test]
    fn verify_computes_korean_quote_line() {
        let verified = verify_of(&json!({
            "evidence": [{"sourceId": "k.md#L2-L2", "path": "k.md", "startLine": 2, "endLine": 2, "quote": "알파 베타"}],
            "documents": [{"path": "k.md", "text": "첫 줄\n둘째 줄 알파 베타", "indexed": true, "reviewState": "reviewed"}],
        }));
        let status = first_row(&verified, "statuses");
        assert_eq!(get(&status, "status"), &json!("verified"));
        assert_eq!(get(&status, "lineMatches"), &json!(true));
    }

    #[test]
    fn verify_accepts_a_later_occurrence_at_the_requested_absolute_line() {
        let verified = verify_of(&json!({
            "evidence": [{"sourceId": "repeat.md#L3-L3", "path": "repeat.md", "startLine": 3, "endLine": 3, "quote": "알파 베타"}],
            "documents": [{"path": "repeat.md", "text": "알파 베타\n\n알파 베타", "indexed": true, "reviewState": "reviewed"}],
        }));
        let status = first_row(&verified, "statuses");
        assert_eq!(get(&status, "status"), &json!("verified"));
        assert_eq!(get(&status, "lineMatches"), &json!(true));
    }

    #[test]
    fn plan_atomic_identifier_field_match_orders_full_identifier_first() {
        let plan = plan_of(&json!({
            "question": "orbital-qa7-handoff",
            "documents": [
                {
                    "path": "notes/orbital-qa7-handoff.md",
                    "title": "운영 메모",
                    "text": "일반 본문",
                },
                {
                    "path": "notes/handoff-orbital-qa7.md",
                    "title": "운영 메모",
                    "text": "일반 본문",
                },
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("notes/orbital-qa7-handoff.md"),
            "식별자 전체가 필드에 있는 문서가 먼저 옵니다"
        );
        let full = find_row(&evidence, "path", "notes/orbital-qa7-handoff.md").unwrap_or(&NULL);
        let partial = find_row(&evidence, "path", "notes/handoff-orbital-qa7.md").unwrap_or(&NULL);
        let full_score = get(full, "score").as_f64().unwrap_or_default();
        let partial_score = get(partial, "score").as_f64().unwrap_or_default();
        assert!(
            full_score > partial_score,
            "전체 식별자 문서가 조각만 겹치는 문서보다 높아야 합니다: {full_score} vs {partial_score}"
        );
    }

    #[test]
    fn contains_atomic_identifier_requires_alphanumeric_boundaries() {
        assert!(super::contains_atomic_identifier(
            "notes/orbital-qa7-handoff.md",
            "orbital-qa7-handoff"
        ));
        assert!(!super::contains_atomic_identifier(
            "notes/xorbital-qa7-handoff.md",
            "orbital-qa7-handoff"
        ));
        assert!(!super::contains_atomic_identifier(
            "notes/orbital-qa7-handoffx.md",
            "orbital-qa7-handoff"
        ));
        assert!(!super::contains_atomic_identifier("notes/a.md", ""));
    }

    #[test]
    fn plan_candidate_prior_uses_signal_score_ratio() {
        let plan = plan_of(&json!({
            "question": "무관한 질문",
            "documents": [
                {"path": "z-primary.md", "title": "운영 메모", "text": "일반 본문"},
                {"path": "a-secondary.md", "title": "운영 메모", "text": "일반 본문"},
            ],
            "candidates": [
                {"path": "z-primary.md", "source": "bm25", "rank": 1, "score": 100.0},
                {"path": "a-secondary.md", "source": "bm25", "rank": 1, "score": 20.0},
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("z-primary.md"),
            "같은 순위에서는 신호 점수가 높은 후보가 먼저 옵니다"
        );
    }

    #[test]
    fn plan_candidate_signals_force_evidence_and_signal() {
        let plan = plan_of(&json!({
            "question": "알파",
            "documents": [
                {"path": "a.md", "text": "관련 없는 본문"},
                {"path": "b.md", "text": "알파 본문"},
            ],
            "candidates": [{"path": "a.md", "source": "bm25", "rank": 1, "score": 0.9}],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        let forced = find_row(&evidence, "path", "a.md").unwrap_or(&NULL);
        assert!(
            text(get(forced, "signal")).contains("candidate"),
            "candidate prior is reported in the signal"
        );
    }

    #[test]
    fn plan_inventory_counts_feed_coverage() {
        let plan = plan_of(&json!({
            "question": "알파",
            "documents": [{"path": "a.md", "text": "알파", "indexed": true, "reviewState": "reviewed"}],
            "inventory": {"indexedCount": 100, "unreviewedCount": 3, "notIndexedCount": 2},
        }));
        let coverage = get(&plan, "coverage");
        assert_eq!(get(coverage, "reviewedDocuments"), &json!(97));
        assert_eq!(get(coverage, "unreviewedDocuments"), &json!(3));
        assert_eq!(get(coverage, "notIndexedDocuments"), &json!(2));
        assert_eq!(get(coverage, "status"), &json!("incomplete"));
    }

    #[test]
    fn plan_filters_tags_and_modified_at() {
        let plan = plan_of(&json!({
            "question": "알파",
            "documents": [
                {"path": "a.md", "text": "알파", "tags": ["final"], "modifiedAt": 200},
                {"path": "b.md", "text": "알파", "tags": ["draft"], "modifiedAt": 200},
                {"path": "c.md", "text": "알파", "tags": ["final"], "modifiedAt": 100},
            ],
            "filters": {"tags": ["final"], "modifiedAfter": 150},
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 1);
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("a.md")
        );
        assert_eq!(
            get(
                get(get(&plan, "diagnostics"), "droppedDocuments"),
                "filtered"
            ),
            &json!(2)
        );
    }

    #[test]
    fn plan_keeps_ms_epoch_modified_at_beyond_u32() {
        let ms_epoch = 1_700_000_000_000_u64;
        let above_u32 = u64::from(u32::MAX) + 1;
        let plan = plan_of(&json!({
            "question": "알파",
            "documents": [
                {"path": "a.md", "text": "알파", "modifiedAt": ms_epoch},
                {"path": "b.md", "text": "알파", "modifiedAt": above_u32},
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert!(
            find_row(&evidence, "path", "a.md").is_some(),
            "ms epoch 문서가 살아남습니다"
        );
        assert!(
            find_row(&evidence, "path", "b.md").is_some(),
            "u32 상한 초과 문서가 살아남습니다"
        );
        let dropped = get(get(&plan, "diagnostics"), "droppedDocuments");
        assert_eq!(get(dropped, "filtered"), &json!(0));
        assert_eq!(get(dropped, "budget"), &json!(0));
    }

    #[test]
    fn plan_filters_ms_epoch_modified_after() {
        let threshold = 1_700_000_000_000_u64;
        let plan = plan_of(&json!({
            "question": "알파",
            "documents": [
                {"path": "new.md", "text": "알파", "modifiedAt": threshold + 1},
                {"path": "edge.md", "text": "알파", "modifiedAt": threshold},
                {"path": "old.md", "text": "알파", "modifiedAt": threshold - 1},
            ],
            "filters": {"modifiedAfter": threshold},
        }));
        let evidence = rows(&plan, "evidence");
        assert!(
            find_row(&evidence, "path", "new.md").is_some(),
            "하한 뒤 문서는 통과합니다"
        );
        assert!(
            find_row(&evidence, "path", "edge.md").is_some(),
            "하한과 같은 문서는 통과합니다"
        );
        assert!(
            find_row(&evidence, "path", "old.md").is_none(),
            "하한 앞 문서는 탈락합니다"
        );
        assert_eq!(
            get(
                get(get(&plan, "diagnostics"), "droppedDocuments"),
                "filtered"
            ),
            &json!(1)
        );
    }

    #[test]
    fn plan_rejects_invalid_timestamps() {
        let with_document = |modified: &str| {
            format!(
                r#"{{"question":"알파","documents":[{{"path":"a.md","text":"알파","modifiedAt":{modified}}}]}}"#
            )
        };
        let with_filter = |modified: &str| {
            format!(
                r#"{{"question":"알파","documents":[{{"path":"a.md","text":"알파","modifiedAt":1700000000000}}],"filters":{{"modifiedAfter":{modified}}}}}"#
            )
        };
        let invalid_values = [
            "-1",
            r#""1700000000000""#,
            "1700000000000.5",
            "18446744073709551616",
        ];
        for invalid in invalid_values {
            assert!(
                plan_indexed_evidence_json(&with_document(invalid)).is_empty(),
                "문서 타임스탬프 {invalid}는 거절합니다"
            );
            assert!(
                plan_indexed_evidence_json(&with_filter(invalid)).is_empty(),
                "필터 타임스탬프 {invalid}는 거절합니다"
            );
        }
        assert!(
            !plan_indexed_evidence_json(&with_document("18446744073709551615")).is_empty(),
            "u64 상한 이하 값은 받습니다"
        );
        assert!(
            !plan_indexed_evidence_json(&with_filter("0")).is_empty(),
            "0 하한은 받습니다"
        );
    }

    #[test]
    fn plan_matches_quoted_phrase_and_negated_quote() {
        let plan = plan_of(&json!({
            "question": "\"quartz handshake\" -\"legacy path\" runbook-7",
            "documents": [
                {"path": "a.md", "text": "quartz handshake 절차와 legacy path 금지"},
                {"path": "b.md", "text": "quartz handshake 절차 runbook-7"},
            ],
        }));
        let phrases = rows(&plan, "phrases");
        assert_eq!(phrases.len(), 2);
        assert_eq!(
            get(phrases.get(1).unwrap_or(&NULL), "negated"),
            &json!(true)
        );
        let tokens = rows(&plan, "queryTokens");
        let identifier = find_row(&tokens, "text", "runbook-7").unwrap_or(&NULL);
        assert_eq!(get(identifier, "kind"), &json!("identifier"));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        assert!(
            get(first, "phraseMatches").as_u64().unwrap_or_default() >= 1,
            "phrase match is counted"
        );
        let a = find_row(&evidence, "path", "a.md").unwrap_or(&NULL);
        assert_eq!(get(a, "negatedNearby"), &json!(true));
        assert!(
            evidence
                .iter()
                .any(|item| { rows(item, "exactSignals").contains(&json!("identifier")) }),
            "identifier exact signal is reported"
        );
    }

    #[test]
    fn quoted_phrase_rejects_partial_term_and_forced_candidate_only_matches() {
        let plan = plan_of(&json!({
            "question": "\"quartz handshake\"",
            "documents": [
                {"path": "exact.md", "text": "The quartz handshake completes first."},
                {"path": "partial.md", "text": "Quartz startup notes without the required adjacency."},
            ],
            "candidates": [
                {"path": "partial.md", "source": "bm25", "rank": 1, "score": 1.0}
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 1);
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("exact.md")
        );
        assert!(
            evidence
                .iter()
                .all(|item| get(item, "phraseMatches").as_u64().unwrap_or_default() > 0)
        );
    }

    #[test]
    fn comparison_facets_are_not_removed_by_the_main_facet_phrase_filter() {
        let plan = plan_of(&json!({
            "question": "Compare \"alpha beta\" and gamma",
            "documents": [
                {"path": "alpha.md", "text": "Alpha beta is exact."},
                {"path": "gamma.md", "text": "Gamma is documented separately."},
            ],
            "candidates": [
                {"path": "alpha.md", "source": "bm25", "rank": 1, "score": 1.0, "startLine": 1, "endLine": 1, "queryIndex": 1},
                {"path": "gamma.md", "source": "bm25", "rank": 1, "score": 1.0, "startLine": 1, "endLine": 1, "queryIndex": 2}
            ],
            "budget": {"maxPassages": 2},
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        assert!(
            evidence
                .iter()
                .any(|item| get(item, "path") == &json!("alpha.md"))
        );
        assert!(
            evidence
                .iter()
                .any(|item| get(item, "path") == &json!("gamma.md"))
        );
    }

    #[test]
    fn verify_finds_quote_in_later_chunk() {
        let report = verify_of(&json!({
            "evidence": [{"sourceId": "c.md#L50-L50", "path": "c.md", "revision": "h1", "startLine": 50, "endLine": 50, "quote": "알파 베타"}],
            "documents": [
                {"path": "c.md", "revision": "h1", "text": "첫 조각", "startLine": 1, "indexed": true, "reviewState": "reviewed"},
                {"path": "c.md", "revision": "h1", "text": "알파 베타 조각", "startLine": 50, "indexed": true, "reviewState": "reviewed"},
            ],
        }));
        let status = first_row(&report, "statuses");
        assert_eq!(get(&status, "status"), &json!("verified"));
        assert_eq!(get(&status, "lineMatches"), &json!(true));
    }

    #[test]
    fn verify_keeps_overlapping_line_ranges_independent() {
        let report = verify_of(&json!({
            "evidence": [
                {"sourceId": "d.md#L3-L4", "path": "d.md", "startLine": 3, "endLine": 4, "quote": "알파 3행\n4행"},
                {"sourceId": "d.md#L4-L5", "path": "d.md", "startLine": 4, "endLine": 5, "quote": "4행\n베타 5행"},
            ],
            "documents": [{"path": "d.md", "text": "1행\n2행\n알파 3행\n4행\n베타 5행", "indexed": true, "reviewState": "reviewed"}],
        }));
        let statuses = rows(&report, "statuses");
        let first = statuses.first().unwrap_or(&NULL);
        let second = statuses.get(1).unwrap_or(&NULL);
        assert_eq!(get(first, "status"), &json!("verified"));
        assert_eq!(get(second, "status"), &json!("verified"));
        assert_eq!(get(first, "duplicateOf"), &Value::Null);
        assert_eq!(get(second, "duplicateOf"), &Value::Null);
    }

    #[test]
    fn verify_handles_unicode_before_quote() {
        let report = verify_of(&json!({
            "evidence": [{"sourceId": "u.md#L2-L2", "path": "u.md", "startLine": 2, "endLine": 2, "quote": "알파 베타"}],
            "documents": [{"path": "u.md", "text": "😀😀 이모지\n알파 베타 줄", "indexed": true, "reviewState": "reviewed"}],
        }));
        let status = first_row(&report, "statuses");
        assert_eq!(get(&status, "status"), &json!("verified"));
        assert_eq!(get(&status, "lineMatches"), &json!(true));
    }

    /// merge 출력의 공유 null입니다.
    static MERGE_NULL: Value = Value::Null;

    /// merge 키를 읽고 없으면 `null`입니다.
    fn merged_get<'a>(value: &'a Value, key: &str) -> &'a Value {
        value.get(key).unwrap_or(&MERGE_NULL)
    }

    /// 병합 입력을 실행합니다.
    fn merge_of(input: &Value) -> Value {
        parse(&super::merge_indexed_evidence_plans_json(
            &input.to_string(),
        ))
    }

    /// 증거 행 시그니처 목록입니다.
    fn signatures(merged: &Value) -> Vec<String> {
        merged_get(merged, "evidence")
            .as_array()
            .map(|rows| {
                rows.iter()
                    .map(|row| {
                        format!(
                            "{}|{}|{}|{}",
                            row.get("sourceId").and_then(Value::as_str).unwrap_or(""),
                            row.get("path").and_then(Value::as_str).unwrap_or(""),
                            row.get("startLine").and_then(Value::as_u64).unwrap_or(0),
                            row.get("score").and_then(Value::as_f64).unwrap_or(0.0),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 간단한 계획 JSON을 만듭니다.
    fn plan(rows: &Value, coverage: Option<&str>) -> Value {
        coverage.map_or_else(
            || json!({"evidence": rows}),
            |status| {
                json!({"evidence": rows, "coverage": {"status": status, "reviewedDocuments": 4, "unreviewedDocuments": 1, "notIndexedDocuments": 0}})
            },
        )
    }

    #[test]
    fn merge_is_partition_and_order_invariant() {
        let left = plan(
            &json!([
                {"sourceId": "a.md#L1-L1", "path": "a.md", "startLine": 1, "endLine": 1, "quote": "알파", "score": 1.0},
                {"sourceId": "c.md#L5-L5", "path": "c.md", "startLine": 5, "endLine": 5, "quote": "감마", "score": 0.5}
            ]),
            None,
        );
        let right = plan(
            &json!([
                {"sourceId": "b.md#L2-L2", "path": "b.md", "startLine": 2, "endLine": 2, "quote": "베타", "score": 1.0}
            ]),
            None,
        );
        let forward = merge_of(&json!({"plans": [left, right]}));
        let backward = merge_of(&json!({"plans": [right, left]}));
        assert_eq!(signatures(&forward), signatures(&backward));
        let signature = signatures(&forward);
        assert_eq!(
            signature.first().map(String::as_str),
            Some("a.md#L1-L1|a.md|1|1")
        );
        assert_eq!(
            signature.get(1).map(String::as_str),
            Some("b.md#L2-L2|b.md|2|1")
        );
    }

    #[test]
    fn merge_batch_rank_rrf_keeps_257_document_partition_order() {
        let mut documents = Vec::with_capacity(257);
        for index in 0..257 {
            let document = match index {
                0 => json!({"path": "exact.md", "text": "alpha beta spec-257"}),
                256 => json!({"path": "phrase.md", "text": "alpha beta only"}),
                _ => json!({"path": format!("filler-{index}.md"), "text": "unrelated body"}),
            };
            documents.push(document);
        }
        let plan_slice = |slice: &[Value]| {
            plan_of(&json!({
                "question": "\"alpha beta\" spec-257",
                "documents": slice,
                "budget": {"maxPassages": 4},
            }))
        };
        let target_order = |merged: &Value| {
            rows(merged, "evidence")
                .iter()
                .filter_map(|row| row.get("path").and_then(Value::as_str))
                .filter(|path| matches!(*path, "exact.md" | "phrase.md"))
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        let split = |at: usize| {
            vec![
                plan_slice(documents.get(..at).unwrap_or_default()),
                plan_slice(documents.get(at..).unwrap_or_default()),
            ]
        };
        let partitions = [
            vec![plan_slice(&documents)],
            split(256),
            split(1),
            split(128),
        ];
        let expected = vec!["exact.md".to_owned(), "phrase.md".to_owned()];
        for plans in &partitions {
            let reversed = plans.iter().rev().cloned().collect::<Vec<_>>();
            let forward = merge_of(&json!({"plans": plans}));
            let backward = merge_of(&json!({"plans": reversed}));
            assert_eq!(forward, backward);
            assert_eq!(target_order(&forward), expected);
        }
    }

    #[test]
    fn merge_reranks_missing_and_duplicate_plan_ranks() {
        let missing = merge_of(&json!({
            "plans": [
                plan(&json!([
                    {"sourceId": "a.md#L1-L1", "path": "a.md", "startLine": 1, "endLine": 1, "quote": "a", "score": 1.0},
                    {"sourceId": "b.md#L1-L1", "path": "b.md", "startLine": 1, "endLine": 1, "quote": "b", "score": 0.5}
                ]), None),
                plan(&json!([
                    {"sourceId": "c.md#L1-L1", "path": "c.md", "startLine": 1, "endLine": 1, "quote": "c", "score": 0.1, "rank": 1}
                ]), None)
            ]
        }));
        assert_eq!(
            signatures(&missing)
                .iter()
                .map(|signature| signature.split('|').nth(1).unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["a.md", "c.md", "b.md"]
        );

        let duplicate = merge_of(&json!({
            "plans": [
                plan(&json!([
                    {"sourceId": "d.md#L1-L1", "path": "d.md", "startLine": 1, "endLine": 1, "quote": "d", "score": 1.0, "rank": 1},
                    {"sourceId": "e.md#L1-L1", "path": "e.md", "startLine": 1, "endLine": 1, "quote": "e", "score": 0.5, "rank": 1}
                ]), None),
                plan(&json!([
                    {"sourceId": "f.md#L1-L1", "path": "f.md", "startLine": 1, "endLine": 1, "quote": "f", "score": 0.1, "rank": 1}
                ]), None)
            ]
        }));
        assert_eq!(
            signatures(&duplicate)
                .iter()
                .map(|signature| signature.split('|').nth(1).unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["d.md", "f.md", "e.md"]
        );
    }

    #[test]
    fn merge_dedupes_and_reports_budget_drops() {
        let duplicate = json!([
            {"sourceId": "d.md#L3-L3", "path": "d.md", "startLine": 3, "endLine": 3, "quote": "같은 인용", "score": 0.9},
            {"sourceId": "e.md#L4-L4", "path": "e.md", "startLine": 4, "endLine": 4, "quote": "다른 인용", "score": 0.8}
        ]);
        let merged = merge_of(&json!({
            "plans": [
                plan(&duplicate, None),
                plan(&json!([{"sourceId": "d.md#L3-L3", "path": "d.md", "startLine": 3, "endLine": 3, "quote": "같은 인용", "score": 0.9}]), None)
            ],
            "budget": {"maxPassages": 1},
        }));
        assert_eq!(rows(&merged, "evidence").len(), 1);
        assert_eq!(
            merged_get(merged_get(&merged, "diagnostics"), "duplicatesDropped"),
            &json!(1)
        );
        assert_eq!(
            merged_get(merged_get(&merged, "diagnostics"), "budgetDropped"),
            &json!(1)
        );
        assert_eq!(
            merged_get(merged_get(&merged, "diagnostics"), "truncated"),
            &json!(true)
        );
        assert_eq!(
            merged_get(merged_get(&merged, "coverage"), "status"),
            &json!("budget-exhausted")
        );
    }

    #[test]
    fn merge_reserves_both_facets_before_the_global_fill() {
        let merged = merge_of(&json!({
            "plans": [
                plan(&json!([
                    {"sourceId": "a-copper.md#L1-L1", "path": "a-copper.md", "startLine": 1, "endLine": 1, "quote": "copper", "score": 1.0, "queryIndexes": [1]}
                ]), None),
                plan(&json!([
                    {"sourceId": "b-filler.md#L1-L1", "path": "b-filler.md", "startLine": 1, "endLine": 1, "quote": "filler", "score": 1.0}
                ]), None),
                plan(&json!([
                    {"sourceId": "c-glass.md#L1-L1", "path": "c-glass.md", "startLine": 1, "endLine": 1, "quote": "glass", "score": 0.1, "queryIndexes": [2]}
                ]), None)
            ],
            "budget": {"maxPassages": 2},
        }));
        let evidence = rows(&merged, "evidence");
        let paths = evidence
            .iter()
            .filter_map(|row| row.get("path").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["a-copper.md", "c-glass.md"]);
        assert_eq!(
            merged_get(merged_get(&merged, "diagnostics"), "budgetDropped"),
            &json!(1)
        );
        assert_eq!(
            merged_get(merged_get(&merged, "diagnostics"), "truncated"),
            &json!(true)
        );
    }

    #[test]
    fn merge_keeps_source_ids_unique() {
        let merged = merge_of(&json!({
            "plans": [
                plan(&json!([
                    {"sourceId": "same.md#L2-L2", "path": "same.md", "startLine": 2, "endLine": 2, "quote": "첫 인용", "score": 0.9},
                    {"sourceId": "same.md#L2-L2", "path": "same.md", "startLine": 2, "endLine": 2, "quote": "둘째 인용", "score": 0.7}
                ]), None)
            ],
        }));
        let rows = signatures(&merged);
        assert_eq!(rows.len(), 2);
        assert_ne!(rows.first(), rows.get(1));
        assert!(rows.iter().any(|row| row.starts_with("same.md#L2-L2#2|")));
    }

    #[test]
    fn verify_handles_empty_quote_and_missing_document() {
        let empty_quote = verify_of(&json!({
            "evidence": [{"sourceId": "n.md#L1-L1", "path": "n.md", "quote": ""}],
            "documents": [{"path": "n.md", "text": "본문", "indexed": true, "reviewState": "reviewed"}],
        }));
        assert_eq!(
            get(&first_row(&empty_quote, "statuses"), "status"),
            &json!("quote-missing")
        );
        let stale_document = verify_of(&json!({
            "evidence": [{"sourceId": "s.md#L1-L1", "path": "s.md", "revision": "old", "startLine": 1, "endLine": 1, "quote": "본문"}],
            "documents": [{"path": "s.md", "revision": "new", "text": "본문", "indexed": true, "reviewState": "reviewed"}],
        }));
        assert_eq!(
            get(&first_row(&stale_document, "statuses"), "status"),
            &json!("revision-mismatch")
        );
        let missing = verify_of(&json!({
            "evidence": [{"sourceId": "x.md#L1-L1", "path": "x.md", "startLine": 1, "endLine": 1, "quote": "본문"}],
            "documents": [],
        }));
        assert_eq!(
            get(&first_row(&missing, "statuses"), "status"),
            &json!("not-indexed")
        );
    }
    #[test]
    fn plan_matches_aliases_as_a_document_field() {
        // 본문에 없는 별칭만으로도 문서가 근거 후보가 되어야 합니다.
        let plan = plan_of(&json!({
            "question": "wisdom",
            "documents": [
                {
                    "path": "notes/b-007.md",
                    "title": "일곱째 묶음",
                    "aliases": ["Wisdom", "지혜서"],
                    "text": "본문에는 해당 낱말이 없다",
                },
                {
                    "path": "notes/b-008.md",
                    "title": "여덟째 묶음",
                    "text": "본문에도 별칭에도 없는 다른 내용",
                },
            ],
        }));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        assert_eq!(text(get(first, "path")), "notes/b-007.md");
        let matches = rows(first, "fieldMatches");
        assert!(
            matches.contains(&json!("alias")),
            "alias 필드 일치가 기록되어야 한다"
        );
    }

    #[test]
    fn plan_matches_unprefixed_tokens_against_title_and_path() {
        let plan = plan_of(&json!({
            "question": "quartz handbook",
            "documents": [{
                "path": "notes/handbook-2024.md",
                "title": "Quartz Operation Handbook",
                "text": "본문에는 해당 단어가 없다",
            }],
        }));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        assert!(
            get(first, "fieldScore").as_f64().unwrap_or_default() > 0.0,
            "field score is positive"
        );
        let matches = rows(first, "fieldMatches");
        assert!(matches.contains(&json!("title")), "title field matched");
        assert!(matches.contains(&json!("path")), "path field matched");
        let names = matches.iter().filter_map(Value::as_str).collect::<Vec<_>>();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(names, sorted, "fieldMatches는 정렬·중복 없이 나온다");
    }

    #[test]
    fn plan_keeps_rare_path_token_ahead_of_repeated_common_fields() {
        // 흔한 토큰이 제목·헤딩·경로·본문에 반복된 문서보다,
        // 희귀 토큰을 경로에만 담은 문서가 앞서야 합니다.
        let filler = "합성 배치 기록은 지역 아카이브에 남긴다. ".repeat(12);
        let plan = plan_of(&json!({
            "question": "cendral titletoken",
            "documents": [
                {
                    "path": "dv-titles0/gold-titletoken.md",
                    "title": "pyrra 운영 노트",
                    "headings": ["pyrra 운영 노트"],
                    "text": "운영 변경은 주간 회의에서 확정한다.\n변경 이력은 지역 아카이브에 남긴다."
                },
                {
                    "path": "dv-numbers0/cendral-a.md",
                    "title": "cendral 이전 한도",
                    "headings": ["cendral 이전 한도"],
                    "text": format!("cendral 한도는 배치마다 다시 계산한다.\n{filler}")
                },
                {
                    "path": "dv-dates0/cendral-b.md",
                    "title": "cendral 기준일",
                    "headings": ["cendral 기준일"],
                    "text": format!("cendral 기준일은 배치 시작일이다.\n{filler}")
                }
            ],
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(
            get(evidence.first().unwrap_or(&NULL), "path"),
            &json!("dv-titles0/gold-titletoken.md"),
            "rare path token stays ahead of repeated common field tokens"
        );
    }

    #[test]
    fn plan_restricts_explicit_field_prefixes() {
        let title_only = plan_of(&json!({
            "question": "title:quartz",
            "documents": [{
                "path": "notes/plain.md",
                "title": "Quartz Notes",
                "text": "본문에 없는 단어",
            }],
        }));
        assert_eq!(rows(&title_only, "evidence").len(), 1);
        let body_only = plan_of(&json!({
            "question": "body:quartz",
            "documents": [{
                "path": "notes/plain.md",
                "title": "Quartz Notes",
                "text": "본문에 없는 단어",
            }],
        }));
        assert_eq!(rows(&body_only, "evidence").len(), 0);
        let heading_hit = plan_of(&json!({
            "question": "heading:relay",
            "documents": [{
                "path": "notes/plain.md",
                "headings": ["Relay Restart"],
                "text": "본문에 없는 단어",
            }],
        }));
        assert_eq!(rows(&heading_hit, "evidence").len(), 1);
    }

    #[test]
    fn plan_derives_title_from_path_without_title_field() {
        let plan = plan_of(&json!({
            "question": "quartz",
            "documents": [{
                "path": "notes/quartz-handbook.md",
                "text": "본문에는 해당 단어가 없다",
            }],
        }));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        let matches = rows(first, "fieldMatches");
        assert!(matches.contains(&json!("title")), "derived title matched");
    }

    #[test]
    fn plan_keeps_matched_documents_beyond_adaptive_threshold() {
        let plan = plan_of(&json!({
            "question": "quartz",
            "documents": [
                {"path": "strong.md", "text": "quartz quartz quartz quartz"},
                {"path": "weak-a.md", "text": "quartz"},
                {"path": "weak-b.md", "text": "quartz"},
                {"path": "weak-c.md", "text": "quartz"},
            ],
            "budget": {"maxDocuments": 8, "maxPassages": 8},
        }));
        let evidence = rows(&plan, "evidence");
        let paths = evidence
            .iter()
            .filter_map(|row| get(row, "path").as_str())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"weak-a.md"), "matched weak document kept");
        assert!(paths.contains(&"weak-c.md"), "matched weak document kept");
        let diagnostics = get(&plan, "diagnostics");
        assert_eq!(get(diagnostics, "truncated"), &json!(false));
    }

    #[test]
    fn plan_reserves_a_passage_for_each_nonzero_query_index() {
        let plan = plan_of(&json!({
            "question": "Compare copper and glass",
            "documents": [
                {"path": "copper-a.md", "text": "copper copper copper copper"},
                {"path": "copper-b.md", "text": "copper copper copper"},
                {"path": "copper-c.md", "text": "copper copper"},
                {"path": "glass.md", "text": "glass"}
            ],
            "candidates": [
                {"path": "copper-a.md", "source": "bm25", "rank": 1, "score": 100.0, "queryIndex": 1, "startLine": 1, "endLine": 1},
                {"path": "copper-b.md", "source": "bm25", "rank": 2, "score": 90.0, "queryIndex": 1, "startLine": 1, "endLine": 1},
                {"path": "copper-c.md", "source": "bm25", "rank": 3, "score": 80.0, "queryIndex": 1, "startLine": 1, "endLine": 1},
                {"path": "glass.md", "source": "bm25", "rank": 4, "score": 1.0, "queryIndex": 2, "startLine": 1, "endLine": 1}
            ],
            "budget": {"maxDocuments": 4, "maxPassages": 2}
        }));
        let evidence = rows(&plan, "evidence");
        assert_eq!(evidence.len(), 2);
        let copper = find_row(&evidence, "path", "copper-a.md").unwrap_or(&NULL);
        let glass = find_row(&evidence, "path", "glass.md").unwrap_or(&NULL);
        assert_eq!(rows(copper, "queryIndexes"), vec![json!(1)]);
        assert_eq!(rows(glass, "queryIndexes"), vec![json!(2)]);
    }

    #[test]
    fn plan_assigns_query_indexes_only_to_overlapping_passages_of_the_same_path() {
        let plan = plan_of(&json!({
            "question": "Compare copper and glass",
            "documents": [
                {"path": "shared.md", "text": "copper storage", "startLine": 1},
                {"path": "shared.md", "text": "glass latency", "startLine": 100}
            ],
            "candidates": [
                {"path": "shared.md", "source": "bm25", "rank": 1, "score": 100.0, "queryIndex": 1, "startLine": 1, "endLine": 1},
                {"path": "shared.md", "source": "bm25", "rank": 2, "score": 1.0, "queryIndex": 2, "startLine": 100, "endLine": 100}
            ],
            "budget": {"maxPassages": 1}
        }));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        assert_eq!(get(first, "path"), &json!("shared.md"));
        assert_eq!(get(first, "startLine"), &json!(1));
        assert_eq!(rows(first, "queryIndexes"), vec![json!(1)]);
    }

    #[test]
    fn plan_does_not_assign_a_query_index_without_a_candidate_range() {
        let plan = plan_of(&json!({
            "question": "Compare copper and glass",
            "documents": [{"path": "shared.md", "text": "copper and glass"}],
            "candidates": [
                {"path": "shared.md", "source": "bm25", "rank": 1, "score": 1.0, "queryIndex": 1}
            ]
        }));
        let evidence = rows(&plan, "evidence");
        let first = evidence.first().unwrap_or(&NULL);
        assert_eq!(rows(first, "queryIndexes"), Vec::<Value>::new());
    }

    #[test]
    fn plan_protects_a_sparse_facet_passage_beyond_the_adaptive_depth() {
        let draft = |score: f64, query_index: Option<usize>| super::PassageDraft {
            path: format!("draft-{query_index:?}.md"),
            revision: None,
            start_line: 1,
            end_line: 1,
            quote: String::new(),
            context_before: String::new(),
            context_after: String::new(),
            score,
            signal: String::new(),
            phrase_matches: 0,
            negated_nearby: false,
            exact: std::collections::BTreeSet::new(),
            highlights: Vec::new(),
            field_score: 0.0,
            field_matches: std::collections::BTreeSet::new(),
            matched: score > 0.0,
            candidate_rank: query_index.map_or(usize::MAX, |_| 1000),
            query_indexes: query_index.into_iter().collect(),
        };
        let mut drafts = (0..8)
            .map(|index| draft(100.0 - f64::from(index), None))
            .collect::<Vec<_>>();
        drafts.push(draft(0.0, Some(2)));
        assert_eq!(super::candidate_depth(&drafts, 16, 2), 9);
    }

    #[test]
    fn plan_rejects_query_indexes_above_the_wire_limit() {
        let input = json!({
            "question": "quartz",
            "documents": [{"path": "a.md", "text": "quartz"}],
            "candidates": [{"path": "a.md", "source": "bm25", "rank": 1, "queryIndex": 4}]
        });
        assert_eq!(plan_indexed_evidence_json(&input.to_string()), "");
    }
    #[test]

    fn plan_rejects_invalid_input_without_panicking() {
        assert_eq!(plan_indexed_evidence_json("not json"), "");
        assert_eq!(verify_indexed_evidence_json(""), "");
    }

    #[test]
    fn plan_matches_composed_document_with_decomposed_question() {
        let question = "오린 퀼런의 기록".nfd().collect::<String>();
        let plan = plan_of(&json!({
            "question": question,
            "documents": [{"path": "a.md", "text": "오린 퀼런의 기록에 대한 설명입니다."}],
        }));
        assert_eq!(
            rows(&plan, "evidence").len(),
            1,
            "분해된 한글 질의도 조합형 문서 구절을 찾아야 합니다"
        );
    }

    #[test]
    fn plan_phrase_match_survives_decomposed_quotes() {
        let quoted = "\"원장\"".nfd().collect::<String>();
        let plan = plan_of(&json!({
            "question": quoted,
            "documents": [{"path": "a.md", "text": "그의 원장은 기록되었습니다."}],
        }));
        let evidence = first_row(&plan, "evidence");
        assert_eq!(
            get(&evidence, "path"),
            &json!("a.md"),
            "인용 구문도 근거를 찾아야 합니다"
        );
        assert!(
            get(&evidence, "phraseMatches").as_u64().unwrap_or_default() > 0,
            "NFC 문서에서 NFD 인용 구문이 일치해야 합니다"
        );
    }
}
