"""Guards the /health contract, driven straight through the ASGI app so the
test needs no HTTP client (only fastapi and uvicorn from requirements.txt)."""

import asyncio
import json
import unittest

import main


def call_health() -> tuple[int, bytes]:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "path": "/health",
        "raw_path": b"/health",
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
        status, body = call_health()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"status": "Ok", "backend": "python"})


if __name__ == "__main__":
    unittest.main()
