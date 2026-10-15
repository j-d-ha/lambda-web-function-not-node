# AGENTS.md

A [Ktor](https://ktor.io) app on [Netty](https://netty.io), on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds four things: `index.js`, the
shared execve shim from `src/node-wrapper/`, the launcher `server`, and the JRE
the launcher needs under `jre/`.

It is `src/java-api`'s shape — a managed runtime carried in the zip, with a
`#!/bin/sh` launcher on the same shebang trick — but a different framework, a
different server and a different build: Ktor on Netty instead of Spring Boot on
Tomcat, and a shaded fat jar instead of Spring's repackaged one. It is here to
show the shim does not care which JVM web stack sits on top of it.

`GET /health` returns `{"status":"Ok","backend":"kotlin"}`.

Measured for linux-arm64: **~92 MB unzipped / ~65 MB zipped**, of which
`app.jar` is ~27 MB. The JRE dominates, exactly as it does in `src/java-api` —
the two differ mostly by the size of their fat jar, not their runtime.

## Layout

- `pom.xml` — plain Maven, no Spring parent: Kotlin, `ktor-server-core` and
  `ktor-server-netty`, `slf4j-simple` for the binding Ktor wants, and
  `maven-shade-plugin` to fold them into one jar. `finalName=app` so the jar name
  does not carry the version.
- `src/main/kotlin/dev/jdha/kotlinapi/Application.kt` — the whole app.
- `server.sh` — the launcher the shim execs, copied in as `server`.
- `Dockerfile` — the build. Runs Maven, `jlink` and the smoke on
  `linux/arm64`, then exports only the zip.
- `smoke.sh` — boots the assembled bundle and asserts `/health` byte for byte.

## Why the response is a literal

`Application.kt` answers with a constant string instead of a serialized data
class. It is four fields of fixed text and the smoke test asserts it byte for
byte, so a JSON library — and kotlinx-serialization's compiler plugin with it —
would be a dependency bought for nothing. Add one when the app grows a payload
worth serializing.

## Run

- `mvn package` builds the fat jar and `java -jar target/app.jar` runs it
  locally. It reads `AWS_LAMBDA_HTTP_ENDPOINT` (default `0.0.0.0:3000`) and, with
  no `AWS_LAMBDA_RUNTIME_API`, skips the `/ready` call.
- `task build:kotlin-api` from the repo root builds the zip with
  `docker buildx build --platform linux/arm64` against `Dockerfile`, and the
  export stage copies out only `build/kotlin-api.zip`. Needs Docker and network
  access.
- That build also runs `smoke.sh` in the container. The bundle is a linux-arm64
  tree, so this is the only place the shipped JRE is actually exercised — do not
  delete the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- `main` signals `/ready` once `start(wait = false)` returns, which is when the
  engine is bound, then parks on a latch its shutdown hook releases. That keeps
  the process alive without depending on Netty's threads being non-daemon, and
  Lambda's SIGTERM drains the same way it does for the other backends.
- `server.sh` sets `-XX:MaxRAMPercentage=75`, for the same reason
  `src/java-api/server.sh` does: the Web Function environment is 2 GB and the
  JVM's container-aware default is 25%.
- The `.zip` is fed to `AWS::Lambda::WebFunction` by
  `infra/lib/infra-stack.ts` as `kotlin-api-web`.
