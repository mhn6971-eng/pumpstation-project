// ترند PLC
Chart.defaults.font.family = "Vazirmatn, Tahoma";
Chart.defaults.color = "#5e7280";
let plcChart = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('plc-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData();
    fd.append('file', document.getElementById('plc-file').files[0]);
    fd.append('tag', document.getElementById('plc-tag').value || 'PLC');
    const m = document.getElementById('plc-msg');
    m.textContent = 'در حال پردازش...'; m.className = '';
    try {
      const r = await fetch('/api/plc/import', {method: 'POST', body: fd});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'خطا');
      m.textContent = `✓ ${Number(j.rows).toLocaleString('fa-IR')} ردیف ذخیره شد (بازه ${j.from} تا ${j.to})`;
      m.className = 'ok';
      loadTags(); draw();
    } catch (e) { m.textContent = e.message; m.className = 'err'; }
  });
  document.getElementById('plc-refresh').addEventListener('click', draw);
  document.getElementById('plc-gran').addEventListener('change', draw);
  document.getElementById('plc-days').addEventListener('change', draw);
  document.getElementById('plc-tag-filter').addEventListener('change', draw);
  loadTags().then(draw);
});

async function loadTags() {
  const sel = document.getElementById('plc-tag-filter');
  const data = await api('/api/plc');
  sel.innerHTML = `<option value="">همه منابع</option>` +
    data.tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
}

async function draw() {
  const gran = document.getElementById('plc-gran').value;
  const days = +document.getElementById('plc-days').value;
  const tag = document.getElementById('plc-tag-filter').value;
  // مرز زمانی به فرمت ذخیره plc_data (میلادی)
  const to = new Date();
  const from = new Date(Date.now() - days * 86400000);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const url = `/api/plc?granularity=${gran}&from=${fmt(from)}&to=${fmt(to)}` + (tag ? `&tag=${encodeURIComponent(tag)}` : '');
  const data = await api(url);
  const rows = data.rows;
  document.getElementById('plc-info').textContent =
    rows.length ? `${Number(rows.reduce((a, r) => a + r.n, 0)).toLocaleString('fa-IR')} رکورد خام در ${Number(rows.length).toLocaleString('fa-IR')} بازه نمایش داده می‌شود` : 'داده‌ای در این بازه نیست. اول فایل PLC را بارگذاری کن.';

  const labels = rows.map(r => r.bucket.replace('T', ' '));
  const mk = (field, label, color, axis) => ({
    label, data: rows.map(r => r[field] != null ? +(+r[field]).toFixed(2) : null),
    borderColor: color, backgroundColor: color, yAxisID: axis, borderWidth: 2,
    pointRadius: 0, tension: .25, spanGaps: true
  });
  const ds = [mk('temp', 'دما (°C)', '#c0392b', 'y-t'),
              mk('current', 'جریان (A)', '#16606b', 'y-c'),
              mk('voltage', 'ولتاژ (V)', '#e8a13c', 'y-c'),
              mk('pressure', 'فشار (bar)', '#2e8b57', 'y-p')];
  const active = ds.filter(d => d.data.some(v => v !== null));

  const cfg = {
    type: 'line',
    data: {labels, datasets: active},
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: {mode: 'nearest', intersect: false},
      scales: {
        x: {ticks: {maxRotation: 0, autoSkip: true, maxTicksLimit: 12}},
        'y-t': {position: 'right', title: {display: true, text: '°C'}, ticks: {maxTicksLimit: 6}, grid: {display: false}},
        'y-c': {position: 'left', title: {display: true, text: 'A / V'}, ticks: {maxTicksLimit: 6}},
        'y-p': {position: 'right', display: active.some(d => d.label.includes('فشار')),
                title: {display: true, text: 'bar'}, ticks: {maxTicksLimit: 5}, grid: {display: false}}
      },
      plugins: {legend: {display: active.length > 1, labels: {boxWidth: 12, font: {size: 11}}}}
    }
  };
  if (plcChart) plcChart.destroy();
  plcChart = new Chart(document.getElementById('plc-chart'), cfg);
}
