//! 압축 텍스트 문서에서 검색 가능한 본문을 결정적으로 추출합니다.
//!
//! 지원 대상은 `EPUB`, `DOCX`, `DOTX`, `ODT`, `ODP`, `ODS`, `PPTX`, `POTX`, `PPSX`, `XLSX`,
//! `XLTX`, `HWPX`입니다. PDF는 같은 계약을 따르는 별도 TS worker가 추출하므로 여기서는 다루지
//! 않습니다. 이미지·동영상·오디오와 임의 압축 파일은 추출하지 않습니다. 압축 해제 크기와 엔트리
//! 수를 제한해 신뢰할 수 없는 볼트 파일이 메모리를 고갈시키지 않도록 합니다.

#[path = "source_extract_container.rs"]
mod container;
#[path = "source_extract_nested.rs"]
mod nested;

use crate::JsonValue;
use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use std::io::{BufReader, Cursor, Read};
use wasm_bindgen::prelude::wasm_bindgen;
use zip::ZipArchive;

/// zip 엔트리 최대 개수입니다.
const MAX_ARCHIVE_ENTRIES: usize = 4096;
/// 단일 엔트리 최대 압축 해제 크기입니다.
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
/// 아카이브 전체 최대 압축 해제 크기입니다.
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
/// 추출 텍스트 최대 문자 수입니다.
const MAX_TEXT_CHARS: usize = 8 * 1024 * 1024;
/// 세그먼트 최대 개수입니다.
const MAX_SEGMENTS: usize = 4096;
/// 한 문단 최대 문자 수입니다.
const MAX_PARAGRAPH_CHARS: usize = 64 * 1024;

/// 추출 실패 이유 코드입니다.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ExtractFailure {
    /// 지원하지 않는 확장자입니다.
    Unsupported,
    /// zip 컨테이너가 손상되었거나 형식이 다릅니다.
    Corrupt,
    /// 크기 제한을 초과했습니다.
    TooLarge,
    /// 본문 텍스트를 찾지 못했습니다.
    Empty,
    /// 암호화된 엔트리가 있습니다.
    Encrypted,
    /// 추출 결과와 작업 자료의 메모리 예산을 초과했습니다.
    MemoryBudget,
    /// 하나의 XML 이벤트가 파싱 버퍼 예산을 초과했습니다.
    XmlTokenBudget,
}

impl ExtractFailure {
    /// 호스트가 분기할 수 있는 안정적인 코드 문자열을 반환합니다.
    const fn code(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::Corrupt => "corrupt",
            Self::TooLarge => "too-large",
            Self::Empty => "empty",
            Self::Encrypted => "encrypted",
            Self::MemoryBudget => "memory-budget",
            Self::XmlTokenBudget => "xml-token-budget",
        }
    }
}

/// 본문에서 라벨이 붙은 구간입니다.
#[derive(Clone)]
struct ExtractedSegment {
    /// 사람이 읽는 구간 라벨입니다.
    label: String,
    /// 추출 텍스트 기준 시작 줄입니다. `0`부터 셉니다.
    start_line: usize,
    /// 추출 텍스트 기준 마지막 줄입니다.
    end_line: usize,
    /// 컨테이너 내부 출처이며 볼트 경로가 아닙니다.
    source_part: Option<String>,
    /// 형식별 표·셀·수식 좌표입니다.
    locator: Option<JsonValue>,
}

/// 추출된 본문과 구간 경계입니다.
struct ExtractedDocument {
    /// 정규화된 본문입니다.
    text: String,
    /// 구간 목록입니다.
    segments: Vec<ExtractedSegment>,
    /// 인용 본문이 없는 part의 원장입니다. 줄 좌표를 갖지 않습니다.
    metadata_parts: Vec<JsonValue>,
    /// 본문 밖 삽입 원장: UTF-8 byte 위치와 관계 대상 part입니다.
    insertions: Vec<(usize, String)>,
    /// 구간 추가 경로의 문자 누계입니다. XLSX는 별도 스트리밍 예산을 씁니다.
    text_chars: usize,
    /// 구간 추가 시 다음 본문이 시작할 0 기반 줄입니다.
    next_line: usize,
    /// 상한 도달 뒤 추가 시도를 성공으로 숨기지 않습니다.
    overflowed: bool,
    /// 일반 컨테이너 위치 원장의 전체 보관 예산입니다.
    metadata_bytes: usize,
}

impl ExtractedDocument {
    /// 빈 문서를 만듭니다.
    const fn new() -> Self {
        Self {
            text: String::new(),
            segments: Vec::new(),
            metadata_parts: Vec::new(),
            insertions: Vec::new(),
            text_chars: 0,
            next_line: 0,
            overflowed: false,
            metadata_bytes: 0,
        }
    }

    /// 하나의 구간을 본문에 추가합니다.
    fn push_segment(&mut self, label: &str, body: &str) {
        let trimmed = body.trim_matches(['\r', '\n']);
        if trimmed.trim().is_empty() {
            return;
        }
        if self.conflicted() || self.segments.len() >= MAX_SEGMENTS {
            self.overflowed = true;
            return;
        }
        if !self.text.is_empty() {
            self.text.push_str("\n\n");
            self.text_chars = self.text_chars.saturating_add(2);
        }
        let start_line = self.next_line;
        self.text.push_str(trimmed);
        self.text_chars = self.text_chars.saturating_add(trimmed.chars().count());
        let end_line =
            start_line.saturating_add(trimmed.bytes().filter(|byte| *byte == b'\n').count());
        self.next_line = end_line.saturating_add(2);
        if self.segments.len() < MAX_SEGMENTS {
            self.segments.push(ExtractedSegment {
                label: label.to_owned(),
                start_line,
                end_line,
                source_part: None,
                locator: None,
            });
        }
    }

    /// 텍스트 상한을 넘겼는지 확인합니다.
    const fn conflicted(&self) -> bool {
        self.overflowed || self.text_chars > MAX_TEXT_CHARS
    }

    /// 구간 목록을 JSON 배열로 만듭니다.
    fn segments_json(&self) -> Vec<JsonValue> {
        self.segments
            .iter()
            .map(|segment| {
                let mut value = serde_json::json!({
                    "label": segment.label,
                    "startLine": segment.start_line,
                    "endLine": segment.end_line,
                });
                if let Some(object) = value.as_object_mut() {
                    if let Some(part) = &segment.source_part {
                        object.insert("sourcePart".to_owned(), part.clone().into());
                    }
                    if let Some(locator) = &segment.locator {
                        object.insert("locator".to_owned(), locator.clone());
                    }
                }
                value
            })
            .collect()
    }
}

/// 소문자 확장자가 추출 대상인지 확인합니다.
///
/// 이 함수는 RAG 색인 후보 판정에 쓰이는 계약입니다. PDF는 본문을 전용 TS worker가
/// 만들지만 후보 판정은 같은 규칙을 따라야 하므로 여기에 함께 둡니다.
#[must_use]
#[wasm_bindgen]
pub fn is_extractable_source_extension(extension: &str) -> bool {
    matches!(
        extension,
        "epub"
            | "docx"
            | "dotx"
            | "odt"
            | "odp"
            | "ods"
            | "pptx"
            | "potx"
            | "ppsx"
            | "xlsx"
            | "xltx"
            | "hwpx"
            | "pdf"
    )
}

/// 확장자에 맞는 추출기를 실행하고 결과를 JSON으로 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn extract_source_text_json(extension: &str, bytes: &[u8]) -> String {
    let normalized = normalize_extension(extension);
    // PDF 본문은 이 코어가 아니라 전용 TS worker가 만듭니다.
    let result = nested::extract(&normalized, bytes);
    match result {
        Ok(document) => serde_json::json!({
            "ok": true,
            "format": normalized,
            "text": document.text,
            "segments": document.segments_json(),
            "metadataParts": document.metadata_parts,
            "reason": JsonValue::Null,
        })
        .to_string(),
        Err(reason) => serde_json::json!({
            "ok": false,
            "format": normalized,
            "text": "",
            "segments": [],
            "reason": reason.code(),
        })
        .to_string(),
    }
}

/// 공용 준비 경계에서 본문 JSON 사본 없이 기존 typed 추출 결과를 이동합니다.
pub fn extract_for_preparation(
    extension: &str,
    bytes: &[u8],
) -> Result<(String, Vec<JsonValue>, Vec<JsonValue>), &'static str> {
    let document = nested::extract(extension, bytes).map_err(ExtractFailure::code)?;
    let segments = document.segments_json();
    Ok((document.text, segments, document.metadata_parts))
}

/// 확장자를 소문자·선행 점 제거 형태로 정규화합니다.
fn normalize_extension(extension: &str) -> String {
    extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

/// zip 컨테이너를 열고 엔트리 수를 검사합니다.
fn open_archive(bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, ExtractFailure> {
    let archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| ExtractFailure::Corrupt)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(ExtractFailure::TooLarge);
    }
    let mut names = std::collections::HashSet::new();
    for name in archive.file_names() {
        let name = name.map_err(|_| ExtractFailure::Corrupt)?;
        if !names.insert(name.to_ascii_lowercase()) {
            return Err(ExtractFailure::Corrupt);
        }
    }
    Ok(archive)
}

/// 엔트리 이름으로 내용을 읽습니다. 이름은 대소문자를 구분하지 않고 찾습니다.
fn read_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    budget: &mut u64,
) -> Result<Option<String>, ExtractFailure> {
    let index = archive
        .file_names()
        .filter_map(Result::ok)
        .position(|candidate| candidate.eq_ignore_ascii_case(name));
    let Some(index) = index else {
        return Ok(None);
    };
    let file = archive.by_index(index).map_err(|error| match error {
        zip::result::ZipError::UnsupportedArchive(zip::result::ZipError::PASSWORD_REQUIRED)
        | zip::result::ZipError::InvalidPassword => ExtractFailure::Encrypted,
        _ => ExtractFailure::Corrupt,
    })?;
    if file.encrypted() {
        return Err(ExtractFailure::Encrypted);
    }
    let size = file.size();
    if size > MAX_ENTRY_BYTES {
        return Err(ExtractFailure::TooLarge);
    }
    if budget.saturating_add(size) > MAX_TOTAL_BYTES {
        return Err(ExtractFailure::TooLarge);
    }
    let mut raw = Vec::new();
    let mut limited = file.take(size.saturating_add(1));
    limited
        .read_to_end(&mut raw)
        .map_err(|_| ExtractFailure::Corrupt)?;
    if u64::try_from(raw.len()).unwrap_or(u64::MAX) != size {
        return Err(ExtractFailure::Corrupt);
    }
    *budget = budget.saturating_add(raw.len().try_into().unwrap_or(u64::MAX));
    if *budget > MAX_TOTAL_BYTES {
        return Err(ExtractFailure::TooLarge);
    }
    decode_xml_bytes(raw).map(Some)
}

/// XML 표준의 BOM 기반 UTF-16도 손실 없이 UTF-8로 바꿉니다.
fn decode_xml_bytes(raw: Vec<u8>) -> Result<String, ExtractFailure> {
    let little = raw.starts_with(&[0xff, 0xfe]) || raw.starts_with(&[b'<', 0, b'?', 0]);
    let big = raw.starts_with(&[0xfe, 0xff]) || raw.starts_with(&[0, b'<', 0, b'?']);
    if !little && !big {
        return String::from_utf8(raw).map_err(|_| ExtractFailure::Corrupt);
    }
    let skip = usize::from(raw.starts_with(&[0xff, 0xfe]) || raw.starts_with(&[0xfe, 0xff]))
        .saturating_mul(2);
    let bytes = raw.get(skip..).ok_or(ExtractFailure::Corrupt)?;
    let (units, remainder) = bytes.as_chunks::<2>();
    if !remainder.is_empty() {
        return Err(ExtractFailure::Corrupt);
    }
    let decode = if little {
        u16::from_le_bytes
    } else {
        u16::from_be_bytes
    };
    let values: Vec<_> = units.iter().copied().map(decode).collect();
    String::from_utf16(&values).map_err(|_| ExtractFailure::Corrupt)
}

/// 아카이브에서 번호가 붙은 엔트리 이름을 정렬해 반환합니다.
fn sorted_entry_names(
    archive: &ZipArchive<Cursor<&[u8]>>,
    prefix: &str,
    suffix: &str,
) -> Vec<(u64, String)> {
    let mut numbered = Vec::new();
    for name in archive.file_names().filter_map(Result::ok) {
        let name = name.into_owned();
        let Some(rest) = name.strip_prefix(prefix) else {
            continue;
        };
        let Some(digits) = rest.strip_suffix(suffix) else {
            continue;
        };
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            continue;
        }
        let number = digits.parse::<u64>().unwrap_or(u64::MAX);
        numbered.push((number, name));
    }
    numbered.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    numbered
}

/// 상대 경로를 기준 디렉터리 기준으로 해석합니다.
fn resolve_path(base: &str, href: &str) -> String {
    let decoded = percent_decode(href);
    let directory = match base.rsplit_once('/') {
        Some((prefix, _)) => prefix,
        None => "",
    };
    let combined = if decoded.starts_with('/') {
        decoded.trim_start_matches('/').to_owned()
    } else if directory.is_empty() {
        decoded
    } else {
        format!("{directory}/{decoded}")
    };
    let mut parts = Vec::new();
    for part in combined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// 최소한의 `%XX` 이스케이프를 해제합니다.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while let Some(byte) = bytes.get(index).copied() {
        if byte == b'%'
            && let (Some(high), Some(low)) = (
                bytes.get(index.saturating_add(1)),
                bytes.get(index.saturating_add(2)),
            )
            && let (Some(high), Some(low)) = (hex_value(*high), hex_value(*low))
        {
            output.push((high << 4) | low);
            index = index.saturating_add(3);
            continue;
        }
        output.push(byte);
        index = index.saturating_add(1);
    }
    String::from_utf8_lossy(&output).into_owned()
}

/// 16진수 문자 값을 반환합니다.
const fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte.saturating_sub(b'0')),
        b'a'..=b'f' => Some(byte.saturating_sub(b'a').saturating_add(10)),
        b'A'..=b'F' => Some(byte.saturating_sub(b'A').saturating_add(10)),
        _ => None,
    }
}

/// 작업 자료·입력 복사·결과 전달 공간을 계산하는 메모리 예산입니다.
const XLSX_MEMORY_BYTES: usize = 512 * 1024 * 1024;
/// 원본은 JS와 WASM에 동시에 있으므로 작업 예산의 절반보다 작게 유지합니다.
const XLSX_SOURCE_BYTES: usize = 128 * 1024 * 1024;
/// 정상 Excel 셀의 최대 UTF-8 크기보다 여유 있는 단일 이벤트 버퍼 예산입니다.
const XLSX_EVENT_BYTES: usize = 1024 * 1024;
/// 정상 시트 구조보다 충분한 여유를 두고 XML 태그 스택도 제한합니다.
const XLSX_XML_DEPTH: usize = 128;
/// WASM 초기 메모리와 압축·파싱 엔진을 위한 여유 공간입니다.
const XLSX_ENGINE_BYTES: usize = 32 * 1024 * 1024;

/// JSON 본문 복사 없이 UTF-8 버퍼를 워커에 전달하는 XLSX 추출 결과입니다.
#[wasm_bindgen]
pub struct XlsxSourceText {
    /// 실패에는 부분 본문을 보관하지 않습니다.
    result: Result<ExtractedDocument, ExtractFailure>,
}

#[wasm_bindgen]
impl XlsxSourceText {
    /// ZIP XML을 순차적으로 읽어 전체 본문을 만들거나 명시적인 실패를 반환합니다.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(bytes: &[u8]) -> Self {
        Self {
            result: nested::extract("xlsx", bytes),
        }
    }

    /// 빈 문자열은 전체 추출 성공이며 나머지는 안정적인 실패 코드입니다.
    #[must_use]
    pub fn reason(&self) -> String {
        self.result
            .as_ref()
            .err()
            .map_or_else(String::new, |reason| reason.code().to_owned())
    }

    /// UTF-8 본문을 한 번만 이동하며 WASM 내부에 복사본을 남기지 않습니다.
    pub fn take_text_bytes(&mut self) -> Vec<u8> {
        self.result.as_mut().map_or_else(
            |_| Vec::new(),
            |document| core::mem::take(&mut document.text).into_bytes(),
        )
    }

    /// 본문 없는 part 원장은 인용 구간과 별도로 전달합니다.
    #[must_use]
    pub fn metadata_parts_json(&self) -> String {
        self.result.as_ref().map_or_else(
            |_| "[]".to_owned(),
            |document| JsonValue::Array(document.metadata_parts.clone()).to_string(),
        )
    }

    /// 작은 구간 메타데이터만 JSON으로 전달합니다.
    #[must_use]
    pub fn segments_json(&self) -> String {
        self.result.as_ref().map_or_else(
            |_| "[]".to_owned(),
            |document| JsonValue::Array(document.segments_json()).to_string(),
        )
    }
}

/// 한 이벤트를 읽는 동안의 버퍼 증가를 실제 읽기 단계에서 제한합니다.
struct XlsxEventReader<R> {
    /// 스트리밍 압축 해제 입력입니다.
    inner: R,
    /// 현재 이벤트를 읽으며 새로 확보한 바이트 수입니다.
    event_bytes: usize,
    /// 문서 루트 개수이며 다중 루트를 성공 처리하지 않습니다.
    roots: usize,
    /// EPUB의 선언만 있는 안전한 HTML doctype 허용 여부입니다.
    html_doctype: bool,
}

impl<R: Read> Read for XlsxEventReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.event_bytes >= XLSX_EVENT_BYTES {
            return Err(std::io::Error::other("xml-token-budget"));
        }
        let length = buffer
            .len()
            .min(XLSX_EVENT_BYTES.saturating_sub(self.event_bytes));
        let target = buffer
            .get_mut(..length)
            .ok_or_else(|| std::io::Error::other("corrupt"))?;
        let count = self.inner.read(target)?;
        self.event_bytes = self.event_bytes.saturating_add(count);
        Ok(count)
    }
}

/// 살아 있는 작업 자료의 크기만 계산하며 누적 XML 크기를 메모리로 취급하지 않습니다.
struct XlsxBudget {
    /// JS·WASM 입력 복사와 기본 엔진 공간입니다.
    base_bytes: usize,
    /// 공유 문자열과 벡터의 실제 보관 공간입니다.
    shared_bytes: usize,
    /// 테스트에서 작은 작업 예산의 실패도 재현할 수 있게 합니다.
    limit: usize,
}

impl XlsxBudget {
    /// 다음 할당 전 결과 전달 복사까지 포함한 공간을 확인합니다.
    const fn check(&self, output_capacity: usize, extra: usize) -> Result<(), ExtractFailure> {
        let required = self
            .base_bytes
            .saturating_add(self.shared_bytes)
            .saturating_add(output_capacity.saturating_mul(4))
            .saturating_add(extra);
        if required > self.limit {
            return Err(ExtractFailure::MemoryBudget);
        }
        Ok(())
    }

