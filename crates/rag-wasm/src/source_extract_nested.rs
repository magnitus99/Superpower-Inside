//! 관계가 가리키는 지원 문서만 순차 처리하고 문서 전체 예산을 공유합니다.

use super::{
    ExtractFailure, ExtractedDocument, MAX_ARCHIVE_ENTRIES, MAX_SEGMENTS, MAX_TEXT_CHARS,
    MAX_TOTAL_BYTES, XLSX_MEMORY_BYTES, XLSX_SOURCE_BYTES, container, extract_xlsx_with_budget,
    open_archive, read_entry,
};
use crate::JsonValue;
use std::collections::HashSet;
use std::io::{Cursor, Read};
use zip::ZipArchive;

/// 루트 아래 네 단계, 전체 32개 자식까지만 허용합니다.
const MAX_DEPTH: usize = 4;
/// 자식 수는 분기마다 초기화하지 않습니다.
const MAX_CHILDREN: usize = 32;

/// ZIP 선언 크기는 읽기 전에 예약하며 중첩 ZIP 바이트도 중복 비용으로 셉니다.
struct Budget {
    /// 문서 전체 엔트리 수입니다.
    entries: usize,
    /// 전체 압축 해제 누계입니다.
    inflated: u64,
    /// XLSX 스트리밍 루트의 기존 대용량 한도를 유지합니다.
    inflated_limit: u64,
    /// 처리한 자식 수입니다.
    children: usize,
    /// 출력 문자 누계입니다.
    chars: usize,
    /// 출력 구간 누계입니다.
    segments: usize,
    /// 출력·위치 원장과 비스트리밍 파서의 누적 예약 공간입니다.
    retained: usize,
    /// 루트가 XLSX인 경우 기존 스트리밍 출력 상한을 적용합니다.
    streaming: bool,
}

impl Budget {
    /// 모든 자식이 같은 엔트리·압축 해제·메모리 원장을 사용합니다.
    fn reserve(
        &mut self,
        archive: &mut ZipArchive<Cursor<&[u8]>>,
        streaming: bool,
    ) -> Result<(), ExtractFailure> {
        self.entries = self.entries.saturating_add(archive.len());
        if self.entries > MAX_ARCHIVE_ENTRIES {
            return Err(ExtractFailure::TooLarge);
        }
        let mut bytes = 0u64;
        for index in 0..archive.len() {
            let file = archive
                .by_index_raw(index)
                .map_err(|_| ExtractFailure::Corrupt)?;
            // 관계·형식 판별·보조 본문에서 같은 메타데이터를 다시 읽는 상한입니다.
            let name = file.name().map_err(|_| ExtractFailure::Corrupt)?;
            let copies = if has_extension(&name, "rels")
                || name.eq_ignore_ascii_case("[Content_Types].xml")
            {
                3
            } else if has_extension(&name, "opf")
                || has_extension(&name, "hpf")
                || name.eq_ignore_ascii_case("xl/workbook.xml")
                || name.eq_ignore_ascii_case("ppt/presentation.xml")
            {
                2
            } else {
                1
            };
            bytes = bytes.saturating_add(file.size().saturating_mul(copies));
        }
        self.inflated = self.inflated.saturating_add(bytes);
        if self.inflated > self.inflated_limit {
            return Err(ExtractFailure::TooLarge);
        }
        if !streaming {
            // 트리·디코딩·렌더러의 일시 할당까지 보수적으로 누적 예약합니다.
            self.retained = self.retained.saturating_add(
                usize::try_from(bytes)
                    .unwrap_or(usize::MAX)
                    .saturating_mul(8),
            );
        }
        self.check_memory(0)
    }

    /// 차트 canonicalization의 재읽기도 기존 압축 해제·메모리 원장에 예약합니다.
    fn reread(
        &mut self,
        archive: &mut ZipArchive<Cursor<&[u8]>>,
        part: &str,
    ) -> Result<(), ExtractFailure> {
        let Some(index) = archive
            .file_names()
            .filter_map(Result::ok)
            .position(|name| name == part)
        else {
            return Ok(());
        };
        let size = archive
            .by_index_raw(index)
            .map_err(|_| ExtractFailure::Corrupt)?
            .size();
        self.inflated = self.inflated.saturating_add(size);
        if self.inflated > self.inflated_limit {
            return Err(ExtractFailure::TooLarge);
        }
        self.admit(
            usize::try_from(size)
                .unwrap_or(usize::MAX)
                .saturating_mul(8),
        )
    }

    /// 부모가 살아 있는 동안 자식에게 새 전체 메모리 예산을 주지 않습니다.
    const fn check_memory(&self, extra: usize) -> Result<(), ExtractFailure> {
        if self.retained.saturating_add(extra) > XLSX_MEMORY_BYTES {
            return Err(ExtractFailure::MemoryBudget);
        }
        Ok(())
    }

    /// 문자열·관계 원장은 복사 전에 누적 예약하고 해제 후에도 재충전하지 않습니다.
    fn admit(&mut self, bytes: usize) -> Result<(), ExtractFailure> {
        self.check_memory(bytes)?;
        self.retained = self.retained.saturating_add(bytes);
        Ok(())
    }

