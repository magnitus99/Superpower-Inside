//! 원문 행별 literal 발견·주소 페이지와 완전 source 집계.
use crate::indexed_evidence::{SearchCharacter, literal_projection};
use crate::{JsonValue, create_content_hash};
use core::mem::size_of;
use serde_json::json;
use unicode_normalization::UnicodeNormalization;
use wasm_bindgen::prelude::wasm_bindgen;

/// 기존 원문 준비와 같은 안전 상한입니다.
const MAX_CHARGE: usize = 1024 * 1024 * 1024;
/// 원문 블록의 UTF-8 byte 상한입니다.
const BLOCK_BYTES: usize = 64 * 1024;
/// 작은 생성자 JSON의 상한이며 정규화 확장 summary는 이 값의 16배까지 받습니다.
const HEADER_BYTES: usize = 1024 * 1024;
/// JS에서 정확히 표현 가능한 최대 정수입니다.
const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
/// 완전 source 스캔의 실패 사유만 반환합니다.
type Checked<T> = Result<T, &'static str>;

/// 원문 값이 없는 고정 실패 wire입니다.
fn failure(reason: &str) -> String {
    json!({"ok":false,"reason":reason}).to_string()
}

/// JSON 안전 정수를 검사하며 누락·실수를 0으로 바꾸지 않습니다.
fn integer(value: &JsonValue, key: &str) -> Checked<u64> {
    value
        .get(key)
        .and_then(JsonValue::as_u64)
        .filter(|number| *number <= SAFE_INTEGER)
        .ok_or("invalid-input")
}

/// 주소나 메모리 크기를 호스트 usize 범위에서도 확인합니다.
fn address(value: &JsonValue, key: &str) -> Checked<usize> {
    usize::try_from(integer(value, key)?).map_err(|_| "invalid-input")
}

/// 버전이 알려진 작은 JSON object만 읽습니다.
fn input_json(input: &str, max_bytes: usize) -> Checked<JsonValue> {
    if input.len() > max_bytes {
        return Err("invalid-input");
    }
    let value: JsonValue = serde_json::from_str(input).map_err(|_| "invalid-input")?;
    if integer(&value, "version")? != 1 {
        return Err("invalid-input");
    }
    Ok(value)
}

