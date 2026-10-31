// صفحه تعمیرات و PM
document.addEventListener('DOMContentLoaded', async () => {
  await fillEquipmentSelect(document.getElementById('m-equipment'));
  document.getElementById('m-date').value = jTodayStr();

  document.getElementById('maint-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const val = id => document.getElementById(id).value;
    try {
      await api('/api/maintenance', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          equipment_id: val('m-equipment'), date: val('m-date'),
          type: val('m-type'), description: val('m-desc'), operator: val('m-operator')
        })
      });
      msg(document.getElementById('m-msg'), '✓ ثبت شد', true);
      document.getElementById('m-desc').value = '';
      loadMaint();
    } catch (e) { msg(document.getElementById('m-msg'), e.message, false); }
  });

  loadMaint();
});

async function loadMaint() {
  const rows = await api('/api/maintenance');
  document.querySelector('#maint-table tbody').innerHTML = rows.map(m => `
    <tr>
      <td>${esc(m.date)}</td>
      <td><b>${esc(m.tag)}</b></td>
      <td>${m.type === 'PM'
        ? '<span class="badge ok">PM</span>'
        : '<span class="badge danger">تعمیر</span>'}</td>
      <td>${esc(m.description) || '—'}</td>
      <td>${esc(m.operator) || '—'}</td>
    </tr>`).join('');
}
