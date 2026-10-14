#!/bin/sh
# Runs inside a linux/arm64 container with the unpacked bundle at /var/task,
# laid out the way Lambda does. Starts the server and asserts the /health
# payload byte for byte, the same contract test_main.py guards from the ASGI
# side -- this one proves the bundled interpreter and wheels actually run.
set -eu

AWS_LAMBDA_HTTP_ENDPOINT=0.0.0.0:3000 /var/task/server >/tmp/server.log 2>&1 &
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
