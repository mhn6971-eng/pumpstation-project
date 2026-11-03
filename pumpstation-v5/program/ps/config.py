from pathlib import Path
import os

PROGRAM_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = PROGRAM_DIR.parent
DATA_DIR = Path(os.environ.get("PUMPSTATION_DATA_DIR", ROOT_DIR / "data")).resolve()
DB_FILE = DATA_DIR / "pumpstation.db.enc"
SECURITY_FILE = DATA_DIR / "security.json"
BACKUP_DIR = DATA_DIR / "backups"
ARCHIVE_DIR = DATA_DIR / "archive"
REPORT_DIR = DATA_DIR / "reports"
CATALOG_DIR = DATA_DIR / "catalogs"
CATALOG_MIRROR_DIR = DATA_DIR / "catalogs-mirror"
QUEUE_DIR = DATA_DIR / "queue"
UPDATE_DIR = DATA_DIR / "updates"
LOGO_FILE = PROGRAM_DIR / "static" / "logo.png"
FONT_REGULAR = PROGRAM_DIR / "static" / "fonts" / "Vazirmatn-Regular.ttf"
FONT_BOLD = PROGRAM_DIR / "static" / "fonts" / "Vazirmatn-Bold.ttf"
APP_NAME = "سامانه پایش ایستگاه پمپاژ زیرزمینی"
ORG_NAME = "آب منطقه‌ای اصفهان"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
BACKUP_KEEP = 30
QUEUE_RETRY_SECONDS = 300
QUEUE_MAX_AGE_SECONDS = 24 * 3600

for d in (DATA_DIR, BACKUP_DIR, ARCHIVE_DIR, REPORT_DIR, CATALOG_DIR, CATALOG_MIRROR_DIR, QUEUE_DIR, UPDATE_DIR):
    d.mkdir(parents=True, exist_ok=True)
