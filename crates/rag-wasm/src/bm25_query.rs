//! 위치·필드 기반 `BM25` 질의 parser와 구문 검증.
//!
//! 질의 문법은 다음만 지원한다.
//! - `"정확 구문"`: 저장된 token 위치가 실제로 인접한 문서만 통과한다.
//! - `"구문"~N`: `N`칸까지 벌어진 구문을 허용한다(`N`은 8로 제한).
//! - `title:`, `heading:`(`headings:`), `body:`, `path:`, `tag:`(`tags:`): 필드 제한.
//! - `term*`: 명시 prefix 확장(사전 순서, 상한 16).
//! - 평문 term: 정확 term 우선, 없을 때만 편집 거리 1 오타 보정(상한 4, 5자 이상).

use std::cmp::Ordering;
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};
use std::iter::Peekable;
use std::slice::Iter;

use crate::{
    BM25_FIELD_BODY, BM25_FIELD_HEADING, BM25_FIELD_PATH, BM25_FIELD_TAGS, BM25_FIELD_TITLE,
    Bm25FieldRun, Bm25IndexData, Bm25SearchScore, bm25_average_doc_length, bm25_score_value,
    normalize_token, tokenize, usize_to_f64,
};

/// 제목에 나타난 용어의 기본 가중(Solr `qf=title^3`).
const BM25_TITLE_WEIGHT: f64 = 3.0;
/// 헤딩에 나타난 용어의 기본 가중(Solr `heading^2`).
const BM25_HEADING_WEIGHT: f64 = 2.0;

/// term 절 종류 code.
const CLAUSE_KIND_TERM: u8 = 0;
/// 구문 절 종류 code.
const CLAUSE_KIND_PHRASE: u8 = 1;
/// 명시 prefix(`term*`) 확장 상한.
const PREFIX_EXPANSION_LIMIT: usize = 16;
/// prefix 확장을 허용하는 최소 문자 수.
const PREFIX_MIN_TERM_CHARS: usize = 2;
/// 오타 보정 후보 상한.
const FUZZY_EXPANSION_LIMIT: usize = 4;
/// 오타 보정을 시도하는 최소 term 문자 수.
const FUZZY_MIN_TERM_CHARS: usize = 5;
/// 구문 근접에서 허용하는 최대 slop.
const MAX_PHRASE_SLOP: u32 = 8;
/// 필드 제한 prefix 목록. 같은 접두사가 겹치면 긴 쪽을 쓴다.
const FIELD_PREFIXES: [(&str, u8); 7] = [
    ("title:", BM25_FIELD_TITLE),
    ("heading:", BM25_FIELD_HEADING),
    ("headings:", BM25_FIELD_HEADING),
    ("body:", BM25_FIELD_BODY),
    ("path:", BM25_FIELD_PATH),
    ("tag:", BM25_FIELD_TAGS),
    ("tags:", BM25_FIELD_TAGS),
];

/// 절 중복 제거 key `(절 종류, 필드+1, 모드, 본문)`.
type ClauseKey = (u8, u8, u32, String);

/// 파싱된 질의 절.
enum Bm25QueryClause {
    /// 단일 term 절.
    Term(Bm25TermClause),
    /// 구문·근접 절.
    Phrase(Bm25PhraseClause),
}

/// 단일 term 절.
struct Bm25TermClause {
    /// 정확 term 또는 prefix.
    term: String,
    /// 필드 제한.
    field: Option<u8>,
    /// 명시 prefix 확장 여부.
    prefix: bool,
}

/// 구문·근접 절.
struct Bm25PhraseClause {
    /// 순서가 고정된 구문 term 목록.
    terms: Vec<String>,
    /// 필드 제한.
    field: Option<u8>,
    /// 허용 slop.
    slop: u32,
}

/// 문서별 `BM25` 점수 누적기. 먼저 등장한 문서 순서를 보존한다.
#[derive(Default)]
struct Bm25ScoreAccumulator {
    /// 계산된 문서별 점수.
    scores: Vec<Bm25SearchScore>,
    /// doc id -> `scores` index.
    index_by_doc_id: BTreeMap<String, usize>,
    /// doc id -> 일치한 절 bitmask. `clause`가 설정된 경우에만 누적한다.
    coverage: BTreeMap<String, u64>,
    /// 지금 누적 중인 절 index. `None`이면 coverage를 계산하지 않는다.
    clause: Option<usize>,
}

