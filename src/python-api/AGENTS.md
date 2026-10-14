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

## Layout

This is a real [uv](https://docs.astral.sh/uv/) project, like any other Python
app: `pyproject.toml` declares the dependencies and the interpreter version,
and `uv.lock` is the single lock for both development and the build. There is
no `requirements.txt`. `[tool.uv] package = false` because the app ships as the
`server` entrypoint rather than an installed package.

## Run

- `uv sync` installs the development environment; `uv run python -m unittest`
  runs the handler test. It drives the ASGI app directly, so it needs no HTTP
  client.
- `uv run python main.py` runs the server locally. It reads
  `AWS_LAMBDA_HTTP_ENDPOINT` (default `localhost:3000`); with no
  `AWS_LAMBDA_RUNTIME_API` the ready call is skipped, same as outside Lambda.
- `task build:python-api` from the repo root assembles and zips
  `build/python-api.zip`. It exports `uv.lock` and installs those exact versions
  for the target platform, then downloads the arm64 interpreter, so it needs
  network access and the `uv` CLI.
- `task test:python-api` unpacks the built zip inside a `linux/arm64` container
  and checks `/health`. The bundle only runs on the target architecture, so this
  is the only place the interpreter and wheels are actually exercised. Needs
  Docker.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
  The build installs with
  `uv pip install --python-platform aarch64-unknown-linux-gnu --require-hashes`,
  and the interpreter tarball is the `aarch64-unknown-linux-gnu` build.
- Dependency changes go through `uv lock` (or `uv add`); the build reads that
  lock, so a version that is only in the lock file and not in `uv.lock` cannot
  reach the zip.
- The packaged zip is ~36 MB zipped / ~98 MB unzipped, well under Lambda's
  250 MB unzipped limit. Keep an eye on it if dependencies grow.
