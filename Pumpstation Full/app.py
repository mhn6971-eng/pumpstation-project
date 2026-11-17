# -*- coding: utf-8 -*-
"""پمپاژ زیرزمینی — سامانه ثبت و پایش تجهیزات (نسخه شیفتی + شمسی + PLC)"""
import io, os, re, sqlite3, datetime
import jdatetime
from flask import Flask, jsonify, request, send_file, send_from_directory, g, session

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "pumpstation.db")
app = Flask(__name__, static_folder="static", static_url_path="")
app.secret_key = "pumpstation-underground-secret"

# ---------------- Database ----------------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db

@app.teardown_appcontext
def close_db(exc):
    d = g.pop("db", None)
    if d: d.close()

SCHEMA = """
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  spec TEXT DEFAULT '',
  pm_interval_days INTEGER DEFAULT 90,
  location TEXT DEFAULT '',
  qty INTEGER DEFAULT 1,
  manufacturer TEXT DEFAULT '',
  plate TEXT DEFAULT '',
  catalog_no TEXT DEFAULT '',
  order_no TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  date TEXT NOT NULL,              -- 1404/08/09 (jalali)
  time TEXT DEFAULT '',
  temp REAL, current REAL, voltage REAL, hours REAL, pressure REAL,
  note TEXT DEFAULT '', operator TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  date TEXT NOT NULL,              -- jalali
  type TEXT NOT NULL DEFAULT 'PM',
  description TEXT DEFAULT '',
  operator TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  shift TEXT NOT NULL,             -- A / B / C
  pin TEXT DEFAULT '1234',
  role TEXT DEFAULT 'operator'
);
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,              -- jalali
  type TEXT NOT NULL,              -- leave / swap
  replacement_id INTEGER REFERENCES users(id),
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS plc_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT DEFAULT 'PLC',
  ts TEXT NOT NULL,                -- 1404-08-09 12:00
  temp REAL, current REAL, voltage REAL, pressure REAL
);
CREATE TABLE IF NOT EXISTS daily_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,              -- jalali
  shift TEXT NOT NULL,
  operator TEXT DEFAULT '',
  pumps_on TEXT DEFAULT '',        -- مثل: P-01,P-03,P-05
  flow REAL, total_flow REAL, suction REAL, discharge REAL, tank_inlet REAL,
  surge_tank1 REAL, surge_tank2 REAL,
  utility TEXT DEFAULT '', cooling TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
"""

def _load_equipment_seed():
    import json, os
    path = os.path.join(os.path.dirname(__file__), "equipment_seed.json")
    items = json.load(open(path, encoding="utf-8"))
    out = []
    for tag, name, cat, spec, loc, qty, pm in items:
        if ".." in tag:  # مثل P-01..P-08 -> 8 ردیف مجزا
            m = re.match(r"^(.*?)(\d+)$", tag.split("..")[0])
            prefix, start = m.group(1), int(m.group(2))
            m2 = re.match(r"^(.*?)(\d+)$", tag.split("..")[1])
            end = int(m2.group(2))
            width = len(tag.split("..")[0].split(prefix)[1]) if prefix else 2
            for i in range(start, end + 1):
                t = f"{prefix}{str(i).zfill(width)}"
                out.append((t, f"{name} — {t}", cat, spec, loc, 1, pm))
        elif "," in tag:  # مثل CMP-1,CMP-2
            for t in tag.split(","):
                out.append((t.strip(), f"{name} — {t.strip()}", cat, spec, loc, 1, pm))
        else:
            out.append((tag, name, cat, spec, loc, qty, pm))
    return out

EQUIPMENT_SEED = _load_equipment_seed()

# نام‌های نمونهٔ ساختگی (حریم خصوصی: نام واقعی اپراتورها از کد عمومی حذف شد)
USERS_SEED = [
    ("اپراتور نمونه ۱", "A"), ("اپراتور نمونه ۲", "A"),
    ("اپراتور نمونه ۳", "B"), ("اپراتور نمونه ۴", "B"),
    ("اپراتور نمونه ۵", "C"), ("اپراتور نمونه ۶", "C"),
]

