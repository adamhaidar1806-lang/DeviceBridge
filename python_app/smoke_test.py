from __future__ import annotations

import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from server import DeviceBridgeHandler, init_database

init_database()
server = ThreadingHTTPServer(("127.0.0.1", 0), DeviceBridgeHandler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
base_url = f"http://127.0.0.1:{server.server_port}"

try:
    with urllib.request.urlopen(f"{base_url}/api/health") as response:
        health = json.load(response)
    with urllib.request.urlopen(f"{base_url}/") as response:
        page = response.read().decode("utf-8")
    with urllib.request.urlopen(f"{base_url}/api/devices") as response:
        devices = json.load(response)

    assert health == {"status": "ok", "backend": "python", "database": "sqlite"}
    assert "DeviceBridge" in page
    assert devices["items"]
    print("PYTHON_SMOKE_TEST_OK")
finally:
    server.shutdown()
    server.server_close()
