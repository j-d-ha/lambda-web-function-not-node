# AGENTS.md

An ASP.NET minimal API on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html),
built **without** [NativeAOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
and **without** trimming, because it explicitly needs reflection. Web Functions
only speak Node.js, so the zip holds the shared execve shim from
`src/node-wrapper/` as `index.js`, the apphost `server`, and the whole .NET
runtime and framework assemblies beside it. The shim replaces Node with
`server`; because that also replaces the runtime interface client, `Program.cs`
POSTs `/2025-09-01/ready` to the runtime API itself once Kestrel is listening.

`src/DotnetApiAot` is the sibling that makes the opposite trade: it trims and
AOT-compiles down to one native binary and gives up reflection. This one
keeps reflection and pays for it in size. `GET /health` returns
`{"status":"Ok","backend":"dotnet"}`; the AOT sibling returns
`{"status":"OK","backend":"dotnet-aot"}`.

## Why it is big

Reflection removes every slimming lever: both `PublishTrimmed` and NativeAOT
strip the metadata reflection reads, and even partial trimming only preserves
*System.Text.Json* reflection, not arbitrary reflection. So this is a
self-contained, untrimmed publish. Measured on net11.0 for `linux-arm64`:
**~115 MB unzipped / ~45 MB zipped** (`PublishSingleFile` is ~42 MB zipped, not
worth the startup decompression for the difference). Well under the 512 MB
unzipped deployment-package limit.

What remains is applied in the `.csproj` and all of it keeps reflection working:

- `InvariantGlobalization=true`: drops ICU (~30 MB unzipped).
- `DebugType=none` / `DebugSymbols=false`: no `.pdb`.
- `SatelliteResourceLanguages=en`: no localized resource satellites.
- `PublishReadyToRun=false`: R2R would add tens of MB.

The next real lever, if it is ever needed, is dropping ASP.NET Core for
`System.Net.HttpListener` on the base runtime alone (~33 MB zipped), at the cost
of routing, DI and the rest of the framework.

## Layout

- `Program.cs`: the whole app. Deliberately uses the reflection-based JSON
  serializer (no `JsonSerializerContext`), so a trimmed or AOT build would fail
  loudly rather than silently change behaviour.
- `DotnetApi.csproj`: `AssemblyName=server` so the apphost matches the shim's
  contract, plus the size properties above.
- `Dockerfile`: the build. Runs the self-contained publish on `linux/arm64`,
  copies the shim in, runs `smoke.sh`, then zips and exports only the zip.
- `smoke.sh`: boots the assembled bundle and asserts `/health` byte for byte.

## Run

- `dotnet run` runs the server locally. It reads `AWS_LAMBDA_HTTP_ENDPOINT`
  (default: Kestrel's) and, with no `AWS_LAMBDA_RUNTIME_API`, skips the `/ready`
  call.
- `task build:dotnet-api` from the repo root builds the zip with
  `docker buildx build --platform linux/arm64` against `Dockerfile`, and the
  export stage copies out only `build/dotnet-api.zip`. Needs Docker.
- That build also runs `smoke.sh` in the container. The bundle is a
  linux-arm64 binary tree, so this is the only place the shipped runtime is
  exercised: do not delete the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- This backend *must not* gain `PublishAot`, `PublishTrimmed`, or
  `PublishSingleFile` without dropping the reflection requirement first.
- The `.zip` is fed to `AWS::Lambda::WebFunction` by
  `infra/lib/infra-stack.ts` as `dotnet-api-web`.