def init_db():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    # migration: ستون‌های جدید پرونده تجهیزات
    cols = [r[1] for r in con.execute("PRAGMA table_info(equipment)")]
    for c in ("location", "qty", "manufacturer", "plate", "catalog_no", "order_no", "notes"):
        if c not in cols:
            con.execute(f"ALTER TABLE equipment ADD COLUMN {c} TEXT DEFAULT ''")
    cols = [r[1] for r in con.execute("PRAGMA table_info(daily_log)")]
    if "total_flow" not in cols:
        con.execute("ALTER TABLE daily_log ADD COLUMN total_flow REAL")
    if con.execute("SELECT COUNT(*) FROM equipment").fetchone()[0] != len(EQUIPMENT_SEED):
        con.execute("DELETE FROM equipment")
        for tag, name, cat, spec, loc, qty, pm in EQUIPMENT_SEED:
            con.execute("INSERT INTO equipment(tag,name,category,spec,pm_interval_days,location,qty) "
                        "VALUES(?,?,?,?,?,?,?)", (tag, name, cat, spec, pm, loc, qty))
    if con.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        for name, shift in USERS_SEED:
            con.execute("INSERT INTO users(name,shift,pin) VALUES(?,?,?)", (name, shift, "1234"))
    con.commit(); con.close()

# ---------------- jalali helpers ----------------
def jtoday():
    return jdatetime.date.today().strftime("%Y/%m/%d")

def jalali_to_gdate(s):
    y, m, d = [int(x) for x in s.split("/")[:3]]
    return jdatetime.date(y, m, d).togregorian()

def gdate_to_jalali(gd):
    jd = jdatetime.date.fromgregorian(date=gd)
    return jd.strftime("%Y/%m/%d")

# ---------------- auth ----------------
@app.route("/api/me")
def api_me():
    uid = session.get("uid")
    if not uid: return jsonify(None)
    r = db().execute("SELECT id,name,shift,role FROM users WHERE id=?", (uid,)).fetchone()
    return jsonify(dict(r) if r else None)

@app.route("/api/login", methods=["POST"])
def api_login():
    d = request.json or {}
    r = db().execute("SELECT * FROM users WHERE id=? AND pin=?", (d.get("user_id"), d.get("pin",""))).fetchone()
    if not r: return jsonify({"error": "نام کاربر یا رمز درست نیست"}), 401
    session["uid"] = r["id"]
    return jsonify({"ok": True})

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("uid", None)
    return jsonify({"ok": True})

@app.route("/api/users")
def api_users():
    rows = db().execute("SELECT id,name,shift FROM users ORDER BY shift,name").fetchall()
    return jsonify([dict(r) for r in rows])

# ---------------- pages ----------------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

# ---------------- equipment & readings ----------------
@app.route("/api/equipment")
def api_equipment():
    s = request.args.get("q", "").strip()
    cat = request.args.get("category", "").strip()
    q = "SELECT * FROM equipment WHERE 1=1"
    args = []
    if s:
        q += " AND (tag LIKE ? OR name LIKE ? OR location LIKE ? OR plate LIKE ? OR catalog_no LIKE ? OR order_no LIKE ?)"
        args += [f"%{s}%"] * 6
    if cat:
        q += " AND category=?"; args.append(cat)
    q += " ORDER BY id"
    return jsonify([dict(r) for r in db().execute(q, args).fetchall()])

@app.route("/api/equipment/<int:eid>")
def api_equipment_one(eid):
    r = db().execute("SELECT * FROM equipment WHERE id=?", (eid,)).fetchone()
    if not r: return jsonify({"error": "یافت نشد"}), 404
    eq = dict(r)
    eq["maintenance"] = [dict(x) for x in db().execute(
        "SELECT * FROM maintenance WHERE equipment_id=? ORDER BY date DESC, id DESC", (eid,)).fetchall()]
    eq["readings"] = [dict(x) for x in db().execute(
        "SELECT * FROM readings WHERE equipment_id=? ORDER BY date DESC, id DESC LIMIT 50", (eid,)).fetchall()]
    return jsonify(eq)

