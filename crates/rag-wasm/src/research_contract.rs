//! Deterministic research scope, coverage, and answer-claim contracts.

use std::collections::BTreeSet;

use serde_json::{Map as JsonMap, Value as JsonValue, json};
use wasm_bindgen::prelude::wasm_bindgen;

/// Default upper bound for evidence items transferred to a provider.
const DEFAULT_MAX_SELECTED_ITEMS: usize = 64;
/// Default number of evidence items grouped into one provider request.
const DEFAULT_PROVIDER_BATCH_SIZE: usize = 8;
/// Default upper bound for provider evidence batches in one research selection plan.
const DEFAULT_MAX_PROVIDER_BATCHES: usize = 8;
/// Additional bounded compression requests allowed after evidence-batch analysis.
const MAX_PROVIDER_REDUCTION_REQUESTS: usize = 2;
/// Final synthesis requests reserved from the logical provider-request budget.
const RESERVED_FINAL_REQUESTS: usize = 1;
/// Coverage-contract repair requests reserved from the logical provider-request budget.
const RESERVED_REPAIR_REQUESTS: usize = 1;
/// Extra provider attempts shared by all logical requests in one research run.
const MAX_PROVIDER_RETRY_ATTEMPTS: usize = 2;
/// Maximum cumulative automatic retry wait across one research run.
const MAX_PROVIDER_RETRY_WAIT_MS: usize = 30_000;
/// Stable fingerprint offset basis.
const FINGERPRINT_OFFSET_BASIS: u32 = 0x811c_9dc5;
/// Stable fingerprint multiplier.
const FINGERPRINT_PRIME: u32 = 0x0100_0193;
/// Scope and conversational words that are not useful lexical evidence facets.
const RESEARCH_STOP_TERMS: [&str; 41] = [
    "all",
    "analyze",
    "anything",
    "everything",
    "for",
    "from",
    "investigate",
    "notes",
    "obsidian",
    "please",
    "research",
    "summarize",
    "summary",
    "the",
    "vault",
    "내에서",
    "대해서",
    "되지",
    "말했어",
    "모든",
    "모두",
    "뭐라고",
    "볼트",
    "않아",
    "어떻게",
    "요약",
    "요약해줘",
    "자료",
    "관련",
    "관련된",
    "전체",
    "전부",
    "조사",
    "조사하면",
    "조사해줘",
    "것들",
    "것들을",
    "해줘",
    "했어",
    "확인",
    "옵시디언",
];

/// Parsed provider-transfer budget for candidate selection.
#[derive(Clone, Copy)]
struct ProviderBudget {
    /// Absolute selected-item ceiling.
    max_selected_items: usize,
    /// Evidence items per provider batch.
    batch_size: usize,
    /// Provider-batch ceiling.
    max_batches: usize,
    /// Effective selected-item ceiling after applying both limits.
    max_transfer_items: usize,
}

/// Parsed candidate-selection input.
struct CandidateSelectionInput {
    /// Latest user question.
    current_question: String,
    /// Earlier user questions in chronological order.
    previous_user_questions: Vec<String>,
    /// Stable vault inventory paths.
    paths: Vec<String>,
    /// Optional local content samples aligned with `paths`.
    samples: Vec<String>,
    /// Provider transfer budget.
    provider_budget: ProviderBudget,
}

/// One locally matched inventory item with stable facet-aware ranking signals.
struct CandidateMatch {
    /// Inventory index aligned with the input path/sample arrays.
    index: usize,
    /// Whether this item matched each serialized facet.
    facet_matches: Vec<bool>,
    /// Number of matched current-question or conversation-context facets.
    primary_facet_match_count: usize,
    /// Number of matched facets.
    facet_match_count: usize,
    /// Number of distinct lexical terms present in the path or sample.
    term_match_count: usize,
}

/// Conservative coverage counters accumulated from native-vault tool result payloads.
struct NativeToolCoverageAccumulator {
    /// Whether at least one search result was observed.
    has_search: bool,
    /// Whether every serialized native result could be parsed.
    all_results_parseable: bool,
    /// Whether every observed search returned its full readable hit set.
    all_searches_complete: bool,
    /// Largest scanned-file count reported by a search.
    inventory_count: usize,
    /// Number of search hits delivered to the model.
    selected_evidence_count: usize,
    /// Number of search hits omitted by bounds.
    provider_omitted_count: usize,
    /// Stable conservative coverage reason codes.
    reason_codes: Vec<&'static str>,
    /// Exact native search scopes delivered to the model.
    search_scopes: Vec<NativeSearchScope>,
}

impl NativeToolCoverageAccumulator {
    /// Creates an empty accumulator whose completeness is revoked by bounded evidence.
    const fn new() -> Self {
        Self {
            has_search: false,
            all_results_parseable: true,
            all_searches_complete: true,
            inventory_count: 0,
            selected_evidence_count: 0,
            provider_omitted_count: 0,
            reason_codes: Vec::new(),
            search_scopes: Vec::new(),
        }
    }

    /// Marks one native result as unusable for negative-claim coverage.
    fn mark_unparseable(&mut self) {
        self.all_results_parseable = false;
        self.all_searches_complete = false;
        push_reason(&mut self.reason_codes, "local-screen-incomplete");
    }
}

/// One native search scope whose completeness can be checked against answer wording.
struct NativeSearchScope {
    /// Exact normalized query sent to the native search.
    query: String,
    /// Exact path restriction, or an empty string for the visible vault.
    path: String,
    /// Native lexical match policy.
    match_mode: String,
    /// Whether the search returned every readable match in its scope.
    complete: bool,
}

/// Distinguishes research-agent receipts from native-search receipts without nested options.
enum NativeSearchScopeReceipt {
    /// The receipt predates or does not originate from the native-search path.
    ResearchAgent,
    /// Exact native-search scopes serialized into the receipt.
    Native(Vec<NativeSearchScope>),
}

/// Parsed inventory snapshot used by the coverage receipt.
struct InventorySnapshot {
    /// Stable inventory paths.
    paths: Vec<String>,
    /// Total reported when the inventory run started.
    total: usize,
}

/// One page observed while enumerating the inventory.
struct InventoryPage {
    /// Zero-based page cursor.
    cursor: usize,
    /// Paths returned for this page.
    paths: Vec<String>,
    /// Total reported for this page.
    total: usize,
    /// Cursor for the next page, or `None` for the last page.
    next_cursor: NullableIndex,
}

/// A required JSON field that is either a pagination cursor or explicit `null`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum NullableIndex {
    /// Explicit terminal `null`.
    End,
    /// Non-negative next-page cursor.
    Cursor(usize),
}

/// Local screening evidence used by the coverage receipt.
struct LocalScreenSnapshot {
    /// Inventory indices inspected locally.
    screened_indices: Vec<usize>,
    /// Evidence indices selected for provider analysis.
    selected_indices: Vec<usize>,
    /// Number of lexical candidates found before the transfer budget was applied.
    matched_candidate_count: usize,
    /// Inventory indices that could not be read locally.
    unreadable_indices: Vec<usize>,
    /// Inventory indices omitted from local screening.
    omitted_indices: Vec<usize>,
}

/// Provider transfer and analysis evidence used by the coverage receipt.
struct ProviderTransferSnapshot {
    /// Selected indices transferred to the provider.
    transferred_indices: Vec<usize>,
    /// Selected indices successfully analyzed by the provider.
    analyzed_indices: Vec<usize>,
    /// Explicitly omitted selected indices.
    omitted_indices: Vec<usize>,
    /// Selected indices whose provider analysis failed.
    failed_indices: Vec<usize>,
    /// Candidates omitted because of the provider transfer budget.
    omitted_candidate_count: usize,
}

/// Parsed coverage receipt input.
struct CoverageInput {
    /// Inventory snapshot.
    inventory: InventorySnapshot,
    /// Stable pagination observations.
    pages: Vec<InventoryPage>,
    /// Local screening observations.
    local_screen: LocalScreenSnapshot,
    /// Provider transfer observations.
    provider_transfer: ProviderTransferSnapshot,
}

/// Local evidence coverage parsed from a previously derived receipt.
#[derive(Clone, Copy, PartialEq, Eq)]
enum LocalCoverage {
    /// At least one inventory or local-screen invariant failed.
    Incomplete,
    /// Every stable inventory item was screened locally.
    WholeVaultScreened,
}

/// Provider evidence coverage parsed from a previously derived receipt.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ProviderCoverage {
    /// At least one selected item was omitted or failed.
    Incomplete,
    /// Every selected evidence item was analyzed.
    SelectedEvidenceAnalyzed,
    /// Every inventory item was analyzed.
    AllInventoryEvidenceAnalyzed,
}

/// Trusted coverage state parsed from a previously derived receipt.
#[derive(Clone, Copy)]
struct CoverageFlags {
    /// Local screening coverage.
    local: LocalCoverage,
    /// Provider analysis coverage.
    provider: ProviderCoverage,
    /// Whether a scope-qualified exact negative is covered by this receipt.
    exact_negative_allowed: bool,
}

impl CoverageFlags {
    /// Returns whether every inventory item was screened locally.
    const fn whole_vault_locally_screened(self) -> bool {
        matches!(self.local, LocalCoverage::WholeVaultScreened)
    }

    /// Returns whether every selected item was analyzed.
    const fn all_selected_evidence_analyzed(self) -> bool {
        !matches!(self.provider, ProviderCoverage::Incomplete)
    }

    /// Returns whether every inventory item was analyzed.
    const fn all_inventory_evidence_analyzed(self) -> bool {
        matches!(
            self.provider,
            ProviderCoverage::AllInventoryEvidenceAnalyzed
        )
    }

    /// Returns whether a qualified exact-negative claim has sufficient coverage.
    const fn exact_negative_allowed(self) -> bool {
        self.exact_negative_allowed
    }
}

