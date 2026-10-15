#!/bin/sh
# Boots the published bundle the way Lambda does and asserts the app actually
# renders, serves its API, and ships a bootable WebAssembly bundle. Runs on
# linux/arm64 inside the build image, which is the only place the linux-arm64
# server tree can be exercised before it ships.
#
# Usage: smoke.sh [bundle-dir]   # the zip root: index.js, server, runtime dlls
set -eu

TASK_DIR=${1:-/var/task}
BASE=http://127.0.0.1:3000

fail() {
  echo "FAIL: $1" >&2
  cat /tmp/server.log >&2
  exit 1
}

# Lambda starts the process from the zip root, so the smoke check does too.
cd "$TASK_DIR"

AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 "$TASK_DIR/server" >/tmp/server.log 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

# --retry-connrefused waits out runtime and host startup, so no polling loop.
curl -fsS --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null "$BASE/health" \
  || fail "server never answered"

body=$(curl -fsS "$BASE/health")
[ "$body" = '{"status":"Ok","backend":"blazor"}' ] || fail "unexpected /health body: $body"

# Static SSR has to actually produce markup, not just a 200.
curl -fsS "$BASE/" | grep -q 'Blazor on a Lambda Web Function' \
  || fail "home page did not render"

# The endpoint the interactive WebAssembly client calls. The whole shape is
# asserted, not just one field: the client deserializes these exact property
# names, so renaming one would break the browser without failing anything else.
api=$(curl -fsS "$BASE/api/hello")
for field in '"status":"Ok"' '"backend":"blazor"' '"server":"' '"servedAt":"'; do
  case "$api" in
    *"$field"*) : ;;
    *) fail "unexpected /api/hello body: $api" ;;
  esac
done

# The WebAssembly bundle the browser downloads and boots: the loader the page
# references, and the runtime binary it pulls in. (There is no blazor.boot.json
# from .NET 10 on; the boot config rides inside dotnet.js.)
curl -fsS -o /dev/null "$BASE/_framework/blazor.web.js" \
  || fail "blazor.web.js missing from the published bundle"
curl -fsS -o /dev/null "$BASE/_framework/dotnet.native.wasm" \
  || fail "the WebAssembly runtime is missing from the published bundle"

echo "OK: $body"
