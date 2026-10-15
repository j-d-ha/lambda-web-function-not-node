#!/bin/sh
# Boots the assembled bundle the way Lambda does and asserts /health byte for
# byte. Runs on linux/arm64 inside the build image. Unlike the JVM sibling there
# is no launcher script and no runtime to start -- `server` is the native
# binary itself -- but the bundle is still a linux-arm64 artifact, so this is
# the only place it can be exercised.
#
# Usage: smoke.sh [bundle-dir]   # the zip root: index.js, server
set -eu

TASK_DIR=${1:-/var/task}

AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 "$TASK_DIR/server" >/tmp/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

# Native startup is tens of milliseconds; the retries are there for the build
# container's own startup, not the app's.
if ! body=$(curl -fsS --retry 30 --retry-delay 1 --retry-connrefused \
    http://127.0.0.1:3000/health); then
  echo "FAIL: server never answered" >&2
  cat /tmp/server.log >&2
  exit 1
fi

if [ "$body" != '{"status":"Ok","backend":"java-aot"}' ]; then
  echo "FAIL: unexpected body: $body" >&2
  exit 1
fi

echo "OK: $body"
