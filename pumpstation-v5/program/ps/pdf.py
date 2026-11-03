"""Offline Persian PDF generation. Every print action in the UI prints a PDF.
Header contains only the regional water organization name and logo.
"""
from pathlib import Path
import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.styles import ParagraphStyle
import arabic_reshaper
from bidi.algorithm import get_display
from .config import FONT_REGULAR, FONT_BOLD, LOGO_FILE, ORG_NAME
from .jalali import weekday_fa, date_j_str, now_j_str

_registered = False
def fa(text):
    return get_display(arabic_reshaper.reshape(str(text if text is not None else "")))

def register_fonts():
    global _registered
    if _registered: return
    pdfmetrics.registerFont(TTFont("Vazir", str(FONT_REGULAR)))
    pdfmetrics.registerFont(TTFont("Vazir-Bold", str(FONT_BOLD)))
    _registered = True

def styles():
    register_fonts()
    return {
        "title": ParagraphStyle("title", fontName="Vazir-Bold", fontSize=14, alignment=2, leading=20),
        "h": ParagraphStyle("h", fontName="Vazir-Bold", fontSize=11, alignment=2, leading=17),
        "p": ParagraphStyle("p", fontName="Vazir", fontSize=9, alignment=2, leading=15),
        "small": ParagraphStyle("small", fontName="Vazir", fontSize=8, alignment=2, leading=12),
        "cell": ParagraphStyle("cell", fontName="Vazir", fontSize=8.5, alignment=2, leading=13),
        "cellc": ParagraphStyle("cellc", fontName="Vazir", fontSize=8.5, alignment=1, leading=13),
    }

def P(text, st="p"): return Paragraph(fa(text), styles()[st])

def header(canvas, doc):
    canvas.saveState()
    w,h = A4
    if LOGO_FILE.exists():
        try: canvas.drawImage(str(LOGO_FILE), w-30*mm, h-24*mm, 16*mm, 16*mm, preserveAspectRatio=True, mask='auto')
        except Exception: pass
    canvas.setFont("Vazir-Bold", 11)
    canvas.drawCentredString(w/2, h-18*mm, fa(ORG_NAME))
    canvas.setStrokeColor(colors.HexColor("#16606b")); canvas.setLineWidth(1)
    canvas.line(15*mm, h-26*mm, w-15*mm, h-26*mm)
    canvas.setFont("Vazir", 8)
    canvas.drawString(15*mm, 10*mm, fa("تاریخ تولید: " + now_j_str()))
    canvas.drawRightString(w-15*mm, 10*mm, fa("صفحه " + str(doc.page)))
    canvas.restoreState()

def table(rows, widths=None, header=True):
    st = styles()
    data = [[P(c, "cell" if header and i==0 else "cell") for c in row] for i,row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="CENTER")
    cmds = [("GRID",(0,0),(-1,-1),0.4,colors.HexColor("#9aa7ad")),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4),("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3)]
    if header: cmds += [("BACKGROUND",(0,0),(-1,0),colors.HexColor("#16606b")),("TEXTCOLOR",(0,0),(-1,0),colors.white)]
    t.setStyle(TableStyle(cmds)); return t

def build_pdf(path, story):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=15*mm, leftMargin=15*mm, topMargin=32*mm, bottomMargin=18*mm)
    doc.build(story, onFirstPage=header, onLaterPages=header)
    return str(path)

def daily_report(path, ctx):
    s = styles(); story = []
    title = "گزارش روزانه ایستگاه پمپاژ زیرزمینی"
    if ctx.get("correction"): title += f" — اصلاحی ({ctx.get('correction_time','')})"
    story += [P(title,"title"), Spacer(1,4*mm)]
    story += [P(f"{weekday_fa(ctx.get('gregorian_date'))} — {ctx['date']} — {ctx['shift_label']} — اپراتورها: {ctx['operators']}","h"), Spacer(1,3*mm)]
    rows = [["تگ","توضیح فارسی","مقدار"]]
    for r in ctx["process_rows"]:
        val = str(r["value"]) if r["value"] is not None else "—"
        if r.get("out_of_setpoint"): val += " *"
        rows.append([r["tag"], r["label"], val])
    rows.append(["TOTAL-FIT", "توتال روزانه دبی (m³)", str(ctx.get("daily_total") if ctx.get("daily_total") is not None else "—")])
    story += [P("پارامترهای فرآیندی","h"), table(rows, [35*mm,95*mm,40*mm]), Spacer(1,3*mm)]
    on = ctx.get("motors_on") or []
    story += [P("موتورهای روشن","h"), P("، ".join(on) if on else "هیچ موتوری روشن ثبت نشده است"), Spacer(1,3*mm)]
    story += [P("گزارش دستی اپراتور","h"), P(ctx.get("operator_text") or "—"), Spacer(1,3*mm)]
    sched = ctx.get("schedule") or []
    if sched:
        story += [P("جابجایی/مرخصی امروز","h")]
        for x in sched: story += [P(f"{x['time']} — {x['type_label']} — {x['member']} ← جایگزین: {x['replacement']} — {x.get('note','')}")]
        story += [Spacer(1,3*mm)]
    if ctx.get("has_stars"):
        story += [P("* مقدار ثبت‌شده خارج از محدوده هشدار ست‌پوینت است؛ ثبت انجام شده و فقط جهت اطلاع علامت‌گذاری شده است.","small"), Spacer(1,3*mm)]
    story += [table([["اپراتور","سرپرست ایستگاه پمپاژ","مدیر پروژه"],["","",""]], [60*mm,60*mm,50*mm], header=True)]
    return build_pdf(path, story)

def simple_pdf(path, title, subtitle, sections):
    story = [P(title,"title"), Spacer(1,3*mm), P(subtitle,"h"), Spacer(1,3*mm)]
    for sec in sections:
        story += [P(sec["title"],"h"), Spacer(1,1*mm)]
        if sec.get("text"): story += [P(sec["text"]), Spacer(1,2*mm)]
        if sec.get("rows"): story += [table(sec["rows"], sec.get("widths")), Spacer(1,3*mm)]
    return build_pdf(path, story)
