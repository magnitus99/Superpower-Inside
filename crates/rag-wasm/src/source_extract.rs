//! 압축 텍스트 문서에서 검색 가능한 본문을 결정적으로 추출합니다.
//!
//! 지원 대상은 `EPUB`, `DOCX`, `ODT`, `PPTX`, `XLSX`, `HWPX`입니다. PDF는 같은
//! 계약을 따르는 별도 TS worker가 추출하므로 여기서는 다루지 않습니다. 이미지·동영상·
//! 오디오와 임의 압축 파일은 추출하지 않습니다. 압축 해제 크기와 엔트리 수를 제한해
//! 신뢰할 수 없는 볼트 파일이 메모리를 고갈시키지 않도록 합니다.

use crate::JsonValue;
use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use std::io::{Cursor, Read};
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
}

impl ExtractedDocument {
    /// 빈 문서를 만듭니다.
    const fn new() -> Self {
        Self {
            text: String::new(),
            segments: Vec::new(),
        }
    }

    /// 현재 줄 수를 셉니다. 빈 본문은 `0`입니다.
    fn line_count(&self) -> usize {
        if self.text.is_empty() {
            0
        } else {
            self.text.matches('\n').count().saturating_add(1)
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
        }
        let start_line = self.line_count();
        self.text.push_str(trimmed);
        let end_line = self.line_count().saturating_sub(1);
        if self.segments.len() < MAX_SEGMENTS {
            self.segments.push(ExtractedSegment {
                label: label.to_owned(),
                start_line,
                end_line,
            });
        }
    }

    /// 텍스트 상한을 넘겼는지 확인합니다.
    fn conflicted(&self) -> bool {
        self.text.chars().count() >= MAX_TEXT_CHARS
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
    let file = archive
        .by_index(index)
        .map_err(|_| ExtractFailure::Corrupt)?;
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

/// `XLSX` 시트 값을 추출합니다.
fn extract_xlsx(bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0u64;
    let shared = read_entry(&mut archive, "xl/sharedStrings.xml", &mut budget)?
        .map(|xml| collect_shared_strings(&xml))
        .unwrap_or_default();
    let names = sorted_entry_names(&archive, "xl/worksheets/sheet", ".xml");
    let mut document = ExtractedDocument::new();
    for (number, name) in names {
        if document.conflicted() {
            break;
        }
        let Some(sheet) = read_entry(&mut archive, &name, &mut budget)? else {
            continue;
        };
        let rows = collect_sheet_rows(&sheet, &shared);
        document.push_segment(&format!("Sheet {number}"), &rows.join("\n"));
    }
    finish_document(document)
}

/// `XLSX` 공유 문자열 테이블을 읽습니다.
fn collect_shared_strings(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut strings = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    let mut in_text = false;
    loop {
        buffer.clear();
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event) | Event::Empty(event)) => match event.name().as_ref() {
                "si" => {
                    in_item = true;
                    current.clear();
                }
                "t" => in_text = true,
                _ => {}
            },
            Ok(Event::End(event)) => match event.name().as_ref() {
                "si" => {
                    in_item = false;
                    strings.push(current.trim().to_owned());
                }
                "t" => in_text = false,
                _ => {}
            },
            Ok(event) if is_text_event(&event) => {
                if in_item && in_text && current.chars().count() < MAX_PARAGRAPH_CHARS {
                    current.push_str(&event_text(&event).unwrap_or_default());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    strings
}

/// `XLSX` 워크시트의 행별 값을 읽습니다.
fn collect_sheet_rows(xml: &str, shared: &[String]) -> Vec<String> {
    let mut reader = Reader::from_reader(Cursor::new(xml.as_bytes()));
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut rows = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut cell_is_shared = false;
    let mut in_value = false;
    let mut in_text = false;
    let mut in_cell = false;
    loop {
        buffer.clear();
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event) | Event::Empty(event)) => match event.name().as_ref() {
                "row" => row.clear(),
                "c" => {
                    in_cell = true;
                    current.clear();
                    cell_is_shared = false;
                    for attribute in event.attributes().flatten() {
                        if attribute.key.as_ref() == "t" && attribute.value.as_ref() == "s" {
                            cell_is_shared = true;
                        }
                    }
                }
                "v" => in_value = true,
                "t" => in_text = true,
                _ => {}
            },
            Ok(Event::End(event)) => match event.name().as_ref() {
                "row" => {
                    if !row.is_empty() {
                        rows.push(row.join("\t"));
                    }
                    row.clear();
                }
                "c" => {
                    in_cell = false;
                    let value = current.trim();
                    if !value.is_empty() {
                        let resolved = if cell_is_shared {
                            value
                                .parse::<usize>()
                                .ok()
                                .and_then(|index| shared.get(index))
                                .cloned()
                        } else {
                            Some(value.to_owned())
                        };
                        if let Some(resolved) = resolved {
                            row.push(resolved);
                        }
                    }
                }
                "v" => in_value = false,
                "t" => in_text = false,
                _ => {}
            },
            Ok(event) if is_text_event(&event) => {
                if !in_cell {
                    continue;
                }
                if in_text || in_value {
                    current.push_str(&event_text(&event).unwrap_or_default());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    if !row.is_empty() {
        rows.push(row.join("\t"));
    }
    rows
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