    /// 실제 출력과 위치 원장도 전체 누계에 추가합니다.
    fn output(&mut self, document: &ExtractedDocument) -> Result<(), ExtractFailure> {
        self.chars = self.chars.saturating_add(document.text.chars().count());
        self.segments = self
            .segments
            .saturating_add(document.segments.len())
            .saturating_add(document.metadata_parts.len());
        if (!self.streaming && self.chars > MAX_TEXT_CHARS) || self.segments > MAX_SEGMENTS {
            return Err(ExtractFailure::TooLarge);
        }
        let metadata = document
            .segments
            .iter()
            .map(|segment| {
                segment
                    .locator
                    .as_ref()
                    .map_or(0, |v| v.to_string().len().saturating_mul(4))
                    .saturating_add(segment.source_part.as_ref().map_or(0, String::len))
                    .saturating_add(segment.label.len())
                    .saturating_add(512)
            })
            .fold(0usize, usize::saturating_add);
        self.retained = self
            .retained
            .saturating_add(document.text.capacity().saturating_mul(4))
            .saturating_add(metadata)
            .saturating_add(
                document
                    .metadata_parts
                    .iter()
                    .map(|v| v.to_string().len().saturating_mul(4).saturating_add(512))
                    .fold(0usize, usize::saturating_add),
            );
        self.check_memory(0)
    }
}

/// 같은 ZIP 내부 관계 대상은 한 번만 처리합니다.
struct Child {
    /// 부모 ZIP 내부에 실제로 존재하는 part입니다.
    part: String,
    /// 참조 원본 part를 결정적 순서로 보관합니다.
    related: Vec<String>,
    /// altChunk 평문을 기존 decoder에 전달합니다.
    text: bool,
    /// 기존 XML·XHTML altChunk 파서를 그대로 사용합니다.
    markup: bool,
}

/// 공개 wire와 이진 XLSX 경로가 같은 재귀 계약을 사용합니다.
pub(super) fn extract(format: &str, bytes: &[u8]) -> Result<ExtractedDocument, ExtractFailure> {
    if !super::is_extractable_source_extension(format) || format == "pdf" {
        return Err(ExtractFailure::Unsupported);
    }
    if bytes.len() > XLSX_SOURCE_BYTES {
        return Err(ExtractFailure::MemoryBudget);
    }
    let streaming = matches!(format, "xlsx" | "xltx");
    let mut budget = Budget {
        entries: 0,
        inflated: 0,
        inflated_limit: if streaming {
            u64::try_from(XLSX_MEMORY_BYTES).unwrap_or(u64::MAX)
        } else {
            MAX_TOTAL_BYTES
        },
        children: 0,
        chars: 0,
        segments: 0,
        retained: bytes.len().saturating_mul(2),
        streaming,
    };
    let document = walk(format, bytes, 0, &mut budget)?;
    if document.text.trim().is_empty() && document.metadata_parts.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(document)
}

/// 조상 입력보다 먼저 해제되지 않는 자식 입력도 같은 예산에 예약합니다.
fn walk(
    format: &str,
    bytes: &[u8],
    depth: usize,
    budget: &mut Budget,
) -> Result<ExtractedDocument, ExtractFailure> {
    if depth > MAX_DEPTH {
        return Err(ExtractFailure::TooLarge);
    }
    let streaming = matches!(format, "xlsx" | "xltx");
    let mut archive = open_archive(bytes)?;
    budget.reserve(&mut archive, streaming)?;
    let parser_space = usize::try_from(MAX_TOTAL_BYTES)
        .unwrap_or(usize::MAX)
        .saturating_mul(4);
    budget.check_memory(parser_space)?;
    let children = children(&mut archive, budget)?;
    if depth == MAX_DEPTH && !children.is_empty() {
        return Err(ExtractFailure::TooLarge);
    }
    budget.admit(
        children
            .iter()
            .map(|child| child.part.len().saturating_add(64))
            .sum(),
    )?;
    let skip: Vec<_> = children.iter().map(|child| child.part.clone()).collect();
    let remaining = XLSX_MEMORY_BYTES
        .saturating_sub(budget.retained)
        .saturating_sub(
            usize::try_from(MAX_TOTAL_BYTES)
                .unwrap_or(usize::MAX)
                .saturating_mul(2),
        );
    let mut document = match format {
        "epub" => container::extract_epub(bytes, &skip),
        "docx" | "dotx" => container::extract_docx(bytes, &skip),
        "odt" | "odp" | "ods" => container::extract_odf(bytes, format, &skip),
        "pptx" | "potx" | "ppsx" => container::extract_pptx(bytes, &skip),
        "xlsx" | "xltx" => extract_xlsx_with_budget(bytes, remaining, &skip),
        "hwpx" => container::extract_hwpx(bytes, &skip),
        _ => Err(ExtractFailure::Unsupported),
    }
    .or_else(|reason| {
        if reason == ExtractFailure::Empty
            && !children.is_empty()
            && !matches!(format, "pptx" | "potx" | "ppsx" | "xlsx" | "xltx")
        {
            Ok(ExtractedDocument::new())
        } else {
            Err(reason)
        }
    })?;
    budget.output(&document)?;
    for child in children {
        let raw = binary_part(&mut archive, &child.part, budget)?;
        budget.check_memory(parser_space)?;
        let mut extracted = if child.text && !raw.starts_with(b"PK") {
            plain_text(&raw, &child.part)?
        } else if child.markup && !raw.starts_with(b"PK") {
            container::standalone_part(&raw, &child.part)?
        } else {
            let actual = actual_format(&raw, budget)?;
            walk(actual, &raw, depth.saturating_add(1), budget)?
        };
        if (child.text || child.markup) && !raw.starts_with(b"PK") {
            budget.output(&extracted)?;
        }
        for source in &child.related {
            if !source.starts_with("ppt/charts/") {
                continue;
            }
            budget.admit(source.len().saturating_mul(2))?;
            let (directory, file) = source.rsplit_once('/').ok_or(ExtractFailure::Corrupt)?;
            budget.reread(&mut archive, source)?;
            budget.reread(&mut archive, &format!("{directory}/_rels/{file}.rels"))?;
            budget.check_memory(parser_space)?;
            if let Some(replacement) =
                container::nested_chart_aliases(&mut archive, source, &child.part, &mut extracted)?
            {
                replace_part(&mut document, source, &replacement, budget)?;
            }
        }
        annotate(
            &child,
            (child.text || child.markup) && !raw.starts_with(b"PK"),
            &mut extracted,
            budget,
        )?;
        merge_child(&mut document, extracted, &child.part, budget)?;
    }
    document.insertions.clear();
    if document.text.trim().is_empty() && document.metadata_parts.is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(document)
}

