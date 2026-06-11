#!/usr/bin/env fish

set -l REPO_ROOT (realpath (dirname (status -f))/..)
cd "$REPO_ROOT"; or exit 1

set -l REQUIRED_TOOLCHAIN 1.96.0
set -l TOOLCHAIN_FILE "$REPO_ROOT/rust-toolchain.toml"
set -l TOOLCHAIN "$REQUIRED_TOOLCHAIN"

if test -f "$TOOLCHAIN_FILE"
    set -l FILE_TOOLCHAIN (sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' "$TOOLCHAIN_FILE" | string trim)
    if test -n "$FILE_TOOLCHAIN"
        if test "$FILE_TOOLCHAIN" != "$REQUIRED_TOOLCHAIN"
            echo "ERROR: rust-toolchain.toml is '$FILE_TOOLCHAIN'. This project requires '$REQUIRED_TOOLCHAIN'."
            exit 1
        end
        set TOOLCHAIN "$FILE_TOOLCHAIN"
    end
end

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

if not command -sq npm
    echo "ERROR: npm 명령을 찾을 수 없습니다. Node.js가 설치되어 있는지 확인하세요."
    exit 1
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

set -l REQUIRED_TOOLS wasm-bindgen cargo-deny cargo-audit cargo-geiger cargo-vet
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

echo "==> npm audit (critical)"
npm audit --audit-level=critical
or exit $status

echo "==> wasm bindings"
fish scripts/build-rag-wasm.fish
or exit $status

if command -sq git
    git diff --exit-code -- generated/rag-wasm src/rag/rag-wasm-bytes.ts
    or begin
        echo "ERROR: Rust/WASM generated files are out of date. Run npm run wasm:build and commit the result."
        exit 1
    end
end
