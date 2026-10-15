# AGENTS.md

A [Hono](https://hono.dev) app running on Node.js. The whole app is `src/index.ts`: it builds the
Hono instance, answers `GET /health` with `{"status":"Ok","backend":"node"}`, and serves it with
`@hono/node-server` on port 3000.

## Run

The commands below are written for npm. If the project has a `pnpm-lock.yaml`, `yarn.lock`, or
`bun.lock`, use that package manager instead.

- `npm install`
- `npm run dev` starts the server with tsx in watch mode. It is for humans; do not start it to check
  your work.
- `npm run build` bundles `src/index.ts` with esbuild to `dist/index.js`; `npm start` runs it. The
  zip is the `dist/` directory. Node is the runtime Lambda already boots, so there is no execve shim
  here (unlike the other backends).

## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.
The app is at the default path, so `npx hono routes` finds it; pass the file explicitly when a
command needs a path: `npx hono routes src/index.ts`.

## Docs

Fetch https://hono.dev/llms.txt to find the page, then fetch it with the `Accept: text/markdown`
header, for example `curl -H "Accept: text/markdown" https://hono.dev/docs/guides/best-practices`.