/// 확장 사다리를 적용한 `BM25` 질의 결과.
pub struct Bm25RelaxedSearch {
    /// 결과가 나온 사다리 단계. 0이면 원래 요구 조건을 그대로 만족했다.
    pub step: u8,
    /// 마지막으로 요구한 일치 절 수.
    pub required: usize,
    /// 질의의 절 수.
    pub clause_count: usize,
    /// 단계별로 필터링한 점수 목록(내림차순).
    pub scores: Vec<Bm25SearchScore>,
}

impl Bm25ScoreAccumulator {
    /// 문서 점수를 누적한다. 유효하지 않은 점수는 무시한다.
    fn add(&mut self, doc_id: &str, score: f64) {
        if !score.is_finite() || score <= 0.0 {
            return;
        }
        if let Some(clause) = self.clause {
            // 64개를 넘는 절은 coverage 단계 판정에서 제외합니다(전체 허용 단계로 수렴).
            if u32::try_from(clause).is_ok_and(|index| index < u64::BITS) {
                let mask = self.coverage.entry(doc_id.to_owned()).or_insert(0);
                *mask |= 1_u64 << clause;
            }
        }
        match self.index_by_doc_id.entry(doc_id.to_owned()) {
            Entry::Occupied(entry) => {
                let index = *entry.get();
                if let Some(slot) = self.scores.get_mut(index) {
                    slot.score += score;
                }
            }
            Entry::Vacant(entry) => {
                let index = self.scores.len();
                entry.insert(index);
                self.scores.push(Bm25SearchScore {
                    doc_id: doc_id.to_owned(),
                    score,
                });
            }
        }
    }

    /// 누적된 점수 목록을 반환한다.
    fn into_scores(self) -> Vec<Bm25SearchScore> {
        self.scores
    }
}

/// 위치·필드 색인을 사용해 query 점수를 계산한다.
#[must_use]
pub fn search_index(index: &Bm25IndexData, query: &str) -> Vec<Bm25SearchScore> {
    let clauses = parse_query(query, false);
    if clauses.is_empty() {
        return Vec::new();
    }
    let total_docs = index.doc_lengths.len();
    if total_docs == 0 {
        return Vec::new();
    }
    let Some(total_docs_f64) = usize_to_f64(total_docs) else {
        return Vec::new();
    };
    let avg_doc_length = bm25_average_doc_length(index);
    if !avg_doc_length.is_finite() || avg_doc_length <= 0.0 {
        return Vec::new();
    }

    accumulate(index, &clauses, total_docs_f64, avg_doc_length, false).into_scores()
}

/// 절을 순서대로 점수화한다. `track_coverage`가 참이면 문서별 일치 절 bitmask도 남긴다.
fn accumulate(
    index: &Bm25IndexData,
    clauses: &[Bm25QueryClause],
    total_docs_f64: f64,
    avg_doc_length: f64,
    track_coverage: bool,
) -> Bm25ScoreAccumulator {
    let mut accumulator = Bm25ScoreAccumulator::default();
    for (clause_index, clause) in clauses.iter().enumerate() {
        if track_coverage {
            accumulator.clause = Some(clause_index);
        }
        match clause {
            Bm25QueryClause::Term(term) => {
                for expanded in expand_terms(index, term) {
                    score_term(
                        index,
                        &expanded,
                        term.field,
                        total_docs_f64,
                        avg_doc_length,
                        &mut accumulator,
                    );
                }
            }
            Bm25QueryClause::Phrase(phrase) => {
                score_phrase(
                    index,
                    phrase,
                    total_docs_f64,
                    avg_doc_length,
                    &mut accumulator,
                );
            }
        }
    }
    accumulator
}

