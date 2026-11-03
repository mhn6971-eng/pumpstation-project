"""Encrypted full snapshots + always-up-to-date catalog mirror.
Daily backups keep the newest 30. Catalog files are not duplicated 30 times;
they live in data/catalogs and are mirrored to data/catalogs-mirror on change.
"""
import io, json, zipfile, shutil, hashlib
from pathlib import Path
from . import security
from .config import DATA_DIR, DB_FILE, BACKUP_DIR, ARCHIVE_DIR, REPORT_DIR, QUEUE_DIR, CATALOG_DIR, CATALOG_MIRROR_DIR, SECURITY_FILE, BACKUP_KEEP
from .jalali import date_j_str, now_j_str, today_j

def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def mirror_catalogs():
    CATALOG_MIRROR_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for p in sorted(CATALOG_DIR.glob('*')):
        if p.is_file():
            dst = CATALOG_MIRROR_DIR / p.name
            if not dst.exists() or _sha(p) != _sha(dst): shutil.copy2(p, dst)
            manifest[p.name] = {"size": p.stat().st_size, "sha256": _sha(p)}
    for old in CATALOG_MIRROR_DIR.glob('*'):
        if old.is_file() and old.name not in manifest and old.name != 'manifest.json': old.unlink()
    (CATALOG_MIRROR_DIR / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest

def create_backup(db, key, reason="manual"):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = date_j_str().replace('/', '-')
    existing = sorted(BACKUP_DIR.glob(f"backup-{stamp}-*.zip.enc"))
    name = f"backup-{stamp}-{len(existing)+1:02d}-{reason}.zip.enc"
    path = BACKUP_DIR / name
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('pumpstation.db', db.conn.serialize())
        if SECURITY_FILE.exists(): z.write(SECURITY_FILE, 'security.json')
        for folder, prefix in ((REPORT_DIR,'reports'), (ARCHIVE_DIR,'archive'), (QUEUE_DIR,'queue')):
            for p in sorted(folder.rglob('*')):
                if p.is_file(): z.write(p, f"{prefix}/{p.relative_to(folder)}")
        z.writestr('manifest.json', json.dumps({"created_at": now_j_str(), "reason": reason, "schema_version": db.one("SELECT value FROM meta WHERE key='schema_version'")['value'], "catalogs": "data/catalogs-mirror"}, ensure_ascii=False, indent=2))
    security.atomic_write(path, security.encrypt_bytes(key, buf.getvalue()))
    prune_backups()
    db.run("INSERT OR REPLACE INTO settings(key,value) VALUES('last_backup_date',?)", (date_j_str(),))
    db.run("INSERT INTO activity_log(at,shift_label,action,detail) VALUES(?,?,?,?)", (now_j_str(), "سیستم", "بک‌آپ", name))
    return path

def prune_backups():
    files = sorted(BACKUP_DIR.glob('backup-*.zip.enc'), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[BACKUP_KEEP:]: old.unlink()

def list_backups():
    out = []
    for p in sorted(BACKUP_DIR.glob('*.zip.enc'), key=lambda p: p.stat().st_mtime, reverse=True):
        out.append({"name": p.name, "size": p.stat().st_size, "modified": p.stat().st_mtime})
    return out

def ensure_daily_backup(db, key):
    today = date_j_str()
    last = db.one("SELECT value FROM settings WHERE key='last_backup_date'")
    if not last or last['value'] != today:
        return create_backup(db, key, reason='auto')
    return None

def restore_backup(db, key, filename):
    path = BACKUP_DIR / Path(filename).name
    if not path.exists(): raise ValueError('فایل بک‌آپ پیدا نشد')
    # Safety backup before destructive restore.
    create_backup(db, key, reason='pre-restore')
    plain = security.decrypt_bytes(key, path.read_bytes())
    with zipfile.ZipFile(io.BytesIO(plain)) as z:
        if 'pumpstation.db' not in z.namelist(): raise ValueError('بک‌آپ معتبر نیست')
        db.replace_from_plain(z.read('pumpstation.db'))
        for folder, prefix in ((REPORT_DIR,'reports'), (ARCHIVE_DIR,'archive'), (QUEUE_DIR,'queue')):
            for info in z.infolist():
                if info.filename.startswith(prefix + '/') and not info.is_dir():
                    rel = Path(info.filename).relative_to(prefix)
                    target = folder / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(info))
    db.run("INSERT INTO activity_log(at,shift_label,action,detail) VALUES(?,?,?,?)", (now_j_str(), "سیستم", "بازیابی بک‌آپ", path.name))
    return True

def create_monthly_archive(db, key, year, month):
    from .jalali import month_days, parse_j
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    start = f"{year:04d}/{month:02d}/01"; end = f"{year:04d}/{month:02d}/{month_days(year,month):02d}"
    data = {
        "year": year, "month": month, "from": start, "to": end, "created_at": now_j_str(),
        "process_values": db.query("SELECT * FROM process_values WHERE date BETWEEN ? AND ?", (start,end)),
        "daily_totals": db.query("SELECT * FROM daily_totals WHERE date BETWEEN ? AND ?", (start,end)),
        "motor_values": db.query("SELECT * FROM motor_values WHERE date BETWEEN ? AND ?", (start,end)),
        "motor_services": db.query("SELECT * FROM motor_services WHERE date BETWEEN ? AND ?", (start,end)),
        "megger_tests": db.query("SELECT * FROM megger_tests WHERE date BETWEEN ? AND ?", (start,end)),
        "oil_changes": db.query("SELECT * FROM oil_changes WHERE date BETWEEN ? AND ?", (start,end)),
        "maintenance": db.query("SELECT * FROM maintenance WHERE date BETWEEN ? AND ?", (start,end)),
        "alerts": db.query("SELECT * FROM alerts WHERE date BETWEEN ? AND ?", (start,end)),
        "schedule": db.query("SELECT * FROM schedule WHERE date BETWEEN ? AND ?", (start,end)),
        "operator_reports": db.query("SELECT * FROM operator_reports WHERE date BETWEEN ? AND ?", (start,end)),
        "latest_megger_before_month": db.query("SELECT m.* FROM megger_tests m JOIN (SELECT motor_id, MAX(date) md FROM megger_tests WHERE date < ? GROUP BY motor_id) x ON x.motor_id=m.motor_id AND x.md=m.date", (start,)),
        "latest_oil_before_month": db.query("SELECT o.* FROM oil_changes o JOIN (SELECT motor_id, MAX(date) md FROM oil_changes WHERE date < ? GROUP BY motor_id) x ON x.motor_id=o.motor_id AND x.md=o.date", (start,)),
    }
    name = f"archive-{year:04d}-{month:02d}.json.enc"
    path = ARCHIVE_DIR / name
    security.atomic_write(path, security.encrypt_bytes(key, json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')))
    db.run("INSERT OR REPLACE INTO monthly_archives(year,month,filename,path,created_at) VALUES(?,?,?,?,?)", (year,month,name,str(path),now_j_str()))
    return path

def ensure_monthly_archive(db, key):
    t = today_j(); y,m = t.year,t.month
    if m == 1: y,m = y-1,12
    else: m -= 1
    keyv = f"{y:04d}/{m:02d}"
    last = db.one("SELECT value FROM settings WHERE key='last_archive_month'")
    if last and last['value'] == keyv: return None
    if db.one("SELECT id FROM monthly_archives WHERE year=? AND month=?", (y,m)): 
        db.run("INSERT OR REPLACE INTO settings(key,value) VALUES('last_archive_month',?)", (keyv,)); return None
    p = create_monthly_archive(db,key,y,m)
    db.run("INSERT OR REPLACE INTO settings(key,value) VALUES('last_archive_month',?)", (keyv,))
    return p
