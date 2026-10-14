#!/bin/sh
# Boots the assembled bundle the way Lambda does and asserts /health byte for
# byte. Runs inside the build image, so it proves the bundled interpreter and
# wheels actually start -- test_main.py only proves the ASGI app answers.
#
# Usage: smoke.sh [bundle-dir]   # the zip root: index.js, server, python/
set -eu

TASK_DIR=${1:-/var/task}

AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 "$TASK_DIR/server" >/tmp/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

# --retry-connrefused waits out the interpreter boot, so no polling loop.
if ! body=$(curl -fsS --retry 30 --retry-delay 1 --retry-connrefused \
    http://127.0.0.1:3000/health); then
  echo "FAIL: server never answered" >&2
  cat /tmp/server.log >&2
  exit 1
fi

if [ "$body" != '{"status":"Ok","backend":"python"}' ]; then
  echo "FAIL: unexpected body: $body" >&2
  exit 1
fi

echo "OK: $body"
