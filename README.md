# lambda-web-function-not-node

[Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)
only run Node.js. This repo collects the ways around that. Every backend listens
on the port in `AWS_LAMBDA_HTTP_ENDPOINT` and answers `GET /health` with a
`{"status": ..., "backend": ...}` payload naming itself.

| Backend             | Directory          | How it avoids Node                                                                                               | `/health`                             |
|---------------------|--------------------|------------------------------------------------------------------------------------------------------------------|---------------------------------------|
| Node.js (reference) | `src/node-api`     | It doesn't — Hono on `@hono/node-server`.                                                                        | `{"status":"Ok","backend":"node"}`    |
| Go                  | `src/go-api`       | Zips in the shared `src/node-wrapper/index.js`, which calls `process.execve` to replace Node with the Go binary. | `{"status":"Ok","backend":"go"}`      |
| ASP.NET (AOT)       | `src/DotnetApiAot` | Not deployed yet.                                                                                                | `{"status":"OK","backend":"ASP.NET"}` |

## Build

```sh
task build
```

Writes `build/node-api.zip` and `build/go-api.zip`. Web Functions are arm64
only, so the Go binary is cross-compiled for `linux/arm64`.

## Deploy

```sh
task deploy
```

Builds first, then runs `cdk deploy` from `infra/`. The stack deploys one Web
Function per backend (`node-api-web`, `go-api-web`) and prints both endpoint
URLs. You need AWS credentials (`aws login`) and a region where Web Functions
are available.