@app.route("/api/equipment/<int:eid>", methods=["PUT"])
def api_equipment_update(eid):
    d = request.json or {}
    fields = ["manufacturer", "plate", "catalog_no", "order_no", "notes", "location", "spec", "pm_interval_days"]
    sets, args = [], []
    for f in fields:
        if f in d:
            sets.append(f"{f}=?"); args.append(d[f])
    if sets:
        args.append(eid)
        db().execute(f"UPDATE equipment SET {', '.join(sets)} WHERE id=?", args)
        db().commit()
    return jsonify({"ok": True})

@app.route("/api/readings")
def api_readings():
    q = "SELECT r.*, e.tag, e.name FROM readings r JOIN equipment e ON e.id=r.equipment_id"
    conds, args = [], []
    if request.args.get("equipment_id"):
        conds.append("r.equipment_id=?"); args.append(request.args["equipment_id"])
    if request.args.get("from"):
        conds.append("r.date>=?"); args.append(request.args["from"])
    if request.args.get("to"):
        conds.append("r.date<=?"); args.append(request.args["to"])
    if conds: q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY r.date DESC, r.id DESC LIMIT ?"
    args.append(min(int(request.args.get("limit", 200)), 1000))
    return jsonify([dict(r) for r in db().execute(q, args).fetchall()])

@app.route("/api/readings", methods=["POST"])
def add_reading():
    d = request.json or {}
    if not d.get("equipment_id"): return jsonify({"error": "تجهیز را انتخاب کنید"}), 400
    if not d.get("date"): return jsonify({"error": "تاریخ را وارد کنید"}), 400
    if all(d.get(k) in (None, "") for k in ("temp","current","voltage","hours","pressure")):
        return jsonify({"error": "حداقل یک مقدار (دما/جریان/ولتاژ/ساعت کارکرد/فشار) وارد کنید"}), 400
    cur = db().execute(
        "INSERT INTO readings(equipment_id,date,time,temp,current,voltage,hours,pressure,note,operator) "
        "VALUES(?,?,?,?,?,?,?,?,?,?)",
        (d.get("equipment_id"), d.get("date"), d.get("time") or "",
         d.get("temp") or None, d.get("current") or None, d.get("voltage") or None,
         d.get("hours") or None, d.get("pressure") or None,
         d.get("note") or "", d.get("operator") or ""))
    db().commit()
    return jsonify({"ok": True, "id": cur.lastrowid})

@app.route("/api/readings/<int:rid>", methods=["DELETE"])
def del_reading(rid):
    db().execute("DELETE FROM readings WHERE id=?", (rid,)); db().commit()
    return jsonify({"ok": True})

# ---------------- maintenance ----------------
@app.route("/api/maintenance")
def api_maint():
    q = "SELECT m.*, e.tag, e.name FROM maintenance m JOIN equipment e ON e.id=m.equipment_id ORDER BY m.date DESC, m.id DESC LIMIT 300"
    return jsonify([dict(r) for r in db().execute(q).fetchall()])

@app.route("/api/maintenance", methods=["POST"])
def add_maint():
    d = request.json or {}
    if not d.get("equipment_id") or not d.get("date"):
        return jsonify({"error": "تجهیز و تاریخ الزامی است"}), 400
    cur = db().execute(
        "INSERT INTO maintenance(equipment_id,date,type,description,operator) VALUES(?,?,?,?,?)",
        (d.get("equipment_id"), d.get("date"), d.get("type") or "PM",
         d.get("description") or "", d.get("operator") or ""))
    db().commit()
    return jsonify({"ok": True, "id": cur.lastrowid})

