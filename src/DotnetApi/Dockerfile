# syntax=docker/dockerfile:1

# Builds the non-AOT .NET backend's zip on linux/arm64. Unlike Dockerfile.aot
# there is no native linking here (this is a self-contained publish, not
# NativeAOT), but the publish, the smoke and the packaging still run on the
# target architecture so the runtime that ships is the one that was exercised.
# Only the finished zip is exported.
FROM mcr.microsoft.com/dotnet/sdk:11.0 AS build

# curl and zip are what smoke.sh and the packaging need; the SDK image has
# neither.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Directory.Build.props is repo-root config the project picks up by walking up.
# Copy it so the container build sees the same LangVersion and warning policy
# as a local one.
COPY Directory.Build.props ./
COPY src/DotnetApi/ ./src/DotnetApi/

# Self-contained and untrimmed on purpose: reflection is a requirement, so
# every framework assembly and its metadata stays in the bundle. This is what
# makes the zip ~45 MB zipped where the AOT build is ~5.7 MB.
RUN dotnet publish src/DotnetApi/DotnetApi.csproj -c Release -r linux-arm64 \
        --self-contained true -o /var/task --nologo

# The shared execve shim. It hardcodes /var/task/server, so the apphost the
# publish just wrote lands beside it in the zip root.
COPY src/node-wrapper/index.js /var/task/index.js

RUN /work/src/DotnetApi/smoke.sh /var/task
RUN cd /var/task && zip -q9r /dotnet-api.zip .

# The zip is the only artifact; --output type=local copies it straight out.
FROM scratch AS export
COPY --from=build /dotnet-api.zip /
