# RAG Performance Guard Completion Design

## Goal

Make RAG performance protection truthful and self-managing. Throttling must affect the next embedding batch, a paused guard must prevent new embedding requests, and interrupted scheduler work must resume automatically without losing the original operation. Manual resume must continue safely instead of resetting to full speed.

## Considered Approaches

1. **Patch the TypeScript loop only.** Read the current guard values before every batch and change the resume button. This is small, but it leaves deterministic state policy in TypeScript and does not solve scheduler-level work preservation cleanly.
2. **Rust policy planner with a host-side adaptive loop and pausable scheduler.** Rust owns deterministic state transitions. TypeScript measures host time, performs provider I/O, applies the returned batch/yield values, and parks or resumes scheduler work. This is the selected approach because it matches the project boundary and fixes the full behavior without adding user settings.
3. **Move indexing into a dedicated worker.** This provides stronger renderer isolation, but it expands the release into provider transport, storage, cancellation, and Obsidian-host redesign. It is not required to correct this guard.

## Architecture

### Rust/WASM policy

Add a deterministic RAG performance-guard planner. Its JSON input contains configuration, the previous policy snapshot, one event, and the host-provided current time. The Rust-owned event union is `initialize`, `batch_sample`, `event_loop_sample`, `timer_tick`, `force_resume`, or `reset`; TypeScript cannot recreate any of these transitions. Its output contains:

- mode: `normal`, `throttled`, or `paused`;
- current embedding batch size and host yield;
- independent batch-latency and event-loop counters;
- pause deadline;
- structured reason codes and values for TypeScript localization.

Batch latency can progressively reduce batch size but cannot pause indexing by itself because remote network/provider latency is not proof that the Obsidian renderer is overloaded. Persistent event-loop lag can throttle and then pause. Recovery requires healthy samples from both channels. A timed or forced resume starts in the safest throttled state: batch size 1 and the maximum host yield.

### TypeScript host adapter

`PerformanceGuard` remains the host-facing adapter. It obtains time, measures event-loop lag, calls the Rust planner, validates its complete output schema, and maps structured reason codes to localized strings. It contains no fallback state-transition policy. Initialization fails closed by rejecting RAG runtime initialization if Rust cannot produce the first valid snapshot. A later bridge failure preserves the last valid snapshot and reports through the `rag.performance-guard` application logger plus the existing agent-diagnostics breadcrumb callback.

The indexer reads the current guard state immediately before every embedding request. It calculates each batch from the current guard batch size, awaits the batch-duration sample and event-loop sample, rechecks pause, advances by the actual submitted batch length, and then reads the current yield before continuing. This must neither skip nor duplicate input texts when the batch size changes. A paused state throws before another provider request starts.

### Scheduler pause and resume

The indexer raises a typed `IndexingPerformancePausedError` distinct from `IndexingCancelledError` and provider failures. User cancellation takes precedence when an abort and performance pause race. Only the typed performance-pause outcome may park work.

When the guard pauses, the scheduler moves the original job and promise into one parked slot, stops draining embedding jobs, exposes `phase: paused`, and keeps both `status.running` and `isRunning()` true because the original operation is still outstanding. Consequently `isRagIndexing()`, auto-index gating, status formatting, controls, and `waitForIdle()` all treat parked work as active rather than idle or successful. The scheduler uses a separate private draining flag so a wake-up can restart work without falsifying public status.

The scheduler schedules one generation-protected wake-up for the pause deadline. At the deadline it sends `timer_tick` through the Rust adapter and restarts the provider job only after a validated throttled/normal result. If the planner throws or returns an invalid wake result, the job remains parked in a terminal diagnostic pause with no zero-delay retry timer; status and the manual action remain available. A later manual retry may send `force_resume`, but failure must return an error and cannot claim success or unpark the job. Manual resume, ordinary cancellation, runtime rebuild, and unload invalidate the timer generation and clear its timer exactly once. Repeated resume clicks and stale timer callbacks cannot start duplicate jobs.