# ---------------- schedule (مرخصی / جابجایی) ----------------
@app.route("/api/schedule")
def api_schedule():
    q = """SELECT s.*, u.name AS user_name, u.shift AS user_shift, r.name AS replacement_name
           FROM schedule s JOIN users u ON u.id=s.user_id
           LEFT JOIN users r ON r.id=s.replacement_id
           ORDER BY s.date DESC, s.id DESC LIMIT 300"""
    return jsonify([dict(r) for r in db().execute(q).fetchall()])

@app.route("/api/schedule", methods=["POST"])
def add_schedule():
    d = request.json or {}
    if not d.get("user_id") or not d.get("date"):
        return jsonify({"error": "کاربر و تاریخ الزامی است"}), 400
    cur = db().execute(
        "INSERT INTO schedule(user_id,date,type,replacement_id,note) VALUES(?,?,?,?,?)",
        (d.get("user_id"), d.get("date"), d.get("type") or "leave",
         d.get("replacement_id") or None, d.get("note") or ""))
    db().commit()
    return jsonify({"ok": True, "id": cur.lastrowid})

@app.route("/api/schedule/<int:sid>", methods=["DELETE"])
def del_schedule(sid):
    db().execute("DELETE FROM schedule WHERE id=?", (sid,)); db().commit()
    return jsonify({"ok": True})

# ---------------- daily log ----------------
@app.route("/api/daily")
def api_daily():
    q = "SELECT * FROM daily_log ORDER BY date DESC, id DESC LIMIT 300"
    return jsonify([dict(r) for r in db().execute(q).fetchall()])

@app.route("/api/daily", methods=["POST"])
def add_daily():
    d = request.json or {}
    if not d.get("date") or not d.get("shift"):
        return jsonify({"error": "تاریخ و شیفت الزامی است"}), 400
    cur = db().execute(
        "INSERT INTO daily_log(date,shift,operator,pumps_on,flow,total_flow,suction,discharge,tank_inlet,"
        "surge_tank1,surge_tank2,utility,cooling,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (d.get("date"), d.get("shift"), d.get("operator") or "",
         ",".join(d.get("pumps_on") or []),
         d.get("flow") or None, d.get("total_flow") or None,
         d.get("suction") or None, d.get("discharge") or None,
         d.get("tank_inlet") or None, d.get("surge_tank1") or None, d.get("surge_tank2") or None,
         d.get("utility") or "", d.get("cooling") or "", d.get("note") or ""))
    db().commit()
    return jsonify({"ok": True, "id": cur.lastrowid})

@app.route("/api/daily/<int:did>", methods=["DELETE"])
def del_daily(did):
    db().execute("DELETE FROM daily_log WHERE id=?", (did,)); db().commit()
    return jsonify({"ok": True})


@app.route("/api/daily/monthly")
def api_daily_monthly():
    y = int(request.args.get("jyear", jdatetime.date.today().year))
    m = int(request.args.get("jmonth", jdatetime.date.today().month))
    ndays = 30 if m <= 6 else (29 if m == 12 and not jdatetime.date(y, 12, 1).isleap() else 29 if m == 12 else 30)
    # ماه‌های ۷ تا ۱۱ سی روزه، اسفند ۲۹ یا ۳۰
    if 7 <= m <= 11: ndays = 30
    if m == 12:
        jd = jdatetime.date(y, 12, 1)
        ndays = 30 if jd.isleap() else 29
    rows = db().execute(
        "SELECT date, SUM(COALESCE(total_flow, flow)) AS tf FROM daily_log WHERE date LIKE ? GROUP BY date",
        (f"{y}/{m:02d}/%",)).fetchall()
    by_day = {}
    for date, tf in rows:
        try:
            by_day[int(date.split("/")[2])] = tf or 0
        except Exception:
            pass
    out, cum = [], 0
    for d in range(1, ndays + 1):
        tf = by_day.get(d)
        if tf: cum += tf
        out.append({"day": d, "date": f"{y}/{m:02d}/{d:02d}", "flow": tf, "cum": cum if tf else None})
    total = sum(v for v in by_day.values() if v)
    return jsonify({"jyear": y, "jmonth": m, "days": ndays, "rows": out, "total": total})