    /// 결과 버퍼는 기하급수적으로 확장하되 예산을 넘기는 할당은 시작하지 않습니다.
    fn append(&self, output: &mut String, value: &str) -> Result<(), ExtractFailure> {
        let required = output
            .len()
            .checked_add(value.len())
            .ok_or(ExtractFailure::MemoryBudget)?;
        if required > output.capacity() {
            let capacity = required
                .max(output.capacity().saturating_add(output.capacity() >> 1))
                .max(64 * 1024);
            self.check(capacity, 4 * XLSX_EVENT_BYTES)?;
            output
                .try_reserve_exact(capacity.saturating_sub(output.len()))
                .map_err(|_| ExtractFailure::MemoryBudget)?;
        }
        output.push_str(value);
        Ok(())
    }
}

/// ZIP 항목을 본문 문자열로 만들지 않고 바로 XML 리더에 연결합니다.
type XlsxZipReader<'a, 'b> =
    Reader<BufReader<XlsxEventReader<zip::read::ZipFile<'a, Cursor<&'b [u8]>>>>>;

/// ZIP 항목을 본문 문자열로 만들지 않고 바로 XML 리더에 연결합니다.
fn xlsx_reader<'a, 'b>(
    archive: &'a mut ZipArchive<Cursor<&'b [u8]>>,
    name: &str,
) -> Result<Option<XlsxZipReader<'a, 'b>>, ExtractFailure> {
    let Some(index) = archive
        .file_names()
        .filter_map(Result::ok)
        .position(|candidate| candidate.eq_ignore_ascii_case(name))
    else {
        return Ok(None);
    };
    let file = archive.by_index(index).map_err(|error| match error {
        zip::result::ZipError::UnsupportedArchive(zip::result::ZipError::PASSWORD_REQUIRED)
        | zip::result::ZipError::InvalidPassword => ExtractFailure::Encrypted,
        _ => ExtractFailure::Corrupt,
    })?;
    if file.encrypted() {
        return Err(ExtractFailure::Encrypted);
    }
    Ok(Some(Reader::from_reader(BufReader::new(XlsxEventReader {
        inner: file,
        event_bytes: 0,
        roots: 0,
        html_doctype: false,
    }))))
}

/// 읽기 실패를 부분 성공으로 바꾸지 않고 파싱 버퍼 초과와 구분합니다.
fn xlsx_event<'a, R: Read>(
    reader: &mut Reader<BufReader<XlsxEventReader<R>>>,
    buffer: &'a mut Vec<u8>,
    depth: &mut usize,
) -> Result<Event<'a>, ExtractFailure> {
    buffer.clear();
    reader.get_mut().get_mut().event_bytes = 0;
    let event = reader.read_event_into(buffer).map_err(|_| {
        if reader.get_ref().get_ref().event_bytes >= XLSX_EVENT_BYTES {
            ExtractFailure::XmlTokenBudget
        } else {
            ExtractFailure::Corrupt
        }
    })?;
    match &event {
        Event::Start(node) | Event::Empty(node) => {
            for attribute in node.attributes() {
                attribute
                    .map_err(|_| ExtractFailure::Corrupt)?
                    .normalized_value(XmlVersion::Implicit1_0)
                    .map_err(|_| ExtractFailure::Corrupt)?;
            }
            if *depth == 0 {
                let state = reader.get_mut().get_mut();
                state.roots = state.roots.saturating_add(1);
                if state.roots > 1 {
                    return Err(ExtractFailure::Corrupt);
                }
            }
        }
        Event::Text(text) if *depth == 0 && !text.as_ref().trim().is_empty() => {
            return Err(ExtractFailure::Corrupt);
        }
        Event::GeneralRef(_) | Event::CData(_) if *depth == 0 => {
            return Err(ExtractFailure::Corrupt);
        }
        _ => {}
    }
    match &event {
        Event::Start(_) => {
            *depth = depth.saturating_add(1);
            if *depth > XLSX_XML_DEPTH {
                return Err(ExtractFailure::XmlTokenBudget);
            }
        }
        Event::Empty(_) if *depth >= XLSX_XML_DEPTH => return Err(ExtractFailure::XmlTokenBudget),
        Event::End(_) => *depth = depth.checked_sub(1).ok_or(ExtractFailure::Corrupt)?,
        Event::Eof if *depth != 0 || reader.get_ref().get_ref().roots != 1 => {
            return Err(ExtractFailure::Corrupt);
        }
        Event::DocType(doctype)
            if reader.get_ref().get_ref().html_doctype && doctype.as_ref().trim() == "html" => {}
        Event::DocType(_) => return Err(ExtractFailure::Corrupt),
        _ => {}
    }
    Ok(event)
}

/// 텍스트·CDATA·XML 엔티티를 손실 없이 현재 셀에 추가합니다.
fn append_xlsx_event(current: &mut String, event: &Event<'_>) -> Result<(), ExtractFailure> {
    let value = match event {
        Event::Text(text) => text.xml_content(XmlVersion::Implicit1_0),
        Event::CData(text) => text.xml_content(XmlVersion::Implicit1_0),
        Event::GeneralRef(reference) => {
            if let Some(character) = reference
                .resolve_char_ref()
                .map_err(|_| ExtractFailure::Corrupt)?
            {
                if current.len().saturating_add(character.len_utf8()) > XLSX_EVENT_BYTES {
                    return Err(ExtractFailure::XmlTokenBudget);
                }
                current.push(character);
                return Ok(());
            }
            match reference.as_ref() {
                "amp" => "&".into(),
                "lt" => "<".into(),
                "gt" => ">".into(),
                "quot" => "\"".into(),
                "apos" => "'".into(),
                _ => return Err(ExtractFailure::Corrupt),
            }
        }
        _ => return Ok(()),
    };
    if current.len().saturating_add(value.len()) > XLSX_EVENT_BYTES {
        return Err(ExtractFailure::XmlTokenBudget);
    }
    current.push_str(&value);
    Ok(())
}

/// 필요한 공유 문자열만 보관하고 XML 자체는 순차적으로 읽습니다.
fn push_xlsx_string(
    strings: &mut Vec<String>,
    budget: &mut XlsxBudget,
    text_bytes: &mut usize,
    value: String,
) -> Result<(), ExtractFailure> {
    let capacity = if strings.len() == strings.capacity() {
        strings.capacity().saturating_mul(2).max(4)
    } else {
        strings.capacity()
    };
    *text_bytes = text_bytes.saturating_add(value.capacity());
    budget.shared_bytes =
        text_bytes.saturating_add(capacity.saturating_mul(core::mem::size_of::<String>()));
    budget.check(0, 4 * XLSX_EVENT_BYTES)?;
    if capacity > strings.capacity() {
        strings
            .try_reserve_exact(capacity.saturating_sub(strings.len()))
            .map_err(|_| ExtractFailure::MemoryBudget)?;
    }
    strings.push(value);
    Ok(())
}

/// 필요한 공유 문자열만 보관하고 XML 자체는 순차적으로 읽습니다.
fn read_xlsx_strings(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    budget: &mut XlsxBudget,
) -> Result<Vec<String>, ExtractFailure> {
    let Some(mut reader) = xlsx_reader(archive, "xl/sharedStrings.xml")? else {
        return Ok(Vec::new());
    };
    let mut buffer = Vec::new();
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    let mut in_text = false;
    let mut depth = 0;
    let mut text_bytes = 0usize;
    loop {
        match xlsx_event(&mut reader, &mut buffer, &mut depth)? {
            Event::Start(event) => match event.local_name().as_ref() {
                "si" => {
                    in_item = true;
                    current.clear();
                }
                "t" => in_text = true,
                _ => {}
            },
            Event::Empty(event) if event.local_name().as_ref() == "si" => {
                push_xlsx_string(&mut strings, budget, &mut text_bytes, String::new())?;
            }
            Event::End(event) => match event.local_name().as_ref() {
                "si" => {
                    in_item = false;
                    let value = core::mem::take(&mut current);
                    push_xlsx_string(&mut strings, budget, &mut text_bytes, value)?;
                }
                "t" => in_text = false,
                _ => {}
            },
            Event::Eof => break,
            event if in_item && in_text => append_xlsx_event(&mut current, &event)?,
            _ => {}
        }
        budget.shared_bytes = text_bytes.saturating_add(
            strings
                .capacity()
                .saturating_mul(core::mem::size_of::<String>()),
        );
        budget.check(0, 4 * XLSX_EVENT_BYTES)?;
    }
    Ok(strings)
}

/// 현재 셀의 저장 값·수식·위치를 독립적으로 보관합니다.
#[derive(Default)]
struct XlsxCell {
    /// 저장 값 또는 인라인 텍스트입니다.
    value: String,
    /// 재계산하지 않은 저장 수식입니다.
    formula: String,
    /// 셀 주소입니다.
    address: String,
    /// 저장 셀 유형입니다.
    kind: String,
    /// 공유·배열 수식의 속성입니다.
    formula_attributes: JsonValue,
}

/// 1 기반 열 번호를 Excel 주소로 만듭니다.
fn xlsx_address(mut column: usize, row: usize) -> String {
    let mut letters = Vec::new();
    while column > 0 {
        column = column.saturating_sub(1);
        letters.push(char::from(
            b'A'.saturating_add(u8::try_from(column % 26).unwrap_or_default()),
        ));
        column /= 26;
    }
    format!("{}{row}", letters.into_iter().rev().collect::<String>())
}

/// 명시 주소 뒤의 생략 주소도 올바른 다음 열을 가리키게 합니다.
fn xlsx_coordinates(address: &str) -> Result<(usize, usize), ExtractFailure> {
    let letters = address.bytes().take_while(u8::is_ascii_alphabetic).count();
    let mut column = 0usize;
    for byte in address.bytes().take(letters) {
        column = column
            .checked_mul(26)
            .and_then(|value| {
                value.checked_add(
                    usize::from(byte.to_ascii_uppercase().saturating_sub(b'A')).saturating_add(1),
                )
            })
            .ok_or(ExtractFailure::Corrupt)?;
    }
    let row = address
        .get(letters..)
        .ok_or(ExtractFailure::Corrupt)?
        .parse::<usize>()
        .map_err(|_| ExtractFailure::Corrupt)?;
    if column == 0 || row == 0 {
        return Err(ExtractFailure::Corrupt);
    }
    Ok((column, row))
}

/// JSON 객체의 위치 필드를 타입 확인 뒤 추가합니다.
fn insert_location(
    value: &mut JsonValue,
    key: &str,
    entry: JsonValue,
) -> Result<(), ExtractFailure> {
    value
        .as_object_mut()
        .ok_or(ExtractFailure::Corrupt)?
        .insert(key.to_owned(), entry);
    Ok(())
}

/// 위치 메타데이터도 공유 문자열과 같은 실제 메모리 예산에 포함합니다.
fn xlsx_locator_push(
    values: &mut Vec<JsonValue>,
    value: JsonValue,
    budget: &mut XlsxBudget,
    output_capacity: usize,
) -> Result<(), ExtractFailure> {
    budget.shared_bytes = budget
        .shared_bytes
        .saturating_add(value.to_string().len().saturating_mul(4))
        .saturating_add(512);
    budget.check(output_capacity, 4 * XLSX_EVENT_BYTES)?;
    values.push(value);
    Ok(())
}

/// 스트리밍 본문에 셀을 확정하고 비어 있는 셀도 좌표 원장에 남깁니다.
fn finish_xlsx_cell(
    cell: &XlsxCell,
    shared: &[String],
    output: &mut XlsxSheetOutput<'_>,
) -> Result<(), ExtractFailure> {
    let value = if cell.kind == "s" {
        let index = cell
            .value
            .trim()
            .parse::<usize>()
            .map_err(|_| ExtractFailure::Corrupt)?;
        shared.get(index).ok_or(ExtractFailure::Corrupt)?.as_str()
    } else {
        cell.value.as_str()
    };
    let mut location = serde_json::json!({ "address": cell.address, "formula": cell.formula, "formulaAttributes": cell.formula_attributes, "cachedValue": value, "type": cell.kind });
    if !value.is_empty() {
        if !output.sheet_started {
            if !output.document.text.is_empty() {
                output.budget.append(
                    &mut output.document.text,
                    "

",
                )?;
                *output.line = output.line.saturating_add(2);
            }
            output.start_line = *output.line;
            output.sheet_started = true;
        } else if !output.row_started {
            output.budget.append(
                &mut output.document.text,
                "
",
            )?;
            *output.line = output.line.saturating_add(1);
        }
        if output.row_started {
            output.budget.append(&mut output.document.text, "	")?;
        }
        insert_location(&mut location, "startLine", (*output.line).into())?;
        output.budget.append(&mut output.document.text, value)?;
        *output.line = output
            .line
            .saturating_add(value.bytes().filter(|byte| *byte == b'\n').count());
        insert_location(&mut location, "endLine", (*output.line).into())?;
        output.row_started = true;
    }
    xlsx_locator_push(
        &mut output.cells,
        location,
        output.budget,
        output.document.text.capacity(),
    )
}

/// 시트 본문·메타데이터·메모리 원장의 공통 쓰기 상태입니다.
struct XlsxSheetOutput<'a> {
    /// 최종 문서입니다.
    document: &'a mut ExtractedDocument,
    /// 메타데이터도 포함하는 작업 예산입니다.
    budget: &'a mut XlsxBudget,
    /// 전체 본문의 현재 줄입니다.
    line: &'a mut usize,
    /// 현재 행의 값 출력 여부입니다.
    row_started: bool,
    /// 현재 시트의 값 출력 여부입니다.
    sheet_started: bool,
    /// 시트 시작 줄입니다.
    start_line: usize,
    /// 셀 주소·수식·값·본문 줄의 원장입니다.
    cells: Vec<JsonValue>,
}

/// 시트의 입력 상태를 결과 버퍼와 분리합니다.
#[derive(Default)]
struct XlsxSheetState {
    /// 현재 셀입니다.
    cell: XlsxCell,
    /// 현재 저장 텍스트 태그입니다.
    capture: String,
    /// 1 기반 행 번호입니다.
    row: usize,
    /// 1 기반 열 번호입니다.
    column: usize,
    /// 병합 주소 목록입니다.
    merges: Vec<JsonValue>,
    /// 머리말·꼬리말의 현재 저장 텍스트입니다.
    loose_text: String,
    /// 본문 셀 밖에서 읽은 저장 텍스트입니다.
    extras: Vec<String>,
}