/// 두 hash는 기존 Rust content hash의 8자리 hex 형식입니다.
fn hash(value: &JsonValue, key: &str) -> Checked<String> {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .filter(|text| text.len() == 8 && text.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .map(str::to_owned)
        .ok_or("invalid-input")
}

/// 문서 식별 정보와 작은 숫자 구간 투영만 보유합니다.
struct Source {
    /// 원문 경로입니다.
    path: String,
    /// 전체 원문 hash입니다.
    content_hash: String,
    /// 별도 출처 원장 hash입니다.
    metadata_hash: String,
    /// 유한 비음수 원문 수정 시각입니다.
    mtime: f64,
    /// 파일 크기입니다.
    size: u64,
    /// UTF-8 전체 길이입니다.
    bytes: usize,
    /// UTF-16 전체 길이입니다.
    utf16: usize,
    /// 수신해야 하는 블록 수입니다.
    blocks: usize,
    /// producer가 계산한 source 작업 charge입니다.
    charge: usize,
    /// 파일 원장의 숫자 행 범위만 보관합니다.
    segments: Vec<(u64, u64)>,
}

/// source identity는 summary와 scanner header에서 같은 검사를 사용합니다.
fn identity(value: &JsonValue) -> Checked<(String, String, String, f64, u64)> {
    let path = value
        .get("path")
        .and_then(JsonValue::as_str)
        .filter(|path| !path.is_empty() && path.len() <= 4096)
        .ok_or("invalid-input")?;
    let mtime = value
        .get("sourceMtime")
        .and_then(JsonValue::as_f64)
        .filter(|mtime| mtime.is_finite() && *mtime >= 0.0)
        .ok_or("invalid-input")?;
    Ok((
        path.to_owned(),
        hash(value, "contentHash")?,
        hash(value, "sourceMetadataHash")?,
        mtime,
        integer(value, "sourceSize")?,
    ))
}

/// caller가 제공한 숫자 투영의 구조·길이·최소 원문 예약을 확인합니다.
fn source_header(value: &JsonValue) -> Checked<Source> {
    let (path, content_hash, metadata_hash, mtime, size) = identity(value)?;
    if integer(value, "version")? != 1 {
        return Err("invalid-input");
    }
    let bytes = address(value, "byteLength")?;
    let utf16 = address(value, "utf16Length")?;
    let blocks = address(value, "blockCount")?;
    let charge = address(value, "scanChargeBytes")?;
    if bytes > MAX_CHARGE
        || utf16 > bytes
        || bytes > utf16.saturating_mul(3)
        || blocks > bytes
        || (bytes == 0) != (blocks == 0)
        || blocks
            .checked_mul(BLOCK_BYTES)
            .is_none_or(|capacity| capacity < bytes)
        || charge < raw_charge(bytes).ok_or("memory-budget")?
        || charge > MAX_CHARGE
    {
        return Err("invalid-input");
    }
    let segments = value
        .get("segments")
        .and_then(JsonValue::as_array)
        .ok_or("invalid-input")?
        .iter()
        .map(|segment| {
            let start = integer(segment, "startLine")?;
            let end = integer(segment, "endLine")?;
            if end < start {
                return Err("invalid-input");
            }
            Ok((start, end))
        })
        .collect::<Checked<Vec<_>>>()?;
    Ok(Source {
        path,
        content_hash,
        metadata_hash,
        mtime,
        size,
        bytes,
        utf16,
        blocks,
        charge,
        segments,
    })
}

/// 원문 한 벌과 String 자체의 논리 저장량입니다.
const fn raw_charge(bytes: usize) -> Option<usize> {
    bytes.checked_add(size_of::<String>())
}

/// NFKC FIFO·분해 버퍼·소문자 문자열·주소 Vec의 보수적 peak입니다.
/// `BTreeMap` 노드를 분해 문자마다 한 개로 예약하여 allocator/RSS 추정으로 쓰지 않습니다.
fn line_charge(line: &str) -> Option<u64> {
    let decomposed = line
        .chars()
        .flat_map(UnicodeNormalization::nfkd)
        .try_fold(0_u64, |count, _| count.checked_add(1))?;
    let lowered = line
        .nfkc()
        .flat_map(char::to_lowercase)
        .try_fold(0_u64, |count, _| count.checked_add(1))?;
    let origin = size_of::<(usize, usize, usize, usize)>();
    let node = 16_usize
        .checked_mul(size_of::<(
            char,
            std::collections::VecDeque<(usize, usize, usize, usize)>,
        )>())?
        .checked_add(16_usize.checked_mul(size_of::<usize>())?)?;
    let fifo = origin
        .checked_mul(4)?
        .checked_add(node)?
        .checked_add(size_of::<(char, u8)>())?;
    let projection = size_of::<SearchCharacter>()
        .checked_mul(2)?
        .checked_add(16)?;
    decomposed
        .checked_mul(u64::try_from(fifo).ok()?)?
        .checked_add(lowered.checked_mul(u64::try_from(projection).ok()?)?)?
        .checked_add(u64::try_from(line.len()).ok()?.checked_mul(4)?)?
        .checked_add(1024)
}

/// producer와 reader가 같은 식으로 실제 행 전체의 charge를 계산합니다.
pub(crate) fn scan_charge_bytes(text: &str) -> Option<u64> {
    if text.len() > MAX_CHARGE {
        return None;
    }
    let mut largest = 0;
    for line in text.split('\n') {
        largest = largest.max(line_charge(line)?);
    }
    // 수신 중 JSON escape·파싱 블록과 scan 중 행 투영은 동시에 유지하지 않습니다.
    let block_work = u64::try_from(text.len().min(BLOCK_BYTES))
        .ok()?
        .checked_mul(16)?
        .checked_add(4096)?;
    u64::try_from(raw_charge(text.len())?)
        .ok()?
        .checked_add(largest.max(block_work))
        .filter(|charge| *charge <= SAFE_INTEGER)
}

/// 원문 블록 경계만 생성하며 hash나 기존 청크를 재생성하지 않습니다.
pub(crate) fn source_body_plan(text: &str) -> Option<JsonValue> {
    let charge = scan_charge_bytes(text)?;
    let mut blocks = Vec::new();
    let mut start = 0;
    let mut start_utf16 = 0;
    while start < text.len() {
        let mut end = start.checked_add(BLOCK_BYTES)?.min(text.len());
        while !text.is_char_boundary(end) {
            end = end.checked_sub(1)?;
        }
        let end_utf16 = start_utf16 + text.get(start..end)?.encode_utf16().count();
        blocks.push(
            json!({"startByte":start,"endByte":end,"startUtf16":start_utf16,"endUtf16":end_utf16}),
        );
        start = end;
        start_utf16 = end_utf16;
    }
    Some(
        json!({"version":1,"byteLength":text.len(),"utf16Length":start_utf16,"scanChargeBytes":charge,"blocks":blocks}),
    )
}

/// 추가 wire와 Rust JSON object의 실제 표현을 보수적으로 예약합니다.
pub(crate) fn body_plan_metadata_charge(plan: &JsonValue) -> Option<usize> {
    let blocks = plan.get("blocks")?.as_array()?.len();
    let fields = blocks.checked_mul(4)?.checked_add(6)?;
    plan.to_string()
        .encode_utf16()
        .count()
        .checked_mul(4)?
        .checked_add(fields.checked_mul(size_of::<JsonValue>().checked_add(256)?)?)
}

/// 원문 본문의 비중첩 블록 계획이며 실패에 본문을 넣지 않습니다.
#[must_use]
#[wasm_bindgen]
pub fn plan_source_body_json(text: &str) -> String {
    source_body_plan(text).map_or_else(|| failure("memory-budget"), |plan| plan.to_string())
}

/// needle identity와 source별 checked counts입니다.
struct Needle {
    /// 호출자가 제공한 미가공 needle입니다.
    original: String,
    /// 행과 같은 NFKC→Unicode lowercase입니다.
    normalized: String,
    /// 일치한 문서 수입니다.
    documents: u64,
    /// 서로 다른 일치 행의 수입니다.
    lines: u64,
    /// 정규화 문자열의 비중첩 발생 수입니다.
    occurrences: u64,
    /// source 안에서 마지막으로 일치한 행입니다.
    last_line: u64,
}

/// 희소 배열·빈 needle·상한 초과를 보정 없이 거절합니다.
fn needles(value: &JsonValue) -> Checked<Vec<Needle>> {
    let array = value
        .get("needles")
        .and_then(JsonValue::as_array)
        .filter(|array| !array.is_empty() && array.len() <= 128)
        .ok_or("invalid-input")?;
    let mut total = 0_usize;
    array
        .iter()
        .map(|value| {
            let needle = value
                .as_str()
                .filter(|needle| !needle.is_empty())
                .ok_or("invalid-input")?;
            let length = needle.encode_utf16().count();
            total = total.checked_add(length).ok_or("invalid-input")?;
            if length > 4096 || total > 65536 {
                return Err("invalid-input");
            }
            let normalized = crate::normalize_search_text(needle).to_lowercase();
            if normalized.is_empty() {
                return Err("invalid-input");
            }
            Ok(Needle {
                original: needle.to_owned(),
                normalized,
                documents: 0,
                lines: 0,
                occurrences: 0,
                last_line: 0,
            })
        })
        .collect()
}

/// 한 행의 정규화·좌표 투영과 다음 행의 주소입니다.
struct Line {
    /// 공개 행 번호입니다.
    number: u64,
    /// 본문 안의 byte 시작점입니다.
    byte: usize,
    /// 본문 안의 UTF-16 시작점입니다.
    utf16: usize,
    /// 다음 행의 byte 시작점입니다.
    next_byte: usize,
    /// 다음 행의 UTF-16 시작점입니다.
    next_utf16: usize,
    /// 공백을 보존한 정규화 행입니다.
    text: String,
    /// 정규화 문자와 원문 좌표입니다.
    mapping: Vec<SearchCharacter>,
}

/// 정상 header만 생성할 수 있는 scanner 내부 상태입니다.
struct Scanner {
    /// 검증한 작은 header입니다.
    source: Source,
    /// 원문은 source 하나만 보관합니다.
    raw: String,
    /// 수신한 블록 수입니다.
    blocks: usize,
    /// 수신한 UTF-16 길이입니다.
    utf16: usize,
    /// needle identity와 집계입니다.
    needles: Vec<Needle>,
    /// 호출자의 scanner 전체 charge 상한입니다.
    max_charge: usize,
    /// header와 needle의 논리 예약입니다.
    header_charge: usize,
    /// 전체 본문 hash와 실제 charge를 검증했는지입니다.
    sealed: bool,
    /// 전체 행과 needle을 배출했는지입니다.
    done: bool,
    /// 유일한 행 투영입니다.
    line: Option<Line>,
    /// 현재 행의 needle 번호입니다.
    needle: usize,
    /// 정규화 행 안의 재개 위치입니다.
    cursor: usize,
}

/// 개별 source의 fail-closed literal scanner이며 reference는 verified citation이 아닙니다.
#[wasm_bindgen]
pub struct LiteralSourceScanner {
    /// 불법 입력은 빈 source로 바꾸지 않고 실패 상태를 보관합니다.
    state: Option<Scanner>,
    /// 원문을 포함하지 않는 고정 실패 사유입니다.
    reason: &'static str,
}

#[wasm_bindgen]
impl LiteralSourceScanner {
    /// v1 header와 needle을 검사하고 원문 하나를 예약합니다.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(input_json: &str) -> Self {
        match Scanner::new(input_json) {
            Ok(state) => Self {
                state: Some(state),
                reason: "not-ready",
            },
            Err(reason) => Self {
                state: None,
                reason,
            },
        }
    }

    /// 순서·주소·codepoint 경계가 연속하는 원문 블록만 추가합니다.
    pub fn append_block_json(&mut self, input_json: &str) -> bool {
        let result = self
            .state
            .as_mut()
            .ok_or(self.reason)
            .and_then(|state| state.append(input_json));
        self.accept(result)
    }

    /// 모든 블록·실제 길이·hash·charge가 맞아야 scan을 허용합니다.
    pub fn seal_input(&mut self) -> bool {
        let result = self
            .state
            .as_mut()
            .ok_or(self.reason)
            .and_then(Scanner::seal);
        self.accept(result)
    }

    /// 최대 256건·1MiB 페이지이며 미수록 reference의 cursor는 전진하지 않습니다.
    pub fn next_page_json(&mut self, max_matches: u32, max_bytes: u32) -> String {
        let result = self
            .state
            .as_mut()
            .ok_or(self.reason)
            .and_then(|state| state.page(max_matches, max_bytes));
        match result {
            Ok(page) => page,
            Err(reason) => {
                self.state = None;
                self.reason = reason;
                failure(reason)
            }
        }
    }

    /// 완전히 배출한 source에만 집계 성공을 반환합니다.
    #[must_use]
    pub fn summary_json(&self) -> String {
        self.state.as_ref().map_or_else(|| failure(self.reason), |state| {
            if !state.done { return failure("not-ready"); }
            let source = &state.source;
            json!({"ok":true,"version":1,"path":source.path,"contentHash":source.content_hash,
                "sourceMetadataHash":source.metadata_hash,"sourceMtime":source.mtime,"sourceSize":source.size,
                "needles":needle_counts(&state.needles)}).to_string()
        })
    }
}

impl LiteralSourceScanner {
    /// bool API의 실패도 불가역이며 본문을 해제합니다.
    fn accept(&mut self, result: Checked<()>) -> bool {
        match result {
            Ok(()) => true,
            Err(reason) => {
                self.state = None;
                self.reason = reason;
                false
            }
        }
    }
}