New file, pending, and full-reindex work joins the queue behind the parked job. Delete operations are coalesced against matching parked or queued file work so obsolete paths cannot be restored. Before a parked file job restarts, its `TFile` must still resolve as the current vault object; deleted or superseded file jobs settle as skipped. Pending and full-reindex jobs rescan the current vault when restarted.

Manual `Resume now` sends `force_resume` to Rust, enters safe throttled mode, and wakes the parked scheduler. It does not cancel the scheduler, discard queued work, claim completion before work restarts, or reset to the original maximum batch size.

Explicit cancellation remains distinct from performance pausing. It aborts active embedding work, invalidates pause timers, rejects parked and queued public indexing promises with `IndexingCancelledError`, settles internal fire-and-forget jobs, clears dirty/debounced indexing work, and leaves no promise or idle waiter hanging. A later new request starts a fresh scheduler generation. Delete lifecycle work must be settled deterministically as cancellation or coalesced cleanup rather than left queued. Cover every job kind and `cancel` followed by new work.

## Data Safety and Failure Handling

The current clear-first full reindex is incompatible with pausing because it destroys the usable index before replacement completes. Replace it with an in-place rebuild: rescan and reindex every current candidate through file-level replacement, keep the previous version of untouched files available during interruption, and prune obsolete source paths only after the complete run succeeds. Do not check cancellation between vector replacement and the matching BM25 update, so a file-level commit finishes as one application operation. A paused or cancelled full reindex therefore preserves a usable previous index for unprocessed files and can safely restart; successful completion leaves vector and BM25 source coverage consistent.

If the Rust planner throws or returns malformed JSON, invalid counters, invalid modes, unsafe batch/yield values, or impossible deadlines, the adapter preserves its last valid state and reports the bridge failure; it must not reproduce the state policy in TypeScript.

## Tests

Add regression coverage proving:

- batch throttling changes the next batch inside the same indexing job;
- provider latency alone never enters `paused`;
- sustained event-loop lag enters `paused`;
- a paused guard prevents the next provider call;
- healthy samples restore defaults only after both signal channels recover;
- cooldown and forced resume restart at batch size 1 with the maximum yield;
- a scheduler job parked by the guard remains pending and resumes automatically;
- manual resume wakes the same job without cancelling the queue;
- `waitForIdle`, status, and promise state remain outstanding while parked;
- timer generation prevents duplicate wake-ups across repeated pause/wake and resume cycles;
- early manual resume, cooldown wake, repeated resume clicks, cancellation, runtime replacement, and unload clean every timer correctly;
- ordinary user cancellation remains cancellation, not a performance pause, and every scheduler job kind settles;
- cancel followed by new work starts a clean generation;
- pause during file, pending, and full-reindex work preserves ordering and data safety;
- delete/rename while a file job is parked cannot restore an obsolete path;
- a paused full reindex preserves prior vector/BM25 coverage for unprocessed files and successful retry finishes consistent coverage;
- provider rejection is not mistaken for a guard pause;
- disabled guard behavior remains unchanged;
- malformed planner output preserves the last valid snapshot and emits diagnostics;
- malformed timed or manual resume results keep work visibly parked without a retry loop or false success;
- localized status and button contracts remain accurate.

Start from a clean `npm ci`, then run the complete required sequence: `npm run security:full`, `npm run build`, and `npm run review -- --tag 1.5.4 --built`.

## Release and UX

No new setting or maintenance surface is added. The existing automatic mode remains the default. The settings UI keeps one recovery action, but its behavior becomes truthful. Because the change affects a visible status/action flow, capture and inspect actual Windows Obsidian screenshots for normal, throttled, paused, and resumed states before implementation completion. This is a UI completion check, not an added release-workflow gate.

Prepare version `1.5.4` in `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`. Update the README version badge but do not add a changelog or release-notes file. Push the exact `1.5.4` tag without a `v` prefix. The GitHub Release body should summarize the user benefit directly and remain outside the repository. Verify at least `manifest.json`, built `main.js`, and `styles.css` in the published assets, plus every additional asset required by the current workflow.