impl XlsxSheetState {
    /// 시작·빈 요소의 셀 상태와 저장 수식 속성을 읽습니다.
    fn start(
        &mut self,
        event: &quick_xml::events::BytesStart<'_>,
        empty: bool,
        shared: &[String],
        output: &mut XlsxSheetOutput<'_>,
    ) -> Result<(), ExtractFailure> {
        let name = event.local_name();
        if is_xlsx_header(name.as_ref()) {
            self.capture = if empty {
                String::new()
            } else {
                name.as_ref().to_owned()
            };
            self.loose_text.clear();
            return Ok(());
        }
        match name.as_ref() {
            "row" => {
                output.row_started = false;
                self.row = self.row.saturating_add(1);
                self.column = 0;
                for attribute in event.attributes() {
                    let attribute = attribute.map_err(|_| ExtractFailure::Corrupt)?;
                    if attribute.key.as_ref() == "r" {
                        self.row = attribute
                            .value
                            .parse()
                            .map_err(|_| ExtractFailure::Corrupt)?;
                    }
                }
            }
            "c" => {
                self.column = self.column.saturating_add(1);
                self.cell = XlsxCell {
                    address: xlsx_address(self.column, self.row),
                    ..XlsxCell::default()
                };
                for attribute in event.attributes() {
                    let attribute = attribute.map_err(|_| ExtractFailure::Corrupt)?;
                    match attribute.key.as_ref() {
                        "t" => self.cell.kind = attribute.value.into_owned(),
                        "r" => self.cell.address = attribute.value.into_owned(),
                        _ => {}
                    }
                }
                (self.column, self.row) = xlsx_coordinates(&self.cell.address)?;
                if empty {
                    finish_xlsx_cell(&self.cell, shared, output)?;
                }
            }
            "v" | "t" | "f" => {
                self.capture = if empty {
                    String::new()
                } else {
                    name.as_ref().to_owned()
                };
                if name.as_ref() == "f" {
                    let mut attrs = serde_json::Map::new();
                    for attribute in event.attributes() {
                        let attribute = attribute.map_err(|_| ExtractFailure::Corrupt)?;
                        attrs.insert(
                            attribute.key.as_ref().to_owned(),
                            attribute
                                .normalized_value(XmlVersion::Implicit1_0)
                                .map_err(|_| ExtractFailure::Corrupt)?
                                .into_owned()
                                .into(),
                        );
                    }
                    self.cell.formula_attributes = attrs.into();
                }
            }
            "mergeCell" => {
                for attribute in event.attributes() {
                    let attribute = attribute.map_err(|_| ExtractFailure::Corrupt)?;
                    if attribute.key.as_ref() == "ref" {
                        xlsx_locator_push(
                            &mut self.merges,
                            attribute.value.into_owned().into(),
                            output.budget,
                            output.document.text.capacity(),
                        )?;
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// 저장 수식을 재계산하지 않고 검색 본문과 좌표 원장 양쪽에 보존합니다.
fn append_xlsx_formulas(output: &mut XlsxSheetOutput<'_>) -> Result<(), ExtractFailure> {
    for location in &mut output.cells {
        let formula = location
            .get("formula")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        if formula.is_empty() {
            continue;
        }
        if output.sheet_started {
            output.budget.append(&mut output.document.text, "\n")?;
            *output.line = output.line.saturating_add(1);
        } else {
            if !output.document.text.is_empty() {
                output.budget.append(&mut output.document.text, "\n\n")?;
                *output.line = output.line.saturating_add(2);
            }
            output.start_line = *output.line;
            output.sheet_started = true;
        }
        let formula_line = format!(
            "{} ={formula}",
            location
                .get("address")
                .and_then(JsonValue::as_str)
                .unwrap_or("")
        );
        insert_location(location, "formulaStartLine", (*output.line).into())?;
        output
            .budget
            .append(&mut output.document.text, &formula_line)?;
        *output.line = output
            .line
            .saturating_add(formula_line.bytes().filter(|byte| *byte == b'\n').count());
        insert_location(location, "formulaEndLine", (*output.line).into())?;
    }
    Ok(())
}

/// 시트 본문 밖의 저장 머리말·꼬리말 태그입니다.
const fn is_xlsx_header(name: &str) -> bool {
    matches!(
        name.as_bytes(),
        b"oddHeader"
            | b"oddFooter"
            | b"evenHeader"
            | b"evenFooter"
            | b"firstHeader"
            | b"firstFooter"
    )
}

/// 시트 머리말·꼬리말도 검색 본문에 보존합니다.
fn append_xlsx_headers(
    headers: &[String],
    output: &mut XlsxSheetOutput<'_>,
) -> Result<(), ExtractFailure> {
    for header in headers.iter().filter(|header| !header.is_empty()) {
        if output.sheet_started {
            output.budget.append(&mut output.document.text, "\n")?;
            *output.line = output.line.saturating_add(1);
        } else {
            if !output.document.text.is_empty() {
                output.budget.append(&mut output.document.text, "\n\n")?;
                *output.line = output.line.saturating_add(2);
            }
            output.start_line = *output.line;
            output.sheet_started = true;
        }
        output.budget.append(&mut output.document.text, header)?;
        *output.line = output
            .line
            .saturating_add(header.bytes().filter(|byte| *byte == b'\n').count());
    }
    Ok(())
}

/// 행 목록을 쌓지 않고 각 셀을 최종 본문에 바로 붙입니다.
fn read_xlsx_sheet<R: Read>(
    reader: &mut Reader<BufReader<XlsxEventReader<R>>>,
    shared: &[String],
    budget: &mut XlsxBudget,
    document: &mut ExtractedDocument,
    label: &str,
    line: &mut usize,
) -> Result<(), ExtractFailure> {
    let mut buffer = Vec::new();
    let mut depth = 0;
    let mut state = XlsxSheetState::default();
    let mut valid_root = false;
    let mut output = XlsxSheetOutput {
        document,
        budget,
        line,
        row_started: false,
        sheet_started: false,
        start_line: 0,
        cells: Vec::new(),
    };
    loop {
        let event = xlsx_event(reader, &mut buffer, &mut depth)?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(event) | Event::Empty(event) => {
                if depth == usize::from(!empty) {
                    valid_root = event.local_name().as_ref() == "worksheet";
                }
                state.start(&event, empty, shared, &mut output)?;
            }
            Event::End(event) => match event.local_name().as_ref() {
                "c" => finish_xlsx_cell(&state.cell, shared, &mut output)?,
                "v" | "t" | "f" => state.capture.clear(),
                name if is_xlsx_header(name) => {
                    output.budget.shared_bytes = output
                        .budget
                        .shared_bytes
                        .saturating_add(state.loose_text.capacity().saturating_mul(4));
                    output
                        .budget
                        .check(output.document.text.capacity(), 4 * XLSX_EVENT_BYTES)?;
                    state.extras.push(core::mem::take(&mut state.loose_text));
                    state.capture.clear();
                }
                _ => {}
            },
            Event::Eof => break,
            event if state.capture == "f" => append_xlsx_event(&mut state.cell.formula, &event)?,
            event if is_xlsx_header(&state.capture) => {
                append_xlsx_event(&mut state.loose_text, &event)?;
            }
            event if !state.capture.is_empty() => append_xlsx_event(&mut state.cell.value, &event)?,
            _ => {}
        }
    }
    if !valid_root {
        return Err(ExtractFailure::Corrupt);
    }
    append_xlsx_formulas(&mut output)?;
    append_xlsx_headers(&state.extras, &mut output)?;
    if output.sheet_started {
        if output.document.segments.len() >= MAX_SEGMENTS {
            return Err(ExtractFailure::TooLarge);
        }
        output.document.segments.push(ExtractedSegment {
            label: label.to_owned(),
            start_line: output.start_line,
            end_line: *output.line,
            source_part: None,
            locator: Some(
                serde_json::json!({ "cells": output.cells, "mergedRanges": state.merges }),
            ),
        });
    } else {
        output.budget.shared_bytes = output
            .budget
            .shared_bytes
            .saturating_add(label.len())
            .saturating_add(512);
        output.budget.check(output.document.text.capacity(), 0)?;
        output.document.metadata_parts.push(serde_json::json!({"label": label, "locator": {"cells": output.cells, "mergedRanges": state.merges}}));
    }
    Ok(())
}

/// 실제 workbook 관계에 등록된 이름만 차트 참조의 증거로 사용합니다.
struct XlsxSheets {
    /// 고립 시트를 포함한 추출 순서입니다.
    parts: Vec<(String, String)>,
    /// 실제 저장된 시트명을 가진 part입니다.
    named_parts: Vec<String>,
}

/// 워크북의 실제 시트명과 관계 순서를 읽되 고립 저장 시트도 보존합니다.
fn xlsx_sheet_names(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<XlsxSheets, ExtractFailure> {
    let mut entry_budget = 0;
    let mut names = Vec::new();
    let mut named_parts = Vec::new();
    let mut primary = false;
    if let Some(xml) = read_entry(archive, "xl/workbook.xml", &mut entry_budget)? {
        let tree = container::parse(&xml)?;
        if !tree.has_root("workbook") {
            return Err(ExtractFailure::Corrupt);
        }
        primary = true;
        let relations = container::relationships(archive, "xl/workbook.xml", &mut entry_budget)?;
        let mut sheets = Vec::new();
        tree.descendants("sheet", &mut sheets);
        for sheet in sheets {
            let id = sheet.attr("r:id").ok_or(ExtractFailure::Corrupt)?;
            let (_, path) = relations
                .iter()
                .find(|(key, _)| key == id)
                .ok_or(ExtractFailure::Corrupt)?;
            let label = sheet.attr("name").ok_or(ExtractFailure::Corrupt)?;
            names.push((label.to_owned(), path.clone()));
            named_parts.push(path.clone());
        }
    }
    for (number, name) in sorted_entry_names(archive, "xl/worksheets/sheet", ".xml") {
        if !names.iter().any(|(_, previous)| previous == &name) {
            names.push((format!("Sheet {number}"), name));
        }
    }
    if !primary && names.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(XlsxSheets {
        parts: names,
        named_parts,
    })
}

/// 보조 part는 작은 공통 추출기로 읽고 기존 스트리밍 결과 예산으로 합칩니다.
fn append_xlsx_auxiliary(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    sheets: &[(String, String)],
    budget: &mut XlsxBudget,
    document: &mut ExtractedDocument,
    line: &mut usize,
    skip: &[String],
) -> Result<(), ExtractFailure> {
    let auxiliary = container::xlsx_auxiliary(archive, sheets, skip, document)?;
    if auxiliary.text.is_empty() {
        return Ok(());
    }
    let offset = if document.text.is_empty() {
        0
    } else {
        line.saturating_add(2)
    };
    if !document.text.is_empty() {
        budget.append(&mut document.text, "\n\n")?;
    }
    budget.append(&mut document.text, &auxiliary.text)?;
    for mut segment in auxiliary.segments {
        if document.segments.len() >= MAX_SEGMENTS {
            return Err(ExtractFailure::TooLarge);
        }
        segment.start_line = segment.start_line.saturating_add(offset);
        segment.end_line = segment.end_line.saturating_add(offset);
        budget.shared_bytes = budget.shared_bytes.saturating_add(
            segment
                .locator
                .as_ref()
                .map_or(0, |value| value.to_string().len().saturating_mul(4)),
        );
        budget.check(document.text.capacity(), 4 * XLSX_EVENT_BYTES)?;
        document.segments.push(segment);
    }
    *line = offset.saturating_add(auxiliary.text.bytes().filter(|byte| *byte == b'\n').count());
    Ok(())
}

/// XLSX의 원본·공유 문자열·최종 본문이 작업 예산 안에 있는지 확인합니다.
/// 낮은 예산의 실패를 합성 데이터로 검증하는 공통 추출 경로입니다.
fn extract_xlsx_with_budget(
    bytes: &[u8],
    memory_bytes: usize,
    skip: &[String],
) -> Result<ExtractedDocument, ExtractFailure> {
    if bytes.len() > XLSX_SOURCE_BYTES {
        return Err(ExtractFailure::MemoryBudget);
    }
    let mut archive = open_archive(bytes)?;
    let mut budget = XlsxBudget {
        base_bytes: bytes
            .len()
            .saturating_mul(2)
            .saturating_add(XLSX_ENGINE_BYTES),
        shared_bytes: 0,
        limit: memory_bytes,
    };
    budget.check(0, 4 * XLSX_EVENT_BYTES)?;
    let XlsxSheets {
        parts: names,
        named_parts,
    } = xlsx_sheet_names(&mut archive)?;
    let shared = read_xlsx_strings(&mut archive, &mut budget)?;
    let mut document = ExtractedDocument::new();
    let mut line = 0;
    for (label, name) in &names {
        let mut reader = xlsx_reader(&mut archive, name)?.ok_or(ExtractFailure::Corrupt)?;
        let previous = document.segments.len();
        let metadata_previous = document.metadata_parts.len();
        read_xlsx_sheet(
            &mut reader,
            &shared,
            &mut budget,
            &mut document,
            label,
            &mut line,
        )?;
        if document.segments.len() > previous
            && let Some(segment) = document.segments.last_mut()
        {
            segment.source_part = Some(name.clone());
            if named_parts.contains(name) {
                insert_location(
                    segment.locator.as_mut().ok_or(ExtractFailure::Corrupt)?,
                    "sheetName",
                    label.clone().into(),
                )?;
            }
        }
        if document.metadata_parts.len() > metadata_previous
            && let Some(part) = document.metadata_parts.last_mut()
        {
            insert_location(part, "sourcePart", name.clone().into())?;
        }
    }
    append_xlsx_auxiliary(
        &mut archive,
        &names,
        &mut budget,
        &mut document,
        &mut line,
        skip,
    )?;
    if document.text.is_empty() && document.metadata_parts.is_empty() && skip.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(document)
}

/// 본문이 비어 있으면 실패로 바꿉니다.
fn finish_document(document: ExtractedDocument) -> Result<ExtractedDocument, ExtractFailure> {
    if document.text.trim().is_empty() {
        return Err(ExtractFailure::Empty);
    }
    if document.conflicted() {
        return Err(ExtractFailure::TooLarge);
    }
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::fmt::Write as _;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;

    /// 여러 구간의 시작·끝 줄은 실제 본문 슬라이스와 일치해야 합니다.
    #[test]
    fn source_segments_match_actual_lines_across_languages() {
        let mut document = ExtractedDocument::new();
        for (label, body) in [("A", "첫 줄\n다음 줄"), ("B", "日本語 😀"), ("C", "last")]
        {
            document.push_segment(label, body);
        }
        let lines = document.text.split('\n').collect::<Vec<_>>();
        for (segment, body) in document
            .segments
            .iter()
            .zip(["첫 줄\n다음 줄", "日本語 😀", "last"])
        {
            assert!(segment.start_line <= segment.end_line);
            assert_eq!(
                lines
                    .get(segment.start_line..=segment.end_line)
                    .map(|slice| slice.join("\n")),
                Some(body.to_owned())
            );
        }
    }

    /// 압축 없이 저장한 항목으로 테스트용 zip 컨테이너를 만듭니다.
    fn build_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buffer = Vec::new();
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
            for (name, contents) in entries {
                assert!(
                    writer.start_file(*name, options).is_ok(),
                    "test zip entry failed to start"
                );
                assert!(
                    writer.write_all(contents.as_bytes()).is_ok(),
                    "test zip entry failed to write"
                );
            }
            assert!(writer.finish().is_ok(), "test zip failed to finish");
        }
        buffer
    }

    /// deflate로 압축한 항목으로 테스트용 zip 컨테이너를 만듭니다.
    fn build_deflated_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buffer = Vec::new();
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut buffer));
            for (name, contents) in entries {
                assert!(
                    writer.start_file(*name, options).is_ok(),
                    "deflated test zip entry failed to start"
                );
                assert!(
                    writer.write_all(contents.as_bytes()).is_ok(),
                    "deflated test zip entry failed to write"
                );
            }
            assert!(
                writer.finish().is_ok(),
                "deflated test zip failed to finish"
            );
        }
        buffer
    }

    /// 추출 결과 JSON을 파싱합니다. 실패하면 null을 돌려줘 단언이 원인을 드러냅니다.
    fn extract(extension: &str, entries: &[(&str, &str)]) -> JsonValue {
        let bytes = build_zip(entries);
        serde_json::from_str(&extract_source_text_json(extension, &bytes))
            .unwrap_or(JsonValue::Null)
    }

    /// 추출 실패 JSON을 파싱합니다.
    fn extract_failure(extension: &str, bytes: &[u8]) -> JsonValue {
        serde_json::from_str(&extract_source_text_json(extension, bytes)).unwrap_or(JsonValue::Null)
    }