# ---------------- PLC import & chart ----------------
@app.route("/api/plc/import", methods=["POST"])
def plc_import():
    f = request.files.get("file")
    if not f: return jsonify({"error": "فایلی انتخاب نشده"}), 400
    tag = request.form.get("tag") or "PLC"
    import pandas as pd
    try:
        if f.filename.lower().endswith(".csv"):
            df = pd.read_csv(f)
        else:
            df = pd.read_excel(f)
    except Exception as ex:
        return jsonify({"error": f"خواندن فایل ممکن نشد: {ex}"}), 400
    if df.empty: return jsonify({"error": "فایل خالی است"}), 400
    # تشخیص ستون زمان
    time_col = None
    for c in df.columns:
        if any(k in str(c).lower() for k in ("time", "date", "زمان", "تاریخ", "ساعت")):
            time_col = c; break
    if time_col is None: time_col = df.columns[0]
    t = pd.to_datetime(df[time_col], errors="coerce")
    mask = t.notna()
    df, t = df[mask], t[mask]
    if df.empty: return jsonify({"error": "ستون زمان قابل خواندن نبود"}), 400
    # تشخیص ستون‌های مقادیر
    mapping = {}
    for c in df.columns:
        if c == time_col: continue
        cl = str(c).lower()
        if any(k in cl for k in ("temp", "دما", "deg")): mapping["temp"] = c
        elif any(k in cl for k in ("current", "amp", "جریان", "آمپر")): mapping["current"] = c
        elif any(k in cl for k in ("volt", "ولتاژ")): mapping["voltage"] = c
        elif any(k in cl for k in ("press", "فشار", "bar")): mapping["pressure"] = c
    if not mapping: return jsonify({"error": "ستون دما/جریان/ولتاژ/فشار پیدا نشد"}), 400
    work = pd.DataFrame({k: pd.to_numeric(df[c], errors="coerce") for k, c in mapping.items()})
    work.index = t
    # تجمیع دقیقه‌ای (میانگین) برای حجم کم
    m = work.resample("1min").mean().dropna(how="all")
    con = db()
    n = 0
    for ts, row in m.iterrows():
        con.execute("INSERT INTO plc_data(tag,ts,temp,current,voltage,pressure) VALUES(?,?,?,?,?,?)",
                    (tag, ts.strftime("%Y-%m-%d %H:%M"),
                     row.get("temp"), row.get("current"), row.get("voltage"), row.get("pressure")))
        n += 1
    con.commit()
    return jsonify({"ok": True, "rows": n, "columns": mapping,
                    "from": m.index.min().strftime("%Y-%m-%d %H:%M"),
                    "to": m.index.max().strftime("%Y-%m-%d %H:%M")})

@app.route("/api/plc")
def plc_data():
    """داده تجمیع‌شده: granularity = minute / hour / day"""
    gran = request.args.get("granularity", "hour")
    fmt = {"minute": "%Y-%m-%d %H:%M", "hour": "%Y-%m-%d %H:00", "day": "%Y-%m-%d"}[gran]
    conds, args = [], []
    if request.args.get("tag"): conds.append("tag=?"); args.append(request.args["tag"])
    if request.args.get("from"): conds.append("ts>=?"); args.append(request.args["from"])
    if request.args.get("to"): conds.append("ts<=?"); args.append(request.args["to"] + " 23:59")
    q = f"""SELECT strftime('{fmt}', ts) AS bucket,
              AVG(temp) temp, MAX(temp) temp_max, AVG(current) current, AVG(voltage) voltage,
              AVG(pressure) pressure, COUNT(*) n
            FROM plc_data {'WHERE ' + ' AND '.join(conds) if conds else ''}
            GROUP BY bucket ORDER BY bucket"""
    rows = [dict(r) for r in db().execute(q, args).fetchall()]
    tags = [r["tag"] for r in db().execute("SELECT DISTINCT tag FROM plc_data").fetchall()]
    return jsonify({"rows": rows, "tags": tags})

