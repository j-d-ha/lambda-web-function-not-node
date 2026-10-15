plugins {
    alias(libs.plugins.kotlin.jvm)
    // The serialization *compiler* plugin, not just the runtime library. With
    // Gradle this is one plugin line; without it @Serializable compiles to
    // nothing and Ktor fails at runtime looking for a serializer.
    alias(libs.plugins.kotlin.serialization)
    // Brings the application plugin and the buildFatJar task, so the zip holds
    // one jar rather than a jar plus a lib/ directory.
    alias(libs.plugins.ktor)
}

group = "dev.jdha"
version = "0.0.1-SNAPSHOT"

repositories {
    mavenCentral()
}

kotlin {
    // Pins the JDK the code is compiled for, rather than inheriting whatever
    // happens to be on PATH. The Docker build runs on JDK 25 to match.
    jvmToolchain(libs.versions.jvm.get().toInt())
}

application {
    mainClass = "dev.jdha.kotlinapi.ApplicationKt"
}

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.kotlinx.serialization.json)
    // Ktor logs through SLF4J and warns without a binding; nothing here logs at
    // compile time, so it is a runtime dependency only.
    runtimeOnly(libs.slf4j.simple)
}