/// 인접 노드는 byte 위치가 같아도 XML 노드 순서를 유지합니다.
fn merge_child(
    document: &mut ExtractedDocument,
    extracted: ExtractedDocument,
    part: &str,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    let slots: Vec<_> = document
        .insertions
        .iter()
        .enumerate()
        .filter(|(_, (_, target))| target.eq_ignore_ascii_case(part))
        .map(|(index, _)| index)
        .collect();
    if slots.is_empty() {
        return merge(document, extracted, budget);
    }
    for (repeat, slot) in slots.iter().rev().enumerate() {
        if repeat > 0 {
            budget.output(&extracted)?;
        }
        let position = document
            .insertions
            .get(*slot)
            .ok_or(ExtractFailure::Corrupt)?
            .0;
        insert_at(document, &extracted, position, *slot, budget)?;
    }
    Ok(())
}

/// 자식의 기존 좌표는 보존하고 바깥 embedding 주소 체인만 덧붙입니다.
fn annotate(
    child: &Child,
    standalone: bool,
    extracted: &mut ExtractedDocument,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    let chain_bytes = child
        .related
        .iter()
        .map(|s| s.len().saturating_add(64))
        .fold(child.part.len().saturating_add(512), usize::saturating_add);
    budget.admit(
        chain_bytes
            .saturating_mul(
                extracted
                    .segments
                    .len()
                    .saturating_add(extracted.metadata_parts.len())
                    .saturating_add(1),
            )
            .saturating_mul(8),
    )?;
    let chain = serde_json::json!({ "sourcePart": child.part, "relatedTo": child.related });
    for part in &mut extracted.metadata_parts {
        let source = part
            .get("sourcePart")
            .and_then(JsonValue::as_str)
            .unwrap_or("");
        let projected = format!("{}!/{source}", child.part);
        super::insert_location(part, "sourcePart", projected.into())?;
        if let Some(locator) = part.get_mut("locator") {
            super::insert_location(locator, "containerChain", serde_json::json!([chain]))?;
        }
    }
    for segment in &mut extracted.segments {
        let part = segment.source_part.as_deref().unwrap_or("");
        segment.source_part = Some(if standalone {
            child.part.clone()
        } else {
            format!("{}!/{part}", child.part)
        });
        segment.label = format!("{} › {}", child.part, segment.label);
        let mut locator = segment
            .locator
            .take()
            .unwrap_or_else(|| serde_json::json!({}));
        if let Some(aliases) = locator.get_mut("aliases").and_then(JsonValue::as_array_mut) {
            for alias in aliases {
                if let Some(source) = alias.get("sourcePart").and_then(JsonValue::as_str)
                    && !child.related.iter().any(|part| part == source)
                {
                    let source = format!("{}!/{source}", child.part);
                    super::insert_location(alias, "sourcePart", source.into())?;
                }
            }
        }
        let object = locator.as_object_mut().ok_or(ExtractFailure::Corrupt)?;
        let previous = object
            .remove("containerChain")
            .unwrap_or_else(|| serde_json::json!([]));
        let mut parents = vec![chain.clone()];
        parents.extend(
            previous
                .as_array()
                .ok_or(ExtractFailure::Corrupt)?
                .iter()
                .cloned(),
        );
        object.insert("containerChain".to_owned(), parents.into());
        budget.retained = budget
            .retained
            .saturating_add(locator.to_string().len().saturating_mul(4))
            .saturating_add(segment.label.len())
            .saturating_add(segment.source_part.as_ref().map_or(0, String::len));
        budget.check_memory(0)?;
        segment.locator = Some(locator);
    }
    Ok(())
}

/// 합성 source prefix는 본문이 아니라 메타데이터에만 붙입니다.
fn merge(
    parent: &mut ExtractedDocument,
    child: ExtractedDocument,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    parent.metadata_parts.extend(child.metadata_parts);
    if child.text.is_empty() {
        return Ok(());
    }
    let offset = if parent.text.is_empty() {
        0
    } else {
        parent
            .text
            .bytes()
            .filter(|b| *b == b'\n')
            .count()
            .saturating_add(2)
    };
    let required = parent
        .text
        .len()
        .saturating_add(child.text.len())
        .saturating_add(2);
    budget.check_memory(required.saturating_mul(4))?;
    if !parent.text.is_empty() {
        budget.chars = budget.chars.saturating_add(2);
        if !budget.streaming && budget.chars > MAX_TEXT_CHARS {
            return Err(ExtractFailure::TooLarge);
        }
        parent.text.push_str("\n\n");
    }
    parent.text.push_str(&child.text);
    for mut segment in child.segments {
        shift_segment(&mut segment, 0, offset);
        parent.segments.push(segment);
    }
    Ok(())
}

/// 차트의 증명된 캐시만 다시 렌더링하고 이후 모든 구간 좌표를 재계산합니다.
fn replace_part(
    parent: &mut ExtractedDocument,
    part: &str,
    replacement: &ExtractedDocument,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    budget.admit(
        parent
            .text
            .len()
            .saturating_add(replacement.text.len())
            .saturating_mul(4),
    )?;
    let mut rebuilt = ExtractedDocument::new();
    for segment in &parent.segments {
        let body = if segment.source_part.as_deref() == Some(part) {
            replacement.text.clone()
        } else {
            parent
                .text
                .split('\n')
                .skip(segment.start_line)
                .take(
                    segment
                        .end_line
                        .saturating_sub(segment.start_line)
                        .saturating_add(1),
                )
                .collect::<Vec<_>>()
                .join("\n")
        };
        let start = rebuilt.next_line;
        rebuilt.push_segment(&segment.label, &body);
        if let Some(last) = rebuilt.segments.last_mut()
            && !body.trim().is_empty()
        {
            last.source_part.clone_from(&segment.source_part);
            last.locator.clone_from(&segment.locator);
            relocate_cells(last, segment.start_line, start);
        }
    }
    if rebuilt.conflicted() {
        return Err(ExtractFailure::TooLarge);
    }
    rebuilt.metadata_parts = std::mem::take(&mut parent.metadata_parts);
    *parent = rebuilt;
    Ok(())
}

