#!/usr/bin/env python3
"""Isolated, public-facing demo gateway for Pumpstation V5.

The real Flask application is started on 127.0.0.1 only. A separate throwaway
HTTP gateway binds 0.0.0.0 so the Arena live preview can reach it. The gateway
uses a fresh, encrypted, sample-only database on every start, disables real
Bale/Eitaa sending, and blocks security-sensitive/admin configuration writes.
It is NOT part of the shipped station application.
"""
from __future__ import annotations

import datetime
import io
import json
import os
import random
import re
import secrets
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Show the station's local civil time in the demo, independent of sandbox TZ.
os.environ["TZ"] = "Asia/Tehran"
if hasattr(time, "tzset"):
    time.tzset()

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PROGRAM = ROOT / "pumpstation-v5" / "program"
sys.path.insert(0, str(PROGRAM))

from app import create_app  # noqa: E402
from ps import queue as queue_mod  # noqa: E402
from ps.jalali import date_j_str, interval_index, now_j_str, shift_day  # noqa: E402
from ps.seed import MOTOR_PARAMS, PROCESS_PARAMS  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = int(os.environ.get("PREVIEW_UPSTREAM_PORT", "8001"))
PUBLIC_PORT = int(os.environ.get("PORT", "8080"))
RUNTIME = HERE / "runtime"
RUNTIME.mkdir(parents=True, exist_ok=True)
MAX_BODY = 2 * 1024 * 1024
DEMO_MESSAGE = "این بخش در پیش‌نمایش فقط نمایشی است؛ در نسخه نصب‌شده روی رایانه ایستگاه قابل استفاده است."
SEND_MESSAGE = "ارسال واقعی به بله/ایتا در پیش‌نمایش غیرفعال است."

# Defense in depth: even if a request bypasses the gateway policy, the demo
# process cannot send to messenger APIs and has no background queue worker.
def _blocked_send(*args, **kwargs):
    raise RuntimeError(SEND_MESSAGE)

queue_mod.send_file = _blocked_send
queue_mod.process_queue = lambda db: None


