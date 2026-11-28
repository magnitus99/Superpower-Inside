//! Compact, ordered checkpoint postings. Normal writes remain an ordered mutable overlay.

use crate::{Bm25IndexData, Bm25Positions};
use core::ops::Bound::{Included, Unbounded};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

/// Page positions fit in the low bits; the high bit tags offsets in a term's position arena.
const MANY: u32 = 1 << 31;

/// The document ordinal is in the checkpoint's exact UTF-8 key order.
#[derive(Clone, Copy)]
struct PackedPosting {
    /// Index in the shared base document table.
    doc: u32,
    /// Inline position or tagged arena offset.
    encoded: u32,
}

/// Unique terms need neither a posting vector nor a heap allocation for a single position.
#[derive(Default)]
enum PackedEntries {
    /// No posting.
    #[default]
    Empty,
    /// First posting stays inline.
    One(PackedPosting),
    /// Documents appended in exact key order.
    Multiple(Vec<PackedPosting>),
}

impl PackedEntries {
    /// Append in increasing document order.
    fn push(&mut self, posting: PackedPosting) {
        match self {
            Self::Empty => *self = Self::One(posting),
            Self::One(first) => *self = Self::Multiple(vec![*first, posting]),
            Self::Multiple(postings) => postings.push(posting),
        }
    }

    /// Read even singletons without allocating.
    const fn as_slice(&self) -> &[PackedPosting] {
        match self {
            Self::Empty => &[],
            Self::One(posting) => core::slice::from_ref(posting),
            Self::Multiple(postings) => postings.as_slice(),
        }
    }
}

/// Packed postings and positions for one term.
#[derive(Default)]
struct PackedList {
    /// Ordered postings by base document ordinal.
    entries: PackedEntries,
    /// Appended `[count, position, ...]` for multi-occurrence postings, in the same order.
    positions: Vec<u32>,
    /// Excludes tombstoned base documents.
    live: usize,
}

impl PackedList {
    /// Store the positions and append the next distinct document.
    fn push(&mut self, doc: u32, positions: &[u32]) -> Option<()> {
        let encoded = match positions {
            [] => return None,
            [position] => *position,
            _ => {
                let offset = u32::try_from(self.positions.len()).ok()?;
                if offset >= MANY {
                    return None;
                }
                self.positions.push(u32::try_from(positions.len()).ok()?);
                self.positions.extend_from_slice(positions);
                MANY | offset
            }
        };
        self.entries.push(PackedPosting { doc, encoded });
        self.live += 1;
        Some(())
    }

    /// Borrow the exact position list in either representation.
    fn positions<'a>(&'a self, posting: &'a PackedPosting) -> Option<&'a [u32]> {
        if posting.encoded < MANY {
            return Some(core::slice::from_ref(&posting.encoded));
        }
        let offsets = arena_range(&self.positions, posting.encoded)?;
        self.positions.get(offsets.start + 1..offsets.end)
    }

    /// Reclaim a list's unreachable arena space amortized over deletions, without copying live data.
    fn remove(&mut self, documents: &[PackedDocument]) {
        self.live -= 1;
        if let PackedEntries::Multiple(entries) = &mut self.entries
            && self.live > 0
            && self.live.saturating_mul(2) <= entries.len()
        {
            let mut write = 0;
            entries.retain_mut(|entry| {
                if !document_by_ordinal(documents, entry.doc).is_some_and(|doc| doc.live) {
                    return false;
                }
                if entry.encoded >= MANY {
                    let Some(range) = arena_range(&self.positions, entry.encoded) else {
                        return false;
                    };
                    let Ok(encoded) = u32::try_from(write) else {
                        return false;
                    };
                    let len = range.len();
                    self.positions.copy_within(range, write);
                    entry.encoded = MANY | encoded;
                    write += len;
                }
                true
            });
            entries.shrink_to_fit();
            self.positions.truncate(write);
            self.positions.shrink_to_fit();
            if let [posting] = entries.as_slice() {
                self.entries = PackedEntries::One(*posting);
            }
        }
    }
}

/// A base document slot retains its sort key even if the document is replaced or deleted.
struct PackedDocument {
    /// Canonical exact document key.
    id: Rc<str>,
    /// Cleared once when a base document is superseded.
    live: bool,
}

/// Convert the checked wire ordinal to an internal document reference.
fn document_by_ordinal(documents: &[PackedDocument], ordinal: u32) -> Option<&PackedDocument> {
    documents.get(usize::try_from(ordinal).ok()?)
}

/// Resolve an internal tagged offset including the count cell.
fn arena_range(positions: &[u32], encoded: u32) -> Option<core::ops::Range<usize>> {
    let offset = usize::try_from(encoded ^ MANY).ok()?;
    let count = usize::try_from(*positions.get(offset)?).ok()?;
    Some(offset..offset + 1 + count)
}

