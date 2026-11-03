/* Persistent GitHub Pages demo helpers. */
(function () {
  'use strict';
  const S = window.DEMO_SNAPSHOT || {};
  function notify(text) { if (typeof window.toast === 'function') window.toast(text); else alert(text); }
  const row = document.querySelector('.demo-banner-row');
  if (row) {
    const badge = document.createElement('span');
    badge.textContent = 'نسخه پایدار مرورگر — بدون اتصال به ایستگاه';
    row.appendChild(badge);
    const reset = document.createElement('button');
    reset.className = 'btn small demo-reset';
    reset.textContent = 'بازنشانی نمونه';
    reset.onclick = () => location.reload();
    row.appendChild(reset);
  }
  const details = document.querySelector('.demo-banner details p');
  if (details) {
    details.textContent = 'این نسخه با همان ظاهر برنامه اصلی ساخته شده، اما داده‌ها نمونه و فقط در مرورگر شما هستند. چیزی به ایستگاه، بله یا ایتا ارسال نمی‌شود. دکمه‌های امنیتی/ارسال واقعی غیرفعال‌اند. برای بازگرداندن عددهای اول، «بازنشانی نمونه» را بزنید.';
  }
  // Map generated report URLs to the bundled sample PDFs.
  const originalPrint = window.printPdf;
  window.printPdf = function (url) {
    let target = url;
    const m = String(url).match(/\/api\/reports\/(\d+)\/file/);
    if (m) {
      const report = (window.DEMO_REPORTS || S.reports || []).find(r => String(r.id) === m[1]);
      const kind = report && (report.kind === 'aux' || report.kind === 'registry') ? report.kind : 'daily';
      target = (S.pdf_files || {})[kind] || (S.pdf_files || {}).daily || url;
    }
    if (typeof originalPrint === 'function') originalPrint.call(window, target);
    else window.open(target, '_blank', 'noopener');
  };
  // Make archive/sample report buttons use bundled PDFs too.
  document.addEventListener('click', function (e) {
    const el = e.target.closest('a[href^="/api/admin/"], a[href^="/catalogs/"], button[onclick*="/api/admin/"]');
    if (el) { e.preventDefault(); e.stopImmediatePropagation(); notify('این کار در نسخه نمایشی مرورگر غیرفعال است.'); }
  }, true);
})();
