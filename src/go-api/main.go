// Command server is the Go API for this repo's Lambda Web Function.
//
// Web Functions only run Node.js, so index.js replaces itself with this binary
// via process.execve before the platform's port probe; see
// https://awsteele.com/blog/2026/10/12/go-on-lambda-web-functions-via-execve.html
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// health is the response shape every backend in this repo shares:
// {"status":"Ok","backend":"<name>"}.
type health struct {
	Status  string `json:"status"`
	Backend string `json:"backend"`
}

// newHandler builds the routes. Split out of main so tests can drive it.
func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		writeJSON(w, http.StatusOK, health{Status: "Ok", Backend: "go"})
	})
	return mux
}

// writeJSON writes compact JSON with no trailing newline, matching the Hono
// backend's wire format byte for byte.
func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func main() {
	// AWS_LAMBDA_HTTP_ENDPOINT is 0.0.0.0:3000.
	ln, err := net.Listen("tcp", os.Getenv("AWS_LAMBDA_HTTP_ENDPOINT"))
	if err != nil {
		log.Fatalf("listen: %v", err)
	}

	// The runtime interface client normally posts /ready once the port probe
	// passes, but we exec'd over it. Without this the platform fails the
	// invocation with Runtime.InitTimeout.
	if err := signalReady(); err != nil {
		log.Fatalf("ready: %v", err)
	}
	log.Printf("listening on %s", ln.Addr())

	srv := &http.Server{Handler: newHandler()}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM)
		<-sig
		// Lambda allows one second after SIGTERM before killing the environment.
		ctx, cancel := context.WithTimeout(context.Background(), 900*time.Millisecond)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}

// signalReady tells the runtime API the app is listening, standing in for the
// replaced runtime interface client.
func signalReady() error {
	resp, err := http.Post(
		"http://"+os.Getenv("AWS_LAMBDA_RUNTIME_API")+"/2025-09-01/ready",
		"application/json", strings.NewReader("{}"))
	if err != nil {
		return err
	}
	return resp.Body.Close()
}
