//! 압축 텍스트 문서에서 검색 가능한 본문을 결정적으로 추출합니다.
//!
//! 지원 대상은 `EPUB`, `DOCX`, `ODT`, `PPTX`, `XLSX`, `HWPX`입니다. PDF는 같은
//! 계약을 따르는 별도 TS worker가 추출하므로 여기서는 다루지 않습니다. 이미지·동영상·
//! 오디오와 임의 압축 파일은 추출하지 않습니다. 압축 해제 크기와 엔트리 수를 제한해
//! 신뢰할 수 없는 볼트 파일이 메모리를 고갈시키지 않도록 합니다.

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
struct ExtractedSegment {
    /// 사람이 읽는 구간 라벨입니다.
    label: String,
    /// 추출 텍스트 기준 시작 줄입니다. `0`부터 셉니다.
    start_line: usize,
    /// 추출 텍스트 기준 마지막 줄입니다.
    end_line: usize,
}

/// 추출된 본문과 구간 경계입니다.
struct ExtractedDocument {
    /// 정규화된 본문입니다.
    text: String,
    /// 구간 목록입니다.
    segments: Vec<ExtractedSegment>,
    /// 구간 추가 경로의 문자 누계입니다. XLSX는 별도 스트리밍 예산을 씁니다.
    text_chars: usize,
    /// 구간 추가 시 다음 본문이 시작할 0 기반 줄입니다.
    next_line: usize,
}

impl ExtractedDocument {
    /// 빈 문서를 만듭니다.
    const fn new() -> Self {
        Self {
            text: String::new(),
            segments: Vec::new(),
            text_chars: 0,
            next_line: 0,
        }
    }

