// گزارش ماهانه — شمسی
const MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];

document.addEventListener('DOMContentLoaded', async () => {
  const todayJ = jTodayStr(); // مثل 1404/08/09
  const jy = +todayJ.slice(0, 4), jm = +todayJ.slice(5, 7);
  const mSel = document.getElementById('r-month');
  const ySel = document.getElementById('r-year');
  MONTHS.forEach((m, i) => mSel.add(new Option(m, i + 1)));
  mSel.value = jm;
  for (let y = jy - 2; y <= jy; y++) ySel.add(new Option(FA(y), y));
  ySel.value = jy;

  document.getElementById('r-show').addEventListener('click', loadReport);
  document.getElementById('r-print').addEventListener('click', () => window.print());
  document.getElementById('r-excel').addEventListener('click', () => location.href = '/api/export');
  loadReport();
});

async function loadReport() {
  const jy = +document.getElementById('r-year').value;
  const jm = +document.getElementById('r-month').value;
  const data = await api(`/api/report?jyear=${jy}&jmonth=${jm}`);
  const body = document.getElementById('report-body');

  const byEq = {};
  data.rows.forEach(r => {
    if (!byEq[r.equipment_id]) byEq[r.equipment_id] = {tag: r.tag, name: r.name, rows: []};
    byEq[r.equipment_id].rows.push(r);
  });

  let html = `<p class="report-range">بازه گزارش: ${MONTHS[jm - 1]} ${faDate(jy)} —
    از <b>${faDate(data.from)}</b> تا <b>${faDate(data.to)}</b> —
    مجموع <b>${FA(data.rows.length)}</b> رکورد</p>`;

  const groups = Object.values(byEq);
  if (!groups.length) html += '<p class="empty">در این ماه رکوردی ثبت نشده است.</p>';
  groups.forEach(g => {
    const temps = g.rows.map(r => r.temp).filter(v => v != null);
    const currs = g.rows.map(r => r.current).filter(v => v != null);
    const volts = g.rows.map(r => r.voltage).filter(v => v != null);
    const hours = g.rows.map(r => r.hours).filter(v => v != null);
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
    html += `<h3>${esc(g.tag)} — ${esc(g.name)}</h3>
      <div class="table-wrap"><table>
      <thead><tr><th>تاریخ</th><th>ساعت</th><th>دما °C</th><th>جریان A</th><th>ولتاژ V</th><th>ساعت کارکرد</th><th>فشار bar</th><th>اپراتور</th></tr></thead>
      <tbody>${g.rows.map(r => `
        <tr><td>${faDate(r.date)}</td><td>${esc(r.time) || '—'}</td>
        <td class="num">${FA1(r.temp)}</td><td class="num">${FA1(r.current)}</td>
        <td class="num">${FA(r.voltage)}</td><td class="num">${FA1(r.hours)}</td>
        <td class="num">${FA1(r.pressure)}</td><td>${esc(r.operator) || '—'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="summary">میانگین دما: <b>${FA1(avg(temps))}</b> °C — میانگین جریان: <b>${FA1(avg(currs))}</b> A —
      میانگین ولتاژ: <b>${FA(avg(volts))}</b> V — آخرین ساعت کارکرد: <b>${FA1(hours.length ? Math.max(...hours) : null)}</b> h</p>`;
  });

  body.innerHTML = html;
}
