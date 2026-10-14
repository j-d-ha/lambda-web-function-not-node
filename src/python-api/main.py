# The whole Python backend in one file, so the zip needs no package layout.
#
# Lambda Web Functions only boot Node.js and import() index.js, the shared
# execve shim in src/node-wrapper/. That shim replaces the process with
# /var/task/server -- this file, run through the bundled interpreter named in
# the shebang the build prepends (see `task build:python-api`). Because the exec
# also takes Lambda's runtime interface client with it, this file has to POST
# /2025-09-01/ready itself once uvicorn is listening.
import os
import threading
import time
import urllib.request

import uvicorn
from fastapi import FastAPI

# Same payload shape every backend in this repo answers /health with.
app = FastAPI()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "Ok", "backend": "python"}


def _signal_ready_when_started(server: uvicorn.Server) -> None:
    """Stand in for the replaced runtime interface client.

    Block until uvicorn is accepting connections, then POST /ready. Without it
    the platform fails the first invocation with Runtime.InitTimeout.
    """
    while not server.started:
        time.sleep(0.05)
    runtime_api = os.environ.get("AWS_LAMBDA_RUNTIME_API")
    if not runtime_api:  # local run: there is nothing to signal
        return
    request = urllib.request.Request(
        f"http://{runtime_api}/2025-09-01/ready",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request):
        pass


def serve() -> None:
    # AWS_LAMBDA_HTTP_ENDPOINT is host:port, e.g. 0.0.0.0:3000.
    host, _, port = os.environ.get(
        "AWS_LAMBDA_HTTP_ENDPOINT", "localhost:3000"
    ).partition(":")
    server = uvicorn.Server(
        uvicorn.Config(app, host=host, port=int(port), log_level="info")
    )
    threading.Thread(
        target=_signal_ready_when_started, args=(server,), daemon=True
    ).start()
    # uvicorn installs the SIGTERM handler for us, so Lambda's shutdown signal
    # drains in-flight requests the same way it does for the other backends.
    server.run()


if __name__ == "__main__":
    serve()