def seed_demo(db) -> None:
    """Populate an isolated sample database. No station data is read or used."""
    rng = random.Random(1405)
    today = shift_day()
    today_s = date_j_str(today)
    idx = interval_index()
    now_s = now_j_str()

    # Anonymised roster for a public demo.
    members = db.query("SELECT id FROM members ORDER BY id")
    for n, m in enumerate(members, 1):
        name = "ادمین نمایشی" if n == len(members) else f"اپراتور نمونه {n}"
        db.run("UPDATE members SET name=?, phone='' WHERE id=?", (name, m["id"]))

    setpoints = {
        "process:PIT-001": (2, 4, 1.5, 5, 0, 100),
        "process:PIT-002": (16, 20, 14, 22, 0, 400),
        "process:PIT-003": (3, 5, 2, 6, 0, 100),
        "process:PIT-004": (3, 5, 2, 6, 0, 100),
        "process:FIT-001": (1200, 1600, 1000, 1800, 0, 4000),
        "process:LT-01": (180, 300, 150, 330, 0, 400),
        "process:LT-02": (180, 300, 150, 330, 0, 400),
    }
    for key, vals in setpoints.items():
        db.run(
            "UPDATE setpoints SET warn_min=?,warn_max=?,crit_min=?,crit_max=?,phys_min=?,phys_max=?,updated_at=? WHERE key=?",
            (*vals, now_s, key),
        )
    for param, _label, _unit in MOTOR_PARAMS:
        if param.startswith("I"):
            vals = (None, 220, None, 250, 0, 400)
        elif param.startswith("VIB-"):
            vals = (None, 4.5, None, 7.1, 0, 50)
        elif param.startswith("BRG"):
            vals = (None, 70, None, 80, 0, 150)
        else:
            vals = (None, 75, None, 85, 0, 150)
        db.run(
            "UPDATE setpoints SET warn_min=?,warn_max=?,crit_min=?,crit_max=?,phys_min=?,phys_max=?,updated_at=? WHERE key=?",
            (*vals, now_s, f"motor:{param}"),
        )

    motor_hours = [
        ("on", 12480, 11200), ("on", 9800, 7600), ("on", 15600, 13200),
        ("on", 7300, 6900), ("off", 5200, 5200), ("service", 11000, 8700),
        ("on", 13400, 12100), ("off", 6400, 6400),
    ]
    for mid, (state, hours, last) in enumerate(motor_hours, 1):
        db.run(
            "UPDATE motors SET state=?,hmi_hours=?,last_service_hours=?,state_changed_at=?,state_changed_shift=? WHERE id=?",
            (state, hours, last, now_s, "شیفت A", mid),
        )
        tag = f"M-{mid:02d}"
        eq_status = "running" if state == "on" else ("service" if state == "service" else "ready")
        db.run(
            "UPDATE equipment SET status=?,run_state=?,status_changed_at=?,status_changed_shift=? WHERE tag=?",
            (eq_status, "on" if state == "on" else "off", now_s, "شیفت A", tag),
        )

    base_process = {
        "PIT-001": 2.8, "PIT-002": 18.4, "PIT-003": 4.2, "PIT-004": 4.0,
        "FIT-001": 1480, "LT-01": 245, "LT-02": 238,
    }
    process_rows, motor_rows, total_rows = [], [], []
    for day_offset in range(6, -1, -1):
        d = today - datetime.timedelta(days=day_offset)
        ds = date_j_str(d)
        max_i = idx if day_offset == 0 else 5
        for i in range(max_i + 1):
            for tag, _label, unit in PROCESS_PARAMS:
                value = base_process[tag] + rng.uniform(-0.03, 0.03) * (1 if tag.startswith("PIT") else 12)
                if day_offset == 0 and i == idx and tag == "PIT-002":
                    value = 20.4  # one visible warning in the demo
                if tag == "FIT-001":
                    value = round(value)
                elif tag.startswith("LT"):
                    value = round(value)
                else:
                    value = round(value, 2)
                process_rows.append((ds, i, tag, value, unit, "شیفت A", now_s, now_s, 0))
            for mid in range(1, 9):
                for param, _label, _unit in MOTOR_PARAMS:
                    if param.startswith("I"):
                        value = round(rng.uniform(172, 198), 1)
                    elif param.startswith("VIB-"):
                        value = round(rng.uniform(1.1, 3.8), 2)
                    elif param.startswith("BRG"):
                        value = round(rng.uniform(44, 62), 1)
                    else:
                        value = round(rng.uniform(52, 72), 1)
                    if day_offset == 0 and i == idx and mid == 3 and param == "VIB-M-DE":
                        value = 5.2  # warning, below critical 7.1
                    motor_rows.append((mid, ds, i, param, value, "شیفت A", now_s, now_s, 0))
        total_rows.append((ds, round(124000 + rng.uniform(-4000, 4000)), "شیفت A", now_s, now_s, 0))

    with db.lock:
        db.conn.executemany(
            "INSERT OR REPLACE INTO process_values(date,interval_index,param,value,unit,shift_label,recorded_at,updated_at,edited) VALUES(?,?,?,?,?,?,?,?,?)",
            process_rows,
        )
        db.conn.executemany(
            "INSERT OR REPLACE INTO motor_values(motor_id,date,interval_index,param,value,shift_label,recorded_at,updated_at,edited) VALUES(?,?,?,?,?,?,?,?,?)",
            motor_rows,
        )
        db.conn.executemany(
            "INSERT OR REPLACE INTO daily_totals(date,value,shift_label,recorded_at,updated_at,edited) VALUES(?,?,?,?,?,?)",
            total_rows,
        )
        db.conn.commit()
    db.commit()

    alerts = [
        ("process", "PIT-002", "PIT-002", 20.4, "warning", "PIT-002 / فشار خط رانش = 20.4 bar", "هشدار ۱۶ تا ۲۰ / بحرانی ۱۴ تا ۲۲"),
        ("motor", "M-03", "VIB-M-DE", 5.2, "warning", "M-03 / لرزش موتور جلو = 5.2 mm/s", "هشدار تا ۴.۵ / بحرانی تا ۷.۱"),
    ]
    for source, tag, param, value, severity, message, sp_text in alerts:
        db.run(
            "INSERT INTO alerts(created_at,date,interval_index,source,tag,param,value,severity,message,setpoint_text) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (now_s, today_s, idx, source, tag, param, value, severity, message, sp_text),
        )

    db.run(
        "INSERT OR REPLACE INTO operator_reports(date,shift_label,text,updated_at) VALUES(?,?,?,?)",
        (today_s, "شیفت A", "نمونه گزارش اپراتور: بازدید چشمی انجام شد. نشتی مشاهده نشد. لرزش موتور ۳ برای بررسی در شیفت بعد ثبت شد.", now_s),
    )
    for tag in ("P-13", "P-14", "F-01", "F-02", "COMP-01", "GEN-01"):
        db.run("UPDATE equipment SET run_state='on',status='running',status_changed_at=?,status_changed_shift='شیفت A' WHERE tag=?", (now_s, tag))
    db.run(
        "INSERT INTO problem_reports(at,shift_label,text) VALUES(?,?,?)",
        (now_s, "شیفت A", "نمونه: درخواست بررسی لرزش موتور M-03 در بازدید بعدی."),
    )
    db.run(
        "UPDATE training_pages SET title=?,body=?,updated_at=? WHERE id=1",
        (
            "راهنمای پیش‌نمایش",
            "این یک پیش‌نمایش تعاملی با اطلاعات نمونه است.\n"
            "۱) در داشبورد مقدارها را تغییر دهید و Enter بزنید.\n"
            "۲) روی هر موتور بزنید تا فرم ثبت جریان، دما، لرزش و یاتاقان باز شود.\n"
            "۳) از تب‌ها، تجهیزات جانبی، لیست تجهیزات، آموزش و گزارش مشکل را ببینید.\n"
            "۴) با ادمین نمایشی، تب ادمین هم قابل مشاهده است.\n"
            "ارسال واقعی به بله/ایتا، تغییر PIN/کانال‌ها، بازیابی و بروزرسانی در پیش‌نمایش غیرفعال است.",
            now_s,
        ),
    )
    sample_pm = [
        {"label": "بازدید چشمی و نظافت", "type": "check"},
        {"label": "کنترل صدا و لرزش غیرعادی", "type": "check"},
        {"label": "ثبت مقدار اندازه‌گیری‌شده", "type": "value"},
    ]
    for t in db.query("SELECT id FROM pm_templates"):
        db.run("UPDATE pm_templates SET items_json=?,updated_at=? WHERE id=?", (json.dumps(sample_pm, ensure_ascii=False), now_s, t["id"]))
    gen = db.one("SELECT id FROM equipment WHERE tag='GEN-01'")
    if gen:
        db.run(
            "INSERT INTO maintenance(equipment_id,date,shift_label,workers,results_json,note,created_at) VALUES(?,?,?,?,?,?,?)",
            (gen["id"], today_s, "شیفت A", "تیم نمونه", json.dumps({"بازدید چشمی": True}, ensure_ascii=False), "نمونه سابقه PM", now_s),
        )
    db.commit()