/// 확장 사다리로 질의한다.
///
/// 상용 엔진처럼 결과가 부족할 때 요구 일치 절 수를 단계적으로 낮추되,
/// 어느 단계에서 결과가 나왔는지 함께 돌려준다.
/// 점수 계산은 그대로 두고 단계별로 필터링만 하므로 순위 계약이 바뀌지 않는다.
#[must_use]
pub fn search_index_relaxed(
    index: &Bm25IndexData,
    query: &str,
    limit: usize,
) -> Option<Bm25RelaxedSearch> {
    let clauses = parse_query(query, false);
    if clauses.is_empty() {
        return None;
    }
    let clause_count = clauses.len();
    let total_docs = index.doc_lengths.len();
    if total_docs == 0 {
        return None;
    }
    let total_docs_f64 = usize_to_f64(total_docs)?;
    let avg_doc_length = bm25_average_doc_length(index);
    if !avg_doc_length.is_finite() || avg_doc_length <= 0.0 {
        return None;
    }
    let mut accumulator = accumulate(index, &clauses, total_docs_f64, avg_doc_length, true);
    let coverage = std::mem::take(&mut accumulator.coverage);
    let mut scores = accumulator.into_scores();
    scores.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.doc_id.cmp(&right.doc_id))
    });
    let ladder = coverage_ladder(clause_count);
    let target = limit.max(1);
    for (step, required) in ladder.iter().enumerate() {
        let last = step + 1 == ladder.len();
        let matched = scores
            .iter()
            .filter(|score| coverage_of(&coverage, &score.doc_id) >= *required)
            .count();
        if matched >= target || last {
            let scores = scores
                .into_iter()
                .filter(|score| coverage_of(&coverage, &score.doc_id) >= *required)
                .take(target)
                .collect::<Vec<_>>();
            return Some(Bm25RelaxedSearch {
                step: u8::try_from(step).unwrap_or(u8::MAX),
                required: *required,
                clause_count,
                scores,
            });
        }
    }
    None
}

/// 문서가 일치한 절 수.
#[must_use]
fn coverage_of(coverage: &BTreeMap<String, u64>, doc_id: &str) -> usize {
    coverage.get(doc_id).map_or(0, |mask| {
        usize::try_from(mask.count_ones()).unwrap_or(usize::MAX)
    })
}

/// 요구 일치 절 수 사다리. 마지막 단계는 항상 1(모든 절 선택)이다.
#[must_use]
fn coverage_ladder(clause_count: usize) -> Vec<usize> {
    if clause_count <= 1 {
        return vec![1];
    }
    let mut ladder = Vec::<usize>::with_capacity(3);
    for required in [
        clause_count.saturating_mul(3).div_ceil(4),
        clause_count.div_ceil(2),
        1,
    ] {
        let required = required.clamp(1, clause_count);
        if ladder.last() != Some(&required) {
            ladder.push(required);
        }
    }
    ladder
}

/// query 문자열을 절 목록으로 파싱한다.
#[must_use]
fn parse_query(query: &str, exact_terms: bool) -> Vec<Bm25QueryClause> {
    let characters = query.chars().collect::<Vec<_>>();
    let mut clauses = Vec::<Bm25QueryClause>::new();
    let mut seen = BTreeSet::<ClauseKey>::new();
    let mut cursor = 0_usize;
    while let Some(character) = characters.get(cursor).copied() {
        if character.is_whitespace() {
            cursor = cursor.saturating_add(1);
            continue;
        }
        let (field, next_cursor) = read_field_prefix(&characters, cursor);
        cursor = next_cursor;
        let Some(character) = characters.get(cursor).copied() else {
            break;
        };
        if character == '"' {
            let (text, next_cursor) = read_quoted(&characters, cursor.saturating_add(1));
            let (slop, next_cursor) = read_phrase_slop(&characters, next_cursor);
            cursor = next_cursor;
            push_phrase_clause(&mut clauses, &mut seen, &text, field, slop);
            continue;
        }
        let (text, next_cursor) = read_word(&characters, cursor);
        cursor = next_cursor;
        push_term_clause(&mut clauses, &mut seen, &text, field, exact_terms);
    }
    clauses
}

/// 현재 위치에서 필드 prefix를 읽는다.
#[must_use]
fn read_field_prefix(characters: &[char], cursor: usize) -> (Option<u8>, usize) {
    let mut best = Option::<(usize, u8)>::None;
    for (prefix, field) in FIELD_PREFIXES {
        if !matches_ascii_prefix(characters, cursor, prefix) {
            continue;
        }
        let length = prefix.len();
        if best.is_none_or(|(best_length, _)| length > best_length) {
            best = Some((length, field));
        }
    }
    match best {
        Some((length, field)) => (Some(field), cursor.saturating_add(length)),
        None => (None, cursor),
    }
}

