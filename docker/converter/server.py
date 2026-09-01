#!/usr/bin/env python3
"""
The conversion service.

Runs as its own container with no network route to anything but the web
service. It takes bytes in and gives bytes back — it holds no credentials, no
database connection and no AWS access, so a document that manages to exploit
LibreOffice finds nothing here worth reaching.

Python's stdlib HTTP server on purpose: adding a web framework to the one
container that opens untrusted files would mean tracking that framework's CVEs
too, for a service with exactly two endpoints.
"""
import base64
import json
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from convert import run_job

PORT = int(os.environ.get("CONVERTER_PORT", "8080"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT_CONVERSIONS", "2"))

# LibreOffice is memory-hungry and single-document-at-a-time by nature. Beyond
# this the container thrashes and every conversion gets slower instead of the
# queue simply waiting its turn.
_slots = threading.Semaphore(MAX_CONCURRENT)


class Handler(BaseHTTPRequestHandler):
    # Quieter than the default, and it never logs a request body.
    def log_message(self, fmt, *args):
        print(json.dumps({
            "level": "info", "service": "converter",
            "msg": fmt % args, "path": self.path,
        }), flush=True)

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Liveness for the ECS/ALB health check. Deliberately does not touch
        # LibreOffice: a health check that runs a conversion would fail the
        # whole service whenever one document is slow.
        if self.path in ("/health", "/healthz"):
            self._json(200, {"ok": True, "service": "converter"})
        else:
            self._json(404, {"ok": False, "failure": "not_found"})

    def do_POST(self):
        if self.path != "/convert":
            self._json(404, {"ok": False, "failure": "not_found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._json(400, {"ok": False, "failure": "unreadable"})
            return
        if length > MAX_UPLOAD_BYTES + 1024:
            # Refused before the body is read into memory.
            self._json(413, {"ok": False, "failure": "output_too_large"})
            return

        kind = (self.headers.get("X-Document-Kind") or "").lower()
        if kind not in ("pdf", "doc", "docx"):
            self._json(400, {"ok": False, "failure": "unreadable"})
            return

        source = self.rfile.read(length)

        # Waits rather than rejecting: a caller that gets a 503 has no better
        # option than to retry, and the retry is this queue.
        with _slots:
            try:
                result = run_job(source, kind)
            except Exception as error:  # noqa: BLE001
                print(json.dumps({
                    "level": "error", "service": "converter",
                    "msg": "conversion crashed", "error": type(error).__name__,
                }), flush=True)
                self._json(500, {"ok": False, "failure": "conversion_failed"})
                return

        if not result.get("ok"):
            # A refused document is a normal outcome, not a server error.
            self._json(200, result)
            return

        self._json(200, {
            "ok": True,
            "pages": result["pages"],
            "pageInfo": result["pageInfo"],
            "pdf": base64.b64encode(result["pdf"]).decode("ascii"),
            "images": [base64.b64encode(image).decode("ascii") for image in result["images"]],
        })


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)

    # ECS sends SIGTERM before it kills a task. Draining lets an in-flight
    # conversion finish instead of leaving the caller with a dead connection.
    def shutdown(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    print(json.dumps({
        "level": "info", "service": "converter",
        "msg": "listening", "port": PORT, "maxConcurrent": MAX_CONCURRENT,
    }), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
