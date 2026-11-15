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

# 빌드는 설치된 도구와 의존성만 사용합니다. 준비가 안 됐으면 실패로 알립니다.
if command -sq "$RUSTUP_BIN"
    "$RUSTUP_BIN" run "$TOOLCHAIN" rustc --version >/dev/null
    or exit $status
end

if test -d "$TOOLCHAIN_DIR/bin"
    set -x PATH "$TOOLCHAIN_DIR/bin" $PATH
    set -x RUSTC "$TOOLCHAIN_DIR/bin/rustc"
    set -x RUSTDOC "$TOOLCHAIN_DIR/bin/rustdoc"
end

set -x PATH "$HOME/.cargo/bin" $PATH

set -l OUT_DIR "$REPO_ROOT/.local/generated/rag-wasm"
set -l BINDGEN_DIR "$REPO_ROOT/.local/cache/bindgen"
set -l BUILD_TARGET_DIR "$REPO_ROOT/.local/cache/rust"

if test -n "$CARGO_TARGET_DIR"
    set BUILD_TARGET_DIR "$CARGO_TARGET_DIR"
end

set -x CARGO_TARGET_DIR "$BUILD_TARGET_DIR"
set -l WASM_INPUT "$BUILD_TARGET_DIR/wasm32-unknown-unknown/release/superpower_rag_wasm.wasm"
set -l CARGO_CMD "$CARGO_BIN"

if command -sq "$RUSTUP_BIN"
    set CARGO_CMD "$RUSTUP_BIN" run "$TOOLCHAIN" cargo
end

$CARGO_CMD build -p superpower-rag-wasm --target wasm32-unknown-unknown --release --frozen
or exit $status

rm -rf "$BINDGEN_DIR"
mkdir -p "$OUT_DIR"

set -l WASM_BINDGEN_BIN "$HOME/.cargo/bin/wasm-bindgen"
if not test -x "$WASM_BINDGEN_BIN"
    set WASM_BINDGEN_BIN wasm-bindgen
end

"$WASM_BINDGEN_BIN" --target web --out-dir "$BINDGEN_DIR" --out-name rag_wasm "$WASM_INPUT"
or exit $status

# npm의 Windows shim 대신 현재 fish 환경의 Node로 실행합니다.
set -l WASM_OPT_BIN "$REPO_ROOT/node_modules/binaryen/bin/wasm-opt"
if not test -f "$WASM_OPT_BIN"
    echo "ERROR: wasm-opt를 찾을 수 없습니다. npm install로 개발 의존성을 설치하세요."
    exit 1
end

set -l OPTIMIZED_WASM "$BINDGEN_DIR/rag_wasm_bg.optimized.wasm"
node "$WASM_OPT_BIN" -Oz "$BINDGEN_DIR/rag_wasm_bg.wasm" -o "$OPTIMIZED_WASM"
or exit $status
mv "$OPTIMIZED_WASM" "$BINDGEN_DIR/rag_wasm_bg.wasm"
or exit $status

cp "$BINDGEN_DIR/rag_wasm.js" "$OUT_DIR/rag_wasm.js"
cp "$BINDGEN_DIR/rag_wasm.d.ts" "$OUT_DIR/rag_wasm.d.ts"
node scripts/patch-rag-wasm-dts.mjs "$OUT_DIR/rag_wasm.d.ts"
or exit $status
node scripts/patch-rag-wasm-glue.mjs "$OUT_DIR/rag_wasm.js"
or exit $status
node scripts/embed-rag-wasm.mjs "$BINDGEN_DIR/rag_wasm_bg.wasm" ".local/generated/rag-wasm-bytes.ts"