/// `char` 목록의 위치에서 대소문자를 무시한 `ASCII` prefix 일치를 확인한다.
#[must_use]
fn matches_ascii_prefix(characters: &[char], cursor: usize, prefix: &str) -> bool {
    for (offset, expected) in prefix.chars().enumerate() {
        let Some(actual) = characters.get(cursor.saturating_add(offset)).copied() else {
            return false;
        };
        if !actual.eq_ignore_ascii_case(&expected) {
            return false;
        }
    }
    true
}

/// 따옴표로 시작하는 구문 본문을 읽는다. `\"` escape를 지원한다.
#[must_use]
fn read_quoted(characters: &[char], start: usize) -> (String, usize) {
    let mut text = String::new();
    let mut cursor = start;
    while let Some(character) = characters.get(cursor).copied() {
        cursor = cursor.saturating_add(1);
        if character == '\\' {
            if let Some(escaped) = characters.get(cursor).copied() {
                text.push(escaped);
                cursor = cursor.saturating_add(1);
            }
            continue;
        }
        if character == '"' {
            break;
        }
        text.push(character);
    }
    (text, cursor)
}

/// 구문 뒤의 `~N` slop을 읽는다. 상한을 넘으면 상한을 쓴다.
#[must_use]
fn read_phrase_slop(characters: &[char], start: usize) -> (u32, usize) {
    if characters.get(start).copied() != Some('~') {
        return (0, start);
    }
    let mut cursor = start.saturating_add(1);
    let mut digits = String::new();
    while let Some(character) = characters.get(cursor).copied() {
        if !character.is_ascii_digit() {
            break;
        }
        digits.push(character);
        cursor = cursor.saturating_add(1);
    }
    if digits.is_empty() {
        return (0, start);
    }
    let slop = digits
        .parse::<u32>()
        .unwrap_or(MAX_PHRASE_SLOP)
        .min(MAX_PHRASE_SLOP);
    (slop, cursor)
}

/// 공백 전까지의 단어를 읽는다.
#[must_use]
fn read_word(characters: &[char], start: usize) -> (String, usize) {
    let mut text = String::new();
    let mut cursor = start;
    while let Some(character) = characters.get(cursor).copied() {
        if character.is_whitespace() {
            break;
        }
        text.push(character);
        cursor = cursor.saturating_add(1);
    }
    (text, cursor)
}

/// 구문 절을 추가한다. 단일 token 구문은 일반 term 절로 내린다.
fn push_phrase_clause(
    clauses: &mut Vec<Bm25QueryClause>,
    seen: &mut BTreeSet<ClauseKey>,
    text: &str,
    field: Option<u8>,
    slop: u32,
) {
    let terms = tokenize(text);
    if terms.len() < 2 {
        for term in terms {
            push_term_clause(clauses, seen, &term, field, true);
        }
        return;
    }
    let key = (
        CLAUSE_KIND_PHRASE,
        field.map_or(0, |value| value.saturating_add(1)),
        slop,
        terms.join("\u{1f}"),
    );
    if !seen.insert(key) {
        return;
    }
    clauses.push(Bm25QueryClause::Phrase(Bm25PhraseClause {
        terms,
        field,
        slop,
    }));
}

/// term 절을 추가한다. 정규화 결과가 비면 무시한다.
fn push_term_clause(
    clauses: &mut Vec<Bm25QueryClause>,
    seen: &mut BTreeSet<ClauseKey>,
    text: &str,
    field: Option<u8>,
    exact_terms: bool,
) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    let prefix = trimmed.ends_with('*');
    let body = if prefix {
        trimmed.strip_suffix('*').unwrap_or(trimmed)
    } else {
        trimmed
    };
    // 정확 집계는 파생 토큰을 제외하고, 후보 검색만 기존 확장 토큰을 쓴다.
    let terms = if exact_terms || field.is_some() || prefix {
        let normalized = normalize_token(body);
        if normalized.is_empty() {
            Vec::new()
        } else {
            vec![normalized]
        }
    } else {
        tokenize(body)
    };
    for term in terms {
        let key = (
            CLAUSE_KIND_TERM,
            field.map_or(0, |value| value.saturating_add(1)),
            u32::from(prefix),
            term.clone(),
        );
        if !seen.insert(key) {
            continue;
        }
        clauses.push(Bm25QueryClause::Term(Bm25TermClause {
            term,
            field,
            prefix,
        }));
    }
}

