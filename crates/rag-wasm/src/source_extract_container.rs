//! 유한 XML 트리와 패키지 part 순회로 저장된 검색 근거를 보존합니다.

use super::{
    ExtractFailure, ExtractedDocument, MAX_PARAGRAPH_CHARS, MAX_TEXT_CHARS, MAX_TOTAL_BYTES,
    XlsxEventReader, append_xlsx_event, finish_document, open_archive, read_entry, resolve_path,
    sorted_entry_names, xlsx_event,
};
use crate::JsonValue;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use std::collections::{BTreeMap, HashSet};
use std::io::{BufReader, Cursor};
use zip::ZipArchive;

/// Office 사용자 속성의 저장 값 형식 namespace입니다.
const PROPERTY_TYPES_NAMESPACE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";

/// 텍스트도 자식으로 보관해 인라인·중첩 각주의 순서를 보존합니다.
#[derive(Default)]
pub(super) struct Node {
    /// 접두사를 포함한 태그 이름입니다.
    name: String,
    /// 선언된 요소 namespace입니다.
    namespace: String,
    /// 실제 ODF text:c 속성입니다.
    space_count: Option<String>,
    /// 엄격하게 해석한 속성입니다.
    attrs: Vec<(String, String)>,
    /// 원문 순서의 자식입니다.
    children: Vec<Self>,
    /// 텍스트 노드의 내용입니다.
    text: String,
}

impl Node {
    /// 전체 XML 스키마 검증 대신 주 part의 루트만 확인합니다.
    pub(super) fn has_root(&self, expected: &str) -> bool {
        self.children
            .iter()
            .find(|n| !n.name.is_empty())
            .is_some_and(|n| n.local() == expected)
    }

    /// 네임스페이스 접두사를 제외한 이름입니다.
    fn local(&self) -> &str {
        self.name.rsplit(':').next().unwrap_or(&self.name)
    }

    /// 저장 문단·목록·서지 항목의 경계입니다.
    fn is_paragraph(&self) -> bool {
        matches!(
            self.local(),
            "p" | "h"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "li"
                | "aside"
                | "div"
                | "blockquote"
                | "pre"
                | "title"
                | "creator"
                | "description"
                | "subject"
                | "publisher"
                | "language"
                | "identifier"
                | "meta"
                | "v"
                | "f"
                | "definedName"
                | "equation"
        )
    }

    /// 중첩 각주와 표도 본문 단어에 합쳐지지 않게 구분합니다.
    fn is_separate_block(&self) -> bool {
        self.is_paragraph()
            || matches!(
                self.local(),
                "tbl"
                    | "table"
                    | "footnote"
                    | "endnote"
                    | "footNote"
                    | "endNote"
                    | "note"
                    | "annotation"
            )
    }

    /// OOXML에서 검색 가능한 저장 텍스트 요소입니다.
    fn is_text_leaf(&self) -> bool {
        matches!(
            self.local(),
            "t" | "instrText"
                | "delText"
                | "text"
                | "v"
                | "f"
                | "formula"
                | "title"
                | "desc"
                | "definedName"
                | "oddHeader"
                | "oddFooter"
                | "evenHeader"
                | "evenFooter"
                | "firstHeader"
                | "firstFooter"
                | "creator"
                | "subject"
                | "keywords"
                | "description"
                | "equation"
                | "textbox"
                | "textpath"
        )
    }

    /// 벡터 컨테이너와 달리 하나의 저장 값인 요소입니다.
    fn is_property_value(&self) -> bool {
        self.namespace == PROPERTY_TYPES_NAMESPACE
            && self.children.iter().all(|child| child.name.is_empty())
    }

    /// 정확한 속성 이름으로 값을 읽습니다.
    pub(super) fn attr(&self, key: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(name, _)| name == key)
            .or_else(|| {
                key.contains(':')
                    .then(|| {
                        self.attrs.iter().find(|(name, _)| {
                            name.contains(':') && name.rsplit(':').next() == key.rsplit(':').next()
                        })
                    })
                    .flatten()
            })
            .map(|(_, value)| value.as_str())
    }

    /// 같은 로컬 이름의 하위 요소를 원문 순서로 모읍니다.
    pub(super) fn descendants<'a>(&'a self, name: &str, output: &mut Vec<&'a Self>) {
        for child in &self.children {
            if child.local() == name {
                output.push(child);
            }
            child.descendants(name, output);
        }
    }

    /// 셀 속성용 하위 요소를 찾되 중첩 표 속성은 섞지 않습니다.
    fn property(&self, name: &str, attribute: &str) -> Option<&str> {
        for child in &self.children {
            if child.local() == name {
                return child.attr(attribute);
            }
            if !matches!(child.local(), "tbl" | "table")
                && let Some(value) = child.property(name, attribute)
            {
                return Some(value);
            }
        }
        None
    }

    /// 처리한 페이지·시트를 제외한 저장 텍스트도 별도 보존합니다.
    fn remove_units(&mut self, name: &str) {
        self.children.retain(|child| child.local() != name);
        for child in &mut self.children {
            child.remove_units(name);
        }
    }

    /// 하위 저장 텍스트를 원문 순서로 읽습니다.
    fn plain_text(&self) -> String {
        let mut text = self.text.clone();
        for child in &self.children {
            text.push_str(&child.plain_text());
        }
        text
    }
}

/// 속성 오류와 중복을 무시하지 않습니다.
fn element(event: &BytesStart<'_>, stack: &[Node]) -> Result<Node, ExtractFailure> {
    let mut node = Node {
        name: event.name().as_ref().to_owned(),
        ..Node::default()
    };
    for attribute in event.attributes() {
        let attribute = attribute.map_err(|_| ExtractFailure::Corrupt)?;
        let value = attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|_| ExtractFailure::Corrupt)?;
        node.attrs
            .push((attribute.key.as_ref().to_owned(), value.into_owned()));
    }
    let binding = |prefix: &str| {
        let key = if prefix.is_empty() {
            "xmlns".to_owned()
        } else {
            format!("xmlns:{prefix}")
        };
        node.attrs
            .iter()
            .chain(stack.iter().rev().flat_map(|n| n.attrs.iter()))
            .find(|(name, _)| name == &key)
            .map(|(_, value)| value.clone())
            .unwrap_or_default()
    };
    node.namespace = binding(node.name.split_once(':').map_or("", |(prefix, _)| prefix));
    node.space_count = node
        .attrs
        .iter()
        .find(|(name, _)| {
            name.split_once(':').is_some_and(|(prefix, local)| {
                local == "c" && binding(prefix) == "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
            })
        })
        .map(|(_, value)| value.clone());
    Ok(node)
}