impl Scanner {
    /// 전체 header charge와 최소 원문 용량을 예약합니다.
    fn new(input: &str) -> Checked<Self> {
        let value = input_json(input, HEADER_BYTES)?;
        let source = source_header(value.get("source").ok_or("invalid-input")?)?;
        let needles = needles(&value)?;
        let max_charge = address(&value, "maxChargeBytes")?;
        let mut header_charge = input
            .len()
            .checked_mul(4)
            .ok_or("memory-budget")?
            .checked_add(size_of::<Self>())
            .ok_or("memory-budget")?;
        header_charge = header_charge
            .checked_add(
                source
                    .segments
                    .len()
                    .checked_mul(
                        size_of::<JsonValue>()
                            .checked_mul(3)
                            .and_then(|size| size.checked_add(512))
                            .ok_or("memory-budget")?,
                    )
                    .ok_or("memory-budget")?,
            )
            .ok_or("memory-budget")?;
        for needle in &needles {
            header_charge = header_charge
                .checked_add(size_of::<Needle>())
                .and_then(|charge| charge.checked_add(needle.normalized.len().checked_mul(4)?))
                .ok_or("memory-budget")?;
        }
        if max_charge > MAX_CHARGE
            || header_charge
                .checked_add(source.charge)
                .is_none_or(|charge| charge > max_charge)
        {
            return Err("memory-budget");
        }
        let mut raw = String::new();
        raw.try_reserve_exact(source.bytes)
            .map_err(|_| "memory-budget")?;
        Ok(Self {
            source,
            raw,
            blocks: 0,
            utf16: 0,
            needles,
            max_charge,
            header_charge,
            sealed: false,
            done: false,
            line: None,
            needle: 0,
            cursor: 0,
        })
    }

    /// JSON escape overhead도 고정된 작은 상한으로 제한합니다.
    fn append(&mut self, input: &str) -> Checked<()> {
        if self.sealed || input.len() > BLOCK_BYTES * 6 + 1024 {
            return Err("invalid-block");
        }
        let value: JsonValue = serde_json::from_str(input).map_err(|_| "invalid-block")?;
        let text = value
            .get("text")
            .and_then(JsonValue::as_str)
            .ok_or("invalid-block")?;
        let utf16 = text.encode_utf16().count();
        if self.blocks >= self.source.blocks
            || text.is_empty()
            || text.len() > BLOCK_BYTES
            || address(&value, "index")? != self.blocks
            || address(&value, "startByte")? != self.raw.len()
            || address(&value, "endByte")?
                != self
                    .raw
                    .len()
                    .checked_add(text.len())
                    .ok_or("invalid-block")?
            || address(&value, "startUtf16")? != self.utf16
            || address(&value, "endUtf16")?
                != self.utf16.checked_add(utf16).ok_or("invalid-block")?
            || self.raw.len() + text.len() > self.source.bytes
            || self.utf16 + utf16 > self.source.utf16
        {
            return Err("invalid-block");
        }
        self.raw.push_str(text);
        self.blocks += 1;
        self.utf16 += utf16;
        Ok(())
    }

    /// 행 전체의 producer 계산을 재사용하며 거짓 header를 인증하지 않습니다.
    fn seal(&mut self) -> Checked<()> {
        if self.sealed
            || self.blocks != self.source.blocks
            || self.raw.len() != self.source.bytes
            || self.utf16 != self.source.utf16
        {
            return Err("incomplete-input");
        }
        if create_content_hash(&self.raw) != self.source.content_hash {
            return Err("source-hash");
        }
        let actual = usize::try_from(scan_charge_bytes(&self.raw).ok_or("memory-budget")?)
            .map_err(|_| "memory-budget")?;
        if actual != self.source.charge
            || actual
                .checked_add(self.header_charge)
                .is_none_or(|charge| charge > self.max_charge)
        {
            return Err("memory-budget");
        }
        self.sealed = true;
        Ok(())
    }

    /// 기존 투영을 해제한 뒤 다음 한 행만 정규화합니다.
    fn advance_line(&mut self) -> Checked<()> {
        let (byte, utf16, number) = self.line.take().map_or((0, 0, 1), |line| {
            (line.next_byte, line.next_utf16, line.number + 1)
        });
        if byte >= self.raw.len() {
            self.done = true;
            return Ok(());
        }
        let rest = self.raw.get(byte..).ok_or("projection-failed")?;
        let newline = rest.find('\n');
        let length = newline.unwrap_or(rest.len());
        let content = rest.get(..length).ok_or("projection-failed")?;
        let consumed = length + usize::from(newline.is_some());
        let next_byte = byte + consumed;
        let next_utf16 = utf16
            + rest
                .get(..consumed)
                .ok_or("projection-failed")?
                .encode_utf16()
                .count();
        let (text, mapping) = literal_projection(content).ok_or("projection-failed")?;
        self.line = Some(Line {
            number,
            byte,
            utf16,
            next_byte,
            next_utf16,
            text,
            mapping,
        });
        self.needle = 0;
        self.cursor = 0;
        Ok(())
    }

    /// 다음 reference의 위치만 찾으며 일치는 아직 소비하지 않습니다.
    fn candidate(&mut self) -> Checked<Option<(usize, usize)>> {
        loop {
            if self.done {
                return Ok(None);
            }
            if self.line.is_none() || self.needle >= self.needles.len() {
                self.advance_line()?;
                if self.done {
                    return Ok(None);
                }
            }
            let line = self.line.as_ref().ok_or("projection-failed")?;
            let needle = self.needles.get(self.needle).ok_or("projection-failed")?;
            if let Some(relative) = line
                .text
                .get(self.cursor..)
                .ok_or("projection-failed")?
                .find(&needle.normalized)
            {
                let start = self.cursor + relative;
                return Ok(Some((start, start + needle.normalized.len())));
            }
            self.needle += 1;
            self.cursor = 0;
        }
    }

    /// 구간 번호 외의 출처 원장은 reference마다 복제하지 않습니다.
    fn reference(&self, start: usize, end: usize) -> Checked<String> {
        let line = self.line.as_ref().ok_or("projection-failed")?;
        let first = line
            .mapping
            .partition_point(|entry| entry.normalized_byte < start);
        let last = line
            .mapping
            .partition_point(|entry| entry.normalized_byte < end);
        let entries = line
            .mapping
            .get(first..last)
            .filter(|entries| !entries.is_empty())
            .ok_or("projection-failed")?;
        let left = entries
            .iter()
            .map(|entry| entry.original_start)
            .min()
            .ok_or("projection-failed")?;
        let right = entries
            .iter()
            .map(|entry| entry.original_end)
            .max()
            .ok_or("projection-failed")?;
        let left_utf16 = entries
            .iter()
            .map(|entry| entry.original_start_utf16)
            .min()
            .ok_or("projection-failed")?;
        let right_utf16 = entries
            .iter()
            .map(|entry| entry.original_end_utf16)
            .max()
            .ok_or("projection-failed")?;
        let source_line = line.number.checked_sub(1).ok_or("projection-failed")?;
        let segments: Vec<_> = self
            .source
            .segments
            .iter()
            .enumerate()
            .filter(|(_, (start, end))| *start <= source_line && source_line <= *end)
            .map(|(index, _)| index)
            .collect();
        let source = &self.source;
        Ok(json!({"path":source.path,"contentHash":source.content_hash,"sourceMetadataHash":source.metadata_hash,
            "sourceMtime":source.mtime,"sourceSize":source.size,"needleIndex":self.needle,"line":line.number,
            "byteStart":line.byte + left,"byteEnd":line.byte + right,"utf16Start":line.utf16 + left_utf16,"utf16End":line.utf16 + right_utf16,
            "normalizedStart":start,"normalizedEnd":end,"sourceSegments":segments}).to_string())
    }

    /// 실제 페이지에 넣은 뒤에만 비중첩 cursor와 집계를 전진시킵니다.
    fn commit_reference(&mut self, end: usize) -> Checked<()> {
        let line = self.line.as_ref().ok_or("projection-failed")?;
        let needle = self
            .needles
            .get_mut(self.needle)
            .ok_or("projection-failed")?;
        needle.occurrences = checked_count(needle.occurrences, 1)?;
        if needle.last_line != line.number {
            needle.lines = checked_count(needle.lines, 1)?;
            needle.last_line = line.number;
        }
        needle.documents = 1;
        self.cursor = end;
        Ok(())
    }

