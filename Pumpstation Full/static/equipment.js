// پرونده تجهیزات
const CAT_FA = {
  pump:'پمپ', motor:'الکتروموتور', transformer:'ترانس', panel:'تابلو',
  valve:'شیرآلات', instrument:'ابزار دقیق', other:'سایر'
};
let LIST = [];

async function loadList(){
  const q = document.getElementById('q').value.trim();
  const cat = document.getElementById('cat').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cat) params.set('category', cat);
  const res = await fetch('/api/equipment?' + params);
  LIST = await res.json();
  document.getElementById('count').textContent = LIST.length + ' تجهیز';
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = LIST.map(e => `
    <tr>
      <td><b>${e.tag}</b></td>
      <td>${e.name}</td>
      <td>${CAT_FA[e.category] || e.category}</td>
      <td>${e.spec || ''}</td>
      <td>${e.location || ''}</td>
      <td>${e.plate || ''}</td>
      <td>${e.catalog_no || ''}</td>
      <td>${e.order_no || ''}</td>
      <td><button class="small" onclick="openDossier(${e.id})">پرونده</button></td>
    </tr>`).join('');
}

async function openDossier(id){
  const res = await fetch('/api/equipment/' + id);
  const e = await res.json();
  document.getElementById('dossier').style.display = '';
  document.getElementById('d-title').textContent = 'پرونده تجهیز: ' + e.tag + ' — ' + e.name;
  document.getElementById('d-specs').innerHTML = `
    <div class="row">
      <div><label>دسته</label><input value="${CAT_FA[e.category] || e.category}" disabled></div>
      <div><label>مشخصات</label><input value="${e.spec || ''}" disabled></div>
      <div><label>محل نصب</label><input value="${e.location || ''}" disabled></div>
      <div><label>دوره PM (روز)</label><input value="${e.pm_interval_days || ''}" disabled></div>
    </div>`;
  document.getElementById('f-manufacturer').value = e.manufacturer || '';
  document.getElementById('f-plate').value = e.plate || '';
  document.getElementById('f-catalog_no').value = e.catalog_no || '';
  document.getElementById('f-order_no').value = e.order_no || '';
  document.getElementById('f-spec').value = e.spec || '';
  document.getElementById('f-notes').value = e.notes || '';

  const mtb = document.querySelector('#d-maint tbody');
  mtb.innerHTML = e.maintenance.length ? e.maintenance.map(m => `
    <tr><td>${faDate(m.date)}</td><td>${m.type === 'PM' ? 'PM' : (m.type === 'repair' ? 'تعمیر' : m.type)}</td>
    <td>${m.description}</td><td>${m.operator}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">رکوردی ثبت نشده</td></tr>';

  const rtb = document.querySelector('#d-readings tbody');
  rtb.innerHTML = e.readings.length ? e.readings.map(r => `
    <tr><td>${faDate(r.date)}</td><td>${r.time || ''}</td><td>${r.temp ?? ''}</td>
    <td>${r.current ?? ''}</td><td>${r.voltage ?? ''}</td><td>${r.hours ?? ''}</td>
    <td>${r.pressure ?? ''}</td><td>${r.note || ''}</td></tr>`).join('')
    : '<tr><td colspan="8" class="muted">رکوردی ثبت نشده</td></tr>';

  document.getElementById('dossier').scrollIntoView({behavior:'smooth'});
  document.getElementById('btn-save-dossier').onclick = () => saveDossier(id);
}

async function saveDossier(id){
  const body = {
    manufacturer: val('f-manufacturer'),
    plate: val('f-plate'),
    catalog_no: val('f-catalog_no'),
    order_no: val('f-order_no'),
    spec: val('f-spec'),
    notes: val('f-notes')
  };
  await fetch('/api/equipment/' + id, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  document.getElementById('save-msg').textContent = 'ذخیره شد ✓';
  setTimeout(() => document.getElementById('save-msg').textContent = '', 2500);
  loadList();
}

function val(id){ return document.getElementById(id).value.trim(); }

document.getElementById('btn-search').onclick = loadList;
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') loadList(); });
document.getElementById('cat').onchange = loadList;
initUserBar();
loadList();
