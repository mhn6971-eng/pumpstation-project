"""Offline send queue for Bale/Eitaa. Retries every 5 minutes for up to 24 hours.
No file is lost when the network is unavailable; items can be canceled manually.
"""
import datetime, mimetypes
from pathlib import Path
import requests
from .jalali import now_j_str, now
from .config import QUEUE_RETRY_SECONDS, QUEUE_MAX_AGE_SECONDS

def enqueue(db, kind, file_path, channel_key, report_id=None):
    return db.run("INSERT INTO send_queue(created_at,kind,report_id,file_path,channel_key,status,next_retry_at) VALUES(?,?,?,?,?,'pending',?)",
                  (now_j_str(), kind, report_id, str(file_path), channel_key, now_j_str()))

def _send_bale(token, chat_id, path, caption):
    url = f"https://tapi.bale.ai/bot{token}/sendDocument"
    with open(path,'rb') as f:
        r = requests.post(url, data={"chat_id": chat_id, "caption": caption}, files={"document": (Path(path).name, f, "application/pdf")}, timeout=30)
    r.raise_for_status(); data = r.json()
    if not data.get('ok'): raise RuntimeError(str(data))
    return data

def _send_eitaa(token, chat_id, path, caption):
    url = f"https://eitaayar.ir/api/{token}/sendFile"
    with open(path,'rb') as f:
        r = requests.post(url, data={"chat_id": chat_id, "caption": caption}, files={"file": (Path(path).name, f, "application/pdf")}, timeout=30)
    r.raise_for_status(); data = r.json()
    if not data.get('ok'): raise RuntimeError(str(data))
    return data

def send_file(db, channel_key, path, caption=""):
    ch = db.one("SELECT * FROM channels WHERE key=?", (channel_key,))
    if not ch or not ch['enabled'] or not ch['token'] or not ch['chat_id']:
        raise RuntimeError('کانال ارسال تنظیم یا فعال نشده است')
    if ch['provider'] == 'eitaa': return _send_eitaa(ch['token'], ch['chat_id'], path, caption)
    return _send_bale(ch['token'], ch['chat_id'], path, caption)

def process_queue(db):
    items = db.query("SELECT * FROM send_queue WHERE status='pending' ORDER BY id")
    for item in items:
        # Retry window is counted by attempts so Jalali timestamps never need to
        # be parsed as Gregorian calendar dates.
        if item['attempts'] >= int(QUEUE_MAX_AGE_SECONDS / QUEUE_RETRY_SECONDS):
            db.run("UPDATE send_queue SET status='expired',last_error=? WHERE id=?", ('بیش از ۲۴ ساعت تلاش ناموفق', item['id'])); continue
        try:
            send_file(db, item['channel_key'], item['file_path'], 'گزارش ایستگاه پمپاژ زیرزمینی')
            db.run("UPDATE send_queue SET status='sent',sent_at=?,attempts=attempts+1 WHERE id=?", (now_j_str(), item['id']))
        except Exception as e:
            db.run("UPDATE send_queue SET attempts=attempts+1,last_error=?,next_retry_at=? WHERE id=?", (str(e)[:500], now_j_str(), item['id']))

def queue_summary(db):
    rows = db.query("SELECT status, COUNT(*) n FROM send_queue GROUP BY status")
    return {r['status']: r['n'] for r in rows}
