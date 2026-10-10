#!/usr/bin/env fish
npm run security:full
and npm run build
and npm run review -- --tag (node -p "require('./manifest.json').version") --built
and npm run copy:check
or exit $status