    /// 참조마다 출력 크기를 정확히 재며 마지막 한 건도 누락하지 않습니다.
    fn page(&mut self, max_matches: u32, max_bytes: u32) -> Checked<String> {
        if !self.sealed {
            return Err("not-sealed");
        }
        if !(1..=256).contains(&max_matches) || !(1..=1_048_576).contains(&max_bytes) {
            return Err("invalid-page");
        }
        let limit = usize::try_from(max_bytes).map_err(|_| "invalid-page")?;
        // 출력 String 성장·한 ref 직렬화 사본도 caller의 같은 예산에 넣습니다.
        if limit
            .checked_mul(3)
            .and_then(|charge| charge.checked_add(self.header_charge))
            .and_then(|charge| charge.checked_add(self.source.charge))
            .is_none_or(|charge| charge > self.max_charge)
        {
            return Err("memory-budget");
        }
        let prefix = "{\"ok\":true,\"done\":false,\"references\":[";
        if prefix.len() + 1 > limit {
            return Err("output-budget");
        }
        let mut page = String::from(prefix);
        let mut count = 0;
        while let Some((start, end)) = self.candidate()? {
            if count == max_matches {
                break;
            }
            let reference = self.reference(start, end)?;
            let required = page.len() + usize::from(count > 0) + reference.len() + 2;
            if required > limit {
                // 마지막 한 ref의 done:true는 false보다 정확히 한 byte 짧습니다.
                if count > 0 {
                    break;
                }
                if required != limit + 1 {
                    return Err("output-budget");
                }
                page.push_str(&reference);
                self.commit_reference(end)?;
                if self.candidate()?.is_some() {
                    return Err("output-budget");
                }
                break;
            }
            if count > 0 {
                page.push(',');
            }
            page.push_str(&reference);
            self.commit_reference(end)?;
            count += 1;
        }
        page.push_str("]}");
        if self.done {
            page = page.replacen("\"done\":false", "\"done\":true", 1);
        }
        Ok(page)
    }
}

/// JS 안전 정수를 초과한 총계를 만들지 않습니다.
fn checked_count(left: u64, right: u64) -> Checked<u64> {
    left.checked_add(right)
        .filter(|total| *total <= SAFE_INTEGER)
        .ok_or("count-overflow")
}

/// source와 totals의 공통 needle wire입니다.
fn needle_counts(needles: &[Needle]) -> Vec<JsonValue> {
    needles
        .iter()
        .map(|needle| {
            json!({"needle":needle.original,"normalizedNeedle":needle.normalized,
        "documents":needle.documents,"matchingLines":needle.lines,"occurrences":needle.occurrences})
        })
        .collect()
}

/// 전체 source 집합 대신 identity·counts·마지막 path만 보관합니다.
struct Totals {
    /// 처음 고정한 needle 순서입니다.
    needles: Vec<Needle>,
    /// 완전 결과를 요구하는 source 수입니다.
    expected: u64,
    /// 검사하고 합산한 source 수입니다.
    sources: u64,
    /// IDB와 같은 UTF-16 순서의 마지막 path입니다.
    last_path: Option<String>,
}

/// 완전한 source summary만 받는 작은 checked reducer입니다.
#[wasm_bindgen]
pub struct LiteralInventoryTotals {
    /// 불명 입력은 성공 0이 아니라 실패 상태로 만듭니다.
    state: Option<Totals>,
    /// 고정 실패 사유입니다.
    reason: &'static str,
}

#[wasm_bindgen]
impl LiteralInventoryTotals {
    /// needle identity와 expectedSources를 고정합니다.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(input_json: &str) -> Self {
        match Totals::new(input_json) {
            Ok(state) => Self {
                state: Some(state),
                reason: "not-ready",
            },
            Err(reason) => Self {
                state: None,
                reason,
            },
        }
    }

    /// 완전 summary를 UTF-16 path 오름차순으로 한 번만 수락합니다.
    pub fn append_source_json(&mut self, summary_json: &str) -> bool {
        let result = self
            .state
            .as_mut()
            .ok_or(self.reason)
            .and_then(|state| state.append(summary_json));
        match result {
            Ok(()) => true,
            Err(reason) => {
                self.state = None;
                self.reason = reason;
                false
            }
        }
    }

    /// expectedSources와 수락한 수가 같을 때만 완전 총계입니다.
    #[must_use]
    pub fn finish_json(&self) -> String {
        self.state.as_ref().map_or_else(|| failure(self.reason), |state| {
            if state.sources != state.expected { return failure("incomplete-sources"); }
            json!({"ok":true,"version":1,"sources":state.sources,"needles":needle_counts(&state.needles)}).to_string()
        })
    }
}

impl Totals {
    /// 총계 입력에는 source 본문이나 전체 집합을 보관하지 않습니다.
    fn new(input: &str) -> Checked<Self> {
        let value = input_json(input, HEADER_BYTES)?;
        Ok(Self {
            needles: needles(&value)?,
            expected: integer(&value, "expectedSources")?,
            sources: 0,
            last_path: None,
        })
    }

    /// 한 건이라도 잘못된 summary면 wrapper가 전체 상태를 버립니다.
    fn append(&mut self, input: &str) -> Checked<()> {
        let value = input_json(input, 16 * HEADER_BYTES)?;
        if value.get("ok") != Some(&JsonValue::Bool(true)) || self.sources >= self.expected {
            return Err("invalid-summary");
        }
        let (path, _, _, _, _) = identity(&value)?;
        if self
            .last_path
            .as_ref()
            .is_some_and(|last| last.encode_utf16().cmp(path.encode_utf16()).is_ge())
        {
            return Err("source-order");
        }
        let incoming = value
            .get("needles")
            .and_then(JsonValue::as_array)
            .filter(|array| array.len() == self.needles.len())
            .ok_or("invalid-summary")?;
        for (total, source) in self.needles.iter_mut().zip(incoming) {
            if source.get("needle").and_then(JsonValue::as_str) != Some(total.original.as_str())
                || source.get("normalizedNeedle").and_then(JsonValue::as_str)
                    != Some(total.normalized.as_str())
            {
                return Err("needle-identity");
            }
            let documents = integer(source, "documents")?;
            let lines = integer(source, "matchingLines")?;
            let occurrences = integer(source, "occurrences")?;
            if documents > 1
                || (documents == 0) != (occurrences == 0)
                || (lines == 0) != (occurrences == 0)
                || lines > occurrences
            {
                return Err("invalid-counts");
            }
            total.documents = checked_count(total.documents, documents)?;
            total.lines = checked_count(total.lines, lines)?;
            total.occurrences = checked_count(total.occurrences, occurrences)?;
        }
        self.sources = checked_count(self.sources, 1)?;
        self.last_path = Some(path);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 인용 검색의 공백 압축과 구별하는 원래 semantic RED입니다.
    #[test]
    fn literal_preserves_whitespace_semantic_red() {
        let projection =
            literal_projection("Ａ\u{a0}\t  B\"한국어조사까지\"").map(|(text, _)| text);
        assert_eq!(projection.as_deref(), Some("a \t  b\"한국어조사까지\""));
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    /// 합성 wire를 읽고 parse 실패도 assertion으로 드러냅니다.
    fn parse(wire: &str) -> JsonValue {
        let parsed = serde_json::from_str::<JsonValue>(wire);
        assert!(parsed.is_ok(), "합성 JSON 필요");
        parsed.unwrap_or(JsonValue::Null)
    }

    /// 테스트 좌표 누락은 null로 비교합니다.
    fn at<'a>(value: &'a JsonValue, pointer: &str) -> &'a JsonValue {
        value.pointer(pointer).unwrap_or(&JsonValue::Null)
    }

    /// 합성 object의 입력 한 개를 변경합니다.
    fn set(value: &mut JsonValue, key: &str, field: JsonValue) {
        assert!(value.is_object(), "합성 object 필요");
        if let Some(object) = value.as_object_mut() {
            object.insert(key.to_owned(), field);
        }
    }

    /// producer plan 자체를 header에 전달합니다.
    fn header(text: &str, terms: &[&str]) -> JsonValue {
        let plan = parse(&plan_source_body_json(text));
        assert_eq!(at(&plan, "/version"), 1);
        json!({"version":1,"needles":terms,"maxChargeBytes":MAX_CHARGE,"source":{
            "path":"synthetic/body.txt","contentHash":create_content_hash(text),"sourceMetadataHash":"12345678",
            "sourceMtime":12.25,"sourceSize":text.len(),"version":1,"byteLength":at(&plan,"/byteLength"),
            "utf16Length":at(&plan,"/utf16Length"),"blockCount":plan.get("blocks").and_then(JsonValue::as_array).map(Vec::len),
            "scanChargeBytes":at(&plan,"/scanChargeBytes"),"segments":[{"startLine":1,"endLine":2},{"startLine":1,"endLine":1}]}})
    }

