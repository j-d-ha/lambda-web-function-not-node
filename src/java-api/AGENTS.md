# AGENTS.md

A [Spring Boot](https://spring.io/projects/spring-boot) app on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html),
built **twice from this one source**: `Dockerfile` runs it on the JVM,
`Dockerfile.aot` compiles it with GraalVM `native-image` into a single binary.
The two produce `java-api.zip` and `java-aot-api.zip` and deploy as two Web
Functions, so they can be compared side by side.

Web Functions only speak Node.js, so both zips hold the shared execve shim from
`src/node-wrapper/` as `index.js` plus the `server` it execs. What `server` is
differs:

|                    | `build:java-api`                   | `build:java-aot-api`      |
| ------------------ | ---------------------------------- | ------------------------- |
| `server`           | `server.sh`, a `#!/bin/sh` script  | the native binary itself  |
| Runtime in the zip | a `jlink`-trimmed JRE under `jre/` | none                      |
| Startup            | about a second                     | tens of milliseconds      |
| Tuned by           | `-XX:` flags in `server.sh`        | `native-image` build args |

Because the execve shim replaces the runtime interface client,
`LambdaRuntimeReady` POSTs `/2025-09-01/ready` once the server is listening. Both
builds use it, so the JVM and native variants are the same code path.

`GET /health` returns `{"status":"Ok","backend":"..."}`, where the name is
`java` for the JVM build and `java-aot` for the native one.

## One directory, not two

`src/DotnetApi` and `src/DotnetApiAot` are separate projects because they differ
in *code* -- one needs reflection, the other cannot have it. This backend has no
such difference: `-Pnative` is a publish property, so the source is identical and
only the packaging differs. That makes it the `src/blazor` situation, and the
same conclusion applies -- share the source, duplicate only the build.

The consequence is that the backend name cannot be a string literal, because
there is one literal and two answers. It is configuration instead:
`application.properties` declares `app.backend=${BACKEND_NAME:java}`, and
`infra/lib/infra-stack.ts` sets `BACKEND_NAME` on each revision. The default
covers a local `mvn spring-boot:run`. `smoke.sh` takes the expected name as an
argument and passes it through the same variable.

That check is worth something only in the native build, which passes `java-aot`
-- a value that differs from the default, so a property that failed to resolve
would show up as a wrong body rather than passing. The JVM build's name happens
to equal the default, so its run proves less. Property resolution in a native
image is the least obvious part of this arrangement, so the native smoke is the
one that matters.

## Versions

Java **25** (LTS) on Spring Boot **4.1**:

- **Java 25** is the current LTS. Java 27 is newer but is a non-LTS release with
  updates only until March 2027, and Spring Boot 4.1 supports Java up to 26. Java
  21, which this started on, moves to the OTN licence at the October 2026 CPU.
- **Spring Boot 4** is the current generation: Jakarta EE 11 / Servlet 6.1,
  Jackson 3 (`tools.jackson`, not `com.fasterxml.jackson`), and JSpecify
  null-safety. It split the catch-all starters, which is why the pom asks for
  `spring-boot-starter-webmvc` and not the old `spring-boot-starter-web`.
- Java 25 is a **hard floor** for the native build, not a preference: Spring Boot
  4 refuses to start in a native image built below it. `pom.xml`, the GraalVM
  image tag and the Maven image tag all have to agree on the JDK.

## Why the JVM zip carries a JRE

A stock JRE is the Java equivalent of a stock CPython: it carries the JDK
toolchain and every module whether the app touches them or not. `jlink` builds a
runtime image with only the modules the app needs, which is the trim
`src/python-api` applies to its interpreter. The list is deliberately short:

- `java.se` -- every Java SE module, which is what Spring Boot and Tomcat expect
  to find. It drags `java.desktop` along, so `libawt.so` and `libfontmanager.so`
  ship for nothing.
- `jdk.unsupported` -- `sun.misc.Unsafe`, which Spring and Netty reach for.
- `jdk.crypto.ec` -- the EC TLS providers, kept so an app that grows an HTTPS
  client still starts.
- `jdk.zipfs` -- the zip filesystem the fat-jar loader reads nested jars through.

The next real lever, if it is ever needed, is listing modules explicitly instead
of `java.se` to drop `java.desktop` and `java.sql`; that trades a few MB for the
risk of a missing module at startup.

## Why the native build pins `-ol9`

Unlike Go (`CGO_ENABLED=0`) and .NET NativeAOT, a GraalVM native binary is **not**
statically linked: by default it links `libc`, `libpthread`, `librt`, `libdl` and
`libz` dynamically, so the glibc it was built against becomes a runtime
requirement. The Web Function environment is Amazon Linux 2023, glibc 2.34, so
the build runs on `ghcr.io/graalvm/native-image-community:25-ol9` -- Oracle Linux
9, also glibc 2.34. Building on a newer distro would link symbols AL2023 does not
have and the binary would fail to load there.

That is also why the in-container smoke test cannot prove it on its own: it runs
in the same container that built the binary, so it validates startup, not
portability. The `-ol9` pin is what makes the portability claim true -- do not
relax it to a generic tag.

Verified by hand, since the build cannot: unzip the artifact and run `server` in
`public.ecr.aws/lambda/provided:al2023`. It boots and answers `/health` there on
glibc 2.34, and `readelf -d` shows no `RPATH`/`RUNPATH` and only `libz.so.1`,
`libc.so.6` and `ld-linux-aarch64.so.1` as `NEEDED` -- nothing resolved out of the
build directory. Re-run that check whenever the GraalVM tag or the JVM flags
change.

GraalVM 25 also writes optional `lib*.so` shims (`libawt.so`,
`libmanagement_ext.so`, `libjvm.so`, ...) beside the binary in `target/`. This app
does not use them and the build copies only `target/server`, which the AL2023
check above confirms is sufficient -- do not start copying the whole target
directory in.

## Size

Measured for `linux/arm64`, both from this one source:

|                    | Zipped | Unzipped | Files |
| ------------------ | -----: | -------: | ----: |
| `java-api.zip`     |   55.9 |     82.0 |   201 |
| `java-aot-api.zip` |   29.5 |     85.0 |     2 |

The native build uploads about half as much but extracts slightly *more*: it drops
the JVM from the download without dropping the framework's code, and the heap
image it generates is not small. It buys startup time, not size. The JVM zip is a
~20 MB `app.jar` plus ~62 MB of `jlink`'d JRE.

## Layout

- `pom.xml` -- the Spring Boot parent, `spring-boot-starter-webmvc`, the
  `native-maven-plugin` configuration for the AOT build, and `finalName=app` so
  the jar name does not carry the version.
- `src/main/java/dev/jdha/javaapi/JavaApiApplication.java` -- the entry point and
  the one setting that has to be computed at startup.
- `src/main/java/dev/jdha/javaapi/HealthController.java` -- the endpoint and the
  `Health` record it answers with.
- `src/main/java/dev/jdha/javaapi/LambdaRuntimeReady.java` -- the `/ready`
  callback, the only piece that is about the platform rather than about HTTP.
- `src/main/resources/application.properties` -- the static configuration,
  including the backend name.
- `server.sh` -- the JVM launcher the shim execs, copied in as `server`. The
  native build has no equivalent; its `server` is the binary.
- `Dockerfile` / `Dockerfile.aot` -- the two builds, each exporting only its zip.
- `smoke.sh` -- boots an assembled bundle and asserts `/health` byte for byte.
  Takes the expected backend name, so it works for either build.

## Run

- `mvn spring-boot:run` runs it on the JVM locally. It reads
  `AWS_LAMBDA_HTTP_ENDPOINT` (default: Spring's `8080`) and, with no
  `AWS_LAMBDA_RUNTIME_API`, skips the `/ready` call.
- `task build:java-api` / `task build:java-aot-api` from the repo root build the
  two zips with `docker buildx build --platform linux/arm64`, each against its own
  Dockerfile. Both need Docker and network access; the native one is the slowest
  build in the repo, since `native-image` compiles every reachable class ahead of
  time.
- Both builds run `smoke.sh` in their container. The bundle is a linux-arm64
  tree, so that is the only place the shipped runtime is exercised -- do not
  delete the smoke step.

## Notes

- Everything must be built for **linux/arm64** (Web Functions are Arm64 only).
- `server.sh` sets `-XX:MaxRAMPercentage=75`. The Web Function environment is
  2 GB and the JVM's container-aware default is 25%, which would cap the heap at
  512 MB. The GC default does not change here: the pre-27 heuristic already
  picked G1 at two or more CPUs and 1792 MB or more, and Java 27's JEP 523 makes
  G1 the default in every environment. A workload that wants Serial back asks
  for it with `-XX:+UseSerialGC`.
- Virtual threads are on (`spring.threads.virtual.enabled` in
  `application.properties`). It is the right default for a servlet app on this
  platform -- a Web Function keeps many concurrent requests in one execution
  environment -- but this handler does no I/O, so the demo cannot measure the win.
- The `/ready` POST uses `java.net.http.HttpClient` rather than Spring's
  `RestClient`. It is plumbing standing in for the Lambda runtime interface
  client, not application HTTP, so it does not want a framework client's beans
  and configuration; the same choice is in `src/kotlin-api`.
- `-Pnative` is what turns on Spring's AOT processing and registers the
  reachability metadata. Building the native variant without it, or without the
  `spring-boot-maven-plugin` repackage, fails with a confusing version error
  rather than an obvious one.
- The AOT build runs `mvn -Pnative native:compile`, naming the goal rather than
  binding it to a lifecycle phase, which is what Spring Boot's own docs do. The
  tempting alternative -- binding `compile-no-fork` to `package` in `pom.xml` --
  is wrong here, because this pom is shared with the JVM build: that execution
  would run there too, in an image with no `native-image`, and fail. It also
  sidesteps the parent's `native` profile, which only *configures*
  `native-image` through pluginManagement; a plugin that is never declared never
  runs, so `mvn -Pnative package` on its own reports BUILD SUCCESS and produces
  no binary at all.
- The two `.zip`s are fed to `AWS::Lambda::WebFunction` by
  `infra/lib/infra-stack.ts` as `java-api-web` and `java-aot-api-web`.