/// term 절을 정확·명시 prefix·오타 보정 순서로 확장한다.
#[must_use]
fn expand_terms(index: &Bm25IndexData, clause: &Bm25TermClause) -> Vec<String> {
    if clause.prefix {
        let expanded = expand_prefix(index, &clause.term);
        if !expanded.is_empty() {
            return expanded;
        }
        return expand_fuzzy(index, &clause.term);
    }
    if index.inverted.contains_key(&clause.term) {
        return vec![clause.term.clone()];
    }
    expand_fuzzy(index, &clause.term)
}

/// 사전에서 prefix가 일치하는 term을 bounded 개수만 만든다.
#[must_use]
fn expand_prefix(index: &Bm25IndexData, prefix: &str) -> Vec<String> {
    if prefix.chars().count() < PREFIX_MIN_TERM_CHARS {
        return Vec::new();
    }
    index
        .inverted
        .keys()
        .filter(|term| term.starts_with(prefix))
        .take(PREFIX_EXPANSION_LIMIT)
        .cloned()
        .collect()
}

/// 사전에서 편집 거리 1 이내 term을 bounded 개수만 만든다.
#[must_use]
fn expand_fuzzy(index: &Bm25IndexData, term: &str) -> Vec<String> {
    if term.chars().count() < FUZZY_MIN_TERM_CHARS {
        return Vec::new();
    }
    index
        .inverted
        .keys()
        .filter(|candidate| is_within_one_edit(term, candidate))
        .take(FUZZY_EXPANSION_LIMIT)
        .cloned()
        .collect()
}

/// 두 문자열의 편집 거리가 1 이내인지 두 포인터로 확인한다.
#[must_use]
fn is_within_one_edit(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    let left_length = left.chars().count();
    let right_length = right.chars().count();
    if left_length.abs_diff(right_length) > 1 {
        return false;
    }
    // 사전 전체를 검사하므로 후보마다 문자 배열을 만들지 않는다.
    let mut left_chars = left.chars().peekable();
    let mut right_chars = right.chars().peekable();
    let mut skipped = false;
    while let (Some(left_character), Some(right_character)) =
        (left_chars.peek(), right_chars.peek())
    {
        if left_character == right_character {
            left_chars.next();
            right_chars.next();
            continue;
        }
        if skipped {
            return false;
        }
        skipped = true;
        match left_length.cmp(&right_length) {
            Ordering::Equal => {
                left_chars.next();
                right_chars.next();
            }
            Ordering::Greater => {
                left_chars.next();
            }
            Ordering::Less => {
                right_chars.next();
            }
        }
    }
    true
}

/// 단일 term의 문서별 점수를 누적한다.
fn score_term(
    index: &Bm25IndexData,
    term: &str,
    field: Option<u8>,
    total_docs_f64: f64,
    avg_doc_length: f64,
    accumulator: &mut Bm25ScoreAccumulator,
) {
    let Some(posting) = index.inverted.get(term) else {
        return;
    };
    let mut matched = Vec::<(String, f64)>::new();
    for (doc_id, frequency) in posting {
        let Some(term_frequency) = field_term_frequency(index, term, doc_id, *frequency, field)
        else {
            continue;
        };
        matched.push((doc_id.clone(), term_frequency));
    }
    let Some(document_frequency) = usize_to_f64(matched.len()) else {
        return;
    };
    if document_frequency <= 0.0 {
        return;
    }
    let idf = inverse_document_frequency(total_docs_f64, document_frequency);
    for (doc_id, term_frequency) in matched {
        let score = bm25_score_value(
            idf,
            term_frequency,
            doc_length(index, &doc_id),
            avg_doc_length,
        );
        accumulator.add(&doc_id, score * field_weight(index, term, &doc_id, field));
    }
}

