# lambda-web-function-not-node

Run a **non-Node** HTTP server on [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html),
even though the managed runtime only boots Node.js.

Lambda Web Functions are a newer Lambda flavor: you give AWS an HTTP app, point a
Web Function revision at it, and get an HTTPS endpoint with its own scaling,
concurrency, and rate-limit controls. The catch is the runtime — a revision's
`runtime` today only accepts `nodejs24.x`. This repo shows four backends that
all answer the same request, three of which run no Node at request time at all.

Every backend listens on the port in `AWS_LAMBDA_HTTP_ENDPOINT`, and answers
`GET /health` with the same payload shape, naming itself:

| Backend             | Directory          | Response                              |
| ------------------- | ------------------ | ------------------------------------- |
| Node.js (reference) | `src/node-api`     | `{"status":"Ok","backend":"node"}`    |
| Go                  | `src/go-api`       | `{"status":"Ok","backend":"go"}`      |
| ASP.NET (NativeAOT) | `src/DotnetApiAot` | `{"status":"OK","backend":"ASP.NET"}` |
| Python (FastAPI)    | `src/python-api`   | `{"status":"Ok","backend":"python"}`  |

## How it works

The trick is a one-line Node.js shim, [`src/node-wrapper/index.js`](src/node-wrapper/index.js):

```js
process.execve("/var/task/server", ["/var/task/server"], process.env);
```

Lambda starts the environment by booting Node (`nodejs24.x`) and `import()`ing
the revision's `index.js`. `process.execve` — Node 24's
[syscall wrapper](https://nodejs.org/docs/latest-v24.x/api/process.html#processexecvefile-args-env)
— replaces the entire process image with the native binary sitting next to it.
Once the exec returns, there is no Node, no V8, and no npm in the process. The
revision still declares `nodejs24.x`, but that only ever runs the shim.

That exec has one consequence worth spelling out: it also replaces the
[Lambda runtime interface client](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
that normally POSTs `/ready` once the port probe passes. So the contract for any
backend that reuses the shim is:

1. Ship the shim as `index.js` in the zip root.
2. Ship the server entrypoint as `server` in the zip root — a native binary, or
   an executable script with an interpreter on its shebang line.
3. Have that entrypoint POST `/2025-09-01/ready` to `AWS_LAMBDA_RUNTIME_API`
   itself once it is listening — otherwise the invocation fails with
   `Runtime.InitTimeout`.

The non-Node backends follow that contract:

- **Go** ([`src/go-api/main.go`](src/go-api/main.go)) listens, calls
  `signalReady()`, and serves `net/http` with a 900ms `SIGTERM` graceful
  shutdown (Lambda gives you one second after the signal).
- **ASP.NET** ([`src/DotnetApiAot/Program.cs`](src/DotnetApiAot/Program.cs)) uses
  `WebApplication.CreateSlimBuilder` and, when
  `AWS_LAMBDA_HTTP_ENDPOINT` is set, binds to it and POSTs `/ready` after
  `StartAsync`. It is published with [NativeAOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/),
  so there is no .NET runtime in the environment either.
- **Python** ([`src/python-api/main.py`](src/python-api/main.py)) is the odd one
  out: there is no Python in the Web Function environment, so the zip carries a
  whole interpreter. The build bundles a relocatable
  [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
  CPython under `python/`, and `server` is `main.py` with that interpreter on
  its shebang line. It starts uvicorn and signals `/ready` from a thread once
  the server is up.

The shim is generic — any language with an HTTP server can reuse it; Go is just
the reference consumer.

## Repository layout

```
src/node-api/       Hono app on @hono/node-server (the Node baseline)
src/go-api/         Go net/http server + the shared shim in its zip
src/DotnetApiAot/   ASP.NET minimal API, NativeAOT-published
src/python-api/     FastAPI app, shipped with a bundled CPython interpreter
src/node-wrapper/   the execve shim every non-Node backend zips in as index.js
infra/              AWS CDK app: a WebFunction L2 construct + the stack
build/              generated artifacts (node-api.zip, go-api.zip, dotnet-api.zip, python-api.zip)
```

`infra/lib/web-function.ts` is a small L2 construct over
[`AWS::Lambda::WebFunction`](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-webfunction.html),
`WebFunctionRevision`, and `WebFunctionEndpoint`. It zips the source, uploads a
versioned object, pins the revision to that exact object version, wires the
bucket policy Lambda needs to read its own code, and fronts it with an HTTPS
endpoint.

## Build

```sh
task build
```

Writes `build/node-api.zip`, `build/go-api.zip`, `build/dotnet-api.zip`, and
`build/python-api.zip`.

Web Functions are arm64 only (Graviton), so every artifact is built for
`linux/arm64`. Three build details worth knowing:

- The .NET NativeAOT publish runs in a `linux/arm64` SDK container
  ([`src/DotnetApiAot/Dockerfile.aot`](src/DotnetApiAot/Dockerfile.aot)) because
  macOS can't link a Linux arm64 native binary. You need Docker for this step,
  and for the Python one.
- The Go, .NET and Node zips put the shim and the binary in the zip root (via
  `zip -j`), because the shim hardcodes `/var/task/server`.
- The Python build is a real [uv](https://docs.astral.sh/uv/) project
  (`pyproject.toml` + `uv.lock` + `.python-version`) built by
  [`src/python-api/Dockerfile`](src/python-api/Dockerfile) on `linux/arm64`.
  Everything happens in the container — uv installs the pinned interpreter, the
  locked dependencies, the unit test runs, then the bundle is laid out as
  Lambda sees it and smoked before being zipped. Docker's layer cache holds the
  interpreter and dependency layers, and only the zip is exported. You need
  Docker and network access. The zip is ~18 MB zipped / ~52 MB unzipped.

## Deploy

```sh
task deploy
```

Builds first, then runs `cdk deploy` from `infra/`. The stack deploys one Web
Function per backend (`node-api-web`, `go-api-web`, `dotnet-api-web`,
`python-api-web`) and prints an endpoint URL for each. You need AWS credentials
([AWS CLI configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html))
and a region where Web Functions are available.

## Test

```sh
(cd src/go-api && go test ./...)
(cd src/python-api && uv run python -m unittest)
(cd infra && npm test)
```

The Python test also runs inside `task build:python-api`, which additionally
boots the assembled bundle on `linux/arm64` and checks `/health` before it zips
it — the bundle only runs on the target architecture, so that is where the
interpreter and wheels are actually exercised.

## Docs

- [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)
- [Lambda runtime API](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html) (`/ready`, `/next`)
- [`process.execve`](https://nodejs.org/docs/latest-v24.x/api/process.html#processexecvefile-args-env)
- [`AWS::Lambda::WebFunction` (CloudFormation)](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-webfunction.html)
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [python-build-standalone](https://github.com/astral-sh/python-build-standalone) (the bundled CPython)
- [FastAPI](https://fastapi.tiangolo.com) and [uvicorn](https://www.uvicorn.org)
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- [Hono](https://hono.dev)

## Credit

Based on the technique from **Alex Steele's** post
[*Go on Lambda Web Functions via execve*](https://awsteele.com/blog/2026/10/12/go-on-lambda-web-functions-via-execve.html)
(12 Oct 2026). That article is where the `process.execve` approach — and the
`/2025-09-01/ready` callback it forces — comes from. This repo generalizes it and
adds ASP.NET and Python as further non-Node backends.

## License

[MIT](LICENSE)
