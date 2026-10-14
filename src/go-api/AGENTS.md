# AGENTS.md

A Go HTTP server on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Web Functions only speak Node.js, so the zip holds two things: `index.js`, the
shared execve shim from `src/node-wrapper/`, and `server`, the compiled Go
binary. The shim replaces Node with the binary; because that also replaces the
runtime interface client, `main.go` posts `/2025-09-01/ready` to the runtime API
itself once it is listening.

`GET /health` returns `{"status":"Ok","backend":"go"}`, the same shape the Node
and ASP.NET backends in `src/` return.

## Run

- `go test ./...` runs the handler test.
- `go run .` runs the server locally. It needs `AWS_LAMBDA_HTTP_ENDPOINT`
  (e.g. `0.0.0.0:3000`); with no `AWS_LAMBDA_RUNTIME_API` the ready call fails,
  same as it would outside Lambda.
- `task build:go-api` from the repo root cross-compiles for Lambda and writes
  `build/go-api.zip`. Web Functions are arm64 only.
