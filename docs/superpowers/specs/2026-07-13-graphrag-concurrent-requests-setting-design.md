# GraphRAG Concurrent Requests Setting Design

## Goal

Restore user control over GraphRAG extraction concurrency without weakening the safe default introduced by commit `1e62fa5f`. The setting must accept integers from 1 through 10, default to 1, and show both a slider and its current numeric value.

## Scope

- Add `graphRagMaxConcurrentRequests` to the persisted RAG configuration.
- Normalize missing or invalid stored values to the safe default of 1 and clamp valid numeric input to the supported 1–10 range.
- Pass the normalized value into `GraphRagIndexingRunner` and use it as the existing extraction batch size.
- Add one GraphRAG core-setting row using Obsidian's slider component with limits 1–10, step 1, and a visible numeric value.
- Add Korean and English labels and descriptions.
- Update current-product documentation only where the user-facing control materially belongs; do not create release-note files or changelog entries.

## Architecture and Data Flow

`SuperpowerInsideSettings.rag.graphRagMaxConcurrentRequests` is the persisted source of truth. Settings migration normalizes it before runtime initialization. `main.ts` passes the value to `GraphRagIndexingRunner`, whose constructor stores it and whose existing `Promise.all` batch loop uses it instead of a fixed constant.

The setting UI updates the persisted value through the existing debounced RAG save path. Saving settings reinitializes the GraphRAG runtime under the existing plugin lifecycle, so the next extraction batch uses the new limit. No concurrency policy or provider-specific calculation is added to TypeScript.

## User Experience

The control appears in the GraphRAG core settings near the model and per-run file limit. It uses the only slider exception authorized for this section. The range is 1–10 with integer steps, and the current value remains visible as a number beside the slider. The default remains 1 so existing reliability behavior does not change unless the user deliberately raises concurrency.

## Validation and Failure Handling

- Stored settings are normalized to an integer in the 1–10 range.
- The runner defensively clamps constructor input to the same range.
- Cancellation and per-request error behavior remain unchanged because the existing batch loop is retained.
- Tests cover the default, migration/normalization, UI structure, and observed maximum provider concurrency.
- UI verification covers normal and narrow settings widths in the real Obsidian app or the repository's approved visual simulation.

## Release Integration

After implementation, run lint, typecheck, tests, the full security gate, build, and the built review gate for version 1.5.0. Synchronize `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`. Review the README and integrate the control into its current usage guidance only if it improves the durable product explanation. Commit in English, ensure `main` is the release branch, and push `main` after all gates and visual review pass.
