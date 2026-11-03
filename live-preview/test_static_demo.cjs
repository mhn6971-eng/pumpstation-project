const { chromium: pw } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.STATIC_BASE || 'http://127.0.0.1:8082';
const OUT = path.join(__dirname, 'test-artifacts');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) process.exitCode = 1; }
async function overflow(page) { return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); }
(async () => {
  const { default: chromium, inflate, setupLambdaEnvironment } = await import('../node_modules/@sparticuz/chromium/build/index.js');
  await inflate(path.join(__dirname, '..', 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br'));
  setupLambdaEnvironment('/tmp/al2023/lib');
  const browser = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => a !== '--single-process'), headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const page = await context.newPage();
  const pageErrors = [], external = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.hostname.endsWith('.github.io')) external.push(r.url()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.motor');
  check('static dashboard loads without login', await page.locator('.motor').count() === 8);
  check('six tabs present', await page.locator('#tabs button').count() === 6);
  check('admin tab visible', await page.locator('#admin-tab').isVisible());
  let ov = await overflow(page); check('dashboard no horizontal overflow', ov.sw <= ov.cw + 1, JSON.stringify(ov));
  await page.screenshot({ path: path.join(OUT, 'static-mobile-dashboard.png'), fullPage: true });
  const pit = page.locator('[data-process="PIT-001"]');
  await pit.fill('2.95'); await pit.press('Enter'); await page.waitForTimeout(200);
  check('sample process save works', await page.locator('[data-process="PIT-001"]').inputValue() === '2.95');
  await pit.fill('101'); await pit.press('Enter'); await page.waitForTimeout(200);
  check('physical range still blocks', await page.locator('.toast').last().innerText().then(t => t.includes('بازه')));
  await page.locator('.motor').first().click(); await page.waitForSelector('[data-motor-param="I1"]');
  check('motor modal opens', await page.locator('[data-motor-param]').count() === 19);
  await page.locator('[data-motor-param="I1"]').fill('181.5');
  await page.getByRole('button', { name: 'ثبت partial' }).click(); await page.waitForTimeout(200);
  await page.locator('.motor').first().click(); await page.waitForSelector('[data-motor-param="I1"]');
  check('motor partial save works', await page.locator('[data-motor-param="I1"]').inputValue() === '181.5');
  await page.locator('.modal .close').click();
  for (const tab of ['aux', 'registry', 'training', 'problems', 'admin']) {
    await page.locator(`#tabs button[data-tab="${tab}"]`).click(); await page.waitForTimeout(250);
    ov = await overflow(page); check(`${tab} no horizontal overflow`, ov.sw <= ov.cw + 1, JSON.stringify(ov));
    await page.screenshot({ path: path.join(OUT, `static-mobile-${tab}.png`), fullPage: false });
  }
  await page.locator('#tabs button[data-tab="dashboard"]').click(); await page.waitForSelector('.motor');
  await page.getByRole('button', { name: 'ساخت PDF', exact: true }).click(); await page.waitForSelector('#demo-pdf-dialog[open]');
  const href = await page.locator('#demo-pdf-open').getAttribute('href');
  check('PDF button points to bundled sample', href.includes('sample-daily.pdf'), href);
  const resp = await context.request.get(new URL(href, BASE).href);
  check('sample PDF downloads', resp.status() === 200 && (await resp.body()).subarray(0, 4).toString() === '%PDF');
  await page.locator('#demo-pdf-close').click();
  await page.locator('#tabs button[data-tab="admin"]').click(); await page.waitForSelector('#main h2');
  await page.getByRole('button', { name: 'بک‌آپ هم‌اکنون' }).click(); await page.waitForTimeout(150);
  check('admin backup blocked in browser demo', await page.locator('.toast').last().innerText().then(t => t.includes('غیرفعال')));
  check('no external requests', external.length === 0, external.join(', '));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'static-results.json'), JSON.stringify({ results, pageErrors, external }, null, 2));
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} static checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
