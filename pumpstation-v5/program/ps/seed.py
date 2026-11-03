"""Initial data required by Build Prompt V5. Registry is data-driven; admins can
add/edit records later without code changes. Missing source Excel row 20 and the
ambiguous transformer row are intentionally left for the client's complete list.
"""
from werkzeug.security import generate_password_hash
from .jalali import now_j_str

CATEGORIES = [
    ("valves", "شیرآلات", 1),
    ("instruments", "ابزار دقیق", 2),
    ("motors_pumps", "موتورها و الکتروپمپ‌ها", 3),
    ("automation", "سیستم‌ها و تجهیزات اتوماسیون/اتاق کنترل", 4),
    ("tools", "ابزارآلات و آچارها", 5),
    ("lv_panels", "تابلوهای فشار ضعیف", 6),
    ("mv_panels", "تابلوهای فشار متوسط", 7),
    ("transformers", "ترانس‌ها", 8),
    ("auxiliary", "تجهیزات جانبی و پشتیبان", 9),
]

GROUPS = [
    ("A", "شیفت A", "1111", "operator", ["سعید شریفی", "یزدان صفری"]),
    ("B", "شیفت B", "2222", "operator", ["جواد کاظمی", "حسین طیبانی"]),
    ("C", "شیفت C", "3333", "operator", ["محسن نقی‌پور", "یوسف نادری"]),
    ("admin", "ادمین", "9999", "admin", ["ادمین سیستم"]),
]

PROCESS_PARAMS = [
    ("PIT-001", "فشار تونل / مکش", "bar"),
    ("PIT-002", "فشار خط رانش", "bar"),
    ("PIT-003", "فشار سرچ تانک ۱", "bar"),
    ("PIT-004", "فشار سرچ تانک ۲", "bar"),
    ("FIT-001", "دبی لحظه‌ای", "L/s"),
    ("LT-01", "ارتفاع مخزن تصفیه‌خانه ۱", "cm"),
    ("LT-02", "ارتفاع مخزن تصفیه‌خانه ۲", "cm"),
]
MOTOR_PARAMS = (
    [(f"I{i}", f"جریان فاز {i}", "A") for i in (1,2,3)] +
    [(f"T{i}", f"دمای {i}", "°C") for i in range(1,11)] +
    [("BRG-P-DE", "یاتاقان پمپ DE", "°C"), ("BRG-P-NDE", "یاتاقان پمپ NDE", "°C")] +
    [(f"VIB-{p}", f"لرزش {label}", "mm/s") for p,label in [("P-DE","پمپ جلو"),("P-NDE","پمپ عقب"),("M-DE","موتور جلو"),("M-NDE","موتور عقب")]]
)

def _eq(tag, cat, name, spec="", location="", status="ready", run_state="off", motor=0, aux=0, safety=0, plate="", parts=""):
    return (tag, cat, name, spec, plate, parts, location, status, run_state, motor, aux, safety, now_j_str(), now_j_str())

