# AGENTS.md

A [FastAPI](https://fastapi.tiangolo.com) app on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds three things: `index.js`, the
shared execve shim from `src/node-wrapper/`, the `server` launcher, and the
CPython runtime the launcher needs under `python/`. Unlike the Go and .NET
backends, Python is not a single static binary — there is no Python in the Web
Function environment, so `task build:python-api` bundles a
[python-build-standalone](https://github.com/astral-sh/python-build-standalone)
interpreter next to the code.

The shim replaces Node with `server`; `server` is `main.py` with the bundled
interpreter on its shebang line (`/var/task/python/bin/python3.13`), so the
kernel runs the interpreter on it. Because that also replaces the runtime
interface client, `main.py` starts uvicorn and POSTs `/2025-09-01/ready` to the
runtime API itself.

`GET /health` returns `{"status":"Ok","backend":"python"}`, the same shape the
Node, Go, and ASP.NET backends in `src/` return.

## Run

- `uv run --with fastapi --with uvicorn python -m unittest` runs the handler
  test. It drives the ASGI app directly, so it needs no HTTP client.
- `uv run --with fastapi --with uvicorn python main.py` runs the server
  locally. It reads `AWS_LAMBDA_HTTP_ENDPOINT` (default `localhost:3000`); with
  no `AWS_LAMBDA_RUNTIME_API` the ready call is skipped, same as outside Lambda.
- `task build:python-api` from the repo root assembles and zips
  `build/python-api.zip`. The arm64 interpreter is downloaded at build time, so
  it needs network access on first run.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
  The build resolves dependencies with
  `uv pip install --python-platform aarch64-unknown-linux-gnu`, and the
  interpreter tarball is the `aarch64-unknown-linux-gnu` build.
- The packaged zip is ~36 MB zipped / ~98 MB unzipped, well under Lambda's
  250 MB unzipped limit. Keep an eye on it if dependencies grow.