    /// 모든 producer 블록을 변경 없이 보냅니다.
    fn append_blocks(scanner: &mut LiteralSourceScanner, text: &str) {
        let plan = parse(&plan_source_body_json(text));
        let blocks = plan.get("blocks").and_then(JsonValue::as_array);
        assert!(blocks.is_some(), "producer 블록 필요");
        for (index, block) in blocks.into_iter().flatten().enumerate() {
            let start = address(block, "startByte").unwrap_or(usize::MAX);
            let end = address(block, "endByte").unwrap_or(usize::MAX);
            let part = text.get(start..end);
            assert!(part.is_some(), "codepoint 경계 필요");
            assert!(
                scanner.append_block_json(
                    &json!({"index":index,"startByte":start,"endByte":end,
                "startUtf16":at(block,"/startUtf16"),"endUtf16":at(block,"/endUtf16"),"text":part})
                    .to_string()
                ),
                "블록 수락"
            );
        }
    }

    /// 완전 source scanner를 생성합니다.
    fn scanner(text: &str, terms: &[&str]) -> LiteralSourceScanner {
        let mut scanner = LiteralSourceScanner::new(&header(text, terms).to_string());
        append_blocks(&mut scanner, text);
        assert!(scanner.seal_input(), "완전한 합성 source seal");
        scanner
    }

    /// 테스트만 참조를 모으며 runtime에는 한 페이지만 남습니다.
    fn drain(scanner: &mut LiteralSourceScanner, page_size: u32) -> Vec<JsonValue> {
        let mut all = Vec::new();
        for _ in 0..200_000 {
            let page = parse(&scanner.next_page_json(page_size, 1_048_576));
            assert_eq!(at(&page, "/ok"), true);
            let references = page.get("references").and_then(JsonValue::as_array);
            assert!(references.is_some(), "참조 배열 필요");
            all.extend(references.into_iter().flatten().cloned());
            if at(&page, "/done") == true {
                return all;
            }
        }
        assert!(
            scanner.state.as_ref().is_some_and(|state| state.done),
            "합성 입력 종료 실패"
        );
        all
    }

    /// summary의 needle 한 개 집계입니다.
    fn counts(scanner: &LiteralSourceScanner, index: usize) -> JsonValue {
        let summary = parse(&scanner.summary_json());
        assert_eq!(at(&summary, "/ok"), true);
        summary
            .pointer(&format!("/needles/{index}"))
            .cloned()
            .unwrap_or(JsonValue::Null)
    }

    /// 한국어 4글자 이상과 조사·긴 영단어 내부도 token화 없이 일치합니다.
    #[test]
    fn korean_particles_and_long_english_substrings() {
        let mut scan = scanner(
            "도서관사서는 도서관사서에게 도서관사서와\npreINTERNATIONALIZATIONpost",
            &["도서관사서", "nationaliz"],
        );
        let references = drain(&mut scan, 1);
        assert_eq!(references.len(), 4);
        assert_eq!(
            counts(&scan, 0),
            json!({"needle":"도서관사서","normalizedNeedle":"도서관사서","documents":1,"matchingLines":1,"occurrences":3})
        );
        assert_eq!(at(&counts(&scan, 1), "/occurrences"), 1);
    }

    /// NFKC 이외에는 공백이나 따옴표를 가공하지 않습니다.
    #[test]
    fn whitespace_punctuation_quotes_and_nfkc() {
        let mut scan = scanner(
            "Ａ\u{a0}\t  B \"a  b\" a b",
            &["a \t  b", "a  b", "\"a  b\"", "a b", "  ", "missing"],
        );
        assert_eq!(drain(&mut scan, 2).len(), 6);
        for index in 0..4 {
            assert_eq!(at(&counts(&scan, index), "/occurrences"), 1);
        }
        assert_eq!(at(&counts(&scan, 4), "/occurrences"), 2);
        assert_eq!(at(&counts(&scan, 5), "/documents"), 0);
    }

    #[test]
    fn literal_parent_preserves_crlf_carriage_return_like_oracle() {
        let mut scan = scanner("a\r\nb\rc\r\n", &["\r", "a\r", "b\rc\r", "a\nb"]);
        let references = drain(&mut scan, 1);
        assert_eq!(at(&counts(&scan, 0), "/occurrences"), 3);
        assert_eq!(at(&counts(&scan, 0), "/matchingLines"), 2);
        assert_eq!(at(&counts(&scan, 1), "/occurrences"), 1);
        assert_eq!(at(&counts(&scan, 2), "/occurrences"), 1);
        assert_eq!(at(&counts(&scan, 3), "/occurrences"), 0);
        assert_eq!(references.len(), 5);
    }

    #[test]
    fn literal_parent_zero_based_source_segment_projection() {
        let text = "first\nsecond";
        let mut value = header(text, &["first", "second"]);
        if let Some(source) = value.get_mut("source") {
            set(
                source,
                "segments",
                json!([{"startLine":0,"endLine":0},{"startLine":0,"endLine":1},{"startLine":1,"endLine":1}]),
            );
        }
        let mut scan = LiteralSourceScanner::new(&value.to_string());
        append_blocks(&mut scan, text);
        assert!(scan.seal_input(), "0 기반 추출 구간을 허용");
        let references = drain(&mut scan, 1);
        assert_eq!(
            references
                .first()
                .and_then(|value| value.get("sourceSegments")),
            Some(&json!([0, 1]))
        );
        assert_eq!(
            references
                .get(1)
                .and_then(|value| value.get("sourceSegments")),
            Some(&json!([1, 2]))
        );
    }

    #[test]
    fn literal_parent_preparation_reserves_raw_block_io_copies() {
        let text = "a".repeat(10_000);
        let value = parse(&crate::source_preparation::prepare_source_bytes_json(
            "txt",
            text.as_bytes(),
            r#"{"path":"synthetic.txt"}"#,
        ));
        let charge = value
            .pointer("/prepared/chargeBytes")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        let scan_charge = value
            .pointer("/prepared/bodyPlan/scanChargeBytes")
            .and_then(JsonValue::as_u64)
            .unwrap_or(0);
        assert!(charge >= 80_000, "raw block I/O 사본 charge");
        assert!(
            charge < scan_charge,
            "미래 scan 작업량은 중복 예약하지 않음"
        );
    }

    /// CRLF를 넘는 일치를 금지하고 절대 byte·UTF-16을 보존합니다.
    #[test]
    fn crlf_absolute_coordinates_and_segments() {
        let text = "😀a\r\nﬃx\r\na\nb";
        let mut scan = scanner(text, &["f", "a\nb", "a\r\nf", "x", "a"]);
        let references = drain(&mut scan, 1);
        assert_eq!(references.len(), 5);
        let f: Vec<_> = references
            .iter()
            .filter(|value| at(value, "/needleIndex") == 0)
            .collect();
        assert_eq!(f.len(), 2);
        for value in f {
            assert_eq!(at(value, "/line"), 2);
            assert_eq!(at(value, "/byteStart"), 7);
            assert_eq!(at(value, "/byteEnd"), 10);
            assert_eq!(at(value, "/utf16Start"), 5);
            assert_eq!(at(value, "/utf16End"), 6);
            assert_eq!(at(value, "/sourceSegments"), &json!([0, 1]));
            assert_eq!(at(value, "/sourceMtime"), 12.25);
        }
        assert_eq!(at(&counts(&scan, 1), "/occurrences"), 0);
        assert_eq!(at(&counts(&scan, 2), "/occurrences"), 0);
        assert_eq!(at(&counts(&scan, 4), "/matchingLines"), 2);
        assert!(
            references
                .iter()
                .any(|value| at(value, "/line") == 1 && at(value, "/sourceSegments") == &json!([])),
            "원장 밖 행은 빈 index 목록"
        );
        assert!(references.iter().any(|value| at(value,"/line") == 3 && at(value,"/sourceSegments") == &json!([0])),"겹치는 모든 구간 번호");
    }