def equipment_rows(cat_ids):
    c = cat_ids; rows = []
    for i in range(1,9):
        m = f"M-{i:02d}"; p = f"P-{i:02d}"
        rows.append(_eq(m, c["motors_pumps"], f"موتور اصلی اسلیپ‌رینگ {m}", "1800 kW / 6.6 kV", "مغار اصلی", motor=1, status="running" if i in (1,2,3,4,7) else "ready", run_state="on" if i in (1,2,3,4,7) else "off"))
        rows.append(_eq(p, c["motors_pumps"], f"پمپ اصلی {p}", "500 L/s / هد 220 m", "مغار اصلی", status="running" if i in (1,2,3,4,7) else "ready", run_state="on" if i in (1,2,3,4,7) else "off"))
        rows.append(_eq(f"RS-{i:02d}", c["lv_panels"], f"استارتر مقاومتی {m}", "استارت مقاومتی", "اتاق استارتر", status="in_warehouse" if i==8 else "ready"))
    aux_pumps = {
        "P-11":"خنک‌کن هیتر چنجر ۱","P-12":"خنک‌کن هیتر چنجر ۲","P-13":"خنک‌کن موتورها ۱","P-14":"خنک‌کن موتورها ۲",
        "P-15":"خنک‌کن ترانس‌ها ۱","P-16":"خنک‌کن ترانس‌ها ۲","P-17":"خنک‌کن پکیج","P-18":"خنک‌کن هواساز","P-19":"میکاپ",
        "P-21":"آتش‌نشانی ۱","P-22":"آتش‌نشانی ۲"}
    for tag, name in aux_pumps.items():
        rows.append(_eq(tag, c["motors_pumps"], f"پمپ {name}", "400 V", "تاسیسات", aux=1, safety=tag in ("P-21","P-22")))
    for i in range(1,5): rows.append(_eq(f"DP-{i:02d}", c["motors_pumps"], f"کفکش/چاهک {i}", "400 V", "چاهک‌ها", aux=1))
    for i in (1,2): rows.append(_eq(f"COMP-{i:02d}", c["auxiliary"], f"کمپرسور سرچ تانک {i}", "11 kW / 400 V", "انتهای مغار", aux=1))
    for i in range(1,5): rows.append(_eq(f"F-{i:02d}", c["auxiliary"], f"فن {i}", "400 V", "تهویه", aux=1))
    rows += [
        _eq("GEN-01", c["auxiliary"], "دیزل ژنراتور تونل", "200 kVA / 400 V", "تونل", aux=1, safety=1),
        _eq("GEN-02", c["auxiliary"], "دیزل ژنراتور سوله", "150 kVA / 400 V", "سوله", aux=1, safety=1),
        _eq("PKG-01", c["auxiliary"], "پکیج خنک‌کاری", "", "اتاق تاسیسات", aux=1),
        _eq("AHU-01", c["auxiliary"], "هواساز", "", "اتاق تاسیسات", aux=1),
        _eq("TR-01", c["transformers"], "ترانس اصلی ۱", "10 MVA / 20kV/6.6kV", "اتاق ترانس ۱"),
        _eq("TR-02", c["transformers"], "ترانس اصلی ۲", "10 MVA / 20kV/6.6kV", "اتاق ترانس ۲"),
        _eq("TR-03", c["transformers"], "ترانس خشک", "20kV/400V", "اتاق ترانس خشک"),
        _eq("TR-A", c["transformers"], "ترانس هوایی A", "120 kVA", "محوطه", aux=1),
        _eq("TR-B", c["transformers"], "ترانس هوایی B", "120 kVA", "محوطه", aux=1),
        _eq("ST-01", c["auxiliary"], "سرچ تانک ۱", "", "مغار"), _eq("ST-02", c["auxiliary"], "سرچ تانک ۲", "", "مغار"),
    ]
    for i in range(1,5): rows.append(_eq(f"SMP-{i:02d}", c["auxiliary"], f"سامپ {i}", "", "سامپ"))
    for i in range(1,5): rows.append(_eq(f"PIT-{i:03d}", c["instruments"], PROCESS_PARAMS[i-1][1], "ترانسمیتر فشار", "خط فرآیند"))
    rows.append(_eq("FIT-001", c["instruments"], "فلومتر رانش", "L/s", "خط رانش"))
    for i in range(1,13): rows.append(_eq(f"TSH-{i:02d}", c["instruments"], f"تمپرچر سوییچ MV {i}", "", "تابلو MV"))
    for i in (1,2): rows.append(_eq(f"LS-{i:02d}", c["instruments"], f"سطح‌سنج سامپ {i}", "", "سامپ"))
    for i in range(1,9):
        rows.append(_eq(f"XV-{100+i:03d}", c["valves"], f"شیر خروجی موتوردار پمپ {i}", "", f"پمپ {i}"))
        rows.append(_eq(f"XV-{200+i:03d}", c["valves"], f"شیر ورودی پمپ {i}", "", f"پمپ {i}"))
    rows += [
        _eq("XV-301", c["valves"], "شیر دلیوژ آتش‌نشانی ترانس ۱", "", "ترانس ۱", safety=1),
        _eq("XV-302", c["valves"], "شیر دلیوژ آتش‌نشانی ترانس ۲", "", "ترانس ۲", safety=1),
        _eq("RV-01", c["valves"], "شیر اطمینان سامپ ۱", "", "سامپ", safety=1),
        _eq("RV-02", c["valves"], "شیر اطمینان سامپ ۲", "", "سامپ", safety=1),
        _eq("UPS-1", c["automation"], "UPS ۱", "", "اتاق کنترل", safety=1),
        _eq("UPS-2", c["automation"], "UPS ۲", "", "اتاق کنترل", safety=1),
        _eq("UPS-3", c["automation"], "UPS ۳", "", "اتاق کنترل", safety=1),
        _eq("SIREN-01", c["automation"], "سیرن اعلام حریق", "", "ایستگاه", safety=1),
        _eq("PLC-400H", c["automation"], "PLC-400H", "", "اتاق کنترل"),
        _eq("IRP", c["automation"], "تابلو IRP", "", "اتاق کنترل"),
    ]
    for tag in ["BATTERY CHARGER","METERING","COUPL","INCOMING-A","INCOMING-B","TR1","TR2","TR3","BUSVT-1","BUSVT-2","RISER-VT","LVS1","LVS2","BAT-CHG","SW-PNL-1","SW-PNL-2","TNLP-1","TNLP-2","NLP"]:
        rows.append(_eq(tag, c["mv_panels"] if tag in ("INCOMING-A","INCOMING-B","TR1","TR2","TR3","BUSVT-1","BUSVT-2","RISER-VT","COUPL") else c["lv_panels"], f"تابلو {tag}", "", "اتاق برق"))
    for i in range(1,9):
        rows.append(_eq(f"MOTOR-{i:02d}", c["mv_panels"], f"تابلو موتور {i}", "", "اتاق برق MV"))
        rows.append(_eq(f"CP-{i:02d}", c["lv_panels"], f"تابلو کنترل پمپ {i}", "", "اتاق کنترل"))
    for tag in ["MOV-1400-01","MOV-1400-02","MOV-1400-03","MOV-800-01","MOV-800-02","NC-1000-01","NC-1000-02","SV-01","SV-02"]:
        rows.append(_eq(tag, c["valves"], f"شیر {tag}", "", "خطوط فرآیند"))
    for i in range(1,8): rows.append(_eq(f"AV-{i:02d}", c["valves"], f"شیر تخلیه هوا رانش {i}", "", "خط رانش"))
    # Fixed piping components have registry records but no independent HMI tag.
    for i, name in enumerate(["دیجی","زانو","تبدیل","لرزه‌گیر","صافی"], start=1):
        rows.append(_eq(f"PIPE-FIT-{i:03d}", c["auxiliary"], f"{name} (اتصال ثابت لوله‌کشی)", "بدون تگ مستقل", "خطوط لوله‌کشی"))
    return rows