/// XLSX와 같은 토큰·깊이 한도와 별도 트리 할당 예산을 적용합니다.
pub(super) fn parse(xml: &str) -> Result<Node, ExtractFailure> {
    let mut reader = Reader::from_reader(BufReader::new(XlsxEventReader {
        inner: Cursor::new(xml.as_bytes()),
        event_bytes: 0,
        roots: 0,
        html_doctype: true,
    }));
    let mut buffer = Vec::new();
    let mut depth = 0;
    let mut stack = vec![Node::default()];
    let mut allocated = xml.len().saturating_mul(2);
    let mut roots = 0usize;
    loop {
        let event = xlsx_event(&mut reader, &mut buffer, &mut depth)?;
        allocated = allocated
            .saturating_add(event.as_ref().len().saturating_mul(2))
            .saturating_add(256);
        if allocated > usize::try_from(MAX_TOTAL_BYTES).unwrap_or(usize::MAX) {
            return Err(ExtractFailure::MemoryBudget);
        }
        match event {
            Event::Start(event) => {
                if stack.len() == 1 {
                    roots = roots.saturating_add(1);
                }
                stack.push(element(&event, &stack)?);
            }
            Event::Empty(event) => {
                if stack.len() == 1 {
                    roots = roots.saturating_add(1);
                }
                let node = element(&event, &stack)?;
                stack
                    .last_mut()
                    .ok_or(ExtractFailure::Corrupt)?
                    .children
                    .push(node);
            }
            Event::End(_) => {
                let node = stack.pop().ok_or(ExtractFailure::Corrupt)?;
                stack
                    .last_mut()
                    .ok_or(ExtractFailure::Corrupt)?
                    .children
                    .push(node);
            }
            Event::Eof => break,
            Event::Text(_) | Event::CData(_) | Event::GeneralRef(_) => {
                let mut node = Node::default();
                append_xlsx_event(&mut node.text, &event)?;
                if stack.len() == 1 && !node.text.trim().is_empty() {
                    return Err(ExtractFailure::Corrupt);
                }
                stack
                    .last_mut()
                    .ok_or(ExtractFailure::Corrupt)?
                    .children
                    .push(node);
            }
            _ => {}
        }
    }
    if roots != 1 || stack.len() != 1 {
        return Err(ExtractFailure::Corrupt);
    }
    stack.pop().ok_or(ExtractFailure::Corrupt)
}

/// part를 한 번씩 읽고 손상된 보조 part를 성공으로 숨기지 않습니다.
fn required_part(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    budget: &mut u64,
) -> Result<Node, ExtractFailure> {
    let xml = read_entry(archive, name, budget)?.ok_or(ExtractFailure::Corrupt)?;
    if name.to_ascii_lowercase().ends_with(".txt") {
        return Ok(Node {
            text: xml,
            ..Node::default()
        });
    }
    parse(&xml)
}

/// 외부 URI를 ZIP 내부 참조로 해석하지 않습니다.
pub(super) fn internal_target(base: &str, href: &str) -> Result<String, ExtractFailure> {
    let path = href
        .split('#')
        .next()
        .unwrap_or(href)
        .split('?')
        .next()
        .unwrap_or(href);
    if path.contains(':') || path.starts_with("//") || path.contains('\\') {
        return Err(ExtractFailure::Corrupt);
    }
    Ok(if path.is_empty() {
        base.to_owned()
    } else {
        resolve_path(base, path)
    })
}

/// 관계 ID와 내부 part의 대응이며 외부 관계 I/O는 없습니다.
pub(super) fn relationships(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    base: &str,
    budget: &mut u64,
) -> Result<Vec<(String, String)>, ExtractFailure> {
    let (directory, file) = base.rsplit_once('/').unwrap_or(("", base));
    let rels = if directory.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{directory}/_rels/{file}.rels")
    };
    let Some(xml) = read_entry(archive, &rels, budget)? else {
        return Ok(Vec::new());
    };
    let tree = parse(&xml)?;
    let mut nodes = Vec::new();
    tree.descendants("Relationship", &mut nodes);
    let mut result = Vec::new();
    let mut reference_bytes = 0;
    for node in nodes {
        if node.attr("TargetMode") == Some("External") {
            continue;
        }
        let id = node.attr("Id").ok_or(ExtractFailure::Corrupt)?;
        let target = node.attr("Target").ok_or(ExtractFailure::Corrupt)?;
        if result.iter().any(|(previous, _)| previous == id) {
            return Err(ExtractFailure::Corrupt);
        }
        let directory_bytes = base
            .rsplit_once('/')
            .map_or(0, |(directory, _)| directory.len().saturating_add(1));
        reserve_reference_bytes(
            &mut reference_bytes,
            0,
            id.len()
                .saturating_add(directory_bytes)
                .saturating_add(target.len()),
            1,
        )?;
        let path = internal_target(base, target)?;
        let text_part = [".xml", ".xhtml", ".html", ".htm", ".svg", ".txt", ".hpf"]
            .iter()
            .any(|suffix| path.to_ascii_lowercase().ends_with(suffix));
        if text_part
            && !archive
                .file_names()
                .filter_map(Result::ok)
                .any(|name| name.eq_ignore_ascii_case(&path))
        {
            return Err(ExtractFailure::Corrupt);
        }
        result.push((id.to_owned(), path));
    }
    Ok(result)
}

/// 보조 part별 원본 소속 원장입니다.
pub(super) type PackageLinks = BTreeMap<String, Vec<String>>;

/// 문자열 복사·JSON escaping·원장 항목을 생성하기 전에 보수적으로 예약합니다.
fn reserve_reference_bytes(
    used: &mut usize,
    baseline: usize,
    string_bytes: usize,
    entries: usize,
) -> Result<(), ExtractFailure> {
    let cost = string_bytes
        .checked_mul(8)
        .and_then(|bytes| {
            entries
                .checked_mul(256)
                .and_then(|overhead| bytes.checked_add(overhead))
        })
        .ok_or(ExtractFailure::MemoryBudget)?;
    let next = used.checked_add(cost).ok_or(ExtractFailure::MemoryBudget)?;
    let total = next
        .checked_add(baseline)
        .ok_or(ExtractFailure::MemoryBudget)?;
    if u64::try_from(total).map_or(true, |bytes| bytes > MAX_TOTAL_BYTES) {
        return Err(ExtractFailure::MemoryBudget);
    }
    *used = next;
    Ok(())
}