    /// 원문 범위가 같아도 정규화 확장의 f 두 번을 합치지 않습니다.
    #[test]
    fn ligature_expansion_and_nonoverlap_counts() {
        let mut scan = scanner("ﬃ aaaa\nﬃ", &["f", "aa"]);
        let references = drain(&mut scan, 1);
        assert_eq!(references.len(), 6);
        assert_eq!(at(&counts(&scan, 0), "/occurrences"), 4);
        assert_eq!(at(&counts(&scan, 0), "/matchingLines"), 2);
        assert_eq!(at(&counts(&scan, 1), "/occurrences"), 2);
        let f: Vec<_> = references
            .iter()
            .filter(|value| at(value, "/line") == 1 && at(value, "/needleIndex") == 0)
            .collect();
        assert_eq!(f.len(), 2);
        assert_eq!(
            f.first().map(|value| at(value, "/byteStart")),
            Some(&json!(0))
        );
        assert_eq!(
            f.last().map(|value| at(value, "/byteStart")),
            Some(&json!(0))
        );
        assert_ne!(
            f.first().map(|value| at(value, "/normalizedStart")),
            f.last().map(|value| at(value, "/normalizedStart"))
        );
    }

    /// 같은 행의 뒤쪽 반복도 작은 페이지에서 잃지 않습니다.
    #[test]
    fn late_repetitions_and_final_single_reference_page() {
        let text = format!("hit {} hit hit", "noise ".repeat(1000));
        let mut scan = scanner(&text, &["hit"]);
        let references = drain(&mut scan, 1);
        assert_eq!(references.len(), 3);
        assert_eq!(
            references.last().map(|value| at(value, "/byteEnd")),
            Some(&json!(text.len()))
        );
        assert_eq!(at(&counts(&scan, 0), "/matchingLines"), 1);
    }

    /// 블록 경계의 결합 문자도 행 전체에서 정규화합니다.
    #[test]
    fn long_line_combining_across_blocks() {
        let text = format!("{}e\u{301}😀끝", "x".repeat(BLOCK_BYTES - 1));
        let plan = parse(&plan_source_body_json(&text));
        assert_eq!(
            plan.get("blocks")
                .and_then(JsonValue::as_array)
                .map(Vec::len),
            Some(2)
        );
        let mut scan = scanner(&text, &["é😀끝"]);
        let references = drain(&mut scan, 1);
        assert_eq!(references.len(), 1);
        let reference = references.first().cloned().unwrap_or(JsonValue::Null);
        assert_eq!(at(&reference, "/byteStart"), BLOCK_BYTES - 1);
        assert_eq!(at(&reference, "/byteEnd"), text.len());
        assert_eq!(at(&reference, "/utf16Start"), BLOCK_BYTES - 1);
        assert_eq!(at(&reference, "/utf16End"), text.encode_utf16().count());
    }

    /// 전체 lowercase의 final sigma 문맥과 정준 재배열을 보존합니다.
    #[test]
    fn contextual_lowercase_and_decomposition_reordering() {
        let mut scan = scanner("ΟΣ A\u{315}\u{300} İ", &["ος", "à\u{315}", "i\u{307}"]);
        assert_eq!(drain(&mut scan, 1).len(), 3);
        for index in 0..3 {
            assert_eq!(at(&counts(&scan, index), "/occurrences"), 1);
        }
    }

    /// 빈 본문은 명시적인 0블록이며 metadata를 quote로 바꾸지 않습니다.
    #[test]
    fn empty_body_is_explicit_complete_zero() {
        let plan = parse(&plan_source_body_json(""));
        assert_eq!(at(&plan, "/blocks"), &json!([]));
        assert_eq!(at(&plan, "/utf16Length"), 0);
        let mut scan = scanner("", &["metadata"]);
        assert!(
            drain(&mut scan, 1).is_empty(),
            "빈 본문에는 참조가 없습니다"
        );
        assert_eq!(at(&counts(&scan, 0), "/documents"), 0);
        let mut probe = scanner("", &["metadata"]);
        let wire = probe.next_page_json(1, 4096);
        let size = u32::try_from(wire.len()).unwrap_or(0);
        let mut exact = scanner("", &["metadata"]);
        assert_eq!(exact.next_page_json(1, size), wire);
    }

    /// 모든 블록은 codepoint 경계를 지키고 본문 전체를 보존합니다.
    #[test]
    fn body_plan_codepoint_boundaries_and_charge() {
        let text = format!(
            "{}{}\n{}",
            "😀".repeat(20_000),
            "\u{fdfa}".repeat(200),
            "x\n".repeat(1000)
        );
        let plan = parse(&plan_source_body_json(&text));
        let blocks = plan.get("blocks").and_then(JsonValue::as_array);
        assert!(blocks.is_some(), "블록 배열");
        let mut byte = 0;
        let mut utf16 = 0;
        for block in blocks.into_iter().flatten() {
            assert_eq!(at(block, "/startByte"), byte);
            assert_eq!(at(block, "/startUtf16"), utf16);
            let end = address(block, "endByte").unwrap_or(usize::MAX);
            let part = text.get(byte..end);
            assert!(part.is_some(), "codepoint 보존");
            assert!(end - byte <= BLOCK_BYTES, "블록 상한");
            utf16 += part.unwrap_or_default().encode_utf16().count();
            byte = end;
            assert_eq!(at(block, "/endUtf16"), utf16);
        }
        assert_eq!(byte, text.len());
        assert_eq!(
            at(&plan, "/scanChargeBytes"),
            &scan_charge_bytes(&text).map_or(JsonValue::Null, |charge| json!(charge))
        );
        assert!(
            line_charge("ﬃ")
                .is_some_and(|expanded| line_charge("Ａ").is_some_and(|plain| expanded > plain)),
            "정규화 확장 charge"
        );
        assert!(
            line_charge("\u{fdfa}").is_some_and(|charge| charge
                > u64::try_from(size_of::<SearchCharacter>() * 18).unwrap_or(u64::MAX)),
            "긴 호환 확장"
        );
    }

    /// 실제 charge와 hash를 seal에서 반드시 재확인합니다.
    #[test]
    fn fraudulent_charge_and_hash_fail_closed() {
        for (key, replacement, reason) in [
            ("contentHash", json!("00000000"), "source-hash"),
            ("scanChargeBytes", json!(12345), "memory-budget"),
        ] {
            let text = "synthetic raw";
            let mut value = header(text, &["raw"]);
            let source = value.get_mut("source");
            assert!(source.is_some(), "source header");
            if let Some(source) = source {
                set(source, key, replacement);
            }
            let mut scan = LiteralSourceScanner::new(&value.to_string());
            append_blocks(&mut scan, text);
            assert!(!scan.seal_input(), "위조 header 거절");
            assert_eq!(
                parse(&scan.summary_json()),
                json!({"ok":false,"reason":reason})
            );
        }
    }

    /// 미완료 source는 성공 0으로 바뀌지 않습니다.
    #[test]
    fn missing_blocks_and_premature_scanning_are_errors() {
        let mut scan = LiteralSourceScanner::new(&header("abc", &["a"]).to_string());
        assert_eq!(at(&parse(&scan.summary_json()), "/ok"), false);
        assert!(!scan.seal_input(), "블록 부족");
        assert_eq!(
            at(&parse(&scan.summary_json()), "/reason"),
            "incomplete-input"
        );
        let mut scan = LiteralSourceScanner::new(&header("abc", &["a"]).to_string());
        assert_eq!(
            at(&parse(&scan.next_page_json(1, 4096)), "/reason"),
            "not-sealed"
        );
    }

    /// 블록 순서·offset·크기·빈 블록·상한 오류를 보정하지 않습니다.
    #[test]
    fn malformed_and_out_of_order_blocks() {
        for (key, value) in [
            ("index", json!(1)),
            ("startByte", json!(1)),
            ("endByte", json!(4)),
            ("startUtf16", json!(1)),
            ("endUtf16", json!(4)),
            ("text", json!("")),
            ("text", json!("x".repeat(BLOCK_BYTES + 1))),
        ] {
            let mut scan = LiteralSourceScanner::new(&header("abc", &["a"]).to_string());
            let mut block = json!({"index":0,"startByte":0,"endByte":3,"startUtf16":0,"endUtf16":3,"text":"abc"});
            set(&mut block, key, value);
            assert!(
                !scan.append_block_json(&block.to_string()),
                "잘못된 블록 거절"
            );
            assert_eq!(at(&parse(&scan.summary_json()), "/ok"), false);
        }
        let mut scan = scanner("abc", &["a"]);
        assert!(!scan.append_block_json("{}"), "seal 뒤 추가 금지");
    }