def seed(db):
    if db.one("SELECT key FROM groups LIMIT 1"): return
    now = now_j_str()
    for key,label,pin,role,members in GROUPS:
        db.run("INSERT INTO groups(key,label,pin_hash,role) VALUES(?,?,?,?)", (key,label,generate_password_hash(pin),role))
        for name in members: db.run("INSERT INTO members(group_key,name,phone) VALUES(?,?, '')", (key,name))
    cat_ids = {}
    for slug,name,sort in CATEGORIES:
        cid = db.run("INSERT INTO equipment_categories(name,slug,sort) VALUES(?,?,?)", (name,slug,sort)); cat_ids[slug]=cid
    for row in equipment_rows(cat_ids):
        db.run("""INSERT INTO equipment(tag,category_id,name,spec,plate,part_numbers,location,status,run_state,is_motor_main,monitored_aux,safety_critical,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", row)
    for i in range(1,9):
        m = db.one("SELECT id FROM equipment WHERE tag=?", (f"M-{i:02d}",))
        state = "on" if i in (1,2,3,4,7) else "off"
        db.run("INSERT INTO motors(tag,pump_tag,equipment_id,state,hmi_hours,last_service_hours,service_interval,state_changed_at,state_changed_shift) VALUES(?,?,?,?,?,?,?,?,?)",
               (f"M-{i:02d}", f"P-{i:02d}", m["id"], state, 0, 0, 2500, now, "شیفت A"))
        db.run("INSERT INTO motor_state_history(motor_id,new_state,shift_label,at,note) VALUES(?,?,?,?,?)", (i,state,"شیفت A",now,"وضعیت اولیه"))
    for tag,label,unit in PROCESS_PARAMS:
        db.run("INSERT INTO setpoints(key,scope,param,label,unit,updated_at) VALUES(?,?,?,?,?,?)", (f"process:{tag}","process",tag,label,unit,now))
    for param,label,unit in MOTOR_PARAMS:
        db.run("INSERT INTO setpoints(key,scope,param,label,unit,updated_at) VALUES(?,?,?,?,?,?)", (f"motor:{param}","motor",param,label,unit,now))
        if param.startswith("VIB-"):
            db.run("UPDATE setpoints SET warn_max=?,crit_max=? WHERE key=?", (4.5,7.1,f"motor:{param}"))
    db.run("INSERT INTO setpoints(key,scope,param,label,unit,updated_at) VALUES('service:interval','service','interval','بازه سرویس موتورها','h',?)", (now,))
    db.run("UPDATE setpoints SET warn_max=2500 WHERE key='service:interval'")
    for key in ("active_shift","first_admin_pin_change_prompted","last_backup_date","last_archive_month","pending_changelog"):
        db.run("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, "A" if key=="active_shift" else ""))
    for key in ("daily","backup"):
        db.run("INSERT INTO channels(key,provider,chat_id,token,enabled) VALUES(?,?,?,?,0)", (key,"bale","",""))
    for slug,name,sort in CATEGORIES:
        db.run("INSERT INTO pm_templates(category_id,name,items_json,updated_at) VALUES(?,?,?,?)", (cat_ids[slug], f"چک‌لیست عمومی {name}", "[]", now))
    db.run("INSERT INTO training_pages(title,body,sort,updated_at) VALUES(?,?,?,?)", ("شروع کار با سامانه", "از داشبورد شروع کنید. در هر بازه ۴ساعته مقدار پارامترها را وارد کنید و Enter بزنید. هشدارها فقط بصری هستند.", 1, now))
    db.run("INSERT INTO activity_log(at,shift_label,action,detail) VALUES(?,?,?,?)", (now,"سیستم","نصب اولیه","داده‌های اولیه نسخه ۵ ساخته شد"))
    db.commit()
