package main

import (
	"net/http/httptest"
	"testing"
)

// The /health payload is the contract every backend in this repo shares, so
// guard it byte for byte.
func TestHealthMatchesTheSharedContract(t *testing.T) {
	rec := httptest.NewRecorder()
	newHandler().ServeHTTP(rec, httptest.NewRequest("GET", "/health", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got, want := rec.Body.String(), `{"status":"Ok","backend":"go"}`; got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if got, want := rec.Header().Get("Content-Type"), "application/json"; got != want {
		t.Fatalf("content-type = %q, want %q", got, want)
	}
}
