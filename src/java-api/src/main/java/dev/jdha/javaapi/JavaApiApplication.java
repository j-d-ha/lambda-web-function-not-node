package dev.jdha.javaapi;

import java.util.HashMap;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * The Spring Boot Java backend, on a Lambda Web Function.
 *
 * <p>Web Functions only speak Node.js, so the zip holds the shared execve shim
 * from {@code src/node-wrapper/} as {@code index.js} and the launcher it execs
 * as {@code server}. On the JVM that launcher is {@code server.sh}, a shell
 * script running the jlink'd JRE beside it -- the same shebang trick
 * {@code src/python-api} plays with a bundled CPython. Because the exec also
 * replaces the runtime interface client, {@link LambdaRuntimeReady} POSTs
 * {@code /2025-09-01/ready} itself once the server is listening.
 *
 * <p>This project is built twice from this one source: {@code Dockerfile} runs it
 * on the JVM, {@code Dockerfile.aot} compiles it with GraalVM {@code native-image}
 * into a single binary. That is the {@code src/blazor} shape, not the
 * {@code src/DotnetApi} / {@code src/DotnetApiAot} one -- those two differ in
 * code, these differ only in packaging, so only the packaging is duplicated.
 * Which name each build reports is configuration: see {@code application.properties}.
 */
@SpringBootApplication
public class JavaApiApplication {

    public static void main(String[] args) {
        var app = new SpringApplication(JavaApiApplication.class);

        var properties = new HashMap<String, Object>();

        // The one setting that has to be computed: AWS_LAMBDA_HTTP_ENDPOINT is
        // host:port and Spring Boot wants the two apart. Everything static lives
        // in application.properties instead.
        String endpoint = System.getenv("AWS_LAMBDA_HTTP_ENDPOINT");
        if (endpoint != null && !endpoint.isBlank()) {
            int split = endpoint.lastIndexOf(':');
            properties.put("server.address", endpoint.substring(0, split));
            properties.put("server.port", endpoint.substring(split + 1));
        }

        app.setDefaultProperties(properties);
        app.run(args);
    }
}
