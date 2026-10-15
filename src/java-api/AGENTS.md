# AGENTS.md

A [Spring Boot](https://spring.io/projects/spring-boot) app on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds four things: `index.js`, the
shared execve shim from `src/node-wrapper/`, the launcher `server`, and the JRE
the launcher needs under `jre/`. Like `src/python-api`, and unlike the Go and
.NET AOT backends, this is not a single binary — there is no Java in the Web
Function environment, so the build carries a runtime.

The shim replaces Node with `server`; `server` is `server.sh`, a `#!/bin/sh`
script that `exec`s `/var/task/jre/bin/java -jar /var/task/app.jar`. The kernel
runs the shell and `exec` turns the shell into the JVM, so no wrapper process
survives — the same shebang trick the Python backend plays with
`python/bin/python3.13`. Because that also replaces the runtime interface
client, `JavaApiApplication` POSTs `/2025-09-01/ready` from an
`ApplicationReadyEvent` listener once Tomcat is listening.

`src/java-aot-api` is the sibling that makes the opposite trade: the same app
compiled by GraalVM `native-image` into one binary with no JVM in the zip. This
one starts in about a second and carries ~64 MB of JRE; that one starts in tens
of milliseconds and carries none. `src/kotlin-api` is this shape again on Ktor
instead of Spring.

`GET /health` returns `{"status":"Ok","backend":"java"}`.

## Why the JRE is jlink'd

A stock JRE is the Java equivalent of a stock CPython: it carries the JDK
toolchain and every module whether the app touches them or not. `jlink` builds a
runtime image with only the modules the app needs, which is the trim
`src/python-api` applies to its interpreter. The list is deliberately short:

- `java.se` — every Java SE module, which is what Spring Boot and Tomcat expect
  to find. It drags `java.desktop` along, so `libawt.so` and
  `libfontmanager.so` ship for nothing.
- `jdk.unsupported` — `sun.misc.Unsafe`, which Spring and Netty reach for.
- `jdk.crypto.ec` — the EC TLS providers, kept so an app that grows an HTTPS
  client still starts.
- `jdk.zipfs` — the zip filesystem the fat-jar loader reads nested jars through.

Measured for linux-arm64: **~85 MB unzipped / ~58 MB zipped**, of which
`app.jar` is ~21 MB and the JRE the rest. The next real lever, if it is ever
needed, is listing modules explicitly instead of `java.se` to drop
`java.desktop` and `java.sql`; that trades a few MB for the risk of a missing
module at startup.

## Layout

- `pom.xml` — the Spring Boot parent, `spring-boot-starter-web`, and
  `finalName=app` so the jar name does not carry the version.
- `src/main/java/dev/jdha/javaapi/JavaApiApplication.java` — the whole app.
- `server.sh` — the launcher the shim execs, copied in as `server`.
- `Dockerfile` — the build. Runs Maven, `jlink` and the smoke on
  `linux/arm64`, then exports only the zip.
- `smoke.sh` — boots the assembled bundle and asserts `/health` byte for byte.

## Run

- `mvn spring-boot:run` runs the server locally. It reads
  `AWS_LAMBDA_HTTP_ENDPOINT` (default: Spring's `8080`) and, with no
  `AWS_LAMBDA_RUNTIME_API`, skips the `/ready` call.
- `task build:java-api` from the repo root builds the zip with
  `docker buildx build --platform linux/arm64` against `Dockerfile`, and the
  export stage copies out only `build/java-api.zip`. Needs Docker and network
  access.
- That build also runs `smoke.sh` in the container. The bundle is a
  linux-arm64 tree, so this is the only place the shipped JRE is actually
  exercised — do not delete the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- `server.sh` sets `-XX:MaxRAMPercentage=75`. The Web Function environment is
  2 GB and the JVM's container-aware default is 25%, which would cap the heap at
  512 MB.
- The `.zip` is fed to `AWS::Lambda::WebFunction` by
  `infra/lib/infra-stack.ts` as `java-api-web`.
