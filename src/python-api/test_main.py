"""Guards the /health contract.

Drives the ASGI app directly, so the test needs no HTTP client and no
dependency beyond the app's own: fastapi and uvicorn.
"""

import asyncio
import unittest

import main

EXPECTED_BODY = b'{"status":"Ok","backend":"python"}'


def get(path: str) -> tuple[int, bytes]:
    """Call ``path`` through the app's ASGI interface; return status and body."""
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 3000),
    }
    sent: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict) -> None:
        sent.append(message)

    asyncio.run(main.app(scope, receive, send))
    start = next(m for m in sent if m["type"] == "http.response.start")
    body = b"".join(
        m.get("body", b"") for m in sent if m["type"] == "http.response.body"
    )
    return start["status"], body


class HealthContractTest(unittest.TestCase):
    def test_health_matches_the_shared_contract(self) -> None:
        status, body = get("/health")
        self.assertEqual(status, 200)
        # Byte for byte, as the Go test does: every backend returns this exact
        # payload, so key order and spacing are part of the contract, not just
        # the decoded JSON.
        self.assertEqual(body, EXPECTED_BODY)


if __name__ == "__main__":
    unittest.main()
