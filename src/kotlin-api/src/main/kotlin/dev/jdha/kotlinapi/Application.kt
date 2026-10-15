package dev.jdha.kotlinapi

import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.CountDownLatch
import kotlinx.serialization.Serializable

/**
 * The Kotlin/Ktor backend, on a Lambda Web Function.
 *
 * Web Functions only speak Node.js, so the zip holds the shared execve shim from
 * `src/node-wrapper/` as `index.js` and the launcher it execs as `server`. The
 * launcher is a shell script that runs the jlink'd JRE the build puts beside it,
 * the same trick `src/python-api` uses with a bundled CPython. Because the exec
 * also replaces the runtime interface client, this app POSTs
 * `/2025-09-01/ready` itself once Netty is bound.
 *
 * The payload is a serialized data class, not a hand-written string, so this
 * backend answers the way every other backend here does: Ktor's content
 * negotiation and kotlinx.serialization on the way out, the same shape Go
 * marshals and ASP.NET and Spring serialize.
 */

/** The response shape every backend in this repo shares. */
@Serializable
data class Health(val status: String, val backend: String)

fun main() {
    // AWS_LAMBDA_HTTP_ENDPOINT is host:port.
    val endpoint = System.getenv("AWS_LAMBDA_HTTP_ENDPOINT") ?: "0.0.0.0:3000"
    val host = endpoint.substringBeforeLast(':')
    val port = endpoint.substringAfterLast(':').toInt()

    val server = embeddedServer(Netty, host = host, port = port) {
        install(ContentNegotiation) { json() }
        routing {
            get("/health") { call.respond(Health("Ok", "kotlin")) }
        }
    }

    // start(wait = false) returns once the engine is bound, which is exactly
    // what /ready promises.
    server.start(wait = false)
    signalReady()

    // Keep the process alive until the JVM is told to stop. Lambda's SIGTERM
    // runs the hook below, so shutdown drains the same way it does for the
    // other backends.
    val stopped = CountDownLatch(1)
    Runtime.getRuntime().addShutdownHook(Thread { stopped.countDown() })
    stopped.await()
}

/**
 * Stands in for the runtime interface client the execve shim replaced. Without
 * it the first invocation fails with Runtime.InitTimeout.
 */
private fun signalReady() {
    val runtimeApi = System.getenv("AWS_LAMBDA_RUNTIME_API") ?: return // local run

    val request = HttpRequest.newBuilder()
        .uri(URI.create("http://$runtimeApi/2025-09-01/ready"))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("{}"))
        .build()

    HttpClient.newHttpClient().use { client ->
        val response = client.send(request, HttpResponse.BodyHandlers.discarding())
        check(response.statusCode() / 100 == 2) { "ready: HTTP ${response.statusCode()}" }
    }
}