/// 기본 필드 질의에서 제목·헤딩에 나타난 용어를 가중한다.
///
/// Solr `qf=title^3 heading^2 body^1`처럼 필드별 가중을 주면
/// 본문에만 스쳐 지나간 문서보다 제목이 맞는 문서가 앞에 온다.
#[must_use]
fn field_weight(index: &Bm25IndexData, term: &str, doc_id: &str, field: Option<u8>) -> f64 {
    // 필드를 명시한 질의는 이미 사용자의 의도를 반영하므로 추가 가중하지 않는다.
    if field.is_some() {
        return 1.0;
    }
    let Some(positions) = index
        .positions
        .get(term)
        .and_then(|by_doc| by_doc.get(doc_id))
    else {
        return 1.0;
    };
    let Some(runs) = index.doc_field_runs.get(doc_id) else {
        return 1.0;
    };
    let mut best = 1.0;
    for position in positions {
        let Some(run) = run_for_position(runs, *position) else {
            continue;
        };
        let weight = match run.field {
            value if value == BM25_FIELD_TITLE => BM25_TITLE_WEIGHT,
            value if value == BM25_FIELD_HEADING => BM25_HEADING_WEIGHT,
            _ => 1.0,
        };
        if weight > best {
            best = weight;
        }
    }
    best
}

/// 필드 제한을 반영한 문서별 term frequency를 만든다.
#[must_use]
fn field_term_frequency(
    index: &Bm25IndexData,
    term: &str,
    doc_id: &str,
    frequency: f64,
    field: Option<u8>,
) -> Option<f64> {
    if !frequency.is_finite() || frequency <= 0.0 {
        return None;
    }
    let Some(field) = field else {
        return Some(frequency);
    };
    let positions = index.positions.get(term)?.get(doc_id)?;
    let runs = index.doc_field_runs.get(doc_id)?;
    let count = positions
        .iter()
        .filter(|position| run_for_position(runs, **position).is_some_and(|run| run.field == field))
        .count();
    if count == 0 {
        return None;
    }
    usize_to_f64(count)
}

/// 구문 절의 문서별 점수를 누적한다. 위치 정보가 없는 문서는 통과시키지 않는다.
fn score_phrase(
    index: &Bm25IndexData,
    phrase: &Bm25PhraseClause,
    total_docs_f64: f64,
    avg_doc_length: f64,
    accumulator: &mut Bm25ScoreAccumulator,
) {
    let Some(first_term) = phrase.terms.first() else {
        return;
    };
    let Some(first_positions) = index.positions.get(first_term) else {
        return;
    };
    let mut matched = Vec::<(String, f64)>::new();
    for (doc_id, positions) in first_positions {
        let Some(occurrences) = count_phrase_occurrences(index, phrase, doc_id, positions) else {
            continue;
        };
        if occurrences == 0 {
            continue;
        }
        let Some(term_frequency) = usize_to_f64(occurrences) else {
            continue;
        };
        matched.push((doc_id.clone(), term_frequency));
    }
    let Some(document_frequency) = usize_to_f64(matched.len()) else {
        return;
    };
    if document_frequency <= 0.0 {
        return;
    }
    let idf = inverse_document_frequency(total_docs_f64, document_frequency);
    for (doc_id, term_frequency) in matched {
        let score = bm25_score_value(
            idf,
            term_frequency,
            doc_length(index, &doc_id),
            avg_doc_length,
        );
        accumulator.add(&doc_id, score);
    }
}

/// 한 문서에서 구문이 나타난 횟수를 센다. 위치 정보가 없으면 `None`이다.
#[must_use]
fn count_phrase_occurrences(
    index: &Bm25IndexData,
    phrase: &Bm25PhraseClause,
    doc_id: &str,
    first_positions: &[u32],
) -> Option<usize> {
    count_phrase_matches(index, phrase, doc_id, first_positions, false)
}

/// 집계용으로 텍스트 필드에서 시작하는 구문만 세는 변형이다.
#[must_use]
fn count_text_phrase_occurrences(
    index: &Bm25IndexData,
    phrase: &Bm25PhraseClause,
    doc_id: &str,
    first_positions: &[u32],
) -> Option<usize> {
    count_phrase_matches(index, phrase, doc_id, first_positions, true)
}

/// 집계에서 본문으로 인정하는 필드인지 확인한다. 경로·태그는 메타데이터라 제외한다.
#[must_use]
const fn is_text_field(field: u8) -> bool {
    matches!(
        field,
        BM25_FIELD_TITLE | BM25_FIELD_HEADING | BM25_FIELD_BODY
    )
}

