const { chromium: pw } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, 'test-artifacts');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) process.exitCode = 1; }
async function overflow(page) { return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, body: document.body.scrollWidth })); }
(async () => {
  const { default: chromium, inflate, setupLambdaEnvironment } = await import('../node_modules/@sparticuz/chromium/build/index.js');
  await inflate(path.join(__dirname, '..', 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br'));
  setupLambdaEnvironment('/tmp/al2023/lib');
  const executablePath = await chromium.executablePath();
  const browser = await pw.launch({ executablePath, args: chromium.args.filter(a => a !== '--single-process'), headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const page = await context.newPage();
  const pageErrors = [], failedRequests = [], externalRequests = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.hostname.endsWith('.e2b.app')) externalRequests.push(r.url()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('login page loads', await page.locator('#login-btn').count() === 1);
  check('quick admin login exists', await page.getByRole('button', { name: 'ورود سریع ادمین نمونه' }).count() === 1);
  await page.screenshot({ path: path.join(OUT, 'mobile-login.png'), fullPage: true });
  await page.getByRole('button', { name: 'ورود سریع ادمین نمونه' }).click();
  await page.waitForSelector('.motor-grid .motor');
  await page.waitForLoadState('networkidle');
  check('dashboard has eight motors', await page.locator('.motor').count() === 8);
  check('six interval buttons', await page.locator('.interval').count() === 6);
  check('seven process fields', await page.locator('[data-process]').count() === 7);
  check('admin tab visible', await page.locator('#admin-tab').isVisible());
  let ov = await overflow(page); check('dashboard has no horizontal page overflow', ov.sw <= ov.cw + 1, JSON.stringify(ov));
  await page.screenshot({ path: path.join(OUT, 'mobile-dashboard.png'), fullPage: true });
  // Enter-to-save and physical validation on sample data.
  const pit = page.locator('[data-process="PIT-001"]');
  await pit.fill('2.95'); await pit.press('Enter'); await page.waitForTimeout(500);
  check('process Enter saves', await page.locator('[data-process="PIT-001"]').inputValue() === '2.95');
  await pit.fill('101'); await pit.press('Enter'); await page.waitForTimeout(400);
  check('physical range blocks 101 bar', await page.locator('.toast').last().innerText().then(t => t.includes('بازه')));
  // Motor modal and chart.
  await page.locator('.motor').first().click(); await page.waitForSelector('[data-motor-param="I1"]');
  check('motor modal has 19 fields', await page.locator('[data-motor-param]').count() === 19);
  ov = await overflow(page); check('motor modal has no horizontal page overflow', ov.sw <= ov.cw + 1, JSON.stringify(ov));
  await page.screenshot({ path: path.join(OUT, 'mobile-motor.png'), fullPage: true });
  await page.locator('[data-motor-param="I1"]').fill('181.5');
  await page.getByRole('button', { name: 'ثبت partial' }).click(); await page.waitForTimeout(500);
  await page.locator('.motor').first().click(); await page.waitForSelector('[data-motor-param="I1"]');
  check('partial motor value persists', await page.locator('[data-motor-param="I1"]').inputValue() === '181.5');
  await page.getByRole('button', { name: 'چارت / مقایسه' }).click(); await page.waitForSelector('#mc-param');
  await page.getByRole('button', { name: 'رسم', exact: true }).click(); await page.waitForTimeout(400);
  check('motor chart canvas exists', await page.locator('#chart').count() === 1);
  await page.locator('.modal .close').click();
  // All six tabs.
  for (const [tab, selector, shot] of [
    ['aux', '.table-scroll table', 'mobile-aux'],
    ['registry', '#reg-list table', 'mobile-registry'],
    ['training', '#main h2', 'mobile-training'],
    ['problems', '#problem-text', 'mobile-problems'],
    ['admin', '#main h2', 'mobile-admin'],
  ]) {
    await page.locator(`#tabs button[data-tab="${tab}"]`).click(); await page.waitForSelector(selector); await page.waitForTimeout(250);
    ov = await overflow(page); check(`${tab} tab has no horizontal page overflow`, ov.sw <= ov.cw + 1, JSON.stringify(ov));
    await page.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: true });
  }
  // Admin config is visibly blocked.
  await page.getByRole('button', { name: 'مدیریت ست‌پوینت‌ها' }).click(); await page.waitForSelector('[data-sp]');
  const firstKey = await page.locator('[data-sp]').first().getAttribute('data-sp');
  await page.locator(`button[onclick="saveSetpoint('${firstKey}')"]`).click(); await page.waitForTimeout(300);
  check('admin setpoint write blocked', await page.locator('.toast').last().innerText().then(t => t.includes('فقط نمایشی')));
  await page.locator('.modal .close').click();
  // PDF generation stays local and opens in mobile dialog.
  await page.locator('#tabs button[data-tab="dashboard"]').click(); await page.waitForSelector('.motor');
  await page.getByRole('button', { name: 'ساخت PDF', exact: true }).click(); await page.waitForSelector('#demo-pdf-dialog[open]');
  check('PDF opens in mobile dialog', await page.locator('#demo-pdf-dialog').evaluate(d => d.open));
  const pdfHref = await page.locator('#demo-pdf-open').getAttribute('href');
  const pdfResp = await context.request.get(BASE + pdfHref);
  const pdfBody = await pdfResp.body();
  check('generated PDF is valid', pdfResp.status() === 200 && pdfBody.subarray(0, 4).toString() === '%PDF', `${pdfResp.status()} ${pdfBody.length} bytes`);
  await page.locator('#demo-pdf-close').click();
  // Messenger sending must be impossible through the public gateway.
  const adminWrite = await context.request.post(BASE + '/api/admin/channels/daily', { data: { provider: 'bale', chat_id: 'x', token: 'x', enabled: 1 } });
  check('channel configuration blocked', adminWrite.status() === 403);
  const restore = await context.request.post(BASE + '/api/admin/restore', { data: { filename: 'x', confirm: true } });
  check('restore blocked', restore.status() === 403);
  const send = await context.request.post(BASE + '/api/reports/daily', { data: { send: true } });
  const sendJson = await send.json();
  check('report send flag forced off', send.status() === 200 && sendJson.queued === false, JSON.stringify(sendJson));
  check('no external browser requests', externalRequests.length === 0, externalRequests.join(', '));
  check('no page JavaScript errors', pageErrors.length === 0, pageErrors.join(' | '));
  // Desktop smoke test.
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const dp = await desktop.newPage(); await dp.goto(BASE, { waitUntil: 'networkidle' });
  await dp.getByRole('button', { name: 'ورود سریع ادمین نمونه' }).click(); await dp.waitForSelector('.motor');
  check('desktop has four motor columns', await dp.locator('.motor-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length) === 4);
  await dp.screenshot({ path: path.join(OUT, 'desktop-dashboard.png'), fullPage: true });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, pageErrors, failedRequests, externalRequests }, null, 2));
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
