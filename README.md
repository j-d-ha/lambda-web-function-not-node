# lambda-web-function-not-node

Run a **non-Node** HTTP server on [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html),
even though the managed runtime only boots Node.js.

Lambda Web Functions are a newer Lambda flavor: you give AWS an HTTP app, point a
Web Function revision at it, and get an HTTPS endpoint with its own scaling,
concurrency, and rate-limit controls. The catch is the runtime — a revision's
`runtime` today only accepts `nodejs24.x`. This repo shows nine backends that
all answer the same request, eight of which run no Node at request time at all.

Every backend listens on the port in `AWS_LAMBDA_HTTP_ENDPOINT`, and answers
`GET /health` with the same payload shape, naming itself:

| Backend                            | Directory              | Response                                 |
| ---------------------------------- | ---------------------- | ---------------------------------------- |
| Node.js (reference)                | `src/node-api`         | `{"status":"Ok","backend":"node"}`       |
| Go                                 | `src/go-api`           | `{"status":"Ok","backend":"go"}`         |
| ASP.NET (NativeAOT, trimmed)       | `src/DotnetApiAot`     | `{"status":"OK","backend":"dotnet-aot"}` |
| ASP.NET (.NET runtime, reflection) | `src/DotnetApi`        | `{"status":"Ok","backend":"dotnet"}`     |
| Blazor Web App (server + WASM)     | `src/blazor/BlazorApp` | `{"status":"Ok","backend":"blazor"}`     |
| Python (FastAPI)                   | `src/python-api`       | `{"status":"Ok","backend":"python"}`     |
| Java (Spring Boot, JVM)            | `src/java-api`         | `{"status":"Ok","backend":"java"}`       |
| Java (GraalVM native-image)        | `src/java-api`         | `{"status":"Ok","backend":"java-aot"}`   |
| Kotlin (Ktor, JVM)                 | `src/kotlin-api`       | `{"status":"Ok","backend":"kotlin"}`     |