/// Plans a bounded, stable local candidate selection from questions and inventory evidence.
///
/// Invalid JSON or mismatched path/sample arrays return an empty string.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_candidate_selection_json(input_json: &str) -> String {
    let Some(input) = parse_candidate_selection_input(input_json) else {
        return String::new();
    };
    let (terms, facets) = collect_research_terms_and_facets(&input);
    let matched_candidates = collect_matching_candidates(&input, &terms, &facets);
    let matched_indices = matched_candidates
        .iter()
        .map(|candidate| candidate.index)
        .collect::<Vec<_>>();
    let selection_mode = if input.paths.is_empty() {
        "empty-inventory"
    } else if terms.is_empty() {
        "bounded-inventory-sample"
    } else {
        "term-match"
    };
    let selected_indices = if terms.is_empty() {
        select_bounded_indices(
            &matched_indices,
            input.provider_budget.max_transfer_items,
            true,
        )
    } else {
        select_ranked_facet_indices(
            &matched_candidates,
            &facets,
            input.provider_budget.max_transfer_items,
        )
    };
    let omitted_candidate_count = matched_indices.len().saturating_sub(selected_indices.len());
    let provider_batch_count = selected_indices
        .len()
        .div_ceil(input.provider_budget.batch_size);
    let plan_fingerprint =
        candidate_plan_fingerprint(&input, &terms, &selected_indices, omitted_candidate_count);

    json!({
        "inventoryCount": input.paths.len(),
        "selectedIndices": selected_indices,
        "selectionMode": selection_mode,
        "matchedCandidateCount": matched_indices.len(),
        "omittedCandidateCount": omitted_candidate_count,
        "providerBatchCount": provider_batch_count,
        "providerBudget": {
            "maxSelectedItems": input.provider_budget.max_selected_items,
            "batchSize": input.provider_budget.batch_size,
            "maxBatches": input.provider_budget.max_batches,
            "maxTransferItems": input.provider_budget.max_transfer_items,
        },
        "terms": terms,
        "facets": facets,
        "planFingerprint": plan_fingerprint,
    })
    .to_string()
}

/// Plans one hard logical provider-request ceiling without changing evidence-batch semantics.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_provider_request_budget_json(input_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let Some(provider_batch_count) = required_usize(object, "providerBatchCount") else {
        return String::new();
    };
    let Some(provider_budget) = parse_provider_budget(object.get("providerBudget")) else {
        return String::new();
    };
    if provider_batch_count > provider_budget.max_batches {
        return String::new();
    }

    let max_map_requests = provider_batch_count;
    let max_reduction_requests = provider_batch_count.min(MAX_PROVIDER_REDUCTION_REQUESTS);
    let max_requests = max_map_requests
        .saturating_add(max_reduction_requests)
        .saturating_add(RESERVED_FINAL_REQUESTS)
        .saturating_add(RESERVED_REPAIR_REQUESTS);
    let max_provider_attempts = max_requests.saturating_add(MAX_PROVIDER_RETRY_ATTEMPTS);

    json!({
        "maxRequests": max_requests,
        "maxProviderAttempts": max_provider_attempts,
        "maxRetryWaitMs": MAX_PROVIDER_RETRY_WAIT_MS,
        "maxMapRequests": max_map_requests,
        "maxReductionRequests": max_reduction_requests,
        "reservedFinalRequests": RESERVED_FINAL_REQUESTS,
        "reservedRepairRequests": RESERVED_REPAIR_REQUESTS,
    })
    .to_string()
}

/// Advances the global provider-attempt or retry-wait ledger while reserving future logical calls.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_provider_ledger_transition_json(input_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let Some(max_provider_attempts) = required_usize(object, "maxProviderAttempts") else {
        return String::new();
    };
    let Some(max_retry_wait_ms) = required_usize(object, "maxRetryWaitMs") else {
        return String::new();
    };
    let Some(provider_attempts) = required_usize(object, "providerAttempts") else {
        return String::new();
    };
    let Some(retry_wait_ms) = required_usize(object, "retryWaitMs") else {
        return String::new();
    };
    let Some(remaining_logical_requests) = required_usize(object, "remainingLogicalRequests")
    else {
        return String::new();
    };
    let Some(event) = required_object(object, "event") else {
        return String::new();
    };
    let Some(kind) = event.get("kind").and_then(JsonValue::as_str) else {
        return String::new();
    };
    let Some(retry_delay_ms) = required_usize(event, "retryDelayMs") else {
        return String::new();
    };
    if provider_attempts > max_provider_attempts || retry_wait_ms > max_retry_wait_ms {
        return String::new();
    }

    let next_attempt = provider_attempts.checked_add(1);
    let attempt_fits = next_attempt
        .and_then(|next| next.checked_add(remaining_logical_requests))
        .is_some_and(|reserved_total| reserved_total <= max_provider_attempts);
    let (allowed, next_provider_attempts, next_retry_wait_ms, reason) = match kind {
        "attempt" if retry_delay_ms == 0 => {
            if attempt_fits {
                (
                    true,
                    next_attempt.unwrap_or(provider_attempts),
                    retry_wait_ms,
                    None,
                )
            } else {
                (
                    false,
                    provider_attempts,
                    retry_wait_ms,
                    Some("provider-attempt-limit"),
                )
            }
        }
        "retry-wait" => {
            let next_wait = retry_wait_ms.checked_add(retry_delay_ms);
            if !attempt_fits {
                (
                    false,
                    provider_attempts,
                    retry_wait_ms,
                    Some("provider-attempt-limit"),
                )
            } else if next_wait.is_none_or(|wait| wait > max_retry_wait_ms) {
                (
                    false,
                    provider_attempts,
                    retry_wait_ms,
                    Some("retry-wait-limit"),
                )
            } else {
                (
                    true,
                    provider_attempts,
                    next_wait.unwrap_or(retry_wait_ms),
                    None,
                )
            }
        }
        _ => return String::new(),
    };

    json!({
        "allowed": allowed,
        "providerAttempts": next_provider_attempts,
        "retryWaitMs": next_retry_wait_ms,
        "reason": reason,
    })
    .to_string()
}

/// Derives auditable whole-vault and selected-evidence coverage booleans.
///
/// Invalid JSON returns an empty string. Semantic inconsistencies produce a receipt with reason
/// codes and conservative `false` decisions.
#[must_use]
#[wasm_bindgen]
pub fn derive_research_coverage_receipt_json(input_json: &str) -> String {
    let Some(input) = parse_coverage_input(input_json) else {
        return String::new();
    };
    derive_coverage_receipt(&input).to_string()
}

