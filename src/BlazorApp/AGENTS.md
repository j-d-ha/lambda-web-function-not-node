# AGENTS.md

A **Blazor Web App** on a
[Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
It is the UI sibling of `src/DotnetApi`: same Web Function contract, same
untrimmed self-contained .NET runtime in the zip, but what it serves is a
server-rendered page plus a WebAssembly client instead of a JSON API.

Two projects, because a Blazor Web App with WebAssembly interactivity is two
apps that ship together:

- `src/BlazorApp/` — the server. ASP.NET Core host, static server-side
  rendering (static SSR), the `/api/hello` endpoint, and the `/ready` callback.
- `src/BlazorApp.Client/` — the WebAssembly client. Runs in the browser, calls
  `/api/hello` on its own origin.

Web Functions only boot Node.js, so the zip holds the shared execve shim from
`src/node-wrapper/` as `index.js`, the apphost `server`, and the whole .NET
runtime beside it. The shim replaces Node with `server`; because that also
replaces the runtime interface client, `Program.cs` POSTs `/2025-09-01/ready`
to the runtime API itself once Kestrel is listening.

`GET /health` returns `{"status":"Ok","backend":"blazor"}`, like every other
backend here.

## Which render modes, and why not the others

The app uses **static SSR** for the page shell and **Interactive WebAssembly**
for the one component that talks to the backend. Both are plain HTTP.

It does **not** use Interactive Server, Interactive Auto, or the older Blazor
Server hosting model. Those keep a SignalR circuit open over a WebSocket, and
Web Functions do not support WebSocket upgrades:

> Lambda does not support WebSocket upgrades. Lambda removes connection-specific
> upgrade headers before forwarding the request.
> — [Configuring networking for Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)

The request path is also half-duplex and bounded by `timeoutSeconds`, and
SignalR needs session affinity that a Web Function endpoint does not provide, so
the long-polling fallback does not rescue it either. Server-interactive Blazor
belongs on ECS/App Runner/EC2, not here.

## Two builds, one source

`build:blazor` and `build:blazor-aot` build **the same projects** through the
same Dockerfile; the difference is the `RunAOTCompilation` publish property.
That is not the `DotnetApi` / `DotnetApiAot` situation, where the two backends
differ in *code* (one needs reflection, one cannot have it). Here only the
client bundle changes:

|                    | `build:blazor`               | `build:blazor-aot`                  |
| ------------------ | ---------------------------- | ----------------------------------- |
| Server publish     | identical                    | identical                           |
| Client WASM        | IL interpreter + Jiterpreter | AOT-compiled, `WasmStripILAfterAOT` |
| Client bundle size | smaller                      | ~2x larger                          |
| Client speed       | slower for CPU-bound work    | near-native                         |

### The reflection/JSON question

WASM AOT is **not** NativeAOT, and it does not force source-generated JSON the
way the server-side AOT does. Verified against the SDK:

- The server project is `PublishTrimmed=false` — Blazor's component rendering is
  reflection-based, exactly as in `src/DotnetApi`.
- The **client** project is trimmed by the Blazor SDK in Release, but with
  `TrimMode=partial` and, decisively,
  `JsonSerializerIsReflectionEnabledByDefault=true`. The Blazor SDK turns
  reflection-based `System.Text.Json` back on, so `Http.GetFromJsonAsync<T>()`
  works with no `JsonSerializerContext` and no trim warnings.
- WASM AOT keeps the managed assemblies on purpose ("Blazor requires the DLLs
  for reflection metadata"), so AOT does not strip the metadata reflection
  reads.

So the shared `HelloResponse` record is serialized by the reflection serializer
on both sides and both builds work. That was verified on the deployed endpoints
rather than reasoned about: `build:blazor-aot` ships with
`WasmStripILAfterAOT=true`, and its `BackendProbe` still deserializes
`/api/hello` and re-fetches on click in the browser.

That is the finding worth keeping: **IL stripping after AOT did not break
reflection JSON here.** If someone later sets `TrimMode=full`, or a reflected
member does get stripped, *that* is when a `JsonSerializerContext` becomes
necessary — not before.

## Size

Measured on net11.0 for `linux-arm64`. Both zips carry the same untrimmed
self-contained server; only `wwwroot/_framework` differs:

|                      | `build:blazor`      | `build:blazor-aot`  |
| -------------------- | ------------------- | ------------------- |
| Zip                  | ~57 MB              | ~67 MB              |
| Unzipped             | ~136 MB (504 files) | ~155 MB (504 files) |
| `_framework`         | ~19.8 MB            | ~39.0 MB            |
| `dotnet.native.wasm` | ~2.9 MB             | ~15.9 MB            |

The client bundle roughly doubles, matching the documented "about twice the
size" for AOT. The compiled code lands in `dotnet.native.wasm`, which is why the
app's own `BlazorApp.Client.wasm` stays ~10 KB either way. Precompressed
`.br`/`.gz` variants ship beside every file — `dotnet.native.wasm` is 3.5 MB
Brotli in the AOT build against 0.9 MB interpreted — so the transfer cost is
well under the unzipped figure wherever the host serves them correctly.

`BlazorDebugProxy` (Roslyn, ~10 MB unzipped) is dropped with
`-p:BlazorWebAssemblyOmitDebugProxyOutput=true` in the Dockerfile. It is
debugger tooling with no runtime role, and setting it at publish time rather
than in the project file keeps local WebAssembly debugging working.

## Layout

- `src/BlazorApp/Program.cs` — host, endpoints, and the `/ready` POST. No
  `UseHttpsRedirection`/`UseHsts`: the endpoint is HTTPS-only and terminates TLS
  in front of the app, which only ever sees plain HTTP.
- `src/BlazorApp/Components/Pages/Home.razor` — the page. Static SSR, so the
  values under "Rendered on the server" were produced by the Web Function.
- `src/BlazorApp.Client/Pages/BackendProbe.razor` — the interactive component.
  Prerendering is **off** on purpose (`prerender: false`): with it on,
  `OnInitializedAsync` also runs on the server, where no `HttpClient` is
  registered for the client project. Off, every call is unambiguously a
  browser → Web Function round trip.
- `src/BlazorApp.Client/HelloResponse.cs` — the `/api/hello` contract, shared by
  both sides. It lives in the client project because the server already
  references it.
- `wwwroot/app.css` — hand-written. No Bootstrap, no npm, no CDN: this repo runs
  no Node at request time and has no front-end build step.
- `Dockerfile` — the build. Self-contained publish on `linux/arm64`, then
  `smoke.sh`, then zip; only the zip is exported.
- `smoke.sh` — boots the bundle and asserts `/health`, that the home page
  actually renders, that `/api/hello` answers, and that `_framework` shipped.

## Run

- `dotnet run --project src/BlazorApp` runs it locally. It reads
  `AWS_LAMBDA_HTTP_ENDPOINT` (default: Kestrel's) and, with no
  `AWS_LAMBDA_RUNTIME_API`, skips the `/ready` call.
- `task build:blazor` / `task build:blazor-aot` build the zips with
  `docker buildx build --platform linux/arm64`. Needs Docker and network access
  (the build installs the `wasm-tools` workload).
- The build runs `smoke.sh` in the container. The server is a linux-arm64 binary
  tree, so that is the only place the shipped runtime is exercised — do not
  delete the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- The AOT publish is slow and **memory-hungry**: it compiles every assembly
  through Emscripten and links them into one `dotnet.native.wasm`. It OOM-killed
  the Docker daemon on a 2 GiB VM here and needed 8 GiB; give the builder real
  memory before blaming the build.
- Do not add `InteractiveServer` or `InteractiveAuto` render modes; see above.
- The `.zip`s are fed to `AWS::Lambda::WebFunction` by `infra/lib/infra-stack.ts`
  as `blazor-web` and `blazor-aot-web`.