@app.route("/api/plc", methods=["DELETE"])
def plc_clear():
    db().execute("DELETE FROM plc_data"); db().commit()
    return jsonify({"ok": True})

# ---------------- dashboard ----------------
@app.route("/api/dashboard")
def api_dashboard():
    con = db()
    today_j = jtoday()
    pumps = con.execute("SELECT * FROM equipment WHERE category='pump' ORDER BY id").fetchall()
    last_readings = []
    for p in pumps:
        r = con.execute("SELECT * FROM readings WHERE equipment_id=? ORDER BY date DESC, id DESC LIMIT 1", (p["id"],)).fetchone()
        last_readings.append({"equipment": dict(p), "last": dict(r) if r else None})
    # نوبت PM — بر مبنای تاریخ شمسی
    pm_due = []
    for e_ in con.execute("SELECT * FROM equipment ORDER BY id").fetchall():
        m = con.execute("SELECT * FROM maintenance WHERE equipment_id=? AND type='PM' ORDER BY date DESC LIMIT 1", (e_["id"],)).fetchone()
        if m:
            due_g = jalali_to_gdate(m["date"]) + datetime.timedelta(days=e_["pm_interval_days"])
            days_left = (due_g - datetime.date.today()).days
            if days_left <= 15:
                pm_due.append({"equipment": dict(e_), "last_pm": m["date"],
                               "due": gdate_to_jalali(due_g), "days_left": days_left})
        else:
            pm_due.append({"equipment": dict(e_), "last_pm": None, "due": None, "days_left": None})
    pm_due.sort(key=lambda x: (x["days_left"] is None, x["days_left"] if x["days_left"] is not None else 0))
    from_g = datetime.date.today() - datetime.timedelta(days=30)
    from_j = gdate_to_jalali(from_g)
    stats = con.execute("""SELECT e.tag, COUNT(r.id) n, AVG(r.temp) t_avg, MAX(r.temp) t_max,
                           AVG(r.current) c_avg, AVG(r.voltage) v_avg, MAX(r.hours) h_max
                           FROM equipment e LEFT JOIN readings r
                           ON r.equipment_id=e.id AND r.date>=?
                           WHERE e.category='pump' GROUP BY e.id ORDER BY e.id""", (from_j,)).fetchall()
    counts = {
        "equipments": con.execute("SELECT COUNT(*) c FROM equipment").fetchone()["c"],
        "readings": con.execute("SELECT COUNT(*) c FROM readings").fetchone()["c"],
        "maintenances": con.execute("SELECT COUNT(*) c FROM maintenance").fetchone()["c"],
        "readings_month": con.execute("SELECT COUNT(*) c FROM readings WHERE date>=?", (from_j,)).fetchone()["c"],
    }
    return jsonify({"last_readings": last_readings, "pm_due": pm_due,
                    "stats": [dict(r) for r in stats], "counts": counts, "today": today_j})

# ---------------- monthly report (شمسی) ----------------
@app.route("/api/report")
def api_report():
    jy, jm = int(request.args.get("jyear")), int(request.args.get("jmonth"))
    start_jd = jdatetime.date(jy, jm, 1)
    if jm == 12:
        try: end_jd = jdatetime.date(jy, 12, 30 if start_jd.isleap() else 29)
        except ValueError: end_jd = jdatetime.date(jy, 12, 29)
    else:
        end_jd = jdatetime.date(jy, jm + 1, 1) - datetime.timedelta(days=1)
    from_j = start_jd.strftime("%Y/%m/%d"); to_j = end_jd.strftime("%Y/%m/%d")
    con = db()
    rows = con.execute("""SELECT r.*, e.tag, e.name FROM readings r JOIN equipment e ON e.id=r.equipment_id
                          WHERE r.date BETWEEN ? AND ? ORDER BY e.id, r.date""", (from_j, to_j)).fetchall()
    return jsonify({"from": from_j, "to": to_j, "rows": [dict(r) for r in rows]})

