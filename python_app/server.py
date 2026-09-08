from __future__ import annotations

import hashlib
import http.server
import json
import secrets
import sqlite3
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATABASE = ROOT / "devicebridge.sqlite3"
HOST = "127.0.0.1"
PORT = 8000
SESSIONS: dict[str, int] = {}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_database() -> None:
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'USER',
                status TEXT,
                ic_number TEXT,
                age INTEGER,
                date_of_birth TEXT,
                occupation TEXT,
                position TEXT,
                school TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_profiles (
                user_id INTEGER PRIMARY KEY,
                provider_type TEXT NOT NULL,
                operation_location TEXT NOT NULL,
                shop_name TEXT,
                shop_location TEXT,
                description TEXT,
                contact TEXT,
                verification_status TEXT NOT NULL DEFAULT 'PENDING',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                location TEXT NOT NULL,
                offer TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PROCESSING APPROVAL',
                rejection_reason TEXT,
                loan_max_days INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                purpose TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at TEXT NOT NULL,
                FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS complaints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                phone TEXT,
                status TEXT NOT NULL DEFAULT 'OPEN',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                complaint_id INTEGER NOT NULL,
                author_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                from_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS appeals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                admin_note TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        for name, definition in (("status", "TEXT"), ("ic_number", "TEXT"), ("age", "INTEGER"), ("date_of_birth", "TEXT"), ("occupation", "TEXT"), ("position", "TEXT"), ("school", "TEXT")):
            if name not in columns:
                connection.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
        device_columns = {row[1] for row in connection.execute("PRAGMA table_info(devices)")}
        if "rejection_reason" not in device_columns:
            connection.execute("ALTER TABLE devices ADD COLUMN rejection_reason TEXT")
        if "loan_max_days" not in device_columns:
            connection.execute("ALTER TABLE devices ADD COLUMN loan_max_days INTEGER")
        connection.execute("UPDATE devices SET status = 'APPROVED' WHERE status = 'AVAILABLE'")
        request_columns = {row[1] for row in connection.execute("PRAGMA table_info(requests)")}
        for name, definition in (("type", "TEXT NOT NULL DEFAULT 'DONATE'"), ("phone", "TEXT"), ("pickup_location", "TEXT"), ("requested_days", "INTEGER"), ("agreement_status", "TEXT")):
            if name not in request_columns:
                connection.execute(f"ALTER TABLE requests ADD COLUMN {name} {definition}")
        admin = connection.execute("SELECT id FROM users WHERE email = 'admin' OR role = 'ADMIN' LIMIT 1").fetchone()
        if admin is None:
            connection.execute(
                "INSERT INTO users (full_name, email, password_hash, role, status, ic_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("DeviceBridge Administrator", "admin", password_hash("murid2010"), "ADMIN", "ACTIVE", "ADMIN", now()),
            )
        else:
            connection.execute("UPDATE users SET email = 'admin', password_hash = ?, role = 'ADMIN', status = 'ACTIVE' WHERE id = ?", (password_hash("murid2010"), admin[0]))
        demo = connection.execute("SELECT id FROM users WHERE email = 'demo@devicebridge.local'").fetchone()
        if demo is None:
            connection.execute(
                "INSERT INTO users (full_name, email, password_hash, role, status, ic_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("DeviceBridge Demo", "demo@devicebridge.local", password_hash("devicebridge"), "PROVIDER", "APPROVED", "DEMO", now()),
            )
            demo = connection.execute("SELECT id FROM users WHERE email = 'demo@devicebridge.local'").fetchone()
            connection.execute("INSERT OR IGNORE INTO provider_profiles (user_id, provider_type, operation_location, verification_status) VALUES (?, 'INDIVIDUAL', 'Kundang', 'APPROVED')", (demo[0],))
        count = connection.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
        if count == 0:
            connection.execute(
                "INSERT INTO devices (user_id, name, category, description, location, offer, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?)",
                (demo[0], "Lenovo ThinkPad", "Laptop", "Reliable laptop suitable for study and online work.", "Kundang", "DONATE", now()),
            )


def password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def user_view(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    profile = None
    with connect() as connection:
        profile = connection.execute("SELECT * FROM provider_profiles WHERE user_id = ?", (row["id"],)).fetchone()
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "username": row["email"],
        "icNumber": row["ic_number"] or row["email"],
        "email": row["email"],
        "role": row["role"],
        "status": row["status"],
        "age": row["age"],
        "dateOfBirth": row["date_of_birth"],
        "occupation": row["occupation"],
        "position": row["position"],
        "school": row["school"],
        "providerType": profile["provider_type"] if profile else None,
        "operationLocation": profile["operation_location"] if profile else None,
        "shopName": profile["shop_name"] if profile else None,
        "shopLocation": profile["shop_location"] if profile else None,
        "description": profile["description"] if profile else None,
        "contact": profile["contact"] if profile else None,
        "verificationStatus": profile["verification_status"] if profile else None,
    }


def device_view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "category": row["category"],
        "description": row["description"], "location": row["location"],
        "offer": row["offer"], "offers": [row["offer"]], "status": row["status"],
        "quantity": 1, "availableQuantity": 1, "pendingRequestCount": 0, "servedCount": 0,
        "loanMaxDays": row["loan_max_days"] if "loan_max_days" in row.keys() else None,
        "providerName": row["provider_name"], "providerShopName": row["shop_name"] if "shop_name" in row.keys() else None,
        "createdAt": row["created_at"], "imageUrl": None, "rejectionReason": row["rejection_reason"] if "rejection_reason" in row.keys() else None,
    }


