package dev.jdha.javaaotapi;

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
 * The Java backend compiled ahead of time, on a Lambda Web Function.
 *
 * <p>Same app as {@code src/java-api}, built by GraalVM's {@code native-image}
 * instead of run on a JVM: {@code server} is a native binary, so there is no
 * JVM and no JRE in the zip. That is the ASP.NET pair's trade again --
 * {@code src/DotnetApi} carries a runtime, {@code src/DotnetApiAot} does not --
 * reproduced for Java. Because the execve shim replaces the runtime interface
 * client, this app POSTs {@code /2025-09-01/ready} itself once the server is
 * listening.
 */
@SpringBootApplication
@RestController
public class JavaAotApiApplication {

    /** The response shape every backend in this repo shares. */
    record Health(String status, String backend) {}

    public static void main(String[] args) {
        var app = new SpringApplication(JavaAotApiApplication.class);

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
        return new Health("Ok", "java-aot");
    }

    /**
     * Stands in for the runtime interface client the execve shim replaced.
     * ApplicationReadyEvent fires after the server is listening, which is what
     * {@code /ready} promises; without it the first invocation fails with
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