# ---------------- backup & export ----------------
@app.route("/api/backup")
def api_backup():
    db().commit()
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    buf = os.path.join("/tmp", f"pumpstation_backup_{stamp}.db")
    src = sqlite3.connect(DB); dst = sqlite3.connect(buf)
    src.backup(dst); dst.close(); src.close()
    return send_file(buf, as_attachment=True, download_name=f"pumpstation_backup_{stamp}.db")

@app.route("/api/export")
def api_export():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    con = db()
    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF", name="Vazirmatn")
    head_fill = PatternFill("solid", fgColor="16606B")
    def sheet(name, rows, cols):
        ws = wb.create_sheet(name); ws.rightToLeft = True
        for j, c in enumerate(cols, 1):
            cell = ws.cell(1, j, c); cell.font = head_font; cell.fill = head_fill
        for i, r in enumerate(rows, 2):
            for j, c in enumerate(cols, 1):
                ws.cell(i, j, r[c] if c in r.keys() else "")
        for j in range(1, len(cols) + 1):
            ws.column_dimensions[ws.cell(1, j).column_letter].width = 18
    wb.remove(wb.active)
    sheet("تجهیزات", con.execute("SELECT * FROM equipment").fetchall(),
          ["id","tag","name","category","spec","pm_interval_days"])
    sheet("رکوردها", con.execute("SELECT * FROM readings").fetchall(),
          ["id","equipment_id","date","time","temp","current","voltage","hours","pressure","note","operator"])
    sheet("تعمیرات", con.execute("SELECT * FROM maintenance").fetchall(),
          ["id","equipment_id","date","type","description","operator"])
    sheet("کاربران", con.execute("SELECT * FROM users").fetchall(), ["id","name","shift","role"])
    sheet("مرخصی-جابجایی", con.execute("SELECT * FROM schedule").fetchall(),
          ["id","user_id","date","type","replacement_id","note"])
    sheet("PLC", con.execute("SELECT * FROM plc_data").fetchall(),
          ["id","tag","ts","temp","current","voltage","pressure"])
    sheet("گزارش روزانه", con.execute("SELECT * FROM daily_log").fetchall(),
          ["id","date","shift","operator","pumps_on","flow","suction","discharge","tank_inlet",
           "surge_tank1","surge_tank2","utility","cooling","note"])
    out = io.BytesIO(); wb.save(out); out.seek(0)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    return send_file(out, as_attachment=True, download_name=f"pumpstation_export_{stamp}.xlsx")

# ---------------- demo ----------------
@app.route("/api/demo", methods=["POST"])
def seed_demo():
    """داده نمونه ۳۰ روز اخیر (شمسی) برای پمپ‌ها"""
    import random
    con = db()
    today_g = datetime.date.today()
    pumps = con.execute("SELECT id FROM equipment WHERE category='pump'").fetchall()
    base_h = {p["id"]: random.randint(4000, 12000) for p in pumps}
    for d in range(29, -1, -1):
        day_j = gdate_to_jalali(today_g - datetime.timedelta(days=d))
        for p in pumps:
            if random.random() >= 0.9: continue
            base_h[p["id"]] += random.uniform(18, 24)
            con.execute("INSERT INTO readings(equipment_id,date,time,temp,current,voltage,hours,pressure,operator) VALUES(?,?,?,?,?,?,?,?,?)",
                        (p["id"], day_j, "12:00",
                         round(random.gauss(68, 4), 1), round(random.gauss(205, 8), 1),
                         round(random.gauss(6300, 60), 0), round(base_h[p["id"]], 1),
                         round(random.gauss(9.2, 0.3), 2), "داده نمونه"))
    con.commit()
    return jsonify({"ok": True})

@app.route("/api/demo", methods=["DELETE"])
def clear_demo():
    con = db()
    con.execute("DELETE FROM readings WHERE operator LIKE '%نمونه%' OR operator=''")
    con.commit()
    return jsonify({"ok": True})

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=8000, debug=False)
