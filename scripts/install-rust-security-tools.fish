#!/usr/bin/env fish

set -x CARGO_HTTP_MULTIPLEXING false
set -x CARGO_NET_RETRY 10
set -x PATH "$HOME/.local/bin" "$HOME/.cargo/bin" $PATH

function install_cargo_tool --argument-names package tool_version binary
    set -l install_args $argv[4..-1]
    set -l max_attempts 3
    set -l last_status 1

    for attempt in (seq 1 $max_attempts)
        echo "==> cargo install $package $tool_version (attempt $attempt/$max_attempts)"
        cargo install "$package" --version "$tool_version" --locked --force $install_args
        set last_status $status

        if test "$last_status" -eq 0
            set -l installed_binary "$HOME/.cargo/bin/$binary"
            if test -x "$installed_binary"
                "$installed_binary" --version
            else if command -sq "$binary"
                "$binary" --version
            end
            return 0
        end

        if test "$attempt" -lt "$max_attempts"
            set -l delay_seconds (math "$attempt * 10")
            echo "WARN: $package 설치 실패. $delay_seconds초 후 재시도합니다."
            sleep "$delay_seconds"
        end
    end

    echo "ERROR: $package 설치 실패"
    return "$last_status"
end

install_cargo_tool wasm-bindgen-cli 0.2.123 wasm-bindgen
or exit $status

install_cargo_tool cargo-deny 0.19.8 cargo-deny
or exit $status

install_cargo_tool cargo-audit 0.22.2 cargo-audit
or exit $status

install_cargo_tool cargo-geiger 0.13.0 cargo-geiger --features vendored-openssl
or exit $status

install_cargo_tool cargo-vet 0.10.2 cargo-vet
or exit $status
