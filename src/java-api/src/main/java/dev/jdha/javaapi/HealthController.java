package dev.jdha.javaapi;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /health}: the one endpoint every backend in this repo answers. */
@RestController
class HealthController {

    /**
     * The response shape every backend in this repo shares, nested with the only
     * thing that produces one. Jackson serializes record components in
     * declaration order.
     */
    record Health(String status, String backend) {}

    private final String backend;

    HealthController(@Value("${app.backend}") String backend) {
        this.backend = backend;
    }

    @GetMapping(value = "/health", produces = MediaType.APPLICATION_JSON_VALUE)
    Health health() {
        return new Health("Ok", backend);
    }
}