/// 본문과 분할 구간 복사 전에 공간을 예약합니다.
fn reserve_insertion(
    parent: &ExtractedDocument,
    child: &ExtractedDocument,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    budget.admit(
        parent
            .text
            .len()
            .saturating_add(child.text.len())
            .saturating_mul(4)
            .saturating_add(
                parent
                    .segments
                    .iter()
                    .chain(&child.segments)
                    .map(|s| {
                        s.locator.as_ref().map_or(512, |v| {
                            v.to_string().len().saturating_mul(8).saturating_add(512)
                        })
                    })
                    .fold(0usize, usize::saturating_add),
            ),
    )?;
    Ok(())
}

/// 같은 본문 참조의 반복은 관계 중복과 달리 실제 삽입마다 본문을 보존합니다.
fn insert_at(
    parent: &mut ExtractedDocument,
    child: &ExtractedDocument,
    position: usize,
    slot: usize,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    let before = parent.text.get(..position).ok_or(ExtractFailure::Corrupt)?;
    let after = parent.text.get(position..).ok_or(ExtractFailure::Corrupt)?;
    let prefix = before.trim_end_matches(['\r', '\n']);
    let suffix = after.trim_start_matches(['\r', '\n']);
    let old_suffix = parent.text.len().saturating_sub(suffix.len());
    let suffix_line = parent
        .text
        .get(..old_suffix)
        .ok_or(ExtractFailure::Corrupt)?
        .bytes()
        .filter(|b| *b == b'\n')
        .count();
    let child_line = if prefix.is_empty() {
        0
    } else {
        prefix
            .bytes()
            .filter(|b| *b == b'\n')
            .count()
            .saturating_add(2)
    };
    let child_end = child_line.saturating_add(child.text.bytes().filter(|b| *b == b'\n').count());
    let new_suffix_line = if child.text.is_empty() {
        child_line
    } else {
        child_end.saturating_add(2)
    };
    let delta = new_suffix_line.saturating_sub(suffix_line);
    reserve_insertion(parent, child, budget)?;
    let mut text = prefix.to_owned();
    if !text.is_empty() && !child.text.is_empty() {
        text.push_str("\n\n");
    }
    text.push_str(&child.text);
    if !text.is_empty() && !suffix.is_empty() {
        text.push_str("\n\n");
    }
    let suffix_byte = text.len();
    text.push_str(suffix);
    let prefix_end = prefix.bytes().filter(|b| *b == b'\n').count();
    let mut segments = Vec::new();
    for segment in &parent.segments {
        if segment.start_line <= prefix_end && !prefix.is_empty() {
            let mut before = segment.clone();
            before.end_line = before.end_line.min(prefix_end);
            segments.push(before);
        }
    }
    for segment in &child.segments {
        let mut segment = segment.clone();
        shift_segment(&mut segment, 0, child_line);
        segments.push(segment);
    }
    for segment in &parent.segments {
        if segment.end_line >= suffix_line && !suffix.is_empty() {
            let mut after = segment.clone();
            after.start_line = after.start_line.max(suffix_line);
            shift_segment(&mut after, suffix_line, delta);
            segments.push(after);
        }
    }
    if segments.len() > MAX_SEGMENTS {
        return Err(ExtractFailure::TooLarge);
    }
    for (index, (offset, _)) in parent.insertions.iter_mut().enumerate() {
        if *offset > old_suffix || (*offset == old_suffix && index > slot) {
            *offset = suffix_byte.saturating_add(offset.saturating_sub(old_suffix));
        }
    }
    if let Some((_, target)) = parent.insertions.get_mut(slot) {
        target.clear();
    }
    budget.segments = budget.segments.saturating_add(
        segments
            .len()
            .saturating_sub(parent.segments.len())
            .saturating_sub(child.segments.len()),
    );
    if budget.segments > MAX_SEGMENTS {
        return Err(ExtractFailure::TooLarge);
    }
    let old_chars = parent.text.chars().count();
    budget.chars = budget.chars.saturating_add(
        text.chars()
            .count()
            .saturating_sub(old_chars)
            .saturating_sub(child.text.chars().count()),
    );
    if !budget.streaming && budget.chars > MAX_TEXT_CHARS {
        return Err(ExtractFailure::TooLarge);
    }
    parent.text = text;
    parent.segments = segments;
    parent
        .metadata_parts
        .extend(child.metadata_parts.iter().cloned());
    Ok(())
}

/// 구간과 실제 XLSX 셀/수식의 절대 줄 좌표를 함께 이동합니다.
fn shift_segment(segment: &mut super::ExtractedSegment, from: usize, offset: usize) {
    segment.start_line = segment.start_line.saturating_add(offset);
    segment.end_line = segment.end_line.saturating_add(offset);
    relocate_cells(segment, from, from.saturating_add(offset));
}

