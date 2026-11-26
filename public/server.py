import json
import os
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_FILE = Path(os.environ.get("IIDE_DATA_FILE", ROOT / ".server-data" / "trips.json"))
DATA_FILE.parent.mkdir(parents=True, exist_ok=True)


def read_trips():
    try:
        if not DATA_FILE.exists():
            DATA_FILE.write_text("[]", encoding="utf-8")
        value = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except Exception:
        return []


def write_trips(trips):
    temp = DATA_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(trips, ensure_ascii=False), encoding="utf-8")
    temp.replace(DATA_FILE)


class IideHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_json(204, {})

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/trips":
            self.send_json(200, read_trips())
        else:
            super().do_GET()

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        prefix = "/api/trips/"
        if not path.startswith(prefix):
            self.send_json(404, {"error": "Not found"})
            return

        trip_id = urllib.parse.unquote(path[len(prefix):])
        try:
            length = int(self.headers.get("Content-Length", "0"))
            trip = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.send_json(400, {"error": "Invalid JSON"})
            return

        if trip.get("id") != trip_id:
            self.send_json(400, {"error": "Trip ID does not match request URL"})
            return
        if not str(trip.get("routeName", "")).strip() or not str(trip.get("nextStop", "")).strip():
            self.send_json(400, {"error": "Route and next stop are required"})
            return

        trips = [item for item in read_trips() if item.get("id") != trip_id]
        trips.append(trip)
        write_trips(trips)
        self.send_json(200, {"ok": True, "trip": trip})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        prefix = "/api/trips/"
        if not path.startswith(prefix):
            self.send_json(404, {"error": "Not found"})
            return

        trip_id = urllib.parse.unquote(path[len(prefix):])
        trips = [item for item in read_trips() if item.get("id") != trip_id]
        write_trips(trips)
        self.send_json(200, {"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("0.0.0.0", port), IideHandler)
    print(f"Iide server listening on port {port}", flush=True)
    server.serve_forever()
