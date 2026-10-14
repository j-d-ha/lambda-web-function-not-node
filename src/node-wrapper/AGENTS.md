# AGENTS.md

The
shared [execve](https://nodejs.org/docs/latest-v24.x/api/process.html#processexecvefile-args-env)
shim that lets a non-Node binary run on
a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html).
Lambda only boots `nodejs24.x` and `import()`s `index.js`, so a backend zips
this file in as `index.js` alongside its native binary; Node is replaced before
the platform's port probe and never runs a request.

Any backend can reuse it. The rules are:

- the shim must land in the zip root as `index.js`,
- the native binary must land in the zip root as `server`,
- that binary must POST `/2025-09-01/ready` to `AWS_LAMBDA_RUNTIME_API` once it
  is listening — the exec replaces the runtime interface client, so nothing
  else will do it.

`src/go-api` is the reference consumer; its `build:go-api` task in `Taskfile.yml`
shows the packaging.
