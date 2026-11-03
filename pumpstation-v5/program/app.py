# -*- coding: utf-8 -*-
"""Golab underground pump station monitoring — Build Prompt V5.
Local-only Flask + encrypted SQLite. Run: python app.py  (binds 127.0.0.1 only)
"""
import os, io, json, math, shutil, hashlib, zipfile, datetime, threading, time, traceback, argparse
from pathlib import Path
from functools import wraps
from flask import Flask, request, jsonify, session, send_file, send_from_directory, render_template, redirect, url_for, g
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException
import jdatetime

from ps import __version__
from ps.config import *
from ps import security, backup as backup_mod, queue as queue_mod, pdf as pdf_mod
from ps.db import Database
from ps.jalali import *
from ps.seed import seed, PROCESS_PARAMS, MOTOR_PARAMS, CATEGORIES

STATUS_FA = {"ready":"آماده به کار","running":"در حال کار","repair":"در حال تعمیر","service":"در حال سرویس","in_warehouse":"در انبار (نصب نشده)"}
RUN_FA = {"on":"روشن","off":"خاموش"}
MOTOR_STATE_FA = {"on":"روشن","off":"خاموش/آماده","service":"در سرویس"}
INTERVAL_LABELS = [interval_label(i) for i in range(6)]

def create_app(data_dir=None, master_password=None, testing=False):
    global DATA_DIR, DB_FILE, SECURITY_FILE, BACKUP_DIR, ARCHIVE_DIR, REPORT_DIR, CATALOG_DIR, CATALOG_MIRROR_DIR, QUEUE_DIR, UPDATE_DIR
    if data_dir:
        DATA_DIR = Path(data_dir).resolve()
        DB_FILE = DATA_DIR / "pumpstation.db.enc"; SECURITY_FILE = DATA_DIR / "security.json"
        BACKUP_DIR = DATA_DIR / "backups"; ARCHIVE_DIR = DATA_DIR / "archive"; REPORT_DIR = DATA_DIR / "reports"
        CATALOG_DIR = DATA_DIR / "catalogs"; CATALOG_MIRROR_DIR = DATA_DIR / "catalogs-mirror"; QUEUE_DIR = DATA_DIR / "queue"; UPDATE_DIR = DATA_DIR / "updates"
        for d in (DATA_DIR,BACKUP_DIR,ARCHIVE_DIR,REPORT_DIR,CATALOG_DIR,CATALOG_MIRROR_DIR,QUEUE_DIR,UPDATE_DIR): d.mkdir(parents=True, exist_ok=True)
        # Rebind module-level paths used by helper modules.
        import ps.config as cfg, ps.backup as bm, ps.security as sm
        for mod in (cfg,bm):
            for name,val in dict(DATA_DIR=DATA_DIR,DB_FILE=DB_FILE,SECURITY_FILE=SECURITY_FILE,BACKUP_DIR=BACKUP_DIR,ARCHIVE_DIR=ARCHIVE_DIR,REPORT_DIR=REPORT_DIR,CATALOG_DIR=CATALOG_DIR,CATALOG_MIRROR_DIR=CATALOG_MIRROR_DIR,QUEUE_DIR=QUEUE_DIR,UPDATE_DIR=UPDATE_DIR).items():
                setattr(mod,name,val)
        sm.SECURITY_FILE = SECURITY_FILE
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config.update(TESTING=testing, MAX_CONTENT_LENGTH=200*1024*1024, JSON_AS_ASCII=False, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
    app.secret_key = os.urandom(32)
    app.extensions["ps_key"] = None; app.extensions["ps_db"] = None
    key = None
    if master_password:
        if SECURITY_FILE.exists(): key = security.unlock_master(master_password, SECURITY_FILE)
        else: key = security.setup_master(master_password, SECURITY_FILE)
    if key:
        _attach_db(app, key)
    else:
        app.secret_key = os.urandom(32)

    def db(): return app.extensions["ps_db"]
    def key_(): return app.extensions["ps_key"]
    def locked(): return db() is None

    def log(action, detail=""):
        if locked(): return
        shift = session.get("shift_label", "سیستم")
        db().run("INSERT INTO activity_log(at,shift_label,action,detail) VALUES(?,?,?,?)", (now_j_str(), shift, action, str(detail)[:2000]))
    def tech_error(exc):
        if locked(): return
        try: db().run("INSERT INTO error_log(at,level,message,traceback) VALUES(?,?,?,?)", (now_j_str(),"ERROR",str(exc)[:1000],traceback.format_exc()[:8000]))
        except Exception: pass
    def login_required(f):
        @wraps(f)
        def w(*a,**kw):
            if locked(): return jsonify({"error":"سامانه قفل است"}), 423
            if not session.get("group"): return jsonify({"error":"وارد شوید"}), 401
            return f(*a,**kw)
        return w
    def admin_required(f):
        @wraps(f)
        def w(*a,**kw):
            if locked(): return jsonify({"error":"سامانه قفل است"}), 423
            if session.get("role") != "admin": return jsonify({"error":"دسترسی ادمین لازم است"}), 403
            return f(*a,**kw)
        return w
    def shift_label(): return session.get("shift_label","سیستم")
    def active_shift():
        row = db().one("SELECT value FROM settings WHERE key='active_shift'")
        k = row['value'] if row else 'A'
        grp = db().one("SELECT * FROM groups WHERE key=?", (k,))
        members = db().query("SELECT * FROM members WHERE group_key=? AND active=1 ORDER BY id", (k,))
        return {"key":k,"label":grp['label'] if grp else k,"members":[m['name'] for m in members]}
    def operators_text():
        s = active_shift(); return " و ".join(s["members"])

    @app.errorhandler(Exception)
    def on_error(e):
        if isinstance(e, HTTPException):
            return e
        if isinstance(e, (ValueError, RuntimeError)):
            tech_error(e); return jsonify({"error":str(e)}), 400
        tech_error(e)
        if app.config['TESTING']: raise e
        return jsonify({"error":"خطای داخلی؛ به ادمین اطلاع دهید"}), 500

    @app.get("/")
    def index():
        if locked():
            return render_template("lock.html", setup=not SECURITY_FILE.exists(), version=__version__, org=ORG_NAME)
        if not session.get("group"): return render_template("login.html", version=__version__, org=ORG_NAME, groups=db().query("SELECT key,label,role FROM groups ORDER BY CASE key WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END"))
        return render_template("index.html", version=__version__, org=ORG_NAME, app_name=APP_NAME)
    @app.post("/setup")
    def setup():
        p = request.form.get("password",""); p2 = request.form.get("password2","")
        if p != p2: return render_template("lock.html", setup=True, error="تکرار رمز یکسان نیست", version=__version__, org=ORG_NAME), 400
        try: key = security.setup_master(p, SECURITY_FILE)
        except ValueError as e: return render_template("lock.html", setup=True, error=str(e), version=__version__, org=ORG_NAME), 400
        _attach_db(app, key); log("نصب اولیه", "رمز اصلی تنظیم شد")
        if not testing: _start_worker(app)
        return redirect("/")
    @app.post("/unlock")
    def unlock():
        try: key = security.unlock_master(request.form.get("password",""), SECURITY_FILE)
        except ValueError as e: return render_template("lock.html", setup=False, error=str(e), version=__version__, org=ORG_NAME), 401
        _attach_db(app, key); log("بازکردن سامانه", "")
        if not testing: _start_worker(app)
        return redirect("/")
    @app.post("/api/login")
    def api_login():
        if locked(): return jsonify({"error":"سامانه قفل است"}), 423
        d = request.json or {}; grp = db().one("SELECT * FROM groups WHERE key=?", (d.get("group"),))
        if not grp or not check_password_hash(grp['pin_hash'], d.get("pin","")): return jsonify({"error":"PIN اشتباه است"}), 401
        session.update(group=grp['key'], role=grp['role'], shift_label=grp['label'])
        log("ورود", grp['label'])
        prompt = False
        if grp['key']=='admin' and not db().one("SELECT value FROM settings WHERE key='first_admin_pin_change_prompted'")['value']:
            prompt = True
        return jsonify({"ok":True,"group":grp['key'],"role":grp['role'],"label":grp['label'],"prompt_pin_change":prompt})
    @app.post("/api/logout")
    def api_logout(): log("خروج",""); session.clear(); return jsonify({"ok":True})
    @app.get("/api/me")
    def me():
        if locked(): return jsonify({"locked":True})
        if not session.get('group'): return jsonify(None)
        return jsonify({"group":session['group'],"role":session['role'],"label":session['shift_label']})

    # ---------- dashboard ----------
    def eval_alerts(scope, tag, param, value, date, interval):
        sp = db().one("SELECT * FROM setpoints WHERE key=?", (f"{scope}:{param}",))
        if not sp or value is None: return
        sev = None; txt = []
        for level, lo, hi in (("critical", sp['crit_min'], sp['crit_max']), ("warning", sp['warn_min'], sp['warn_max'])):
            if (lo is not None and value < lo) or (hi is not None and value > hi):
                sev = level; txt = [f"{sp['label']}: هشدار {sp['warn_min'] if sp['warn_min'] is not None else '—'} تا {sp['warn_max'] if sp['warn_max'] is not None else '—'} / بحرانی {sp['crit_min'] if sp['crit_min'] is not None else '—'} تا {sp['crit_max'] if sp['crit_max'] is not None else '—'}"]; break
        if sev:
            msg = f"{tag} / {sp['label']} = {value} {sp['unit'] or ''}"
            db().run("INSERT INTO alerts(created_at,date,interval_index,source,tag,param,value,severity,message,setpoint_text) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (now_j_str(),date,interval,scope,tag,param,value,sev,msg,txt[0]))
    def physical_check(scope, param, value):
        sp = db().one("SELECT * FROM setpoints WHERE key=?", (f"{scope}:{param}",))
        if sp:
            if sp['phys_min'] is not None and value < sp['phys_min']: raise ValueError(f"مقدار کمتر از بازه منطقی فیزیکی ({sp['phys_min']}) است")
            if sp['phys_max'] is not None and value > sp['phys_max']: raise ValueError(f"مقدار بیشتر از بازه منطقی فیزیکی ({sp['phys_max']}) است")
    @app.get("/api/dashboard")
    @login_required
    def dashboard():
        d = date_j_str(shift_day()); idx = interval_index(); s = active_shift()
        process = []
        for tag,label,unit in PROCESS_PARAMS:
            row = db().one("SELECT * FROM process_values WHERE date=? AND interval_index=? AND param=?", (d,idx,tag))
            sp = db().one("SELECT * FROM setpoints WHERE key=?", (f"process:{tag}",))
            process.append({"tag":tag,"label":label,"unit":unit,"value":row['value'] if row else None,"edited":row['edited'] if row else 0,"setpoint":sp})
        total = db().one("SELECT * FROM daily_totals WHERE date=?", (d,))
        intervals = []
        for i in range(6):
            n = db().one("SELECT COUNT(*) n FROM process_values WHERE date=? AND interval_index=?", (d,i))['n']
            intervals.append({"index":i,"label":INTERVAL_LABELS[i],"filled":n>0,"current":i==idx,"start":interval_start_time(i)})
        motors = []
        for m in db().query("SELECT * FROM motors ORDER BY id"):
            since = max(0, (m['hmi_hours'] or 0) - (m['last_service_hours'] or 0))
            pct = min(100, since / (m['service_interval'] or 2500) * 100)
            motors.append({**m,"hours_since_service":since,"service_pct":pct,"state_fa":MOTOR_STATE_FA.get(m['state'],m['state'])})
        alerts = db().query("SELECT * FROM alerts WHERE active=1 ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, id DESC LIMIT 100")
        safety = db().query("SELECT * FROM equipment WHERE safety_critical=1 AND deleted_at IS NULL ORDER BY tag")
        for x in safety: x['status_fa']=STATUS_FA.get(x['status'],x['status'])
        return jsonify({"date":d,"weekday":weekday_fa(),"time":time_str(),"interval":idx,"intervals":intervals,"shift":s,"process":process,"daily_total":total,"motors":motors,"alerts":alerts,"safety":safety,"queue":queue_mod.queue_summary(db()),"version":__version__})
    @app.post("/api/process")
    @login_required
    def save_process():
        d = request.json or {}; tag=d.get('param'); value=float(d.get('value'))
        date = d.get('date') or date_j_str(shift_day()); idx = int(d.get('interval', interval_index()))
        if tag not in [p[0] for p in PROCESS_PARAMS]: raise ValueError('پارامتر نامعتبر')
        if not 0 <= idx <= 5: raise ValueError('بازه نامعتبر')
        physical_check('process', tag, value)
        old = db().one("SELECT * FROM process_values WHERE date=? AND interval_index=? AND param=?", (date,idx,tag))
        unit = next(p[2] for p in PROCESS_PARAMS if p[0]==tag)
        db().run("""INSERT INTO process_values(date,interval_index,param,value,unit,shift_label,recorded_at,updated_at,edited) VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(date,interval_index,param) DO UPDATE SET value=excluded.value,shift_label=excluded.shift_label,updated_at=excluded.updated_at,edited=1""",
                 (date,idx,tag,value,unit,shift_label(),now_j_str(),now_j_str(),1 if old else 0))
        eval_alerts('process', tag, tag, value, date, idx); log('ثبت پارامتر', f'{tag}={value} بازه {idx} {date}')
        return jsonify({"ok":True})
    @app.post("/api/total")
    @login_required
    def save_total():
        d=request.json or {}; date=d.get('date') or date_j_str(shift_day()); value=float(d.get('value'))
        old=db().one("SELECT * FROM daily_totals WHERE date=?", (date,))
        db().run("""INSERT INTO daily_totals(date,value,shift_label,recorded_at,updated_at,edited) VALUES(?,?,?,?,?,?)
                    ON CONFLICT(date) DO UPDATE SET value=excluded.value,shift_label=excluded.shift_label,updated_at=excluded.updated_at,edited=1""",
                 (date,value,shift_label(),now_j_str(),now_j_str(),1 if old else 0))
        log('ثبت توتال روزانه', f'{date}={value}'); return jsonify({"ok":True})
    @app.get("/api/history")
    @login_required
    def history():
        scope=request.args.get('scope','process'); param=request.args.get('param'); motor=request.args.get('motor'); frm=request.args.get('from','0000/00/00'); to=request.args.get('to','9999/99/99')
        if scope=='process':
            rows=db().query("SELECT date,interval_index,value,shift_label,edited FROM process_values WHERE param=? AND date BETWEEN ? AND ? ORDER BY date,interval_index", (param,frm,to))
        else:
            m=db().one("SELECT id FROM motors WHERE tag=?", (motor,))
            if not m: raise ValueError('موتور پیدا نشد')
            rows=db().query("SELECT date,interval_index,value,shift_label,edited FROM motor_values WHERE motor_id=? AND param=? AND date BETWEEN ? AND ? ORDER BY date,interval_index", (m['id'],param,frm,to))
        vals=[r['value'] for r in rows]
        stats={"count":len(vals),"avg":sum(vals)/len(vals) if vals else None,"min":min(vals) if vals else None,"max":max(vals) if vals else None}
        return jsonify({"rows":rows,"stats":stats})
    @app.get("/api/total/monthly")
    @login_required
    def total_monthly():
        y=int(request.args.get('year', today_j().year)); m=int(request.args.get('month', today_j().month))
        rows=db().query("SELECT * FROM daily_totals WHERE date LIKE ? ORDER BY date", (f"{y:04d}/{m:02d}/%",))
        return jsonify({"year":y,"month":m,"days":month_days(y,m),"rows":rows,"sum":sum(r['value'] for r in rows)})

    # ---------- motors ----------
    @app.get("/api/motors/<int:mid>")
    @login_required
    def motor_detail(mid):
        m=db().one("SELECT * FROM motors WHERE id=?", (mid,))
        if not m: raise ValueError('موتور پیدا نشد')
        d=request.args.get('date') or date_j_str(shift_day()); idx=int(request.args.get('interval', interval_index()))
        vals=db().query("SELECT * FROM motor_values WHERE motor_id=? AND date=? AND interval_index=?", (mid,d,idx))
        value_map={v['param']:v['value'] for v in vals}
        params=[{"key":k,"label":l,"unit":u,"value":value_map.get(k),"setpoint":db().one("SELECT * FROM setpoints WHERE key=?", (f"motor:{k}",))} for k,l,u in MOTOR_PARAMS]
        return jsonify({"motor":m,"date":d,"interval":idx,"params":params,
                        "services":db().query("SELECT * FROM motor_services WHERE motor_id=? ORDER BY date DESC,id DESC", (mid,)),
                        "megger":db().query("SELECT * FROM megger_tests WHERE motor_id=? ORDER BY date DESC,id DESC", (mid,)),
                        "oil":db().query("SELECT * FROM oil_changes WHERE motor_id=? ORDER BY date DESC,id DESC", (mid,)),
                        "state_history":db().query("SELECT * FROM motor_state_history WHERE motor_id=? ORDER BY id DESC LIMIT 200", (mid,)),
                        "hmi_corrections":db().query("SELECT * FROM hmi_corrections WHERE motor_id=? ORDER BY id DESC", (mid,))})
    @app.post("/api/motors/<int:mid>/values")
    @login_required
    def motor_values(mid):
        m=db().one("SELECT * FROM motors WHERE id=?", (mid,))
        if not m: raise ValueError('موتور پیدا نشد')
        d=request.json or {}; date=d.get('date') or date_j_str(shift_day()); idx=int(d.get('interval', interval_index())); values=d.get('values') or {}
        valid={k for k,_,_ in MOTOR_PARAMS}
        for param,val in values.items():
            if param not in valid: raise ValueError('پارامتر نامعتبر')
            if val is None or val=='': continue
            value=float(val); physical_check('motor', param, value)
            old=db().one("SELECT * FROM motor_values WHERE motor_id=? AND date=? AND interval_index=? AND param=?", (mid,date,idx,param))
            db().run("""INSERT INTO motor_values(motor_id,date,interval_index,param,value,shift_label,recorded_at,updated_at,edited) VALUES(?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(motor_id,date,interval_index,param) DO UPDATE SET value=excluded.value,shift_label=excluded.shift_label,updated_at=excluded.updated_at,edited=1""",
                     (mid,date,idx,param,value,shift_label(),now_j_str(),now_j_str(),1 if old else 0))
            eval_alerts('motor', m['tag'], param, value, date, idx)
        log('ثبت داده موتور', f"{m['tag']} {date} بازه {idx}"); return jsonify({"ok":True})
    @app.post("/api/motors/<int:mid>/state")
    @login_required
    def motor_state(mid):
        m=db().one("SELECT * FROM motors WHERE id=?", (mid,))
        if not m: raise ValueError('موتور پیدا نشد')
        st=(request.json or {}).get('state')
        if st not in MOTOR_STATE_FA: raise ValueError('وضعیت نامعتبر')
        db().run("UPDATE motors SET state=?,state_changed_at=?,state_changed_shift=? WHERE id=?", (st,now_j_str(),shift_label(),mid))
        db().run("INSERT INTO motor_state_history(motor_id,old_state,new_state,shift_label,at) VALUES(?,?,?,?,?)", (mid,m['state'],st,shift_label(),now_j_str()))
        if m['equipment_id']:
            db().run("UPDATE equipment SET run_state=?,status=?,status_changed_at=?,status_changed_shift=?,updated_at=? WHERE id=?", ('on' if st=='on' else 'off', 'running' if st=='on' else ('service' if st=='service' else 'ready'), now_j_str(), shift_label(), now_j_str(), m['equipment_id']))
        log('تغییر وضعیت موتور', f"{m['tag']} {m['state']} -> {st}"); return jsonify({"ok":True})
    @app.post("/api/motors/<int:mid>/hmi")
    @admin_required
    def hmi_correct(mid):
        m=db().one("SELECT * FROM motors WHERE id=?", (mid,))
        if not m: raise ValueError('موتور پیدا نشد')
        d=request.json or {}; new=float(d.get('hours')); reason=d.get('reason','').strip()
        if not reason: raise ValueError('دلیل اصلاح الزامی است')
        db().run("UPDATE motors SET hmi_hours=? WHERE id=?", (new,mid))
        db().run("INSERT INTO hmi_corrections(motor_id,old_hours,new_hours,reason,shift_label,at) VALUES(?,?,?,?,?,?)", (mid,m['hmi_hours'],new,reason,shift_label(),now_j_str()))
        log('اصلاح شمارنده HMI', f"{m['tag']} {m['hmi_hours']} -> {new}"); return jsonify({"ok":True})
    @app.post("/api/motors/<int:mid>/service")
    @login_required
    def motor_service(mid):
        m=db().one("SELECT * FROM motors WHERE id=?", (mid,))
        if not m: raise ValueError('موتور پیدا نشد')
        d=request.json or {}; date=d.get('date') or date_j_str(); hmi=float(d.get('hmi_hours', m['hmi_hours']))
        brush=d.get('brush') or {}
        if hmi < m['hmi_hours'] and not d.get('confirm_lower'): raise ValueError('ساعت HMI کمتر از قبلی است؛ فقط با تایید سرویس تازه پذیرفته می‌شود')
        sid=db().run("INSERT INTO motor_services(motor_id,date,shift_label,workers,brush_json,hmi_hours,note,created_at) VALUES(?,?,?,?,?,?,?,?)",
                     (mid,date,shift_label(),d.get('workers',''),json.dumps(brush,ensure_ascii=False),hmi,d.get('note',''),now_j_str()))
        db().run("UPDATE motors SET hmi_hours=?,last_service_hours=?,state='off',state_changed_at=?,state_changed_shift=? WHERE id=?", (hmi,hmi,now_j_str(),shift_label(),mid))
        db().run("INSERT INTO motor_state_history(motor_id,old_state,new_state,shift_label,at,note) VALUES(?,?,?,?,?,?)", (mid,m['state'],'off',shift_label(),now_j_str(),'ثبت سرویس'))
        path=REPORT_DIR / f"service-{m['tag']}-{date.replace('/','-')}-{sid}.pdf"
        rows=[["فاز","برس ۱","برس ۲","برس ۳","برس ۴","برس ۵","برس ۶","برس ۷","برس ۸"]]
        for ph in ('U','V','W'): rows.append([ph]+[str(brush.get(f'{ph}{i}','')) for i in range(1,9)])
        pdf_mod.simple_pdf(path, f"سرویس موتور {m['tag']}", f"{date} — {shift_label()}", [
            {"title":"اطلاعات سرویس","text":f"انجام‌دهندگان: {d.get('workers','—')}\nساعت HMI: {hmi}\nیادداشت: {d.get('note','—')}"},
            {"title":"قرائت برس‌ها","rows":rows}])
        db().run("UPDATE motor_services SET pdf_path=? WHERE id=?", (str(path),sid))
        log('ثبت سرویس موتور', f"{m['tag']} {date}"); return jsonify({"ok":True,"id":sid,"pdf":f"/api/reports/file?path={path.name}"})
    @app.post("/api/motors/<int:mid>/megger")
    @login_required
    def megger(mid):
        d=request.json or {}; date=d.get('date') or date_j_str()
        v=int(d.get('test_voltage',1000))
        if v not in (500,1000,2500,5000): raise ValueError('ولتاژ تست نامعتبر')
        def f(k): return float(d[k]) if d.get(k) not in (None,'') else None
        iid=db().run("INSERT INTO megger_tests(motor_id,date,shift_label,stator_u,stator_v,stator_w,rotor_u,rotor_v,rotor_w,winding_temp,pi,test_voltage,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (mid,date,shift_label(),f('stator_u'),f('stator_v'),f('stator_w'),f('rotor_u'),f('rotor_v'),f('rotor_w'),f('winding_temp'),f('pi'),v,d.get('note',''),now_j_str()))
        log('ثبت تست مگر', f'motor {mid} {date}'); return jsonify({"ok":True,"id":iid})
    @app.post("/api/motors/<int:mid>/oil")
    @login_required
    def oil(mid):
        d=request.json or {}; date=d.get('date') or date_j_str()
        iid=db().run("INSERT INTO oil_changes(motor_id,date,shift_label,hmi_hours,note,created_at) VALUES(?,?,?,?,?,?)", (mid,date,shift_label(),float(d.get('hmi_hours',0)),d.get('note',''),now_j_str()))
        log('تعویض روغن', f'motor {mid} {date}'); return jsonify({"ok":True,"id":iid})

    # ---------- alerts / schedule / report text ----------
    @app.post("/api/alerts/<int:aid>/ack")
    @login_required
    def ack(aid):
        kind=(request.json or {}).get('kind')
        if kind=='seen': db().run("UPDATE alerts SET seen_at=?,seen_shift=? WHERE id=?", (now_j_str(),shift_label(),aid))
        elif kind=='acted': db().run("UPDATE alerts SET acted_at=?,acted_shift=?,active=0 WHERE id=?", (now_j_str(),shift_label(),aid))
        else: raise ValueError('نوع تایید نامعتبر')
        log('تایید هشدار', f'{aid} {kind}'); return jsonify({"ok":True})
    @app.get("/api/alerts")
    @login_required
    def alerts_history():
        q=request.args.get('q','')
        rows=db().query("SELECT * FROM alerts WHERE tag LIKE ? OR message LIKE ? OR date LIKE ? ORDER BY id DESC LIMIT 500", (f'%{q}%',f'%{q}%',f'%{q}%'))
        return jsonify(rows)
    @app.post("/api/operator-report")
    @login_required
    def operator_report():
        d=request.json or {}; date=d.get('date') or date_j_str(shift_day())
        db().run("INSERT INTO operator_reports(date,shift_label,text,updated_at) VALUES(?,?,?,?) ON CONFLICT(date,shift_label) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at", (date,shift_label(),d.get('text',''),now_j_str()))
        log('گزارش دستی اپراتور', date); return jsonify({"ok":True})
    @app.get("/api/operator-report")
    @login_required
    def get_operator_report():
        date=request.args.get('date') or date_j_str(shift_day())
        row=db().one("SELECT * FROM operator_reports WHERE date=? AND shift_label=?", (date,shift_label()))
        return jsonify(row or {"text":""})
    @app.get("/api/schedule")
    @login_required
    def schedule_list():
        date=request.args.get('date') or date_j_str(shift_day())
        rows=db().query("""SELECT s.*, m.name member, r.name replacement FROM schedule s LEFT JOIN members m ON m.id=s.member_id LEFT JOIN members r ON r.id=s.replacement_member_id WHERE s.date=? ORDER BY s.id DESC""", (date,))
        for r in rows: r['type_label']='مرخصی' if r['type']=='leave' else 'جابجایی'
        return jsonify(rows)
    @app.post("/api/schedule")
    @login_required
    def schedule_add():
        d=request.json or {}; date=d.get('date') or date_j_str(shift_day())
        if d.get('type') not in ('leave','swap'): raise ValueError('نوع نامعتبر')
        rep=d.get('replacement_member_id')
        if rep and not db().one("SELECT id FROM members WHERE id=? AND active=1", (rep,)): raise ValueError('جایگزین باید از روستر انتخاب شود')
        iid=db().run("INSERT INTO schedule(date,time,type,group_key,member_id,replacement_member_id,note,shift_label,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                     (date,d.get('time') or time_str(),d['type'],session['group'],d.get('member_id'),rep,d.get('note',''),shift_label(),now_j_str()))
        log('جابجایی/مرخصی', f'{date} {d["type"]}'); return jsonify({"ok":True,"id":iid})
    @app.get("/api/roster")
    @login_required
    def roster(): return jsonify(db().query("SELECT m.*, g.label group_label FROM members m JOIN groups g ON g.key=m.group_key WHERE m.active=1 ORDER BY m.group_key,m.id"))

    # ---------- registry / aux ----------
    @app.get("/api/categories")
    @login_required
    def categories(): return jsonify(db().query("SELECT * FROM equipment_categories ORDER BY sort,id"))
    @app.get("/api/equipment")
    @login_required
    def equipment_list():
        cat=request.args.get('category'); q=request.args.get('q','').strip(); include_deleted=request.args.get('include_deleted')=='1' and session.get('role')=='admin'
        sql="SELECT e.*, c.name category_name FROM equipment e JOIN equipment_categories c ON c.id=e.category_id WHERE 1=1"
        args=[]
        if not include_deleted: sql+=" AND e.deleted_at IS NULL"
        if cat: sql+=" AND e.category_id=?"; args.append(cat)
        if q: sql+=" AND (e.tag LIKE ? OR e.name LIKE ? OR e.spec LIKE ? OR e.plate LIKE ? OR e.part_numbers LIKE ?)"; args += [f'%{q}%']*5
        rows=db().query(sql+" ORDER BY e.tag", args)
        for r in rows: r['status_fa']=STATUS_FA.get(r['status'],r['status']); r['run_fa']=RUN_FA.get(r['run_state'],r['run_state'])
        return jsonify(rows)
    @app.post("/api/equipment")
    @admin_required
    def equipment_add():
        d=request.json or {}; tag=d.get('tag','').strip().upper()
        if not tag: raise ValueError('تگ الزامی است')
        if db().one("SELECT id FROM equipment WHERE tag=?", (tag,)): raise ValueError('تگ تکراری است')
        iid=db().run("""INSERT INTO equipment(tag,category_id,name,spec,plate,part_numbers,location,notes,status,run_state,monitored_aux,safety_critical,created_at,updated_at,status_changed_at,status_changed_shift)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (tag,int(d['category_id']),d.get('name',''),d.get('spec',''),d.get('plate',''),d.get('part_numbers',''),d.get('location',''),d.get('notes',''),d.get('status','ready'),d.get('run_state','off'),int(d.get('monitored_aux',0)),int(d.get('safety_critical',0)),now_j_str(),now_j_str(),now_j_str(),shift_label()))
        log('افزودن تجهیز', tag); return jsonify({"ok":True,"id":iid})
    @app.put("/api/equipment/<int:eid>")
    @admin_required
    def equipment_edit(eid):
        d=request.json or {}; fields=['name','spec','plate','part_numbers','location','notes','status','run_state','category_id','monitored_aux','safety_critical']
        sets=[]; args=[]
        for f in fields:
            if f in d: sets.append(f'{f}=?'); args.append(d[f])
        if not sets: raise ValueError('تغییری ارسال نشد')
        sets += ['updated_at=?','status_changed_at=?','status_changed_shift=?']; args += [now_j_str(),now_j_str(),shift_label(),eid]
        db().run(f"UPDATE equipment SET {','.join(sets)} WHERE id=?", args)
        log('ویرایش تجهیز', str(eid)); return jsonify({"ok":True})
    @app.delete("/api/equipment/<int:eid>")
    @admin_required
    def equipment_delete(eid):
        # Soft-delete only: no operational data is ever pruned.
        db().run("UPDATE equipment SET deleted_at=?,updated_at=? WHERE id=?", (now_j_str(),now_j_str(),eid))
        log('حذف نرم تجهیز', str(eid)); return jsonify({"ok":True})
    @app.get("/api/aux")
    @login_required
    def aux_list():
        rows=db().query("SELECT e.*, c.name category_name FROM equipment e JOIN equipment_categories c ON c.id=e.category_id WHERE e.monitored_aux=1 AND e.deleted_at IS NULL ORDER BY e.tag")
        for r in rows:
            r['status_fa']=STATUS_FA.get(r['status'],r['status']); r['run_fa']=RUN_FA.get(r['run_state'],r['run_state'])
            r['hours_since_change']=None
            if r['status_changed_at']:
                try:
                    t=jdatetime.datetime.strptime(r['status_changed_at'], "%Y/%m/%d %H:%M:%S").togregorian()
                    r['hours_since_change']=round((datetime.datetime.now()-t).total_seconds()/3600,1)
                except Exception: pass
        return jsonify(rows)
    @app.post("/api/aux/<int:eid>/state")
    @login_required
    def aux_state(eid):
        e=db().one("SELECT * FROM equipment WHERE id=?", (eid,))
        if not e: raise ValueError('تجهیز پیدا نشد')
        d=request.json or {}; run=d.get('run_state', e['run_state']); status=d.get('status', e['status'])
        if run not in RUN_FA or status not in STATUS_FA: raise ValueError('وضعیت نامعتبر')
        db().run("UPDATE equipment SET run_state=?,status=?,status_changed_at=?,status_changed_shift=?,updated_at=? WHERE id=?", (run,status,now_j_str(),shift_label(),now_j_str(),eid))
        db().run("INSERT INTO aux_status_history(equipment_id,run_state,status,shift_label,at) VALUES(?,?,?,?,?)", (eid,run,status,shift_label(),now_j_str()))
        log('تغییر وضعیت تجهیز جانبی', f"{e['tag']} {run}/{status}"); return jsonify({"ok":True})
    @app.get("/api/maintenance")
    @login_required
    def maintenance_list():
        eid=request.args.get('equipment_id')
        rows=db().query("SELECT m.*, e.tag FROM maintenance m JOIN equipment e ON e.id=m.equipment_id WHERE m.equipment_id=? ORDER BY m.date DESC,m.id DESC", (eid,)) if eid else db().query("SELECT m.*, e.tag FROM maintenance m JOIN equipment e ON e.id=m.equipment_id ORDER BY m.date DESC,m.id DESC LIMIT 200")
        return jsonify(rows)
    @app.post("/api/maintenance")
    @login_required
    def maintenance_add():
        d=request.json or {}; date=d.get('date') or date_j_str()
        iid=db().run("INSERT INTO maintenance(equipment_id,date,shift_label,workers,template_id,results_json,note,created_at) VALUES(?,?,?,?,?,?,?,?)",
                     (int(d['equipment_id']),date,shift_label(),d.get('workers',''),d.get('template_id'),json.dumps(d.get('results') or {},ensure_ascii=False),d.get('note',''),now_j_str()))
        log('ثبت تعمیرات/PM', f'equipment {d["equipment_id"]}'); return jsonify({"ok":True,"id":iid})
    @app.post("/api/maintenance/<int:mid>/pdf")
    @login_required
    def maintenance_pdf(mid):
        r=db().one("SELECT m.*, e.tag, e.name equipment_name FROM maintenance m JOIN equipment e ON e.id=m.equipment_id WHERE m.id=?", (mid,))
        if not r: raise ValueError('رکورد تعمیرات پیدا نشد')
        results=json.loads(r['results_json'] or '{}')
        rows=[["آیتم","نتیجه/توضیح"]]+[[k,str(v)] for k,v in results.items()]
        fname=f"PM-{r['tag']}-{r['date'].replace('/','-')}-{mid}.pdf"; path=REPORT_DIR/fname
        pdf_mod.simple_pdf(path,f"تعمیرات/PM — {r['tag']}",f"{r['date']} — {r['shift_label']}",[
            {"title":"اطلاعات","text":f"تجهیز: {r['equipment_name']}\nانجام‌دهندگان: {r['workers'] or '—'}\nیادداشت: {r['note'] or '—'}"},
            {"title":"چک‌لیست","rows":rows if len(rows)>1 else [["آیتمی ثبت نشده","—"]]}])
        db().run("UPDATE maintenance SET pdf_path=? WHERE id=?", (str(path),mid))
        rid=db().run("INSERT INTO reports(date,shift_label,kind,filename,path,created_at,meta_json) VALUES(?,?,?,?,?,?,?)", (r['date'],r['shift_label'],'maintenance',fname,str(path),now_j_str(),'{}'))
        return jsonify({"ok":True,"url":f"/api/reports/{rid}/file"})
    @app.get("/api/pm-templates")
    @login_required
    def pm_templates():
        cat=request.args.get('category_id')
        return jsonify(db().query("SELECT * FROM pm_templates WHERE category_id=? ORDER BY id", (cat,)) if cat else db().query("SELECT * FROM pm_templates ORDER BY category_id,id"))
    @app.put("/api/pm-templates/<int:tid>")
    @admin_required
    def pm_template_edit(tid):
        d=request.json or {}; items=d.get('items') or []
        db().run("UPDATE pm_templates SET name=?,items_json=?,updated_at=? WHERE id=?", (d.get('name','چک‌لیست'),json.dumps(items,ensure_ascii=False),now_j_str(),tid))
        log('ویرایش چک‌لیست PM', str(tid)); return jsonify({"ok":True})
    @app.post("/api/equipment/<int:eid>/catalogs")
    @admin_required
    def catalog_upload(eid):
        f=request.files.get('file')
        if not f or not f.filename.lower().endswith('.pdf'): raise ValueError('فقط PDF مجاز است')
        CATALOG_DIR.mkdir(parents=True, exist_ok=True)
        raw=f.read(); digest=hashlib.sha256(raw).hexdigest(); name=f"eq{eid}-{digest[:16]}.pdf"
        (CATALOG_DIR/name).write_bytes(raw)
        db().run("INSERT INTO catalogs(equipment_id,filename,original_name,uploaded_at,uploaded_by,size,sha256) VALUES(?,?,?,?,?,?,?)", (eid,name,secure_filename(f.filename),now_j_str(),shift_label(),len(raw),digest))
        backup_mod.mirror_catalogs(); log('آپلود کاتالوگ', f'equipment {eid}'); return jsonify({"ok":True,"filename":name})
    @app.get("/api/equipment/<int:eid>/catalogs")
    @login_required
    def catalog_list(eid): return jsonify(db().query("SELECT * FROM catalogs WHERE equipment_id=? ORDER BY id DESC", (eid,)))
    @app.get("/catalogs/<path:name>")
    @login_required
    def catalog_file(name): return send_from_directory(CATALOG_DIR, Path(name).name)

    # ---------- reports / PDF ----------
    def daily_context(date, shift):
        grp=db().one("SELECT * FROM groups WHERE key=?", (shift,)) or {"label":shift}
        members=db().query("SELECT name FROM members WHERE group_key=? AND active=1 ORDER BY id", (shift,))
        rows=[]; stars=False
        for tag,label,unit in PROCESS_PARAMS:
            vals=db().query("SELECT value FROM process_values WHERE date=? AND param=? ORDER BY interval_index", (date,tag))
            value=vals[-1]['value'] if vals else None
            sp=db().one("SELECT * FROM setpoints WHERE key=?", (f"process:{tag}",))
            out=False
            if value is not None and sp:
                out=(sp['warn_min'] is not None and value<sp['warn_min']) or (sp['warn_max'] is not None and value>sp['warn_max']) or (sp['crit_min'] is not None and value<sp['crit_min']) or (sp['crit_max'] is not None and value>sp['crit_max'])
            stars = stars or out
            rows.append({"tag":tag,"label":label,"value":value,"out_of_setpoint":out})
        total=db().one("SELECT value FROM daily_totals WHERE date=?", (date,))
        motors_on=[m['tag'] for m in db().query("SELECT * FROM motors WHERE state='on' ORDER BY id")]
        op=db().one("SELECT text FROM operator_reports WHERE date=? AND shift_label=?", (date,grp['label']))
        sched=db().query("""SELECT s.*, m.name member, r.name replacement FROM schedule s LEFT JOIN members m ON m.id=s.member_id LEFT JOIN members r ON r.id=s.replacement_member_id WHERE s.date=?""", (date,))
        for x in sched: x['type_label']='مرخصی' if x['type']=='leave' else 'جابجایی'; x['member']=x['member'] or '—'; x['replacement']=x['replacement'] or '—'
        return {"date":date,"shift_label":grp['label'],"operators":" و ".join(m['name'] for m in members),"process_rows":rows,"daily_total":total['value'] if total else None,"motors_on":motors_on,"operator_text":op['text'] if op else '',"schedule":sched,"has_stars":stars,"gregorian_date":parse_j(date).togregorian()}
    @app.post("/api/reports/daily")
    @login_required
    def make_daily():
        d=request.json or {}; date=d.get('date') or date_j_str(shift_day()); shift=d.get('shift') or session['group']
        correction=d.get('correction'); corr_time=time_str() if correction else None
        ctx=daily_context(date,shift); ctx['correction']=correction; ctx['correction_time']=corr_time
        fname=f"ایستگاه پمپاژ زیر زمینی — {date.replace('/','-')}" + (f" — اصلاحی {corr_time.replace(':','-')}" if correction else "") + ".pdf"
        path=REPORT_DIR/fname; pdf_mod.daily_report(path,ctx)
        rid=db().run("INSERT INTO reports(date,shift_label,kind,filename,path,created_at,corrected_from,meta_json) VALUES(?,?,?,?,?,?,?,?)", (date,shift,'daily-correction' if correction else 'daily',fname,str(path),now_j_str(),d.get('corrected_from'),json.dumps(ctx,ensure_ascii=False,default=str)))
        log('ساخت PDF روزانه', fname)
        if d.get('send'): queue_mod.enqueue(db,'daily',path,'daily',rid)
        return jsonify({"ok":True,"id":rid,"filename":fname,"url":f"/api/reports/{rid}/file","queued":bool(d.get('send'))})
    @app.get("/api/reports")
    @login_required
    def reports_list(): return jsonify(db().query("SELECT * FROM reports ORDER BY id DESC LIMIT 300"))
    @app.get("/api/reports/<int:rid>/file")
    @login_required
    def report_file(rid):
        r=db().one("SELECT * FROM reports WHERE id=?", (rid,))
        if not r: raise ValueError('گزارش پیدا نشد')
        return send_file(r['path'], mimetype='application/pdf', as_attachment=False, download_name=r['filename'])
    @app.get("/api/reports/file")
    @login_required
    def report_file_by_name():
        name=Path(request.args.get('path','')).name
        return send_file(REPORT_DIR/name, mimetype='application/pdf')
    @app.post("/api/reports/aux")
    @login_required
    def make_aux_pdf():
        rows=db().query("SELECT * FROM equipment WHERE monitored_aux=1 AND deleted_at IS NULL ORDER BY tag")
        last=db().one("SELECT * FROM aux_pdf_exports ORDER BY id DESC LIMIT 1"); prev={r['tag']:r for r in json.loads(last['snapshot_json'])} if last else {}
        table_rows=[["تگ","تجهیز","وضعیت","روشن/خاموش","ساعت ثبت","شیفت","تغییر از آخرین PDF"]]; snapshot=[]
        for r in rows:
            changed = r['tag'] not in prev or prev[r['tag']].get('status')!=r['status'] or prev[r['tag']].get('run_state')!=r['run_state']
            table_rows.append([r['tag'],r['name'],STATUS_FA.get(r['status'],r['status']),RUN_FA.get(r['run_state'],r['run_state']),r['status_changed_at'] or '—',r['status_changed_shift'] or '—','*' if changed else ''])
            snapshot.append({"tag":r['tag'],"status":r['status'],"run_state":r['run_state']})
        fname=f"تجهیزات جانبی — {date_j_str().replace('/','-')} — {time_str().replace(':','-')}.pdf"; path=REPORT_DIR/fname
        pdf_mod.simple_pdf(path,"گزارش تجهیزات جانبی",f"{date_j_str()} — {shift_label()}",[{"title":"وضعیت تجهیزات","rows":table_rows},{"title":"راهنما","text":"* یعنی از آخرین PDF این بخش تغییر وضعیت داشته است."}])
        eid=db().run("INSERT INTO aux_pdf_exports(created_at,shift_label,snapshot_json,pdf_path) VALUES(?,?,?,?)", (now_j_str(),shift_label(),json.dumps(snapshot,ensure_ascii=False),str(path)))
        rid=db().run("INSERT INTO reports(date,shift_label,kind,filename,path,created_at,meta_json) VALUES(?,?,?,?,?,?,?)", (date_j_str(),shift_label(),'aux',fname,str(path),now_j_str(),json.dumps({"aux_export":eid},ensure_ascii=False)))
        if (request.json or {}).get('send'): queue_mod.enqueue(db,'aux',path,'daily',rid)
        return jsonify({"ok":True,"id":rid,"url":f"/api/reports/{rid}/file"})
    @app.post("/api/reports/registry")
    @login_required
    def make_registry_pdf():
        rows=db().query("SELECT e.*, c.name category_name FROM equipment e JOIN equipment_categories c ON c.id=e.category_id WHERE e.deleted_at IS NULL ORDER BY c.sort,e.tag")
        table_rows=[["تگ","نام","دسته","مشخصات","وضعیت"]]
        for r in rows: table_rows.append([r['tag'],r['name'],r['category_name'],r['spec'] or '—',STATUS_FA.get(r['status'],r['status'])])
        fname=f"لیست تجهیزات — {date_j_str().replace('/','-')}.pdf"; path=REPORT_DIR/fname
        pdf_mod.simple_pdf(path,"رجیستری تجهیزات ایستگاه پمپاژ زیرزمینی",f"{date_j_str()} — {shift_label()}",[{"title":"لیست تجهیزات","rows":table_rows}])
        rid=db().run("INSERT INTO reports(date,shift_label,kind,filename,path,created_at,meta_json) VALUES(?,?,?,?,?,?,?)", (date_j_str(),shift_label(),'registry',fname,str(path),now_j_str(),'{}'))
        return jsonify({"ok":True,"id":rid,"url":f"/api/reports/{rid}/file"})
    @app.get("/api/search")
    @login_required
    def search():
        q=request.args.get('q','').strip()
        if not q: return jsonify({"equipment":[],"reports":[],"alerts":[]})
        like=f'%{q}%'
        return jsonify({"equipment":db().query("SELECT id,tag,name FROM equipment WHERE deleted_at IS NULL AND (tag LIKE ? OR name LIKE ?) LIMIT 30",(like,like)),
                        "reports":db().query("SELECT id,date,filename,kind FROM reports WHERE date LIKE ? OR filename LIKE ? ORDER BY id DESC LIMIT 30",(like,like)),
                        "alerts":db().query("SELECT id,date,tag,message,severity FROM alerts WHERE tag LIKE ? OR message LIKE ? OR date LIKE ? ORDER BY id DESC LIMIT 30",(like,like,like))})

    # ---------- admin ----------
    @app.get("/api/admin/status")
    @admin_required
    def admin_status():
        counts={t:db().one(f"SELECT COUNT(*) n FROM {t}")['n'] for t in ('equipment','motors','process_values','motor_values','alerts','maintenance','motor_services','reports','activity_log')}
        last=db().one("SELECT value FROM settings WHERE key='last_backup_date'")
        return jsonify({"version":__version__,"last_backup":last['value'] if last else None,"counts":counts,"queue":queue_mod.queue_summary(db()),"data_dir":str(DATA_DIR),"host":"127.0.0.1","port":DEFAULT_PORT})
    @app.get("/api/admin/setpoints")
    @admin_required
    def setpoints_list(): return jsonify(db().query("SELECT * FROM setpoints ORDER BY scope,param"))
    @app.put("/api/admin/setpoints/<path:key>")
    @admin_required
    def setpoints_edit(key):
        d=request.json or {}; fields=['warn_min','warn_max','crit_min','crit_max','phys_min','phys_max']
        sets=[]; args=[]
        for f in fields:
            if f in d: sets.append(f'{f}=?'); args.append(None if d[f] in (None,'') else float(d[f]))
        if not sets: raise ValueError('تغییری ارسال نشد')
        sets.append('updated_at=?'); args += [now_j_str(),key]
        db().run(f"UPDATE setpoints SET {','.join(sets)} WHERE key=?", args); log('ویرایش ست‌پوینت', key); return jsonify({"ok":True})
    @app.get("/api/admin/groups")
    @admin_required
    def groups_list():
        groups=db().query("SELECT key,label,role FROM groups ORDER BY CASE key WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END")
        for gr in groups: gr['members']=db().query("SELECT * FROM members WHERE group_key=? ORDER BY id",(gr['key'],))
        return jsonify(groups)
    @app.put("/api/admin/groups/<key>")
    @admin_required
    def group_edit(key):
        d=request.json or {}
        if d.get('pin'):
            if len(d['pin'])!=4 or not d['pin'].isdigit(): raise ValueError('PIN باید چهار رقم باشد')
            db().run("UPDATE groups SET pin_hash=? WHERE key=?", (generate_password_hash(d['pin']),key))
        if key=='admin': db().run("INSERT OR REPLACE INTO settings(key,value) VALUES('first_admin_pin_change_prompted','1')")
        log('ویرایش گروه/PIN', key); return jsonify({"ok":True})
    @app.post("/api/admin/members")
    @admin_required
    def member_add():
        d=request.json or {}; iid=db().run("INSERT INTO members(group_key,name,phone) VALUES(?,?,?)", (d['group_key'],d['name'],d.get('phone','')))
        log('افزودن عضو روستر', d['name']); return jsonify({"ok":True,"id":iid})
    @app.put("/api/admin/members/<int:mid>")
    @admin_required
    def member_edit(mid):
        d=request.json or {}; db().run("UPDATE members SET name=?,phone=?,group_key=?,active=? WHERE id=?", (d.get('name',''),d.get('phone',''),d.get('group_key','A'),int(d.get('active',1)),mid))
        log('ویرایش عضو روستر', str(mid)); return jsonify({"ok":True})
    @app.put("/api/admin/active-shift")
    @admin_required
    def set_active_shift():
        k=(request.json or {}).get('shift')
        if k not in ('A','B','C'): raise ValueError('شیفت نامعتبر')
        db().run("INSERT OR REPLACE INTO settings(key,value) VALUES('active_shift',?)", (k,)); log('تغییر شیفت فعال', k); return jsonify({"ok":True})
    @app.get("/api/admin/channels")
    @admin_required
    def channels_get(): return jsonify(db().query("SELECT key,provider,chat_id,enabled, CASE WHEN token='' THEN 0 ELSE 1 END has_token FROM channels"))
    @app.put("/api/admin/channels/<key>")
    @admin_required
    def channels_edit(key):
        d=request.json or {}; db().run("UPDATE channels SET provider=?,chat_id=?,token=?,enabled=? WHERE key=?", (d.get('provider','bale'),d.get('chat_id',''),d.get('token',''),int(d.get('enabled',0)),key))
        log('ویرایش کانال ارسال', key); return jsonify({"ok":True})
    @app.post("/api/admin/channels/<key>/test")
    @admin_required
    def channels_test(key):
        try:
            test_path=REPORT_DIR/'channel-test.pdf'
            pdf_mod.simple_pdf(test_path,'تست ارسال سامانه',now_j_str(),[{"title":"تست","text":"اگر این فایل را دریافت کردید، کانال ارسال درست تنظیم شده است."}])
            queue_mod.send_file(db(),key,test_path,'تست ارسال سامانه پمپاژ')
            return jsonify({"ok":True})
        except Exception as e: return jsonify({"ok":False,"error":str(e)}), 400
    @app.get("/api/admin/queue")
    @admin_required
    def queue_list(): return jsonify(db().query("SELECT * FROM send_queue ORDER BY id DESC LIMIT 300"))
    @app.post("/api/admin/queue/<int:qid>/cancel")
    @admin_required
    def queue_cancel(qid):
        db().run("UPDATE send_queue SET status='canceled',canceled_at=? WHERE id=? AND status='pending'", (now_j_str(),qid)); log('لغو صف ارسال', str(qid)); return jsonify({"ok":True})
    @app.post("/api/admin/backup")
    @admin_required
    def backup_now():
        p=backup_mod.create_backup(db(),key_(),reason='manual'); return jsonify({"ok":True,"name":p.name})
    @app.get("/api/admin/backups")
    @admin_required
    def backups_list(): return jsonify(backup_mod.list_backups())
    @app.get("/api/admin/backups/<path:name>/download")
    @admin_required
    def backup_download(name): return send_file(BACKUP_DIR/Path(name).name, as_attachment=True, download_name=Path(name).name)
    @app.post("/api/admin/restore")
    @admin_required
    def restore():
        d=request.json or {}
        if not d.get('confirm'): raise ValueError('برای بازیابی باید تایید کنید')
        backup_mod.restore_backup(db(),key_(),d.get('filename','')); return jsonify({"ok":True})
    @app.post("/api/admin/backup/send")
    @admin_required
    def backup_send():
        p=backup_mod.create_backup(db(),key_(),reason='manual-send'); qid=queue_mod.enqueue(db,'backup',p,'backup'); return jsonify({"ok":True,"queue_id":qid})
    @app.get("/api/admin/activity")
    @admin_required
    def activity(): return jsonify(db().query("SELECT * FROM activity_log ORDER BY id DESC LIMIT 1000"))
    @app.get("/api/admin/activity/export")
    @admin_required
    def activity_export():
        rows=db().query("SELECT * FROM activity_log ORDER BY id")
        out=io.StringIO(); out.write('id,at,shift,action,detail\n')
        import csv; w=csv.writer(out); [w.writerow([r['id'],r['at'],r['shift_label'],r['action'],r['detail']]) for r in rows]
        return send_file(io.BytesIO(out.getvalue().encode('utf-8-sig')), mimetype='text/csv', as_attachment=True, download_name=f'activity-{date_j_str().replace("/","-")}.csv')
    @app.get("/api/admin/errors")
    @admin_required
    def errors_list(): return jsonify(db().query("SELECT * FROM error_log ORDER BY id DESC LIMIT 500"))
    @app.get("/api/admin/errors/export")
    @admin_required
    def errors_export():
        rows=db().query("SELECT * FROM error_log ORDER BY id"); text='\n\n'.join(f"{r['at']} {r['level']} {r['message']}\n{r['traceback']}" for r in rows)
        return send_file(io.BytesIO(text.encode('utf-8')), mimetype='text/plain', as_attachment=True, download_name=f'errors-{date_j_str().replace("/","-")}.txt')
    @app.get("/api/problems")
    @login_required
    def problems_list(): return jsonify(db().query("SELECT * FROM problem_reports ORDER BY id DESC LIMIT 300"))
    @app.post("/api/problems")
    @login_required
    def problem_add():
        text=(request.json or {}).get('text','').strip()
        if not text: raise ValueError('متن گزارش مشکل خالی است')
        db().run("INSERT INTO problem_reports(at,shift_label,text) VALUES(?,?,?)", (now_j_str(),shift_label(),text)); log('گزارش مشکل', text[:100]); return jsonify({"ok":True})
    @app.get("/api/training")
    @login_required
    def training_list(): return jsonify(db().query("SELECT * FROM training_pages ORDER BY sort,id"))
    @app.post("/api/training")
    @admin_required
    def training_add():
        d=request.json or {}; iid=db().run("INSERT INTO training_pages(title,body,sort,updated_at) VALUES(?,?,?,?)", (d.get('title',''),d.get('body',''),int(d.get('sort',0)),now_j_str())); log('افزودن آموزش', d.get('title','')); return jsonify({"ok":True,"id":iid})
    @app.put("/api/training/<int:tid>")
    @admin_required
    def training_edit(tid):
        d=request.json or {}; db().run("UPDATE training_pages SET title=?,body=?,sort=?,updated_at=? WHERE id=?", (d.get('title',''),d.get('body',''),int(d.get('sort',0)),now_j_str(),tid)); log('ویرایش آموزش', str(tid)); return jsonify({"ok":True})
    @app.get("/api/admin/archives")
    @admin_required
    def archives_list(): return jsonify(db().query("SELECT * FROM monthly_archives ORDER BY year DESC,month DESC"))
    @app.post("/api/admin/archives")
    @admin_required
    def archive_now():
        d=request.json or {}; y=int(d.get('year',today_j().year)); m=int(d.get('month',today_j().month)); p=backup_mod.create_monthly_archive(db(),key_(),y,m); return jsonify({"ok":True,"filename":p.name})
    @app.get("/api/admin/archives/<int:aid>/download")
    @admin_required
    def archive_download(aid):
        r=db().one("SELECT * FROM monthly_archives WHERE id=?", (aid,)); return send_file(r['path'], as_attachment=True, download_name=r['filename'])
    @app.post("/api/admin/update")
    @admin_required
    def update_upload():
        f=request.files.get('file')
        if not f or not f.filename.lower().endswith('.zip'): raise ValueError('فایل بروزرسانی باید ZIP باشد')
        UPDATE_DIR.mkdir(parents=True, exist_ok=True)
        raw=f.read(); path=UPDATE_DIR/secure_filename(f.filename); path.write_bytes(raw)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            names=z.namelist()
            if not any(n.endswith('VERSION.json') for n in names): raise ValueError('بسته بروزرسانی معتبر نیست؛ VERSION.json ندارد')
            changelog=''
            for n in names:
                if n.endswith('CHANGELOG.md'): changelog=z.read(n).decode('utf-8','replace'); break
        backup_mod.create_backup(db(),key_(),reason='pre-update')
        db().run("INSERT OR REPLACE INTO settings(key,value) VALUES('pending_changelog',?)", (changelog,))
        log('آپلود بروزرسانی', path.name)
        return jsonify({"ok":True,"staged":str(path),"message":"بسته دریافت شد. برای اعمال، برنامه را ببندید و دوباره start.bat را اجرا کنید؛ اعمال بروزرسانی هنگام راه‌اندازی انجام می‌شود."})
    @app.get("/api/admin/changelog")
    @admin_required
    def changelog_get():
        row=db().one("SELECT value FROM settings WHERE key='pending_changelog'"); return jsonify({"changelog":row['value'] if row else ''})
    @app.post("/api/admin/changelog/seen")
    @admin_required
    def changelog_seen(): db().run("INSERT OR REPLACE INTO settings(key,value) VALUES('pending_changelog','')"); return jsonify({"ok":True})
    @app.get("/api/admin/logo")
    @admin_required
    def logo_info(): return jsonify({"exists":LOGO_FILE.exists()})
    @app.post("/api/admin/logo")
    @admin_required
    def logo_upload():
        f=request.files.get('file')
        if not f: raise ValueError('فایل لوگو ارسال نشد')
        raw=f.read(); LOGO_FILE.write_bytes(raw); log('آپلود لوگو',''); return jsonify({"ok":True})

    # background maintenance (not in tests)
    if not testing and key:
        _start_worker(app)
    return app

def _start_worker(app):
    if app.extensions.get("ps_worker"): return
    app.extensions["ps_worker"] = True
    def worker():
        while True:
            try:
                with app.app_context():
                    database=app.extensions.get("ps_db"); key=app.extensions.get("ps_key")
                    if database and key:
                        backup_mod.ensure_daily_backup(database, key)
                        backup_mod.ensure_monthly_archive(database, key)
                        queue_mod.process_queue(database)
            except Exception:
                pass
            time.sleep(QUEUE_RETRY_SECONDS)
    threading.Thread(target=worker, daemon=True).start()

def _attach_db(app, key):
    database = Database(key, DB_FILE)
    seed(database)
    app.extensions["ps_db"] = database; app.extensions["ps_key"] = key
    app.secret_key = security.session_secret(key)
    try:
        backup_mod.ensure_daily_backup(database, key)
        backup_mod.ensure_monthly_archive(database, key)
        backup_mod.mirror_catalogs()
    except Exception:
        pass

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--host', default=DEFAULT_HOST); ap.add_argument('--port', type=int, default=DEFAULT_PORT); ap.add_argument('--data-dir'); ap.add_argument('--master-password')
    args=ap.parse_args()
    if args.host not in ('127.0.0.1','localhost'):
        raise SystemExit('طبق الزام امنیتی، برنامه فقط روی 127.0.0.1 اجرا می‌شود')
    app=create_app(data_dir=args.data_dir, master_password=args.master_password)
    print(f"{APP_NAME} v{__version__} — http://127.0.0.1:{args.port}")
    app.run(host='127.0.0.1', port=args.port, debug=False, use_reloader=False)

if __name__ == '__main__':
    main()
