"""Encrypted-at-rest SQLite. The working database lives in RAM; every commit is
serialized, AES-256-GCM encrypted and atomically replaced on disk. No plaintext
SQLite file is written to data/.
"""
import sqlite3, threading, json, datetime, zipfile, io
from pathlib import Path
from . import security
from .config import DB_FILE, BACKUP_DIR
from .jalali import now_j_str, date_j_str

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (key TEXT PRIMARY KEY, label TEXT NOT NULL, pin_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operator');
CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_key TEXT NOT NULL REFERENCES groups(key), name TEXT NOT NULL, phone TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS equipment_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, slug TEXT UNIQUE NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS equipment (
 id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT UNIQUE NOT NULL, category_id INTEGER NOT NULL REFERENCES equipment_categories(id),
 name TEXT NOT NULL, spec TEXT DEFAULT '', plate TEXT DEFAULT '', part_numbers TEXT DEFAULT '', location TEXT DEFAULT '', notes TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'ready', run_state TEXT NOT NULL DEFAULT 'off', is_motor_main INTEGER NOT NULL DEFAULT 0,
 monitored_aux INTEGER NOT NULL DEFAULT 0, safety_critical INTEGER NOT NULL DEFAULT 0, status_changed_at TEXT, status_changed_shift TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS motors (
 id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT UNIQUE NOT NULL, pump_tag TEXT UNIQUE NOT NULL, equipment_id INTEGER REFERENCES equipment(id),
 state TEXT NOT NULL DEFAULT 'off', hmi_hours REAL NOT NULL DEFAULT 0, last_service_hours REAL NOT NULL DEFAULT 0,
 service_interval REAL NOT NULL DEFAULT 2500, state_changed_at TEXT, state_changed_shift TEXT
);
CREATE TABLE IF NOT EXISTS process_values (
 date TEXT NOT NULL, interval_index INTEGER NOT NULL, param TEXT NOT NULL, value REAL NOT NULL, unit TEXT DEFAULT '',
 shift_label TEXT NOT NULL, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (date, interval_index, param)
);
CREATE TABLE IF NOT EXISTS daily_totals (date TEXT PRIMARY KEY, value REAL NOT NULL, shift_label TEXT NOT NULL, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS motor_values (
 motor_id INTEGER NOT NULL REFERENCES motors(id), date TEXT NOT NULL, interval_index INTEGER NOT NULL, param TEXT NOT NULL,
 value REAL NOT NULL, shift_label TEXT NOT NULL, recorded_at TEXT NOT NULL, updated_at TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (motor_id, date, interval_index, param)
);
CREATE TABLE IF NOT EXISTS setpoints (
 key TEXT PRIMARY KEY, scope TEXT NOT NULL, param TEXT NOT NULL, motor_tag TEXT, label TEXT NOT NULL, unit TEXT DEFAULT '',
 warn_min REAL, warn_max REAL, crit_min REAL, crit_max REAL, phys_min REAL, phys_max REAL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, date TEXT NOT NULL, interval_index INTEGER, source TEXT NOT NULL,
 tag TEXT NOT NULL, param TEXT NOT NULL, value REAL, severity TEXT NOT NULL, message TEXT NOT NULL, setpoint_text TEXT DEFAULT '',
 seen_at TEXT, seen_shift TEXT, acted_at TEXT, acted_shift TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS motor_state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, motor_id INTEGER NOT NULL, old_state TEXT, new_state TEXT NOT NULL, shift_label TEXT NOT NULL, at TEXT NOT NULL, note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS motor_services (
 id INTEGER PRIMARY KEY AUTOINCREMENT, motor_id INTEGER NOT NULL, date TEXT NOT NULL, shift_label TEXT NOT NULL, workers TEXT DEFAULT '',
 brush_json TEXT NOT NULL DEFAULT '{}', hmi_hours REAL, note TEXT DEFAULT '', created_at TEXT NOT NULL, pdf_path TEXT
);
CREATE TABLE IF NOT EXISTS megger_tests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, motor_id INTEGER NOT NULL, date TEXT NOT NULL, shift_label TEXT NOT NULL,
 stator_u REAL, stator_v REAL, stator_w REAL, rotor_u REAL, rotor_v REAL, rotor_w REAL, winding_temp REAL, pi REAL,
 test_voltage INTEGER NOT NULL DEFAULT 1000, note TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oil_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, motor_id INTEGER NOT NULL, date TEXT NOT NULL, shift_label TEXT NOT NULL, hmi_hours REAL, note TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hmi_corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, motor_id INTEGER NOT NULL, old_hours REAL NOT NULL, new_hours REAL NOT NULL, reason TEXT NOT NULL, shift_label TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aux_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL, run_state TEXT, status TEXT, shift_label TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS aux_pdf_exports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, shift_label TEXT NOT NULL, snapshot_json TEXT NOT NULL, pdf_path TEXT);
CREATE TABLE IF NOT EXISTS schedule (
 id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, time TEXT NOT NULL, type TEXT NOT NULL, group_key TEXT NOT NULL,
 member_id INTEGER REFERENCES members(id), replacement_member_id INTEGER REFERENCES members(id), note TEXT DEFAULT '', shift_label TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_reports (date TEXT NOT NULL, shift_label TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (date, shift_label));
CREATE TABLE IF NOT EXISTS pm_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES equipment_categories(id), name TEXT NOT NULL, items_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS maintenance (
 id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL REFERENCES equipment(id), date TEXT NOT NULL, shift_label TEXT NOT NULL,
 workers TEXT DEFAULT '', template_id INTEGER, results_json TEXT NOT NULL DEFAULT '{}', note TEXT DEFAULT '', created_at TEXT NOT NULL, edited_at TEXT, pdf_path TEXT
);
CREATE TABLE IF NOT EXISTS catalogs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL REFERENCES equipment(id), filename TEXT NOT NULL, original_name TEXT NOT NULL,
 uploaded_at TEXT NOT NULL, uploaded_by TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, shift_label TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL,
 path TEXT NOT NULL, created_at TEXT NOT NULL, corrected_from INTEGER, meta_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS channels (key TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'bale', chat_id TEXT DEFAULT '', token TEXT DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS send_queue (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, kind TEXT NOT NULL, report_id INTEGER, file_path TEXT NOT NULL,
 channel_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT DEFAULT '',
 next_retry_at TEXT, sent_at TEXT, canceled_at TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, shift_label TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, traceback TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS problem_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, shift_label TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS training_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS monthly_archives (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, month INTEGER NOT NULL, filename TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(year,month));
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active, created_at);
CREATE INDEX IF NOT EXISTS idx_motor_values_date ON motor_values(date, motor_id);
CREATE INDEX IF NOT EXISTS idx_process_values_date ON process_values(date);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at);
"""

class Database:
    def __init__(self, key: bytes, path: Path = DB_FILE):
        self.key = key; self.path = Path(path); self.lock = threading.RLock()
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        if self.path.exists():
            self.conn.deserialize(security.decrypt_bytes(key, self.path.read_bytes()))
        self._migrate()

    def _migrate(self):
        cur = self.conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
        old_version = 0
        if cur.fetchone():
            row = self.conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
            old_version = int(row[0]) if row else 0
        if old_version > SCHEMA_VERSION:
            raise RuntimeError("نسخه دیتابیس از نسخه برنامه جدیدتر است؛ برنامه را بروزرسانی کنید")
        if old_version < SCHEMA_VERSION and self.path.exists():
            self._pre_migration_backup(old_version)
        self.conn.executescript(SCHEMA)
        self.conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))
        self.conn.commit(); self.persist()

    def _pre_migration_backup(self, old_version):
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        name = f"pre-migration-{date_j_str().replace('/', '-')}-v{old_version}-to-v{SCHEMA_VERSION}.zip.enc"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("pumpstation.db", self.conn.serialize())
            z.writestr("manifest.json", json.dumps({"schema_version": old_version, "at": now_j_str()}, ensure_ascii=False))
        security.atomic_write(BACKUP_DIR / name, security.encrypt_bytes(self.key, buf.getvalue()))

    def persist(self):
        with self.lock:
            data = self.conn.serialize()
            security.atomic_write(self.path, security.encrypt_bytes(self.key, data))

    def query(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        rows = self.query(sql, args); return rows[0] if rows else None

    def run(self, sql, args=()):
        with self.lock:
            cur = self.conn.execute(sql, args); self.conn.commit(); self.persist(); return cur.lastrowid

    def script(self, sql):
        with self.lock:
            self.conn.executescript(sql); self.conn.commit(); self.persist()

    def commit(self):
        with self.lock:
            self.conn.commit(); self.persist()

    def replace_from_plain(self, plain: bytes):
        with self.lock:
            self.conn.close()
            self.conn = sqlite3.connect(":memory:", check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA foreign_keys=ON")
            self.conn.deserialize(plain)
            self.persist()

    def close(self):
        with self.lock:
            self.persist(); self.conn.close()
