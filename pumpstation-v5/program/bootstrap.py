"""Windows-friendly local bootstrap. ASCII console messages only.
Creates .venv, installs dependencies from wheels/ if present, otherwise from PyPI,
applies staged offline updates, then starts the local-only Flask app.
"""
import os
import sys
import subprocess
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG = ROOT / "setup.log"
VENV = ROOT / ".venv"
IS_WIN = os.name == "nt"
VENV_PY = VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")
REQ = ROOT / "requirements.txt"
WHEELS = ROOT / "wheels"
HOST = "127.0.0.1"
PORT = 8000


def say(text=""):
    print(text, flush=True)
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(str(text) + "\n")
    except OSError:
        pass


def run(cmd):
    say("> " + " ".join(str(x) for x in cmd))
    try:
        proc = subprocess.Popen(
            [str(x) for x in cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"Command not found: {cmd[0]}") from exc
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end="", flush=True)
        try:
            with LOG.open("a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"Command failed with exit code {code}: {' '.join(str(x) for x in cmd)}")


def main():
    try:
        with LOG.open("w", encoding="utf-8") as f:
            f.write("Pumpstation V5 setup log\n")
    except OSError:
        pass
    say("Pumpstation V5 local setup")
    say(f"Program folder: {ROOT}")
    if sys.version_info < (3, 10):
        say("ERROR: Python 3.10 or newer is required. Python 3.11 is recommended.")
        return 1
    if not REQ.exists():
        say(f"ERROR: requirements.txt not found next to bootstrap.py: {REQ}")
        return 1
    if not VENV_PY.exists():
        say("Creating local Python environment (.venv)...")
        run([sys.executable, "-m", "venv", str(VENV)])
    if not VENV_PY.exists():
        say("ERROR: .venv was created but Python executable was not found.")
        return 1
    say("Checking pip...")
    run([VENV_PY, "-m", "pip", "--version"])
    offline = WHEELS.exists() and any(WHEELS.glob("*.whl"))
    if offline:
        say("Installing dependencies from local wheels folder (offline)...")
        run([VENV_PY, "-m", "pip", "install", "--no-index", "--find-links", str(WHEELS), "-r", str(REQ)])
    else:
        say("Installing dependencies from PyPI. Internet is needed for this first step.")
        say("If this station is offline, run prepare-offline.bat on an internet-connected PC,")
        say("then copy the generated wheels folder next to bootstrap.py and run start.bat again.")
        run([VENV_PY, "-m", "pip", "install", "-r", str(REQ)])
    updates = ROOT.parent / "data" / "updates"
    if updates.exists() and any(updates.glob("*.zip")):
        say("Applying staged offline update...")
        run([VENV_PY, str(ROOT / "apply_update.py")])
    say("Starting local server. Browser will open automatically.")
    say(f"Address: http://{HOST}:{PORT}")
    say("Keep this window open while using the program. Close it to stop the server.")
    threading.Timer(2.5, lambda: webbrowser.open(f"http://{HOST}:{PORT}")).start()
    os.chdir(ROOT)
    return subprocess.call([str(VENV_PY), str(ROOT / "app.py"), "--host", HOST, "--port", str(PORT)])


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        say("Stopped by user.")
        sys.exit(0)
    except Exception as exc:
        say(f"ERROR: {exc}")
        say("See setup.log in the program folder for details.")
        sys.exit(1)
