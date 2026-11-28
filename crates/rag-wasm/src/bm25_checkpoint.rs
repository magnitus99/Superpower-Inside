//! Bounded, document-keyset pages of already-tokenized BM25 postings.

use crate::{Bm25FieldRun, Bm25IndexData, is_known_bm25_field};
use core::ops::Bound::{Excluded, Unbounded};
use flate2::{Compress, Compression, Decompress, FlushCompress, FlushDecompress, Status};
use std::rc::Rc;

/// The magic includes the binary schema version (not the tokenizer version).
const MAGIC: &[u8] = b"BMP\x01";
/// A page never grows past one MiB, even for an unsupported oversized row.
const PAGE_BYTES: usize = 1024 * 1024;
/// Bound both CPU work and wire volume per call.
const PAGE_ROWS: usize = 256;
/// Bytes before the raw/deflated row payload: magic, token version, row count, codec, length.
const HEADER_BYTES: usize = 17;

/// Append bytes within the page budget, without allocating a second row-sized buffer.
fn put(page: &mut Vec<u8>, bytes: &[u8]) -> Option<()> {
    if bytes.len() > PAGE_BYTES.saturating_sub(page.len()) {
        return None;
    }
    page.extend_from_slice(bytes);
    Some(())
}

/// Append a little-endian integer.
fn number(page: &mut Vec<u8>, n: u32) -> Option<()> {
    put(page, &n.to_le_bytes())
}

/// Append a length-prefixed UTF-8 string verbatim.
fn string(page: &mut Vec<u8>, text: &str) -> Option<()> {
    number(page, u32::try_from(text.len()).ok()?)?;
    put(page, text.as_bytes())
}

/// Encode one document's exact fields, terms and positions. No raw body is stored.
fn write_row(index: &Bm25IndexData, page: &mut Vec<u8>, id: &str, length: f64) -> Option<()> {
    let runs = index.doc_field_runs.get(id)?;
    let source = index.doc_sources.get(id)?;
    let terms = index.doc_terms.get(id).map_or(&[][..], Vec::as_slice);
    let tokens = runs
        .iter()
        .try_fold(0_u32, |sum, run| sum.checked_add(run.length))?;
    if f64::from(tokens).to_bits() != length.to_bits() || id.is_empty() || source.is_empty() {
        return None;
    }
    string(page, id)?;
    string(page, source)?;
    number(page, tokens)?;
    put(page, &[u8::try_from(runs.len()).ok()?])?;
    for run in runs {
        put(page, &[run.field])?;
        // Field runs are contiguous; start is inferred on read.
        number(page, run.length)?;
    }
    number(page, u32::try_from(terms.len()).ok()?)?;
    let mut previous = None;
    let mut remaining = tokens;
    for term in terms {
        if previous.is_some_and(|key: &str| key >= term.as_ref()) {
            return None;
        }
        let posting = index.posting(term);
        let positions = posting.positions_for(id)?;
        let count = u32::try_from(positions.len()).ok()?;
        if count == 0 || posting.frequency_for(id)?.to_bits() != f64::from(count).to_bits() {
            return None;
        }
        remaining = remaining.checked_sub(count)?;
        string(page, term)?;
        number(page, count)?;
        for position in positions {
            number(page, *position)?;
        }
        previous = Some(term.as_ref());
    }
    (remaining == 0).then_some(())
}

/// Export a single ordered page from the runtime's existing ordered document map.
pub fn export(index: &Bm25IndexData, cursor: &mut Option<String>) -> Option<Vec<u8>> {
    let mut page = Vec::with_capacity(PAGE_BYTES);
    put(&mut page, MAGIC)?;
    number(&mut page, index.tokenizer_version)?;
    let count_offset = page.len();
    number(&mut page, 0)?;
    put(&mut page, &[0])?;
    number(&mut page, 0)?;
    let mut rows = 0_u32;
    let mut last = None;
    let lower = cursor.as_deref().map_or(Unbounded, Excluded);
    for (id, length) in index
        .doc_lengths
        .range::<str, _>((lower, Unbounded))
        .take(PAGE_ROWS)
    {
        let start = page.len();
        if write_row(index, &mut page, id, *length).is_none() {
            if rows == 0 {
                return None;
            }
            page.truncate(start);
            break;
        }
        last = Some(id);
        rows += 1;
    }
    if let Some(id) = last {
        *cursor = Some(id.clone());
        page.get_mut(count_offset..count_offset + 4)?
            .copy_from_slice(&rows.to_le_bytes());
        encode_page(page)
    } else {
        Some(Vec::new())
    }
}