def build_app():
    # Fresh isolated data on every launch; the master password exists only in
    # this process's memory and is never written to disk or sent to the browser.
    data_dir = Path(tempfile.mkdtemp(prefix="pumpstation-demo-", dir=RUNTIME))
    master = secrets.token_urlsafe(32)
    app = create_app(data_dir=data_dir, master_password=master, testing=True)
    app.config["TESTING"] = False
    app.config["SESSION_COOKIE_NAME"] = "ps_demo_session"
    seed_demo(app.extensions["ps_db"])
    # Create one sample PDF so the reports archive is not empty.
    yesterday = date_j_str(shift_day() - datetime.timedelta(days=1))
    with app.test_client() as c:
        c.post("/api/login", json={"group": "A", "pin": "1111"})
        c.post("/api/reports/daily", json={"date": yesterday, "shift": "A", "send": False})
    return app, data_dir


SAFE_WRITES = [
    ("POST", r"/api/login"),
    ("POST", r"/api/logout"),
    ("POST", r"/api/process"),
    ("POST", r"/api/total"),
    ("POST", r"/api/motors/\d+/values"),
    ("POST", r"/api/motors/\d+/state"),
    ("POST", r"/api/alerts/\d+/ack"),
    ("POST", r"/api/operator-report"),
    ("POST", r"/api/schedule"),
    ("POST", r"/api/problems"),
    ("POST", r"/api/reports/daily"),
    ("POST", r"/api/reports/aux"),
    ("POST", r"/api/reports/registry"),
]
BLOCKED_GETS = [
    r"/api/admin/backups/.+/download",
    r"/api/admin/archives/\d+/download",
    r"/api/admin/errors/export",
    r"/api/admin/activity/export",
]