    /// null·희소 배열·빈 needle·길이 초과·잘못된 예산을 거절합니다.
    #[test]
    fn invalid_headers_needles_and_arbitrary_caps() {
        for field in [
            JsonValue::Null,
            json!([]),
            json!([null]),
            json!([""]),
            json!(["x".repeat(4097)]),
            json!(vec!["a"; 129]),
            json!(vec!["x".repeat(4096); 17]),
        ] {
            let mut value = header("abc", &["a"]);
            set(&mut value, "needles", field);
            let scan = LiteralSourceScanner::new(&value.to_string());
            assert_eq!(at(&parse(&scan.summary_json()), "/ok"), false);
        }
        for cap in [
            json!(0),
            json!(1),
            json!(-1),
            json!(1.5),
            json!(MAX_CHARGE + 1),
            JsonValue::Null,
        ] {
            let mut value = header("abc", &["a"]);
            set(&mut value, "maxChargeBytes", cap);
            let scan = LiteralSourceScanner::new(&value.to_string());
            assert_eq!(at(&parse(&scan.summary_json()), "/ok"), false);
        }
        for (key, field) in [
            ("version", json!(2)),
            ("sourceMtime", json!(-0.5)),
            ("sourceSize", json!(SAFE_INTEGER + 1)),
            ("byteLength", json!(MAX_CHARGE + 1)),
            ("utf16Length", json!(9)),
            ("blockCount", json!(0)),
            ("contentHash", json!("private")),
            ("sourceMetadataHash", json!("abcd")),
            ("segments", json!([null])),
        ] {
            let mut value = header("abc", &["a"]);
            assert!(value.get("source").is_some(), "source 존재");
            if let Some(source) = value.get_mut("source") {
                set(source, key, field);
            }
            let scan = LiteralSourceScanner::new(&value.to_string());
            assert_eq!(at(&parse(&scan.summary_json()), "/ok"), false);
        }
        assert_eq!(
            at(
                &parse(&LiteralSourceScanner::new("{}").summary_json()),
                "/ok"
            ),
            false
        );
        let huge = " ".repeat(HEADER_BYTES + 1);
        assert_eq!(
            at(
                &parse(&LiteralSourceScanner::new(&huge).summary_json()),
                "/ok"
            ),
            false
        );
    }

    /// header 예약도 caller cap의 정확한 경계로 검사합니다.
    #[test]
    fn exact_scanner_admission_boundary() {
        let text = "many\nsmall\nlines";
        let mut value = header(text, &["small"]);
        let probe = LiteralSourceScanner::new(&value.to_string());
        assert!(probe.state.is_some(), "정상 header");
        let needed = probe
            .state
            .as_ref()
            .map_or(0, |state| state.header_charge + state.source.charge);
        set(&mut value, "maxChargeBytes", json!(needed));
        let probe = LiteralSourceScanner::new(&value.to_string());
        assert!(probe.state.is_some(), "JSON 숫자 길이 감소");
        let needed = probe
            .state
            .as_ref()
            .map_or(0, |state| state.header_charge + state.source.charge);
        set(&mut value, "maxChargeBytes", json!(needed));
        let mut scan = LiteralSourceScanner::new(&value.to_string());
        append_blocks(&mut scan, text);
        assert!(scan.seal_input(), "정확한 최소 charge");
        assert_eq!(
            at(&parse(&scan.next_page_json(1, 4096)), "/reason"),
            "memory-budget"
        );
        set(&mut value, "maxChargeBytes", json!(needed - 1));
        let scan = LiteralSourceScanner::new(&value.to_string());
        assert_eq!(at(&parse(&scan.summary_json()), "/reason"), "memory-budget");
    }

    /// 다음 ref가 byte 예산을 넘으면 cursor를 그대로 보존합니다.
    #[test]
    fn page_byte_boundary_keeps_pending_reference() {
        let mut probe = scanner("a a a", &["a"]);
        let first = probe.next_page_json(1, 4096);
        let size = u32::try_from(first.len()).unwrap_or(0);
        let mut scan = scanner("a a a", &["a"]);
        for _ in 0..3 {
            let wire = scan.next_page_json(256, size);
            assert!(
                wire.len() <= usize::try_from(size).unwrap_or(0),
                "byte 상한"
            );
            let page = parse(&wire);
            assert_eq!(at(&page, "/ok"), true);
            assert_eq!(
                page.get("references")
                    .and_then(JsonValue::as_array)
                    .map(Vec::len),
                Some(1)
            );
        }
        assert_eq!(at(&counts(&scan, 0), "/occurrences"), 3);
        let mut last_probe = scanner("a", &["a"]);
        let last = last_probe.next_page_json(1, 4096);
        let last_size = u32::try_from(last.len()).unwrap_or(0);
        let mut exact_last = scanner("a", &["a"]);
        assert_eq!(exact_last.next_page_json(1, last_size), last);
        let mut small = scanner("a", &["a"]);
        assert_eq!(
            at(&parse(&small.next_page_json(1, last_size - 1)), "/reason"),
            "output-budget"
        );
    }

    /// 작은 내부 상한도 clamp하지 않습니다.
    #[test]
    fn page_caps_are_strict_and_summary_is_not_early() {
        for (matches, bytes) in [(0, 1000), (257, 1000), (1, 0), (1, 1_048_577)] {
            let mut scan = scanner("a", &["a"]);
            assert_eq!(at(&parse(&scan.summary_json()), "/reason"), "not-ready");
            assert_eq!(
                at(&parse(&scan.next_page_json(matches, bytes)), "/ok"),
                false
            );
            assert_eq!(at(&parse(&scan.summary_json()), "/ok"), false);
        }
    }

    /// 정상 source summary의 합성 path만 교체합니다.
    fn summary(path: &str) -> JsonValue {
        let mut scan = scanner("a a\na", &["a", "absent"]);
        drain(&mut scan, 1);
        let mut summary = parse(&scan.summary_json());
        set(&mut summary, "path", json!(path));
        summary
    }

    /// 작은 reducer를 초기화합니다.
    fn totals(expected: u64) -> LiteralInventoryTotals {
        LiteralInventoryTotals::new(
            &json!({"version":1,"needles":["a","absent"],"expectedSources":expected}).to_string(),
        )
    }

    /// UTF-8과 순서가 다른 보조면 path도 IDB UTF-16 순서를 따릅니다.
    #[test]
    fn totals_utf16_path_order_and_exact_counts() {
        let mut totals = totals(2);
        assert!("\u{10000}" > "\u{e000}", "UTF-8과의 차이");
        assert!(
            totals.append_source_json(&summary("\u{10000}").to_string()),
            "첫 path"
        );
        assert!(
            totals.append_source_json(&summary("\u{e000}").to_string()),
            "UTF-16 오름차순"
        );
        let result = parse(&totals.finish_json());
        assert_eq!(at(&result, "/ok"), true);
        assert_eq!(at(&result, "/sources"), 2);
        assert_eq!(at(&result, "/needles/0/documents"), 2);
        assert_eq!(at(&result, "/needles/0/matchingLines"), 4);
        assert_eq!(at(&result, "/needles/0/occurrences"), 6);
        assert_eq!(at(&result, "/needles/1/documents"), 0);
    }

    /// 중복·역순·expected 불일치를 완전 성공으로 만들지 않습니다.
    #[test]
    fn totals_reject_duplicate_reverse_order_and_expected_mismatch() {
        for (first, last) in [("a", "a"), ("b", "a"), ("\u{e000}", "\u{10000}")] {
            let mut totals = totals(2);
            assert!(
                totals.append_source_json(&summary(first).to_string()),
                "첫 source"
            );
            assert!(
                !totals.append_source_json(&summary(last).to_string()),
                "중복·역순 거절"
            );
            assert_eq!(at(&parse(&totals.finish_json()), "/ok"), false);
        }
        let mut short = totals(2);
        assert!(short.append_source_json(&summary("a").to_string()), "한 건");
        assert_eq!(
            at(&parse(&short.finish_json()), "/reason"),
            "incomplete-sources"
        );
        let mut zero = totals(0);
        assert_eq!(at(&parse(&zero.finish_json()), "/sources"), 0);
        assert!(
            !zero.append_source_json(&summary("a").to_string()),
            "expected 초과"
        );
    }

