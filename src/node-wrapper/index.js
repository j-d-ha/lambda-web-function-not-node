// Lambda boots Node and import()s this file. execve replaces the whole process
// image with the native binary next to it, so there is no Node left to pay for.
//
// Contract for the app that zips this in:
//   - ship this file as `index.js` in the zip root,
//   - ship the native binary as `server` in the zip root,
//   - have that binary POST /2025-09-01/ready to AWS_LAMBDA_RUNTIME_API once it
//     is listening, because the exec took the runtime interface client with it.
// https://awsteele.com/blog/2026/10/12/go-on-lambda-web-functions-via-execve.html
process.execve("/var/task/server", ["/var/task/server"], process.env);
