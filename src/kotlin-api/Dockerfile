# syntax=docker/dockerfile:1

# Builds the Kotlin/Ktor backend's zip on linux/arm64. Same shape as
# src/java-api -- a jlink'd JRE travels in the zip, because there is no Java in
# the Web Function environment -- but a different framework and a different
# build: Ktor on Netty rather than Spring Boot on Tomcat, and Gradle rather than
# Maven. Only the finished zip is exported.
FROM eclipse-temurin:25-jdk AS build

# curl, zip and unzip are what smoke.sh, the packaging and the Gradle wrapper
# need; the JDK image has none of them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl zip unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# The wrapper, the build files and the source. The build runs through the
# committed wrapper rather than a Gradle image, so the Gradle version is pinned
# in the repo and the same command works locally.
COPY src/kotlin-api/gradle ./src/kotlin-api/gradle
COPY src/kotlin-api/gradlew ./src/kotlin-api/gradlew
COPY src/kotlin-api/settings.gradle.kts src/kotlin-api/build.gradle.kts ./src/kotlin-api/
COPY src/kotlin-api/src ./src/kotlin-api/src
# The two scripts the build and the smoke test run.
COPY src/kotlin-api/server.sh src/kotlin-api/smoke.sh ./src/kotlin-api/

# The wrapper downloads the Gradle distribution the first time it runs, so the
# Gradle home is a cache mount rather than an image layer -- without this, every
# source edit would re-download Gradle and the whole dependency set.
RUN --mount=type=cache,target=/root/.gradle \
    cd src/kotlin-api && ./gradlew --no-daemon --console=plain buildFatJar

# jlink is the Java equivalent of the Python backend's interpreter trim:
# java.se is every Java SE module, jdk.unsupported the sun.misc.Unsafe that
# Netty reaches for, jdk.crypto.ec the EC TLS providers, and jdk.zipfs the zip
# filesystem the fat-jar loader reads through.
RUN jlink \
        --add-modules java.se,jdk.unsupported,jdk.crypto.ec,jdk.zipfs \
        --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
        --output /jre

# Lay the bundle out the way Lambda sees it: shim, launcher, jar, runtime. The
# launcher is a shell script with a shebang, so the executable bit is what makes
# it runnable at all.
RUN mkdir -p /var/task \
    && cp src/kotlin-api/build/libs/kotlin-api-all.jar /var/task/app.jar \
    && cp -r /jre /var/task/jre \
    && cp src/kotlin-api/server.sh /var/task/server \
    && chmod +x /var/task/server

# The shared execve shim. It hardcodes /var/task/server, so it lands in the zip
# root next to the launcher.
COPY src/node-wrapper/index.js /var/task/index.js

RUN /work/src/kotlin-api/smoke.sh /var/task
RUN cd /var/task && zip -q9r /kotlin-api.zip .

# The zip is the only artifact; --output type=local copies it straight out.
FROM scratch AS export
COPY --from=build /kotlin-api.zip /
