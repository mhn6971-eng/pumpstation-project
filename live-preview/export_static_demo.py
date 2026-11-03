#!/usr/bin/env python3
"""Build a browser-only GitHub Pages demo from isolated sample data.

The output reuses the real V5 frontend, but replaces the Flask API with a
small in-browser sample adapter. No station database, credentials, messenger
tokens, or personal names are exported. The station package is not modified.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DOCS = ROOT / "docs"
PROGRAM = ROOT / "pumpstation-v5" / "program"
sys.path.insert(0, str(HERE))

from run_preview import build_app  # noqa: E402
from ps.jalali import date_j_str, shift_day  # noqa: E402
from ps.seed import MOTOR_PARAMS, PROCESS_PARAMS  # noqa: E402


def clean_report(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "date", "shift_label", "kind", "filename", "created_at", "corrected_from")}


def main() -> None:
    app, data_dir = build_app()
    db = app.extensions["ps_db"]
    c = app.test_client()
    assert c.post("/api/login", json={"group": "admin", "pin": "9999"}).status_code == 200

    def get(path: str):
        r = c.get(path)
        if r.status_code != 200:
            raise RuntimeError(f"GET {path} -> {r.status_code}: {r.get_data(as_text=True)[:200]}")
        return r.get_json()

    dashboard = get("/api/dashboard")
    today = dashboard["date"]
    y, m, _ = today.split("/")
    snapshot = {
        "demo": True,
        "version": dashboard["version"],
        "dashboard": dashboard,
        "motors": {str(i): get(f"/api/motors/{i}") for i in range(1, 9)},
        "aux": get("/api/aux"),
        "categories": get("/api/categories"),
        "equipment": get("/api/equipment"),
        "training": get("/api/training"),
        "problems": get("/api/problems"),
        "alerts": get("/api/alerts"),
        "roster": get("/api/roster"),
        "schedule": get("/api/schedule"),
        "operator_report": get("/api/operator-report"),
        "pm_templates": get("/api/pm-templates"),
        "maintenance": get("/api/maintenance"),
        "monthly": get(f"/api/total/monthly?year={y}&month={m}"),
        "process_history": {},
        "motor_history": {},
        "admin": {
            "status": get("/api/admin/status"),
            "setpoints": get("/api/admin/setpoints"),
            "groups": get("/api/admin/groups"),
            "channels": get("/api/admin/channels"),
            "queue": get("/api/admin/queue"),
            "backups": get("/api/admin/backups"),
            "activity": get("/api/admin/activity"),
            "errors": [],
            "archives": get("/api/admin/archives"),
            "changelog": get("/api/admin/changelog"),
        },
    }
    snapshot["admin"]["status"]["data_dir"] = "حافظه موقت مرورگر شما"
    snapshot["admin"]["status"]["demo"] = True
    # Remove any internal filesystem paths from backup metadata.
    snapshot["admin"]["backups"] = [
        {k: b.get(k) for k in ("name", "size", "modified_at") if k in b}
        for b in snapshot["admin"]["backups"]
    ]
    for tag, _label, _unit in PROCESS_PARAMS:
        snapshot["process_history"][tag] = db.query(
            "SELECT date,interval_index,value,shift_label,edited FROM process_values WHERE param=? ORDER BY date,interval_index",
            (tag,),
        )
    for mid in range(1, 9):
        tag = f"M-{mid:02d}"
        snapshot["motor_history"][tag] = {}
        for param, _label, _unit in MOTOR_PARAMS:
            snapshot["motor_history"][tag][param] = db.query(
                "SELECT date,interval_index,value,shift_label,edited FROM motor_values WHERE motor_id=? AND param=? ORDER BY date,interval_index",
                (mid, param),
            )

    # Generate sample PDFs with anonymised demo data only.
    for kind, path in (
        ("daily", "/api/reports/daily"),
        ("aux", "/api/reports/aux"),
        ("registry", "/api/reports/registry"),
    ):
        r = c.post(path, json={"send": False})
        if r.status_code != 200:
            raise RuntimeError(f"POST {path} -> {r.status_code}")
    reports = get("/api/reports")
    snapshot["reports"] = [clean_report(r) for r in reports]

    if DOCS.exists():
        shutil.rmtree(DOCS)
    (DOCS / "static" / "fonts").mkdir(parents=True)
    static_src = PROGRAM / "static"
    for name in ("style.css", "app.js", "chart.umd.js"):
        shutil.copy2(static_src / name, DOCS / "static" / name)
    for name in ("Vazirmatn-Regular.ttf", "Vazirmatn-Bold.ttf"):
        shutil.copy2(static_src / "fonts" / name, DOCS / "static" / "fonts" / name)
    # Relative font URLs for GitHub Pages project subpath.
    css = (DOCS / "static" / "style.css").read_text(encoding="utf-8")
    css = css.replace("url('/static/fonts/", "url('./fonts/")
    (DOCS / "static" / "style.css").write_text(css, encoding="utf-8")
    shutil.copy2(HERE / "static" / "preview.css", DOCS / "static" / "preview.css")
    shutil.copy2(HERE / "static" / "preview.js", DOCS / "static" / "preview.js")

    pdf_files = {}
    for kind in ("daily", "aux", "registry"):
        row = next((r for r in reports if r["kind"] == kind or (kind == "daily" and r["kind"] == "daily-correction")), None)
        if row:
            src = Path(row["path"])
            dest = DOCS / "static" / f"sample-{kind}.pdf"
            shutil.copy2(src, dest)
            pdf_files[kind] = f"./static/sample-{kind}.pdf"
    snapshot["pdf_files"] = pdf_files

    (DOCS / "static" / "demo-data.js").write_text(
        "window.DEMO_SNAPSHOT=" + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    shutil.copy2(HERE / "static" / "demo-api.js", DOCS / "static" / "demo-api.js")
    shutil.copy2(HERE / "static" / "static-demo.js", DOCS / "static" / "static-demo.js")
    (DOCS / "static" / "static-demo.css").write_text(
        "#btn-logout{display:none}.demo-reset{margin-inline-start:8px}.demo-banner-row{flex-wrap:wrap}\n",
        encoding="utf-8",
    )

    html = (PROGRAM / "templates" / "index.html").read_text(encoding="utf-8")
    html = (
        html.replace("{{ app_name }}", "پیش‌نمایش سامانه پایش ایستگاه پمپاژ")
        .replace("{{ org }}", "آب منطقه‌ای اصفهان")
        .replace("{{ version }}", snapshot["version"])
        .replace('href="/static/', 'href="./static/')
        .replace('src="/static/', 'src="./static/')
    )
    html = html.replace(
        '<script src="./static/app.js"></script>',
        '<script src="./static/demo-data.js"></script>\n'
        '<script src="./static/demo-api.js"></script>\n'
        '<script src="./static/app.js"></script>\n'
        '<script src="./static/preview.js"></script>\n'
        '<script src="./static/static-demo.js"></script>',
    )
    html = html.replace(
        "</head>",
        '<link rel="stylesheet" href="./static/preview.css">\n'
        '<link rel="stylesheet" href="./static/static-demo.css">\n'
        '<meta name="robots" content="noindex">\n</head>',
    )
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    (DOCS / "README.md").write_text(
        "# Pumpstation V5 browser-only demo\n\n"
        "Public, persistent preview built from isolated sample data. "
        "It reuses the V5 frontend with an in-browser mock API. "
        "No real station data, credentials, or messenger sending.\n",
        encoding="utf-8",
    )
    print(f"Exported static demo to {DOCS}")
    print(f"Sample data directory (not exported): {data_dir}")
    print(f"Snapshot bytes: {(DOCS / 'static' / 'demo-data.js').stat().st_size}")


if __name__ == "__main__":
    main()
