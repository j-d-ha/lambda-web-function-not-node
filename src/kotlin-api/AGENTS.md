# AGENTS.md

A [Ktor](https://ktor.io) app on [Netty](https://netty.io), on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds four things: the shared execve
shim from `src/node-wrapper/` as `index.js`, the launcher `server`, `app.jar`,
and the JRE the launcher needs under `jre/`.

It is `src/java-api`'s shape (a managed runtime carried in the zip, with a
`#!/bin/sh` launcher on the same shebang trick), but a different framework, a
different server and a different build: Ktor on Netty instead of Spring Boot on
Tomcat, and a shaded fat jar instead of Spring's repackaged one. It is here to
show the shim does not care which JVM web stack sits on top of it.

`GET /health` returns `{"status":"Ok","backend":"kotlin"}`.

## Versions

Kotlin **2.4.21** and Ktor **3.6.0**, both current stable, compiled for JVM **25**
to match the JDK in the image and the Java backends. The 2.5.0-Beta1 prerelease
is deliberately not used.

Gradle builds this, through the **wrapper committed with the project**
(`gradlew` plus `gradle/wrapper/`), so the Gradle version, **9.8.1**, is a
property of the repo rather than of whatever happens to be installed. That is
also why the Docker build has a plain JDK base image and not a Gradle one: it
runs `./gradlew`, the same command a person would. Versions live in
`gradle/libs.versions.toml`, which is what `gradle init` produces for a new
Kotlin project today.

Measured for linux-arm64: **~93 MB unzipped / ~67 MB zipped**, of which
`app.jar` is ~30 MB. The JRE dominates, exactly as it does in `src/java-api`:
the two differ mostly by the size of their fat jar, not their runtime. Content
negotiation and kotlinx.serialization account for ~5 MB of the jar.

## Layout

- `build.gradle.kts` and `gradle/libs.versions.toml`: the build and the versions
  it pins. `jvmToolchain` fixes the JDK rather than inheriting whatever is on
  PATH, and the Ktor plugin supplies `buildFatJar`, the one task that produces
  the single jar the zip carries.
- `gradlew` and `gradle/wrapper/`: the committed wrapper.
- `src/main/kotlin/dev/jdha/kotlinapi/Application.kt`: the whole app.
- `server.sh`: the launcher the shim execs, copied in as `server`.
- `Dockerfile`: the build. Runs Gradle through the wrapper, then `jlink` and the
  smoke, on `linux/arm64`, and exports only the zip.
- `smoke.sh`: boots the assembled bundle and asserts `/health` byte for byte.

## Serialization

`GET /health` answers with a `@Serializable` data class through Ktor's content
negotiation and kotlinx.serialization, not a hand-written JSON string. That is
deliberate. Every backend in this repo serializes an object: `json.Marshal` in
Go, `TypedResults.Ok` in ASP.NET, Jackson in `src/java-api`, a returned dict in
FastAPI. The payload shape is declared once and the framework owns the encoding.
A literal would have been a byte-exact shortcut that made this the one backend
whose response could drift from its own declaration.

The kotlinx.serialization **compiler plugin** is what makes `@Serializable`
real. Under Gradle that is one line,
`alias(libs.plugins.kotlin.serialization)`; without it the annotation compiles to
nothing and Ktor fails at runtime looking for a serializer. (The Maven build this
replaced needed the plugin named twice, once under `<compilerPlugins>` and again
as a dependency of `kotlin-maven-plugin`. Gradle takes one line.)

The runtime library version is matched to the one Ktor 3.6.0 itself depends on
(`1.11.0`), so the plugin and the library agree.

## Run

- `./gradlew buildFatJar` builds the jar, and
  `java -jar build/libs/kotlin-api-all.jar` runs it locally. It reads
  `AWS_LAMBDA_HTTP_ENDPOINT` (default `0.0.0.0:3000`) and, with no
  `AWS_LAMBDA_RUNTIME_API`, skips the `/ready` call.
- `task build:kotlin-api` from the repo root builds the zip with
  `docker buildx build --platform linux/arm64` against `Dockerfile`, and the
  export stage copies out only `build/kotlin-api.zip`. Needs Docker and network
  access.
- That build also runs `smoke.sh` in the container. The bundle is a linux-arm64
  tree, so this is the only place the shipped JRE is exercised. Do not delete
  the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- `main` signals `/ready` once `start(wait = false)` returns, which is when the
  engine is bound, then parks on a latch its shutdown hook releases. That keeps
  the process alive without depending on Netty's threads being non-daemon, and
  Lambda's SIGTERM drains the same way it does for the other backends.
- `server.sh` sets `-XX:MaxRAMPercentage=75`, for the same reason
  `src/java-api/server.sh` does: the Web Function environment is 2 GB and the
  JVM's container-aware default is 25%.
- The server starts programmatically through `embeddedServer` rather than Ktor's
  `EngineMain` and an `application.conf`. `AWS_LAMBDA_HTTP_ENDPOINT` arrives as
  one `host:port` string that HOCON cannot split, and `/ready` has to fire
  exactly when the engine is bound, which is what `start(wait = false)`
  returning already tells you. Both are plainer in code than in config.
- The `.zip` is fed to `AWS::Lambda::WebFunction` by
  `infra/lib/infra-stack.ts` as `kotlin-api-web`.