/// Bounded wire cursor. No claimed length is allocated before checking the page remainder.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    /// Consume `count` bytes (or reject truncation).
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let (read, rest) = self.0.split_at_checked(count)?;
        self.0 = rest;
        Some(read)
    }

    /// Read an integer.
    fn number(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    /// Read a nonempty UTF-8 identifier or term without copying the wire.
    fn string(&mut self) -> Option<&'a str> {
        let count = usize::try_from(self.number()?).ok()?;
        if count == 0 {
            return None;
        }
        core::str::from_utf8(self.take(count)?).ok()
    }
}

/// Decode one document directly into the single candidate runtime; failure invalidates that runtime.
fn read_row(
    index: &mut Bm25IndexData,
    reader: &mut Reader<'_>,
    seen: &mut Vec<bool>,
    positions: &mut Vec<u32>,
) -> Option<()> {
    let id = reader.string()?;
    let source = reader.string()?;
    let length = reader.number()?;
    let tokens = usize::try_from(length).ok()?;
    if tokens > reader.0.len().checked_div(4)?
        || index
            .posting_base
            .last_imported_id()
            .is_some_and(|last| last >= id)
    {
        return None;
    }
    let fields = *reader.take(1)?.first()?;
    if fields > 5 {
        return None;
    }
    let mut start = 0_u32;
    let mut previous_field = 0_u8;
    let mut runs = Vec::with_capacity(usize::from(fields));
    for _ in 0..fields {
        let field = *reader.take(1)?.first()?;
        let length = reader.number()?;
        if !is_known_bm25_field(field) || length == 0 || field <= previous_field {
            return None;
        }
        previous_field = field;
        runs.push(Bm25FieldRun {
            field,
            start,
            length,
        });
        start = start.checked_add(length)?;
    }
    let term_count = usize::try_from(reader.number()?).ok()?;
    if start != length || term_count > tokens {
        return None;
    }
    seen.clear();
    seen.resize(tokens, false);
    let mut membership = Vec::with_capacity(term_count);
    let posting_id = Rc::<str>::from(id);
    let ordinal = index.posting_base.next_document()?;
    let mut remaining = length;
    let mut previous_term = None;
    for _ in 0..term_count {
        let term = reader.string()?;
        let frequency = reader.number()?;
        if frequency == 0 || previous_term.is_some_and(|key: &str| key >= term) {
            return None;
        }
        remaining = remaining.checked_sub(frequency)?;
        positions.clear();
        let mut previous_position = None;
        for _ in 0..frequency {
            let position = reader.number()?;
            let flag = seen.get_mut(usize::try_from(position).ok()?)?;
            if *flag || previous_position.is_some_and(|last| last >= position) {
                return None;
            }
            *flag = true;
            positions.push(position);
            previous_position = Some(position);
        }
        membership.push(index.posting_base.push(term, ordinal, positions)?);
        previous_term = Some(term);
    }
    if remaining != 0 {
        return None;
    }
    index.doc_lengths.insert(id.to_owned(), f64::from(length));
    index.doc_field_runs.insert(id.to_owned(), runs);
    index.doc_sources.insert(id.to_owned(), source.to_owned());
    index.doc_terms.insert(Rc::clone(&posting_id), membership);
    index.posting_base.push_document(Rc::clone(&posting_id));
    index
        .source_docs
        .entry(source.to_owned())
        .or_default()
        .insert(posting_id);
    Some(())
}

/// Deflate independently per page, and keep the raw block for incompressible data.
fn encode_page(mut page: Vec<u8>) -> Option<Vec<u8>> {
    let body_length = u32::try_from(page.len().checked_sub(HEADER_BYTES)?).ok()?;
    page.get_mut(HEADER_BYTES - 4..HEADER_BYTES)?
        .copy_from_slice(&body_length.to_le_bytes());
    let mut compressed = Vec::with_capacity(page.len());
    compressed.extend_from_slice(page.get(..HEADER_BYTES)?);
    *compressed.get_mut(HEADER_BYTES - 5)? = 1;
    let status = Compress::new(Compression::fast(), false)
        .compress_vec(
            page.get(HEADER_BYTES..)?,
            &mut compressed,
            FlushCompress::Finish,
        )
        .ok()?;
    if status == Status::StreamEnd && compressed.len() < page.len() {
        Some(compressed)
    } else {
        Some(page)
    }
}