/// Derives a conservative coverage receipt from successful native-vault tool result payloads.
///
/// Only an untruncated search that scanned without unreadable files can support a scoped exact
/// negative claim. Native tool results never prove that every inventory document was read.
#[must_use]
#[wasm_bindgen]
pub fn derive_native_tool_coverage_receipt_json(results_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(results_json) else {
        return String::new();
    };
    let Some(results) = value.as_array() else {
        return String::new();
    };
    let mut coverage = NativeToolCoverageAccumulator::new();
    for result in results {
        accumulate_native_tool_result(result, &mut coverage);
    }

    if !coverage.has_search {
        coverage.all_searches_complete = false;
        push_reason(&mut coverage.reason_codes, "local-screen-incomplete");
    }
    let whole_vault_locally_screened = coverage.has_search
        && coverage.all_results_parseable
        && coverage.all_searches_complete
        && coverage
            .search_scopes
            .iter()
            .all(|scope| scope.path.is_empty());
    let all_selected_evidence_analyzed = coverage.has_search && coverage.all_results_parseable;
    let exact_negative_allowed = coverage.has_search
        && coverage.all_results_parseable
        && coverage.all_searches_complete
        && all_selected_evidence_analyzed;
    let search_scopes = coverage
        .search_scopes
        .iter()
        .map(|scope| {
            json!({
                "query": scope.query,
                "path": scope.path,
                "match": scope.match_mode,
                "complete": scope.complete,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "inventoryCount": coverage.inventory_count,
        "pagedCount": coverage.inventory_count,
        "locallyScreenedCount": coverage.inventory_count,
        "selectedEvidenceCount": coverage.selected_evidence_count,
        "providerTransferredCount": coverage.selected_evidence_count,
        "providerAnalyzedCount": coverage.selected_evidence_count,
        "providerOmittedCount": coverage.provider_omitted_count,
        "wholeVaultLocallyScreened": whole_vault_locally_screened,
        "allSelectedEvidenceAnalyzed": all_selected_evidence_analyzed,
        "allInventoryEvidenceAnalyzed": false,
        "exactNegativeAllowed": exact_negative_allowed,
        "reasonCodes": coverage.reason_codes,
        "searchScopes": search_scopes,
    })
    .to_string()
}

/// Accumulates one native result while treating malformed or bounded searches conservatively.
fn accumulate_native_tool_result(result: &JsonValue, coverage: &mut NativeToolCoverageAccumulator) {
    let Some(raw) = result.as_str() else {
        coverage.mark_unparseable();
        return;
    };
    let Ok(parsed) = serde_json::from_str::<JsonValue>(raw) else {
        coverage.mark_unparseable();
        return;
    };
    let Some(object) = parsed.as_object() else {
        coverage.mark_unparseable();
        return;
    };
    if object.get("action").and_then(JsonValue::as_str) != Some("search") {
        return;
    }
    coverage.has_search = true;
    let search_scope = (
        object.get("query").and_then(JsonValue::as_str),
        object.get("path").and_then(JsonValue::as_str),
        object.get("match").and_then(JsonValue::as_str),
    );
    let (Some(query), Some(path), Some(match_mode)) = search_scope else {
        coverage.mark_unparseable();
        return;
    };
    if query.trim().is_empty() || !matches!(match_mode, "all" | "any" | "phrase") {
        coverage.mark_unparseable();
        return;
    }
    let metrics = (
        object.get("scannedFiles").and_then(json_usize),
        object.get("unreadableFiles").and_then(json_usize),
        object.get("totalHits").and_then(json_usize),
        object.get("truncated").and_then(JsonValue::as_bool),
        object
            .get("hits")
            .and_then(JsonValue::as_array)
            .map(Vec::len),
    );
    let (
        Some(scanned_files),
        Some(unreadable_files),
        Some(total_hits),
        Some(truncated),
        Some(hit_count),
    ) = metrics
    else {
        coverage.mark_unparseable();
        return;
    };
    let complete = unreadable_files == 0 && !truncated && total_hits <= hit_count;
    coverage.search_scopes.push(NativeSearchScope {
        query: query.trim().to_owned(),
        path: path.trim().to_owned(),
        match_mode: match_mode.to_owned(),
        complete,
    });

    coverage.inventory_count = coverage.inventory_count.max(scanned_files);
    coverage.selected_evidence_count = coverage.selected_evidence_count.saturating_add(hit_count);
    coverage.provider_omitted_count = coverage
        .provider_omitted_count
        .saturating_add(total_hits.saturating_sub(hit_count));
    if unreadable_files > 0 {
        coverage.all_searches_complete = false;
        push_reason(&mut coverage.reason_codes, "local-screen-unreadable");
    }
    if truncated || total_hits > hit_count {
        coverage.all_searches_complete = false;
        push_reason(&mut coverage.reason_codes, "local-screen-omitted");
    }
}

/// Validates answer-wide coverage claims against a derived coverage receipt.
///
/// The returned action is `repair` when the answer claims unverified whole-file reading or an
/// insufficiently scoped negative conclusion.
#[must_use]
#[wasm_bindgen]
pub fn plan_research_answer_contract_json(input_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<JsonValue>(input_json) else {
        return String::new();
    };
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let Some(answer) = object.get("answer").and_then(JsonValue::as_str) else {
        return String::new();
    };
    let korean = match object.get("language").and_then(JsonValue::as_str) {
        Some("ko") => true,
        Some("en") => false,
        Some(_) => return String::new(),
        // Compatibility for callers serialized before the explicit locale contract.
        None => answer
            .chars()
            .any(|character| ('가'..='힣').contains(&character)),
    };
    let Some(receipt) = object.get("receipt").and_then(JsonValue::as_object) else {
        return String::new();
    };
    let Some(flags) = parse_coverage_flags(receipt) else {
        return String::new();
    };
    let Some(native_search_scope_receipt) = parse_native_search_scopes(receipt) else {
        return String::new();
    };
    let native_search_scopes = match &native_search_scope_receipt {
        NativeSearchScopeReceipt::ResearchAgent => None,
        NativeSearchScopeReceipt::Native(scopes) => Some(scopes.as_slice()),
    };

    let normalized = answer.to_lowercase();
    let whole_read_claim = contains_whole_read_claim(&normalized);
    let broad_negative_claim = contains_broad_negative_claim(&normalized);
    let detected_negative_claim =
        broad_negative_claim || contains_exact_negative_claim(&normalized);
    let native_negative_claim_relevant = native_search_scopes
        .as_ref()
        .is_none_or(|scopes| !scopes.is_empty() || contains_vault_search_scope(&normalized));
    let negative_claim = detected_negative_claim && native_negative_claim_relevant;
    let scoped_negative_claim = negative_claim && contains_scoped_negative_claim(&normalized);
    let unscoped_broad_negative_claim =
        negative_claim && contains_unscoped_broad_negative_claim(&normalized);
    let native_scope_matches = native_search_scopes
        .as_ref()
        .is_none_or(|scopes| native_scoped_negative_claims_match(&normalized, scopes));
    let mut violation_codes = Vec::<&str>::new();

    if whole_read_claim && !flags.all_inventory_evidence_analyzed() {
        violation_codes.push("whole-read-claim-unverified");
    }
    if unscoped_broad_negative_claim && !flags.all_inventory_evidence_analyzed() {
        violation_codes.push("broad-negative-claim");
    } else if scoped_negative_claim && (!flags.exact_negative_allowed() || !native_scope_matches) {
        violation_codes.push("exact-negative-coverage-incomplete");
    }

    let allowed = violation_codes.is_empty();
    json!({
        "allowed": allowed,
        "action": if allowed { "allow" } else { "repair" },
        "violationCodes": violation_codes,
        "safeCoverageText": safe_coverage_text(korean, flags, negative_claim),
    })
    .to_string()
}

/// Parses candidate-selection input and applies a safe default provider budget.
fn parse_candidate_selection_input(raw: &str) -> Option<CandidateSelectionInput> {
    let value = serde_json::from_str::<JsonValue>(raw).ok()?;
    let object = value.as_object()?;
    let current_question = required_string(object, "currentQuestion")?;
    let previous_user_questions = required_string_array(object, "previousUserQuestions")?;
    let paths = required_string_array(object, "paths")?;
    let samples = required_string_array(object, "samples")?;
    if paths.len() != samples.len() || paths.iter().any(|path| path.trim().is_empty()) {
        return None;
    }
    let provider_budget = parse_provider_budget(object.get("providerBudget"))?;

    Some(CandidateSelectionInput {
        current_question,
        previous_user_questions,
        paths,
        samples,
        provider_budget,
    })
}

/// Parses an optional provider budget and calculates its effective transfer ceiling.
fn parse_provider_budget(value: Option<&JsonValue>) -> Option<ProviderBudget> {
    let (max_selected_items, batch_size, max_batches) = if let Some(value) = value {
        let object = value.as_object()?;
        (
            required_positive_usize(object, "maxSelectedItems")?,
            required_positive_usize(object, "batchSize")?,
            required_positive_usize(object, "maxBatches")?,
        )
    } else {
        (
            DEFAULT_MAX_SELECTED_ITEMS,
            DEFAULT_PROVIDER_BATCH_SIZE,
            DEFAULT_MAX_PROVIDER_BATCHES,
        )
    };
    let max_transfer_items = max_selected_items.min(batch_size.saturating_mul(max_batches));

    Some(ProviderBudget {
        max_selected_items,
        batch_size,
        max_batches,
        max_transfer_items,
    })
}

/// Collects meaningful current and previous question terms into stable facets.
fn collect_research_terms_and_facets(
    input: &CandidateSelectionInput,
) -> (Vec<String>, Vec<JsonValue>) {
    let mut topic_terms = Vec::<String>::new();
    let mut context_terms = Vec::<String>::new();

    append_meaningful_tokens(&mut topic_terms, &input.current_question);
    for previous_question in &input.previous_user_questions {
        append_meaningful_tokens(&mut context_terms, previous_question);
    }
    remove_terms_present_in(&mut context_terms, &topic_terms);

    let mut facets = Vec::<JsonValue>::new();
    if !topic_terms.is_empty() {
        facets.push(json!({ "kind": "topic", "terms": topic_terms }));
    }
    if !context_terms.is_empty() {
        facets.push(json!({ "kind": "context", "terms": context_terms }));
    }

    let terms = facets
        .iter()
        .filter_map(|facet| facet.get("terms").and_then(JsonValue::as_array))
        .flatten()
        .filter_map(JsonValue::as_str)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    (terms, facets)
}

/// Appends lexical terms that remain after removing conversational research boilerplate.
fn append_meaningful_tokens(target: &mut Vec<String>, text: &str) {
    for raw_token in text.split(|character: char| {
        !character.is_alphanumeric() && character != '_' && character != '-'
    }) {
        let normalized = raw_token.trim().to_lowercase();
        let token = trim_korean_particle(&normalized);
        if is_meaningful_token(&normalized) && is_meaningful_token(token) {
            push_unique_term(target, token);
        }
    }
}

/// Removes one common Korean grammatical suffix while preserving meaningful stems.
fn trim_korean_particle(token: &str) -> &str {
    const PARTICLES: [&str; 16] = [
        "으로", "에서", "에게", "한테", "까지", "부터", "은", "는", "이", "가", "을", "를", "와",
        "과", "의", "에",
    ];
    PARTICLES
        .iter()
        .find_map(|particle| {
            token
                .strip_suffix(particle)
                .filter(|stem| stem.chars().count() >= 2)
        })
        .unwrap_or(token)
}

/// Returns whether one normalized token can improve local candidate selection.
fn is_meaningful_token(token: &str) -> bool {
    token.chars().count() >= 2
        && !token.chars().all(char::is_numeric)
        && !RESEARCH_STOP_TERMS.contains(&token)
}

/// Pushes a case-insensitively unique term while preserving first-seen order.
fn push_unique_term(target: &mut Vec<String>, term: &str) {
    let normalized = term.to_lowercase();
    if target
        .iter()
        .all(|existing| existing.to_lowercase() != normalized)
    {
        target.push(term.to_owned());
    }
}

/// Removes terms already represented by an earlier facet.
fn remove_terms_present_in(target: &mut Vec<String>, earlier_terms: &[String]) {
    target.retain(|term| {
        let normalized = term.to_lowercase();
        earlier_terms
            .iter()
            .all(|earlier| earlier.to_lowercase() != normalized)
    });
}

/// Collects and ranks inventory items whose path or local sample contains any term.
fn collect_matching_candidates(
    input: &CandidateSelectionInput,
    terms: &[String],
    facets: &[JsonValue],
) -> Vec<CandidateMatch> {
    if terms.is_empty() {
        return (0..input.paths.len())
            .map(|index| CandidateMatch {
                index,
                facet_matches: Vec::new(),
                primary_facet_match_count: 0,
                facet_match_count: 0,
                term_match_count: 0,
            })
            .collect();
    }
    let normalized_terms = terms
        .iter()
        .map(|term| term.to_lowercase())
        .collect::<Vec<_>>();
    let mut candidates = input
        .paths
        .iter()
        .zip(&input.samples)
        .enumerate()
        .filter_map(|(index, (path, sample))| {
            let combined = format!("{}\n{}", path.to_lowercase(), sample.to_lowercase());
            let term_match_count = normalized_terms
                .iter()
                .filter(|term| combined.contains(term.as_str()))
                .count();
            if term_match_count == 0 {
                return None;
            }
            let facet_matches = facets
                .iter()
                .map(|facet| {
                    facet
                        .get("terms")
                        .and_then(JsonValue::as_array)
                        .is_some_and(|facet_terms| {
                            facet_terms
                                .iter()
                                .filter_map(JsonValue::as_str)
                                .any(|term| combined.contains(term.to_lowercase().as_str()))
                        })
                })
                .collect::<Vec<_>>();
            let primary_facet_match_count = facet_matches
                .iter()
                .enumerate()
                .filter(|(facet_index, matched)| {
                    **matched
                        && facets
                            .get(*facet_index)
                            .is_some_and(is_primary_research_facet)
                })
                .count();
            let facet_match_count = facet_matches.iter().filter(|matched| **matched).count();
            Some(CandidateMatch {
                index,
                facet_matches,
                primary_facet_match_count,
                facet_match_count,
                term_match_count,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .primary_facet_match_count
            .cmp(&left.primary_facet_match_count)
            .then_with(|| right.facet_match_count.cmp(&left.facet_match_count))
            .then_with(|| right.term_match_count.cmp(&left.term_match_count))
            .then_with(|| left.index.cmp(&right.index))
    });
    candidates
}

/// Returns whether one serialized facet represents current or prior user intent.
fn is_primary_research_facet(facet: &JsonValue) -> bool {
    facet
        .get("kind")
        .and_then(JsonValue::as_str)
        .is_some_and(|kind| matches!(kind, "entity" | "topic" | "context"))
}

/// Selects combined-facet evidence first, then fills each facet fairly within the transfer limit.
fn select_ranked_facet_indices(
    candidates: &[CandidateMatch],
    facets: &[JsonValue],
    limit: usize,
) -> Vec<usize> {
    if candidates.len() <= limit {
        return candidates.iter().map(|candidate| candidate.index).collect();
    }
    let primary_facet_indices = facets
        .iter()
        .enumerate()
        .filter_map(|(index, facet)| is_primary_research_facet(facet).then_some(index))
        .collect::<Vec<_>>();
    let diversity_facet_indices = if primary_facet_indices.is_empty() {
        (0..facets.len()).collect::<Vec<_>>()
    } else {
        primary_facet_indices
    };
    let mut selected = Vec::<usize>::with_capacity(limit);
    let mut seen = BTreeSet::<usize>::new();

    if diversity_facet_indices.len() > 1 {
        for candidate in candidates.iter().filter(|candidate| {
            candidate.primary_facet_match_count == diversity_facet_indices.len()
        }) {
            if selected.len() >= limit {
                return selected;
            }
            if seen.insert(candidate.index) {
                selected.push(candidate.index);
            }
        }
    }

    while selected.len() < limit {
        let mut added = false;
        for facet_index in &diversity_facet_indices {
            let candidate = candidates.iter().find(|candidate| {
                candidate
                    .facet_matches
                    .get(*facet_index)
                    .copied()
                    .unwrap_or(false)
                    && !seen.contains(&candidate.index)
            });
            if let Some(candidate) = candidate {
                seen.insert(candidate.index);
                selected.push(candidate.index);
                added = true;
                if selected.len() >= limit {
                    return selected;
                }
            }
        }
        if !added {
            break;
        }
    }

    for candidate in candidates {
        if selected.len() >= limit {
            break;
        }
        if seen.insert(candidate.index) {
            selected.push(candidate.index);
        }
    }
    selected
}

/// Applies the transfer ceiling, using an even stable sample for term-free research.
fn select_bounded_indices(
    matched_indices: &[usize],
    limit: usize,
    evenly_sample: bool,
) -> Vec<usize> {
    if matched_indices.len() <= limit {
        return matched_indices.to_vec();
    }
    if !evenly_sample {
        return matched_indices.iter().take(limit).copied().collect();
    }
    (0..limit)
        .filter_map(|slot| {
            let source_index = slot.saturating_mul(matched_indices.len()).div_euclid(limit);
            matched_indices.get(source_index).copied()
        })
        .collect()
}

/// Calculates a deterministic fingerprint for candidate plan inputs and outputs.
fn candidate_plan_fingerprint(
    input: &CandidateSelectionInput,
    terms: &[String],
    selected_indices: &[usize],
    omitted_candidate_count: usize,
) -> String {
    let mut hash = FINGERPRINT_OFFSET_BASIS;
    update_fingerprint(&mut hash, &input.current_question);
    for question in &input.previous_user_questions {
        update_fingerprint(&mut hash, question);
    }
    for (path, sample) in input.paths.iter().zip(&input.samples) {
        update_fingerprint(&mut hash, path);
        update_fingerprint(&mut hash, sample);
    }
    for term in terms {
        update_fingerprint(&mut hash, term);
    }
    for index in selected_indices {
        update_fingerprint(&mut hash, &index.to_string());
    }
    update_fingerprint(&mut hash, &omitted_candidate_count.to_string());
    update_fingerprint(
        &mut hash,
        &input.provider_budget.max_transfer_items.to_string(),
    );
    format!("{hash:08x}")
}

/// Adds one delimited UTF-8 string to the stable fingerprint.
fn update_fingerprint(hash: &mut u32, value: &str) {
    for byte in value.bytes().chain(std::iter::once(0xff)) {
        *hash ^= u32::from(byte);
        *hash = hash.wrapping_mul(FINGERPRINT_PRIME);
    }
}

/// Parses a coverage input payload.
fn parse_coverage_input(raw: &str) -> Option<CoverageInput> {
    let value = serde_json::from_str::<JsonValue>(raw).ok()?;
    let object = value.as_object()?;
    Some(CoverageInput {
        inventory: parse_inventory_snapshot(required_object(object, "inventory")?)?,
        pages: parse_inventory_pages(object.get("pages")?)?,
        local_screen: parse_local_screen_snapshot(required_object(object, "localScreen")?)?,
        provider_transfer: parse_provider_transfer_snapshot(required_object(
            object,
            "providerTransfer",
        )?)?,
    })
}

/// Parses the inventory snapshot.
fn parse_inventory_snapshot(object: &JsonMap<String, JsonValue>) -> Option<InventorySnapshot> {
    Some(InventorySnapshot {
        paths: required_string_array(object, "paths")?,
        total: required_usize(object, "total")?,
    })
}

/// Parses every pagination observation.
fn parse_inventory_pages(value: &JsonValue) -> Option<Vec<InventoryPage>> {
    value
        .as_array()?
        .iter()
        .map(|page| {
            let object = page.as_object()?;
            Some(InventoryPage {
                cursor: required_usize(object, "cursor")?,
                paths: required_string_array(object, "paths")?,
                total: required_usize(object, "total")?,
                next_cursor: required_nullable_index(object, "nextCursor")?,
            })
        })
        .collect()
}

/// Parses local screening observations.
fn parse_local_screen_snapshot(object: &JsonMap<String, JsonValue>) -> Option<LocalScreenSnapshot> {
    Some(LocalScreenSnapshot {
        screened_indices: required_index_array(object, "screenedIndices")?,
        selected_indices: required_index_array(object, "selectedIndices")?,
        matched_candidate_count: required_usize(object, "matchedCandidateCount")?,
        unreadable_indices: required_index_array(object, "unreadableIndices")?,
        omitted_indices: required_index_array(object, "omittedIndices")?,
    })
}

/// Parses provider transfer observations.
fn parse_provider_transfer_snapshot(
    object: &JsonMap<String, JsonValue>,
) -> Option<ProviderTransferSnapshot> {
    Some(ProviderTransferSnapshot {
        transferred_indices: required_index_array(object, "transferredIndices")?,
        analyzed_indices: required_index_array(object, "analyzedIndices")?,
        omitted_indices: required_index_array(object, "omittedIndices")?,
        failed_indices: required_index_array(object, "failedIndices")?,
        omitted_candidate_count: required_usize(object, "omittedCandidateCount")?,
    })
}

/// Derives the typed JSON receipt from parsed observations.
fn derive_coverage_receipt(input: &CoverageInput) -> JsonValue {
    let inventory_count = input.inventory.paths.len();
    let mut reason_codes = Vec::<&str>::new();
    let (whole_vault_locally_screened, selected_valid, paged_count) =
        validate_local_coverage(input, &mut reason_codes);
    let (all_selected_evidence_analyzed, provider_omitted_count) =
        validate_provider_coverage(input, selected_valid, &mut reason_codes);
    let all_inventory_evidence_analyzed = whole_vault_locally_screened
        && all_selected_evidence_analyzed
        && indices_form_exact_range(&input.provider_transfer.analyzed_indices, inventory_count);
    let exact_negative_allowed = whole_vault_locally_screened && all_selected_evidence_analyzed;

    json!({
        "inventoryCount": inventory_count,
        "pagedCount": paged_count,
        "locallyScreenedCount": input.local_screen.screened_indices.len(),
        "selectedEvidenceCount": input.local_screen.selected_indices.len(),
        "providerTransferredCount": input.provider_transfer.transferred_indices.len(),
        "providerAnalyzedCount": input.provider_transfer.analyzed_indices.len(),
        "providerOmittedCount": provider_omitted_count,
        "wholeVaultLocallyScreened": whole_vault_locally_screened,
        "allSelectedEvidenceAnalyzed": all_selected_evidence_analyzed,
        "allInventoryEvidenceAnalyzed": all_inventory_evidence_analyzed,
        "exactNegativeAllowed": exact_negative_allowed,
        "reasonCodes": reason_codes,
    })
}

/// Validates inventory, pagination, local screening, and candidate-selection observations.
fn validate_local_coverage(
    input: &CoverageInput,
    reason_codes: &mut Vec<&'static str>,
) -> (bool, bool, usize) {
    let inventory_count = input.inventory.paths.len();
    let inventory_paths_valid = input
        .inventory
        .paths
        .iter()
        .all(|path| !path.trim().is_empty());
    if !inventory_paths_valid {
        push_reason(reason_codes, "invalid-inventory-path");
    }
    let inventory_unique = unique_string_count(&input.inventory.paths) == inventory_count;
    if !inventory_unique {
        push_reason(reason_codes, "duplicate-inventory-path");
    }
    let inventory_total_valid = input.inventory.total == inventory_count;
    if !inventory_total_valid {
        push_reason(reason_codes, "inventory-total-mismatch");
    }

    let (pagination_valid, paged_count) =
        validate_pagination(input, inventory_unique, reason_codes);
    let screened_valid =
        indices_form_exact_range(&input.local_screen.screened_indices, inventory_count);
    if !screened_valid {
        push_reason(reason_codes, "local-screen-incomplete");
    }
    let selected_valid =
        indices_are_unique_and_bounded(&input.local_screen.selected_indices, inventory_count)
            && indices_are_subset(
                &input.local_screen.selected_indices,
                &input.local_screen.screened_indices,
            );
    if !selected_valid
        || input.local_screen.matched_candidate_count < input.local_screen.selected_indices.len()
    {
        push_reason(reason_codes, "local-selection-invalid");
    }
    if !input.local_screen.unreadable_indices.is_empty() {
        push_reason(reason_codes, "local-screen-unreadable");
    }
    if !input.local_screen.omitted_indices.is_empty() {
        push_reason(reason_codes, "local-screen-omitted");
    }

    let whole_vault_locally_screened = inventory_paths_valid
        && inventory_unique
        && inventory_total_valid
        && pagination_valid
        && screened_valid
        && input.local_screen.unreadable_indices.is_empty()
        && input.local_screen.omitted_indices.is_empty();
    (whole_vault_locally_screened, selected_valid, paged_count)
}

/// Validates provider transfer, analysis, omission, and failure observations.
fn validate_provider_coverage(
    input: &CoverageInput,
    selected_valid: bool,
    reason_codes: &mut Vec<&'static str>,
) -> (bool, usize) {
    let inventory_count = input.inventory.paths.len();
    let transferred_valid = indices_match_exactly(
        &input.provider_transfer.transferred_indices,
        &input.local_screen.selected_indices,
        inventory_count,
    );
    if !transferred_valid {
        push_reason(reason_codes, "provider-transfer-mismatch");
    }
    let analyzed_valid = indices_match_exactly(
        &input.provider_transfer.analyzed_indices,
        &input.local_screen.selected_indices,
        inventory_count,
    );
    if !analyzed_valid {
        push_reason(reason_codes, "provider-analysis-incomplete");
    }
    let budget_omitted = input.local_screen.matched_candidate_count
        > input.local_screen.selected_indices.len()
        || input.provider_transfer.omitted_candidate_count > 0;
    if budget_omitted {
        push_reason(reason_codes, "provider-budget-omitted");
    }
    if !input.provider_transfer.omitted_indices.is_empty() {
        push_reason(reason_codes, "provider-omitted");
    }
    if !input.provider_transfer.failed_indices.is_empty() {
        push_reason(reason_codes, "provider-failed");
    }

    let all_selected_evidence_analyzed = selected_valid
        && transferred_valid
        && analyzed_valid
        && !budget_omitted
        && input.provider_transfer.omitted_indices.is_empty()
        && input.provider_transfer.failed_indices.is_empty();
    let provider_omitted_count = input
        .provider_transfer
        .omitted_indices
        .len()
        .saturating_add(input.provider_transfer.omitted_candidate_count);
    (all_selected_evidence_analyzed, provider_omitted_count)
}

/// Validates page totals, cursor continuity, exact path order, and terminal pagination.
fn validate_pagination(
    input: &CoverageInput,
    inventory_unique: bool,
    reason_codes: &mut Vec<&'static str>,
) -> (bool, usize) {
    let mut valid = true;
    let mut expected_cursor = 0_usize;
    let mut paged_count = 0_usize;
    let mut seen_paths = BTreeSet::<&str>::new();

    for page in &input.pages {
        if page.total != input.inventory.total {
            valid = false;
            push_reason(reason_codes, "page-total-mismatch");
        }
        if page.cursor != expected_cursor {
            valid = false;
            push_reason(reason_codes, "pagination-gap");
        }
        let paths_match = page.paths.iter().enumerate().all(|(offset, path)| {
            input
                .inventory
                .paths
                .get(page.cursor.saturating_add(offset))
                == Some(path)
        });
        if !paths_match {
            valid = false;
            push_reason(reason_codes, "page-path-mismatch");
        }
        if inventory_unique && page.paths.iter().any(|path| !seen_paths.insert(path)) {
            valid = false;
            push_reason(reason_codes, "duplicate-page-path");
        }
        let consumed = page.cursor.saturating_add(page.paths.len());
        let expected_next = if consumed < input.inventory.total {
            NullableIndex::Cursor(consumed)
        } else {
            NullableIndex::End
        };
        if page.next_cursor != expected_next {
            valid = false;
            push_reason(reason_codes, "pagination-next-cursor-mismatch");
        }
        expected_cursor = expected_cursor.saturating_add(page.paths.len());
        paged_count = paged_count.saturating_add(page.paths.len());
    }

    if expected_cursor != input.inventory.total || paged_count != input.inventory.total {
        valid = false;
        push_reason(reason_codes, "pagination-incomplete");
    }
    (valid, paged_count)
}

/// Returns the number of distinct strings without altering their order.
fn unique_string_count(values: &[String]) -> usize {
    values
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>()
        .len()
}

/// Returns whether indices are unique, in bounds, and cover every available index.
fn indices_form_exact_range(indices: &[usize], upper_bound: usize) -> bool {
    indices.len() == upper_bound
        && indices_are_unique_and_bounded(indices, upper_bound)
        && indices
            .iter()
            .copied()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .eq(0..upper_bound)
}

/// Returns whether indices are unique and lower than the exclusive upper bound.
fn indices_are_unique_and_bounded(indices: &[usize], upper_bound: usize) -> bool {
    indices.iter().all(|index| *index < upper_bound)
        && indices.iter().copied().collect::<BTreeSet<_>>().len() == indices.len()
}

/// Returns whether every candidate index occurs in the containing index list.
fn indices_are_subset(candidates: &[usize], containing: &[usize]) -> bool {
    let containing_set = containing.iter().copied().collect::<BTreeSet<_>>();
    candidates
        .iter()
        .all(|candidate| containing_set.contains(candidate))
}

/// Returns whether two index lists represent the same unique bounded set.
fn indices_match_exactly(left: &[usize], right: &[usize], upper_bound: usize) -> bool {
    indices_are_unique_and_bounded(left, upper_bound)
        && indices_are_unique_and_bounded(right, upper_bound)
        && left.len() == right.len()
        && left.iter().copied().collect::<BTreeSet<_>>()
            == right.iter().copied().collect::<BTreeSet<_>>()
}

/// Adds one stable reason code at most once.
fn push_reason(reason_codes: &mut Vec<&'static str>, reason: &'static str) {
    if !reason_codes.contains(&reason) {
        reason_codes.push(reason);
    }
}

/// Parses the booleans and validates the typed shape of a coverage receipt.
fn parse_coverage_flags(object: &JsonMap<String, JsonValue>) -> Option<CoverageFlags> {
    required_usize(object, "inventoryCount")?;
    required_usize(object, "pagedCount")?;
    required_usize(object, "locallyScreenedCount")?;
    required_usize(object, "selectedEvidenceCount")?;
    required_usize(object, "providerTransferredCount")?;
    required_usize(object, "providerAnalyzedCount")?;
    required_usize(object, "providerOmittedCount")?;
    required_string_array(object, "reasonCodes")?;
    let whole_vault_locally_screened = required_bool(object, "wholeVaultLocallyScreened")?;
    let all_selected_evidence_analyzed = required_bool(object, "allSelectedEvidenceAnalyzed")?;
    let all_inventory_evidence_analyzed = required_bool(object, "allInventoryEvidenceAnalyzed")?;
    let exact_negative_allowed = required_bool(object, "exactNegativeAllowed")?;
    let native_search_scope_receipt = parse_native_search_scopes(object)?;
    let expected_exact_negative = match &native_search_scope_receipt {
        NativeSearchScopeReceipt::ResearchAgent => {
            whole_vault_locally_screened && all_selected_evidence_analyzed
        }
        NativeSearchScopeReceipt::Native(scopes) => {
            !scopes.is_empty()
                && scopes.iter().all(|scope| scope.complete)
                && all_selected_evidence_analyzed
        }
    };
    if exact_negative_allowed != expected_exact_negative
        || (all_inventory_evidence_analyzed && !exact_negative_allowed)
    {
        return None;
    }

    let local = if whole_vault_locally_screened {
        LocalCoverage::WholeVaultScreened
    } else {
        LocalCoverage::Incomplete
    };
    let provider = if all_inventory_evidence_analyzed {
        ProviderCoverage::AllInventoryEvidenceAnalyzed
    } else if all_selected_evidence_analyzed {
        ProviderCoverage::SelectedEvidenceAnalyzed
    } else {
        ProviderCoverage::Incomplete
    };
    Some(CoverageFlags {
        local,
        provider,
        exact_negative_allowed,
    })
}

/// Parses optional native search scopes while leaving research-agent receipts unchanged.
fn parse_native_search_scopes(
    object: &JsonMap<String, JsonValue>,
) -> Option<NativeSearchScopeReceipt> {
    let Some(value) = object.get("searchScopes") else {
        return Some(NativeSearchScopeReceipt::ResearchAgent);
    };
    let values = value.as_array()?;
    let mut scopes = Vec::with_capacity(values.len());
    for value in values {
        let scope = value.as_object()?;
        let query = required_string(scope, "query")?;
        let path = required_string(scope, "path")?;
        let match_mode = required_string(scope, "match")?;
        let complete = required_bool(scope, "complete")?;
        if query.trim().is_empty() || !matches!(match_mode.as_str(), "all" | "any" | "phrase") {
            return None;
        }
        scopes.push(NativeSearchScope {
            query,
            path,
            match_mode,
            complete,
        });
    }
    Some(NativeSearchScopeReceipt::Native(scopes))
}

/// Detects claims that every file or the entire corpus was read or fully analyzed.
fn contains_whole_read_claim(normalized: &str) -> bool {
    answer_fragments(normalized).any(|fragment| {
        let korean_scope = ["전체", "모든", "전부", "전수"]
            .iter()
            .any(|marker| fragment.contains(marker));
        let korean_file_scope = ["파일", "노트", "문서"]
            .iter()
            .any(|marker| fragment.contains(marker));
        let korean_action = ["읽", "검토", "분석", "조사", "살펴", "확인", "훑"]
            .iter()
            .any(|marker| fragment.contains(marker));
        let korean_direct_claim = [
            "전수 조사",
            "전수 분석",
            "전수 검토",
            "전수 읽",
            "볼트 전체를 읽",
            "볼트 전체를 분석",
            "볼트 전체를 검토",
            "볼트 전체를 조사",
            "볼트 전체를 살펴",
            "볼트 전체를 확인",
            "볼트 전체를 훑",
        ]
        .iter()
        .any(|marker| fragment.contains(marker));
        let english_scope = [
            "all files",
            "all notes",
            "every file",
            "every note",
            "entire vault",
            "whole vault",
            "across the vault",
        ]
        .iter()
        .any(|marker| fragment.contains(marker));
        let english_action = [
            "read",
            "reviewed",
            "analyzed",
            "inspected",
            "examined",
            "examining",
            "scanned",
            "scanning",
            "checked",
            "checking",
        ]
        .iter()
        .any(|marker| fragment.contains(marker));
        korean_direct_claim
            || (korean_scope && korean_file_scope && korean_action)
            || (english_scope && english_action)
    })
}

/// Detects an unqualified broad absence assertion.
fn contains_broad_negative_claim(normalized: &str) -> bool {
    [
        "전혀 없",
        "관련 자료가 없",
        "관련 자료는 없",
        "자료는 없",
        "근거는 없",
        "내용은 없",
        "내용이 없",
        "아무 자료도 없",
        "아무것도 없",
        "하나도 없",
        "하나도 찾을 수 없",
        "자료가 존재하지 않",
        "근거가 존재하지 않",
        "nothing in the vault",
        "no related material",
        "no relevant material",
        "no evidence exists",
        "none exists",
        "could not find any",
        "couldn't find any",
        "does not contain any",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

/// Detects a qualified or direct-mention negative assertion.
fn contains_exact_negative_claim(normalized: &str) -> bool {
    [
        "찾지 못",
        "찾을 수 없",
        "발견하지 못",
        "확인되지 않",
        "존재하지 않",
        "직접 언급이 없",
        "did not find",
        "could not find",
        "couldn't find",
        "does not exist",
        "do not exist",
        "no direct mention",
        "not found in",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

/// Detects language that limits a negative conclusion to the verified evidence scope.
fn contains_negative_scope(normalized: &str) -> bool {
    [
        "현재 검색 범위",
        "로컬로 선별",
        "선택된 근거",
        "확인한 후보",
        "직접 언급",
        "직접 일치",
        "within the screened scope",
        "selected evidence",
        "direct mention",
        "current search scope",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

/// Returns answer sentence fragments without assigning punctuation semantics to the provider.
fn answer_fragments(normalized: &str) -> impl Iterator<Item = &str> {
    normalized.split(['.', '!', '?', '\n', '。'])
}

/// Detects at least one negative sentence explicitly limited to a search or evidence scope.
fn contains_scoped_negative_claim(normalized: &str) -> bool {
    answer_fragments(normalized).any(|fragment| {
        (contains_broad_negative_claim(fragment) || contains_exact_negative_claim(fragment))
            && contains_negative_scope(fragment)
    })
}

/// Detects broad absence language whose own sentence does not carry a scope qualifier.
fn contains_unscoped_broad_negative_claim(normalized: &str) -> bool {
    answer_fragments(normalized).any(|fragment| {
        contains_broad_negative_claim(fragment) && !contains_negative_scope(fragment)
    })
}

/// Detects whether a native-tool answer explicitly claims vault or search coverage.
fn contains_vault_search_scope(normalized: &str) -> bool {
    [
        "볼트",
        "vault",
        "현재 검색 범위",
        "current search scope",
        "선택된 근거",
        "selected evidence",
        "확인한 후보",
        "screened scope",
    ]
    .iter()
    .any(|marker| normalized.contains(marker))
}

/// Requires every scoped negative sentence to name a complete native query and its path restriction.
fn native_scoped_negative_claims_match(normalized: &str, scopes: &[NativeSearchScope]) -> bool {
    answer_fragments(normalized)
        .filter(|fragment| {
            (contains_broad_negative_claim(fragment) || contains_exact_negative_claim(fragment))
                && contains_negative_scope(fragment)
        })
        .all(|fragment| {
            scopes
                .iter()
                .any(|scope| native_search_scope_matches_fragment(scope, fragment))
        })
}

/// Matches one answer fragment against the exact query/path/match policy of a complete search.
fn native_search_scope_matches_fragment(scope: &NativeSearchScope, fragment: &str) -> bool {
    if !scope.complete {
        return false;
    }
    let query = scope.query.trim().to_lowercase();
    let terms = query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return false;
    }
    let query_matches = match scope.match_mode.as_str() {
        "phrase" => fragment.contains(&query),
        "all" => terms.iter().all(|term| fragment.contains(term)),
        "any" => terms.iter().any(|term| fragment.contains(term)),
        _ => false,
    };
    let path = scope.path.trim().to_lowercase();
    query_matches && (path.is_empty() || fragment.contains(&path))
}

/// Returns a conservative replacement sentence in the requested language.
const fn safe_coverage_text(
    korean: bool,
    flags: CoverageFlags,
    negative_claim: bool,
) -> &'static str {
    match (
        korean,
        negative_claim,
        flags.all_inventory_evidence_analyzed(),
        flags.whole_vault_locally_screened(),
        flags.all_selected_evidence_analyzed(),
    ) {
        (true, true, true, _, _) => {
            "볼트의 모든 파일을 분석했습니다. 현재 검색 범위에서 직접 일치하는 자료를 찾지 못했습니다."
        }
        (true, false, true, _, _) => "볼트의 모든 파일을 분석했습니다.",
        (true, true, false, true, true) => {
            "볼트 전체를 로컬로 선별했고 선택된 근거를 모두 분석했습니다. 현재 검색 범위에서 직접 일치하는 자료를 찾지 못했습니다."
        }
        (true, false, false, true, true) => {
            "볼트 전체를 로컬로 선별했고 선택된 근거를 모두 분석했습니다."
        }
        (true, true, false, true, false) => {
            "볼트 전체를 로컬로 선별했지만 선택된 근거 분석이 완료되지 않아 자료의 부재를 단정할 수 없습니다."
        }
        (true, false, false, true, false) => {
            "볼트 전체를 로컬로 선별했지만 선택된 근거 분석이 완료되지 않았습니다."
        }
        (true, true, false, false, _) => {
            "확인 범위가 불완전해 볼트 전체를 읽었거나 관련 자료가 없다고 단정할 수 없습니다."
        }
        (true, false, false, false, _) => {
            "확인 범위가 불완전해 볼트 전체를 읽었다고 말할 수 없습니다."
        }
        (false, true, true, _, _) => {
            "Every vault file was analyzed. No direct match was found within the current search scope."
        }
        (false, false, true, _, _) => "Every vault file was analyzed.",
        (false, true, false, true, true) => {
            "The whole vault was screened locally and all selected evidence was analyzed. No direct match was found within the current search scope."
        }
        (false, false, false, true, true) => {
            "The whole vault was screened locally and all selected evidence was analyzed."
        }
        (false, true, false, true, false) => {
            "The whole vault was screened locally, but selected-evidence analysis is incomplete, so absence cannot be asserted."
        }
        (false, false, false, true, false) => {
            "The whole vault was screened locally, but selected-evidence analysis is incomplete."
        }
        (false, true, false, false, _) => {
            "Coverage is incomplete, so the answer cannot claim that the whole vault was read or that no related material exists."
        }
        (false, false, false, false, _) => {
            "Coverage is incomplete, so the answer cannot claim that the whole vault was read."
        }
    }
}

/// Reads one required object field.
fn required_object<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Option<&'a JsonMap<String, JsonValue>> {
    object.get(key)?.as_object()
}

/// Reads one required string field.
fn required_string(object: &JsonMap<String, JsonValue>, key: &str) -> Option<String> {
    Some(object.get(key)?.as_str()?.to_owned())
}

/// Reads one required string-array field.
fn required_string_array(object: &JsonMap<String, JsonValue>, key: &str) -> Option<Vec<String>> {
    object
        .get(key)?
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_owned))
        .collect()
}

/// Reads one required index-array field.
fn required_index_array(object: &JsonMap<String, JsonValue>, key: &str) -> Option<Vec<usize>> {
    object
        .get(key)?
        .as_array()?
        .iter()
        .map(json_usize)
        .collect()
}

/// Reads one required non-negative integer field.
fn required_usize(object: &JsonMap<String, JsonValue>, key: &str) -> Option<usize> {
    json_usize(object.get(key)?)
}

/// Reads one required positive integer field.
fn required_positive_usize(object: &JsonMap<String, JsonValue>, key: &str) -> Option<usize> {
    required_usize(object, key).filter(|value| *value > 0)
}

/// Reads one required terminal-null or non-negative pagination cursor field.
fn required_nullable_index(
    object: &JsonMap<String, JsonValue>,
    key: &str,
) -> Option<NullableIndex> {
    let value = object.get(key)?;
    if value.is_null() {
        Some(NullableIndex::End)
    } else {
        json_usize(value).map(NullableIndex::Cursor)
    }
}

/// Reads one required boolean field.
fn required_bool(object: &JsonMap<String, JsonValue>, key: &str) -> Option<bool> {
    object.get(key)?.as_bool()
}

/// Converts one JSON unsigned integer to the host-sized index type.
fn json_usize(value: &JsonValue) -> Option<usize> {
    value.as_u64().and_then(|raw| usize::try_from(raw).ok())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as JsonValue, json};

    use super::{
        derive_native_tool_coverage_receipt_json, derive_research_coverage_receipt_json,
        plan_research_answer_contract_json, plan_research_candidate_selection_json,
        plan_research_provider_ledger_transition_json, plan_research_provider_request_budget_json,
    };

    fn parse_output(raw: &str) -> JsonValue {
        serde_json::from_str(raw).unwrap_or_default()
    }

    fn replace_pointer(value: &mut JsonValue, pointer: &str, replacement: JsonValue) -> bool {
        let Some(target) = value.pointer_mut(pointer) else {
            return false;
        };
        *target = replacement;
        true
    }

    fn numbered_paths(count: usize) -> Vec<String> {
        (0..count)
            .map(|index| format!("Notes/{index:04}.md"))
            .collect()
    }

    #[test]
    fn provider_request_budget_reserves_final_and_repair_after_bounded_reduction() {
        let raw = plan_research_provider_request_budget_json(
            &json!({
                "providerBatchCount": 8,
                "providerBudget": {
                    "maxSelectedItems": 64,
                    "batchSize": 8,
                    "maxBatches": 8,
                    "maxTransferItems": 64,
                },
            })
            .to_string(),
        );

        assert_eq!(
            parse_output(&raw),
            json!({
                "maxRequests": 12,
                "maxProviderAttempts": 14,
                "maxRetryWaitMs": 30_000,
                "maxMapRequests": 8,
                "maxReductionRequests": 2,
                "reservedFinalRequests": 1,
                "reservedRepairRequests": 1,
            })
        );
    }

    #[test]
    fn provider_ledger_preserves_future_logical_attempts_and_bounds_total_wait() {
        let allowed_attempt = parse_output(&plan_research_provider_ledger_transition_json(
            &json!({
                "maxProviderAttempts": 14,
                "maxRetryWaitMs": 30_000,
                "providerAttempts": 2,
                "retryWaitMs": 29_000,
                "remainingLogicalRequests": 10,
                "event": { "kind": "attempt", "retryDelayMs": 0 },
            })
            .to_string(),
        ));
        assert_eq!(
            allowed_attempt,
            json!({
                "allowed": true,
                "providerAttempts": 3,
                "retryWaitMs": 29_000,
                "reason": null,
            })
        );

        let reserved_attempt = parse_output(&plan_research_provider_ledger_transition_json(
            &json!({
                "maxProviderAttempts": 14,
                "maxRetryWaitMs": 30_000,
                "providerAttempts": 3,
                "retryWaitMs": 29_000,
                "remainingLogicalRequests": 11,
                "event": { "kind": "retry-wait", "retryDelayMs": 500 },
            })
            .to_string(),
        ));
        assert_eq!(
            reserved_attempt,
            json!({
                "allowed": false,
                "providerAttempts": 3,
                "retryWaitMs": 29_000,
                "reason": "provider-attempt-limit",
            })
        );

        let exhausted_wait = parse_output(&plan_research_provider_ledger_transition_json(
            &json!({
                "maxProviderAttempts": 14,
                "maxRetryWaitMs": 30_000,
                "providerAttempts": 2,
                "retryWaitMs": 29_750,
                "remainingLogicalRequests": 10,
                "event": { "kind": "retry-wait", "retryDelayMs": 500 },
            })
            .to_string(),
        ));
        assert_eq!(
            exhausted_wait,
            json!({
                "allowed": false,
                "providerAttempts": 2,
                "retryWaitMs": 29_750,
                "reason": "retry-wait-limit",
            })
        );
    }

    fn complete_pages(paths: &[String], page_size: usize) -> Vec<JsonValue> {
        paths
            .chunks(page_size)
            .enumerate()
            .map(|(page_index, page_paths)| {
                let cursor = page_index.saturating_mul(page_size);
                let consumed = cursor.saturating_add(page_paths.len());
                json!({
                    "cursor": cursor,
                    "paths": page_paths,
                    "total": paths.len(),
                    "nextCursor": (consumed < paths.len()).then_some(consumed),
                })
            })
            .collect()
    }

    fn coverage_input(
        paths: &[String],
        selected_indices: &[usize],
        unreadable_indices: &[usize],
        omitted_indices: &[usize],
        failed_indices: &[usize],
    ) -> JsonValue {
        json!({
            "inventory": {
                "paths": paths,
                "total": paths.len(),
            },
            "pages": complete_pages(paths, 50),
            "localScreen": {
                "screenedIndices": (0..paths.len()).collect::<Vec<_>>(),
                "selectedIndices": selected_indices,
                "matchedCandidateCount": selected_indices.len(),
                "unreadableIndices": unreadable_indices,
                "omittedIndices": omitted_indices,
            },
            "providerTransfer": {
                "transferredIndices": selected_indices,
                "analyzedIndices": selected_indices,
                "omittedIndices": omitted_indices,
                "failedIndices": failed_indices,
                "omittedCandidateCount": 0,
            },
        })
    }

    #[test]
    fn candidate_selection_uses_only_question_terms_without_builtin_aliases() {
        let raw = plan_research_candidate_selection_json(
            &json!({
                "currentQuestion": "Genesis 관련 자료를 조사해줘",
                "previousUserQuestions": ["Neville은 어떻게 말했어?"],
                "paths": [
                    "Bible/Genesis/Introduction.md",
                    "People/Neville.md",
                    "Archive/Unrelated.md"
                ],
                "samples": [
                    "Genesis structure",
                    "Neville lecture notes",
                    "회의 기록"
                ],
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output,
            json!({
                "inventoryCount": 3,
                "selectedIndices": [0, 1],
                "selectionMode": "term-match",
                "matchedCandidateCount": 2,
                "omittedCandidateCount": 0,
                "providerBatchCount": 1,
                "providerBudget": {
                    "maxSelectedItems": 64,
                    "batchSize": 8,
                    "maxBatches": 8,
                    "maxTransferItems": 64,
                },
                "terms": ["genesis", "neville"],
                "facets": [
                    {
                        "kind": "topic",
                        "terms": ["genesis"],
                    },
                    {
                        "kind": "context",
                        "terms": ["neville"],
                    }
                ],
                "planFingerprint": output.get("planFingerprint"),
            })
        );
    }

    #[test]
    fn candidate_selection_bounds_term_free_whole_vault_requests() {
        let paths = numbered_paths(100);
        let samples = vec![String::new(); paths.len()];
        let raw = plan_research_candidate_selection_json(
            &json!({
                "currentQuestion": "이 옵시디언 볼트를 요약해줘",
                "previousUserQuestions": [],
                "paths": paths,
                "samples": samples,
                "providerBudget": {
                    "maxSelectedItems": 12,
                    "batchSize": 4,
                    "maxBatches": 2,
                },
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            json!({
                "selectionMode": output.get("selectionMode"),
                "selectedIndices": output.get("selectedIndices"),
                "omittedCandidateCount": output.get("omittedCandidateCount"),
                "providerBatchCount": output.get("providerBatchCount"),
            }),
            json!({
                "selectionMode": "bounded-inventory-sample",
                "selectedIndices": [0, 12, 25, 37, 50, 62, 75, 87],
                "omittedCandidateCount": 92,
                "providerBatchCount": 2,
            })
        );
    }

    #[test]
    fn candidate_selection_scans_1406_paths_and_keeps_51_domain_neutral_matches() {
        let mut paths = numbered_paths(1_406);
        let samples = vec![String::new(); paths.len()];
        for (index, path) in paths.iter_mut().take(51).enumerate() {
            *path = format!("Projects/Migration/{index:02}.md");
        }
        let raw = plan_research_candidate_selection_json(
            &json!({
                "currentQuestion": "Migration 관련 모든 자료를 조사해줘",
                "previousUserQuestions": [],
                "paths": paths,
                "samples": samples,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("selectedIndices"),
            Some(&json!((0..51).collect::<Vec<_>>()))
        );
    }

    #[test]
    fn candidate_selection_prioritizes_combined_facets_and_preserves_facet_diversity() {
        let mut paths = (0..100)
            .map(|index| format!("Projects/Migration/{index:03}.md"))
            .collect::<Vec<_>>();
        paths.push("Projects/Aurora-Migration.md".to_owned());
        paths.push("Projects/Aurora.md".to_owned());
        let samples = vec![String::new(); paths.len()];
        let raw = plan_research_candidate_selection_json(
            &json!({
                "currentQuestion": "Migration 자료를 조사해줘",
                "previousUserQuestions": ["Aurora는 어떻게 말했어?"],
                "paths": paths,
                "samples": samples,
            })
            .to_string(),
        );
        let output = parse_output(&raw);
        let selected = output
            .get("selectedIndices")
            .and_then(JsonValue::as_array)
            .cloned()
            .unwrap_or_default();

        assert_eq!(selected.first(), Some(&json!(100)));
        assert!(selected.contains(&json!(101)));
        assert_eq!(selected.len(), 64);
    }

    #[test]
    fn coverage_receipt_accepts_complete_101_item_pagination() {
        let paths = numbered_paths(101);
        let raw = derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[0, 50, 100], &[], &[], &[]).to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output,
            json!({
                "inventoryCount": 101,
                "pagedCount": 101,
                "locallyScreenedCount": 101,
                "selectedEvidenceCount": 3,
                "providerTransferredCount": 3,
                "providerAnalyzedCount": 3,
                "providerOmittedCount": 0,
                "wholeVaultLocallyScreened": true,
                "allSelectedEvidenceAnalyzed": true,
                "allInventoryEvidenceAnalyzed": false,
                "exactNegativeAllowed": true,
                "reasonCodes": [],
            })
        );
    }

    #[test]
    fn native_tool_coverage_blocks_truncated_negative_claims_and_allows_complete_scoped_ones() {
        let truncated_receipt = parse_output(&derive_native_tool_coverage_receipt_json(
            &json!([json!({
                "action": "search",
                "query": "Neville",
                "path": "",
                "match": "all",
                "hits": [],
                "scannedFiles": 100,
                "unreadableFiles": 0,
                "totalHits": 25,
                "truncated": true,
            })
            .to_string()])
            .to_string(),
        ));
        let truncated_plan = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위에서 Neville 관련 자료를 찾지 못했습니다.",
                "receipt": truncated_receipt,
            })
            .to_string(),
        ));
        assert_eq!(
            truncated_plan.get("violationCodes"),
            Some(&json!(["exact-negative-coverage-incomplete"]))
        );

        let complete_receipt = parse_output(&derive_native_tool_coverage_receipt_json(
            &json!([json!({
                "action": "search",
                "query": "Neville",
                "path": "",
                "match": "all",
                "hits": [],
                "scannedFiles": 100,
                "unreadableFiles": 0,
                "totalHits": 0,
                "truncated": false,
            })
            .to_string()])
            .to_string(),
        ));
        let complete_plan = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위에서 Neville 관련 자료를 찾지 못했습니다.",
                "receipt": complete_receipt,
            })
            .to_string(),
        ));
        assert_eq!(complete_plan.get("allowed"), Some(&JsonValue::Bool(true)));
    }

    #[test]
    fn native_tool_negative_claim_must_match_the_complete_search_query() {
        let receipt = parse_output(&derive_native_tool_coverage_receipt_json(
            &json!([json!({
                "action": "search",
                "query": "Alpha",
                "path": "",
                "match": "all",
                "hits": [],
                "scannedFiles": 100,
                "unreadableFiles": 0,
                "totalHits": 0,
                "truncated": false,
            })
            .to_string()])
            .to_string(),
        ));
        let mismatched = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위에서 Beta 내용은 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        ));
        assert_eq!(
            mismatched.get("violationCodes"),
            Some(&json!(["exact-negative-coverage-incomplete"]))
        );

        let matched = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위에서 Alpha 내용은 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        ));
        assert_eq!(matched.get("allowed"), Some(&JsonValue::Bool(true)));
    }

    #[test]
    fn native_path_search_allows_only_query_and_path_qualified_negatives() {
        let receipt = parse_output(&derive_native_tool_coverage_receipt_json(
            &json!([json!({
                "action": "search",
                "query": "Alpha",
                "path": "Projects",
                "match": "all",
                "hits": [],
                "scannedFiles": 10,
                "unreadableFiles": 0,
                "totalHits": 0,
                "truncated": false,
            })
            .to_string()])
            .to_string(),
        ));
        assert_eq!(
            receipt.get("wholeVaultLocallyScreened"),
            Some(&JsonValue::Bool(false))
        );
        assert_eq!(
            receipt.get("exactNegativeAllowed"),
            Some(&JsonValue::Bool(true))
        );

        let missing_path = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위에서 Alpha 내용은 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        ));
        assert_eq!(
            missing_path.get("violationCodes"),
            Some(&json!(["exact-negative-coverage-incomplete"]))
        );

        let qualified = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위 Projects에서 Alpha 내용은 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        ));
        assert_eq!(qualified.get("allowed"), Some(&JsonValue::Bool(true)));
    }

    #[test]
    fn empty_native_receipt_allows_general_negative_but_not_vault_absence() {
        let receipt = parse_output(&derive_native_tool_coverage_receipt_json(
            &json!([]).to_string(),
        ));
        let general = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "현재 과학계에는 그 초자연적 주장을 입증하는 근거는 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        ));
        assert_eq!(general.get("allowed"), Some(&JsonValue::Bool(true)));

        let vault_absence = parse_output(&plan_research_answer_contract_json(
            &json!({
                "answer": "볼트 전체를 확인했지만 관련 자료는 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        ));
        assert_eq!(
            vault_absence.get("violationCodes"),
            Some(&json!([
                "whole-read-claim-unverified",
                "broad-negative-claim"
            ]))
        );
    }

    #[test]
    fn coverage_receipt_rejects_changed_page_total() {
        let paths = numbered_paths(101);
        let mut input = coverage_input(&paths, &[0], &[], &[], &[]);
        assert!(
            replace_pointer(&mut input, "/pages/1/total", json!(100)),
            "page-total fixture path should exist"
        );
        let raw = derive_research_coverage_receipt_json(&input.to_string());
        let output = parse_output(&raw);

        assert_eq!(
            output.get("wholeVaultLocallyScreened"),
            Some(&JsonValue::Bool(false))
        );
    }

    #[test]
    fn coverage_receipt_rejects_duplicate_inventory_paths() {
        let paths = vec![
            "Notes/0000.md".to_owned(),
            "Notes/0001.md".to_owned(),
            "Notes/0001.md".to_owned(),
        ];
        let raw = derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[0], &[], &[], &[]).to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("reasonCodes"),
            Some(&json!(["duplicate-inventory-path"]))
        );
    }

    #[test]
    fn coverage_receipt_rejects_unreadable_omitted_and_failed_evidence() {
        let paths = numbered_paths(4);
        let raw = derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[0, 1, 2], &[3], &[1], &[2]).to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output,
            json!({
                "inventoryCount": 4,
                "pagedCount": 4,
                "locallyScreenedCount": 4,
                "selectedEvidenceCount": 3,
                "providerTransferredCount": 3,
                "providerAnalyzedCount": 3,
                "providerOmittedCount": 1,
                "wholeVaultLocallyScreened": false,
                "allSelectedEvidenceAnalyzed": false,
                "allInventoryEvidenceAnalyzed": false,
                "exactNegativeAllowed": false,
                "reasonCodes": [
                    "local-screen-unreadable",
                    "local-screen-omitted",
                    "provider-omitted",
                    "provider-failed",
                ],
            })
        );
    }

    #[test]
    fn coverage_receipt_allows_exact_negative_after_1406_screen_and_51_analyses() {
        let paths = numbered_paths(1_406);
        let selected = (0..51).collect::<Vec<_>>();
        let raw = derive_research_coverage_receipt_json(
            &coverage_input(&paths, &selected, &[], &[], &[]).to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("exactNegativeAllowed"),
            Some(&JsonValue::Bool(true))
        );
    }

    #[test]
    fn coverage_receipt_rejects_provider_budget_omissions() {
        let paths = numbered_paths(100);
        let mut input = coverage_input(&paths, &(0..8).collect::<Vec<_>>(), &[], &[], &[]);
        assert!(
            replace_pointer(&mut input, "/localScreen/matchedCandidateCount", json!(100)),
            "matched-candidate fixture path should exist"
        );
        assert!(
            replace_pointer(
                &mut input,
                "/providerTransfer/omittedCandidateCount",
                json!(92)
            ),
            "provider-omission fixture path should exist"
        );
        let raw = derive_research_coverage_receipt_json(&input.to_string());
        let output = parse_output(&raw);

        assert_eq!(
            json!({
                "allSelectedEvidenceAnalyzed": output.get("allSelectedEvidenceAnalyzed"),
                "exactNegativeAllowed": output.get("exactNegativeAllowed"),
                "reasonCodes": output.get("reasonCodes"),
            }),
            json!({
                "allSelectedEvidenceAnalyzed": false,
                "exactNegativeAllowed": false,
                "reasonCodes": ["provider-budget-omitted"],
            })
        );
    }

    #[test]
    fn answer_contract_repairs_whole_read_and_broad_negative_claims() {
        let paths = numbered_paths(1_406);
        let selected = (0..51).collect::<Vec<_>>();
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &selected, &[], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "전체 1,406개 파일을 모두 읽었고 관련 자료가 전혀 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("violationCodes"),
            Some(&json!([
                "whole-read-claim-unverified",
                "broad-negative-claim"
            ]))
        );
    }

    #[test]
    fn answer_contract_does_not_invent_a_negative_when_repairing_positive_claims() {
        let paths = numbered_paths(1_406);
        let selected = (0..51).collect::<Vec<_>>();
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &selected, &[], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "모든 파일을 읽었고 네빌의 창세기 언급을 찾았습니다.",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output,
            json!({
                "allowed": false,
                "action": "repair",
                "violationCodes": ["whole-read-claim-unverified"],
                "safeCoverageText": "볼트 전체를 로컬로 선별했고 선택된 근거를 모두 분석했습니다.",
            })
        );
    }

    #[test]
    fn answer_contract_does_not_combine_unrelated_scope_and_action_across_sentences() {
        let paths = numbered_paths(20);
        let selected = (0..4).collect::<Vec<_>>();
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &selected, &[], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "이 파일은 구약 성경 전체 소개입니다. 볼트에 저장된 성경 소개 파일에서 해당 책을 확인했습니다.",
                "language": "ko",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(output.get("allowed"), Some(&json!(true)));
        assert_eq!(output.get("violationCodes"), Some(&json!([])));
    }

    #[test]
    fn answer_contract_prefers_explicit_english_locale_over_korean_proper_nouns() {
        let paths = numbered_paths(2);
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[0], &[], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "After checking every note, I found evidence about 네빌.",
                "language": "en",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("safeCoverageText"),
            Some(&json!(
                "The whole vault was screened locally and all selected evidence was analyzed."
            ))
        );
    }

    #[test]
    fn answer_contract_allows_scoped_exact_negative_with_complete_receipt() {
        let paths = numbered_paths(1_406);
        let selected = (0..51).collect::<Vec<_>>();
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &selected, &[], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "볼트 전체를 로컬로 선별하고 선택된 근거를 모두 분석했지만, 현재 검색 범위에서 네빌의 창세기 직접 언급을 찾지 못했습니다.",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output,
            json!({
                "allowed": true,
                "action": "allow",
                "violationCodes": [],
                "safeCoverageText": "볼트 전체를 로컬로 선별했고 선택된 근거를 모두 분석했습니다. 현재 검색 범위에서 직접 일치하는 자료를 찾지 못했습니다.",
            })
        );
    }

    #[test]
    fn answer_contract_reports_one_violation_for_scoped_negative_with_incomplete_receipt() {
        let paths = numbered_paths(2);
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[], &[0], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "현재 검색 범위에서 네빌의 창세기 직접 언급을 찾지 못했습니다.",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("violationCodes"),
            Some(&json!(["exact-negative-coverage-incomplete"]))
        );
    }

    #[test]
    fn answer_contract_rejects_common_unverified_claim_variants() {
        let paths = numbered_paths(2);
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[], &[0], &[], &[]).to_string(),
        ));
        let cases = [
            (
                "전체 문서를 살펴본 결과 핵심 주제를 정리했습니다.",
                "whole-read-claim-unverified",
            ),
            ("관련 자료가 존재하지 않습니다.", "broad-negative-claim"),
            ("하나도 찾을 수 없었습니다.", "broad-negative-claim"),
            (
                "After checking every note, the result is complete.",
                "whole-read-claim-unverified",
            ),
            ("No evidence exists in the vault.", "broad-negative-claim"),
        ];

        for (answer, expected_code) in cases {
            let raw = plan_research_answer_contract_json(
                &json!({ "answer": answer, "receipt": receipt }).to_string(),
            );
            let output = parse_output(&raw);
            let violations = output
                .get("violationCodes")
                .and_then(JsonValue::as_array)
                .cloned()
                .unwrap_or_default();
            assert!(
                violations.contains(&json!(expected_code)),
                "{answer} should produce {expected_code}: {output}"
            );
        }
    }

    #[test]
    fn answer_contract_rejects_korean_whole_vault_check_with_topic_absence() {
        let paths = numbered_paths(100);
        let receipt = parse_output(&derive_research_coverage_receipt_json(
            &coverage_input(&paths, &[], &[0], &[], &[]).to_string(),
        ));
        let raw = plan_research_answer_contract_json(
            &json!({
                "answer": "볼트 전체를 확인했지만 네빌 자료는 없습니다.",
                "receipt": receipt,
            })
            .to_string(),
        );
        let output = parse_output(&raw);

        assert_eq!(
            output.get("violationCodes"),
            Some(&json!([
                "whole-read-claim-unverified",
                "broad-negative-claim"
            ]))
        );
    }
}
