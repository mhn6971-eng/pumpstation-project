// گزارش روزانه شیفت
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('d-date').value = jTodayStr();
  // چک‌باکس پمپ‌ها
  document.getElementById('d-pumps').innerHTML =
    Array.from({length: 8}, (_, i) => `
      <label class="check-item"><input type="checkbox" value="P-0${i + 1}"> P-0${i + 1}</label>`).join('');
  // اگر کاربر وارد شده، شیفت و نامش را پیش‌فرض بگذار
  api('/api/me').then(me => {
    if (me) {
      document.getElementById('d-shift').value = me.shift;
      document.getElementById('d-operator').value = me.name;
    }
  });

  document.getElementById('daily-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const val = id => document.getElementById(id).value;
    const pumps_on = [...document.querySelectorAll('#d-pumps input:checked')].map(c => c.value);
    try {
      await api('/api/daily', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          date: val('d-date'), shift: val('d-shift'), operator: val('d-operator'),
          pumps_on, flow: val('d-flow'), total_flow: val('d-total-flow'), suction: val('d-suction'), discharge: val('d-discharge'),
          tank_inlet: val('d-tank-inlet'), surge_tank1: val('d-surge1'), surge_tank2: val('d-surge2'),
          utility: val('d-utility'), cooling: val('d-cooling'), note: val('d-note')
        })
      });
      msg(document.getElementById('d-msg'), '✓ گزارش شیفت ثبت شد', true);
      document.querySelectorAll('#daily-form input[type=number], #daily-form input[type=text]')
        .forEach(i => { if (i.id !== 'd-date' && i.id !== 'd-operator') i.value = ''; });
      loadDaily();
    } catch (e) { msg(document.getElementById('d-msg'), e.message, false); }
  });

  document.getElementById('d-print').addEventListener('click', () => window.print());
  loadDaily();
});

async function loadDaily() {
  const rows = await api('/api/daily');
  document.querySelector('#daily-table tbody').innerHTML = rows.map(d => `
    <tr>
      <td>${faDate(d.date)}</td>
      <td><span class="badge info">شیفت ${esc(d.shift)}</span></td>
      <td>${esc(d.operator) || '—'}</td>
      <td>${d.pumps_on ? d.pumps_on.split(',').map(p => `<span class="badge ok">${esc(p)}</span>`).join(' ') : '—'}</td>
      <td class="num">${FA1(d.flow)}</td><td class="num">${FA1(d.total_flow)}</td>
      <td class="num">${FA1(d.suction)}</td>
      <td class="num">${FA1(d.discharge)}</td>
      <td class="num">${FA1(d.tank_inlet)}</td>
      <td class="num">${FA1(d.surge_tank1)}</td>
      <td class="num">${FA1(d.surge_tank2)}</td>
      <td>${esc(d.utility) || '—'}</td>
      <td>${esc(d.cooling) || '—'}</td>
      <td>${esc(d.note) || '—'}</td>
      <td><button class="btn danger-ghost" data-del="${d.id}">حذف</button></td>
    </tr>`).join('');
  document.querySelectorAll('#daily-table [data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('این گزارش حذف شود؟')) return;
    await api('/api/daily/' + b.dataset.del, {method: 'DELETE'});
    loadDaily();
  }));
}