/// 재렌더링의 역방향 이동도 원래 구간 기준으로 계산합니다.
fn relocate_cells(segment: &mut super::ExtractedSegment, from: usize, to: usize) {
    if let Some(cells) = segment
        .locator
        .as_mut()
        .and_then(|v| v.get_mut("cells"))
        .and_then(JsonValue::as_array_mut)
    {
        for cell in cells {
            for key in ["startLine", "endLine", "formulaStartLine", "formulaEndLine"] {
                if let Some(value) = cell.get_mut(key)
                    && let Some(line) = value.as_u64()
                    && line >= u64::try_from(from).unwrap_or(u64::MAX)
                {
                    *value = line
                        .saturating_sub(u64::try_from(from).unwrap_or(u64::MAX))
                        .saturating_add(u64::try_from(to).unwrap_or(u64::MAX))
                        .into();
                }
            }
        }
    }
}

/// 참조된 바이트만 읽으며 할당 전에 공유 메모리 상한을 검사합니다.
fn binary_part(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    part: &str,
    budget: &mut Budget,
) -> Result<Vec<u8>, ExtractFailure> {
    let index = archive
        .file_names()
        .filter_map(Result::ok)
        .position(|name| name.eq_ignore_ascii_case(part))
        .ok_or(ExtractFailure::Corrupt)?;
    let file = archive.by_index(index).map_err(|error| match error {
        zip::result::ZipError::UnsupportedArchive(zip::result::ZipError::PASSWORD_REQUIRED)
        | zip::result::ZipError::InvalidPassword => ExtractFailure::Encrypted,
        _ => ExtractFailure::Corrupt,
    })?;
    if file.encrypted() {
        return Err(ExtractFailure::Encrypted);
    }
    let size = usize::try_from(file.size()).map_err(|_| ExtractFailure::TooLarge)?;
    if size > XLSX_SOURCE_BYTES {
        return Err(ExtractFailure::TooLarge);
    }
    budget.retained = budget.retained.saturating_add(size.saturating_mul(2));
    budget.check_memory(0)?;
    let mut raw = Vec::new();
    raw.try_reserve_exact(size)
        .map_err(|_| ExtractFailure::MemoryBudget)?;
    file.take(u64::try_from(size).unwrap_or(u64::MAX).saturating_add(1))
        .read_to_end(&mut raw)
        .map_err(|_| ExtractFailure::Corrupt)?;
    if raw.len() != size {
        return Err(ExtractFailure::Corrupt);
    }
    Ok(raw)
}

/// 기존 엄격 평문 decoder를 재사용해 제어문자를 성공 처리하지 않습니다.
fn plain_text(raw: &[u8], part: &str) -> Result<ExtractedDocument, ExtractFailure> {
    let wire = crate::text_decode::decode_source_bytes_json(
        raw,
        true,
        f64::from(u32::try_from(raw.len()).map_err(|_| ExtractFailure::TooLarge)?),
    );
    let value: JsonValue = serde_json::from_str(&wire).map_err(|_| ExtractFailure::Corrupt)?;
    if value.get("ok").and_then(JsonValue::as_bool) != Some(true) {
        return Err(ExtractFailure::Corrupt);
    }
    let body = value
        .get("text")
        .and_then(JsonValue::as_str)
        .ok_or(ExtractFailure::Corrupt)?;
    let mut document = ExtractedDocument::new();
    document.push_segment(part, body);
    if document.conflicted() {
        return Err(ExtractFailure::TooLarge);
    }
    for segment in &mut document.segments {
        segment.source_part = Some(part.to_owned());
    }
    if document.text.trim().is_empty() {
        return Err(ExtractFailure::Empty);
    }
    Ok(document)
}

/// 확장자가 아닌 표준 mimetype과 주 part로 실제 ZIP 문서를 판정합니다.
fn actual_format(bytes: &[u8], shared: &mut Budget) -> Result<&'static str, ExtractFailure> {
    if bytes.starts_with(b"%PDF-")
        || bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    {
        return Err(ExtractFailure::Unsupported);
    }
    let mut archive = open_archive(bytes)?;
    let names: HashSet<_> = archive
        .file_names()
        .filter_map(Result::ok)
        .map(|n| n.to_ascii_lowercase())
        .collect();
    let mut budget = 0;
    for name in ["mimetype", "[Content_Types].xml"] {
        let index = archive
            .file_names()
            .filter_map(Result::ok)
            .position(|n| n.eq_ignore_ascii_case(name));
        if let Some(index) = index {
            let file = archive
                .by_index_raw(index)
                .map_err(|_| ExtractFailure::Corrupt)?;
            let size = usize::try_from(file.size()).map_err(|_| ExtractFailure::TooLarge)?;
            if size > 4 * 1024 * 1024 {
                return Err(ExtractFailure::TooLarge);
            }
            shared.retained = shared.retained.saturating_add(size.saturating_mul(8));
            shared.check_memory(
                usize::try_from(MAX_TOTAL_BYTES)
                    .unwrap_or(usize::MAX)
                    .saturating_mul(4),
            )?;
        }
    }
    if let Some(xml) = read_entry(&mut archive, "[Content_Types].xml", &mut budget)?
        && let Some(format) = ooxml_format(&xml)?
    {
        return Ok(format);
    }
    if let Some(mime) = read_entry(&mut archive, "mimetype", &mut budget)? {
        return match mime.trim() {
            "application/epub+zip" => Ok("epub"),
            "application/vnd.oasis.opendocument.text" => Ok("odt"),
            "application/vnd.oasis.opendocument.presentation" => Ok("odp"),
            "application/vnd.oasis.opendocument.spreadsheet" => Ok("ods"),
            "application/hwp+zip" => Ok("hwpx"),
            _ => Err(ExtractFailure::Unsupported),
        };
    }
    let formats: Vec<_> = [
        ("word/document.xml", "docx"),
        ("ppt/presentation.xml", "pptx"),
        ("xl/workbook.xml", "xlsx"),
        ("meta-inf/container.xml", "epub"),
        ("contents/content.hpf", "hwpx"),
    ]
    .into_iter()
    .filter(|(part, _)| names.contains(*part))
    .map(|(_, format)| format)
    .collect();
    if formats.len() == 1 {
        return formats.first().copied().ok_or(ExtractFailure::Corrupt);
    }
    if formats.len() > 1 {
        return Err(ExtractFailure::Corrupt);
    }
    // 기존 최소 저장 패키지 fixture와 같은 주 part 계약입니다.
    if names
        .iter()
        .any(|n| n.starts_with("xl/worksheets/sheet") && has_extension(n, "xml"))
    {
        return Ok("xlsx");
    }
    if names
        .iter()
        .any(|n| n.starts_with("ppt/slides/slide") && has_extension(n, "xml"))
    {
        return Ok("pptx");
    }
    if names.contains("contents/section0.xml") {
        return Ok("hwpx");
    }
    Err(ExtractFailure::Unsupported)
}

