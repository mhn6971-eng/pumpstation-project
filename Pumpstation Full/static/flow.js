// دبی ماهانه
const MONTH_FA = {1:'فروردین',2:'اردیبهشت',3:'خرداد',4:'تیر',5:'مرداد',6:'شهریور',
                  7:'مهر',8:'آبان',9:'آذر',10:'دی',11:'بهمن',12:'اسفند'};

async function loadFlow(){
  const y = +document.getElementById('jyear').value;
  const m = +document.getElementById('jmonth').value;
  const res = await fetch(`/api/daily/monthly?jyear=${y}&jmonth=${m}`);
  const d = await res.json();
  document.getElementById('tbl-title').textContent =
    `دبی توتال ماه ${MONTH_FA[m]} ${y} (از ${d.days} روز ماه)`;
  const tb = document.querySelector('#tbl tbody');
  tb.innerHTML = d.rows.map(r => `
    <tr class="${r.flow ? '' : 'muted'}">
      <td>${r.day}</td>
      <td>${r.date}</td>
      <td>${r.flow != null ? faNum(r.flow) : '—'}</td>
      <td>${r.cum != null ? faNum(r.cum) : '—'}</td>
    </tr>`).join('');
  document.getElementById('t-total').textContent =
    d.total ? faNum(d.total) + ' L/s' : '—';
  document.getElementById('sum-info').textContent =
    d.total ? `جمع ثبت‌شده: ${faNum(d.total)} — از ${d.rows.filter(r => r.flow).length} روز ثبت‌شده` : 'هنوز داده‌ای ثبت نشده';
}

function faNum(n){
  return Number(n).toLocaleString('fa-IR-u-nu-latn');
}

document.getElementById('btn-show').onclick = loadFlow;
document.getElementById('btn-print').onclick = () => window.print();
initUserBar();
const today = jTodayStr();
document.getElementById('jyear').value = +today.split('/')[0];
document.getElementById('jmonth').value = +today.split('/')[1];
loadFlow();