    /// needle identity·순서·희소 count·overflow를 검사합니다.
    #[test]
    fn totals_reject_identity_sparse_counts_and_overflow() {
        for (key, value) in [
            ("needle", json!("b")),
            ("normalizedNeedle", json!("A")),
            ("documents", json!(2)),
            ("documents", json!(0)),
            ("matchingLines", json!(0)),
            ("matchingLines", json!(4)),
            ("occurrences", json!(0)),
            ("occurrences", json!(SAFE_INTEGER + 1)),
        ] {
            let mut wire = summary("a");
            assert!(wire.pointer("/needles/0").is_some(), "needle count");
            if let Some(first) = wire.pointer_mut("/needles/0") {
                set(first, key, value);
            }
            let mut totals = totals(1);
            assert!(
                !totals.append_source_json(&wire.to_string()),
                "잘못된 summary 거절"
            );
            assert_eq!(at(&parse(&totals.finish_json()), "/ok"), false);
        }
        for needles in [
            json!([null, null]),
            json!([]),
            json!([{"needle":"absent"},{"needle":"a"}]),
        ] {
            let mut wire = summary("a");
            set(&mut wire, "needles", needles);
            assert!(
                !totals(1).append_source_json(&wire.to_string()),
                "희소·순서 오류"
            );
        }
        let mut huge = summary("a");
        if let Some(first) = huge.pointer_mut("/needles/0") {
            set(first, "occurrences", json!(SAFE_INTEGER));
        }
        let mut totals = totals(2);
        assert!(
            totals.append_source_json(&huge.to_string()),
            "최대 safeint 허용"
        );
        assert!(
            !totals.append_source_json(&summary("b").to_string()),
            "checked 합계 초과"
        );
        assert_eq!(
            at(&parse(&totals.finish_json()), "/reason"),
            "count-overflow"
        );
    }

    /// 미래 scan charge가 커도 준비 본문·hash·기존 청크를 버리지 않습니다.
    #[test]
    fn preparation_does_not_reserve_future_scan_workspace() {
        let text = "x".repeat(2 * 1024 * 1024);
        let charge = scan_charge_bytes(&text);
        assert!(
            charge.is_some_and(|charge| charge > u64::try_from(MAX_CHARGE).unwrap_or(u64::MAX)),
            "큰 한 행의 실제 scan charge"
        );
        let source = json!({"ok":true,"text":text,"segments":[]});
        let result = parse(&crate::prepare_source_text_json(
            "txt",
            &source.to_string(),
            "{\"path\":\"synthetic/long.txt\"}",
        ));
        assert_eq!(at(&result, "/ok"), true);
        assert_eq!(at(&result, "/text"), at(&source, "/text"));
        assert!(result.get("prepared").is_some(), "준비 결과 보존");
        assert_eq!(
            at(&result, "/prepared/bodyPlan/scanChargeBytes"),
            &json!(charge)
        );
        assert!(
            address(
                result.get("prepared").unwrap_or(&JsonValue::Null),
                "chargeBytes"
            )
            .is_ok_and(|prepared| prepared < MAX_CHARGE),
            "준비에는 미래 작업량을 예약하지 않습니다"
        );
        let header = header(&text, &["x"]);
        assert_eq!(
            at(
                &parse(&LiteralSourceScanner::new(&header.to_string()).summary_json()),
                "/ok"
            ),
            false
        );
    }

    /// 블록 사이에 나뉜 그리스어도 전체 행의 소문자 문맥을 사용합니다.
    #[test]
    fn contextual_lowercase_across_block_boundary() {
        let text = format!("{}ΟΣ", "x".repeat(BLOCK_BYTES - 2));
        let mut scan = scanner(&text, &["ος"]);
        let references = drain(&mut scan, 1);
        assert_eq!(references.len(), 1);
        assert_eq!(
            references
                .first()
                .map(|reference| at(reference, "/byteEnd")),
            Some(&json!(text.len()))
        );
    }

    /// 총 match 배열 없이 엄격한 최대 페이지 크기로 모두 배출합니다.
    #[test]
    fn maximum_page_match_count_does_not_truncate() {
        let mut scan = scanner(&"a ".repeat(600), &["a"]);
        for (expected, done) in [(256, false), (256, false), (88, true)] {
            let wire = scan.next_page_json(256, 1_048_576);
            assert!(wire.len() <= 1_048_576, "페이지 byte 상한");
            let page = parse(&wire);
            assert_eq!(
                page.get("references")
                    .and_then(JsonValue::as_array)
                    .map(Vec::len),
                Some(expected)
            );
            assert_eq!(at(&page, "/done"), done);
        }
        assert_eq!(at(&counts(&scan, 0), "/occurrences"), 600);
    }

    /// 허용된 최대 needle의 NFKC 확장도 reducer까지 전달됩니다.
    #[test]
    fn maximum_needle_expansion_summary_is_accepted() {
        let term = "\u{fdfa}".repeat(4096);
        let terms = vec![term.as_str(); 16];
        let mut scan = scanner("", &terms);
        assert!(drain(&mut scan, 1).is_empty(), "빈 본문");
        let wire = scan.summary_json();
        assert!(
            wire.len() > HEADER_BYTES,
            "정규화 확장으로 summary는 header보다 큽니다"
        );
        let mut totals = LiteralInventoryTotals::new(
            &json!({"version":1,"needles":terms,"expectedSources":1}).to_string(),
        );
        assert!(totals.append_source_json(&wire), "허용된 needle summary");
        assert_eq!(at(&parse(&totals.finish_json()), "/sources"), 1);
    }

    /// 오류에 원문·needle·path를 넣지 않습니다.
    #[test]
    fn failures_do_not_echo_sensitive_input() {
        let mut value = header("sensitive raw", &["sensitive needle"]);
        set(&mut value, "maxChargeBytes", json!(0));
        let scan = LiteralSourceScanner::new(&value.to_string());
        assert_eq!(
            parse(&scan.summary_json()),
            json!({"ok":false,"reason":"memory-budget"})
        );
        let mut totals = LiteralInventoryTotals::new("{}");
        assert!(
            !totals.append_source_json("sensitive path"),
            "실패 상태 유지"
        );
        assert_eq!(
            parse(&totals.finish_json()),
            json!({"ok":false,"reason":"invalid-input"})
        );
    }

    /// 기존 hash·chunk를 보존하고 추가 plan metadata만 예약합니다.
    #[test]
    fn preparation_plan_metadata_budget_and_empty_metadata() {
        let raw = json!({"ok":true,"format":"text","text":"a a\na","segments":[]});
        let config = json!({"path":"synthetic.txt","chunkSize":100,"overlap":0});
        let full = parse(&crate::prepare_source_text_json(
            "txt",
            &raw.to_string(),
            &config.to_string(),
        ));
        assert_eq!(at(&full, "/ok"), true);
        assert_eq!(
            at(&full, "/prepared/bodyPlan"),
            &parse(&plan_source_body_json("a a\na"))
        );
        assert_eq!(
            at(&full, "/prepared/contentHash"),
            create_content_hash("a a\na").as_str()
        );
        let charge = address(
            full.get("prepared").unwrap_or(&JsonValue::Null),
            "chargeBytes",
        )
        .unwrap_or(0);
        assert!(charge > 0, "실제 charge");
        let mut limited = config;
        set(&mut limited, "maxChargeBytes", json!(charge));
        assert_eq!(
            parse(&crate::prepare_source_text_json(
                "txt",
                &raw.to_string(),
                &limited.to_string()
            )),
            full
        );
        set(&mut limited, "maxChargeBytes", json!(charge - 1));
        let failure = parse(&crate::prepare_source_text_json(
            "txt",
            &raw.to_string(),
            &limited.to_string(),
        ));
        assert_eq!(at(&failure, "/reason"), "memory-budget");
        assert_eq!(at(&failure, "/text"), "");
        assert!(failure.get("prepared").is_none(), "실패 시 plan 없음");
        let empty = json!({"ok":true,"text":"","segments":[],"metadataParts":[{"label":"synthetic empty sheet"}]});
        let empty = parse(&crate::prepare_source_text_json(
            "txt",
            &empty.to_string(),
            "{\"path\":\"empty.txt\"}",
        ));
        assert_eq!(at(&empty, "/ok"), true);
        assert_eq!(at(&empty, "/prepared/bodyPlan/blocks"), &json!([]));
        assert_eq!(
            at(&empty, "/metadataParts/0/label"),
            "synthetic empty sheet"
        );
    }
}
