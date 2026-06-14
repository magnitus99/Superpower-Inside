#!/usr/bin/env fish

set -l REPO_ROOT (realpath (dirname (status -f))/..)
cd "$REPO_ROOT"; or exit 1

set -l TOOLCHAIN 1.96.0
set -l HOST (rustc -vV | string match -r '^host: .*' | string replace 'host: ' '')
set -l RUSTUP_PREFIX /opt/homebrew/opt/rustup/bin
set -l RUSTUP_BIN "$RUSTUP_PREFIX/rustup"
set -l CARGO_BIN "$RUSTUP_PREFIX/cargo"
set -l TOOLCHAIN_DIR "$HOME/.rustup/toolchains/$TOOLCHAIN-$HOST"

if not test -x "$CARGO_BIN"
    set CARGO_BIN cargo
end

if not test -x "$RUSTUP_BIN"
    if command -sq rustup
        set RUSTUP_BIN rustup
    end
end

if test -x "$RUSTUP_BIN"
    "$RUSTUP_BIN" toolchain install "$TOOLCHAIN" --profile minimal
    or exit $status
    "$RUSTUP_BIN" component add clippy rustfmt --toolchain "$TOOLCHAIN"
    or exit $status
    "$RUSTUP_BIN" target add wasm32-unknown-unknown --toolchain "$TOOLCHAIN"
    or exit $status
end

if test -d "$TOOLCHAIN_DIR/bin"
    set -x PATH "$TOOLCHAIN_DIR/bin" $PATH
    set -x RUSTC "$TOOLCHAIN_DIR/bin/rustc"
    set -x RUSTDOC "$TOOLCHAIN_DIR/bin/rustdoc"
end

set -x PATH "$HOME/.cargo/bin" $PATH

set -l OUT_DIR "$REPO_ROOT/generated/rag-wasm"
set -l BINDGEN_DIR "$REPO_ROOT/target/rag-wasm-bindgen"
set -l WASM_INPUT "$REPO_ROOT/target/wasm32-unknown-unknown/release/superpower_rag_wasm.wasm"
set -l CARGO_CMD "$CARGO_BIN"

if command -sq "$RUSTUP_BIN"
    set CARGO_CMD "$RUSTUP_BIN" run "$TOOLCHAIN" cargo
end

$CARGO_CMD build -p superpower-rag-wasm --target wasm32-unknown-unknown --release
or exit $status

rm -rf "$BINDGEN_DIR"
mkdir -p "$OUT_DIR"

set -l WASM_BINDGEN_BIN "$HOME/.cargo/bin/wasm-bindgen"
if not test -x "$WASM_BINDGEN_BIN"
    set WASM_BINDGEN_BIN wasm-bindgen
end

"$WASM_BINDGEN_BIN" --target web --out-dir "$BINDGEN_DIR" --out-name rag_wasm "$WASM_INPUT"
or exit $status

cp "$BINDGEN_DIR/rag_wasm.js" "$OUT_DIR/rag_wasm.js"
cp "$BINDGEN_DIR/rag_wasm.d.ts" "$OUT_DIR/rag_wasm.d.ts"
node scripts/patch-rag-wasm-dts.mjs "$OUT_DIR/rag_wasm.d.ts"
or exit $status
node scripts/patch-rag-wasm-glue.mjs "$OUT_DIR/rag_wasm.js"
or exit $status
node scripts/embed-rag-wasm.mjs "$BINDGEN_DIR/rag_wasm_bg.wasm" "src/rag/rag-wasm-bytes.ts"