    /// 위치 wire를 패닉 없는 JSON 포인터로 확인합니다.
    fn at<'a>(value: &'a JsonValue, pointer: &str) -> &'a JsonValue {
        value.pointer(pointer).unwrap_or(&JsonValue::Null)
    }

    /// 본문 문자열을 꺼냅니다.
    fn text_of(value: &JsonValue) -> &str {
        value.get("text").and_then(JsonValue::as_str).unwrap_or("")
    }

    /// `DOCX` 문단이 순서대로 이어지는지 확인합니다.
    #[test]
    fn extracts_docx_paragraphs_in_order() {
        let document = r"<w:document><w:body><w:p><w:r><w:t>First line</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>";
        let value = extract("docx", &[("word/document.xml", document)]);
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(true),
            "docx extraction succeeded"
        );
        assert_eq!(
            text_of(&value),
            "First line\n\nSecond line",
            "docx paragraph text"
        );
        assert_eq!(
            value
                .get("segments")
                .and_then(|segments| segments.get(0))
                .and_then(|segment| segment.get("label"))
                .and_then(JsonValue::as_str),
            Some("Document"),
            "docx segment label"
        );
    }

    /// `EPUB`이 스파인 순서대로 챕터를 모으고 제목을 라벨로 쓰는지 확인합니다.
    #[test]
    fn extracts_epub_chapters_in_spine_order() {
        let container = r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#;
        let package = r#"<package><manifest><item id="second" href="second.xhtml"/><item id="first" href="first.xhtml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>"#;
        let first = r"<html><head><title>Alpha</title></head><body><h1>Alpha</h1><p>First body</p></body></html>";
        let second =
            r"<html><head><title>Beta</title></head><body><p>Second body</p></body></html>";
        let value = extract(
            "epub",
            &[
                ("META-INF/container.xml", container),
                ("OEBPS/content.opf", package),
                ("OEBPS/first.xhtml", first),
                ("OEBPS/second.xhtml", second),
            ],
        );
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(true),
            "epub extraction succeeded"
        );
        assert_eq!(
            text_of(&value),
            "Alpha\n\nFirst body\n\nSecond body",
            "epub chapter order"
        );
        let labels = value
            .get("segments")
            .and_then(JsonValue::as_array)
            .map_or_default(|segments| {
                segments
                    .iter()
                    .filter_map(|segment| segment.get("label").and_then(JsonValue::as_str))
                    .collect::<Vec<_>>()
            });
        assert_eq!(labels, vec!["Alpha", "Beta"], "epub chapter labels");
    }

    /// `PPTX` 슬라이드 번호가 라벨로 남는지 확인합니다.
    #[test]
    fn extracts_pptx_slide_text() {
        let slide = r"<p:sld><p:cSld><a:p><a:r><a:t>Slide body</a:t></a:r></a:p></p:cSld></p:sld>";
        let value = extract("pptx", &[("ppt/slides/slide1.xml", slide)]);
        assert_eq!(text_of(&value), "Slide body", "pptx slide text");
        assert_eq!(
            value
                .get("segments")
                .and_then(|segments| segments.get(0))
                .and_then(|segment| segment.get("label"))
                .and_then(JsonValue::as_str),
            Some("Slide 1"),
            "pptx segment label"
        );
    }

    /// `XLSX` 공유 문자열 인덱스가 실제 값으로 바뀌는지 확인합니다.
    #[test]
    fn extracts_xlsx_shared_strings() {
        let shared = r"<sst><si><t>Alpha</t></si><si><t>Beta</t></si></sst>";
        let sheet = r#"<worksheet><sheetData><row><c t="s"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData></worksheet>"#;
        let value = extract(
            "xlsx",
            &[
                ("xl/sharedStrings.xml", shared),
                ("xl/worksheets/sheet1.xml", sheet),
            ],
        );
        assert_eq!(text_of(&value), "Beta\n42", "xlsx shared string resolution");
        assert_eq!(
            value
                .get("segments")
                .and_then(|segments| segments.get(0))
                .and_then(|segment| segment.get("label"))
                .and_then(JsonValue::as_str),
            Some("Sheet 1"),
            "xlsx segment label"
        );
    }

    /// 실제 컨테이너처럼 deflate로 압축된 항목도 읽어야 합니다.
    #[test]
    fn extracts_deflated_entries() {
        let document = r"<w:document><w:body><w:p><w:r><w:t>Deflated body</w:t></w:r></w:p></w:body></w:document>";
        let bytes = build_deflated_zip(&[("word/document.xml", document)]);
        let value = serde_json::from_str::<JsonValue>(&extract_source_text_json("docx", &bytes))
            .unwrap_or(JsonValue::Null);
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(true),
            "deflated docx extraction succeeded"
        );
        assert_eq!(text_of(&value), "Deflated body", "deflated docx text");
    }

    /// 압축 파일 크기가 작아도 내부 XML 상한을 넘으면 안전하게 거부합니다.
    #[test]
    fn rejects_unbounded_xlsx_xml_token() {
        let limit = usize::try_from(MAX_ENTRY_BYTES).unwrap_or_default();
        let sheet = " ".repeat(limit.saturating_add(1));
        let bytes = build_deflated_zip(&[("xl/worksheets/sheet1.xml", &sheet)]);
        assert!(
            bytes.len() < 5 * 1024 * 1024,
            "압축 파일은 5MiB보다 작아야 합니다"
        );
        let value = extract_failure("xlsx", &bytes);
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("xml-token-budget"),
            "단일 XML 이벤트가 처리 버퍼 예산을 넘으면 거부합니다"
        );
        assert_eq!(
            text_of(&value),
            "",
            "거부한 문서의 일부 본문을 반환하지 않습니다"
        );
    }

    /// 단일 항목 상한의 포함 경계와 전체 누적 예산을 각각 확인합니다.
    #[test]
    fn enforces_entry_and_total_inflated_byte_boundaries() {
        let limit = usize::try_from(MAX_ENTRY_BYTES).unwrap_or_default();
        let content = " ".repeat(limit);
        let bytes = build_deflated_zip(&[("entry.xml", &content)]);
        let opened = open_archive(&bytes);
        assert!(opened.is_ok(), "합성 컨테이너를 열 수 있어야 합니다");
        if let Ok(mut archive) = opened {
            let mut budget = MAX_TOTAL_BYTES.saturating_sub(MAX_ENTRY_BYTES);
            assert!(
                read_entry(&mut archive, "entry.xml", &mut budget).is_ok(),
                "32MiB 항목과 64MiB 누적 경계는 허용합니다"
            );
            assert_eq!(budget, MAX_TOTAL_BYTES, "실제 읽은 바이트를 누적합니다");
            assert!(
                matches!(
                    read_entry(&mut archive, "entry.xml", &mut budget),
                    Err(ExtractFailure::TooLarge)
                ),
                "누적 상한 초과는 거부합니다"
            );
        }
    }

    /// 과도한 항목 수는 내용 읽기 전에 차단합니다.
    #[test]
    fn enforces_archive_entry_count_boundary() {
        let names: Vec<String> = (0..=MAX_ARCHIVE_ENTRIES)
            .map(|index| format!("{index}.xml"))
            .collect();
        let entries: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "")).collect();
        let allowed = build_zip(entries.get(..MAX_ARCHIVE_ENTRIES).unwrap_or_default());
        assert!(open_archive(&allowed).is_ok(), "항목 수 경계는 허용합니다");
        let rejected = build_zip(&entries);
        assert!(
            matches!(open_archive(&rejected), Err(ExtractFailure::TooLarge)),
            "항목 수 초과는 거부합니다"
        );
    }

    /// 비정상적으로 긴 셀은 일부 본문을 성공으로 반환하지 않습니다.
    #[test]
    fn rejects_oversized_xlsx_cell_token() {
        let cell = "a".repeat(MAX_TEXT_CHARS);
        let sheet = format!(
            "<worksheet><row><c t=\"inlineStr\"><is><t>{cell}</t></is></c></row></worksheet>"
        );
        let bytes = build_deflated_zip(&[("xl/worksheets/sheet1.xml", &sheet)]);
        let value = extract_failure("xlsx", &bytes);
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("xml-token-budget"),
            "긴 셀은 파싱 버퍼 예산으로 거부합니다"
        );
    }

    /// 시트 하나 또는 읽는 XML 총량이 과거 상한을 넘어도 작은 버퍼로 처리합니다.
    #[test]
    fn streams_xlsx_above_previous_inflated_limits() {
        let padding = format!("<ignored value=\"{}\"/>", "x".repeat(1024));
        let sheet = format!(
            "<worksheet>{}<row><c><v>42</v></c></row></worksheet>",
            padding.repeat(33 * 1024)
        );
        let bytes = build_deflated_zip(&[
            ("xl/worksheets/sheet1.xml", &sheet),
            ("xl/worksheets/sheet2.xml", &sheet),
        ]);
        let value = extract_failure("xlsx", &bytes);
        assert_eq!(
            text_of(&value),
            "42\n\n42",
            "크기만으로 정상 시트를 거부하지 않습니다"
        );
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(true),
            "전체 추출 성공"
        );
    }

    /// 일반 셀들의 본문이 과거 문자 상한을 넘어도 끝까지 읽습니다.
    #[test]
    fn streams_xlsx_above_previous_text_limit() {
        let row = format!(
            "<row><c t=\"inlineStr\"><is><t>{}</t></is></c></row>",
            "a".repeat(1024)
        );
        let sheet = format!("<worksheet>{}</worksheet>", row.repeat(8193));
        let bytes = build_deflated_zip(&[("xl/worksheets/sheet1.xml", &sheet)]);
        let value = extract_failure("xlsx", &bytes);
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(true),
            "과거 본문 상한을 넘는 정상 셀도 읽습니다"
        );
        assert!(
            text_of(&value).len() > MAX_TEXT_CHARS,
            "회귀 데이터가 과거 상한을 넘어야 합니다"
        );
    }

    /// XML 손상과 빈 셀의 상태가 다음 셀의 내용으로 섞이지 않습니다.
    #[test]
    fn xlsx_stream_rejects_partial_xml_and_preserves_entities() {
        let broken = extract(
            "xlsx",
            &[(
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c><v>42</v></c>",
            )],
        );
        assert_eq!(
            broken.get("reason").and_then(JsonValue::as_str),
            Some("corrupt"),
            "미완성 XML은 부분 성공이 아닙니다"
        );
        let valid = extract(
            "xlsx",
            &[(
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c/><c t=\"inlineStr\"><is><t>A &amp; B &#xD55C;</t></is></c></row></worksheet>",
            )],
        );
        assert_eq!(
            text_of(&valid),
            "A & B 한",
            "빈 셀과 XML 참조를 정확히 처리합니다"
        );
    }

    /// 작은 작업 예산에서는 결과가 잘리거나 부분 성공으로 바뀌지 않습니다.
    #[test]
    fn xlsx_memory_budget_rejects_whole_document() {
        let row = format!(
            "<row><c t=\"inlineStr\"><is><t>{}</t></is></c></row>",
            "a".repeat(1024)
        );
        let sheet = format!("<worksheet>{}</worksheet>", row.repeat(200));
        let bytes = build_deflated_zip(&[("xl/worksheets/sheet1.xml", &sheet)]);
        let limit = XLSX_ENGINE_BYTES + bytes.len() * 2 + XLSX_EVENT_BYTES * 4 + 256 * 1024;
        let result = extract_xlsx_with_budget(&bytes, limit, &[]);
        assert!(
            matches!(result, Err(ExtractFailure::MemoryBudget)),
            "예산 초과는 전체 실패입니다"
        );
        let mut value = XlsxSourceText { result };
        assert_eq!(value.reason(), "memory-budget", "실패 원인을 보존합니다");
        assert!(
            value.take_text_bytes().is_empty(),
            "부분 본문은 전달하지 않습니다"
        );
        assert_eq!(value.segments_json(), "[]", "부분 구간도 전달하지 않습니다");
    }

    /// 빈 문자열 항목도 공유 문자열 인덱스의 위치를 유지합니다.
    #[test]
    fn xlsx_stream_preserves_empty_shared_string_indices() {
        let shared = "<sst><si/><si><t>Alpha</t></si></sst>";
        let sheet = "<worksheet><row><c t=\"s\"><v>1</v></c></row></worksheet>";
        let value = extract(
            "xlsx",
            &[
                ("xl/sharedStrings.xml", shared),
                ("xl/worksheets/sheet1.xml", sheet),
            ],
        );
        assert_eq!(
            text_of(&value),
            "Alpha",
            "빈 항목 때문에 인덱스가 이동하지 않습니다"
        );
    }

    /// 작은 태그가 반복되어도 파서의 태그 스택이 무제한으로 자라지 않습니다.
    #[test]
    fn xlsx_stream_bounds_nested_xml_stack() {
        let sheet = format!(
            "{}{}",
            "<node>".repeat(XLSX_XML_DEPTH + 1),
            "</node>".repeat(XLSX_XML_DEPTH + 1)
        );
        let value = extract("xlsx", &[("xl/worksheets/sheet1.xml", &sheet)]);
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("xml-token-budget"),
            "XML 스택 예산 초과"
        );
        assert!(
            text_of(&value).is_empty(),
            "일부 본문을 성공으로 반환하지 않습니다"
        );
    }

    /// 워커의 UTF-8 버퍼는 한 번만 이동하고 줄 구간을 정확히 유지합니다.
    #[test]
    fn xlsx_worker_result_moves_text_and_preserves_line_segments() {
        let sheet = "<worksheet><row><c><v>42</v></c></row></worksheet>";
        let bytes = build_zip(&[
            ("xl/worksheets/sheet1.xml", sheet),
            ("xl/worksheets/sheet2.xml", sheet),
        ]);
        let mut value = XlsxSourceText::new(&bytes);
        assert!(value.reason().is_empty(), "전체 추출 성공");
        assert_eq!(value.take_text_bytes(), b"42\n\n42", "본문 버퍼 이동");
        assert!(
            value.take_text_bytes().is_empty(),
            "이동 후 복사본을 남기지 않습니다"
        );
        let segments: JsonValue =
            serde_json::from_str(&value.segments_json()).unwrap_or(JsonValue::Null);
        assert_eq!(
            segments
                .get(1)
                .and_then(|value| value.get("startLine"))
                .and_then(JsonValue::as_u64),
            Some(2),
            "두 번째 시트의 실제 시작 줄"
        );
        assert_eq!(
            segments
                .get(1)
                .and_then(|value| value.get("endLine"))
                .and_then(JsonValue::as_u64),
            Some(2),
            "두 번째 시트의 실제 끝 줄"
        );
    }

    /// 모든 압축 문서 형식에서 손상과 본문 부재를 구분합니다.
    #[test]
    fn distinguishes_missing_parts_and_corrupt_archives_for_all_formats() {
        for (extension, empty_reason) in [
            ("epub", "corrupt"),
            ("docx", "corrupt"),
            ("dotx", "corrupt"),
            ("odt", "corrupt"),
            ("odp", "corrupt"),
            ("ods", "corrupt"),
            ("pptx", "empty"),
            ("potx", "empty"),
            ("ppsx", "empty"),
            ("xlsx", "empty"),
            ("xltx", "empty"),
            ("hwpx", "empty"),
        ] {
            let corrupt = extract_failure(extension, b"not-a-zip");
            assert_eq!(
                corrupt.get("reason").and_then(JsonValue::as_str),
                Some("corrupt"),
                "손상 실패 계약: {extension}"
            );
            let empty = extract(extension, &[("unrelated.xml", "<root/>")]);
            assert_eq!(
                empty.get("reason").and_then(JsonValue::as_str),
                Some(empty_reason),
                "필수 본문 부재 계약: {extension}"
            );
            assert_eq!(text_of(&empty), "", "본문 부재는 부분 성공이 아닙니다");
        }
    }

    /// 템플릿·프레젠테이션·스프레드시트 확장자(`dotx`, `potx`, `ppsx`, `xltx`, `odp`, `ods`) 본문을 추출합니다.
    #[test]
    fn extracts_template_and_opendocument_formats() {
        let dotx = extract(
            "dotx",
            &[(
                "word/document.xml",
                r"<w:document><w:body><w:p><w:r><w:t>Template Word</w:t></w:r></w:p></w:body></w:document>",
            )],
        );
        assert_eq!(text_of(&dotx), "Template Word");

        for ext in ["potx", "ppsx"] {
            let slide = extract(
                ext,
                &[(
                    "ppt/slides/slide1.xml",
                    r"<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Template Slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>",
                )],
            );
            assert_eq!(text_of(&slide), "Template Slide");
        }

        let xltx = extract(
            "xltx",
            &[(
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><row><c t="inlineStr"><is><t>Template Cell</t></is></c><c><v>99</v></c></row></worksheet>"#,
            )],
        );
        assert_eq!(text_of(&xltx), "Template Cell\t99");

        let odp = extract(
            "odp",
            &[(
                "content.xml",
                r#"<office:document-content><office:body><office:presentation><draw:page draw:name="page1"><draw:frame><draw:text-box><text:p>Slide Alpha</text:p><text:p>Slide Beta</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>"#,
            )],
        );
        assert_eq!(text_of(&odp), "Slide Alpha\nSlide Beta");
        assert_eq!(
            odp.get("segments")
                .and_then(|s| s.get(0))
                .and_then(|s| s.get("label"))
                .and_then(JsonValue::as_str),
            Some("Slide 1")
        );

        let ods = extract(
            "ods",
            &[(
                "content.xml",
                r#"<office:document-content><office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell><text:p>Metric</text:p></table:table-cell><table:table-cell><text:p>128</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>"#,
            )],
        );
        assert_eq!(text_of(&ods), "Metric\t128");
        assert_eq!(
            ods.get("segments")
                .and_then(|s| s.get(0))
                .and_then(|s| s.get("label"))
                .and_then(JsonValue::as_str),
            Some("Sheet 1")
        );
    }

    /// 숫자 순서로 여러 시트를 읽고 문자열·수식 캐시·다국어 값을 보존합니다.
    #[test]
    fn extracts_xlsx_cell_types_and_numeric_sheet_order() {
        let first = r#"<worksheet><row><c t="inlineStr"><is><t>한글 Alpha</t></is></c><c><f>20+22</f><v>42</v></c><c t="b"><v>1</v></c></row></worksheet>"#;
        let second = r#"<worksheet><row><c t="s"><v>0</v></c><c/></row></worksheet>"#;
        let shared = r"<sst><si><r><t>Beta </t></r><r><t>世界</t></r></si></sst>";
        let value = extract(
            ".XLSX",
            &[
                ("xl/worksheets/sheet10.xml", second),
                ("xl/sharedStrings.xml", shared),
                ("xl/worksheets/sheet2.xml", first),
            ],
        );
        assert_eq!(
            text_of(&value),
            "한글 Alpha\t42\t1\nB1 =20+22\n\nBeta 世界",
            "셀 유형과 시트 숫자 순서를 유지합니다"
        );
        for (index, label) in ["Sheet 2", "Sheet 10"].iter().enumerate() {
            assert_eq!(
                value
                    .get("segments")
                    .and_then(|segments| segments.get(index))
                    .and_then(|segment| segment.get("label"))
                    .and_then(JsonValue::as_str),
                Some(*label),
                "시트 구간 라벨"
            );
        }
    }

    /// 지원하지 않는 확장자는 추출하지 않습니다.
    #[test]
    fn rejects_unsupported_extension() {
        let value = extract_failure("png", b"not a document");
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(false),
            "png is not extractable"
        );
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("unsupported"),
            "unsupported reason code"
        );
    }

    /// 손상된 컨테이너는 본문 대신 실패 코드를 돌려줍니다.
    #[test]
    fn reports_corrupt_archive() {
        let value = extract_failure("docx", b"PK-not-really-a-zip");
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(false),
            "corrupt archive rejected"
        );
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("corrupt"),
            "corrupt reason code"
        );
    }

    /// 본문이 비어 있는 문서는 `empty`로 보고합니다.
    #[test]
    fn reports_empty_document() {
        let document = r"<w:document><w:body></w:body></w:document>";
        let value = extract("docx", &[("word/document.xml", document)]);
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(false),
            "empty document rejected"
        );
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("empty"),
            "empty reason code"
        );
    }

    /// 비 XLSX도 손상·엔티티·빈 태그를 엄격하게 처리합니다.
    #[test]
    fn source_extract_container_xml_is_lossless_or_explicit_failure() {
        for xml in [
            "<w:document><w:p><w:t>partial</w:t></w:p>",
            "<w:document><w:p><w:t>partial</w:p></w:document>",
        ] {
            let value = extract("docx", &[("word/document.xml", xml)]);
            assert_eq!(
                at(&value, "/reason"),
                "corrupt",
                "손상 XML의 부분 성공 금지"
            );
            assert_eq!(text_of(&value), "");
        }
        let value = extract(
            "docx",
            &[(
                "word/document.xml",
                "<w:document><w:p/><w:p><w:r><w:t>A &amp; B &#xD55C;</w:t><w:tab/><w:t>C</w:t></w:r></w:p></w:document>",
            )],
        );
        assert_eq!(text_of(&value), "A & B 한\tC");
    }

    /// 문단·문단 수 상한을 일부 본문 성공으로 포장하지 않습니다.
    #[test]
    fn source_extract_container_limits_never_silently_truncate() {
        for content in [
            format!(
                "<w:p><w:t>{}</w:t></w:p>",
                "x".repeat(MAX_PARAGRAPH_CHARS + 1)
            ),
            "<w:p><w:t>x</w:t></w:p>".repeat(MAX_SEGMENTS + 1),
        ] {
            let xml = format!("<w:document>{content}</w:document>");
            let value = extract("docx", &[("word/document.xml", &xml)]);
            assert!(
                at(&value, "/ok") == false
                    || text_of(&value).chars().filter(|ch| *ch == 'x').count()
                        == content.chars().filter(|ch| *ch == 'x').count(),
                "완전 추출 또는 명시적 실패"
            );
        }
        let mut document = ExtractedDocument::new();
        for _ in 0..=MAX_SEGMENTS {
            document.push_segment("part", "x");
        }
        assert!(
            matches!(finish_document(document), Err(ExtractFailure::TooLarge)),
            "세그먼트 상한은 명시적으로 실패"
        );
    }

    /// Word 보조 part·저장 필드·빈 표 셀을 보존합니다.
    #[test]
    fn source_extract_docx_auxiliary_parts_and_tables() {
        let value = extract(
            "docx",
            &[
                (
                    "word/document.xml",
                    "<w:document><w:p><w:instrText>MERGEFIELD synthetic</w:instrText><w:t>body</w:t></w:p><w:tbl><w:tr><w:tc/><w:tc><w:p><w:t>right</w:t></w:p></w:tc></w:tr></w:tbl></w:document>",
                ),
                (
                    "word/footnotes.xml",
                    "<w:footnotes><w:footnote w:id='7'><w:p><w:t>footnote</w:t></w:p></w:footnote></w:footnotes>",
                ),
                (
                    "word/endnotes.xml",
                    "<w:endnotes><w:endnote><w:p><w:t>endnote</w:t></w:p></w:endnote></w:endnotes>",
                ),
                (
                    "word/comments.xml",
                    "<w:comments><w:comment><w:p><w:t>comment</w:t></w:p></w:comment></w:comments>",
                ),
                (
                    "word/header1.xml",
                    "<w:hdr><w:p><w:t>header</w:t></w:p></w:hdr>",
                ),
                (
                    "word/footer1.xml",
                    "<w:ftr><w:p><w:t>footer</w:t></w:p></w:ftr>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true);
        for token in [
            "MERGEFIELD synthetic",
            "body",
            "right",
            "footnote",
            "endnote",
            "comment",
            "header",
            "footer",
        ] {
            assert!(text_of(&value).contains(token), "누락: {token}");
        }
        assert!(text_of(&value).contains("\tright"), "첫 빈 셀 위치");
        assert!(
            at(&value, "/segments/0/locator/cells").is_array(),
            "표 좌표 wire"
        );
    }

    /// 슬라이드 관계 순서와 노트·주석·차트 캐시를 읽습니다.
    #[test]
    fn source_extract_pptx_relationship_order_and_related_text() {
        let value = extract(
            "pptx",
            &[
                (
                    "ppt/presentation.xml",
                    "<p:presentation><p:sldIdLst><p:sldId r:id='b'/><p:sldId r:id='a'/></p:sldIdLst></p:presentation>",
                ),
                (
                    "ppt/_rels/presentation.xml.rels",
                    "<Relationships><Relationship Id='a' Target='slides/slide1.xml'/><Relationship Id='b' Target='slides/slide2.xml'/><Relationship Id='web' Target='https://invalid.example/' TargetMode='External'/></Relationships>",
                ),
                (
                    "ppt/slides/slide1.xml",
                    "<p:sld><a:p><a:t>first-file</a:t></a:p></p:sld>",
                ),
                (
                    "ppt/slides/slide2.xml",
                    "<p:sld><a:p><a:t>first-visible</a:t></a:p></p:sld>",
                ),
                (
                    "ppt/notesSlides/notesSlide2.xml",
                    "<p:notes><a:p><a:t>speaker-note</a:t></a:p></p:notes>",
                ),
                (
                    "ppt/comments/comment2.xml",
                    "<p:cmLst><p:cm><p:text>saved-comment</p:text></p:cm></p:cmLst>",
                ),
                (
                    "ppt/charts/chart1.xml",
                    "<c:chartSpace><c:f>Sheet!A1</c:f><c:v>chart-cache</c:v></c:chartSpace>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true);
        assert!(text_of(&value).starts_with("first-visible"));
        for token in ["speaker-note", "saved-comment", "Sheet!A1", "chart-cache"] {
            assert!(text_of(&value).contains(token), "누락: {token}");
        }
    }

    /// 반복 빈 셀·행과 수식·주석·노트의 저장 값을 보존합니다.
    #[test]
    fn source_extract_odf_and_hwpx_saved_text_and_coordinates() {
        let ods = extract(
            "ods",
            &[(
                "content.xml",
                "<office:document-content><table:table table:name='Actual'><table:table-row table:number-rows-repeated='2'><table:table-cell table:number-columns-repeated='3'/><table:table-cell table:formula='of:=1+2' office:value='3'><office:annotation><text:p>cell-note</text:p></office:annotation></table:table-cell></table:table-row></table:table></office:document-content>",
            )],
        );
        assert_eq!(at(&ods, "/ok"), true);
        assert!(text_of(&ods).contains("of:=1+2"));
        assert!(text_of(&ods).contains('3'));
        assert!(text_of(&ods).contains("cell-note"));
        assert_eq!(at(&ods, "/segments/0/locator/sheetName"), "Actual");
        let cells = at(&ods, "/segments/0/locator/cells")
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert!(
            cells
                .iter()
                .any(|cell| at(cell, "/row") == 2 && at(cell, "/column") == 4)
        );
        let hwpx = extract(
            "hwpx",
            &[
                (
                    "Contents/section0.xml",
                    "<hs:sec><hp:p><hp:t>outer<hp:footNote><hp:p><hp:t>nested-note</hp:t></hp:p></hp:footNote></hp:t></hp:p></hs:sec>",
                ),
                (
                    "Contents/memo.xml",
                    "<memos><memo><hp:p><hp:t>saved-memo</hp:t></hp:p></memo></memos>",
                ),
            ],
        );
        assert_eq!(at(&hwpx, "/ok"), true);
        for token in ["outer", "nested-note", "saved-memo"] {
            assert!(text_of(&hwpx).contains(token), "누락: {token}");
        }
        let odt = extract(
            "odt",
            &[(
                "content.xml",
                "<office:document-content><text:p>outer<text:note><text:note-body><text:p>nested-note</text:p></text:note-body></text:note><office:annotation><text:p>saved-comment</text:p></office:annotation></text:p></office:document-content>",
            )],
        );
        assert_eq!(at(&odt, "/ok"), true);
        for token in ["outer", "nested-note", "saved-comment"] {
            assert!(text_of(&odt).contains(token));
        }
    }

    /// EPUB 스파인 밖 각주와 OPF 서지 텍스트도 검색 가능해야 합니다.
    #[test]
    fn source_extract_epub_nonspine_notes_and_metadata() {
        let value = extract(
            "epub",
            &[
                (
                    "META-INF/container.xml",
                    "<container><rootfile full-path='book/package.opf'/></container>",
                ),
                (
                    "book/package.opf",
                    "<package><metadata><dc:title>Synthetic title</dc:title><dc:creator>Synthetic author</dc:creator></metadata><manifest><item id='body' href='body.xhtml' media-type='application/xhtml+xml'/><item id='notes' href='notes.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='body'/></spine></package>",
                ),
                (
                    "book/body.xhtml",
                    "<html><body><p>Main <a href='notes.xhtml#n1'>reference</a></p><table><tr><td/><td>cell</td></tr></table></body></html>",
                ),
                (
                    "book/notes.xhtml",
                    "<html><body><aside id='n1'>nonspine-note</aside></body></html>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true);
        for token in [
            "Synthetic title",
            "Synthetic author",
            "nonspine-note",
            "cell",
        ] {
            assert!(text_of(&value).contains(token), "누락: {token}");
        }
    }

    /// 수식은 캐시와 별개로 검색 본문에도 남고 잘못된 참조는 실패합니다.
    #[test]
    fn source_extract_xlsx_formula_search_and_invalid_references() {
        let value = extract(
            "xlsx",
            &[(
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1'><f>SUM(B1:C1)</f><v>7</v></c><c r='B1'><f>missing-cache</f></c></row></worksheet>",
            )],
        );
        assert_eq!(at(&value, "/ok"), true);
        for token in ["SUM(B1:C1)", "missing-cache", "7"] {
            assert!(text_of(&value).contains(token), "누락: {token}");
        }
        let invalid = extract(
            "xlsx",
            &[(
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c t='s'><v>99</v></c></row></worksheet>",
            )],
        );
        assert_eq!(at(&invalid, "/reason"), "corrupt");
    }

    /// HWPX·Word의 병합과 명시 셀 주소를 해석합니다.
    #[test]
    fn source_extract_table_spans_and_explicit_hwpx_addresses() {
        let docx = extract(
            "docx",
            &[(
                "word/document.xml",
                "<w:document><w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val='2'/></w:tcPr><w:p><w:t>merged</w:t></w:p></w:tc><w:tc><w:p><w:t>third</w:t></w:p></w:tc></w:tr></w:tbl></w:document>",
            )],
        );
        assert_eq!(at(&docx, "/segments/0/locator/cells/1/column"), 3);
        let hwpx = extract(
            "hwpx",
            &[(
                "Contents/section0.xml",
                "<hs:sec><hp:p><hp:tbl><hp:tr><hp:tc><hp:cellAddr rowAddr='4' colAddr='2'/><hp:cellSpan rowSpan='2' colSpan='3'/><hp:subList><hp:p><hp:t>located</hp:t></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:p></hs:sec>",
            )],
        );
        assert_eq!(at(&hwpx, "/segments/0/locator/cells/0/row"), 5);
        assert_eq!(at(&hwpx, "/segments/0/locator/cells/0/column"), 3);
    }

    /// 헤더·표 밖 주석·SVG 저장 텍스트도 누락하지 않습니다.
    #[test]
    fn source_extract_odf_outside_units_and_headers() {
        let value = extract(
            "ods",
            &[
                (
                    "content.xml",
                    "<office:document-content><text:p>outside-note</text:p><table:table><table:table-row><table:table-cell><text:p>cell</text:p></table:table-cell></table:table-row></table:table></office:document-content>",
                ),
                (
                    "styles.xml",
                    "<office:document-styles><office:styles><style:master-page><style:header><text:p>saved-header</text:p></style:header></style:master-page></office:styles></office:document-styles>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true);
        for token in ["outside-note", "saved-header", "cell"] {
            assert!(text_of(&value).contains(token), "누락: {token}");
        }
    }

    /// 실제 시트명·관계 순서·주소·수식 캐시·병합을 위치 wire에 보존합니다.
    #[test]
    fn source_extract_xlsx_workbook_coordinates_formula_and_merge() {
        let value = extract(
            "xlsx",
            &[
                (
                    "xl/workbook.xml",
                    "<workbook><sheets><sheet name='Visible B' r:id='b'/><sheet name='Visible A' r:id='a'/></sheets></workbook>",
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    "<Relationships><Relationship Id='a' Target='worksheets/sheet1.xml'/><Relationship Id='b' Target='worksheets/sheet2.xml'/></Relationships>",
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><row r='9'><c r='D9'><v>last</v></c></row></worksheet>",
                ),
                (
                    "xl/worksheets/sheet2.xml",
                    "<worksheet><row r='3'><c r='B3'><f>1+2</f><v>3</v></c><c r='D3' t='inlineStr'><is><t>right</t></is></c></row><mergeCells><mergeCell ref='B3:C3'/></mergeCells></worksheet>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true);
        assert!(text_of(&value).starts_with("3\tright"));
        assert_eq!(at(&value, "/segments/0/label"), "Visible B");
        assert_eq!(
            at(&value, "/segments/0/sourcePart"),
            "xl/worksheets/sheet2.xml"
        );
        assert_eq!(at(&value, "/segments/0/locator/cells/0/address"), "B3");
        assert_eq!(at(&value, "/segments/0/locator/cells/0/formula"), "1+2");
        assert_eq!(at(&value, "/segments/0/locator/cells/0/cachedValue"), "3");
        assert_eq!(at(&value, "/segments/0/locator/mergedRanges/0"), "B3:C3");
    }

    /// 참조된 part 누락은 남아 있는 시트만 성공 반환하지 않습니다.
    #[test]
    fn source_extract_missing_related_sheet_is_corrupt() {
        let value = extract(
            "xlsx",
            &[
                (
                    "xl/workbook.xml",
                    "<workbook><sheet name='present' r:id='a'/><sheet name='missing' r:id='b'/></workbook>",
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    "<Relationships><Relationship Id='a' Target='worksheets/sheet1.xml'/><Relationship Id='b' Target='worksheets/missing.xml'/></Relationships>",
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><row><c><v>partial</v></c></row></worksheet>",
                ),
            ],
        );
        assert_eq!(at(&value, "/reason"), "corrupt");
        assert_eq!(text_of(&value), "");
    }

    /// 시트 헤더·필드 수식·대체 설명과 주석의 원래 연결을 보존합니다.
    #[test]
    fn source_extract_saved_headers_fields_and_relationship_locators() {
        let xlsx = extract(
            "xlsx",
            &[(
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1'><v>body</v></c></row><headerFooter><oddHeader>stored-header</oddHeader><oddFooter>stored-footer</oddFooter></headerFooter></worksheet>",
            )],
        );
        for token in ["body", "stored-header", "stored-footer"] {
            assert!(text_of(&xlsx).contains(token), "누락: {token}");
        }
        let docx = extract(
            "docx",
            &[(
                "word/document.xml",
                "<w:document><w:p><w:fldSimple w:instr='DATE saved-format'><w:t>cached-date</w:t></w:fldSimple></w:p><a:cNvPr descr='shape-description'/></w:document>",
            )],
        );
        for token in ["DATE saved-format", "cached-date", "shape-description"] {
            assert!(text_of(&docx).contains(token), "누락: {token}");
        }
        let pptx = extract(
            "pptx",
            &[
                (
                    "ppt/slides/slide1.xml",
                    "<p:sld><a:p><a:t>body</a:t></a:p></p:sld>",
                ),
                (
                    "ppt/slides/_rels/slide1.xml.rels",
                    "<Relationships><Relationship Id='n' Target='../notesSlides/custom.xml'/><Relationship Id='web' TargetMode='External' Target='https://invalid.example/never-fetch'/></Relationships>",
                ),
                (
                    "ppt/notesSlides/custom.xml",
                    "<p:notes><a:p><a:t>linked-note</a:t></a:p></p:notes>",
                ),
            ],
        );
        let segments = at(&pptx, "/segments")
            .as_array()
            .cloned()
            .unwrap_or_default();
        let note = segments
            .iter()
            .find(|segment| at(segment, "/sourcePart") == "ppt/notesSlides/custom.xml")
            .unwrap_or(&JsonValue::Null);
        assert_eq!(at(note, "/locator/relatedTo/0"), "ppt/slides/slide1.xml");
    }

    /// 공통 XML 경계와 참조 오류는 텍스트가 있어도 명시적으로 실패합니다.
    #[test]
    fn source_extract_xml_budgets_and_corruption_are_explicit() {
        let deep = format!(
            "{}<w:p><w:t>partial</w:t></w:p>{}",
            "<n>".repeat(XLSX_XML_DEPTH + 1),
            "</n>".repeat(XLSX_XML_DEPTH + 1)
        );
        let token = format!(
            "<w:document><w:p><w:t>{}</w:t></w:p></w:document>",
            "x".repeat(XLSX_EVENT_BYTES + 1)
        );
        for (xml, reason) in [
            (deep.as_str(), "xml-token-budget"),
            (token.as_str(), "xml-token-budget"),
            (
                "<w:document><w:p><w:t>partial &unknown;</w:t></w:p></w:document>",
                "corrupt",
            ),
            (
                "<w:document><w:p><w:t>partial</w:t></w:p></w:document><extra/>",
                "corrupt",
            ),
        ] {
            let value = extract("docx", &[("word/document.xml", xml)]);
            assert_eq!(at(&value, "/reason"), reason);
            assert_eq!(text_of(&value), "");
        }
        let repeat = extract(
            "ods",
            &[(
                "content.xml",
                "<office:document-content><table:table><table:table-row table:number-rows-repeated='999999999'><table:table-cell><text:p>partial</text:p></table:table-cell></table:table-row></table:table></office:document-content>",
            )],
        );
        assert_eq!(at(&repeat, "/reason"), "too-large");
        assert_eq!(text_of(&repeat), "");
    }

    /// HWPX 수식 스크립트는 실행 코드가 아니라 저장된 수학 텍스트입니다.
    #[test]
    fn source_extract_hwpx_equation_script_is_saved_text() {
        let value = extract(
            "hwpx",
            &[(
                "Contents/section0.xml",
                "<hs:sec><hp:p><hp:t>before</hp:t><hp:equation><hp:script>sum from i=1 to n a_i</hp:script></hp:equation></hp:p></hs:sec>",
            )],
        );
        assert!(text_of(&value).contains("sum from i=1 to n a_i"));
    }

    /// UTF-16 저장 XML과 UTF-8 손상을 무손실·실패로 구분합니다.
    #[test]
    fn source_extract_xml_utf16_is_lossless() {
        let text = "<w:document><w:p><w:t>합성 😀</w:t></w:p></w:document>";
        for little in [true, false] {
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for unit in text.encode_utf16() {
                bytes.extend(if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            assert_eq!(decode_xml_bytes(bytes).ok().as_deref(), Some(text));
        }
        assert!(matches!(
            decode_xml_bytes(vec![0xff]),
            Err(ExtractFailure::Corrupt)
        ));
        assert!(matches!(
            decode_xml_bytes(vec![0xff, 0xfe, 0, 0xd8]),
            Err(ExtractFailure::Corrupt)
        ));
    }

    /// 네임스페이스 별칭·생략 주소와 저장 XML 부가 텍스트의 줄 위치를 보존합니다.
    #[test]
    fn source_extract_prefixed_xlsx_cells_and_line_ranges() {
        let value = extract(
            "xlsx",
            &[
                (
                    "xl/worksheets/sheet1.xml",
                    "<x:worksheet><x:row r='3'><x:c r='B3'><x:f>SUM(C3)</x:f><x:v>7</x:v></x:c><x:c t='inlineStr'><x:is><x:t>next</x:t></x:is></x:c></x:row><x:headerFooter><x:oddHeader>header</x:oddHeader></x:headerFooter></x:worksheet>",
                ),
                (
                    "xl/comments1.xml",
                    "<comments><comment ref='B3'><text><t>saved-comment</t></text></comment></comments>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true);
        assert_eq!(at(&value, "/segments/0/locator/cells/1/address"), "C3");
        assert_eq!(at(&value, "/segments/1/locator/anchors/0/address"), "B3");
        let lines: Vec<_> = text_of(&value).split('\n').collect();
        let segments = at(&value, "/segments")
            .as_array()
            .cloned()
            .unwrap_or_default();
        for segment in segments {
            let start = at(&segment, "/startLine")
                .as_u64()
                .and_then(|line| usize::try_from(line).ok())
                .unwrap_or(usize::MAX);
            let end = at(&segment, "/endLine")
                .as_u64()
                .and_then(|line| usize::try_from(line).ok())
                .unwrap_or(usize::MAX);
            assert!(
                lines
                    .get(start..=end)
                    .is_some_and(|slice| !slice.join("\n").trim().is_empty())
            );
        }
    }

    /// 독립 차트 캐시와 중첩 각주가 본문 단어에 붙어 토큰을 잃지 않습니다.
    #[test]
    fn source_extract_preserves_searchable_block_boundaries() {
        let chart = extract(
            "pptx",
            &[
                ("ppt/slides/slide1.xml", "<p:sld/>"),
                (
                    "ppt/charts/chart1.xml",
                    "<c:chartSpace><c:f>Sheet!A1:A2</c:f><c:v>Alpha</c:v><c:v>Beta</c:v></c:chartSpace>",
                ),
            ],
        );
        assert!(
            text_of(&chart)
                .split_whitespace()
                .any(|word| word == "Alpha")
        );
        assert!(
            text_of(&chart)
                .split_whitespace()
                .any(|word| word == "Beta")
        );
        let note = extract(
            "odt",
            &[(
                "content.xml",
                "<office:document-content><text:p>outer<text:note><text:note-body><text:p>note</text:p></text:note-body></text:note>after</text:p></office:document-content>",
            )],
        );
        for token in ["outer", "note", "after"] {
            assert!(text_of(&note).split_whitespace().any(|word| word == token));
        }
    }

    /// VML 저장 도형의 문자열 속성과 HTML형 텍스트 상자도 읽습니다.
    #[test]
    fn source_extract_vml_shape_text_is_searchable() {
        let value = extract(
            "docx",
            &[(
                "word/document.xml",
                "<w:document><w:p><w:t>body</w:t></w:p><v:shape><v:textpath string='saved-shape-path'/><v:textbox><div>saved-shape-box</div></v:textbox></v:shape></w:document>",
            )],
        );
        for token in ["saved-shape-path", "saved-shape-box"] {
            assert!(text_of(&value).contains(token), "누락: {token}");
        }
    }

    /// ODF 병합의 covered 셀을 이중으로 세지 않고 Word 생략 열도 반영합니다.
    #[test]
    fn source_extract_covered_cells_and_grid_before_coordinates() {
        let ods = extract(
            "ods",
            &[(
                "content.xml",
                "<office:document-content><table:table><table:table-row><table:table-cell table:number-columns-spanned='2'><text:p>merged</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>third</text:p></table:table-cell></table:table-row></table:table></office:document-content>",
            )],
        );
        assert_eq!(at(&ods, "/segments/0/locator/cells/2/column"), 3);
        let docx = extract(
            "docx",
            &[(
                "word/document.xml",
                "<w:document><w:tbl><w:tr><w:trPr><w:gridBefore w:val='2'/></w:trPr><w:tc><w:p><w:t>third</w:t></w:p></w:tc></w:tr></w:tbl></w:document>",
            )],
        );
        assert_eq!(at(&docx, "/segments/0/locator/cells/0/column"), 3);
    }

    /// 이진 중첩 ZIP도 독립 합성 자료로 만듭니다.
    fn nested_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in entries {
            assert!(
                writer
                    .start_file(*name, SimpleFileOptions::default())
                    .is_ok()
            );
            assert!(writer.write_all(body).is_ok());
        }
        writer
            .finish()
            .map_or_else(|_| Vec::new(), Cursor::into_inner)
    }

    /// 관계로 연결한 자식만 검색하며 확장자가 아닌 실제 패키지 형식을 씁니다.
    fn nested_host(format: &str, target: &str, child: &[u8], kind: &str) -> Vec<u8> {
        let (part, xml) = match format {
            "pptx" => (
                "ppt/slides/slide1.xml",
                "<p:sld><a:p><a:t>parent</a:t></a:p></p:sld>",
            ),
            "xlsx" => (
                "xl/worksheets/sheet1.xml",
                "<worksheet><sheetData><row r='1'><c r='A1' t='inlineStr'><is><t>parent</t></is></c></row></sheetData></worksheet>",
            ),
            _ => (
                "word/document.xml",
                "<w:document><w:p><w:t>parent</w:t></w:p></w:document>",
            ),
        };
        let (directory, file) = part.rsplit_once('/').unwrap_or(("", part));
        let rel_path = format!("{directory}/_rels/{file}.rels");
        let rel = format!(
            "<Relationships><Relationship Id='r1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}' Target='{target}'/></Relationships>"
        );
        let child_path = resolve_path(part, target);
        nested_zip(&[
            (part, xml.as_bytes()),
            (&rel_path, rel.as_bytes()),
            (&child_path, child),
        ])
    }

    /// 흔한 차트 내부 XLSX의 유일한 조건·셀·주석을 원래 좌표와 함께 보존합니다.
    #[test]
    fn source_extract_nested_chart_workbook_and_provenance() {
        let child = build_zip(&[
            (
                "xl/worksheets/sheet1.xml",
                "<worksheet><sheetData><row r='7'><c r='C7' t='inlineStr'><is><t>nested-only-condition &amp; value</t></is></c></row></sheetData></worksheet>",
            ),
            (
                "xl/comments1.xml",
                "<comments><comment ref='C7' authorId='0'><text><t>nested-only-footnote</t></text></comment></comments>",
            ),
        ]);
        let host = nested_zip(&[
            ("ppt/slides/slide1.xml", b"<p:sld><a:p><a:t>parent</a:t></a:p></p:sld>"),
            ("ppt/charts/chart1.xml", b"<c:chart><c:externalData r:id='r1'/></c:chart>"),
            ("ppt/charts/_rels/chart1.xml.rels", b"<Relationships><Relationship Id='r1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/package' Target='../embeddings/data.bin'/><Relationship Id='r2' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/package' Target='../embeddings/data.bin'/></Relationships>"),
            ("ppt/embeddings/data.bin", &child),
            ("unrelated.xlsx", b"not-a-package"),
        ]);
        let value = extract_failure("pptx", &host);
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert_eq!(text_of(&value).matches("nested-only-condition").count(), 1);
        assert!(text_of(&value).contains("nested-only-footnote"));
        assert!(!text_of(&value).contains("ppt/embeddings"));
        let segments = at(&value, "/segments")
            .as_array()
            .map_or_default(Vec::as_slice);
        let sheet = segments
            .iter()
            .find(|s| at(s, "/sourcePart") == "ppt/embeddings/data.bin!/xl/worksheets/sheet1.xml")
            .unwrap_or(&JsonValue::Null);
        assert_eq!(at(sheet, "/locator/cells/0/address"), "C7");
        assert_eq!(
            at(sheet, "/locator/cells/0/startLine"),
            at(sheet, "/startLine")
        );
        assert_eq!(at(sheet, "/locator/cells/0/endLine"), at(sheet, "/endLine"));
        assert_eq!(
            at(sheet, "/locator/containerChain/0/sourcePart"),
            "ppt/embeddings/data.bin"
        );
        assert_eq!(
            at(sheet, "/locator/containerChain/0/relatedTo/0"),
            "ppt/charts/chart1.xml"
        );
        let note = segments
            .iter()
            .find(|s| at(s, "/sourcePart") == "ppt/embeddings/data.bin!/xl/comments1.xml")
            .unwrap_or(&JsonValue::Null);
        assert_eq!(at(note, "/locator/anchors/0/address"), "C7");
        let lines: Vec<_> = text_of(&value).lines().collect();
        for segment in segments {
            let first = at(segment, "/startLine")
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .unwrap_or(usize::MAX);
            let last = at(segment, "/endLine")
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .unwrap_or(usize::MAX);
            assert!(first <= last && last < lines.len());
        }
    }

    /// Word 안의 Word 노트와 XLSX 안의 지원 문서는 실제 관계를 통해 추출합니다.
    #[test]
    fn source_extract_nested_docx_and_xlsx_package_relationships() {
        let note = build_zip(&[
            (
                "word/document.xml",
                "<w:document><w:p><w:t>nested-note-only</w:t></w:p></w:document>",
            ),
            (
                "word/footnotes.xml",
                "<w:footnotes><w:footnote w:id='9'><w:p><w:t>inner-footnote</w:t></w:p></w:footnote></w:footnotes>",
            ),
        ]);
        for (format, target) in [
            ("docx", "embeddings/note.docx"),
            ("xlsx", "../embeddings/note.bin"),
        ] {
            let bytes = nested_host(format, target, &note, "package");
            let value = extract_failure(format, &bytes);
            assert_eq!(at(&value, "/ok"), true, "{value}");
            assert!(text_of(&value).contains("nested-note-only"));
            assert!(text_of(&value).contains("inner-footnote"));
            if format == "xlsx" {
                let mut worker = XlsxSourceText::new(&bytes);
                assert_eq!(worker.reason(), "");
                assert!(
                    String::from_utf8_lossy(&worker.take_text_bytes()).contains("nested-note-only")
                );
            }
        }
        let middle = nested_host("docx", "embeddings/inner.docx", &note, "package");
        let outer = nested_host("docx", "embeddings/middle.docx", &middle, "package");
        let value = extract_failure("docx", &outer);
        assert_eq!(at(&value, "/ok"), true);
        let segments = at(&value, "/segments")
            .as_array()
            .map_or_default(Vec::as_slice);
        assert!(segments.iter().any(|s| {
            at(s, "/sourcePart")
                == "word/embeddings/middle.docx!/word/embeddings/inner.docx!/word/footnotes.xml"
                && at(s, "/locator/containerChain")
                    .as_array()
                    .is_some_and(|c| c.len() == 2)
        }));
    }

    /// altChunk의 일반 평문에는 이미 승인된 디코더를 적용합니다.
    #[test]
    fn source_extract_nested_altchunk_text_and_ooxml() {
        let text = nested_host(
            "docx",
            "chunks/chunk.txt",
            b"unique-altchunk & plain <text>\nsecond line",
            "aFChunk",
        );
        let value = extract_failure("docx", &text);
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert!(text_of(&value).contains("unique-altchunk & plain <text>"));
        let doc = build_zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>ooxml-altchunk-only</w:t></w:p></w:document>",
        )]);
        let value = extract_failure(
            "docx",
            &nested_host("docx", "chunks/chunk.bin", &doc, "aFChunk"),
        );
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert!(text_of(&value).contains("ooxml-altchunk-only"));
    }

    /// 누락·외부·깊이·미지원 자식은 일부 성공으로 숨기지 않습니다.
    #[test]
    fn source_extract_nested_failures_and_unrelated_entries() {
        for (child, reason) in [
            (b"%PDF-1.7".as_slice(), "unsupported"),
            (
                [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].as_slice(),
                "unsupported",
            ),
            (b"PK broken".as_slice(), "corrupt"),
        ] {
            let value = extract_failure(
                "docx",
                &nested_host("docx", "embeddings/data.bin", child, "package"),
            );
            assert_eq!(at(&value, "/reason"), reason, "{value}");
            assert_eq!(text_of(&value), "");
        }
        let missing = build_zip(&[
            (
                "word/document.xml",
                "<w:document><w:p><w:t>parent</w:t></w:p></w:document>",
            ),
            (
                "word/_rels/document.xml.rels",
                "<Relationships><Relationship Id='r1' Type='x/package' Target='missing.docx'/></Relationships>",
            ),
        ]);
        assert_eq!(at(&extract_failure("docx", &missing), "/reason"), "corrupt");
        let external = build_zip(&[
            (
                "word/document.xml",
                "<w:document><w:p><w:t>parent</w:t></w:p></w:document>",
            ),
            (
                "word/_rels/document.xml.rels",
                "<Relationships><Relationship Id='r1' Type='x/package' Target='https://invalid.test/never.docx' TargetMode='External'/></Relationships>",
            ),
            ("ignored.xlsx", "not-a-package"),
        ]);
        assert_eq!(text_of(&extract_failure("docx", &external)), "parent");
        let mut deep = build_zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>deep</w:t></w:p></w:document>",
        )]);
        for _ in 0..6 {
            deep = nested_host("docx", "embeddings/child.docx", &deep, "package");
        }
        let value = extract_failure("docx", &deep);
        assert_eq!(at(&value, "/reason"), "too-large", "{value}");
        assert_eq!(text_of(&value), "");
    }

    /// 승인된 12종 저장 패키지는 확장자가 다른 관계 대상에서도 실제 형식으로 읽습니다.
    #[test]
    fn source_extract_nested_all_twelve_package_formats() {
        let fixtures: &[(&str, &[(&str, &str)])] = &[
            (
                "epub",
                &[
                    ("mimetype", "application/epub+zip"),
                    (
                        "META-INF/container.xml",
                        "<container><rootfile full-path='book.opf'/></container>",
                    ),
                    (
                        "book.opf",
                        "<package><manifest><item id='a' href='a.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='a'/></spine></package>",
                    ),
                    ("a.xhtml", "<html><p>twelve-only-epub</p></html>"),
                ],
            ),
            (
                "odt",
                &[
                    ("mimetype", "application/vnd.oasis.opendocument.text"),
                    (
                        "content.xml",
                        "<office:document><text:p>twelve-only-odt</text:p></office:document>",
                    ),
                ],
            ),
            (
                "odp",
                &[
                    (
                        "mimetype",
                        "application/vnd.oasis.opendocument.presentation",
                    ),
                    (
                        "content.xml",
                        "<office:document><draw:page><text:p>twelve-only-odp</text:p></draw:page></office:document>",
                    ),
                ],
            ),
            (
                "ods",
                &[
                    ("mimetype", "application/vnd.oasis.opendocument.spreadsheet"),
                    (
                        "content.xml",
                        "<office:document><table:table><table:table-row><table:table-cell><text:p>twelve-only-ods</text:p></table:table-cell></table:table-row></table:table></office:document>",
                    ),
                ],
            ),
            (
                "hwpx",
                &[
                    ("mimetype", "application/hwp+zip"),
                    (
                        "Contents/section0.xml",
                        "<hp:sec><hp:p><hp:t>twelve-only-hwpx</hp:t></hp:p></hp:sec>",
                    ),
                ],
            ),
        ];
        for (format, parts) in fixtures {
            let child = build_zip(parts);
            let host = nested_host(
                "docx",
                &format!("embeddings/{format}.bin"),
                &child,
                "package",
            );
            let value = extract_failure("docx", &host);
            assert_eq!(at(&value, "/ok"), true, "{format}: {value}");
            assert!(
                text_of(&value).contains(&format!("twelve-only-{format}")),
                "{format}"
            );
        }
    }

    /// 확장자 표식 대신 실제 주 part 유형으로 OOXML 변형을 구분합니다.
    fn nested_ooxml_type(format: &str) -> (&str, &str) {
        match format {
            "docx" => (
                "word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
            ),
            "dotx" => (
                "word/document.xml",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
            ),
            "pptx" => (
                "ppt/presentation.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
            ),
            "potx" => (
                "ppt/presentation.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
            ),
            "ppsx" => (
                "ppt/presentation.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
            ),
            "xltx" => (
                "xl/workbook.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
            ),
            _ => (
                "xl/workbook.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            ),
        }
    }

    /// OOXML 템플릿·슬라이드쇼도 같은 저장 part를 보존합니다.
    #[test]
    fn source_extract_nested_ooxml_package_formats() {
        let fixtures: &[(&str, &[(&str, &str)])] = &[
            (
                "docx",
                &[(
                    "word/document.xml",
                    "<w:document><w:p><w:t>twelve-only-docx</w:t></w:p></w:document>",
                )],
            ),
            (
                "dotx",
                &[(
                    "word/document.xml",
                    "<w:document><w:p><w:t>twelve-only-dotx</w:t></w:p></w:document>",
                )],
            ),
            (
                "pptx",
                &[(
                    "ppt/slides/slide1.xml",
                    "<p:sld><a:p><a:t>twelve-only-pptx</a:t></a:p></p:sld>",
                )],
            ),
            (
                "potx",
                &[(
                    "ppt/slides/slide1.xml",
                    "<p:sld><a:p><a:t>twelve-only-potx</a:t></a:p></p:sld>",
                )],
            ),
            (
                "ppsx",
                &[(
                    "ppt/slides/slide1.xml",
                    "<p:sld><a:p><a:t>twelve-only-ppsx</a:t></a:p></p:sld>",
                )],
            ),
            (
                "xlsx",
                &[(
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><sheetData><row><c t='inlineStr'><is><t>twelve-only-xlsx</t></is></c></row></sheetData></worksheet>",
                )],
            ),
            (
                "xltx",
                &[(
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><sheetData><row><c t='inlineStr'><is><t>twelve-only-xltx</t></is></c></row></sheetData></worksheet>",
                )],
            ),
        ];
        for (format, parts) in fixtures {
            let (main, mime) = nested_ooxml_type(format);
            let content_types =
                format!("<Types><Override PartName='/{main}' ContentType='{mime}'/></Types>");
            let mut enriched = parts.to_vec();
            if !enriched.iter().any(|(path, _)| *path == main) {
                enriched.push((
                    main,
                    if main.starts_with("ppt/") {
                        "<p:presentation/>"
                    } else {
                        "<workbook/>"
                    },
                ));
            }
            enriched.push(("[Content_Types].xml", &content_types));
            let child = build_zip(&enriched);
            let host = nested_host(
                "docx",
                &format!("embeddings/{format}.bin"),
                &child,
                "package",
            );
            let value = extract_failure("docx", &host);
            assert_eq!(at(&value, "/ok"), true, "{format}: {value}");
            assert!(
                text_of(&value).contains(&format!("twelve-only-{format}")),
                "{format}"
            );
        }
    }

    /// 자식 수 제한과 누적 구간·출력 상한은 루트 전체에 적용합니다.
    #[test]
    fn source_extract_nested_child_and_output_limits() {
        let child = build_zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>child</w:t></w:p></w:document>",
        )]);
        let names: Vec<_> = (0..33)
            .map(|i| format!("word/embeddings/child{i}.bin"))
            .collect();
        let mut rels = String::from("<Relationships>");
        for i in 0..33 {
            assert!(
                write!(
                    &mut rels,
                    "<Relationship Id='r{i}' Type='x/package' Target='embeddings/child{i}.bin'/>"
                )
                .is_ok()
            );
        }
        rels.push_str("</Relationships>");
        let mut parts = vec![
            (
                "word/document.xml",
                b"<w:document><w:p><w:t>parent</w:t></w:p></w:document>".as_slice(),
            ),
            ("word/_rels/document.xml.rels", rels.as_bytes()),
        ];
        for name in &names {
            parts.push((name, child.as_slice()));
        }
        assert_eq!(
            at(&extract_failure("docx", &nested_zip(&parts)), "/reason"),
            "too-large"
        );
        let paragraph = format!("<w:p><w:t>{}</w:t></w:p>", "x".repeat(48 * 1024));
        let body = format!("<w:document>{}</w:document>", paragraph.repeat(86));
        let child = build_deflated_zip(&[("word/document.xml", &body)]);
        let host = nested_zip(&[("word/document.xml", body.as_bytes()), ("word/_rels/document.xml.rels", b"<Relationships><Relationship Id='r1' Type='x/package' Target='embeddings/child.bin'/></Relationships>"), ("word/embeddings/child.bin", &child)]);
        let value = extract_failure("docx", &host);
        assert_eq!(at(&value, "/reason"), "too-large", "{value}");
        assert_eq!(text_of(&value), "");
    }

    /// 표준 manifest의 지원 문서만 따라가고 중첩 출처를 유지합니다.
    #[test]
    fn source_extract_nested_manifest_hosts() {
        let child = build_zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>manifest-child-only</w:t></w:p></w:document>",
        )]);
        let epub = nested_zip(&[
            ("mimetype", b"application/epub+zip"),
            ("META-INF/container.xml", b"<container><rootfile full-path='book.opf'/></container>"),
            ("book.opf", b"<package><manifest><item id='a' href='a.xhtml' media-type='application/xhtml+xml'/><item id='note' href='data.bin' media-type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'/></manifest><spine><itemref idref='a'/></spine></package>"),
            ("a.xhtml", b"<html><p>parent</p></html>"),
            ("data.bin", &child),
        ]);
        let odt = nested_zip(&[
            ("mimetype", b"application/vnd.oasis.opendocument.text"),
            ("content.xml", b"<office:document><text:p>parent</text:p></office:document>"),
            ("META-INF/manifest.xml", b"<manifest:manifest><manifest:file-entry manifest:full-path='/' manifest:media-type='application/vnd.oasis.opendocument.text'/><manifest:file-entry manifest:full-path='data.bin' manifest:media-type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'/></manifest:manifest>"),
            ("data.bin", &child),
        ]);
        let hwpx = nested_zip(&[
            ("Contents/section0.xml", b"<hp:sec><hp:p><hp:t>parent</hp:t></hp:p></hp:sec>"),
            ("Contents/content.hpf", b"<opf:package><opf:manifest><opf:item href='../BinData/data.bin' media-type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'/></opf:manifest></opf:package>"),
            ("BinData/data.bin", &child),
        ]);
        for (format, bytes) in [("epub", epub), ("odt", odt), ("hwpx", hwpx)] {
            let value = extract_failure(format, &bytes);
            assert_eq!(at(&value, "/ok"), true, "{format}: {value}");
            assert!(text_of(&value).contains("manifest-child-only"));
        }
    }

    /// altChunk의 MIME 평문·XML, 손상/순환, 깊이 경계를 검증합니다.
    #[test]
    fn source_extract_nested_altchunk_and_depth_boundaries() {
        let host = nested_zip(&[
            ("word/document.xml", b"<w:document><w:p><w:t>parent</w:t></w:p></w:document>"),
            ("word/_rels/document.xml.rels", b"<Relationships><Relationship Id='r1' Type='x/aFChunk' Target='chunks/raw.bin'/></Relationships>"),
            ("[Content_Types].xml", b"<Types><Override PartName='/word/chunks/raw.bin' ContentType='text/plain'/></Types>"),
            ("word/chunks/raw.bin", b"mime-plain-only & <text>"),
        ]);
        assert!(text_of(&extract_failure("docx", &host)).contains("mime-plain-only & <text>"));
        let markup = nested_host(
            "docx",
            "chunks/chunk.xhtml",
            b"<html><p>markup-only &amp; value</p></html>",
            "aFChunk",
        );
        assert!(text_of(&extract_failure("docx", &markup)).contains("markup-only & value"));
        let bad = nested_host("docx", "chunks/chunk.txt", b"forbidden\0control", "aFChunk");
        assert_eq!(at(&extract_failure("docx", &bad), "/reason"), "corrupt");
        let cycle = build_zip(&[
            (
                "word/document.xml",
                "<w:document><w:p><w:t>parent</w:t></w:p></w:document>",
            ),
            (
                "word/_rels/document.xml.rels",
                "<Relationships><Relationship Id='r1' Type='x/package' Target='document.xml'/></Relationships>",
            ),
        ]);
        assert_eq!(at(&extract_failure("docx", &cycle), "/reason"), "corrupt");
        let mut deep = build_zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>depth-four-only</w:t></w:p></w:document>",
        )]);
        for _ in 0..4 {
            deep = nested_host("docx", "embeddings/child.bin", &deep, "package");
        }
        assert!(text_of(&extract_failure("docx", &deep)).contains("depth-four-only"));
        deep = nested_host("docx", "embeddings/child.bin", &deep, "package");
        assert_eq!(at(&extract_failure("docx", &deep), "/reason"), "too-large");
    }

    /// 미지원 PDF/OLE와 디렉터리형 객체도 manifest에서 일부 성공으로 숨기지 않습니다.
    #[test]
    fn source_extract_nested_unsupported_manifest_objects() {
        for (mime, path, payload) in [
            ("application/pdf", "data.pdf", b"%PDF-1.7".as_slice()),
            (
                "application/vnd.sun.star.oleobject",
                "data.bin",
                [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].as_slice(),
            ),
            (
                "application/vnd.oasis.opendocument.spreadsheet",
                "Object 1/",
                b"".as_slice(),
            ),
        ] {
            let manifest = format!(
                "<manifest:manifest><manifest:file-entry manifest:full-path='{path}' manifest:media-type='{mime}'/></manifest:manifest>"
            );
            let bytes = nested_zip(&[
                (
                    "content.xml",
                    b"<office:document><text:p>parent</text:p></office:document>",
                ),
                ("META-INF/manifest.xml", manifest.as_bytes()),
                (path, payload),
            ]);
            let value = extract_failure("odt", &bytes);
            assert_eq!(at(&value, "/reason"), "unsupported", "{value}");
            assert_eq!(text_of(&value), "");
        }
    }

    /// 리뷰 2: XHTML s는 삭제하지 않고 ODF 공백은 실제 namespace로 판별합니다.
    #[test]
    fn source_extract_review_2_namespace_spaces() {
        let value = extract(
            "epub",
            &[
                (
                    "META-INF/container.xml",
                    "<container><rootfiles><rootfile full-path='book.opf'/></rootfiles></container>",
                ),
                (
                    "book.opf",
                    "<package><manifest><item id='a' href='a.xhtml' media-type='application/xhtml+xml'/></manifest><spine><itemref idref='a'/></spine></package>",
                ),
                (
                    "a.xhtml",
                    "<html xmlns='http://www.w3.org/1999/xhtml'><body><p>before <s>important-condition</s> after</p></body></html>",
                ),
            ],
        );
        assert!(
            text_of(&value).contains("before important-condition after"),
            "{value}"
        );
        for xml in [
            "<root xmlns:q='urn:oasis:names:tc:opendocument:xmlns:text:1.0'><q:p>A<q:s q:c='3'/>B</q:p></root>",
            "<root xmlns='urn:oasis:names:tc:opendocument:xmlns:text:1.0' xmlns:q='urn:oasis:names:tc:opendocument:xmlns:text:1.0'><p>A<s q:c='3'/>B</p></root>",
        ] {
            let value = extract("odt", &[("content.xml", xml)]);
            assert_eq!(text_of(&value), "A   B", "{value}");
        }
    }

    /// 리뷰 3: 본문 참조 위치의 삽입은 보조 part의 뒤붙이기와 다릅니다.
    #[test]
    fn source_extract_review_3_altchunk_flow() {
        let value = extract(
            "docx",
            &[
                (
                    "word/document.xml",
                    "<w:document><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p><w:altChunk r:id='r1'/><w:p><w:r><w:t>C</w:t></w:r></w:p></w:body></w:document>",
                ),
                (
                    "word/_rels/document.xml.rels",
                    "<Relationships><Relationship Id='r1' Type='x/aFChunk' Target='b.txt'/><Relationship Id='unused' Type='x/aFChunk' Target='b.txt'/></Relationships>",
                ),
                ("word/b.txt", "B"),
            ],
        );
        assert_eq!(text_of(&value), "A\n\nB\n\nC", "{value}");
        let segments = at(&value, "/segments")
            .as_array()
            .map_or_default(Vec::as_slice);
        assert_eq!(segments.len(), 3);
        for (index, segment) in segments.iter().enumerate() {
            assert_eq!(
                segment.get("startLine").and_then(JsonValue::as_u64),
                u64::try_from(index * 2).ok()
            );
        }
    }

    /// 리뷰 4: 빈 시트 원장은 첫 시트 본문을 인용하지 않습니다.
    #[test]
    fn source_extract_review_4_empty_sheet_ledger() {
        let value = extract(
            "xlsx",
            &[
                (
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><sheetData><row><c r='A1' t='inlineStr'><is><t>alpha</t></is></c></row></sheetData></worksheet>",
                ),
                (
                    "xl/worksheets/sheet2.xml",
                    "<worksheet><sheetData><row><c r='A1'/></row></sheetData></worksheet>",
                ),
            ],
        );
        assert_eq!(text_of(&value), "alpha", "{value}");
        assert_eq!(
            at(&value, "/segments").as_array().map(Vec::len),
            Some(1),
            "{value}"
        );
    }

    /// 리뷰 5: HTML rowspan은 다음 행에서 실제 열을 점유합니다.
    #[test]
    fn source_extract_review_5_html_rowspan() {
        let result = container::standalone_part(
            b"<table><tr><td rowspan='2'>A</td><td>B</td></tr><tr><td>C</td></tr></table>",
            "table.xhtml",
        );
        assert!(result.is_ok());
        let Ok(document) = result else {
            return;
        };
        let wire = document.segments_json();
        assert_eq!(
            wire.first()
                .and_then(|s| s.pointer("/locator/cells/2/column"))
                .and_then(JsonValue::as_u64),
            Some(2)
        );
    }

    /// 리뷰 6: 보조 XML만으로 형식을 가장하거나 잘못된 주 루트를 통과하지 않습니다.
    #[test]
    fn source_extract_review_6_required_main_structure() {
        for extension in ["pptx", "xlsx"] {
            let value = extract(
                extension,
                &[("unrelated.xml", "<root><t>not-a-presentation</t></root>")],
            );
            assert_eq!(at(&value, "/ok"), false, "{value}");
        }
        for (extension, part) in [
            ("pptx", "ppt/slides/slide1.xml"),
            ("xlsx", "xl/worksheets/sheet1.xml"),
        ] {
            let value = extract(
                extension,
                &[(
                    part,
                    "<root><t>wrong-main-root</t><c><v>wrong</v></c></root>",
                )],
            );
            assert_eq!(at(&value, "/ok"), false, "{value}");
        }
    }

    /// 리뷰 7: 참조한 실제 셀과 같은 캐시만 하나의 본문과 alias로 합칩니다.
    #[test]
    fn source_extract_review_7_chart_cache_alias() {
        let value = extract(
            "xlsx",
            &[
                (
                    "xl/workbook.xml",
                    "<workbook><sheets><sheet name='Data' r:id='s1'/></sheets></workbook>",
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    "<Relationships><Relationship Id='s1' Target='worksheets/sheet1.xml'/></Relationships>",
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><sheetData><row><c r='A1' t='inlineStr'><is><t>unique-marker</t></is></c></row></sheetData></worksheet>",
                ),
                (
                    "xl/charts/chart1.xml",
                    "<c:chartSpace><c:chart><c:ser><c:strRef><c:f>Data!$A$1</c:f><c:strCache><c:pt idx='0'><c:v>unique-marker</c:v></c:pt></c:strCache></c:strRef></c:ser></c:chart></c:chartSpace>",
                ),
            ],
        );
        assert_eq!(
            text_of(&value).matches("unique-marker").count(),
            1,
            "{value}"
        );
        assert!(
            at(&value, "/segments/0/locator/aliases").is_array(),
            "{value}"
        );
    }

    /// 인접 삽입은 byte 위치가 같아도 문서 노드 순서가 관계 XML 순서보다 우선합니다.
    #[test]
    fn source_extract_review_3_adjacent_repeated_and_cell_lines() {
        let child = build_zip(&[(
            "xl/worksheets/sheet1.xml",
            "<worksheet><row><c r='C7'><v>child-cell</v><f>1+2</f></c></row></worksheet>",
        )]);
        let host = nested_zip(&[
            ("word/document.xml", b"<w:document><w:body><w:p><w:t>A</w:t></w:p><w:altChunk r:id='first'/><w:altChunk r:id='second'/><w:altChunk r:id='first'/><w:p><w:t>C</w:t></w:p></w:body></w:document>"),
            ("word/_rels/document.xml.rels", b"<Relationships><Relationship Id='second' Type='x/aFChunk' Target='d.txt'/><Relationship Id='first' Type='x/aFChunk' Target='book.bin'/><Relationship Id='duplicate' Type='x/aFChunk' Target='book.bin'/></Relationships>"),
            ("word/d.txt", b"D"), ("word/book.bin", &child),
        ]);
        let value = extract_failure("docx", &host);
        assert_eq!(
            text_of(&value),
            "A\n\nchild-cell\nC7 =1+2\n\nD\n\nchild-cell\nC7 =1+2\n\nC",
            "{value}"
        );
        let segments = at(&value, "/segments")
            .as_array()
            .map_or_default(Vec::as_slice);
        assert_eq!(segments.len(), 5, "{value}");
        let lines: Vec<_> = text_of(&value).split('\n').collect();
        for segment in segments {
            if at(segment, "/locator/cells/0/address") == "C7" {
                let line = at(segment, "/locator/cells/0/startLine")
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .unwrap_or(usize::MAX);
                let formula = at(segment, "/locator/cells/0/formulaStartLine")
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .unwrap_or(usize::MAX);
                assert_eq!(lines.get(line), Some(&"child-cell"));
                assert_eq!(lines.get(formula), Some(&"C7 =1+2"));
            }
        }
    }

    /// span 결합·빈 셀·중첩 표의 점유는 독립적이며 거대 span은 실패합니다.
    #[test]
    fn source_extract_review_5_span_grid_and_nested_isolation() {
        let raw = b"<table><tr><td rowspan='2' colspan='2'>A</td><td/><td>B</td></tr><tr><td>C<table><tr><td>inner</td></tr></table></td><td>D</td></tr><tr><td>E</td></tr></table>";
        let result = container::standalone_part(raw, "table.xhtml");
        assert!(result.is_ok());
        let Ok(document) = result else {
            return;
        };
        let wire = document.segments_json();
        let cells = wire
            .first()
            .and_then(|v| v.pointer("/locator/cells"))
            .and_then(JsonValue::as_array)
            .map_or_default(Vec::as_slice);
        let outer: Vec<_> = cells
            .iter()
            .filter(|c| at(c, "/table") == 1)
            .map(|c| (at(c, "/row").as_u64(), at(c, "/column").as_u64()))
            .collect();
        assert_eq!(
            outer,
            vec![
                (Some(1), Some(1)),
                (Some(1), Some(3)),
                (Some(1), Some(4)),
                (Some(2), Some(3)),
                (Some(2), Some(4)),
                (Some(3), Some(1))
            ]
        );
        let result = container::standalone_part(
            b"<table><tr><td rowspan='999999999'>A</td></tr></table>",
            "table.xhtml",
        );
        assert!(matches!(result, Err(ExtractFailure::TooLarge)));
    }

    /// 참조 불명·상충 캐시·독립된 같은 단어는 삭제하지 않습니다. PPTX workbook 관계도 증명합니다.
    #[test]
    fn source_extract_review_7_nested_chart_and_conflicting_evidence() {
        let workbook = build_zip(&[
            (
                "xl/workbook.xml",
                "<workbook><sheets><sheet name='Data Set' r:id='s'/></sheets></workbook>",
            ),
            (
                "xl/_rels/workbook.xml.rels",
                "<Relationships><Relationship Id='s' Target='worksheets/sheet1.xml'/></Relationships>",
            ),
            (
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1' t='inlineStr'><is><t>shared-marker</t></is></c><c r='B1' t='inlineStr'><is><t>shared-marker</t></is></c><c r='C1' t='inlineStr'><is><t>different-actual</t></is></c></row></worksheet>",
            ),
        ]);
        let chart = b"<c:chartSpace><c:chart><c:strRef><c:f>'Data Set'!$A$1</c:f><c:strCache><c:pt idx='0'><c:v>shared-marker</c:v></c:pt></c:strCache></c:strRef><c:strRef><c:f>'Data Set'!$C$1</c:f><c:strCache><c:pt idx='0'><c:v>conflicting-cache</c:v></c:pt></c:strCache></c:strRef><c:strRef><c:f>unknown-name</c:f><c:strCache><c:pt idx='0'><c:v>shared-marker</c:v></c:pt></c:strCache></c:strRef><c:externalData r:id='book'/></c:chart></c:chartSpace>";
        let host = nested_zip(&[
            ("ppt/slides/slide1.xml", b"<p:sld><a:p><a:t>shared-marker independent-context</a:t></a:p></p:sld>"),
            ("ppt/charts/chart1.xml", chart),
            ("ppt/charts/_rels/chart1.xml.rels", b"<Relationships><Relationship Id='book' Type='x/package' Target='../embeddings/book.bin'/></Relationships>"),
            ("ppt/embeddings/book.bin", &workbook),
        ]);
        let value = extract_failure("pptx", &host);
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert_eq!(
            text_of(&value).matches("shared-marker").count(),
            4,
            "{value}"
        );
        for token in [
            "independent-context",
            "conflicting-cache",
            "different-actual",
            "unknown-name",
        ] {
            assert!(text_of(&value).contains(token), "{value}");
        }
        let sheet = at(&value, "/segments")
            .as_array()
            .and_then(|segments| {
                segments.iter().find(|s| {
                    at(s, "/sourcePart") == "ppt/embeddings/book.bin!/xl/worksheets/sheet1.xml"
                })
            })
            .unwrap_or(&JsonValue::Null);
        assert_eq!(
            at(sheet, "/locator/aliases/0/sourcePart"),
            "ppt/charts/chart1.xml",
            "{value}"
        );
        assert_eq!(at(sheet, "/locator/aliases/0/address"), "A1");
        let line = at(sheet, "/locator/cells/0/startLine")
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
            .unwrap_or(usize::MAX);
        assert!(
            text_of(&value)
                .split('\n')
                .nth(line)
                .is_some_and(|s| s.starts_with("shared-marker\tshared-marker\tdifferent-actual"))
        );
    }

    /// 빈 시트 원장은 JSON과 이동 버퍼 API 양쪽에서 본문 좌표 없이 남습니다.
    #[test]
    fn source_extract_review_4_metadata_wire_and_middle_cells() {
        let entries = [
            (
                "xl/sharedStrings.xml",
                "<sst><si><t>alpha\nbeta</t></si></sst>",
            ),
            (
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1' t='s'><v>0</v></c><c r='B1'/><c r='C1'><v>3</v><f>1+2</f></c></row></worksheet>",
            ),
            (
                "xl/worksheets/sheet2.xml",
                "<worksheet><row><c r='A1'/></row></worksheet>",
            ),
            ("xl/worksheets/sheet3.xml", "<worksheet/>"),
        ];
        let value = extract("xlsx", &entries);
        assert_eq!(text_of(&value), "alpha\nbeta\t3\nC1 =1+2", "{value}");
        assert_eq!(at(&value, "/segments/0/locator/cells/1/address"), "B1");
        assert!(at(&value, "/segments/0/locator/cells/1/startLine").is_null());
        assert_eq!(at(&value, "/segments/0/locator/cells/2/startLine"), 1);
        assert_eq!(
            at(&value, "/segments/0/locator/cells/2/formulaStartLine"),
            2
        );
        assert_eq!(
            at(&value, "/metadataParts/0/sourcePart"),
            "xl/worksheets/sheet2.xml"
        );
        assert_eq!(at(&value, "/metadataParts/0/locator/cells/0/address"), "A1");
        assert!(at(&value, "/metadataParts/0/startLine").is_null());
        assert_eq!(
            at(&value, "/metadataParts/1/sourcePart"),
            "xl/worksheets/sheet3.xml"
        );
        let mut result = XlsxSourceText::new(&build_zip(&entries));
        assert_eq!(result.reason(), "");
        assert_eq!(result.take_text_bytes(), text_of(&value).as_bytes());
        let metadata: JsonValue =
            serde_json::from_str(&result.metadata_parts_json()).unwrap_or(JsonValue::Null);
        assert_eq!(&metadata, at(&value, "/metadataParts"));
    }

    /// 삽입만 읽을 수 있어도 주 구조가 없는 패키지는 성공시키지 않습니다.
    #[test]
    fn source_extract_review_6_missing_main_with_children() {
        let child = build_zip(&[(
            "word/document.xml",
            "<w:document><w:p><w:t>child-evidence</w:t></w:p></w:document>",
        )]);
        for (format, source, relations, target) in [
            (
                "pptx",
                "ppt/slides/slidebad.xml",
                "ppt/slides/_rels/slidebad.xml.rels",
                "ppt/slides/child.bin",
            ),
            (
                "xlsx",
                "xl/worksheets/sheetbad.xml",
                "xl/worksheets/_rels/sheetbad.xml.rels",
                "xl/worksheets/child.bin",
            ),
        ] {
            let raw = nested_zip(&[(source, b"<root/>"), (relations, b"<Relationships><Relationship Id='x' Type='x/package' Target='child.bin'/></Relationships>"), (target, &child)]);
            let value = extract_failure(format, &raw);
            assert_eq!(at(&value, "/ok"), false, "{value}");
        }
    }

    /// 셀 안의 적법한 block 삽입도 가짜 본문 없이 원래 위치와 표 좌표를 유지합니다.
    #[test]
    fn source_extract_review_3_table_insertion() {
        let value = extract(
            "docx",
            &[
                (
                    "word/document.xml",
                    "<w:document><w:tbl><w:tr><w:tc><w:p><w:t>A</w:t></w:p><w:altChunk r:id='b'/><w:p><w:t>C</w:t></w:p></w:tc></w:tr></w:tbl></w:document>",
                ),
                (
                    "word/_rels/document.xml.rels",
                    "<Relationships><Relationship Id='b' Type='x/aFChunk' Target='b.txt'/></Relationships>",
                ),
                ("word/b.txt", "B"),
            ],
        );
        assert_eq!(text_of(&value), "A\n\nB\n\nC", "{value}");
        assert_eq!(at(&value, "/segments/0/locator/cells/0/row"), 1);
        assert_eq!(at(&value, "/segments/2/locator/cells/0/column"), 1);
    }

    /// 한 차원의 저장 범위는 pt idx를 셀에 연결하되 범위 밖/상충은 보존합니다.
    #[test]
    fn source_extract_review_7_range_and_unknown_cache() {
        let value = extract(
            "xlsx",
            &[
                (
                    "xl/workbook.xml",
                    "<workbook><sheets><sheet name='Data' r:id='s'/></sheets></workbook>",
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    "<Relationships><Relationship Id='s' Target='worksheets/sheet1.xml'/></Relationships>",
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    "<worksheet><row><c r='A1'><v>11</v></c><c r='B1'><v>22</v></c></row></worksheet>",
                ),
                (
                    "xl/charts/chart1.xml",
                    "<c:chartSpace><c:numRef><c:f>Data!$A$1:$B$1</c:f><c:numCache><c:pt idx='0'><c:v>11</c:v></c:pt><c:pt idx='1'><c:v>22</c:v></c:pt><c:pt idx='2'><c:v>11</c:v></c:pt></c:numCache></c:numRef><c:numRef><c:f>Data!$A$1</c:f><c:numCache><c:pt idx='0'><c:v>99</c:v></c:pt></c:numCache></c:numRef><c:numRef><c:f>Data!A$$1</c:f><c:numCache><c:pt idx='0'><c:v>11</c:v></c:pt></c:numCache></c:numRef></c:chartSpace>",
                ),
            ],
        );
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert_eq!(text_of(&value).matches("22").count(), 1, "{value}");
        assert_eq!(
            text_of(&value).matches("11").count(),
            3,
            "out-of-range and ambiguous references survive: {value}"
        );
        assert!(text_of(&value).contains("99"));
        assert_eq!(
            at(&value, "/segments/0/locator/aliases")
                .as_array()
                .map(Vec::len),
            Some(2)
        );
        assert!(
            at(&value, "/segments/0/locator/aliases/0/nodePath")
                .as_str()
                .is_some_and(|s| s.contains("numRef"))
        );
    }

    /// 뒤 차트의 캐시 제거는 이미 병합한 앞 workbook의 셀 줄도 역방향으로 이동합니다.
    #[test]
    fn source_extract_review_7_multiple_workbooks_and_outer_alias_paths() {
        let book = |marker: &str| {
            build_zip(&[
                (
                    "xl/workbook.xml",
                    "<workbook><sheets><sheet name='Data' r:id='s'/></sheets></workbook>",
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    "<Relationships><Relationship Id='s' Target='worksheets/sheet1.xml'/></Relationships>",
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    &format!(
                        "<worksheet><row><c r='A1' t='inlineStr'><is><t>{marker}</t></is></c></row></worksheet>"
                    ),
                ),
            ])
        };
        let first = book("first-marker");
        let second = book("second-marker");
        let host = nested_zip(&[
            ("ppt/slides/slide1.xml", b"<p:sld><a:t>slide</a:t></p:sld>"),
            ("ppt/charts/chart1.xml", b"<c:chartSpace><c:strRef><c:f>Data!A1</c:f><c:strCache><c:pt idx='0'><c:v>first-marker</c:v></c:pt></c:strCache></c:strRef><c:externalData r:id='b'/></c:chartSpace>"),
            ("ppt/charts/chart2.xml", b"<c:chartSpace><c:strRef><c:f>Data!A1</c:f><c:strCache><c:pt idx='0'><c:v>second-marker</c:v></c:pt></c:strCache></c:strRef><c:externalData r:id='b'/></c:chartSpace>"),
            ("ppt/charts/_rels/chart1.xml.rels", b"<Relationships><Relationship Id='b' Type='x/package' Target='../embeddings/book1.bin'/></Relationships>"),
            ("ppt/charts/_rels/chart2.xml.rels", b"<Relationships><Relationship Id='b' Type='x/package' Target='../embeddings/book2.bin'/></Relationships>"),
            ("ppt/embeddings/book1.bin", &first), ("ppt/embeddings/book2.bin", &second),
        ]);
        let value = extract_failure(
            "docx",
            &nested_host("docx", "presentation.bin", &host, "package"),
        );
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert_eq!(text_of(&value).matches("first-marker").count(), 1);
        assert_eq!(text_of(&value).matches("second-marker").count(), 1);
        let segments = at(&value, "/segments")
            .as_array()
            .map_or_default(Vec::as_slice);
        for segment in segments {
            if let Some(marker) = segment
                .pointer("/locator/cells/0/cachedValue")
                .and_then(JsonValue::as_str)
            {
                let line = at(segment, "/locator/cells/0/startLine")
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .unwrap_or(usize::MAX);
                assert_eq!(
                    text_of(&value).split('\n').nth(line),
                    Some(marker),
                    "{value}"
                );
                assert!(
                    at(segment, "/locator/aliases/0/sourcePart")
                        .as_str()
                        .is_some_and(|p| p.starts_with("word/presentation.bin!/ppt/charts/")),
                    "{value}"
                );
            }
        }
    }

    /// externalData가 미해결/복수이면 같은 셀 값만으로 workbook 소유권을 추측하지 않습니다.
    #[test]
    fn source_extract_review_7_ambiguous_external_workbook_binding() {
        let chart = "<c:chartSpace><c:strRef><c:f>Data!A1</c:f><c:strCache><c:pt idx='0'><c:v>binding-marker</c:v></c:pt></c:strCache></c:strRef><c:externalData r:id='unknown'/></c:chartSpace>";
        let workbook = build_zip(&[
            (
                "xl/workbook.xml",
                "<workbook><sheets><sheet name='Data' r:id='s'/></sheets></workbook>",
            ),
            (
                "xl/_rels/workbook.xml.rels",
                "<Relationships><Relationship Id='s' Target='worksheets/sheet1.xml'/></Relationships>",
            ),
            (
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1' t='inlineStr'><is><t>binding-marker</t></is></c></row></worksheet>",
            ),
            ("xl/charts/chart1.xml", chart),
        ]);
        let value = extract_failure("xlsx", &workbook);
        assert_eq!(
            text_of(&value).matches("binding-marker").count(),
            2,
            "{value}"
        );
        let chart = chart.replace(
            "r:id='unknown'/>",
            "r:id='book'/><c:externalData r:id='unknown'/>",
        );
        let host = nested_zip(&[
            ("ppt/slides/slide1.xml", b"<p:sld/>"),
            ("ppt/charts/chart1.xml", chart.as_bytes()),
            ("ppt/charts/_rels/chart1.xml.rels", b"<Relationships><Relationship Id='book' Type='x/package' Target='../embeddings/book.bin'/></Relationships>"),
            ("ppt/embeddings/book.bin", &workbook),
        ]);
        let value = extract_failure("pptx", &host);
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert_eq!(
            text_of(&value).matches("binding-marker").count(),
            3,
            "{value}"
        );
    }

    /// 같은 보조 관계는 출처 문자열을 반복 복사하지 않습니다.
    #[test]
    fn source_extract_tail_relationship_ledger_deduplicates_before_copy() {
        let source = format!("word/{}.xml", "s".repeat(2048));
        let relationship_part = format!("word/_rels/{}.xml.rels", "s".repeat(2048));
        let mut relations = String::from("<Relationships>");
        for index in 0..256 {
            assert!(
                write!(
                    relations,
                    "<Relationship Id='r{index}' Type='x/image' Target='media/picture.png'/>"
                )
                .is_ok()
            );
        }
        relations.push_str("</Relationships>");
        let bytes = build_zip(&[(&source, "<w:hdr/>"), (&relationship_part, &relations)]);
        let archive = open_archive(&bytes);
        assert!(archive.is_ok(), "합성 관계 패키지를 열 수 없습니다.");
        let Ok(mut archive) = archive else {
            return;
        };
        let mut document = ExtractedDocument::new();
        let links = container::package_links(&mut archive, &mut 0, &mut document);
        assert!(links.is_ok(), "중복 관계는 유한 원장으로 처리해야 합니다.");
        let Ok(links) = links else {
            return;
        };
        assert_eq!(links.get("word/media/picture.png").map(Vec::len), Some(1));
        assert!(document.metadata_bytes < 4 * 1024 * 1024);
    }

    /// 긴 상대 경로의 원장도 실제 문자열 생성 전에 예산으로 차단합니다.
    #[test]
    fn source_extract_tail_relationship_paths_require_admission() {
        let directory = format!("word/{}", "d".repeat(32 * 1024));
        let source = format!("{directory}/header.xml");
        let relationship_part = format!("{directory}/_rels/header.xml.rels");
        let mut relations = String::from("<Relationships>");
        for index in 0..1024 {
            assert!(
                write!(
                    relations,
                    "<Relationship Id='r{index}' Type='x/image' Target='media/picture{index}.png'/>"
                )
                .is_ok()
            );
        }
        relations.push_str("</Relationships>");
        let bytes = build_zip(&[(&source, "<w:hdr/>"), (&relationship_part, &relations)]);
        let archive = open_archive(&bytes);
        assert!(archive.is_ok(), "합성 긴 경로 패키지를 열 수 없습니다.");
        let Ok(mut archive) = archive else {
            return;
        };
        assert!(matches!(
            container::relationships(&mut archive, &source, &mut 0),
            Err(ExtractFailure::MemoryBudget)
        ));
    }

    /// 보조 위치 JSON은 이미 사용한 예산을 빼고 복사 전에 거절합니다.
    #[test]
    fn source_extract_tail_locator_requires_admission() {
        let bytes = build_zip(&[
            ("word/header.xml", "<w:hdr/>"),
            ("word/comments.xml", "<w:comments/>"),
            (
                "word/_rels/header.xml.rels",
                "<Relationships><Relationship Id='r' Target='comments.xml'/></Relationships>",
            ),
        ]);
        let archive = open_archive(&bytes);
        assert!(archive.is_ok(), "합성 보조 위치 패키지를 열 수 없습니다.");
        let Ok(mut archive) = archive else {
            return;
        };
        let mut document = ExtractedDocument::new();
        let links = container::package_links(&mut archive, &mut 0, &mut document);
        assert!(links.is_ok(), "작은 보조 원장을 만들 수 없습니다.");
        let Ok(links) = links else {
            return;
        };
        let remaining = usize::try_from(MAX_TOTAL_BYTES)
            .unwrap_or(0)
            .saturating_sub(1);
        assert!(matches!(
            container::part_locator("word/comments.xml", &links, remaining),
            Err(ExtractFailure::MemoryBudget)
        ));
        assert!(
            container::part_locator("word/comments.xml", &links, document.metadata_bytes).is_ok()
        );
    }

    /// 끝의 줄바꿈을 정규화해도 마지막 삽입과 연속 삽입은 원래 흐름을 유지합니다.
    #[test]
    fn source_extract_tail_altchunk_uses_stored_body_offsets() {
        for (body, expected) in [
            (
                "<w:p><w:r><w:t>A</w:t></w:r></w:p><w:altChunk r:id='b'/>",
                "A\n\nB",
            ),
            (
                "<w:p><w:t>A</w:t></w:p><w:altChunk r:id='b'/><w:altChunk r:id='c'/>",
                "A\n\nB\n\nC",
            ),
            ("<w:altChunk r:id='b'/>", "B"),
            (
                "<w:p><w:t>가🙂</w:t><w:br/><w:t>문장</w:t></w:p><w:altChunk r:id='b'/>",
                "가🙂\n문장\n\nB",
            ),
        ] {
            let document = format!("<w:document>{body}</w:document>");
            let extra = if body.contains("r:id='c'") {
                "<Relationship Id='c' Type='x/aFChunk' Target='c.txt'/>"
            } else {
                ""
            };
            let relations = format!(
                "<Relationships><Relationship Id='b' Type='x/aFChunk' Target='b.txt'/>{extra}</Relationships>"
            );
            let mut entries = vec![
                ("word/document.xml", document.as_str()),
                ("word/_rels/document.xml.rels", relations.as_str()),
                ("word/b.txt", "B"),
            ];
            if !extra.is_empty() {
                entries.push(("word/c.txt", "C"));
            }
            let value = extract("docx", &entries);
            assert_eq!(at(&value, "/ok"), true, "{value}");
            assert_eq!(text_of(&value), expected, "{value}");
            let expected_parts: &[&str] = if expected == "B" {
                &["word/b.txt"]
            } else if extra.is_empty() {
                &["word/document.xml", "word/b.txt"]
            } else {
                &["word/document.xml", "word/b.txt", "word/c.txt"]
            };
            assert_eq!(
                at(&value, "/segments").as_array().map(Vec::len),
                Some(expected_parts.len()),
                "{value}"
            );
            assert_eq!(expected.split("\n\n").count(), expected_parts.len());
            let mut line = 0usize;
            for (index, (source_part, fragment)) in expected_parts
                .iter()
                .zip(expected.split("\n\n"))
                .enumerate()
            {
                let prefix = format!("/segments/{index}");
                assert_eq!(
                    at(&value, &format!("{prefix}/sourcePart")),
                    *source_part,
                    "{value}"
                );
                assert_eq!(
                    at(&value, &format!("{prefix}/startLine")),
                    &JsonValue::from(line),
                    "{value}"
                );
                line += fragment.bytes().filter(|byte| *byte == b'\n').count();
                assert_eq!(
                    at(&value, &format!("{prefix}/endLine")),
                    &JsonValue::from(line),
                    "{value}"
                );
                line += 2;
            }
        }
    }

    /// 저장하지 않는 빈 표의 탭은 실제 삽입 위치에 포함하지 않습니다.
    #[test]
    fn source_extract_tail_empty_table_altchunk_uses_zero_offset() {
        let value = extract(
            "docx",
            &[
                (
                    "word/document.xml",
                    "<w:document><w:tbl><w:tr><w:tc/><w:tc/></w:tr></w:tbl><w:altChunk r:id='b'/></w:document>",
                ),
                (
                    "word/_rels/document.xml.rels",
                    "<Relationships><Relationship Id='b' Type='x/aFChunk' Target='b.txt'/></Relationships>",
                ),
                ("word/b.txt", "B"),
            ],
        );
        assert_eq!(at(&value, "/ok"), true, "{value}");
        assert_eq!(text_of(&value), "B", "{value}");
        assert_eq!(at(&value, "/segments").as_array().map(Vec::len), Some(1));
        assert_eq!(at(&value, "/segments/0/sourcePart"), "word/b.txt");
        assert_eq!(at(&value, "/segments/0/startLine"), 0);
        assert_eq!(at(&value, "/segments/0/endLine"), 0);
    }

    /// Office 사용자 속성의 이름과 문자열·숫자·배열 값은 실제 저장 근거입니다.
    #[test]
    fn source_extract_custom_properties_keep_names_and_typed_values() {
        let properties = "<Properties xmlns='http://schemas.openxmlformats.org/officeDocument/2006/custom-properties' xmlns:vt='http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'><property name='Decision' pid='2'><vt:lpwstr>stored-value</vt:lpwstr></property><property name='Threshold' pid='3'><vt:r8>27.5</vt:r8></property><property name='Choices' pid='4'><vt:vector size='2' baseType='lpwstr'><vt:lpwstr>first-marker</vt:lpwstr><vt:lpwstr>second-marker</vt:lpwstr></vt:vector></property><property name='Enabled' pid='5'><vt:bool>false</vt:bool></property><property name='Recorded' pid='6'><vt:filetime>2024-03-14T15:09:26Z</vt:filetime></property><property name='Spaced' pid='7'><vt:lpwstr>  padded  </vt:lpwstr></property><property name='Payload' pid='8'><vt:blob>binary-noise-marker</vt:blob></property></Properties>";
        for (extension, part, body) in [
            (
                "docx",
                "word/document.xml",
                "<w:document><w:p><w:t>main-body</w:t></w:p></w:document>",
            ),
            (
                "dotx",
                "word/document.xml",
                "<w:document><w:p><w:t>main-body</w:t></w:p></w:document>",
            ),
            (
                "pptx",
                "ppt/slides/slide1.xml",
                "<p:sld><a:t>main-body</a:t></p:sld>",
            ),
            (
                "potx",
                "ppt/slides/slide1.xml",
                "<p:sld><a:t>main-body</a:t></p:sld>",
            ),
            (
                "ppsx",
                "ppt/slides/slide1.xml",
                "<p:sld><a:t>main-body</a:t></p:sld>",
            ),
            (
                "xlsx",
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1' t='inlineStr'><is><t>main-body</t></is></c></row></worksheet>",
            ),
            (
                "xltx",
                "xl/worksheets/sheet1.xml",
                "<worksheet><row><c r='A1' t='inlineStr'><is><t>main-body</t></is></c></row></worksheet>",
            ),
        ] {
            let value = extract(
                extension,
                &[
                    (part, body),
                    ("docProps/custom.xml", properties),
                    (
                        "docProps/unrelated.xml",
                        "<Properties xmlns='urn:unrelated'><property name='unrelated-name'><lpwstr>unrelated-value</lpwstr></property></Properties>",
                    ),
                ],
            );
            assert_eq!(at(&value, "/ok"), true, "{extension}: {value}");
            let text = text_of(&value);
            for marker in [
                "main-body",
                "Decision",
                "stored-value",
                "Threshold",
                "27.5",
                "Choices",
                "first-marker",
                "second-marker",
                "Enabled",
                "false",
                "Recorded",
                "2024-03-14T15:09:26Z",
            ] {
                assert!(
                    text.contains(marker),
                    "{extension}: missing {marker}: {value}"
                );
            }
            let separator = if matches!(extension, "docx" | "dotx") {
                "\n\n"
            } else {
                "\n"
            };
            assert!(
                text.contains(&format!("first-marker{separator}second-marker")),
                "{extension}: {value}"
            );
            assert!(
                text.contains("Spaced:   padded  \n"),
                "{extension}: {value}"
            );
            assert!(!text.contains("unrelated-value"), "{extension}: {value}");
            assert!(!text.contains("unrelated-name"), "{extension}: {value}");
            assert!(
                !text.contains("binary-noise-marker"),
                "{extension}: {value}"
            );
            assert!(
                at(&value, "/segments")
                    .as_array()
                    .is_some_and(|segments| segments
                        .iter()
                        .any(|segment| at(segment, "/sourcePart") == "docProps/custom.xml")),
                "{extension}: {value}"
            );
        }
    }

    /// 빈 시트만 있어도 원장은 성공으로 보존하고 인용 본문은 만들지 않습니다.
    #[test]
    fn source_extract_metadata_only_workbook_is_not_empty_failure() {
        for extension in ["xlsx", "xltx"] {
            let value = extract(
                extension,
                &[
                    (
                        "xl/workbook.xml",
                        "<workbook><sheets><sheet name='Empty Ledger' r:id='s'/></sheets></workbook>",
                    ),
                    (
                        "xl/_rels/workbook.xml.rels",
                        "<Relationships><Relationship Id='s' Target='worksheets/sheet1.xml'/></Relationships>",
                    ),
                    (
                        "xl/worksheets/sheet1.xml",
                        "<worksheet><sheetData/></worksheet>",
                    ),
                ],
            );
            assert_eq!(at(&value, "/ok"), true, "{extension}: {value}");
            assert_eq!(text_of(&value), "");
            assert_eq!(at(&value, "/segments").as_array().map(Vec::len), Some(0));
            assert_eq!(
                at(&value, "/metadataParts").as_array().map(Vec::len),
                Some(1)
            );
            assert_eq!(at(&value, "/metadataParts/0/label"), "Empty Ledger");
            assert_eq!(
                at(&value, "/metadataParts/0/sourcePart"),
                "xl/worksheets/sheet1.xml"
            );
            assert!(at(&value, "/metadataParts/0").get("startLine").is_none());
            assert!(at(&value, "/metadataParts/0").get("endLine").is_none());
        }
    }

    /// 추출 지원 확장자 목록이 호스트 라우팅 계약과 일치합니다.
    ///
    /// `pdf`는 RAG 후보 판정에는 포함되지만 본문은 전용 TS worker가 만들기 때문에
    /// 이 코어의 추출기는 여전히 `unsupported`로 답해야 합니다.
    #[test]
    fn reports_supported_extensions() {
        for extension in [
            "epub", "docx", "dotx", "odt", "odp", "ods", "pptx", "potx", "ppsx", "xlsx", "xltx",
            "hwpx", "pdf",
        ] {
            assert!(
                is_extractable_source_extension(extension),
                "supported extension"
            );
        }
        for extension in ["zip", "png", "mp3", "md"] {
            assert!(
                !is_extractable_source_extension(extension),
                "unsupported extension"
            );
        }
        let value = extract_failure("pdf", b"%PDF-1.4");
        assert_eq!(
            value.get("ok").and_then(JsonValue::as_bool),
            Some(false),
            "pdf body stays out of the wasm core"
        );
        assert_eq!(
            value.get("reason").and_then(JsonValue::as_str),
            Some("unsupported"),
            "pdf reason code"
        );
    }
}