/// One candidate owns its transient hash lookup; only the sealed ordered lexicon can serve.
#[derive(Default)]
pub struct PackedBase {
    /// Borrowed term lookup while appending validated pages.
    pending: Option<HashMap<Rc<str>, u32>>,
    /// Frozen lexicon used by full and ranged queries after sealing.
    terms: BTreeMap<Rc<str>, u32>,
    /// Stable term slots; moving the lexicon never moves the posting data.
    lists: Vec<PackedList>,
    /// Document ordinals in exact key order.
    documents: Vec<PackedDocument>,
    /// No further page or seal is accepted after partial application fails.
    failed: bool,
    /// Once sealed the base accepts no more checkpoint pages.
    sealed: bool,
}

impl PackedBase {
    /// Start or continue a candidate that contains only ordered checkpoint pages.
    pub fn begin(&mut self, docs: usize) -> Option<()> {
        if self.failed || self.sealed || self.documents.len() != docs {
            return None;
        }
        self.pending.get_or_insert_with(HashMap::new);
        Some(())
    }

    /// A partial or failed candidate must not be reported as ready.
    pub const fn is_importing(&self) -> bool {
        self.failed || self.pending.is_some()
    }

    /// Poison a partial application so it cannot later claim completeness.
    pub const fn fail(&mut self) {
        self.failed = true;
    }

    /// Validate the complete base cardinality and publish its ordered term dictionary.
    pub fn finish(&mut self, expected: usize, docs: usize) -> bool {
        if self.failed || expected != docs || docs != self.documents.len() {
            return false;
        }
        let Some(terms) = self.pending.take() else {
            return false;
        };
        self.terms = terms.into_iter().collect();
        self.sealed = true;
        true
    }

    /// Ordinal for the next row in the validated stream.
    pub fn next_document(&self) -> Option<u32> {
        u32::try_from(self.documents.len()).ok()
    }

    /// Accept an exact document key after all positions in the row validate.
    pub fn push_document(&mut self, id: Rc<str>) {
        self.documents.push(PackedDocument { id, live: true });
    }

    /// Compare the next row to the prior row across page boundaries in constant time.
    pub fn last_imported_id(&self) -> Option<&str> {
        self.documents.last().map(|doc| doc.id.as_ref())
    }

    /// Append validated positions and return the shared term key for inverse membership.
    pub fn push(&mut self, term: &str, doc: u32, positions: &[u32]) -> Option<Rc<str>> {
        let terms = self.pending.as_mut()?;
        // The borrowed hit path allocates neither a term key nor a posting node.
        if let Some((key, slot)) = terms.get_key_value(term) {
            self.lists
                .get_mut(usize::try_from(*slot).ok()?)?
                .push(doc, positions)?;
            return Some(Rc::clone(key));
        }
        let slot = u32::try_from(self.lists.len()).ok()?;
        let key = Rc::<str>::from(term);
        let mut postings = PackedList::default();
        postings.push(doc, positions)?;
        self.lists.push(postings);
        terms.insert(Rc::clone(&key), slot);
        Some(key)
    }

    /// Share a restored term key with subsequent mutable postings.
    pub fn key(&self, term: &str) -> Option<&Rc<str>> {
        self.terms.get_key_value(term).map(|(key, _)| key)
    }

    /// Resolve a term to its stable posting list.
    fn list(&self, term: &str) -> Option<&PackedList> {
        self.lists
            .get(usize::try_from(*self.terms.get(term)?).ok()?)
    }

    /// Locate the base ordinal without a second document dictionary.
    fn doc_index(&self, id: &str) -> Option<usize> {
        self.documents
            .binary_search_by(|doc| doc.id.as_ref().cmp(id))
            .ok()
    }

    /// Update frequencies for precisely the removed base document’s terms.
    pub fn remove_document(&mut self, id: &str, terms: &[Rc<str>]) {
        let Some(ordinal) = self.doc_index(id) else {
            return;
        };
        let Some(doc) = self.documents.get_mut(ordinal) else {
            return;
        };
        if !doc.live {
            return;
        }
        doc.live = false;
        for term in terms {
            if let std::collections::btree_map::Entry::Occupied(entry) =
                self.terms.entry(Rc::clone(term))
                && let Ok(slot) = usize::try_from(*entry.get())
                && let Some(list) = self.lists.get_mut(slot)
            {
                list.remove(&self.documents);
                if list.live == 0 {
                    *list = PackedList::default();
                    entry.remove();
                }
            }
        }
    }
}