/// 패키지 내부 연결을 추출해 주석·발표 노트의 본래 소속을 남깁니다.
pub(super) fn package_links(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    budget: &mut u64,
    document: &mut ExtractedDocument,
) -> Result<PackageLinks, ExtractFailure> {
    let baseline = document.text.len().saturating_mul(4);
    let mut names = Vec::new();
    for name in archive
        .file_names()
        .filter_map(Result::ok)
        .filter(|name| name.ends_with(".rels"))
    {
        reserve_reference_bytes(&mut document.metadata_bytes, baseline, name.len(), 1)?;
        names.push(name.into_owned());
    }
    let mut links = PackageLinks::new();
    for name in names {
        reserve_reference_bytes(&mut document.metadata_bytes, baseline, name.len(), 1)?;
        let source = if name == "_rels/.rels" {
            String::new()
        } else {
            name.replacen("_rels/", "", 1)
                .strip_suffix(".rels")
                .ok_or(ExtractFailure::Corrupt)?
                .to_owned()
        };
        for (_, target) in relationships(archive, &source, budget)? {
            if links
                .get(&target)
                .is_some_and(|sources| sources.contains(&source))
            {
                continue;
            }
            reserve_reference_bytes(
                &mut document.metadata_bytes,
                baseline,
                source.len().saturating_add(target.len()),
                1,
            )?;
            links.entry(target).or_default().push(source.clone());
        }
    }
    Ok(links)
}

/// 볼트 경로 없이 컨테이너 내부 소속만 위치 wire에 담습니다.
pub(super) fn part_locator(
    part: &str,
    links: &PackageLinks,
    used_bytes: usize,
) -> Result<JsonValue, ExtractFailure> {
    let sources = links.get(part).map(Vec::as_slice).unwrap_or_default();
    let string_bytes = sources.iter().try_fold(0usize, |bytes, source| {
        bytes
            .checked_add(source.len())
            .ok_or(ExtractFailure::MemoryBudget)
    })?;
    let mut projected = used_bytes;
    reserve_reference_bytes(&mut projected, 0, string_bytes, sources.len())?;
    Ok(serde_json::json!({ "relatedTo": sources }))
}

/// 표·셀 위치와 본문을 함께 만듭니다.
struct Renderer {
    /// OOXML의 텍스트 요소만 읽는지 나타냅니다.
    office: bool,
    /// 본문의 문단 구분입니다.
    separator: &'static str,
    /// part 내부 표 번호입니다.
    table: usize,
    /// 1 기반 논리 셀 좌표입니다.
    cells: Vec<JsonValue>,
    /// 각주·미주·주석의 저장 ID와 셀 참조입니다.
    anchors: Vec<JsonValue>,
    /// 렌더링 결과 기준 altChunk 위치입니다. 최종 본문에 표식은 넣지 않습니다.
    insertions: Vec<(usize, String)>,
    /// 복제·문자 수의 작업 예산입니다.
    work: usize,
}

impl Renderer {
    /// 형식별 기존 줄바꿈 규약을 유지합니다.
    const fn new(office: bool, separator: &'static str) -> Self {
        Self {
            office,
            separator,
            table: 0,
            cells: Vec::new(),
            anchors: Vec::new(),
            insertions: Vec::new(),
            work: 0,
        }
    }

    /// 출력과 위치 메타데이터의 무제한 복제를 차단합니다.
    const fn check(&mut self, size: usize) -> Result<(), ExtractFailure> {
        self.work = self.work.saturating_add(size);
        if self.work > MAX_TEXT_CHARS.saturating_mul(4) {
            return Err(ExtractFailure::TooLarge);
        }
        Ok(())
    }

    /// 문단·중첩 주석·도형·수식 캐시를 문서 순서로 읽습니다.
    fn render(&mut self, node: &Node, capture: bool) -> Result<String, ExtractFailure> {
        if node.name.is_empty() && !node.text.is_empty() {
            return Ok(if capture || !self.office {
                node.text.clone()
            } else {
                String::new()
            });
        }
        if matches!(
            node.local(),
            "binary-data" | "font-face-decls" | "settings" | "head"
        ) || (node.local() == "script" && !capture)
        {
            return Ok(String::new());
        }
        if let Some(control) = self.render_control(node)? {
            return Ok(control);
        }
        if matches!(node.local(), "tbl" | "table") {
            return self.render_table(node);
        }
        if matches!(
            node.local(),
            "footnote"
                | "endnote"
                | "footNote"
                | "endNote"
                | "comment"
                | "cm"
                | "annotation"
                | "note"
                | "memo"
        ) {
            self.check(512)?;
            self.anchors.push(serde_json::json!({ "kind": node.local(), "id": node.attr("w:id").or_else(|| node.attr("id")).or_else(|| node.attr("idx")), "address": node.attr("ref"), "author": node.attr("w:author").or_else(|| node.attr("author")) }));
        }
        let custom_property = node.local() == "property"
            && node.namespace
                == "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
        let property_value = node.is_property_value();
        let paragraph = node.is_paragraph() || custom_property || property_value;
        let capture = capture || node.is_text_leaf() || property_value;
        let mut result = String::new();
        if custom_property && let Some(name) = node.attr("name") {
            self.check(name.len().saturating_add(2))?;
            result.push_str(name);
            result.push_str(": ");
        }
        for value in [
            node.attr("w:instr"),
            node.attr("text:formula"),
            node.attr("descr"),
            node.attr("title"),
            node.attr("string"),
        ]
        .into_iter()
        .flatten()
        {
            result.push_str(value);
            result.push(' ');
        }
        for child in &node.children {
            let previous = self.insertions.len();
            let text = self.render(child, capture)?;
            self.check(text.len())?;
            if child.is_separate_block()
                && !text.is_empty()
                && !result.is_empty()
                && !result.ends_with('\n')
            {
                result.push_str(self.separator);
            }
            for (offset, _) in self.insertions.iter_mut().skip(previous) {
                *offset = offset.saturating_add(result.len());
            }
            result.push_str(&text);
        }
        if paragraph {
            if result.chars().count() > MAX_PARAGRAPH_CHARS {
                return Err(ExtractFailure::TooLarge);
            }
            let body = if property_value {
                result.as_str()
            } else if custom_property {
                result.trim_matches(['\r', '\n'])
            } else {
                result.trim()
            };
            if !body.is_empty() {
                return Ok(format!("{body}{sep}", sep = self.separator));
            }
            return Ok(String::new());
        }
        Ok(result)
    }

