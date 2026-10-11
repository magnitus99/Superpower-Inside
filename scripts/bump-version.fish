#!/usr/bin/env fish
# 기존 fish 진입점은 호스트의 Node.js 스크립트에 위임합니다.
node (dirname (status --current-filename))/bump-version.mjs $argv
exit $status