/// 같은 자식의 여러 relationship을 한 출력과 참조 원본 목록으로 합칩니다.
fn add_child(
    result: &mut Vec<Child>,
    part: &str,
    source: &str,
    text: bool,
    markup: bool,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    if let Some(child) = result
        .iter_mut()
        .find(|child| child.part.eq_ignore_ascii_case(part))
    {
        if !child.related.iter().any(|s| s == source) {
            budget.admit(source.len().saturating_add(64))?;
            child.related.push(source.to_owned());
        }
    } else {
        if budget.children >= MAX_CHILDREN {
            return Err(ExtractFailure::TooLarge);
        }
        budget.admit(part.len().saturating_add(source.len()).saturating_add(256))?;
        budget.children = budget.children.saturating_add(1);
        result.push(Child {
            part: part.to_owned(),
            related: vec![source.to_owned()],
            text,
            markup,
        });
    }
    Ok(())
}

/// 패키지 관계와 표준 manifest 밖의 ZIP 엔트리를 자식 문서로 삼지 않습니다.
fn children(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    budget: &mut Budget,
) -> Result<Vec<Child>, ExtractFailure> {
    let mut names = Vec::new();
    for name in archive.file_names().filter_map(Result::ok) {
        budget.admit(name.len().saturating_mul(2).saturating_add(64))?;
        names.push(name.into_owned());
    }
    names.sort();
    let mut result = Vec::new();
    let mut bytes = 0;
    let plain = plain_parts(archive, &names, &mut bytes)?;
    for name in &names {
        if !has_extension(name, "rels") || !(name.starts_with("_rels/") || name.contains("/_rels/"))
        {
            continue;
        }
        budget.admit(name.len().saturating_mul(3))?;
        let source = if name == "_rels/.rels" {
            String::new()
        } else {
            name.replacen("_rels/", "", 1)
                .strip_suffix(".rels")
                .ok_or(ExtractFailure::Corrupt)?
                .to_owned()
        };
        if !source.is_empty() && !names.iter().any(|n| n == &source) {
            continue;
        }
        let xml = read_entry(archive, name, &mut bytes)?.ok_or(ExtractFailure::Corrupt)?;
        let tree = container::parse(&xml)?;
        let mut relations = Vec::new();
        tree.descendants("Relationship", &mut relations);
        let mut ids = HashSet::new();
        for relation in relations {
            let id = relation.attr("Id").ok_or(ExtractFailure::Corrupt)?;
            if !ids.insert(id) {
                return Err(ExtractFailure::Corrupt);
            }
            if relation
                .attr("TargetMode")
                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
            {
                continue;
            }
            let kind = relation
                .attr("Type")
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("");
            if !matches!(kind, "package" | "oleObject" | "aFChunk") {
                continue;
            }
            let target = relation.attr("Target").ok_or(ExtractFailure::Corrupt)?;
            budget.admit(source.len().saturating_add(target.len()).saturating_mul(4))?;
            let part = container::internal_target(&source, target)?;
            if !names.iter().any(|n| n.eq_ignore_ascii_case(&part)) {
                return Err(ExtractFailure::Corrupt);
            }
            let lower = part.to_ascii_lowercase();
            let text = kind == "aFChunk" && (has_extension(&lower, "txt") || plain.contains(&part));
            let markup = kind == "aFChunk"
                && !text
                && [".xml", ".xhtml", ".html", ".htm"]
                    .iter()
                    .any(|suffix| lower.ends_with(suffix));
            add_child(&mut result, &part, &source, text, markup, budget)?;
        }
    }
    manifest_children(archive, &names, &mut bytes, &mut result, budget)?;
    Ok(result)
}

/// 지원 문서와 명시적 실패가 필요한 PDF·구형/OLE 문서만 판별합니다.
fn document_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/epub+zip"
            | "application/pdf"
            | "application/msword"
            | "application/vnd.ms-excel"
            | "application/vnd.ms-powerpoint"
            | "application/vnd.sun.star.oleobject"
            | "application/x-hwp"
            | "application/hwp+zip"
            | "application/vnd.oasis.opendocument.text"
            | "application/vnd.oasis.opendocument.presentation"
            | "application/vnd.oasis.opendocument.spreadsheet"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.template"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            | "application/vnd.openxmlformats-officedocument.presentationml.template"
            | "application/vnd.openxmlformats-officedocument.presentationml.slideshow"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.template"
    )
}

/// 파일 시스템 접근 없이 ZIP part 확장자만 비교합니다.
fn has_extension(part: &str, extension: &str) -> bool {
    part.rsplit_once('.')
        .is_some_and(|(_, value)| value.eq_ignore_ascii_case(extension))
}