    /// namespace가 필요한 공백과 본문 밖 삽입 원장을 처리합니다.
    fn render_control(&mut self, node: &Node) -> Result<Option<String>, ExtractFailure> {
        if node.namespace == PROPERTY_TYPES_NAMESPACE
            && matches!(
                node.local(),
                "blob" | "oblob" | "stream" | "ostream" | "storage" | "ostorage" | "vstream" | "cf"
            )
        {
            return Ok(Some(String::new()));
        }
        if node.local() == "altChunk" {
            self.check(512)?;
            self.insertions.push((
                0,
                node.attr("r:id").ok_or(ExtractFailure::Corrupt)?.to_owned(),
            ));
            return Ok(Some(String::new()));
        }
        let control = match node.local() {
            "tab" | "ptab" => Some("\t"),
            "br" | "cr" | "line-break" | "lineBreak" => Some("\n"),
            "noBreakHyphen" => Some("\u{2011}"),
            "softHyphen" => Some("\u{00ad}"),
            "nbSpace" => Some("\u{00a0}"),
            "fwSpace" => Some("\u{3000}"),
            _ => None,
        };
        if let Some(control) = control {
            return Ok(Some(control.to_owned()));
        }
        if node.local() == "s" && node.namespace == "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
        {
            let count = node
                .space_count
                .as_deref()
                .unwrap_or("1")
                .parse::<usize>()
                .map_err(|_| ExtractFailure::Corrupt)?;
            if count > MAX_PARAGRAPH_CHARS {
                return Err(ExtractFailure::TooLarge);
            }
            return Ok(Some(" ".repeat(count)));
        }
        Ok(None)
    }

    /// HTML 병합만 행간 점유를 암묵적으로 건너뜁니다.
    fn html_span(
        &mut self,
        cell: &Node,
        current_row: usize,
        column: &mut usize,
        spans: (usize, usize),
        occupied: &mut Vec<(usize, usize, usize)>,
    ) -> Result<(), ExtractFailure> {
        if spans.0 > MAX_PARAGRAPH_CHARS || spans.1 > MAX_PARAGRAPH_CHARS {
            return Err(ExtractFailure::TooLarge);
        }
        if matches!(cell.local(), "td" | "th") {
            while let Some((_, end, _)) = occupied
                .iter()
                .find(|(start, end, _)| *start < column.saturating_add(spans.0) && *end >= *column)
            {
                *column = end.saturating_add(1);
            }
            if spans.1 > 1 {
                self.check(64)?;
                occupied.push((
                    *column,
                    column.saturating_add(spans.0).saturating_sub(1),
                    current_row.saturating_add(spans.1).saturating_sub(1),
                ));
            }
        }
        Ok(())
    }

    /// 표 셀 안의 삽입도 본문 byte 좌표로 올립니다.
    fn render_cell(&mut self, cell: &Node, cell_offset: usize) -> Result<String, ExtractFailure> {
        let mut text = String::new();
        let previous = self.insertions.len();
        for child in &cell.children {
            let start = self.insertions.len();
            let rendered = self.render(child, false)?;
            for (offset, _) in self.insertions.iter_mut().skip(start) {
                *offset = offset.saturating_add(text.len());
            }
            text.push_str(&rendered);
        }
        let leading = text.len().saturating_sub(text.trim_start().len());
        for (offset, _) in self.insertions.iter_mut().skip(previous) {
            *offset = offset.saturating_sub(leading).saturating_add(cell_offset);
        }
        Ok(text.trim().to_owned())
    }

    /// 논리 빈 셀·반복 행열·병합 위치를 유지합니다.
    fn render_table(&mut self, node: &Node) -> Result<String, ExtractFailure> {
        self.table = self.table.saturating_add(1);
        let table = self.table;
        let mut rows = Vec::new();
        table_rows(node, &mut rows);
        let mut body = String::new();
        let mut row_number = 1usize;
        let mut occupied: Vec<(usize, usize, usize)> = Vec::new();
        for row in rows {
            let row_repeat = repeat(row, "table:number-rows-repeated")?;
            let mut cells = Vec::new();
            table_cells(row, &mut cells);
            if cells.is_empty() {
                row_number = row_number.saturating_add(row_repeat);
                continue;
            }
            for offset in 0..row_repeat {
                let mut column = row
                    .property("gridBefore", "w:val")
                    .unwrap_or("0")
                    .parse::<usize>()
                    .map_err(|_| ExtractFailure::Corrupt)?
                    .saturating_add(1);
                let current_row = row_number.saturating_add(offset);
                occupied.retain(|(_, _, end_row)| *end_row >= current_row);
                let mut row_body = Vec::new();
                for cell in &cells {
                    let column_repeat = repeat(cell, "table:number-columns-repeated")?;
                    let cell_offset = body
                        .len()
                        .saturating_add(usize::from(!body.is_empty()))
                        .saturating_add(row_body.iter().map(String::len).sum::<usize>())
                        .saturating_add(row_body.len());
                    let text = self.render_cell(cell, cell_offset)?;
                    let formula = cell.attr("table:formula");
                    let cached = cell
                        .attr("office:value")
                        .or_else(|| cell.attr("office:string-value"))
                        .or_else(|| cell.attr("office:date-value"))
                        .or_else(|| cell.attr("office:time-value"))
                        .or_else(|| cell.attr("office:boolean-value"));
                    let mut text = text;
                    for value in [formula, cached].into_iter().flatten() {
                        if !text.is_empty() {
                            text.push(' ');
                        }
                        text.push_str(value);
                    }
                    let row_address = cell
                        .property("cellAddr", "rowAddr")
                        .and_then(|value| value.parse::<usize>().ok())
                        .map_or(row_number + offset, |value| value.saturating_add(1));
                    let (column_span, row_span) = cell_spans(cell)?;
                    self.html_span(
                        cell,
                        current_row,
                        &mut column,
                        (column_span, row_span),
                        &mut occupied,
                    )?;
                    let column_address = cell
                        .property("cellAddr", "colAddr")
                        .and_then(|value| value.parse::<usize>().ok())
                        .map_or(column, |value| value.saturating_add(1));
                    for repeated in 0..column_repeat {
                        self.check(text.len().saturating_add(512))?;
                        row_body.push(text.clone());
                        self.cells.push(serde_json::json!({ "table": table, "row": row_address, "column": column_address.saturating_add(repeated), "rowSpan": row_span, "columnSpan": column_span, "verticalMerge": cell.property("vMerge", "w:val"), "formula": formula, "cachedValue": cached }));
                    }
                    let advance = if matches!(cell.local(), "table-cell" | "covered-table-cell") {
                        1
                    } else {
                        column_span
                    };
                    column = column.saturating_add(column_repeat.saturating_mul(advance));
                }
                if !body.is_empty() {
                    body.push('\n');
                }
                body.push_str(&row_body.join("\t"));
            }
            row_number = row_number.saturating_add(row_repeat);
        }
        if !body.is_empty() {
            body.push_str(self.separator);
        }
        Ok(body)
    }
}

