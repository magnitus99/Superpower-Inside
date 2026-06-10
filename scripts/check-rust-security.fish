#!/usr/bin/env fish

set -l REPO_ROOT (realpath (dirname (status -f))/..)
cd "$REPO_ROOT"; or exit 1

set -l TOOLCHAIN 1.96.0
set -l HOST (rustc -vV | string match -r '^host: .*' | string replace 'host: ' '')
set -l RUSTUP_PREFIX /opt/homebrew/opt/rustup/bin
set -l RUSTUP_BIN "$RUSTUP_PREFIX/rustup"
set -l CARGO_BIN "$RUSTUP_PREFIX/cargo"
set -l TOOLCHAIN_DIR "$HOME/.rustup/toolchains/$TOOLCHAIN-$HOST"
set -l TOOLCHAIN_RUSTC "$TOOLCHAIN_DIR/bin/rustc"
set -l TOOLCHAIN_RUSTDOC "$TOOLCHAIN_DIR/bin/rustdoc"

if not test -x "$CARGO_BIN"
    set CARGO_BIN cargo
end

if test -x "$RUSTUP_BIN"
    "$RUSTUP_BIN" toolchain install "$TOOLCHAIN" --profile minimal
    or exit $status
    "$RUSTUP_BIN" component add clippy rustfmt --toolchain "$TOOLCHAIN"
    or exit $status
    "$RUSTUP_BIN" target add wasm32-unknown-unknown --toolchain "$TOOLCHAIN"
    or exit $status
end

if test -x "$TOOLCHAIN_RUSTC"
    set -x PATH "$TOOLCHAIN_DIR/bin" $PATH
    set -x RUSTC "$TOOLCHAIN_RUSTC"
end

if test -x "$TOOLCHAIN_RUSTDOC"
    set -x RUSTDOC "$TOOLCHAIN_RUSTDOC"
end

set -x CARGO_TARGET_DIR "$REPO_ROOT/target/rustup-$TOOLCHAIN"

set -l REQUIRED_TOOLS cargo-deny cargo-audit cargo-geiger cargo-vet
for tool in $REQUIRED_TOOLS
    if not command -sq "$tool"
        echo "ERROR: $tool 명령을 찾을 수 없습니다. brew 또는 cargo로 먼저 설치해야 합니다."
        exit 1
    end
end

echo "==> rustfmt"
"$CARGO_BIN" +"$TOOLCHAIN" fmt --all --check
or exit $status

echo "==> clippy"
"$CARGO_BIN" +"$TOOLCHAIN" clippy --workspace --all-targets --all-features -- -D warnings
or exit $status

echo "==> unit tests"
"$CARGO_BIN" +"$TOOLCHAIN" test --workspace
or exit $status

echo "==> wasm target build"
"$CARGO_BIN" +"$TOOLCHAIN" build --workspace --target wasm32-unknown-unknown
or exit $status

echo "==> cargo-deny"
cargo deny --workspace --locked check
or exit $status

echo "==> cargo-audit"
cargo audit -D warnings
or exit $status

echo "==> cargo-vet"
cargo vet --locked
or exit $status

echo "==> cargo-geiger"
cargo geiger --manifest-path "$REPO_ROOT/crates/rag-wasm/Cargo.toml" --all-features --all-targets --locked --forbid-only --output-format Ratio
or exit $status