/// 표준 OOXML 주 part의 콘텐츠 유형만 문서 형식으로 해석합니다.
fn ooxml_format(xml: &str) -> Result<Option<&'static str>, ExtractFailure> {
    let tree = container::parse(xml)?;
    let mut overrides = Vec::new();
    tree.descendants("Override", &mut overrides);
    let mut main_format = None;
    for item in overrides {
        let mime = item.attr("ContentType").ok_or(ExtractFailure::Corrupt)?;
        let format = match mime {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" => {
                Some("docx")
            }
            "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml" => {
                Some("dotx")
            }
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml" => {
                Some("pptx")
            }
            "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml" => {
                Some("potx")
            }
            "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml" => {
                Some("ppsx")
            }
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" => {
                Some("xlsx")
            }
            "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml" => {
                Some("xltx")
            }
            _ => None,
        };
        if mime.to_ascii_lowercase().contains("macroenabled") {
            return Err(ExtractFailure::Unsupported);
        }
        if let Some(format) = format
            && main_format.replace(format).is_some()
        {
            return Err(ExtractFailure::Corrupt);
        }
    }
    if let Some(format) = main_format {
        return Ok(Some(format));
    }
    Ok(None)
}

/// altChunk 평문은 콘텐츠 유형 또는 기존 txt 계약으로 판별합니다.
fn plain_parts(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    names: &[String],
    bytes: &mut u64,
) -> Result<HashSet<String>, ExtractFailure> {
    let mut plain = HashSet::new();
    if let Some(xml) = read_entry(archive, "[Content_Types].xml", bytes)? {
        let tree = container::parse(&xml)?;
        let mut overrides = Vec::new();
        tree.descendants("Override", &mut overrides);
        for item in overrides {
            if item.attr("ContentType") == Some("text/plain") {
                plain.insert(container::internal_target(
                    "",
                    item.attr("PartName").ok_or(ExtractFailure::Corrupt)?,
                )?);
            }
        }
        let mut defaults = Vec::new();
        tree.descendants("Default", &mut defaults);
        for item in defaults {
            if item.attr("ContentType") == Some("text/plain") {
                let extension = item.attr("Extension").ok_or(ExtractFailure::Corrupt)?;
                for part in names {
                    if part
                        .rsplit_once('.')
                        .is_some_and(|(_, ext)| ext.eq_ignore_ascii_case(extension))
                    {
                        plain.insert(part.clone());
                    }
                }
            }
        }
    }
    Ok(plain)
}