/// HTML/ODF/Word/HWPX의 저장 병합 폭을 같은 유한 규칙으로 읽습니다.
fn cell_spans(cell: &Node) -> Result<(usize, usize), ExtractFailure> {
    let column_span = cell
        .attr("table:number-columns-spanned")
        .or_else(|| cell.attr("colspan"))
        .or_else(|| cell.property("cellSpan", "colSpan"))
        .or_else(|| cell.property("gridSpan", "w:val"))
        .unwrap_or("1")
        .parse::<usize>()
        .map_err(|_| ExtractFailure::Corrupt)?;
    let row_span = cell
        .attr("table:number-rows-spanned")
        .or_else(|| cell.attr("rowspan"))
        .or_else(|| cell.property("cellSpan", "rowSpan"))
        .unwrap_or("1")
        .parse::<usize>()
        .map_err(|_| ExtractFailure::Corrupt)?;
    if column_span == 0 || row_span == 0 {
        return Err(ExtractFailure::Corrupt);
    }
    Ok((column_span, row_span))
}

/// 반복 폭발은 축소 추출 대신 명시적 상한 실패로 처리합니다.
fn repeat(node: &Node, key: &str) -> Result<usize, ExtractFailure> {
    let value = node
        .attr(key)
        .unwrap_or("1")
        .parse::<usize>()
        .map_err(|_| ExtractFailure::Corrupt)?;
    if value == 0 {
        return Err(ExtractFailure::Corrupt);
    }
    if value > MAX_TEXT_CHARS {
        return Err(ExtractFailure::TooLarge);
    }
    Ok(value)
}

/// 중첩 표의 행을 부모 표에 섞지 않습니다.
fn table_rows<'a>(node: &'a Node, rows: &mut Vec<&'a Node>) {
    for child in &node.children {
        if matches!(child.local(), "tr" | "table-row") {
            rows.push(child);
        } else if !matches!(child.local(), "tbl" | "table") {
            table_rows(child, rows);
        }
    }
}

/// 빈 셀까지 포함해 행의 셀을 모읍니다.
fn table_cells<'a>(node: &'a Node, cells: &mut Vec<&'a Node>) {
    for child in &node.children {
        if matches!(
            child.local(),
            "tc" | "table-cell" | "covered-table-cell" | "td" | "th"
        ) {
            cells.push(child);
        } else if !matches!(child.local(), "tbl" | "table") {
            table_cells(child, cells);
        }
    }
}

/// part와 위치 정보를 기존 줄 세그먼트에 추가합니다.
fn append_part(
    document: &mut ExtractedDocument,
    part: &str,
    label: &str,
    node: &Node,
    office: bool,
    separator: &'static str,
    mut locator: JsonValue,
) -> Result<(), ExtractFailure> {
    let mut renderer = Renderer::new(
        office && part.to_ascii_lowercase().ends_with(".xml"),
        separator,
    );
    let body = renderer.render(node, false)?;
    let stored_body = body.trim_matches(['\r', '\n']);
    let has_body = !stored_body.trim().is_empty();
    let body_start = body
        .len()
        .saturating_sub(body.trim_start_matches(['\r', '\n']).len());
    let document_offset = if document.text.is_empty() || !has_body {
        document.text.len()
    } else {
        document.text.len().saturating_add(2)
    };
    for (offset, id) in &renderer.insertions {
        let stored_offset = if has_body {
            offset.saturating_sub(body_start).min(stored_body.len())
        } else {
            0
        };
        document
            .insertions
            .push((document_offset.saturating_add(stored_offset), id.clone()));
    }
    if !has_body {
        return Ok(());
    }
    if stored_body.chars().count() > MAX_TEXT_CHARS {
        return Err(ExtractFailure::TooLarge);
    }
    let previous = document.segments.len();
    document.push_segment(label, stored_body);
    if document.conflicted() {
        return Err(ExtractFailure::TooLarge);
    }
    if document.segments.len() > previous {
        let segment = document
            .segments
            .last_mut()
            .ok_or(ExtractFailure::Corrupt)?;
        segment.source_part = Some(part.to_owned());
        super::insert_location(&mut locator, "cells", renderer.cells.into())?;
        super::insert_location(&mut locator, "anchors", renderer.anchors.into())?;
        document.metadata_bytes = document
            .metadata_bytes
            .saturating_add(locator.to_string().len().saturating_mul(4))
            .saturating_add(512);
        if document
            .metadata_bytes
            .saturating_add(document.text.len().saturating_mul(4))
            > usize::try_from(MAX_TOTAL_BYTES).unwrap_or(usize::MAX)
        {
            return Err(ExtractFailure::MemoryBudget);
        }
        segment.locator = Some(locator);
    }
    Ok(())
}

