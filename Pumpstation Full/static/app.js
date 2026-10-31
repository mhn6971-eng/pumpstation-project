// shared helpers
const FA = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('fa-IR');
const FA1 = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('fa-IR', {maximumFractionDigits: 1});
const faDate = s => s ? String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'خطا در ارتباط با سرور');
  return j;
}
function msg(el, text, ok) {
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
  setTimeout(() => { el.textContent = ''; }, 4000);
}
async function fillEquipmentSelect(sel, allLabel) {
  const list = await api('/api/equipment');
  sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
    list.map(e => `<option value="${e.id}">${esc(e.tag)} — ${esc(e.name)}</option>`).join('');
  return list;
}
// تاریخ شمسی امروز به شکل 1404/08/09
function jTodayStr() {
  return new Date().toLocaleDateString('fa-IR-u-nu-latn', {year:'numeric', month:'2-digit', day:'2-digit'});
}
// ناوبری و ورود/خروج کاربر
function initUserBar() {
  const bar = document.getElementById('user-bar');
  if (!bar) return;
  api('/api/me').then(me => {
    if (me) {
      bar.innerHTML = `<span class="badge info">شیفت ${esc(me.shift)}</span>
        <b>${esc(me.name)}</b>
        <button class="btn ghost" id="btn-logout">خروج</button>`;
      document.getElementById('btn-logout').addEventListener('click', async () => {
        await api('/api/logout', {method: 'POST'}); location.reload();
      });
      document.dispatchEvent(new CustomEvent('user-ready', {detail: me}));
    } else {
      api('/api/users').then(users => {
        bar.innerHTML = `
          <select id="login-user" style="width:auto;min-width:160px">
            ${users.map(u => `<option value="${u.id}">${esc(u.name)} — شیفت ${esc(u.shift)}</option>`).join('')}
          </select>
          <input type="password" id="login-pin" placeholder="رمز (پیش‌فرض 1234)" style="width:150px">
          <button class="btn ghost" id="btn-login">ورود</button>`;
        document.getElementById('btn-login').addEventListener('click', async () => {
          try {
            await api('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({user_id: +document.getElementById('login-user').value,
                                    pin: document.getElementById('login-pin').value})});
            location.reload();
          } catch (e) { alert(e.message); }
        });
      });
    }
  });
}
function setActiveNav() {
  const path = location.pathname;
  document.querySelectorAll('.nav-link').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === '/' ? path === '/' : path.startsWith(href));
  });
}
document.addEventListener('DOMContentLoaded', () => {
  setActiveNav();
  initUserBar();
  const bb = document.getElementById('btn-backup');
  if (bb) bb.addEventListener('click', () => { location.href = '/api/backup'; });
  const bd = document.getElementById('btn-demo');
  if (bd) bd.addEventListener('click', async () => {
    if (!confirm('داده نمونه ۳۰ روز اخیر برای پمپ‌ها ثبت شود؟ (برای آزمایش داشبورد)')) return;
    bd.disabled = true;
    try { await api('/api/demo', {method: 'POST'}); location.reload(); }
    catch (e) { alert(e.message); bd.disabled = false; }
  });
});
