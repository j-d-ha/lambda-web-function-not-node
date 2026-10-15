package dev.jdha.javaapi;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

/**
 * Stands in for the Lambda runtime interface client that the execve shim
 * replaced, and the only piece of this app that is about the platform rather
 * than about HTTP.
 *
 * <p>ApplicationReadyEvent fires after the server is listening, which is exactly
 * what {@code /ready} promises. Nothing else will send it, so without this the
 * first invocation fails with Runtime.InitTimeout.
 */
@Component
class LambdaRuntimeReady implements ApplicationListener<ApplicationReadyEvent> {

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
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
    }
}
