# syntax=docker/dockerfile:1

# Builds the Blazor Web App's zip on linux/arm64. The server is an ordinary
# self-contained .NET publish (no native linking), but the WebAssembly client
# still has to be IL-linked -- and, for the AOT variant, compiled through
# Emscripten -- so the whole build runs on the target architecture and only the
# finished zip is exported.
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS build

# AOT=true additionally compiles the WebAssembly client ahead of time, trading
# a much larger client bundle for faster execution in the browser.
ARG AOT=false
# WasmStripILAfterAOT drops the IL of AOT-compiled methods from the bundle. It
# is the AOT size lever; see AGENTS.md for what it costs.
ARG STRIP_IL=false
# Name of the exported zip. The two variants must not collide in build/.
ARG ZIP_NAME=blazor-web.zip

# curl and zip are what smoke.sh and the packaging need. python3 is what the
# Emscripten toolchain the AOT publish drives looks for: the .NET WebAssembly
# build tools bundle it on Windows and macOS, but not on Linux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl zip python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Directory.Build.props is repo-root config the projects pick up by walking up.
# Copy it so the container build sees the same LangVersion and warning policy
# as a local one.
COPY Directory.Build.props ./
COPY src/BlazorApp/ ./src/BlazorApp/
COPY src/BlazorApp.Client/ ./src/BlazorApp.Client/

# Publishing a Blazor WebAssembly client runs the IL linker, which lives in the
# wasm-tools workload; AOT needs the same workload.
RUN dotnet workload install wasm-tools

# Self-contained and untrimmed on the server: Blazor's component rendering is
# reflection-based, so every framework assembly and its metadata stays in the
# bundle. The client bundle is trimmed by the Blazor SDK on its own.
#
# BlazorWebAssemblyOmitDebugProxyOutput drops the ~10 MB BlazorDebugProxy
# (Roslyn) that the WebAssembly.Server package otherwise copies into every
# output. It is debugger tooling with no runtime role, so it is set here rather
# than in the project file, where it would break local debugging.
RUN dotnet publish src/BlazorApp/BlazorApp.csproj -c Release -r linux-arm64 \
        --self-contained true -o /var/task --nologo \
        -p:BlazorWebAssemblyOmitDebugProxyOutput=true \
        -p:RunAOTCompilation=${AOT} -p:WasmStripILAfterAOT=${STRIP_IL}

# The shared execve shim. It hardcodes /var/task/server, so the apphost the
# publish just wrote lands beside it in the zip root.
COPY src/node-wrapper/index.js /var/task/index.js

RUN /work/src/BlazorApp/smoke.sh /var/task
RUN mkdir -p /out && cd /var/task && zip -q9r "/out/${ZIP_NAME}" .

# The zip is the only artifact; --output type=local copies it straight out.
FROM scratch AS export
COPY --from=build /out/ /
