// صفحه ورود اطلاعات
document.addEventListener('DOMContentLoaded', async () => {
  await fillEquipmentSelect(document.getElementById('f-equipment'));
  await fillEquipmentSelect(document.getElementById('filter-equipment'), 'همه تجهیزات');
  document.getElementById('f-date').value = jTodayStr();

  const form = document.getElementById('reading-form');
  const fmsg = document.getElementById('form-msg');
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const val = id => document.getElementById(id).value;
    try {
      await api('/api/readings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          equipment_id: val('f-equipment'), date: val('f-date'), time: val('f-time'),
          temp: val('f-temp'), current: val('f-current'), voltage: val('f-voltage'),
          hours: val('f-hours'), pressure: val('f-pressure'),
          note: val('f-note'), operator: val('f-operator')
        })
      });
      msg(fmsg, '✓ با موفقیت ثبت شد', true);
      form.querySelectorAll('input[type=number], input[type=text]').forEach(i => { if (i.id !== 'f-date') i.value = ''; });
      loadReadings();
    } catch (e) { msg(fmsg, e.message, false); }
  });

  document.getElementById('btn-refresh').addEventListener('click', loadReadings);
  document.getElementById('filter-equipment').addEventListener('change', loadReadings);
  document.getElementById('filter-days').addEventListener('change', loadReadings);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  loadReadings();
});

async function loadReadings() {
  const tbody = document.querySelector('#readings-table tbody');
  const cap = document.querySelector('#readings-table caption');
  const eid = document.getElementById('filter-equipment').value;
  const days = document.getElementById('filter-days').value;
  const url = `/api/readings?limit=500` + (eid ? `&equipment_id=${eid}` : '');
  const rows = await api(url);
  // فیلتر روزها روی تاریخ شمسی: تبدیل مرز به شمسی
  const fromG = new Date(Date.now() - days * 86400000);
  const fromJ = fromG.toLocaleDateString('fa-IR-u-nu-latn', {year:'numeric', month:'2-digit', day:'2-digit'});
  const filtered = rows.filter(r => r.date >= fromJ);
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td>${faDate(r.date)}</td>
      <td>${esc(r.time) || '—'}</td>
      <td><b>${esc(r.tag)}</b> ${esc(r.name).split('—')[1] || ''}</td>
      <td class="num">${FA1(r.temp)}</td>
      <td class="num">${FA1(r.current)}</td>
      <td class="num">${FA(r.voltage)}</td>
      <td class="num">${FA1(r.hours)}</td>
      <td class="num">${FA1(r.pressure)}</td>
      <td>${esc(r.operator) || '—'}</td>
      <td><button class="btn danger-ghost" data-del="${r.id}">حذف</button></td>
    </tr>`).join('');
  cap.hidden = filtered.length > 0;
  tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('این رکورد حذف شود؟')) return;
    await api('/api/readings/' + b.dataset.del, {method: 'DELETE'});
    loadReadings();
  }));
}
