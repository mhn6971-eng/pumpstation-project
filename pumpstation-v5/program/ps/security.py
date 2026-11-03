"""Master-password key derivation and AES-256-GCM file encryption.
No master password or raw key is ever written to disk.
"""
import base64, json, os, hmac, hashlib
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from .config import SECURITY_FILE

MAGIC = b"PSV5"
ITERATIONS = 600_000

def _b64e(b): return base64.b64encode(b).decode("ascii")
def _b64d(s): return base64.b64decode(s.encode("ascii"))

def derive_key(password: str, salt: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode("utf-8"))

def encrypt_bytes(key: bytes, plain: bytes, aad: bytes = MAGIC) -> bytes:
    nonce = os.urandom(12)
    return MAGIC + nonce + AESGCM(key).encrypt(nonce, plain, aad)

def decrypt_bytes(key: bytes, blob: bytes, aad: bytes = MAGIC) -> bytes:
    if not blob.startswith(MAGIC): raise ValueError("فایل رمزنگاری‌شده معتبر نیست")
    return AESGCM(key).decrypt(blob[4:16], blob[16:], aad)

def encrypt_file(key: bytes, src: Path, dst: Path):
    dst.write_bytes(encrypt_bytes(key, Path(src).read_bytes()))

def decrypt_file(key: bytes, src: Path, dst: Path):
    Path(dst).write_bytes(decrypt_bytes(key, Path(src).read_bytes()))

def atomic_write(path: Path, data: bytes):
    path = Path(path); tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data); os.replace(tmp, path)

def setup_master(password: str, path: Path = SECURITY_FILE):
    if len(password or "") < 8: raise ValueError("رمز اصلی باید حداقل ۸ نویسه باشد")
    salt = os.urandom(16); key = derive_key(password, salt)
    verifier = encrypt_bytes(key, b"pumpstation-v5-verifier")
    doc = {"version": 1, "kdf": "PBKDF2-HMAC-SHA256", "iterations": ITERATIONS,
           "salt": _b64e(salt), "verifier": _b64e(verifier),
           "warning": "این رمز را چاپ کنید و فیزیکی نگهداری کنید. گم شدن آن یعنی بک‌آپ‌های رمزنگاری‌شده قابل بازیابی نیستند."}
    atomic_write(Path(path), json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"))
    return key

def load_master_info(path: Path = SECURITY_FILE):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

def unlock_master(password: str, path: Path = SECURITY_FILE) -> bytes:
    info = load_master_info(path)
    if not info: raise ValueError("رمز اصلی هنوز تنظیم نشده است")
    key = derive_key(password, _b64d(info["salt"]))
    try:
        plain = decrypt_bytes(key, _b64d(info["verifier"]))
    except Exception:
        raise ValueError("رمز اصلی اشتباه است")
    if plain != b"pumpstation-v5-verifier": raise ValueError("رمز اصلی اشتباه است")
    return key

def session_secret(key: bytes) -> bytes:
    return hmac.new(key, b"pumpstation-v5-session", hashlib.sha256).digest()
