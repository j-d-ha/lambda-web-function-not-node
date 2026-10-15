# AGENTS.md

A [FastAPI](https://fastapi.tiangolo.com) app on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds three things: the shared
execve shim from `src/node-wrapper/` as `index.js`, the `server` launcher, and
the CPython runtime the launcher needs under `python/`. Unlike the Go and .NET
backends, Python is not one static binary: there is no Python in the Web
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
app: `pyproject.toml` declares the dependencies and the interpreter range,
`.python-version` pins the exact interpreter, and `uv.lock` is the single lock
for both development and the build. There is no `requirements.txt`.
`[tool.uv] package = false` because the app ships as the `server` entrypoint
rather than an installed package.

`Dockerfile` is the build. It runs on `linux/arm64` so the interpreter, the
locked wheels and the tests are all the ones being shipped, with no
cross-platform resolution on the host.

## Run

- `uv sync` installs the development environment; `uv run python -m unittest`
  runs the handler test. It drives the ASGI app directly, so it needs no HTTP
  client.
- `uv run python main.py` runs the server locally. It reads
  `AWS_LAMBDA_HTTP_ENDPOINT` (default `localhost:3000`); with no
  `AWS_LAMBDA_RUNTIME_API` the ready call is skipped, same as outside Lambda.
- `task build:python-api` from the repo root builds the zip with
  `docker buildx build --platform linux/arm64` against `Dockerfile`, and the
  export stage copies out only `build/python-api.zip`. Docker's layer cache
  holds the interpreter and dependency layers, so repeat builds only redo the
  cheap layers. Needs Docker and network access.
- That build also runs `uv run python -m unittest` and `smoke.sh`, which boots
  the assembled bundle and checks `/health`. The bundle only runs on the target
  architecture, so this is the only place the interpreter and wheels are
  exercised: do not delete the smoke step without putting the check
  somewhere else.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
  `--platform linux/arm64` on an arm64 host is native; on an x86 CI runner it
  falls back to emulation and is much slower, so prefer an arm64 runner.
- The interpreter is uv's managed build, downloaded because
  `.python-version` pins it. There is no hand-rolled fetch and no
  `--python-platform`: inside an arm64 container the wheels are just the right
  ones. Bumping Python means `uv python pin <version>`.
- uv embeds its list of available Python builds, so a local uv older than the
  pinned patch cannot run `uv sync`/`uv run` ("No interpreter found for Python
  X"). `uv self update` fixes it. The build is unaffected: it pins its own uv in
  `Dockerfile`, which is also what makes the patch resolve deterministically.
- The Dockerfile trims the managed tree before shipping it, and two traps make
  that load-bearing rather than tidy-up. `bin/python` and `bin/python3` are
  symlinks to `python3.13`, and `zip` dereferences symlinks unless given `-y`,
  so leaving them in stores the interpreter three times. And
  `libpython3.13.so*` ships even though the interpreter links only
  libc/libm/librt. Together that is ~88 MB of the same bytes in the zip. The
  trims use globs, not exact filenames, because a tcl or libpython version bump
  would otherwise silently leave half of it behind.
- Preserve the smoke run after trimming: it is the only thing that proves the
  trimmed interpreter still boots.
- Dependency changes go through `uv lock` (or `uv add`); the build runs `uv sync --frozen`, so nothing outside the lock can reach the zip.
- The packaged zip is ~17 MB zipped / ~48 MB unzipped, well under the Web
  Function revision's 512 MB unzipped limit. Keep an eye on it if dependencies
  grow.
