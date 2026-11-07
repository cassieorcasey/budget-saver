const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { loadGas } = require('./gas-harness');

const ROOT = path.join(__dirname, '..');
const PORT = 4173;
const TOKEN = 'rahasia-panjang-123';
const g = loadGas({ token: TOKEN });
g.api.setup();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  if (req.url === '/api' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => body += c);
    req.on('end', () => {
      const out = g.api.doPost({ postData: { contents: body } }).getContent();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(out);
    });
    return;
  }
  const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(res);
});

const money = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);
const OUT = process.env.SHOTS || '/tmp';

async function addTx(page, kind, amount, cat, note, date) {
  await page.click(`[data-act="new"][data-kind="${kind}"]`);
  await page.waitForSelector('#f-amount');
  await page.fill('#f-amount', String(amount));
  await page.click(`.chipgrid [data-c="${cat}"]`);
  if (date) await page.fill('#f-date', date);
  if (note) await page.fill('#f-note', note);
  await page.click('#f-save');
  await page.waitForSelector('.sheet', { state: 'detached' });
}
const envText = (page, cat) => page.locator(`.env[data-cat="${cat}"]`).innerText();

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  const base = `http://localhost:${PORT}/`;
  const newCtx = (opts = {}) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...opts });

  /* ---------- Mode lokal ---------- */
  const ctx = await newCtx();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(base);
  await page.waitForSelector('.hero');
  assert.strictEqual(await page.locator('.env').count(), 4);
  assert.match(await page.locator('.hero .big').innerText(), /Rp\s0$/);

  const mk = () => new Date();
  const d = (k) => { const t = mk(); t.setDate(t.getDate() - k); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  await addTx(page, 'topup', 100000, 'Primary Needs', 'Alokasi awal', d(0));
  await addTx(page, 'topup', 400000, 'To Invest', '', d(0));
  await addTx(page, 'topup', 50000, 'Personal Care', '', d(0));
  await addTx(page, 'expense', 90000, 'Primary Needs', 'Belanja bulanan', d(0));
  assert.match(await page.locator('.hero .big').innerText(), new RegExp('Rp\\s' + (550000 - 90000).toLocaleString('id-ID').replace(/\./g, '\\.') + '$'));
  let t = await envText(page, 'Primary Needs');
  assert.ok(t.includes(money(10000)) && t.includes('Hampir habis'), t);
  assert.ok((await envText(page, 'To Invest')).includes(money(400000)));
  // melebihi alokasi
  await addTx(page, 'expense', 20000, 'Primary Needs', 'Kopi', d(0));
  t = await envText(page, 'Primary Needs');
  assert.ok(t.includes('−' + money(10000)) && t.includes('Melebihi'), t);

  // daftar pengeluaran + sisa saldo berjalan
  await page.click('.tabbar [data-tab="expense"]');
  await page.waitForSelector('.row');
  assert.strictEqual(await page.locator('.row').count(), 2);
  const rows = await page.locator('.row').allInnerTexts();
  assert.ok(rows.some((r) => r.includes('Kopi') && r.includes('Sisa')) , rows.join('|'));
  assert.ok((await page.locator('.summary .v').innerText()).includes(money(110000)));
  // filter kategori
  await page.click('.chip[data-cat="To Invest"]');
  assert.strictEqual(await page.locator('.row').count(), 0);
  await page.click('.chip[data-cat=""]');

  // edit + hint
  await page.click('.row:has-text("Kopi")');
  await page.waitForSelector('#f-del');
  await page.fill('#f-amount', '5000');
  await page.click('#f-save');
  await page.waitForSelector('.sheet', { state: 'detached' });
  assert.ok((await page.locator('.summary .v').innerText()).includes(money(95000)));
  // hapus
  await page.click('.row:has-text("Kopi")');
  await page.click('#f-del');
  await page.click('[data-dlg="ok"]');
  await page.waitForSelector('.sheet', { state: 'detached' });
  assert.strictEqual(await page.locator('.row').count(), 1);

  // bulan lain kosong
  await page.click('[data-act="month"][data-k="-1"]');
  assert.ok(await page.locator('.empty').isVisible());
  await page.click('.monthnav .ml');

  // kategori
  await page.click('.tabbar [data-tab="settings"]');
  await page.click('[data-act="newcat"]');
  await page.fill('#c-name', 'Hiburan');
  await page.click('#c-save');
  await page.waitForSelector('.sheet', { state: 'detached' });
  assert.ok((await page.locator('.set-sec').nth(1).innerText()).includes('Hiburan'));
  await page.click('[data-act="cat"][data-cat="Primary Needs"]');
  assert.ok(await page.locator('#c-del').isDisabled());
  await page.fill('#c-name', 'Kebutuhan Pokok');
  await page.click('#c-save');
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.click('[data-act="cat"][data-cat="Hiburan"]');
  await page.click('#c-del'); await page.click('[data-dlg="ok"]');
  await page.waitForSelector('.sheet', { state: 'detached' });
  assert.ok(!(await page.locator('.set-sec').nth(1).innerText()).includes('Hiburan'));

  // Liquid Glass: geser lensa dari Beranda ke Top Up lalu lepas
  await page.click('.tabbar [data-tab="home"]');
  await page.waitForTimeout(650);
  const lensX = () => page.evaluate(() => document.querySelector('#lens').getBoundingClientRect().left);
  const homeBox = await page.locator('.tab[data-tab="home"]').boundingBox();
  const topBox = await page.locator('.tab[data-tab="topup"]').boundingBox();
  const x0 = await lensX();
  await page.mouse.move(homeBox.x + homeBox.width / 2, homeBox.y + homeBox.height / 2);
  await page.mouse.down();
  assert.ok(await page.evaluate(() => document.querySelector('#tabbar').classList.contains('press')), 'lensa membesar saat ditekan');
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2, { steps: 10 });
  assert.ok(await page.evaluate(() => document.querySelector('.tab[data-tab="topup"]').classList.contains('hot')), 'tab di bawah lensa menyala');
  assert.ok((await lensX()) > x0 + 100, 'lensa mengikuti jari');
  await page.mouse.up();
  await page.waitForFunction(() => location.hash === '#/topup');
  assert.strictEqual(await page.locator('.page-head h1').innerText(), 'Top Up');
  await page.waitForTimeout(700);
  const lb = await page.locator('#lens').boundingBox();
  assert.ok(Math.abs(lb.x + lb.width / 2 - (topBox.x + topBox.width / 2)) < 6, 'lensa menetap di Top Up');
  // geser lalu batal (pointercancel tidak dipicu mouse; lepas di tab yang sama = tetap)
  // navigasi lewat keyboard tetap bisa
  await page.locator('.tab[data-tab="expense"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.hash === '#/expense');
  // scroll ke bawah -> tab bar mengecil, scroll ke atas -> normal
  await page.click('.tabbar [data-tab="home"]');
  await page.evaluate(() => { document.body.style.minHeight = '3000px'; });
  for (const y of [200, 400, 600]) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.waitForFunction(() => document.querySelector('#tabbar').classList.contains('mini'));
  await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(60);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector('#tabbar').classList.contains('mini'));
  await page.evaluate(() => { document.body.style.minHeight = ''; });

  // persisten
  await page.reload(); await page.waitForSelector('.main');
  await page.click('.tabbar [data-tab="home"]');
  assert.ok((await envText(page, 'Kebutuhan Pokok')).includes(money(10000)));
  await page.screenshot({ path: OUT + '/shot-mobile-home.png' });

  /* ---------- Terhubung ke (mock) Google Sheets ---------- */
  await page.click('.tabbar [data-tab="settings"]');
  assert.ok(await page.locator('[data-act="copylink"]').isDisabled(), 'salin tautan nonaktif saat mode lokal');
  assert.ok((await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href')).startsWith('data:image/svg+xml'), 'favicon tertanam');
  await page.fill('#cfg-url', 'https://contoh.com/exec');
  await page.fill('#cfg-token', 'x');
  await page.click('[data-act="connect"]');
  assert.ok((await page.locator('#toast').innerText()).includes('script.google.com'));
  await page.fill('#cfg-url', base + 'api');
  await page.fill('#cfg-token', 'salah');
  await page.click('[data-act="connect"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Token salah'));
  assert.strictEqual(await page.inputValue('#cfg-url'), base + 'api', 'input dipertahankan saat gagal');
  await page.fill('#cfg-token', TOKEN);
  await page.click('[data-act="connect"]');
  await page.waitForSelector('[data-dlg="ok"]');
  await page.click('[data-dlg="ok"]'); // unggah data lokal
  await page.waitForFunction(() => document.querySelector('#pill').dataset.s === 'ok');
  const srv = g.api.readAll_();
  assert.strictEqual(srv.topups.length, 3); assert.strictEqual(srv.expenses.length, 1);
  assert.ok(srv.categories.some((c) => c.name === 'Kebutuhan Pokok'));
  assert.ok(srv.topups.some((x) => x.category === 'Kebutuhan Pokok'));

  // offline -> antrean -> sinkron
  await ctx.setOffline(true);
  await page.click('.tabbar [data-tab="home"]');
  await addTx(page, 'expense', 15000, 'Personal Care', 'Sabun', d(0));
  await page.waitForFunction(() => /Offline|Antre/.test(document.querySelector('#pill-t').textContent));
  assert.strictEqual(g.api.readAll_().expenses.length, 1);
  await ctx.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#pill').dataset.s === 'ok', null, { timeout: 15000 });
  assert.strictEqual(g.api.readAll_().expenses.length, 2);

  // perubahan manual di Sheets muncul setelah sinkron
  const topSheet = g.ss.getSheetByName('Top Up (Income)');
  const r = topSheet.getLastRow() + 1;
  topSheet.getRange(r, 1, 1, 4).setValues([[new Date(Date.UTC(+d(0).slice(0, 4), +d(0).slice(5, 7) - 1, +d(0).slice(8), -7)), 'Personal Care', 25000, 'dari Sheets']]);
  await page.click('#pill');
  await page.waitForFunction(() => document.querySelector('#pill').dataset.s === 'ok');
  await page.waitForTimeout(300);
  assert.ok((await envText(page, 'Personal Care')).includes(money(50000 + 25000 - 15000)));

  // perangkat kedua via tautan penyiapan (dari tombol Salin tautan perangkat lain)
  await page.click('.tabbar [data-tab="settings"]');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  assert.ok(await page.locator('[data-act="copylink"]').isEnabled());
  await page.click('[data-act="copylink"]');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('disalin'));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(/#cfg=[A-Za-z0-9_-]+$/.test(copied), 'tautan tersalin: ' + copied);
  const link = await page.evaluate(() => { const S = window.__bs.S; const b = btoa(unescape(encodeURIComponent(JSON.stringify({ u: S.cfg.url, t: S.cfg.token })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return location.origin + location.pathname + '#cfg=' + b; });
  const ctx2 = await newCtx({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('p2 pageerror: ' + e.message));
  await p2.goto(link);
  await p2.waitForSelector('[data-dlg="ok"]');
  await p2.click('[data-dlg="ok"]');
  await p2.waitForFunction(() => document.querySelector('#pill').dataset.s === 'ok');
  await p2.waitForSelector('.env');
  assert.ok((await p2.locator('.env[data-cat="Personal Care"]').innerText()).includes(money(60000)));
  assert.ok(await p2.evaluate(() => document.querySelector('#tabbar').classList.contains('refract')), 'refraksi aktif di Chromium');
  assert.ok((await p2.locator('#lg-map').getAttribute('href') || '').startsWith('data:image/png'), 'peta displacement dibuat');
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: OUT + '/shot-desktop-home.png' });
  await p2.evaluate(() => window.scrollTo(0, 120)); await p2.waitForTimeout(400);
  await p2.screenshot({ path: OUT + '/shot-desktop-glass.png', clip: { x: 300, y: 0, width: 680, height: 80 } });
  await p2.evaluate(() => window.scrollTo(0, 0));
  await p2.click('.tabbar [data-tab="expense"]');
  await p2.waitForSelector('.row');
  await p2.screenshot({ path: OUT + '/shot-desktop-expense.png' });
  // pintasan N
  await p2.click('.tabbar [data-tab="home"]');
  await p2.keyboard.press('n');
  await p2.waitForSelector('#f-amount');
  await p2.fill('#f-amount', '12345');
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: OUT + '/shot-desktop-form.png' });
  await p2.keyboard.press('Escape');
  await p2.waitForSelector('.sheet', { state: 'detached' });

  // perangkat ketiga (mirip PWA iOS): tempel tautan di Pengaturan
  const ctx3 = await newCtx();
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push('p3 pageerror: ' + e.message));
  await p3.goto(base + '#/settings');
  await p3.fill('#cfg-link', 'abc');
  await p3.click('[data-act="uselink"]');
  assert.ok((await p3.locator('#toast').innerText()).includes('tidak dikenali'));
  await p3.fill('#cfg-link', link);
  await p3.click('[data-act="uselink"]');
  await p3.waitForSelector('[data-dlg="ok"]');
  await p3.click('[data-dlg="ok"]');
  await p3.waitForFunction(() => document.querySelector('#pill').dataset.s === 'ok');
  await p3.waitForSelector('.hero');
  assert.ok((await p3.locator('.env[data-cat="Personal Care"]').innerText()).includes(money(60000)));

  // mobile: form, daftar, pengaturan, gelap
  await page.click('.tabbar [data-tab="expense"]');
  await page.screenshot({ path: OUT + '/shot-mobile-expense.png' });
  await page.click('[data-act="edit"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/shot-mobile-form.png' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.click('.tabbar [data-tab="settings"]');
  await page.screenshot({ path: OUT + '/shot-mobile-settings.png' });
  const dark = await newCtx({ colorScheme: 'dark' });
  const pd = await dark.newPage();
  await pd.addInitScript((s) => localStorage.setItem('budgetsaver.v1', s), await page.evaluate(() => localStorage.getItem('budgetsaver.v1')));
  await pd.goto(base); await pd.waitForSelector('.env');
  await pd.screenshot({ path: OUT + '/shot-mobile-dark.png' });

  // tidak ada overflow horizontal
  for (const [pg, name] of [[page, 'mobile'], [p2, 'desktop']]) {
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(ov <= 0, name + ' overflow ' + ov);
  }

  await browser.close(); server.close();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('E2E OK');
})().catch(async (e) => { console.error(e); server.close(); process.exit(1); });