def provider_view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "fullName": row["full_name"], "icNumber": row["ic_number"],
        "providerType": row["provider_type"], "operationLocation": row["operation_location"],
        "shopName": row["shop_name"], "shopLocation": row["shop_location"],
        "description": row["description"], "contact": row["contact"],
        "verificationStatus": row["verification_status"], "createdAt": row["created_at"],
    }


def complaint_view(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    messages = connection.execute(
        "SELECT messages.*, users.full_name AS author_name FROM messages JOIN users ON users.id = messages.author_id WHERE complaint_id = ? ORDER BY messages.id",
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"], "category": row["category"], "description": row["description"],
        "reporterName": row["full_name"], "phone": row["phone"], "status": row["status"],
        "createdAt": row["created_at"], "messages": [
            {"id": message["id"], "authorName": message["author_name"], "body": message["body"], "createdAt": message["created_at"], "fromAdmin": bool(message["from_admin"])}
            for message in messages
        ],
    }


def request_view(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "itemId": row["device_id"], "itemName": row["device_name"],
        "requesterName": row["requester_name"] if "requester_name" in row.keys() else None,
        "type": row["type"] if "type" in row.keys() else "DONATE",
        "purpose": row["purpose"], "phone": row["phone"] if "phone" in row.keys() else None,
        "pickupLocation": row["pickup_location"] if "pickup_location" in row.keys() else None,
        "requestedDays": row["requested_days"] if "requested_days" in row.keys() else None,
        "status": row["status"], "agreementStatus": row["agreement_status"] if "agreement_status" in row.keys() else None,
        "createdAt": row["created_at"], "startDate": None, "endDate": None,
    }


class DeviceBridgeHandler(http.server.BaseHTTPRequestHandler):
    server_version = "DeviceBridge-Python/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {format % args}")

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        session_cookie = getattr(self, "session_cookie", None)
        if session_cookie:
            self.send_header("Set-Cookie", session_cookie)
            self.session_cookie = None
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def current_user(self) -> sqlite3.Row | None:
        cookie = self.headers.get("Cookie", "")
        token = next((part.split("=", 1)[1] for part in cookie.split("; ") if part.startswith("devicebridge_session=")), None)
        user_id = SESSIONS.get(token or "")
        if not user_id:
            return None
        with connect() as connection:
            return connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    def require_user(self) -> sqlite3.Row | None:
        user = self.current_user()
        if user is None:
            self.send_json({"error": "Authentication required"}, 401)
        return user

    def require_admin(self) -> bool:
        user = self.require_user()
        if user is None:
            return False
        if user["role"] != "ADMIN":
            self.send_json({"error": "Administrator access required"}, 403)
            return False
        return True

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.api_get(parsed.path, urllib.parse.parse_qs(parsed.query))
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.api_post(parsed.path)
            return
        self.send_json({"error": "Not found"}, 404)

    def do_PATCH(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/admin/providers/") and parsed.path.endswith("/decision"):
            if not self.require_admin():
                return
            provider_id = int(parsed.path.split("/")[4])
            decision = str(self.read_json().get("decision", "")).upper()
            status = "APPROVED" if decision == "APPROVED" else "REJECTED"
            with connect() as connection:
                connection.execute("UPDATE provider_profiles SET verification_status = ? WHERE user_id = ?", (status, provider_id))
                connection.execute("UPDATE users SET status = ? WHERE id = ?", (status, provider_id))
                if status == "APPROVED":
                    connection.execute("INSERT INTO notifications (user_id, title, body, created_at) VALUES (?, ?, ?, ?)", (provider_id, "Provider account approved", "Your provider account is now approved. You can submit device listings for review.", now()))
                row = connection.execute("SELECT users.*, provider_profiles.* FROM users JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE users.id = ?", (provider_id,)).fetchone()
            self.send_json(provider_view(row))
            return
        if parsed.path.startswith("/api/admin/items/") and parsed.path.endswith("/decision"):
            if not self.require_admin():
                return
            item_id = int(parsed.path.split("/")[4])
            payload = self.read_json()
            decision = str(payload.get("decision", "")).upper()
            status = "APPROVED" if decision == "APPROVED" else "REJECTED"
            with connect() as connection:
                connection.execute("UPDATE devices SET status = ?, rejection_reason = ? WHERE id = ?", (status, payload.get("reason"), item_id))
                item = connection.execute("SELECT * FROM devices WHERE id = ?", (item_id,)).fetchone()
                if item and status == "APPROVED":
                    connection.execute("INSERT INTO notifications (user_id, title, body, created_at) VALUES (?, ?, ?, ?)", (item["user_id"], "Listing approved", f"Your listing '{item['name']}' is now visible to the community.", now()))
                row = connection.execute("SELECT devices.*, users.full_name AS provider_name, provider_profiles.shop_name FROM devices JOIN users ON users.id = devices.user_id LEFT JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE devices.id = ?", (item_id,)).fetchone()
            self.send_json(device_view(row))
            return
        if parsed.path.startswith("/api/admin/appeals/") and parsed.path.endswith("/decision"):
            if not self.require_admin():
                return
            appeal_id = int(parsed.path.split("/")[4])
            payload = self.read_json()
            decision = str(payload.get("decision", "REJECTED")).upper()
            with connect() as connection:
                appeal = connection.execute("SELECT * FROM appeals WHERE id = ?", (appeal_id,)).fetchone()
                if appeal is None:
                    self.send_json({"error": "Appeal not found"}, 404)
                    return
                connection.execute("UPDATE appeals SET status = ?, admin_note = ? WHERE id = ?", (decision, payload.get("note"), appeal_id))
                if decision == "APPROVED":
                    connection.execute("UPDATE users SET status = 'ACTIVE' WHERE id = ?", (appeal["user_id"],))
                    connection.execute("INSERT INTO notifications (user_id, title, body, created_at) VALUES (?, ?, ?, ?)", (appeal["user_id"], "Appeal approved", "Your account appeal was approved by the admin team.", now()))
                row = connection.execute("SELECT * FROM appeals WHERE id = ?", (appeal_id,)).fetchone()
            self.send_json({"id": row["id"], "userId": row["user_id"], "message": row["message"], "status": row["status"], "adminNote": row["admin_note"], "createdAt": row["created_at"], "reviewedAt": now()})
            return
        if parsed.path.startswith("/api/requests/") and parsed.path.endswith("/decision"):
            user = self.require_user()
            if user is None or user["role"] != "PROVIDER":
                if user is not None:
                    self.send_json({"error": "Provider access required"}, 403)
                return
            request_id = int(parsed.path.split("/")[3])
            payload = self.read_json()
            decision = str(payload.get("decision", "")).upper()
            status = "APPROVED" if decision == "APPROVED" else "REJECTED"
            with connect() as connection:
                connection.execute("UPDATE requests SET status = ?, agreement_status = ? WHERE id = ?", (status, status, request_id))
                request = connection.execute("SELECT requests.*, devices.name AS device_name FROM requests JOIN devices ON devices.id = requests.device_id WHERE requests.id = ?", (request_id,)).fetchone()
                if request:
                    connection.execute("INSERT INTO notifications (user_id, title, body, created_at) VALUES (?, ?, ?, ?)", (request["user_id"], "Request updated", f"Your request for '{request['device_name']}' was {status.lower()}.", now()))
            self.send_json({"id": request_id, "status": status})
            return
        if parsed.path.startswith("/api/requests/") and parsed.path.endswith("/cancel"):
            user = self.require_user()
            if user is None:
                return
            request_id = int(parsed.path.split("/")[3])
            with connect() as connection:
                request = connection.execute("SELECT * FROM requests WHERE id = ? AND user_id = ?", (request_id, user["id"])).fetchone()
                if request is None:
                    self.send_json({"error": "Request not found"}, 404)
                    return
                connection.execute("UPDATE requests SET status = 'CANCELLED', agreement_status = ? WHERE id = ?", (str(self.read_json().get("reason", "Cancelled by requester")), request_id))
            self.send_json({"id": request_id, "status": "CANCELLED"})
            return
        if parsed.path.startswith("/api/admin/users/") and parsed.path.endswith("/moderation"):
            if not self.require_admin():
                return
            user_id = int(parsed.path.split("/")[4])
            payload = self.read_json()
            action = str(payload.get("action", "BAN")).upper()
            status = "ACTIVE" if action == "RESTORE" else "BANNED"
            with connect() as connection:
                connection.execute("UPDATE users SET status = ? WHERE id = ? AND role != 'ADMIN'", (status, user_id))
                row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            self.send_json(user_view(row))
            return
        if parsed.path.startswith("/api/items/"):
            user = self.require_user()
            if user is None:
                return
            item_id = int(parsed.path.split("/")[3])
            payload = self.read_json()
            with connect() as connection:
                item = connection.execute("SELECT * FROM devices WHERE id = ? AND user_id = ?", (item_id, user["id"])).fetchone()
                if item is None:
                    self.send_json({"error": "Listing not found"}, 404)
                    return
                connection.execute("UPDATE devices SET name = ?, category = ?, location = ?, status = 'PROCESSING APPROVAL' WHERE id = ?", (payload.get("name", item["name"]), payload.get("category", item["category"]), payload.get("location", item["location"]), item_id))
                row = connection.execute("SELECT devices.*, users.full_name AS provider_name, provider_profiles.shop_name FROM devices JOIN users ON users.id = devices.user_id LEFT JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE devices.id = ?", (item_id,)).fetchone()
            self.send_json(device_view(row))
            return
        if parsed.path == "/api/auth/change-password":
            user = self.require_user()
            if user is None:
                return
            payload = self.read_json()
            if password_hash(str(payload.get("currentPassword", ""))) != user["password_hash"]:
                self.send_json({"error": "Your current password is not correct."}, 400)
                return
            new_password = str(payload.get("newPassword", ""))
            if len(new_password) < 8:
                self.send_json({"error": "Your new password must be at least 8 characters."}, 400)
                return
            with connect() as connection:
                connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash(new_password), user["id"]))
            self.send_json({}, 204)
            return
        if parsed.path == "/api/profile":
            user = self.require_user()
            if user is None:
                return
            payload = self.read_json()
            updates = {
                "full_name": str(payload.get("fullName", user["full_name"])).strip(),
            }
            with connect() as connection:
                connection.execute("UPDATE users SET full_name = ? WHERE id = ?", (updates["full_name"], user["id"]))
                updated = connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            self.send_json(user_view(updated))
            return
        self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/profile":
            user = self.require_user()
            if user is None:
                return
            with connect() as connection:
                connection.execute("DELETE FROM users WHERE id = ?", (user["id"],))
            self.send_json({}, 204)
            return
        self.send_json({"error": "Not found"}, 404)

    def api_get(self, path: str, query: dict[str, list[str]]) -> None:
        if path == "/api/health":
            self.send_json({"status": "ok", "backend": "python", "database": "sqlite"})
        elif path in ("/api/session", "/api/auth/session"):
            self.send_json({"authenticated": self.current_user() is not None, "user": user_view(self.current_user())})
        elif path in ("/api/devices", "/api/items"):
            search = query.get("search", [""])[0].strip().lower()
            with connect() as connection:
                rows = connection.execute(
                    "SELECT devices.*, users.full_name AS provider_name, provider_profiles.shop_name FROM devices JOIN users ON users.id = devices.user_id LEFT JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE devices.status = 'APPROVED' AND COALESCE(provider_profiles.verification_status, 'APPROVED') = 'APPROVED' AND (LOWER(devices.name) LIKE ? OR LOWER(devices.category) LIKE ? OR LOWER(devices.location) LIKE ?) ORDER BY devices.id DESC",
                    (f"%{search}%", f"%{search}%", f"%{search}%"),
                ).fetchall()
            self.send_json([device_view(row) for row in rows])
        elif path.startswith("/api/items/"):
            item_id = int(path.split("/")[3])
            with connect() as connection:
                row = connection.execute("SELECT devices.*, users.full_name AS provider_name, provider_profiles.shop_name FROM devices JOIN users ON users.id = devices.user_id LEFT JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE devices.id = ?", (item_id,)).fetchone()
            if row is None:
                self.send_json({"error": "Device not found"}, 404)
            else:
                self.send_json(device_view(row))
        elif path == "/api/provider/items":
            user = self.require_user()
            if user is None:
                return
            with connect() as connection:
                rows = connection.execute("SELECT devices.*, users.full_name AS provider_name FROM devices JOIN users ON users.id = devices.user_id WHERE user_id = ? ORDER BY devices.id DESC", (user["id"],)).fetchall()
            self.send_json([device_view(row) for row in rows])
        elif path == "/api/admin/providers":
            if not self.require_admin():
                return
            with connect() as connection:
                rows = connection.execute("SELECT users.*, provider_profiles.* FROM users JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE provider_profiles.verification_status = 'PENDING' ORDER BY users.id DESC").fetchall()
            self.send_json([provider_view(row) for row in rows])
        elif path == "/api/admin/items":
            if not self.require_admin():
                return
            with connect() as connection:
                rows = connection.execute("SELECT devices.*, users.full_name AS provider_name, provider_profiles.shop_name FROM devices JOIN users ON users.id = devices.user_id LEFT JOIN provider_profiles ON provider_profiles.user_id = users.id WHERE devices.status = 'PROCESSING APPROVAL' ORDER BY devices.id DESC").fetchall()
            self.send_json([device_view(row) for row in rows])
        elif path == "/api/profile":
            user = self.require_user()
            if user is None:
                return
            self.send_json(user_view(user))
        elif path == "/api/notifications":
            user = self.require_user()
            if user is None:
                return
            with connect() as connection:
                rows = connection.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
            self.send_json([dict(row) for row in rows])
        elif path == "/api/support/complaints":
            user = self.require_user()
            if user is None:
                return
            with connect() as connection:
                rows = connection.execute("SELECT complaints.*, users.full_name FROM complaints JOIN users ON users.id = complaints.user_id WHERE complaints.user_id = ? ORDER BY complaints.id DESC", (user["id"],)).fetchall()
                self.send_json([complaint_view(connection, row) for row in rows])
        elif path == "/api/admin/complaints":
            if not self.require_admin():
                return
            with connect() as connection:
                rows = connection.execute("SELECT complaints.*, users.full_name FROM complaints JOIN users ON users.id = complaints.user_id ORDER BY complaints.id DESC").fetchall()
                self.send_json([complaint_view(connection, row) for row in rows])
        elif path == "/api/admin/summary":
            if not self.require_admin():
                return
            with connect() as connection:
                summary = {
                    "users": connection.execute("SELECT COUNT(*) FROM users WHERE role = 'USER'").fetchone()[0],
                    "providers": connection.execute("SELECT COUNT(*) FROM users WHERE role = 'PROVIDER'").fetchone()[0],
                    "activeItems": connection.execute("SELECT COUNT(*) FROM devices WHERE status = 'APPROVED'").fetchone()[0],
                    "onLoanItems": 0, "donatedItems": connection.execute("SELECT COUNT(*) FROM devices WHERE status = 'APPROVED' AND offer = 'DONATE'").fetchone()[0],
                    "soldItems": connection.execute("SELECT COUNT(*) FROM devices WHERE status = 'APPROVED' AND offer = 'SELL'").fetchone()[0],
                    "pendingRequests": connection.execute("SELECT COUNT(*) FROM requests WHERE status = 'PENDING'").fetchone()[0],
                    "openComplaints": connection.execute("SELECT COUNT(*) FROM complaints WHERE status NOT IN ('RESOLVED', 'CLOSED')").fetchone()[0],
                    "pendingItems": connection.execute("SELECT COUNT(*) FROM devices WHERE status = 'PROCESSING APPROVAL'").fetchone()[0],
                    "pendingProviders": connection.execute("SELECT COUNT(*) FROM provider_profiles WHERE verification_status = 'PENDING'").fetchone()[0],
                }
            self.send_json(summary)
        elif path == "/api/admin/users":
            if not self.require_admin():
                return
            with connect() as connection:
                rows = connection.execute("SELECT * FROM users WHERE role != 'ADMIN' ORDER BY id DESC").fetchall()
            self.send_json([user_view(row) for row in rows])
        elif path == "/api/admin/appeals":
            if not self.require_admin():
                return
            with connect() as connection:
                rows = connection.execute("SELECT appeals.*, users.full_name, users.ic_number, users.role, users.status FROM appeals JOIN users ON users.id = appeals.user_id ORDER BY appeals.id DESC").fetchall()
            self.send_json([{"id": row["id"], "userId": row["user_id"], "fullName": row["full_name"], "icNumber": row["ic_number"], "role": row["role"], "moderationStatus": row["status"], "message": row["message"], "status": row["status"], "adminNote": row["admin_note"], "createdAt": row["created_at"], "reviewedAt": None} for row in rows])
        elif path == "/api/requests":
            user = self.require_user()
            if user is None:
                return
            with connect() as connection:
                rows = connection.execute(
                    "SELECT requests.*, devices.name AS device_name, users.full_name AS requester_name FROM requests JOIN devices ON devices.id = requests.device_id JOIN users ON users.id = requests.user_id WHERE requests.user_id = ? ORDER BY requests.id DESC",
                    (user["id"],),
                ).fetchall()
            self.send_json([request_view(row) for row in rows])
        elif path == "/api/provider/requests":
            user = self.require_user()
            if user is None or user["role"] != "PROVIDER":
                if user is not None:
                    self.send_json({"error": "Provider access required"}, 403)
                return
            with connect() as connection:
                rows = connection.execute("SELECT requests.*, devices.name AS device_name, users.full_name AS requester_name FROM requests JOIN devices ON devices.id = requests.device_id JOIN users ON users.id = requests.user_id WHERE devices.user_id = ? ORDER BY requests.id DESC", (user["id"],)).fetchall()
            self.send_json([request_view(row) for row in rows])
        elif path == "/api/admin/requests":
            if not self.require_admin():
                return
            with connect() as connection:
                rows = connection.execute("SELECT requests.*, devices.name AS device_name, users.full_name AS requester_name FROM requests JOIN devices ON devices.id = requests.device_id JOIN users ON users.id = requests.user_id ORDER BY requests.id DESC").fetchall()
            self.send_json([request_view(row) for row in rows])
        elif path in ("/api/impact", "/api/admin/impact"):
            with connect() as connection:
                devices = connection.execute("SELECT COUNT(*) FROM devices").fetchone()[0]
                requests = connection.execute("SELECT COUNT(*) FROM requests").fetchone()[0]
                providers = connection.execute("SELECT COUNT(DISTINCT user_id) FROM devices").fetchone()[0]
            self.send_json({"devices": devices, "requests": requests, "providers": providers})
        else:
            self.send_json({"error": "Not found"}, 404)

    def api_post(self, path: str) -> None:
        payload = self.read_json()
        if path == "/api/auth/appeals":
            identifier = str(payload.get("identifier", "")).strip().lower()
            with connect() as connection:
                user = connection.execute("SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(full_name) = ? OR LOWER(ic_number) = ?", (identifier, identifier, identifier)).fetchone()
                if user is None:
                    self.send_json({"error": "Account not found."}, 404)
                    return
                cursor = connection.execute("INSERT INTO appeals (user_id, message, created_at) VALUES (?, ?, ?)", (user["id"], str(payload.get("message", "")).strip(), now()))
            self.send_json({"id": cursor.lastrowid, "userId": user["id"], "message": payload.get("message"), "status": "PENDING", "adminNote": None, "createdAt": now(), "reviewedAt": None}, 201)
            return
        if path in ("/api/register", "/api/auth/register/user", "/api/auth/register/provider"):
            name = str(payload.get("fullName", "")).strip()
            email = str(payload.get("email") or payload.get("icNumber", "")).strip().lower()
            password = str(payload.get("password", ""))
            if not name or not email or len(password) < 8:
                self.send_json({"error": "Name, email, and an 8-character password are required."}, 400)
                return
            is_provider = path.endswith("/provider")
            role = "PROVIDER" if is_provider else "USER"
            status = "PENDING VERIFICATION" if is_provider else str(payload.get("status") or "STUDENT")
            try:
                with connect() as connection:
                    cursor = connection.execute("INSERT INTO users (full_name, email, password_hash, role, status, ic_number, age, date_of_birth, occupation, position, school, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (name, email, password_hash(password), role, status, str(payload.get("icNumber") or email).upper(), payload.get("age"), payload.get("dateOfBirth"), payload.get("occupation"), payload.get("position"), payload.get("school"), now()))
                    user_id = cursor.lastrowid
                    if is_provider:
                        connection.execute("INSERT INTO provider_profiles (user_id, provider_type, operation_location, shop_name, shop_location, description, contact, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')", (user_id, payload.get("providerType", "INDIVIDUAL"), payload.get("operationLocation", ""), payload.get("shopName"), payload.get("shopLocation"), payload.get("description"), payload.get("contact")))
            except sqlite3.IntegrityError:
                self.send_json({"error": "That email is already registered."}, 409)
                return
            self.start_session(int(user_id))
            with connect() as connection:
                user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            self.send_json({"authenticated": True, "user": user_view(user)}, 201 if is_provider else 201)
        elif path in ("/api/login", "/api/auth/login"):
            email = str(payload.get("email") or payload.get("identifier", "")).strip().lower()
            with connect() as connection:
                user = connection.execute("SELECT * FROM users WHERE (LOWER(email) = ? OR LOWER(full_name) = ? OR LOWER(ic_number) = ?) AND password_hash = ?", (email, email, email, password_hash(str(payload.get("password", ""))))).fetchone()
            if user is None:
                self.send_json({"error": "Email or password is incorrect."}, 401)
                return
            self.start_session(user["id"])
            self.send_json({"authenticated": True, "user": user_view(user)})
        elif path in ("/api/logout", "/api/auth/logout"):
            cookie = self.headers.get("Cookie", "")
            token = next((part.split("=", 1)[1] for part in cookie.split("; ") if part.startswith("devicebridge_session=")), None)
            SESSIONS.pop(token or "", None)
            self.send_json({"ok": True})
        elif path in ("/api/devices", "/api/items"):
            user = self.require_user()
            if user is None:
                return
            offers = payload.get("offers") or [payload.get("offer")]
            offers = [str(value).strip().upper() for value in offers if value]
            required = [payload.get("name"), payload.get("category"), payload.get("condition"), payload.get("location")]
            if user["role"] != "PROVIDER":
                self.send_json({"error": "Only providers can create listings."}, 403)
                return
            if not all(str(value).strip() for value in required) or not offers:
                self.send_json({"error": "All device listing fields are required."}, 400)
                return
            with connect() as connection:
                loan_max_days = payload.get("loanMaxDays")
                cursor = connection.execute("INSERT INTO devices (user_id, name, category, description, location, offer, status, loan_max_days, created_at) VALUES (?, ?, ?, ?, ?, ?, 'PROCESSING APPROVAL', ?, ?)", (user["id"], str(payload.get("name")).strip(), str(payload.get("category")).strip(), str(payload.get("condition")).strip(), str(payload.get("location")).strip(), offers[0], loan_max_days, now()))
            self.send_json({"id": cursor.lastrowid, "name": payload.get("name"), "category": payload.get("category"), "condition": payload.get("condition"), "location": payload.get("location"), "offers": offers, "loanMaxDays": loan_max_days, "status": "PROCESSING APPROVAL"}, 201)
        elif path == "/api/requests":
            user = self.require_user()
            if user is None:
                return
            device_id = int(payload.get("itemId") or payload.get("deviceId") or 0)
            purpose = str(payload.get("purpose", "")).strip()
            if not device_id or not purpose:
                self.send_json({"error": "A device and purpose are required."}, 400)
                return
            with connect() as connection:
                device = connection.execute("SELECT * FROM devices WHERE id = ? AND status = 'APPROVED'", (device_id,)).fetchone()
                if device is None:
                    self.send_json({"error": "This device is not currently available for requests."}, 400)
                    return
                request_type = str(payload.get("type", "DONATE")).upper()
                requested_days = payload.get("requestedDays")
                if request_type == "BORROW":
                    try:
                        requested_days = int(requested_days)
                    except (TypeError, ValueError):
                        self.send_json({"error": "Please enter how many loan days you need."}, 400)
                        return
                    max_days = device["loan_max_days"]
                    if max_days is not None and requested_days > max_days:
                        self.send_json({"error": f"This provider allows a maximum loan of {max_days} days."}, 400)
                        return
                    if requested_days < 1:
                        self.send_json({"error": "Loan days must be at least 1 day."}, 400)
                        return
                cursor = connection.execute("INSERT INTO requests (device_id, user_id, type, purpose, phone, pickup_location, requested_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (device_id, user["id"], request_type, purpose, payload.get("phone"), payload.get("pickupLocation"), requested_days, now()))
                row = connection.execute("SELECT requests.*, devices.name AS device_name, users.full_name AS requester_name FROM requests JOIN devices ON devices.id = requests.device_id JOIN users ON users.id = requests.user_id WHERE requests.id = ?", (cursor.lastrowid,)).fetchone()
            self.send_json(request_view(row), 201)
        elif path == "/api/support/complaints":
            user = self.require_user()
            if user is None:
                return
            if not str(payload.get("description", "")).strip():
                self.send_json({"error": "A description is required."}, 400)
                return
            with connect() as connection:
                cursor = connection.execute("INSERT INTO complaints (user_id, category, description, phone, created_at) VALUES (?, ?, ?, ?, ?)", (user["id"], payload.get("category", "Other"), payload["description"].strip(), payload.get("phone"), now()))
                row = connection.execute("SELECT complaints.*, users.full_name FROM complaints JOIN users ON users.id = complaints.user_id WHERE complaints.id = ?", (cursor.lastrowid,)).fetchone()
                self.send_json(complaint_view(connection, row), 201)
        elif path.startswith("/api/support/complaints/") and path.endswith("/messages"):
            user = self.require_user()
            if user is None:
                return
            complaint_id = int(path.split("/")[4])
            with connect() as connection:
                complaint = connection.execute("SELECT * FROM complaints WHERE id = ?", (complaint_id,)).fetchone()
                if complaint is None or (user["role"] != "ADMIN" and complaint["user_id"] != user["id"]):
                    self.send_json({"error": "Complaint not found"}, 404)
                    return
                cursor = connection.execute("INSERT INTO messages (complaint_id, author_id, body, from_admin, created_at) VALUES (?, ?, ?, ?, ?)", (complaint_id, user["id"], str(payload.get("body", "")).strip(), 1 if user["role"] == "ADMIN" else 0, now()))
                if user["role"] == "ADMIN":
                    connection.execute("UPDATE complaints SET status = ? WHERE id = ?", (payload.get("status") or "IN_REVIEW", complaint_id))
                message = connection.execute("SELECT messages.*, users.full_name AS author_name FROM messages JOIN users ON users.id = messages.author_id WHERE messages.id = ?", (cursor.lastrowid,)).fetchone()
            self.send_json({"id": message["id"], "authorName": message["author_name"], "body": message["body"], "createdAt": message["created_at"], "fromAdmin": bool(message["from_admin"])}, 201)
        else:
            self.send_json({"error": "Not found"}, 404)

    def start_session(self, user_id: int) -> None:
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = user_id
        self.session_cookie = f"devicebridge_session={token}; HttpOnly; SameSite=Lax; Path=/"

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        requested = (STATIC / relative).resolve()
        if STATIC not in requested.parents and requested != STATIC:
            self.send_json({"error": "Not found"}, 404)
            return
        if not requested.is_file():
            requested = STATIC / "index.html"
        content = requested.read_bytes()
        content_type = "text/html; charset=utf-8" if requested.suffix == ".html" else "text/css; charset=utf-8" if requested.suffix == ".css" else "application/javascript; charset=utf-8" if requested.suffix == ".js" else "image/svg+xml" if requested.suffix == ".svg" else "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    init_database()
    print(f"DeviceBridge Python app: http://{HOST}:{PORT}")
    http.server.ThreadingHTTPServer((HOST, PORT), DeviceBridgeHandler).serve_forever()
