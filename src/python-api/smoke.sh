#!/bin/sh
# Starts the built server the way Lambda does and asserts the /health payload
# byte for byte. Runs inside the build image against the assembled bundle, so it
# proves the bundled interpreter and wheels actually boot -- not just that the
# ASGI app answers when imported (that is test_main.py's job).
#
# Usage: smoke.sh [bundle-dir]   # the zip root: index.js, server, python/
set -eu

TASK_DIR=${1:-/var/task}

AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 "$TASK_DIR/server" >/tmp/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

i=0
while [ "$i" -lt 60 ]; do
  body=$(curl -fsS http://127.0.0.1:3000/health 2>/dev/null || true)
  if [ "$body" = '{"status":"Ok","backend":"python"}' ]; then
    echo "OK: $body"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "FAIL: last body=$body" >&2
cat /tmp/server.log >&2
exit 1