Blazor is the only one that serves a user interface as well as JSON. Two of the
rows share a directory on purpose: `src/blazor/BlazorApp` and `src/java-api` are
each built twice, because in both cases only the packaging differs and not the
source. See [Blazor](#blazor) below.

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
- **ASP.NET, NativeAOT** ([`src/DotnetApiAot/Program.cs`](src/DotnetApiAot/Program.cs))
  uses `WebApplication.CreateSlimBuilder` and, when
  `AWS_LAMBDA_HTTP_ENDPOINT` is set, binds to it and POSTs `/ready` after
  `StartAsync`. It is published with [NativeAOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/),
  so there is no .NET runtime in the environment either — it is the smallest
  backend here, and it gives up reflection to get there.
- **ASP.NET, managed .NET runtime** ([`src/DotnetApi/Program.cs`](src/DotnetApi/Program.cs))
  is the same shape but drops AOT and trimming on purpose, because it explicitly
  needs reflection: the zip carries the whole .NET runtime and every framework
  assembly, self-contained and untrimmed. That is what the ~45 MB zip buys. See
  [`src/DotnetApi/AGENTS.md`](src/DotnetApi/AGENTS.md) for the trade and the
  measured sizes.
- **Python** ([`src/python-api/main.py`](src/python-api/main.py)) is the odd one
  out: there is no Python in the Web Function environment, so the zip carries a
  whole interpreter. The build bundles a relocatable
  [python-build-standalone](https://github.com/astral-sh/python-build-standalone)
  CPython under `python/`, and `server` is `main.py` with that interpreter on
  its shebang line. It starts uvicorn and signals `/ready` from a thread once
  the server is up.
- **Java, JVM** ([`src/java-api`](src/java-api)) is Python's shape again, for a
  managed runtime: a Spring Boot app whose `server` is a `#!/bin/sh` script that
  execs a `jlink`-trimmed JRE the build carries in the zip.
- **Java, native** ([`src/java-api/Dockerfile.aot`](src/java-api/Dockerfile.aot))
  is that same source compiled ahead of time by GraalVM `native-image`, so
  `server` is one binary and no JVM ships at all. Same app, second packaging —
  the two differ in how they are built, not in what they are.
- **Kotlin** ([`src/kotlin-api`](src/kotlin-api)) is the JVM Java backend's
  shape on a different framework and a different build: Ktor on Netty, packed
  as a shaded fat jar rather than Spring's repackaged one.

The shim is generic — any language with an HTTP server can reuse it; Go is just
the reference consumer.

## Blazor

`src/blazor/` holds a [Blazor Web App](https://learn.microsoft.com/aspnet/core/blazor/)
on the same shim, as two sibling projects: `BlazorApp/` (the server) and
`BlazorApp.Client/` (the WebAssembly half that runs in the browser). They are one
deliverable — one zip, one Web Function — and the folder keeps that obvious. It
is the only backend here that serves a page, not just JSON.

It uses the two render modes that are plain HTTP — **static SSR** for the page
shell and **Interactive WebAssembly** for the component that calls the backend.
The page proves two round trips at once: the values under "Rendered on the
server" were produced by the Web Function, and the values under "Fetched from
the backend" arrived over HTTP from that same Web Function, fetched by
WebAssembly running in your browser.

It deliberately does **not** use Interactive Server or Interactive Auto. Those
hold a SignalR circuit open over a WebSocket, and Web Functions do not support
WebSocket upgrades. See [`src/blazor/AGENTS.md`](src/blazor/AGENTS.md) for
the details and the deployment targets that do fit.

`task build` produces two zips from that one source:

- `build/blazor-web.zip` — the WebAssembly client interpreted (the default).
- `build/blazor-aot-web.zip` — the client compiled ahead of time
  (`RunAOTCompilation` + `WasmStripILAfterAOT`): a larger download, much faster
  execution. It deploys as a second Web Function, so the two can be compared
  side by side.

AOT here is a publish property, not different code — unlike `DotnetApi` vs
`DotnetApiAot`, which differ because one needs reflection and the other cannot
have it. The server half of both Blazor builds is identical.

## Repository layout

```
src/node-api/       Hono app on @hono/node-server (the Node baseline)
src/go-api/         Go net/http server + the shared shim in its zip
src/DotnetApiAot/   ASP.NET minimal API, NativeAOT-published (small, no reflection)
src/DotnetApi/      ASP.NET minimal API, self-contained + untrimmed (reflection)
src/blazor/         the Blazor Web App, as two projects: BlazorApp/ (the server:
                    static SSR + /api/hello) and BlazorApp.Client/ (the WASM half)
src/python-api/     FastAPI app, shipped with a bundled CPython interpreter
src/java-api/       Spring Boot app, built twice: a jlink'd JRE, or a GraalVM
                    native-image binary
src/kotlin-api/     Ktor app on Netty, shipped with a jlink'd JRE
src/node-wrapper/   the execve shim every non-Node backend zips in as index.js
infra/              AWS CDK app: a WebFunction L2 construct + the stack
build/              generated artifacts (node-api.zip, go-api.zip, dotnet-api.zip, dotnet-aot-api.zip, blazor-web.zip, blazor-aot-web.zip, python-api.zip, java-api.zip, java-aot-api.zip, kotlin-api.zip)
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

Writes `build/node-api.zip`, `build/go-api.zip`, `build/dotnet-api.zip`,
`build/dotnet-aot-api.zip`, `build/blazor-web.zip`, `build/blazor-aot-web.zip`,
`build/python-api.zip`, `build/java-api.zip`, `build/java-aot-api.zip`, and
`build/kotlin-api.zip`.

Web Functions are arm64 only (Graviton), so every artifact is built for
`linux/arm64`. Six build details worth knowing:

- The **NativeAOT** .NET publish runs in a `linux/arm64` SDK container
  ([`src/DotnetApiAot/Dockerfile.aot`](src/DotnetApiAot/Dockerfile.aot)) because
  macOS can't link a Linux arm64 native binary. You need Docker for this step,
  and for the two managed ones below.
- The **managed** .NET build ([`src/DotnetApi/Dockerfile`](src/DotnetApi/Dockerfile))
  is a self-contained publish, so it needs no native toolchain, but it still
  publishes, smokes and packs the bundle on `linux/arm64` so the runtime that
  ships is the one that was exercised. Reflection means no trimming and no AOT,
  so this zip carries the whole .NET runtime: ~115 MB unzipped / ~45 MB zipped,
  against ~10 MB for the NativeAOT build.
- The **Blazor** build ([`src/blazor/BlazorApp/Dockerfile`](src/blazor/BlazorApp/Dockerfile))
  also runs on `linux/arm64`, and installs the `wasm-tools` workload inside the
  image: publishing a Blazor WebAssembly client IL-links the runtime, and the
  AOT variant compiles it through Emscripten (which needs the `python3` the
  image also installs). The server half is a self-contained untrimmed publish
  like `DotnetApi`; only the client bundle differs between the two zips. The
  AOT publish is slow — it compiles every assembly to WebAssembly.
- The Go, .NET and Node zips put the shim and the binary in the zip root (via
  `zip -j`), because the shim hardcodes `/var/task/server`.
- The Python build is a real [uv](https://docs.astral.sh/uv/) project
  (`pyproject.toml` + `uv.lock` + `.python-version`) built by
  [`src/python-api/Dockerfile`](src/python-api/Dockerfile) on `linux/arm64`.
  Everything happens in the container — uv installs the pinned interpreter, the
  locked dependencies, the unit test runs, then the bundle is laid out as
  Lambda sees it and smoked before being zipped. Docker's layer cache holds the
  interpreter and dependency layers, and only the zip is exported. You need
  Docker and network access. The zip is ~17 MB zipped / ~48 MB unzipped.
- The **Java** build and the **Kotlin** build add two more container-only
  toolchains. `src/java-api` is Maven and `src/kotlin-api` is Gradle, through the
  wrapper the repo commits; both carry a `jlink`-trimmed JRE, the Java equivalent
  of the Python backend's bundled interpreter.
  `src/java-api/Dockerfile.aot` runs `native-image` on GraalVM's own `-ol9`
  image, because a GraalVM binary links glibc dynamically and so has to be built
  against the same 2.34 Amazon Linux 2023 ships. All three target Java 25 (LTS);
  the native one has to, since Spring Boot 4 refuses to start a native image
  built below it. One source and two Dockerfiles, which is why the name each
  build reports is set on the revision rather than compiled in. See
  [`src/java-api/AGENTS.md`](src/java-api/AGENTS.md).

## Package sizes

Measured from `task build` output on `linux/arm64`, in MiB. The zipped number is
what a revision pins in S3; the unzipped number is what Lambda extracts and what
counts against the **250 MB unzipped limit** for each function.

| Backend                     | Zipped | Unzipped | Files | What the bulk is                               |
| --------------------------- | -----: | -------: | ----: | ---------------------------------------------- |
| Node.js (reference)         |  23 KB |    90 KB |     2 | the app and the shim                           |
| Go                          |    4.5 |      8.3 |     2 | one static binary                              |
| ASP.NET (NativeAOT)         |    5.7 |     13.0 |     3 | one static binary                              |
| Python (FastAPI)            |   17.1 |     47.7 | 1,623 | a relocatable CPython plus the locked wheels   |
| Java (GraalVM native-image) |   29.5 |     85.0 |     2 | one binary, every reachable Spring class in it |
| ASP.NET (.NET runtime)      |   44.8 |    115.0 |   334 | the whole .NET runtime, untrimmed              |
| Java (Spring Boot, JVM)     |   55.9 |     82.0 |   201 | a `jlink`'d JRE plus the app jar               |
| Blazor (interpreted WASM)   |   56.8 |    135.5 |   504 | .NET plus the WebAssembly client               |
| Blazor (AOT WASM)           |   66.6 |    154.8 |   504 | as above, plus the Emscripten-compiled client  |
| Kotlin (Ktor, JVM)          |   67.0 |     93.3 |   201 | the same JRE plus a shaded fat jar             |

All ten zipped come to ~348 MB and unzipped to ~735 MB. The unzipped total is the
one that matters for storage: each function gets its own extracted copy, so that
is roughly the footprint of the whole demo once every backend is deployed. Blazor
AOT is the closest to the ceiling, at ~155 MB unzipped.

Two things worth knowing about what Lambda actually stores:

- The code bucket is **versioned**, because a revision pins one exact object
  version. Every deploy of any backend uploads a new version of its zip rather
  than replacing the old one, so a bucket that has been deployed to many times
  holds every zip it has ever received. Nothing here cleans it up.
- S3 holds the zipped bytes, so the bucket's usage tracks the **Zipped** column,
  not the unzipped one.

Read the Java pair together: the GraalVM build uploads about half of what the JVM
build does (30 MB against 56 MB) but extracts to slightly *more* (85 MB against 82
MB). Ahead-of-time compilation removes the JVM from the download; it does not
remove the framework's code from the artifact, and the heap image it generates is
not small. It buys startup time, not size.

## Deploy

```sh
task deploy
```

Builds first, then runs `cdk deploy` from `infra/`. The stack deploys one Web
Function per backend (`node-api-web`, `go-api-web`, `dotnet-api-web`,
`dotnet-aot-api-web`, `blazor-web`, `blazor-aot-web`, `python-api-web`,
`java-api-web`, `java-aot-api-web`, `kotlin-api-web`) and
prints an endpoint URL for each. You need AWS credentials
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
interpreter and wheels are actually exercised. `task build:dotnet-api` does the
same for the managed .NET build: `src/DotnetApi/smoke.sh` boots the published
bundle and checks `/health` before the zip is written. `src/blazor/BlazorApp/smoke.sh`
goes further for the Blazor builds: it checks that the home page actually
renders, that `/api/hello` answers, and that the WebAssembly bundle shipped.
`src/java-api/smoke.sh` and `src/kotlin-api/smoke.sh` do the same for the
Java-family builds: each boots the assembled bundle and checks `/health` before
the zip is written, since the bundle only runs on the target architecture. The
Java one takes the expected backend name as an argument, so a single script covers
both of that project's builds and doubles as a check that the revision's
`BACKEND_NAME` actually reaches the running app.

## Docs

- [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)
- [Lambda runtime API](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html) (`/ready`, `/next`)
- [`process.execve`](https://nodejs.org/docs/latest-v24.x/api/process.html#processexecvefile-args-env)
- [`AWS::Lambda::WebFunction` (CloudFormation)](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-webfunction.html)
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
- [Trimming options](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trimming-options) (why reflection rules it out here)
- [Blazor hosting models](https://learn.microsoft.com/en-us/aspnet/core/blazor/hosting-models) and [render modes](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes)
- [Blazor WebAssembly AOT](https://learn.microsoft.com/en-us/aspnet/core/blazor/webassembly-build-tools-and-aot) (the `RunAOTCompilation` build)
- [Web Functions networking](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html) (why no server-interactive Blazor)
- [python-build-standalone](https://github.com/astral-sh/python-build-standalone) (the bundled CPython)
- [FastAPI](https://fastapi.tiangolo.com) and [uvicorn](https://www.uvicorn.org)
- [Spring Boot](https://spring.io/projects/spring-boot), [jlink](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) (the trimmed JRE), and [Spring Boot native images](https://docs.spring.io/spring-boot/4.1/how-to/native-image/index.html)
- [GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/) and its [glibc linkage](https://www.graalvm.org/latest/reference-manual/native-image/guides/build-static-executables/) (why the build pins `-ol9`)
- [Ktor](https://ktor.io) and [Netty](https://netty.io), built with [Gradle](https://docs.gradle.org/current/userguide/userguide.html) (the wrapper is committed) and pinned through a [version catalog](https://docs.gradle.org/current/userguide/version_catalogs.html)
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
