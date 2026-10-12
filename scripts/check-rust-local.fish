#!/usr/bin/env fish
# 작업 중에는 기존 Rust 검사 중 fmt·clippy·tests만 오프라인으로 실행합니다.
set -lx RUSTUP_TOOLCHAIN 1.96.0
set -lx CARGO_TARGET_DIR (pwd)/target/rustup-1.96.0
set -lx CARGO_NET_OFFLINE true
set -lx PATH (dirname (rustup which --toolchain 1.96.0 cargo)) $PATH
rustup run 1.96.0 cargo fmt --all --check
and rustup run 1.96.0 cargo clippy --workspace --all-targets --all-features --frozen -- -D warnings
and rustup run 1.96.0 cargo test --workspace --frozen
or exit $status
