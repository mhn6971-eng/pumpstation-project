import datetime, jdatetime

WEEKDAYS = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"]
MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"]

def now(): return datetime.datetime.now()
def today_j(): return jdatetime.date.today()
def now_j_str(): return jdatetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")
def date_j_str(d=None): return (d or jdatetime.date.today()).strftime("%Y/%m/%d")
def time_str(d=None): return (d or datetime.datetime.now()).strftime("%H:%M:%S")
def weekday_fa(d=None):
    d = d or datetime.date.today()
    return WEEKDAYS[d.weekday()]
def to_j(d): return jdatetime.date.fromgregorian(date=d)
def to_g(d): return d.togregorian()
def parse_j(s):
    y,m,d = [int(x) for x in s.replace('-', '/').split('/')[:3]]
    return jdatetime.date(y,m,d)
def month_days(y,m):
    if m <= 6: return 31
    if m <= 11: return 30
    return 30 if jdatetime.date(y,12,30).togregorian() else 29

def shift_day(d=None):
    """Operational day starts 07:00. Before 07:00 belongs to previous day."""
    n = d or now()
    gd = n.date()
    if n.hour < 7: gd -= datetime.timedelta(days=1)
    return to_j(gd)
INTERVALS = [(7,11),(11,15),(15,19),(19,23),(23,3),(3,7)]
def interval_index(d=None):
    h = (d or now()).hour
    for i,(a,b) in enumerate(INTERVALS):
        if a < b:
            if a <= h < b: return i
        else:
            if h >= a or h < b: return i
    return 0
def interval_label(i):
    a,b = INTERVALS[i]; return f"{a}-{b}"
def interval_start_time(i): return f"{INTERVALS[i][0]:02d}:00"
