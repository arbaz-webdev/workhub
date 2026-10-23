#!/usr/bin/env bash
# Runs the API and the website in one container (the free staging plan allows one service).
# The API listens on 127.0.0.1 only, so the internet can't reach it; the website proxies
# /api/* to it. If either process stops, the container stops and the host restarts it.
set -euo pipefail

node apps/api/scripts/migrate.mjs

# The host sets PORT for the website; the API always uses 4000 inside the container.
HOST=127.0.0.1 PORT=4000 NODE_OPTIONS="--max-old-space-size=192" node apps/api/dist/main.js &
api=$!

NODE_OPTIONS="--max-old-space-size=256" node_modules/.bin/next start apps/web -H :: -p "${PORT:-3000}" &
web=$!

trap 'kill -TERM "$api" "$web" 2>/dev/null' TERM INT
status=0
wait -n "$api" "$web" || status=$?
kill -TERM "$api" "$web" 2>/dev/null || true
wait || true
exit "$status"
