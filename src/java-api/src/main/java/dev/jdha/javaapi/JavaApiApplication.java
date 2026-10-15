package dev.jdha.javaapi;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Java backend, on a Lambda Web Function.
 *
 * <p>Web Functions only speak Node.js, so the zip holds the shared execve shim
 * from {@code src/node-wrapper/} as {@code index.js} and the launcher it execs
 * as {@code server}. The launcher is a shell script that runs the jlink'd JRE
 * the build puts beside it -- the same trick {@code src/python-api} uses with a
 * bundled CPython. Because the exec also replaces the runtime interface client,
 * this app POSTs {@code /2025-09-01/ready} itself once Tomcat is listening.
 *
 * <p>{@code src/java-aot-api} is the sibling that makes the opposite trade:
 * same app, compiled ahead of time by GraalVM into a single native binary with
 * no JVM at request time.
 */
@SpringBootApplication
@RestController
public class JavaApiApplication {

    /** The response shape every backend in this repo shares. */
    record Health(String status, String backend) {}

    public static void main(String[] args) {
        var app = new SpringApplication(JavaApiApplication.class);

        var properties = new HashMap<String, Object>();

        // Tomcat runs each request on a virtual thread. A Web Function puts many
        // concurrent requests in one execution environment (64 by default, 128
        // at most), which is the case virtual threads exist for: a request
        // parked on I/O costs a few hundred bytes of heap instead of a platform
        // thread's stack. This handler does no I/O, so it cannot show the win --
        // the flag is here because it is the right default for a servlet app on
        // this platform, not because it moved a number.
        properties.put("spring.threads.virtual.enabled", "true");

        // AWS_LAMBDA_HTTP_ENDPOINT is host:port; Spring Boot wants the two apart.
        String endpoint = System.getenv("AWS_LAMBDA_HTTP_ENDPOINT");
        if (endpoint != null && !endpoint.isBlank()) {
            int split = endpoint.lastIndexOf(':');
            properties.put("server.address", endpoint.substring(0, split));
            properties.put("server.port", endpoint.substring(split + 1));
        }

        app.setDefaultProperties(properties);
        app.run(args);
    }

    @GetMapping(value = "/health", produces = MediaType.APPLICATION_JSON_VALUE)
    Health health() {
        return new Health("Ok", "java");
    }

    /**
     * Stands in for the runtime interface client the execve shim replaced.
     * ApplicationReadyEvent fires after Tomcat is listening, which is exactly
     * what {@code /ready} promises; without it the first invocation fails with
     * Runtime.InitTimeout.
     */
    @Bean
    ApplicationListener<ApplicationReadyEvent> signalReady() {
        return event -> {
            String runtimeApi = System.getenv("AWS_LAMBDA_RUNTIME_API");
            if (runtimeApi == null || runtimeApi.isBlank()) {
                return; // local run: there is nothing to signal
            }

            var request = HttpRequest.newBuilder()
                    .uri(URI.create("http://" + runtimeApi + "/2025-09-01/ready"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{}"))
                    .build();

            try (var client = HttpClient.newHttpClient()) {
                var response = client.send(request, HttpResponse.BodyHandlers.discarding());
                if (response.statusCode() / 100 != 2) {
                    throw new IllegalStateException("ready: HTTP " + response.statusCode());
                }
            } catch (Exception e) {
                // The invocation fails with Runtime.InitTimeout either way; fail
                // loudly here so the log says why.
                throw new IllegalStateException("POST /ready to " + runtimeApi + " failed", e);
            }
        };
    }
}
