// داشبورد
Chart.defaults.font.family = "Vazirmatn, Tahoma";
Chart.defaults.color = "#5e7280";

const PUMP_COLORS = ["#16606b","#e8a13c","#7b5ea7","#c0392b","#2e8b57","#b0552b","#4a7f88","#8a6a12"];

function lineChart(id, series, yLabel) {
  return new Chart(document.getElementById(id), {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: series.datasets
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: {mode: 'nearest', intersect: false},
      scales: {
        x: {ticks: {maxRotation: 0, autoSkip: true, maxTicksLimit: 10}},
        y: {title: {display: true, text: yLabel}, ticks: {maxTicksLimit: 7}}
      },
      plugins: {legend: {display: series.datasets.length > 1, labels: {boxWidth: 12, font: {size: 11}}}}
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // KPI
  const dash = await api('/api/dashboard');
  document.getElementById('k-eq').textContent = FA(dash.counts.equipments);
  document.getElementById('k-reading').textContent = FA(dash.counts.readings);
  document.getElementById('k-month').textContent = FA(dash.counts.readings_month);
  document.getElementById('k-maint').textContent = FA(dash.counts.maintenances);

  // داده ۳۰ روز پمپ‌ها
  const pumps = await api('/api/equipment');
  const pumpList = pumps.filter(p => p.category === 'pump');
  const readings = await api(`/api/readings?limit=1000`);
  const pumpIds = new Set(pumpList.map(p => p.id));
  const rs = readings.filter(r => pumpIds.has(r.equipment_id)).reverse();

  // محور: تاریخ‌های یکتا
  const dates = [...new Set(rs.map(r => r.date))].sort();
  const series = (field, avg) => ({
    labels: dates,
    datasets: pumpList.map((p, i) => {
      const byDate = {};
      rs.filter(r => r.equipment_id === p.id).forEach(r => {
        if (r[field] != null) byDate[r.date] = avg ? (byDate[r.date] || []).concat(r[field]) : r[field];
      });
      const data = dates.map(d => {
        const v = byDate[d];
        return v === undefined ? null : (avg ? v.reduce((a, b) => a + b, 0) / v.length : v);
      });
      return {label: p.tag, data, borderColor: PUMP_COLORS[i % 8], backgroundColor: PUMP_COLORS[i % 8],
              borderWidth: 2, pointRadius: 2, spanGaps: true, tension: .25};
    })
  });

  lineChart('chart-temp', series('temp'), 'دما (°C)');
  lineChart('chart-current', series('current'), 'جریان (A)');
  lineChart('chart-voltage', series('voltage'), 'ولتاژ (V)');

  // میانگین جریان هر پمپ — از آمار سرور
  const stats = dash.stats.filter(s => s.c_avg != null);
  new Chart(document.getElementById('chart-avg-current'), {
    type: 'bar',
    data: {
      labels: stats.map(s => s.tag),
      datasets: [{label: 'میانگین جریان (A)', data: stats.map(s => s.c_avg), backgroundColor: '#16606b', borderRadius: 5}]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {y: {ticks: {maxTicksLimit: 7}}},
      plugins: {legend: {display: false}}
    }
  });

  // آخرین وضعیت پمپ‌ها
  document.querySelector('#last-table tbody').innerHTML = dash.last_readings.map(({equipment, last}) => `
    <tr>
      <td><b>${esc(equipment.tag)}</b></td>
      <td>${last ? esc(last.date) : '—'}</td>
      <td class="num">${FA1(last?.temp)}</td>
      <td class="num">${FA1(last?.current)}</td>
      <td class="num">${FA(last?.voltage)}</td>
      <td class="num">${FA1(last?.hours)}</td>
      <td class="num">${FA1(last?.pressure)}</td>
    </tr>`).join('');

  // KPI های جدید
  document.getElementById('k-pm-late').textContent = FA(dash.pm_due.filter(d => d.days_left !== null && d.days_left < 0).length);
  const daily = await api('/api/daily');
  const todayJ = dash.today;
  const recToday = daily.filter(r => r.date === todayJ);
  const flowToday = recToday.reduce((a, r) => a + (r.total_flow || r.flow || 0), 0);
  document.getElementById('k-flow-today').textContent = flowToday ? FA1(flowToday) : '—';
  document.getElementById('k-shift').textContent = recToday.length
    ? recToday.map(r => 'شیفت ' + r.shift + ' — ' + r.operator).join(' | ') : 'ثبت نشده';

  // نمودار دبی ماه جاری
  const ym = todayJ.split('/');
  const mf = await api(`/api/daily/monthly?jyear=${ym[0]}&jmonth=${+ym[1]}`);
  new Chart(document.getElementById('chart-flow'), {
    type: 'bar',
    data: {
      labels: mf.rows.map(r => FA(r.day)),
      datasets: [{label: 'دبی توتال روز', data: mf.rows.map(r => r.flow),
                  backgroundColor: '#16606b', borderRadius: 4}]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: {title: {display: true, text: 'روز ماه'}},
        y: {title: {display: true, text: 'دبی (L/s)'}}
      },
      plugins: {legend: {display: false}}
    }
  });

  // نوبت PM
  document.getElementById('pm-list').innerHTML = dash.pm_due.map(d => {
    let badge;
    if (d.days_left === null) badge = '<span class="badge info">بدون سابقه PM</span>';
    else if (d.days_left < 0) badge = `<span class="badge danger">${FA(Math.abs(d.days_left))} روز گذشته</span>`;
    else if (d.days_left <= 15) badge = `<span class="badge warn">${FA(d.days_left)} روز مانده</span>`;
    else badge = `<span class="badge ok">${FA(d.days_left)} روز مانده</span>`;
    return `<div class="pm-item">
      <span><b>${esc(d.equipment.tag)}</b> — ${esc(d.equipment.name)}</span>
      <span>${d.last_pm ? `آخرین PM: ${esc(d.last_pm)}` : ''} ${badge}</span>
    </div>`;
  }).join('');
});