/// OOXML 본문과 저장된 보조 텍스트 part를 한 번씩 읽습니다.
pub(super) fn extract_docx(
    bytes: &[u8],
    skip: &[String],
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0;
    let main = required_part(&mut archive, "word/document.xml", &mut budget)?;
    let mut document = ExtractedDocument::new();
    append_part(
        &mut document,
        "word/document.xml",
        "Document",
        &main,
        true,
        "\n\n",
        serde_json::json!({}),
    )?;
    let relations = relationships(&mut archive, "word/document.xml", &mut budget)?;
    for (_, id) in &mut document.insertions {
        *id = relations
            .iter()
            .find(|(key, _)| key == id)
            .ok_or(ExtractFailure::Corrupt)?
            .1
            .clone();
    }
    let links = package_links(&mut archive, &mut budget, &mut document)?;
    let mut names = xml_parts(&archive, "");
    names.retain(|name| {
        name != "word/document.xml"
            && !name.contains("/_rels/")
            && !skip.iter().any(|part| part.eq_ignore_ascii_case(name))
    });
    for name in names {
        let tree = required_part(&mut archive, &name, &mut budget)?;
        let used_bytes = document
            .metadata_bytes
            .saturating_add(document.text.len().saturating_mul(4));
        let locator = part_locator(&name, &links, used_bytes)?;
        append_part(&mut document, &name, &name, &tree, true, "\n\n", locator)?;
    }
    if document.text.is_empty() && !document.insertions.is_empty() {
        Ok(document)
    } else {
        finish_document(document)
    }
}

/// 저장 XML part 이름을 결정적으로 열거합니다.
fn xml_parts(archive: &ZipArchive<Cursor<&[u8]>>, prefix: &str) -> Vec<String> {
    let mut names: Vec<_> = archive
        .file_names()
        .filter_map(Result::ok)
        .filter(|name| {
            name.starts_with(prefix)
                && [".xml", ".xhtml", ".html", ".htm", ".svg", ".txt", ".hpf"]
                    .iter()
                    .any(|suffix| name.to_ascii_lowercase().ends_with(suffix))
                && !name.contains("/_rels/")
        })
        .map(std::borrow::Cow::into_owned)
        .collect();
    names.sort();
    names
}

/// 관계 ID 순서를 우선하고 저장된 고립 part도 보존합니다.
pub(super) fn extract_pptx(
    bytes: &[u8],
    skip: &[String],
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0;
    let mut names = Vec::new();
    let mut primary = false;
    if let Some(xml) = read_entry(&mut archive, "ppt/presentation.xml", &mut budget)? {
        let tree = parse(&xml)?;
        if !tree.has_root("presentation") {
            return Err(ExtractFailure::Corrupt);
        }
        primary = true;
        let relations = relationships(&mut archive, "ppt/presentation.xml", &mut budget)?;
        let mut slides = Vec::new();
        tree.descendants("sldId", &mut slides);
        for (index, slide) in slides.iter().enumerate() {
            let id = slide.attr("r:id").ok_or(ExtractFailure::Corrupt)?;
            let (_, path) = relations
                .iter()
                .find(|(key, _)| key == id)
                .ok_or(ExtractFailure::Corrupt)?;
            names.push((format!("Slide {}", index.saturating_add(1)), path.clone()));
        }
    }
    for (number, name) in sorted_entry_names(&archive, "ppt/slides/slide", ".xml") {
        if !names.iter().any(|(_, previous)| previous == &name) {
            names.push((format!("Slide {number}"), name));
        }
    }
    if !primary && names.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    let mut document = ExtractedDocument::new();
    let links = package_links(&mut archive, &mut budget, &mut document)?;
    let mut seen = HashSet::new();
    for (label, name) in names {
        if !seen.insert(name.clone()) {
            continue;
        }
        let tree = required_part(&mut archive, &name, &mut budget)?;
        if !tree.has_root("sld") {
            return Err(ExtractFailure::Corrupt);
        }
        append_part(
            &mut document,
            &name,
            &label,
            &tree,
            true,
            "\n",
            serde_json::json!({}),
        )?;
    }
    for name in xml_parts(&archive, "") {
        if skip.iter().any(|part| part.eq_ignore_ascii_case(&name)) {
            continue;
        }
        if !seen.insert(name.clone()) {
            continue;
        }
        let tree = required_part(&mut archive, &name, &mut budget)?;
        let used_bytes = document
            .metadata_bytes
            .saturating_add(document.text.len().saturating_mul(4));
        let locator = part_locator(&name, &links, used_bytes)?;
        append_part(&mut document, &name, &name, &tree, true, "\n", locator)?;
    }
    if document.text.is_empty() && !skip.is_empty() {
        Ok(document)
    } else {
        finish_document(document)
    }
}

/// ODF 페이지·시트와 보조 객체의 저장 텍스트를 읽습니다.
pub(super) fn extract_odf(
    bytes: &[u8],
    format: &str,
    skip: &[String],
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0;
    let mut tree = required_part(&mut archive, "content.xml", &mut budget)?;
    let mut document = ExtractedDocument::new();
    let mut units = Vec::new();
    if format == "odp" {
        tree.descendants("page", &mut units);
    }
    if format == "ods" {
        tree.descendants("table", &mut units);
    }
    if !units.is_empty() {
        for (index, unit) in units.iter().enumerate() {
            let label = format!(
                "{} {}",
                if format == "odp" { "Slide" } else { "Sheet" },
                index.saturating_add(1)
            );
            let locator = serde_json::json!({ "sheetName": unit.attr("table:name"), "pageName": unit.attr("draw:name") });
            append_part(
                &mut document,
                "content.xml",
                &label,
                unit,
                false,
                "\n",
                locator,
            )?;
        }
        tree.remove_units(if format == "odp" { "page" } else { "table" });
    }
    append_part(
        &mut document,
        "content.xml",
        "Document",
        &tree,
        false,
        "\n\n",
        serde_json::json!({}),
    )?;
    for name in xml_parts(&archive, "") {
        if skip.iter().any(|part| part.eq_ignore_ascii_case(&name)) {
            continue;
        }
        if name == "content.xml" || name.starts_with("META-INF/") || name == "settings.xml" {
            continue;
        }
        let tree = required_part(&mut archive, &name, &mut budget)?;
        append_part(
            &mut document,
            &name,
            &name,
            &tree,
            false,
            "\n\n",
            serde_json::json!({}),
        )?;
    }
    finish_document(document)
}