/// Apply a complete set of rows and reject trailing payload bytes.
fn apply_rows(index: &mut Bm25IndexData, rows: &[u8], count: usize) -> Option<()> {
    let mut reader = Reader(rows);
    let mut seen = Vec::new();
    let mut positions = Vec::new();
    for _ in 0..count {
        read_row(index, &mut reader, &mut seen, &mut positions)?;
    }
    reader.0.is_empty().then_some(())
}

/// Apply one complete binary page to a not-yet-published runtime.
pub fn apply(index: &mut Bm25IndexData, page: &[u8]) -> Option<()> {
    if page.len() > PAGE_BYTES {
        return None;
    }
    let mut reader = Reader(page);
    if reader.take(MAGIC.len())? != MAGIC || reader.number()? != index.tokenizer_version {
        return None;
    }
    let count = usize::try_from(reader.number()?).ok()?;
    if count == 0 || count > PAGE_ROWS {
        return None;
    }
    let codec = *reader.take(1)?.first()?;
    let length = usize::try_from(reader.number()?).ok()?;
    if length == 0 || length > PAGE_BYTES - HEADER_BYTES {
        return None;
    }
    match codec {
        0 if reader.0.len() == length => apply_rows(index, reader.0, count),
        1 => {
            let mut decoder = Decompress::new(false);
            let mut payload = Vec::with_capacity(length);
            let status = decoder
                .decompress_vec(reader.0, &mut payload, FlushDecompress::Finish)
                .ok()?;
            if status != Status::StreamEnd
                || payload.len() != length
                || usize::try_from(decoder.total_in()).ok()? != reader.0.len()
            {
                return None;
            }
            apply_rows(index, &payload, count)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use crate::Bm25RuntimeIndex;

    #[test]
    fn posting_pages_bound_individual_record_and_deflated_payload() {
        let mut oversized = Bm25RuntimeIndex::new(4);
        oversized.add_document(&"가".repeat(400_000), "ordinary", "source.md", 4);
        assert_eq!(
            oversized.next_posting_page(true),
            vec![0],
            "unsupported row cannot exceed the page budget"
        );
        let mut source = Bm25RuntimeIndex::new(4);
        for id in 0..32 {
            source.add_document(
                &format!("fixture-{id}"),
                "alpha beta gamma alpha beta",
                "source.md",
                4,
            );
        }
        let mut page = source.next_posting_page(true);
        assert_eq!(page.get(12), Some(&1), "fixture should use deflate");
        assert!(
            Bm25RuntimeIndex::new(4).apply_posting_page(&page),
            "valid deflate page must decode"
        );
        page.push(0);
        assert!(
            !Bm25RuntimeIndex::new(4).apply_posting_page(&page),
            "trailing compressed data is invalid"
        );
        if let Some(length) = page.get_mut(13..17) {
            length.copy_from_slice(&u32::MAX.to_le_bytes());
        }
        assert!(
            !Bm25RuntimeIndex::new(4).apply_posting_page(&page),
            "declared oversize output cannot allocate or import"
        );
    }

    #[test]
    fn posting_pages_restore_fields_positions_and_mutable_membership() {
        let mut source = Bm25RuntimeIndex::new(4);
        for id in ["😀", "a", "\u{e000}", "zero"] {
            let text = if id == "zero" {
                ""
            } else {
                "Ａlpha beta alpha 한글"
            };
            if id == "zero" {
                source.add_document(id, text, "zero.md", 4);
            } else {
                assert_eq!(
                    source.add_document_fields_json(
                        id,
                        text,
                        "공유.md",
                        r#"{"title":"special","tags":["tag"]}"#,
                        4
                    ),
                    1,
                    "fixture must index"
                );
            }
        }
        let mut restored = Bm25RuntimeIndex::new(4);
        assert!(
            restored.apply_posting_page(&source.next_posting_page(true)),
            "first posting page"
        );
        assert!(
            !restored.is_ready(),
            "a partially imported candidate is not serving"
        );
        assert!(
            restored.finish_posting_import(4),
            "seal exact document count"
        );
        assert!(restored.is_ready(), "sealed candidate can serve");
        assert!(
            source.next_posting_page(false).is_empty(),
            "EOF is separate from the last page"
        );
        assert_eq!(
            source.to_json(),
            restored.to_json(),
            "all persisted postings must be identical"
        );
        assert_eq!(
            source.search_json("\"alpha beta\""),
            restored.search_json("\"alpha beta\""),
            "phrase positions"
        );
        assert_eq!(
            source.search_json("title:special"),
            restored.search_json("title:special"),
            "field runs"
        );
        for index in [&mut source, &mut restored] {
            index.remove_document("a", 4);
            index.add_document("a", "alpha delta", "other.md", 4);
            index.add_document("0", "alpha beta", "공유.md", 4);
        }
        for query in ["alpha", "alp*", "alpa", "\"alpha beta\"", "title:special"] {
            assert_eq!(
                source.search_json(query),
                restored.search_json(query),
                "{query}"
            );
            assert_eq!(
                source.search_representatives_json(query, 8, r#"["other.md"]"#),
                restored.search_representatives_json(query, 8, r#"["other.md"]"#),
                "scoped {query}",
            );
            assert_eq!(
                source.aggregate_json(query, 8),
                restored.aggregate_json(query, 8)
            );
        }
        for reset in [true, false] {
            assert_eq!(
                source.next_posting_page(reset),
                restored.next_posting_page(reset)
            );
        }
        source.remove_source("공유.md", 4);
        restored.remove_source("공유.md", 4);
        assert_eq!(
            source.to_json(),
            restored.to_json(),
            "restored inverse membership must support deletion"
        );
    }

    #[test]
    fn posting_base_compacts_tombstones_and_keeps_scope_order_and_arena_positions() {
        let mut source = Bm25RuntimeIndex::new(4);
        let mut restored = Bm25RuntimeIndex::new(4);
        for n in 0..650 {
            let text = if n % 3 == 0 {
                "alpha alpha delta alpha"
            } else {
                "beta alpha delta beta"
            };
            source.add_document(
                &format!("doc-{n:04}"),
                text,
                if n % 2 == 0 { "even.md" } else { "odd.md" },
                4,
            );
        }
        let mut page = source.next_posting_page(true);
        while !page.is_empty() {
            assert!(
                restored.apply_posting_page(&page),
                "ordered checkpoint page must append"
            );
            page = source.next_posting_page(false);
        }
        assert!(
            !restored.finish_posting_import(649),
            "a different expected count cannot seal"
        );
        assert!(
            !restored.is_ready(),
            "a rejected seal is not a serving candidate"
        );
        assert!(
            restored.finish_posting_import(650),
            "full exact count seals"
        );
        for index in [&mut source, &mut restored] {
            index.remove_source("even.md", 4);
            for n in (1..400).step_by(2) {
                index.remove_document(&format!("doc-{n:04}"), 4);
            }
            index.add_document("doc-0035", "alpha beta delta", "new.md", 4);
            index.add_document("doc-0565", "alpha delta alpha delta", "new.md", 4);
        }
        assert_eq!(
            source.to_json(),
            restored.to_json(),
            "packed arenas must retain exact positions after compaction"
        );
        for scope in ["null", "[]", r#"["new.md"]"#, r#"["new.md","odd.md"]"#] {
            assert_eq!(
                source.search_representatives_json("alp* \"alpha delta\"", 20, scope),
                restored.search_representatives_json("alp* \"alpha delta\"", 20, scope),
                "ranks and exclusion must match within {scope}"
            );
            assert_eq!(
                source.aggregate_scoped_json("\"alpha delta\"", 10, scope),
                restored.aggregate_scoped_json("\"alpha delta\"", 10, scope),
                "exact counts must match within {scope}"
            );
        }
        assert_eq!(
            source.next_posting_page(true),
            restored.next_posting_page(true),
            "future v1 capture remains byte exact"
        );
    }

    #[test]
    fn posting_pages_reject_wrong_version_truncation_and_repeated_or_reordered_documents() {
        let mut source = Bm25RuntimeIndex::new(4);
        for id in 0..300 {
            source.add_document(&format!("doc{id:04}"), "one two one", "source.md", 4);
        }
        let first = source.next_posting_page(true);
        let second = source.next_posting_page(false);
        assert!(
            !second.is_empty(),
            "the record cap must produce multiple pages"
        );
        assert!(
            source.next_posting_page(false).is_empty(),
            "stream completes"
        );
        assert!(
            !Bm25RuntimeIndex::new(3).apply_posting_page(&first),
            "old token rules must reject the page"
        );
        assert!(
            !Bm25RuntimeIndex::new(4)
                .apply_posting_page(first.get(..first.len() - 1).unwrap_or_default()),
            "truncated page"
        );
        let mut candidate = Bm25RuntimeIndex::new(4);
        assert!(
            candidate.apply_posting_page(&second),
            "valid later page alone"
        );
        assert!(
            !candidate.apply_posting_page(&first),
            "decreasing document order"
        );
        assert!(
            !candidate.apply_posting_page(&second),
            "duplicate document order"
        );
        assert!(
            !candidate.finish_posting_import(candidate.total_docs()),
            "a rejected import cannot publish an applied projection"
        );
    }
}