def is_safe_write(method: str, path: str) -> bool:
    return any(method == m and re.fullmatch(p, path) for m, p in SAFE_WRITES)


def rewrite_cookie(value: str, secure_context: bool) -> str:
    parts = [p.strip() for p in value.split(";") if p.strip()]
    parts = [p for p in parts if not p.lower().startswith(("samesite=", "secure", "partitioned"))]
    if secure_context:
        parts += ["SameSite=None", "Secure", "Partitioned"]
    else:
        parts += ["SameSite=Lax"]
    return "; ".join(parts)


class Gateway(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PumpstationDemo/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[preview] " + (fmt % args) + "\n")
        sys.stdout.flush()

    def _send(self, code: int, body: bytes, content_type: str, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj, extra=None):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", extra)

    def _demo_file(self, name: str):
        files = {
            "preview.css": (HERE / "static" / "preview.css", "text/css; charset=utf-8"),
            "preview.js": (HERE / "static" / "preview.js", "application/javascript; charset=utf-8"),
        }
        if name not in files:
            return self._json(404, {"error": "not found"})
        path, mime = files[name]
        self._send(200, path.read_bytes(), mime)

    def _handle(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path == "/__demo/health":
            return self._json(200, {"ok": True, "demo": True, "upstream": f"{UPSTREAM_HOST}:{UPSTREAM_PORT}"})
        if path.startswith("/__demo/"):
            return self._demo_file(path.rsplit("/", 1)[-1])

        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > MAX_BODY:
            return self._json(413, {"error": "حجم درخواست برای پیش‌نمایش بیش از حد مجاز است."})
        body = self.rfile.read(length) if length else b""
        method = self.command

        if path in ("/setup", "/unlock"):
            return self._json(403, {"error": DEMO_MESSAGE, "demo_readonly": True})
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            if path.startswith("/api/admin/"):
                return self._json(403, {"error": DEMO_MESSAGE, "demo_readonly": True})
            if path.startswith("/api/equipment") or path.startswith("/api/training") or path.startswith("/api/pm-templates"):
                return self._json(403, {"error": DEMO_MESSAGE, "demo_readonly": True})
            if re.fullmatch(r"/api/motors/\d+/(service|megger|oil|hmi)", path):
                return self._json(403, {"error": DEMO_MESSAGE, "demo_readonly": True})
            if not is_safe_write(method, path):
                return self._json(403, {"error": DEMO_MESSAGE, "demo_readonly": True})
            # Force messenger sending off even on allowed report endpoints.
            if path in ("/api/reports/daily", "/api/reports/aux"):
                try:
                    payload = json.loads(body.decode("utf-8")) if body else {}
                    if not isinstance(payload, dict):
                        payload = {}
                except Exception:
                    payload = {}
                payload["send"] = False
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if method in ("GET", "HEAD") and any(re.fullmatch(p, path) for p in BLOCKED_GETS):
            return self._json(403, {"error": DEMO_MESSAGE, "demo_readonly": True})

        query = ("?" + parsed.query) if parsed.query else ""
        url = f"http://{UPSTREAM_HOST}:{UPSTREAM_PORT}{path}{query}"
        headers = {
            "Host": f"{UPSTREAM_HOST}:{UPSTREAM_PORT}",
            "Accept-Encoding": "identity",
            "X-Forwarded-Proto": self.headers.get("X-Forwarded-Proto", "http"),
            "X-Forwarded-Host": self.headers.get("Host", ""),
        }
        for h in ("Content-Type", "Accept", "Cookie", "User-Agent"):
            if self.headers.get(h):
                headers[h] = self.headers[h]
        if body:
            headers["Content-Length"] = str(len(body))
        req = urllib.request.Request(url, data=body if body else None, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                status = resp.status
                resp_headers = list(resp.headers.items())
                data = resp.read()
        except urllib.error.HTTPError as e:
            status = e.code
            resp_headers = list(e.headers.items())
            data = e.read()
        except Exception as exc:
            return self._json(502, {"error": "پیش‌نمایش موقتاً در دسترس نیست.", "detail": str(exc)})

        content_type = next((v for k, v in resp_headers if k.lower() == "content-type"), "application/octet-stream")
        secure_context = (
            self.headers.get("X-Forwarded-Proto", "").lower() == "https"
            or ".e2b.app" in self.headers.get("Host", "")
            or ".e2b.app" in self.headers.get("X-Forwarded-Host", "")
        )
        if "text/html" in content_type.lower():
            text = data.decode("utf-8", "replace")
            text = text.replace("</head>", '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/__demo/preview.css"></head>', 1)
            text = text.replace("</body>", '<script src="/__demo/preview.js"></script></body>', 1)
            data = text.encode("utf-8")
        if "application/json" in content_type.lower() and path == "/api/admin/status":
            try:
                obj = json.loads(data.decode("utf-8"))
                obj["data_dir"] = "حافظه موقت پیش‌نمایش"
                obj["demo"] = True
                data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            except Exception:
                pass

        self.send_response(status)
        for k, v in resp_headers:
            lk = k.lower()
            if lk in ("content-length", "transfer-encoding", "connection", "content-encoding", "set-cookie"):
                continue
            self.send_header(k, v)
        for k, v in resp_headers:
            if k.lower() == "set-cookie":
                self.send_header("Set-Cookie", rewrite_cookie(v, secure_context))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Demo-Mode", "sample-data")
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(data)

    def do_GET(self): self._handle()
    def do_HEAD(self): self._handle()
    def do_POST(self): self._handle()
    def do_PUT(self): self._handle()
    def do_PATCH(self): self._handle()
    def do_DELETE(self): self._handle()
    def do_OPTIONS(self):
        self._send(204, b"", "text/plain", {"Allow": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"})


def main():
    app, data_dir = build_app()
    upstream = make_server(UPSTREAM_HOST, UPSTREAM_PORT, app, threaded=True)
    t = threading.Thread(target=upstream.serve_forever, daemon=True, name="pumpstation-localhost")
    t.start()
    gateway = ThreadingHTTPServer(("0.0.0.0", PUBLIC_PORT), Gateway)
    gateway.daemon_threads = True
    print(f"Pumpstation V5 demo gateway on 0.0.0.0:{PUBLIC_PORT}", flush=True)
    print(f"Real Flask app is localhost-only: http://{UPSTREAM_HOST}:{UPSTREAM_PORT}", flush=True)
    print(f"Isolated sample data: {data_dir}", flush=True)
    print("Real messenger sending and admin configuration writes are disabled.", flush=True)
    try:
        gateway.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        gateway.server_close()
        upstream.shutdown()


if __name__ == "__main__":
    main()
