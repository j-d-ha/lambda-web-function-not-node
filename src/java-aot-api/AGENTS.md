# AGENTS.md

A Spring Boot app compiled by
[GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/native-image/)
on a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds two things: `index.js`, the
shared execve shim from `src/node-wrapper/`, and `server`, the native binary.
There is no JVM in the environment and none in the zip.

It is the same app as `src/java-api`, and the same trade as `src/DotnetApi`
against `src/DotnetApiAot`: this one gives up the JVM — and with it the JIT and
anything that leans on dynamic class loading — and gets one binary that starts
in tens of milliseconds instead of about a second. Because the execve shim
replaces the runtime interface client, `JavaAotApiApplication` POSTs
`/2025-09-01/ready` from an `ApplicationReadyEvent` listener once the server is
listening.

`GET /health` returns `{"status":"Ok","backend":"java-aot"}`; the JVM sibling
returns `{"status":"Ok","backend":"java"}`.

Measured for linux-arm64: **~83 MB unzipped / ~28 MB zipped**. The zip is
smaller than `src/java-api`'s ~58 MB, but the binary is not: at ~80 MB it is
about the size of that backend's whole JRE, because it carries a heap image and
every reachable Tomcat, Jackson and Spring class compiled ahead of time. What
the trade actually buys is startup and no JVM, not a smaller artifact — Go and
.NET NativeAOT are the ones that get both, because they have far less framework
to compile in.

## Why the build pins `-ol9`

Unlike Go (`CGO_ENABLED=0`) and .NET NativeAOT, a GraalVM native binary is **not**
statically linked: by default it links `libc`, `libpthread`, `librt`, `libdl` and
`libz` dynamically, so the glibc it was built against becomes a runtime
requirement. The Web Function environment is Amazon Linux 2023, glibc 2.34, so
the build runs on `ghcr.io/graalvm/native-image-community:21-ol9` — Oracle Linux
9, also glibc 2.34. Building on a newer distro would link symbols AL2023 does not
have and the binary would fail to load there.

That is also why the smoke test cannot prove this on its own: it runs in the
same container that built the binary, so it validates startup, not portability.
The `-ol9` pin is what makes the portability claim true — do not relax it to a
generic tag.

## Layout

- `pom.xml` — the Spring Boot parent, `spring-boot-starter-web`, and the
  `native-maven-plugin` configuration: `imageName=server`, because that is the
  name the shim execs, and `--enable-url-protocols=http`, because GraalVM ships
  only `https`, `file` and `jar` by default and the `/ready` POST is plain HTTP.
  The `compile-no-fork` execution bound to `package` is load-bearing: the
  parent's `native` profile only *configures* the plugin and adds
  `add-reachability-metadata`, so without that binding `mvn -Pnative package`
  reports BUILD SUCCESS and produces no binary at all.
- `src/main/java/dev/jdha/javaaotapi/JavaAotApiApplication.java` — the whole app.
- `Dockerfile` — the build. GraalVM's image has the JDK, `native-image` and the
  C toolchain `native-image` needs, but no build tool, so Maven is copied in
  from its own image. Runs `mvn -Pnative`, then the smoke, then exports only the
  zip.
- `smoke.sh` — boots the binary and asserts `/health` byte for byte. Unlike the
  JVM sibling there is no launcher script to run: `server` is the binary.

## Run

- `mvn spring-boot:run` runs the app on the JVM, which is what `src/java-api` is
  for; it is not how this build is exercised.
- `mvn -Pnative -DskipTests package` builds the binary locally, but it needs
  GraalVM on the host, so the container build is the supported path.
- `task build:java-aot-api` from the repo root builds the zip with
  `docker buildx build --platform linux/arm64` against `Dockerfile`, and the
  export stage copies out only `build/java-aot-api.zip`. Needs Docker and network
  access, and it is the slowest build here — `native-image` compiles every
  reachable class ahead of time.
- That build also runs `smoke.sh` in the container. The binary is linux-arm64, so
  this is the only place it can be exercised — do not delete the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- `-Pnative` is what turns on Spring's AOT processing and registers the
  reachability metadata. Building without it, or without the
  `spring-boot-maven-plugin` repackage, fails with a confusing version error
  rather than an obvious one.
- The `.zip` is fed to `AWS::Lambda::WebFunction` by
  `infra/lib/infra-stack.ts` as `java-aot-api-web`.
