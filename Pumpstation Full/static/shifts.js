// صفحه شیفت‌ها، مرخصی و جابجایی
let USERS = [];
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('s-date').value = jTodayStr();
  USERS = await api('/api/users');
  const uSel = document.getElementById('s-user');
  const rSel = document.getElementById('s-replacement');
  uSel.innerHTML = USERS.map(u => `<option value="${u.id}">${esc(u.name)} — شیفت ${esc(u.shift)}</option>`).join('');
  rSel.innerHTML = `<option value="">—</option>` + USERS.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');

  document.getElementById('sched-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const val = id => document.getElementById(id).value;
    try {
      await api('/api/schedule', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          user_id: +val('s-user'), date: val('s-date'), type: val('s-type'),
          replacement_id: val('s-replacement') ? +val('s-replacement') : null,
          note: val('s-note')
        })
      });
      msg(document.getElementById('s-msg'), '✓ ثبت شد', true);
      document.getElementById('s-note').value = '';
      loadSchedule(); loadUsers();
    } catch (e) { msg(document.getElementById('s-msg'), e.message, false); }
  });

  document.getElementById('s-print').addEventListener('click', () => window.print());
  loadUsers();
  loadSchedule();
});

async function loadUsers() {
  const scheds = await api('/api/schedule');
  const today = jTodayStr();
  const onLeave = new Set(scheds.filter(s => s.date === today && s.type === 'leave').map(s => s.user_id));
  document.querySelector('#users-table tbody').innerHTML = USERS.map(u => `
    <tr>
      <td><b>${esc(u.name)}</b></td>
      <td><span class="badge info">شیفت ${esc(u.shift)}</span></td>
      <td>${onLeave.has(u.id) ? '<span class="badge danger">امروز مرخصی</span>' : '<span class="badge ok">در شیفت</span>'}</td>
    </tr>`).join('');
}

async function loadSchedule() {
  const rows = await api('/api/schedule');
  document.querySelector('#sched-table tbody').innerHTML = rows.map(s => `
    <tr>
      <td>${faDate(s.date)}</td>
      <td><b>${esc(s.user_name)}</b></td>
      <td><span class="badge info">شیفت ${esc(s.user_shift)}</span></td>
      <td>${s.type === 'leave' ? '<span class="badge warn">مرخصی</span>' : '<span class="badge info">جابجایی</span>'}</td>
      <td>${esc(s.replacement_name) || '—'}</td>
      <td>${esc(s.note) || '—'}</td>
      <td><button class="btn danger-ghost" data-del="${s.id}">حذف</button></td>
    </tr>`).join('');
  document.querySelectorAll('#sched-table [data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('این رکورد حذف شود؟')) return;
    await api('/api/schedule/' + b.dataset.del, {method: 'DELETE'});
    loadSchedule(); loadUsers();
  }));
}
