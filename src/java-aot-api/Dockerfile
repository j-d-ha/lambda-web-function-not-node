# syntax=docker/dockerfile:1

# Builds the GraalVM native-image Java backend's zip on linux/arm64. Same app as
# src/java-api, compiled ahead of time, so unlike that build there is no JRE to
# carry: the zip is the shim and one static-ish binary.
#
# The -ol9 tag matters. A GraalVM native binary links glibc dynamically, so it
# is built against glibc 2.34 -- what Oracle Linux 9, and therefore Amazon Linux
# 2023 and the Web Function environment, ship. Building on a newer distro would
# emit a binary that fails to load there. (The Go and .NET AOT backends sidestep
# this by linking statically; GraalVM does not.)
FROM ghcr.io/graalvm/native-image-community:21-ol9 AS build

# Maven from its own image: GraalVM's image has the JDK, native-image and the C
# toolchain native-image needs, but no build tool. Maven is portable shell plus
# jars, so copying it over is enough.
COPY --from=maven:3.9-eclipse-temurin-21 /usr/share/maven /opt/maven
ENV PATH=/opt/maven/bin:$PATH

# curl and zip are what smoke.sh and the packaging need.
RUN microdnf install -y zip curl \
    && microdnf clean all

WORKDIR /work

# Resolve the dependencies before the source lands, so editing a .java file does
# not re-download the world.
COPY src/java-aot-api/pom.xml ./src/java-aot-api/pom.xml
RUN mvn -B --no-transfer-progress -f src/java-aot-api/pom.xml dependency:go-offline

COPY src/java-aot-api/src ./src/java-aot-api/src
# The smoke test the build runs before it zips the bundle.
COPY src/java-aot-api/smoke.sh ./src/java-aot-api/

# -Pnative turns on Spring's AOT processing and then native-image. This is the
# slow step: every reachable class is compiled ahead of time.
RUN mvn -B --no-transfer-progress -f src/java-aot-api/pom.xml -Pnative -DskipTests package

# No launcher script here: the native binary is directly executable, so it is
# the `server` the shim execs.
RUN mkdir -p /var/task \
    && cp src/java-aot-api/target/server /var/task/server \
    && chmod +x /var/task/server

# The shared execve shim. It hardcodes /var/task/server, so it lands in the zip
# root next to the binary.
COPY src/node-wrapper/index.js /var/task/index.js

RUN /work/src/java-aot-api/smoke.sh /var/task
RUN cd /var/task && zip -q9r /java-aot-api.zip .

# The zip is the only artifact; --output type=local copies it straight out.
FROM scratch AS export
COPY --from=build /java-aot-api.zip /