/// 구문 일치 횟수를 세는 공통 구현이다. `text_only`면 텍스트 필드에서 시작하는 일치만 센다.
#[must_use]
fn count_phrase_matches(
    index: &Bm25IndexData,
    phrase: &Bm25PhraseClause,
    doc_id: &str,
    first_positions: &[u32],
    text_only: bool,
) -> Option<usize> {
    let runs = index.doc_field_runs.get(doc_id)?;
    let mut cursors = Vec::<Peekable<Iter<'_, u32>>>::with_capacity(phrase.terms.len());
    for term in &phrase.terms {
        let positions = index.positions.get(term)?.get(doc_id)?;
        cursors.push(positions.iter().peekable());
    }
    let mut occurrences = 0_usize;
    for start in first_positions {
        let Some(start_run) = run_for_position(runs, *start) else {
            continue;
        };
        let accepted = phrase.field.map_or_else(
            || !text_only || is_text_field(start_run.field),
            |field| field == start_run.field,
        );
        if !accepted {
            continue;
        }
        let mut current = *start;
        let mut matched = true;
        for cursor in cursors.iter_mut().skip(1) {
            if let Some(position) = advance_phrase_cursor(cursor, current, phrase.slop, start_run) {
                current = position;
            } else {
                matched = false;
                break;
            }
        }
        if matched {
            occurrences = occurrences.saturating_add(1);
        }
    }
    Some(occurrences)
}

/// 구문 cursor를 현재 위치 다음 근접 window 안으로 전진시킨다.
#[must_use]
fn advance_phrase_cursor(
    cursor: &mut Peekable<Iter<'_, u32>>,
    current: u32,
    slop: u32,
    run: &Bm25FieldRun,
) -> Option<u32> {
    let max_gap = slop.saturating_add(1);
    loop {
        let position = **cursor.peek()?;
        if position <= current {
            cursor.next();
            continue;
        }
        if position.saturating_sub(current) > max_gap {
            return None;
        }
        cursor.next();
        if !is_in_run(run, position) {
            continue;
        }
        return Some(position);
    }
}

/// 문서 token 위치가 구간 안에 있는지 확인한다.
#[must_use]
const fn is_in_run(run: &Bm25FieldRun, position: u32) -> bool {
    position >= run.start && position < run.start.saturating_add(run.length)
}

/// 문서 token 위치가 속한 필드 구간을 찾는다.
#[must_use]
fn run_for_position(runs: &[Bm25FieldRun], position: u32) -> Option<&Bm25FieldRun> {
    runs.iter().find(|run| is_in_run(run, position))
}

/// 질의와 일치한 문서 하나의 발생 횟수다.
///
/// 점수나 순위가 아니라 "몇 번 나왔는지"만 담는다. 집계 인벤토리는 이 값만 쓴다.
pub struct Bm25MatchAggregate {
    /// 일치한 chunk 문서 id.
    pub doc_id: String,
    /// 정확 term과 정확 구문이 나타난 총 횟수.
    pub occurrences: usize,
}

/// 질의와 일치한 문서별 발생 횟수를 센다.
///
/// 점수·순위를 만들지 않는다. 정확 term과 정확 구문만 세고, prefix·오타 확장은 실제로
/// 없는 표기까지 포함해 수치를 부풀리므로 쓰지 않는다. 필드를 지정하지 않은 질의는
/// 제목·헤딩·본문만 세고 경로·태그는 파일 이름에서 term이 중복되므로 제외한다.
/// 위치 정보가 없는 색인은 정확히 셀 수 없으므로 빈 결과를 돌려준다(0으로 위장하지 않는다).
#[must_use]
pub fn aggregate_matches(index: &Bm25IndexData, query: &str) -> Vec<Bm25MatchAggregate> {
    if index.positions.is_empty() {
        return Vec::new();
    }
    let clauses = parse_query(query, true);
    let mut counts = BTreeMap::<String, usize>::new();
    for clause in &clauses {
        match clause {
            Bm25QueryClause::Term(term) => {
                if term.prefix {
                    continue;
                }
                let Some(postings) = index.positions.get(&term.term) else {
                    continue;
                };
                for (doc_id, positions) in postings {
                    let occurrences = term_occurrences_in_field(index, term, doc_id, positions);
                    if occurrences == 0 {
                        continue;
                    }
                    let entry = counts.entry(doc_id.clone()).or_default();
                    *entry = entry.saturating_add(occurrences);
                }
            }
            Bm25QueryClause::Phrase(phrase) => {
                let Some(first_term) = phrase.terms.first() else {
                    continue;
                };
                let Some(postings) = index.positions.get(first_term) else {
                    continue;
                };
                for (doc_id, positions) in postings {
                    let occurrences =
                        count_text_phrase_occurrences(index, phrase, doc_id, positions)
                            .unwrap_or_default();
                    if occurrences == 0 {
                        continue;
                    }
                    let entry = counts.entry(doc_id.clone()).or_default();
                    *entry = entry.saturating_add(occurrences);
                }
            }
        }
    }
    counts
        .into_iter()
        .map(|(doc_id, occurrences)| Bm25MatchAggregate {
            doc_id,
            occurrences,
        })
        .collect()
}