/// 절대주소 표식은 열/행 앞 한 번씩만 허용하며 모호한 주소는 증명하지 않습니다.
fn chart_address(value: &str) -> Option<(usize, usize)> {
    let value = value.strip_prefix('$').unwrap_or(value);
    let letters = value.bytes().take_while(u8::is_ascii_alphabetic).count();
    let number = value.get(letters..)?;
    let number = number.strip_prefix('$').unwrap_or(number);
    if letters == 0 || number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    super::xlsx_coordinates(&format!("{}{number}", value.get(..letters)?)).ok()
}

/// 직접 셀 또는 일차원 범위만 증명하며 이름·외부 주소·다차원 범위는 그대로 보존합니다.
fn chart_cell(reference: &str, index: usize) -> Option<(String, String)> {
    let (sheet, range) = reference.rsplit_once('!')?;
    if sheet.contains(['[', ']']) {
        return None;
    }
    let sheet = if sheet.starts_with('\'') && sheet.ends_with('\'') {
        let inner = sheet.get(1..sheet.len().checked_sub(1)?)?;
        if inner.replace("''", "").contains('\'') {
            return None;
        }
        inner.replace("''", "'")
    } else {
        if !sheet
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '.'))
        {
            return None;
        }
        sheet.to_owned()
    };
    let (first, last) = range.split_once(':').unwrap_or((range, range));
    let (column, row) = chart_address(first)?;
    let (last_column, last_row) = chart_address(last)?;
    let (column, row) = if column == last_column && row.checked_add(index)? <= last_row {
        (column, row.checked_add(index)?)
    } else if row == last_row && column.checked_add(index)? <= last_column {
        (column.checked_add(index)?, row)
    } else {
        return None;
    };
    Some((sheet, super::xlsx_address(column, row)))
}

/// 중복 시트명/셀 주소는 증명할 수 없으므로 캐시를 보존합니다.
fn chart_segment_index(
    canonical: &ExtractedDocument,
    sheet: &str,
    address: &str,
    value: &str,
) -> Option<usize> {
    let mut sheets = canonical
        .segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| {
            segment
                .locator
                .as_ref()
                .and_then(|v| v.get("sheetName"))
                .and_then(JsonValue::as_str)
                == Some(sheet)
        });
    let (index, segment) = sheets.next()?;
    if sheets.next().is_some() || !segment.source_part.as_ref()?.starts_with("xl/worksheets/") {
        return None;
    }
    let mut cells = segment
        .locator
        .as_ref()?
        .get("cells")?
        .as_array()?
        .iter()
        .filter(|cell| cell.get("address").and_then(JsonValue::as_str) == Some(address));
    let cell = cells.next()?;
    if cells.next().is_some()
        || cell.get("cachedValue").and_then(JsonValue::as_str) != Some(value)
        || cell.get("startLine").is_none()
    {
        return None;
    }
    Some(index)
}

/// 실제 셀과 정확히 같은 저장 캐시에만 alias를 남기고 그 v 노드만 제거합니다.
fn canonicalize_chart(
    node: &mut Node,
    part: &str,
    canonical: &mut ExtractedDocument,
    path: &str,
) -> Result<(), ExtractFailure> {
    if matches!(node.local(), "strRef" | "numRef") {
        let reference = node
            .children
            .iter()
            .find(|n| n.local() == "f")
            .map(Node::plain_text);
        if let Some(reference) = reference {
            for cache in &mut node.children {
                if !matches!(cache.local(), "strCache" | "numCache") {
                    continue;
                }
                for point in &mut cache.children {
                    if point.local() != "pt" {
                        continue;
                    }
                    let Some(index) = point.attr("idx").and_then(|v| v.parse::<usize>().ok())
                    else {
                        continue;
                    };
                    let Some((sheet, address)) = chart_cell(&reference, index) else {
                        continue;
                    };
                    let Some(value) = point
                        .children
                        .iter()
                        .find(|n| n.local() == "v")
                        .map(Node::plain_text)
                    else {
                        continue;
                    };
                    if value.is_empty() {
                        continue;
                    }
                    let Some(segment_index) =
                        chart_segment_index(canonical, &sheet, &address, &value)
                    else {
                        continue;
                    };
                    let alias = serde_json::json!({ "sourcePart": part, "reference": reference, "address": address, "cacheIndex": index, "nodePath": path });
                    canonical.metadata_bytes = canonical.metadata_bytes.saturating_add(
                        alias
                            .to_string()
                            .len()
                            .saturating_mul(4)
                            .saturating_add(256),
                    );
                    if canonical
                        .metadata_bytes
                        .saturating_add(canonical.text.len().saturating_mul(4))
                        > super::XLSX_MEMORY_BYTES
                    {
                        return Err(ExtractFailure::MemoryBudget);
                    }
                    let locator = canonical
                        .segments
                        .get_mut(segment_index)
                        .ok_or(ExtractFailure::Corrupt)?
                        .locator
                        .as_mut()
                        .and_then(JsonValue::as_object_mut)
                        .ok_or(ExtractFailure::Corrupt)?;
                    let aliases = locator
                        .entry("aliases")
                        .or_insert_with(|| serde_json::json!([]))
                        .as_array_mut()
                        .ok_or(ExtractFailure::Corrupt)?;
                    if !aliases.contains(&alias) {
                        aliases.push(alias);
                    }
                    point.children.retain(|n| n.local() != "v");
                }
            }
        }
    }
    for (index, child) in node.children.iter_mut().enumerate() {
        let path = format!("{path}/{}[{index}]", child.local());
        canonicalize_chart(child, part, canonical, &path)?;
    }
    Ok(())
}

/// PPTX는 차트 externalData 관계가 실제 중첩 workbook을 가리킨 경우만 증명합니다.
pub(super) fn nested_chart_aliases(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    part: &str,
    workbook: &str,
    canonical: &mut ExtractedDocument,
) -> Result<Option<ExtractedDocument>, ExtractFailure> {
    if !part.starts_with("ppt/charts/") {
        return Ok(None);
    }
    let mut budget = 0;
    let mut tree = required_part(archive, part, &mut budget)?;
    let relations = relationships(archive, part, &mut budget)?;
    let mut external = Vec::new();
    tree.descendants("externalData", &mut external);
    if external.len() != 1
        || !external.iter().any(|n| {
            n.attr("r:id").is_some_and(|id| {
                relations
                    .iter()
                    .any(|(key, target)| key == id && target.eq_ignore_ascii_case(workbook))
            })
        })
    {
        return Ok(None);
    }
    let previous = canonical.metadata_bytes;
    canonicalize_chart(&mut tree, part, canonical, "")?;
    if previous == canonical.metadata_bytes {
        return Ok(None);
    }
    let mut document = ExtractedDocument::new();
    append_part(
        &mut document,
        part,
        part,
        &tree,
        true,
        "\n",
        serde_json::json!({}),
    )?;
    Ok(Some(document))
}