/// 표준 패키지 manifest에 등록된 문서만 추가합니다.
fn manifest_children(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    names: &[String],
    bytes: &mut u64,
    result: &mut Vec<Child>,
    budget: &mut Budget,
) -> Result<(), ExtractFailure> {
    for name in names {
        if !(has_extension(name, "opf")
            || has_extension(name, "hpf")
            || name == "META-INF/manifest.xml")
        {
            continue;
        }
        let xml = read_entry(archive, name, bytes)?.ok_or(ExtractFailure::Corrupt)?;
        let tree = container::parse(&xml)?;
        for tag in ["item", "file-entry"] {
            let mut items = Vec::new();
            tree.descendants(tag, &mut items);
            for item in items {
                let mime = item
                    .attr("media-type")
                    .or_else(|| item.attr("manifest:media-type"))
                    .unwrap_or("");
                if !document_mime(mime) {
                    continue;
                }
                let href = item
                    .attr("href")
                    .or_else(|| item.attr("manifest:full-path"))
                    .ok_or(ExtractFailure::Corrupt)?;
                if href == "/" {
                    continue;
                }
                // shortcut: 디렉터리형 ODF 객체는 미지원이며 namespace view 추출기 도입 시 확장합니다.
                if href.ends_with('/') {
                    return Err(ExtractFailure::Unsupported);
                }
                let base = if tag == "file-entry" {
                    ""
                } else {
                    name.as_str()
                };
                budget.admit(base.len().saturating_add(href.len()).saturating_mul(4))?;
                let part = container::internal_target(base, href)?;
                if !names.iter().any(|n| n.eq_ignore_ascii_case(&part)) {
                    return Err(ExtractFailure::Corrupt);
                }
                add_child(result, &part, name, false, false, budget)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;

    /// 작은 독립 합성 ZIP으로 잔여 예산 경계를 검사합니다.
    fn archive_bytes() -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        assert!(
            writer
                .start_file("word/document.xml", SimpleFileOptions::default())
                .is_ok()
        );
        assert!(
            writer
                .write_all(b"<w:document><w:p><w:t>small</w:t></w:p></w:document>")
                .is_ok()
        );
        writer
            .finish()
            .map_or_else(|_| Vec::new(), Cursor::into_inner)
    }

    /// 리뷰 1: 발견 단계에서 33번째 child를 배열에 넣기 전에 거절합니다.
    #[test]
    fn source_extract_review_1_discovery_admission() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        assert!(
            writer
                .start_file("word/document.xml", SimpleFileOptions::default())
                .is_ok()
        );
        assert!(writer.write_all(b"<w:document/>").is_ok());
        let mut rels = String::from("<Relationships>");
        for index in 0..33 {
            let part = format!("child{index}.bin");
            assert!(
                write!(
                    rels,
                    "<Relationship Id='r{index}' Type='x/package' Target='{part}'/>"
                )
                .is_ok()
            );
            assert!(
                writer
                    .start_file(format!("word/{part}"), SimpleFileOptions::default())
                    .is_ok()
            );
            assert!(writer.write_all(b"not opened during discovery").is_ok());
        }
        rels.push_str("</Relationships>");
        assert!(
            writer
                .start_file("word/_rels/document.xml.rels", SimpleFileOptions::default())
                .is_ok()
        );
        assert!(writer.write_all(rels.as_bytes()).is_ok());
        let raw = writer
            .finish()
            .map_or_else(|_| Vec::new(), Cursor::into_inner);
        let archive = open_archive(&raw);
        assert!(archive.is_ok());
        let Ok(mut archive) = archive else {
            return;
        };
        let mut budget = Budget {
            entries: 0,
            inflated: 0,
            inflated_limit: MAX_TOTAL_BYTES,
            children: 0,
            chars: 0,
            segments: 0,
            retained: 0,
            streaming: false,
        };
        assert!(matches!(
            children(&mut archive, &mut budget),
            Err(ExtractFailure::TooLarge)
        ));
        assert_eq!(budget.children, MAX_CHILDREN);
    }

    /// 긴 원본 part와 512개 대상 공격도 33번째 발견에서 멈추고 자식 바이트는 열지 않습니다.
    #[test]
    fn source_extract_review_1_long_source_attack_and_related_memory() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let source = format!("word/{}.xml", "s".repeat(16 * 1024));
        let relpart = source.replacen("word/", "word/_rels/", 1) + ".rels";
        assert!(
            writer
                .start_file(&source, SimpleFileOptions::default())
                .is_ok()
        );
        assert!(writer.write_all(b"<w:document/>").is_ok());
        let mut rels = String::from("<Relationships>");
        for index in 0..512 {
            let part = format!("child{index}.bin");
            assert!(
                write!(
                    rels,
                    "<Relationship Id='r{index}' Type='x/package' Target='{part}'/>"
                )
                .is_ok()
            );
            assert!(
                writer
                    .start_file(format!("word/{part}"), SimpleFileOptions::default())
                    .is_ok()
            );
            assert!(writer.write_all(b"must not be parsed").is_ok());
        }
        rels.push_str("</Relationships>");
        assert!(
            writer
                .start_file(relpart, SimpleFileOptions::default())
                .is_ok()
        );
        assert!(writer.write_all(rels.as_bytes()).is_ok());
        let raw = writer
            .finish()
            .map_or_else(|_| Vec::new(), Cursor::into_inner);
        let archive = open_archive(&raw);
        assert!(archive.is_ok());
        let Ok(mut archive) = archive else {
            return;
        };
        let mut budget = Budget {
            entries: 0,
            inflated: 0,
            inflated_limit: MAX_TOTAL_BYTES,
            children: 0,
            chars: 0,
            segments: 0,
            retained: 0,
            streaming: false,
        };
        assert!(matches!(
            children(&mut archive, &mut budget),
            Err(ExtractFailure::TooLarge)
        ));
        assert_eq!(budget.children, MAX_CHILDREN);
        assert!(
            budget.retained < 4 * 1024 * 1024,
            "no cross-product relation allocation"
        );
        let mut result = Vec::new();
        budget.children = 0;
        budget.retained = 0;
        assert!(add_child(&mut result, "child.bin", &source, false, false, &mut budget).is_ok());
        let reserved = budget.retained;
        assert!(add_child(&mut result, "child.bin", &source, false, false, &mut budget).is_ok());
        assert_eq!(
            budget.retained, reserved,
            "duplicate relationship shares its stored source"
        );
        budget.retained = XLSX_MEMORY_BYTES.saturating_sub(source.len());
        let other = format!("{source}-other");
        assert!(matches!(
            add_child(&mut result, "child.bin", &other, false, false, &mut budget),
            Err(ExtractFailure::MemoryBudget)
        ));
        assert_eq!(
            result.first().map(|child| child.related.len()),
            Some(1),
            "rejected before copying related"
        );
    }

    /// 메타데이터를 관계/본문 경로에서 다시 읽는 압축 해제 비용도 예약합니다.
    #[test]
    fn source_extract_nested_metadata_inflation_is_cumulative() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        assert!(
            writer
                .start_file("word/_rels/document.xml.rels", SimpleFileOptions::default())
                .is_ok()
        );
        assert!(writer.write_all(b"<Relationships/>").is_ok());
        let bytes = writer
            .finish()
            .map_or_else(|_| Vec::new(), Cursor::into_inner);
        let mut budget = Budget {
            entries: 0,
            inflated: 0,
            inflated_limit: 32,
            children: 0,
            chars: 0,
            segments: 0,
            retained: 0,
            streaming: false,
        };
        let archive = open_archive(&bytes);
        assert!(archive.is_ok());
        let Ok(mut archive) = archive else {
            return;
        };
        assert!(matches!(
            budget.reserve(&mut archive, false),
            Err(ExtractFailure::TooLarge)
        ));
    }

    /// 자식마다 새 전체 상한을 주지 않고 누적 byte·entry·메모리 초과를 거절합니다.
    #[test]
    fn source_extract_nested_cumulative_budget_boundaries() {
        let bytes = archive_bytes();
        let mut budget = Budget {
            entries: 0,
            inflated: 0,
            inflated_limit: MAX_TOTAL_BYTES,
            children: 0,
            chars: 0,
            segments: 0,
            retained: 0,
            streaming: false,
        };
        assert!(walk("docx", &bytes, 1, &mut budget).is_ok());
        let size = budget.inflated;
        budget.inflated_limit = size.saturating_mul(2).saturating_sub(1);
        assert!(matches!(
            walk("docx", &bytes, 1, &mut budget),
            Err(ExtractFailure::TooLarge)
        ));
        budget.inflated = 0;
        budget.inflated_limit = MAX_TOTAL_BYTES;
        budget.entries = MAX_ARCHIVE_ENTRIES;
        assert!(matches!(
            walk("docx", &bytes, 1, &mut budget),
            Err(ExtractFailure::TooLarge)
        ));
        budget.entries = 0;
        budget.retained = XLSX_MEMORY_BYTES.saturating_sub(1);
        assert!(matches!(
            walk("docx", &bytes, 1, &mut budget),
            Err(ExtractFailure::MemoryBudget)
        ));
        budget.retained = 0;
        budget.entries = 0;
        budget.segments = MAX_SEGMENTS;
        assert!(matches!(
            walk("docx", &bytes, 1, &mut budget),
            Err(ExtractFailure::TooLarge)
        ));
    }
}