/// Merge two sorted disjoint key streams, preferring the first if a dictionary key overlaps.
fn merge<'a, T: 'a>(
    left: impl Iterator<Item = (&'a str, T)> + 'a,
    right: impl Iterator<Item = (&'a str, T)> + 'a,
) -> impl Iterator<Item = (&'a str, T)> + 'a {
    let mut left = left.peekable();
    let mut right = right.peekable();
    core::iter::from_fn(move || match (left.peek(), right.peek()) {
        (Some((a, _)), Some((b, _))) => match a.cmp(b) {
            core::cmp::Ordering::Less => left.next(),
            core::cmp::Ordering::Equal => {
                right.next();
                left.next()
            }
            core::cmp::Ordering::Greater => right.next(),
        },
        (Some(_), None) => left.next(),
        _ => right.next(),
    })
}

/// A term’s complete view across an immutable restored base and mutable/legacy postings.
#[derive(Clone, Copy)]
pub struct PostingView<'a> {
    /// Optional base postings.
    compact: Option<&'a PackedList>,
    /// Shared table for resolving ordinal keys and deletions.
    documents: &'a [PackedDocument],
    /// May contain legacy fractional frequencies without a position list.
    frequencies: Option<&'a BTreeMap<Rc<str>, f64>>,
    /// Normal mutable or legacy position postings.
    positions: Option<&'a BTreeMap<Rc<str>, Bm25Positions>>,
}

impl<'a> PostingView<'a> {
    /// Visit only live base postings.
    fn compact_positions(self) -> impl Iterator<Item = (&'a str, &'a [u32])> + 'a {
        self.compact.into_iter().flat_map(move |list| {
            list.entries.as_slice().iter().filter_map(move |posting| {
                let doc = document_by_ordinal(self.documents, posting.doc)?;
                if !doc.live {
                    return None;
                }
                Some((doc.id.as_ref(), list.positions(posting)?))
            })
        })
    }

    /// Lookup without traversing the posting list.
    fn compact_for(self, id: &str) -> Option<&'a [u32]> {
        let list = self.compact?;
        let entries = list.entries.as_slice();
        let found = entries
            .binary_search_by(|entry| {
                document_by_ordinal(self.documents, entry.doc)
                    .map_or(core::cmp::Ordering::Less, |doc| doc.id.as_ref().cmp(id))
            })
            .ok()?;
        let entry = entries.get(found)?;
        if !document_by_ordinal(self.documents, entry.doc)?.live {
            return None;
        }
        list.positions(entry)
    }

    /// Document frequency without constructing or walking a list.
    pub fn frequency_count(self) -> usize {
        self.compact.map_or(0, |list| list.live) + self.frequencies.map_or(0, BTreeMap::len)
    }

    /// Ordered frequency and position views without searching the base for each hit again.
    pub fn frequency_entries(
        self,
    ) -> impl Iterator<Item = (&'a str, (f64, Option<&'a [u32]>))> + 'a {
        merge(
            self.compact_positions().filter_map(|(id, positions)| {
                Some((id, (crate::usize_to_f64(positions.len())?, Some(positions))))
            }),
            self.frequencies.into_iter().flatten().map(move |(id, n)| {
                let positions = self
                    .positions
                    .and_then(|map| map.get(id))
                    .map(|pos| &pos[..]);
                (id.as_ref(), (*n, positions))
            }),
        )
    }

    /// Ordered complete frequencies for the term.
    pub fn frequencies(self) -> impl Iterator<Item = (&'a str, f64)> + 'a {
        merge(
            self.compact_positions()
                .filter_map(|(id, positions)| Some((id, crate::usize_to_f64(positions.len())?))),
            self.frequencies
                .into_iter()
                .flatten()
                .map(|(id, n)| (id.as_ref(), *n)),
        )
    }

    /// Ordered complete position sets for the term.
    pub fn positions(self) -> impl Iterator<Item = (&'a str, &'a [u32])> + 'a {
        merge(
            self.compact_positions(),
            self.positions
                .into_iter()
                .flatten()
                .map(|(id, positions)| (id.as_ref(), &positions[..])),
        )
    }

    /// Exact document position lookup, independent of legacy frequency presence.
    pub fn positions_for(self, id: &str) -> Option<&'a [u32]> {
        self.compact_for(id)
            .or_else(|| Some(&self.positions?.get(id)?[..]))
    }

    /// Exact document frequency lookup.
    pub fn frequency_for(self, id: &str) -> Option<f64> {
        self.compact_for(id)
            .and_then(|positions| crate::usize_to_f64(positions.len()))
            .or_else(|| self.frequencies?.get(id).copied())
    }
}

impl Bm25IndexData {
    /// Look up one term across the two storage representations.
    pub fn posting(&self, term: &str) -> PostingView<'_> {
        PostingView {
            compact: self.posting_base.list(term),
            documents: &self.posting_base.documents,
            frequencies: self.inverted.get(term),
            positions: self.positions.get(term),
        }
    }

    /// Exact UTF-8 lexicon order across restored postings and subsequent writes.
    pub fn posting_terms(&self, from: &str) -> impl Iterator<Item = &str> {
        merge(
            self.posting_base
                .terms
                .range::<str, _>((Included(from), Unbounded))
                .map(|(term, _)| (term.as_ref(), ())),
            self.inverted
                .range::<str, _>((Included(from), Unbounded))
                .map(|(term, _)| (term.as_ref(), ())),
        )
        .map(|(term, ())| term)
    }
}
