#!/usr/bin/env fish

set -l SCRIPT_DIR (dirname (status --current-filename))
set -l REPO_ROOT (realpath "$SCRIPT_DIR/..")
set -l SOURCE "$REPO_ROOT/node_modules/@ternlight/base/pkg-node/tern_engine_bg.wasm"
set -l TARGET "$REPO_ROOT/tern_engine_bg.wasm"
set -l EXPECTED_SHA256 "27819b70b83fb24a493792db7bdf6b9cae4a1531df408809d1e57d580a3e9087"

if not test -f "$SOURCE"
    echo "ERROR: Ternlight WASM asset is missing: $SOURCE" >&2
    exit 1
end

set -l ACTUAL_SHA256 (shasum -a 256 "$SOURCE" | string split ' ' | head -n 1)
if test "$ACTUAL_SHA256" != "$EXPECTED_SHA256"
    echo "ERROR: Ternlight WASM checksum mismatch: $ACTUAL_SHA256" >&2
    exit 1
end

cp "$SOURCE" "$TARGET"
echo "Copied Ternlight WASM asset to $TARGET"