/// 문서 안에서 term이 나타난 횟수를 센다. 필드 제한이 있으면 해당 필드 구간만 센다.
#[must_use]
fn term_occurrences_in_field(
    index: &Bm25IndexData,
    term: &Bm25TermClause,
    doc_id: &str,
    positions: &[u32],
) -> usize {
    let Some(runs) = index.doc_field_runs.get(doc_id) else {
        // 필드 구간이 없는 legacy 색인은 필드 제한이 없을 때만 전체 위치를 센다.
        return if term.field.is_none() {
            positions.len()
        } else {
            0
        };
    };
    positions
        .iter()
        .filter(|position| {
            let Some(run) = run_for_position(runs, **position) else {
                return false;
            };
            // 경로가 본문 term을 다시 만들어 총계를 부풀리지 않도록 텍스트 필드만 센다.
            term.field
                .map_or_else(|| is_text_field(run.field), |field| run.field == field)
        })
        .count()
}

/// 문서 빈도 기반 `IDF`를 만든다.
#[must_use]
fn inverse_document_frequency(total_docs: f64, document_frequency: f64) -> f64 {
    ((total_docs - document_frequency + 0.5) / (document_frequency + 0.5)).ln_1p()
}

/// 문서 `BM25` 길이를 읽는다. 값이 없거나 유효하지 않으면 기존 계산과 같이 1을 쓴다.
#[must_use]
fn doc_length(index: &Bm25IndexData, doc_id: &str) -> f64 {
    index
        .doc_lengths
        .get(doc_id)
        .copied()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(1.0)
}
#[cfg(test)]
mod tests {
    use super::is_within_one_edit;

    /// 스트리밍 오타 비교는 문자 단위 편집 거리와 일치해야 한다.
    #[test]
    fn fuzzy_one_edit_matches_unicode_reference_distance() {
        let samples = [
            "",
            "a",
            "b",
            "ab",
            "ba",
            "aab",
            "aba",
            "baa",
            "abc",
            "abcd",
            "가",
            "나",
            "가나",
            "가나다",
            "가나마",
            "가마",
            "가😀",
            "😀가",
            "😀",
        ];
        for left in samples {
            for right in samples {
                let mut previous = (0..=right.chars().count()).collect::<Vec<_>>();
                for (left_offset, left_char) in left.chars().enumerate() {
                    let mut current = vec![left_offset.saturating_add(1)];
                    for (right_offset, right_char) in right.chars().enumerate() {
                        let substitution = previous
                            .get(right_offset)
                            .copied()
                            .unwrap_or(usize::MAX)
                            .saturating_add(usize::from(left_char != right_char));
                        let insertion = current
                            .get(right_offset)
                            .copied()
                            .unwrap_or(usize::MAX)
                            .saturating_add(1);
                        let deletion = previous
                            .get(right_offset.saturating_add(1))
                            .copied()
                            .unwrap_or(usize::MAX)
                            .saturating_add(1);
                        current.push(substitution.min(insertion).min(deletion));
                    }
                    previous = current;
                }
                let distance = previous.last().copied().unwrap_or(0);
                assert_eq!(
                    is_within_one_edit(left, right),
                    distance <= 1,
                    "문자 단위 편집 거리를 보존해야 한다: {left:?} / {right:?}",
                );
            }
        }
    }
}