    /// 하나의 구간을 본문에 추가합니다.
    fn push_segment(&mut self, label: &str, body: &str) {
        let trimmed = body.trim();
        if trimmed.is_empty() || self.conflicted() {
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
            });
        }
    }

    /// 텍스트 상한을 넘겼는지 확인합니다.
    const fn conflicted(&self) -> bool {
        self.text_chars >= MAX_TEXT_CHARS
    }

    /// 구간 목록을 JSON 배열로 만듭니다.
    fn segments_json(&self) -> Vec<JsonValue> {
        self.segments
            .iter()
            .map(|segment| {
                serde_json::json!({
                    "label": segment.label,
                    "startLine": segment.start_line,
                    "endLine": segment.end_line,
                })
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
        "epub" | "docx" | "odt" | "pptx" | "xlsx" | "hwpx" | "pdf"
    )
}

/// 확장자에 맞는 추출기를 실행하고 결과를 JSON으로 반환합니다.
#[must_use]
#[wasm_bindgen]
pub fn extract_source_text_json(extension: &str, bytes: &[u8]) -> String {
    let normalized = normalize_extension(extension);
    // PDF 본문은 이 코어가 아니라 전용 TS worker가 만듭니다.
    let result = match normalized.as_str() {
        "epub" => extract_epub(bytes),
        "docx" => extract_docx(bytes),
        "odt" => extract_odt(bytes),
        "pptx" => extract_pptx(bytes),
        "xlsx" => extract_xlsx(bytes),
        "hwpx" => extract_hwpx(bytes),
        _ => Err(ExtractFailure::Unsupported),
    };
    match result {
        Ok(document) => serde_json::json!({
            "ok": true,
            "format": normalized,
            "text": document.text,
            "segments": document.segments_json(),
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
    let mut raw = Vec::new();
    let mut limited = file.take(size.saturating_add(1));
    limited
        .read_to_end(&mut raw)
        .map_err(|_| ExtractFailure::Corrupt)?;
    *budget = budget.saturating_add(raw.len().try_into().unwrap_or(u64::MAX));
    if *budget > MAX_TOTAL_BYTES {
        return Err(ExtractFailure::TooLarge);
    }
    Ok(Some(String::from_utf8_lossy(&raw).into_owned()))
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

/// XML 문자열에서 지정한 문단 태그 사이의 텍스트를 뽑아냅니다.
fn collect_paragraphs(xml: &str, paragraph_tags: &[&str], text_tags: &[&str]) -> Vec<String> {
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    let mut paragraph_depth = 0usize;
    let mut text_depth = 0usize;
    loop {
        buffer.clear();
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event) | Event::Empty(event)) => {
                let name = event.name();
                let raw = name.as_ref();
                if paragraph_tags.contains(&raw) {
                    paragraph_depth = paragraph_depth.saturating_add(1);
                } else if text_tags.contains(&raw) {
                    text_depth = text_depth.saturating_add(1);
                }
            }
            Ok(Event::End(event)) => {
                let name = event.name();
                let raw = name.as_ref();
                if paragraph_tags.contains(&raw) {
                    paragraph_depth = paragraph_depth.saturating_sub(1);
                    if paragraph_depth == 0 {
                        push_paragraph(&mut paragraphs, &mut current);
                    }
                } else if text_tags.contains(&raw) {
                    text_depth = text_depth.saturating_sub(1);
                }
            }
            Ok(event) if is_text_event(&event) => {
                let captures = text_tags.is_empty() || text_depth > 0;
                if paragraph_depth > 0 && captures && current.chars().count() < MAX_PARAGRAPH_CHARS
                {
                    current.push_str(&event_text(&event).unwrap_or_default());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    if !current.trim().is_empty() {
        push_paragraph(&mut paragraphs, &mut current);
    }
    paragraphs
}

/// 텍스트 또는 CDATA 이벤트인지 확인합니다.
const fn is_text_event(event: &Event<'_>) -> bool {
    matches!(event, Event::Text(_) | Event::CData(_))
}

/// 텍스트 또는 CDATA 이벤트의 내용을 반환합니다.
fn event_text(event: &Event<'_>) -> Option<String> {
    match event {
        Event::Text(text) => Some(text.xml_content(XmlVersion::Implicit1_0).into_owned()),
        Event::CData(data) => Some(data.xml_content(XmlVersion::Implicit1_0).into_owned()),
        _ => None,
    }
}

/// 문단 하나를 목록에 확정합니다.
fn push_paragraph(paragraphs: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim();
    if !trimmed.is_empty() && paragraphs.len() < MAX_SEGMENTS {
        paragraphs.push(trimmed.to_owned());
    }
    current.clear();
}

/// OPF 매니페스트와 스파인 정보입니다.
struct EpubPackage {
    /// 매니페스트의 `id` → `href` 매핑입니다.
    manifest: Vec<(String, String)>,
    /// 스파인 순서의 매니페스트 `id` 목록입니다.
    spine: Vec<String>,
}

/// OPF 문서에서 매니페스트와 스파인을 읽습니다.
fn parse_opus_package(xml: &str) -> EpubPackage {
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut manifest = Vec::new();
    let mut spine = Vec::new();
    loop {
        buffer.clear();
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event) | Event::Empty(event)) => {
                let name = event.name();
                match name.as_ref() {
                    "item" => {
                        let mut id = String::new();
                        let mut href = String::new();
                        for attribute in event.attributes().flatten() {
                            let value = attribute
                                .normalized_value(XmlVersion::Implicit1_0)
                                .unwrap_or_default()
                                .into_owned();
                            match attribute.key.as_ref() {
                                "id" => id = value,
                                "href" => href = value,
                                _ => {}
                            }
                        }
                        if !id.is_empty() && !href.is_empty() {
                            manifest.push((id, href));
                        }
                    }
                    "itemref" => {
                        for attribute in event.attributes().flatten() {
                            if attribute.key.as_ref() == "idref" {
                                let value = attribute
                                    .normalized_value(XmlVersion::Implicit1_0)
                                    .unwrap_or_default()
                                    .into_owned();
                                if !value.is_empty() {
                                    spine.push(value);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    EpubPackage { manifest, spine }
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

/// `EPUB`의 스파인 순서대로 챕터 텍스트를 추출합니다.
fn extract_epub(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0u64;
    let container = read_entry(&mut archive, "META-INF/container.xml", &mut budget)?
        .ok_or(ExtractFailure::Corrupt)?;
    let package_path =
        find_attribute(&container, "rootfile", "full-path").ok_or(ExtractFailure::Corrupt)?;
    let package =
        read_entry(&mut archive, &package_path, &mut budget)?.ok_or(ExtractFailure::Corrupt)?;
    let parsed = parse_opus_package(&package);
    if parsed.spine.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    let mut document = ExtractedDocument::new();
    for identifier in &parsed.spine {
        if document.conflicted() {
            break;
        }
        let Some((_, href)) = parsed.manifest.iter().find(|(id, _)| id == identifier) else {
            continue;
        };
        let path = resolve_path(&package_path, href);
        let Some(chapter) = read_entry(&mut archive, &path, &mut budget)? else {
            continue;
        };
        let label = chapter_label(&chapter)
            .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(&path).to_owned());
        let body = collect_paragraphs(
            &chapter,
            &["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "div"],
            &[],
        )
        .join("\n\n");
        document.push_segment(&label, &body);
    }
    if document.text.trim().is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(document)
}

/// XHTML 문서의 제목 후보를 찾습니다.
fn chapter_label(xhtml: &str) -> Option<String> {
    let mut reader = Reader::from_reader(Cursor::new(xhtml.as_bytes()));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut in_title = false;
    let mut title = String::new();
    let mut in_heading = false;
    let mut heading = String::new();
    loop {
        buffer.clear();
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event) | Event::Empty(event)) => match event.name().as_ref() {
                "title" => in_title = true,
                "h1" | "h2" => in_heading = true,
                _ => {}
            },
            Ok(Event::End(event)) => match event.name().as_ref() {
                "title" => in_title = false,
                "h1" | "h2" => in_heading = false,
                _ => {}
            },
            Ok(event) if is_text_event(&event) => {
                let content = event_text(&event).unwrap_or_default();
                if in_title {
                    title.push_str(&content);
                } else if in_heading && heading.chars().count() < MAX_PARAGRAPH_CHARS {
                    heading.push_str(&content);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    let heading = heading.trim();
    if !heading.is_empty() {
        return Some(heading.to_owned());
    }
    let title = title.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_owned())
    }
}

/// `DOCX` 본문 문단을 추출합니다.
fn extract_docx(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0u64;
    let document_xml = read_entry(&mut archive, "word/document.xml", &mut budget)?
        .ok_or(ExtractFailure::Corrupt)?;
    let paragraphs = collect_paragraphs(&document_xml, &["w:p"], &["w:t"]);
    finish_single_segment(&paragraphs, "Document")
}

/// `ODT` 본문 문단을 추출합니다.
fn extract_odt(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0u64;
    let content_xml =
        read_entry(&mut archive, "content.xml", &mut budget)?.ok_or(ExtractFailure::Corrupt)?;
    let paragraphs = collect_paragraphs(&content_xml, &["text:p", "text:h"], &[]);
    finish_single_segment(&paragraphs, "Document")
}

/// `HWPX` 본문 문단을 추출합니다.
fn extract_hwpx(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0u64;
    let names = sorted_entry_names(&archive, "Contents/section", ".xml");
    let mut document = ExtractedDocument::new();
    for (_, name) in names {
        if document.conflicted() {
            break;
        }
        let Some(section) = read_entry(&mut archive, &name, &mut budget)? else {
            continue;
        };
        let paragraphs = collect_paragraphs(&section, &["hp:p"], &["hp:t"]);
        document.push_segment(&name, &paragraphs.join("\n\n"));
    }
    finish_document(document)
}

/// `PPTX` 슬라이드 텍스트를 추출합니다.
fn extract_pptx(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0u64;
    let names = sorted_entry_names(&archive, "ppt/slides/slide", ".xml");
    let mut document = ExtractedDocument::new();
    for (number, name) in names {
        if document.conflicted() {
            break;
        }
        let Some(slide) = read_entry(&mut archive, &name, &mut budget)? else {
            continue;
        };
        let paragraphs = collect_paragraphs(&slide, &["a:p"], &["a:t"]);
        document.push_segment(&format!("Slide {number}"), &paragraphs.join("\n"));
    }
    finish_document(document)
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
            result: extract_xlsx(bytes),
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
    match event {
        Event::Start(_) => {
            *depth = depth.saturating_add(1);
            if *depth > XLSX_XML_DEPTH {
                return Err(ExtractFailure::XmlTokenBudget);
            }
        }
        Event::End(_) => *depth = depth.checked_sub(1).ok_or(ExtractFailure::Corrupt)?,
        Event::Eof if *depth != 0 => return Err(ExtractFailure::Corrupt),
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
            Event::Start(event) => match event.name().as_ref() {
                "si" => {
                    in_item = true;
                    current.clear();
                }
                "t" => in_text = true,
                _ => {}
            },
            Event::Empty(event) if event.name().as_ref() == "si" => {
                push_xlsx_string(&mut strings, budget, &mut text_bytes, String::new())?;
            }
            Event::End(event) => match event.name().as_ref() {
                "si" => {
                    in_item = false;
                    let value = current.trim().to_owned();
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

/// 행 목록을 쌓지 않고 각 셀을 최종 본문에 바로 붙입니다.
fn read_xlsx_sheet<R: Read>(
    reader: &mut Reader<BufReader<XlsxEventReader<R>>>,
    shared: &[String],
    budget: &XlsxBudget,
    document: &mut ExtractedDocument,
    label: &str,
    line: &mut usize,
) -> Result<(), ExtractFailure> {
    let mut buffer = Vec::new();
    let mut current = String::new();
    let mut depth = 0;
    let mut in_cell = false;
    let mut in_value = false;
    let mut in_text = false;
    let mut cell_is_shared = false;
    let mut row_started = false;
    let mut sheet_started = false;
    let mut start_line = 0;
    loop {
        match xlsx_event(reader, &mut buffer, &mut depth)? {
            Event::Start(event) => match event.name().as_ref() {
                "row" => row_started = false,
                "c" => {
                    in_cell = true;
                    current.clear();
                    cell_is_shared = event.attributes().any(|attribute| {
                        attribute.is_ok_and(|attribute| {
                            attribute.key.as_ref() == "t" && attribute.value.as_ref() == "s"
                        })
                    });
                }
                "v" => in_value = true,
                "t" => in_text = true,
                _ => {}
            },
            Event::End(event) => match event.name().as_ref() {
                "c" => {
                    in_cell = false;
                    let value = if cell_is_shared {
                        current
                            .trim()
                            .parse::<usize>()
                            .ok()
                            .and_then(|index| shared.get(index))
                            .map_or("", String::as_str)
                    } else {
                        current.trim()
                    };
                    if !value.is_empty() {
                        if !sheet_started {
                            if !document.text.is_empty() {
                                budget.append(&mut document.text, "\n\n")?;
                                *line = line.saturating_add(2);
                            }
                            start_line = *line;
                            sheet_started = true;
                        } else if !row_started {
                            budget.append(&mut document.text, "\n")?;
                            *line = line.saturating_add(1);
                        }
                        if row_started {
                            budget.append(&mut document.text, "\t")?;
                        }
                        budget.append(&mut document.text, value)?;
                        *line = line
                            .saturating_add(value.bytes().filter(|byte| *byte == b'\n').count());
                        row_started = true;
                    }
                }
                "v" => in_value = false,
                "t" => in_text = false,
                _ => {}
            },
            Event::Eof => break,
            event if in_cell && (in_text || in_value) => append_xlsx_event(&mut current, &event)?,
            _ => {}
        }
    }
    if sheet_started {
        document.segments.push(ExtractedSegment {
            label: label.to_owned(),
            start_line,
            end_line: *line,
        });
    }
    Ok(())
}

/// XLSX의 원본·공유 문자열·최종 본문이 작업 예산 안에 있는지 확인합니다.
fn extract_xlsx(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    extract_xlsx_with_budget(bytes, XLSX_MEMORY_BYTES)
}

/// 낮은 예산의 실패를 합성 데이터로 검증하는 공통 추출 경로입니다.
fn extract_xlsx_with_budget(
    bytes: &[u8],
    memory_bytes: usize,
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
    let shared = read_xlsx_strings(&mut archive, &mut budget)?;
    let names = sorted_entry_names(&archive, "xl/worksheets/sheet", ".xml");
    let mut document = ExtractedDocument::new();
    let mut line = 0;
    for (number, name) in names {
        let Some(mut reader) = xlsx_reader(&mut archive, &name)? else {
            continue;
        };
        read_xlsx_sheet(
            &mut reader,
            &shared,
            &budget,
            &mut document,
            &format!("Sheet {number}"),
            &mut line,
        )?;
    }
    if document.text.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(document)
}

/// 단일 세그먼트 문서로 마무리합니다.
fn finish_single_segment(
    paragraphs: &[String],
    label: &str,
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut document = ExtractedDocument::new();
    document.push_segment(label, &paragraphs.join("\n\n"));
    finish_document(document)
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

/// XML 문자열에서 특정 태그의 속성 값을 찾습니다.
fn find_attribute(xml: &str, tag: &str, key: &str) -> Option<String> {
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event) | Event::Empty(event)) => {
                if event.name().as_ref() == tag {
                    for attribute in event.attributes().flatten() {
                        if attribute.key.as_ref() == key {
                            return Some(
                                attribute
                                    .normalized_value(XmlVersion::Implicit1_0)
                                    .unwrap_or_default()
                                    .into_owned(),
                            );
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
            .map(|segments| {
                segments
                    .iter()
                    .filter_map(|segment| segment.get("label").and_then(JsonValue::as_str))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
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
        let result = extract_xlsx_with_budget(&bytes, limit);
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
            ("odt", "corrupt"),
            ("pptx", "empty"),
            ("xlsx", "empty"),
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

    /// 숫자 순서로 여러 시트를 읽고 문자열·수식 캐시·다국어 값을 보존합니다.
    #[test]
    fn extracts_xlsx_cell_types_and_numeric_sheet_order() {
        let first = r#"<worksheet><row><c t="inlineStr"><is><t>한글 Alpha</t></is></c><c><f>20+22</f><v>42</v></c><c t="b"><v>1</v></c></row></worksheet>"#;
        let second =
            r#"<worksheet><row><c t="s"><v>0</v></c><c t="s"><v>999</v></c></row></worksheet>"#;
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
            "한글 Alpha\t42\t1\n\nBeta 世界",
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

    /// 추출 지원 확장자 목록이 호스트 라우팅 계약과 일치합니다.
    ///
    /// `pdf`는 RAG 후보 판정에는 포함되지만 본문은 전용 TS worker가 만들기 때문에
    /// 이 코어의 추출기는 여전히 `unsupported`로 답해야 합니다.
    #[test]
    fn reports_supported_extensions() {
        for extension in ["epub", "docx", "odt", "pptx", "xlsx", "hwpx", "pdf"] {
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
