# syntax=docker/dockerfile:1

# Builds the JVM Java backend's zip on linux/arm64. Like src/python-api this zip
# carries its runtime: jlink builds a trimmed JRE beside the app jar, because
# there is no Java in the Web Function environment to fall back on. Only the
# finished zip is exported.
FROM maven:3.9-eclipse-temurin-25 AS build

# curl and zip are what smoke.sh and the packaging need; the Maven image has
# neither.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# Resolve the dependencies before the source lands, so editing a .java file
# does not re-download the world.
COPY src/java-api/pom.xml ./src/java-api/pom.xml
RUN mvn -B --no-transfer-progress -f src/java-api/pom.xml dependency:go-offline

COPY src/java-api/src ./src/java-api/src
# The two scripts the build and the smoke test run.
COPY src/java-api/server.sh src/java-api/smoke.sh ./src/java-api/
RUN mvn -B --no-transfer-progress -f src/java-api/pom.xml -DskipTests package

# jlink is the Java equivalent of the Python backend's interpreter trim:
# java.se is every Java SE module, jdk.unsupported the sun.misc.Unsafe that
# Netty and Spring reach for, jdk.crypto.ec the EC TLS providers, and jdk.zipfs
# the zip filesystem the fat-jar loader reads through.
RUN jlink \
        --add-modules java.se,jdk.unsupported,jdk.crypto.ec,jdk.zipfs \
        --strip-debug --no-header-files --no-man-pages --compress=zip-6 \
        --output /jre

# Lay the bundle out the way Lambda sees it: shim, launcher, jar, runtime. The
# launcher is a shell script with a shebang, so the executable bit is what makes
# it runnable at all.
RUN mkdir -p /var/task \
    && cp src/java-api/target/app.jar /var/task/app.jar \
    && cp -r /jre /var/task/jre \
    && cp src/java-api/server.sh /var/task/server \
    && chmod +x /var/task/server

# The shared execve shim. It hardcodes /var/task/server, so it lands in the zip
# root next to the launcher.
COPY src/node-wrapper/index.js /var/task/index.js

RUN /work/src/java-api/smoke.sh /var/task java
RUN cd /var/task && zip -q9r /java-api.zip .

# The zip is the only artifact; --output type=local copies it straight out.
FROM scratch AS export
COPY --from=build /java-api.zip /
