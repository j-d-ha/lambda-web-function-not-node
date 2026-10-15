#!/bin/sh
# Boots the assembled bundle the way Lambda does and asserts /health byte for
# byte. Runs on linux/arm64 inside the build image, so it proves the bundled
# runtime actually starts -- the bundle is a linux-arm64 tree, so this is the
# only place it can be exercised.
#
# Usage: smoke.sh <bundle-dir> <backend-name>
#
# The backend name is passed in through BACKEND_NAME rather than baked into the
# artifact, so this doubles as the check that revision configuration reaches the
# running app: it is the same mechanism infra-stack.ts uses, and the native build
# has to resolve it the same way the JVM one does.
set -eu

TASK_DIR=${1:?usage: smoke.sh <bundle-dir> <backend-name>}
BACKEND=${2:?usage: smoke.sh <bundle-dir> <backend-name>}

BACKEND_NAME="$BACKEND" AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 \
  "$TASK_DIR/server" >/tmp/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

# --retry-connrefused waits out JVM/Spring startup, so there is no polling loop.
# The native build starts in milliseconds; the retries cost it nothing.
if ! body=$(curl -fsS --retry 60 --retry-delay 1 --retry-connrefused \
    http://127.0.0.1:3000/health); then
  echo "FAIL: server never answered" >&2
  cat /tmp/server.log >&2
  exit 1
fi

expected=$(printf '{"status":"Ok","backend":"%s"}' "$BACKEND")
if [ "$body" != "$expected" ]; then
  echo "FAIL: expected $expected, got $body" >&2
  exit 1
fi

echo "OK: $body"