/// XLSX의 주석·도형·차트·정의된 수식 등 보조 저장 텍스트입니다.
pub(super) fn xlsx_auxiliary(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    sheets: &[(String, String)],
    skip: &[String],
    canonical: &mut ExtractedDocument,
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut budget = 0;
    let mut document = ExtractedDocument::new();
    let links = package_links(archive, &mut budget, &mut document)?;
    for name in xml_parts(archive, "") {
        if skip.iter().any(|part| part.eq_ignore_ascii_case(&name)) {
            continue;
        }
        if name.starts_with("xl/worksheets/")
            || name == "xl/sharedStrings.xml"
            || sheets.iter().any(|(_, path)| path == &name)
        {
            continue;
        }
        let mut tree = required_part(archive, &name, &mut budget)?;
        if name.starts_with("xl/charts/") {
            let mut external = Vec::new();
            tree.descendants("externalData", &mut external);
            if external.is_empty() {
                canonicalize_chart(&mut tree, &name, canonical, "")?;
            }
        }
        let used_bytes = document
            .metadata_bytes
            .saturating_add(document.text.len().saturating_mul(4));
        let locator = part_locator(&name, &links, used_bytes)?;
        append_part(&mut document, &name, &name, &tree, true, "\n", locator)?;
    }
    Ok(document)
}

/// HWPX 섹션과 메모·헤더의 저장 텍스트를 읽습니다.
pub(super) fn extract_hwpx(
    bytes: &[u8],
    skip: &[String],
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0;
    let mut names: Vec<_> = sorted_entry_names(&archive, "Contents/section", ".xml")
        .into_iter()
        .map(|(_, name)| name)
        .collect();
    for name in xml_parts(&archive, "Contents/") {
        if skip.iter().any(|part| part.eq_ignore_ascii_case(&name)) {
            continue;
        }
        if !names.contains(&name) {
            names.push(name);
        }
    }
    let mut document = ExtractedDocument::new();
    for name in names {
        let tree = required_part(&mut archive, &name, &mut budget)?;
        append_part(
            &mut document,
            &name,
            &name,
            &tree,
            false,
            "\n\n",
            serde_json::json!({}),
        )?;
    }
    finish_document(document)
}

/// EPUB 스파인·비 스파인 XHTML과 OPF 서지를 읽습니다.
pub(super) fn extract_epub(
    bytes: &[u8],
    skip: &[String],
) -> Result<ExtractedDocument, ExtractFailure> {
    let mut archive = open_archive(bytes)?;
    let mut budget = 0;
    let container = required_part(&mut archive, "META-INF/container.xml", &mut budget)?;
    let mut roots = Vec::new();
    container.descendants("rootfile", &mut roots);
    let package_path = roots
        .first()
        .and_then(|node| node.attr("full-path"))
        .ok_or(ExtractFailure::Corrupt)?;
    let package = required_part(&mut archive, package_path, &mut budget)?;
    let mut manifest = Vec::new();
    package.descendants("item", &mut manifest);
    let mut spine = Vec::new();
    package.descendants("itemref", &mut spine);
    if spine.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    let mut paths = Vec::new();
    for reference in spine {
        let id = reference.attr("idref").ok_or(ExtractFailure::Corrupt)?;
        let item = manifest
            .iter()
            .find(|item| item.attr("id") == Some(id))
            .ok_or(ExtractFailure::Corrupt)?;
        paths.push(internal_target(
            package_path,
            item.attr("href").ok_or(ExtractFailure::Corrupt)?,
        )?);
    }
    for item in manifest {
        let href = item.attr("href").ok_or(ExtractFailure::Corrupt)?;
        if matches!(
            item.attr("media-type"),
            Some("application/xhtml+xml" | "image/svg+xml")
        ) || [".xhtml", ".html", ".htm", ".svg"]
            .iter()
            .any(|suffix| href.to_ascii_lowercase().ends_with(suffix))
        {
            let path = internal_target(package_path, href)?;
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    for path in xml_parts(&archive, "") {
        if [".xhtml", ".html", ".htm", ".svg"]
            .iter()
            .any(|suffix| path.to_ascii_lowercase().ends_with(suffix))
            && !paths.contains(&path)
        {
            paths.push(path);
        }
    }
    let mut document = ExtractedDocument::new();
    for path in paths {
        if skip.iter().any(|part| part.eq_ignore_ascii_case(&path)) {
            continue;
        }
        let tree = required_part(&mut archive, &path, &mut budget)?;
        let mut headings = Vec::new();
        tree.descendants("h1", &mut headings);
        if headings.is_empty() {
            tree.descendants("h2", &mut headings);
        }
        if headings.is_empty() {
            tree.descendants("title", &mut headings);
        }
        let label = headings.first().map_or_else(
            || path.rsplit('/').next().unwrap_or(&path).to_owned(),
            |node| node.plain_text().trim().to_owned(),
        );
        append_part(
            &mut document,
            &path,
            &label,
            &tree,
            false,
            "\n\n",
            serde_json::json!({}),
        )?;
    }
    let mut metadata = Vec::new();
    package.descendants("metadata", &mut metadata);
    for node in metadata {
        append_part(
            &mut document,
            package_path,
            "Metadata",
            node,
            false,
            "\n\n",
            serde_json::json!({}),
        )?;
    }
    finish_document(document)
}

/// 기존 XML altChunk도 중첩 출처 원장과 함께 반환합니다.
pub(super) fn standalone_part(raw: &[u8], part: &str) -> Result<ExtractedDocument, ExtractFailure> {
    let xml = super::decode_xml_bytes(raw.to_vec())?;
    let tree = parse(&xml)?;
    let mut document = ExtractedDocument::new();
    append_part(
        &mut document,
        part,
        part,
        &tree,
        part.rsplit_once('.')
            .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("xml")),
        "\n\n",
        serde_json::json!({}),
    )?;
    finish_document(document)
}
