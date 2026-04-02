"""
OpenBB Bridge — JSON Lines stdin/stdout bridge for Dexter ↔ OpenBB communication.

Reads JSON requests from stdin, calls OpenBB, writes JSON responses to stdout.
Logs go to stderr so they don't interfere with the protocol.

This is a placeholder for Phase 1 implementation. The protocol is defined;
the handlers are stubbed.
"""

import json
import sys
import logging

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

# Method handlers — each takes params dict, returns data dict or raises
HANDLERS: dict = {}


def handle_request(request: dict) -> dict:
    """Dispatch a request to the appropriate handler."""
    req_id = request.get("id", "unknown")
    method = request.get("method")
    params = request.get("params", {})

    if method not in HANDLERS:
        return {
            "id": req_id,
            "error": f"Unknown method: {method}",
            "data": None,
        }

    try:
        data = HANDLERS[method](params)
        return {"id": req_id, "error": None, "data": data}
    except Exception as e:
        log.error(f"Error handling {method}: {e}")
        return {"id": req_id, "error": str(e), "data": None}


def main():
    """Main loop: read JSON Lines from stdin, write responses to stdout."""
    log.info("OpenBB bridge starting...")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(
                json.dumps({"id": "unknown", "error": f"Invalid JSON: {e}", "data": None})
                + "\n"
            )
            sys.stdout.flush()
            continue

        response = handle_request(request)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
