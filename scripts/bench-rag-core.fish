#!/usr/bin/env fish

set script_dir (dirname (status --current-filename))
set repo_dir (dirname "$script_dir")

cd "$repo_dir"; or exit 1

echo "RAG core benchmark (release, median ns)"
cargo test --release --workspace bench_rag_core_runtime_medians -- --ignored --nocapture
