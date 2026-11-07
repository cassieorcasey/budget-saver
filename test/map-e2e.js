// Uji tab Peta (mind map): pengelompokan, lipat/buka, Lainnya, panel detail, edit, tata letak.
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 4177;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0].split('#')[0]);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(res);
});

const now = new Date();
const ym = (k) => { const d = new Date(now.getFullYear(), now.getMonth() + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const M0 = ym(0), M1 = ym(-1), M2 = ym(-2), M3 = ym(-3);
let n = 0;
const T = (m, d, c, a, note) => ({ id: 't' + (n++), date: `${m}-${String(d).padStart(2, '0')}`, category: c, amount: a, note });
const seed = {
  v: 1,
  cats: [{ name: 'Personal Care', note: '' }, { name: 'Primary Needs', note: '' }, { name: 'To Invest', note: '' }, { name: 'AI Subscription', note: '' }],
  topups: [T(M0, 1, 'Primary Needs', 1500000, 'Gaji'), T(M0, 1, 'To Invest', 400000, 'Gaji'), T(M0, 1, 'AI Subscription', 300000, ''),
    T(M0, 1, 'Personal Care', 75000, 'Gaji'), T(M0, 5, 'Personal Care', 25000, 'Bonus'),
    T(M2, 1, 'Primary Needs', 100000, '')],
  expenses: [T(M0, 1, 'Primary Needs', 640000, 'Belanja bulanan'), T(M0, 2, 'Primary Needs', 25000, 'Kopi'), T(M0, 3, 'Primary Needs', 25000, 'kopi '),
    T(M0, 4, 'Primary Needs', 20000, 'KOPI'), T(M0, 2, 'Primary Needs', 150000, 'Bensin'), T(M0, 3, 'Primary Needs', 35000, 'Makan siang'),
    T(M0, 4, 'Primary Needs', 40000, 'Makan  siang'), T(M0, 5, 'Primary Needs', 10000, 'Parkir'), T(M0, 5, 'Primary Needs', 22000, 'Galon'),
    T(M0, 6, 'Primary Needs', 18000, 'Laundry'), T(M0, 6, 'Primary Needs', 8000, ''), T(M0, 7, 'Primary Needs', 3000, '-'),
    T(M0, 2, 'AI Subscription', 290000, 'Claude Pro'), T(M0, 3, 'Personal Care', 15000, 'Sabun'), T(M0, 4, 'Personal Care', 45000, 'Potong rambut'),
    T(M1, 3, 'Primary Needs', 50000, 'Makan'),
    T(M2, 3, 'Primary Needs', 300000, 'Belanja')],
  queue: [], cfg: { url: '', token: '' }, theme: 'auto', lastCat: '', lastSync: 0
};
const money = (v) => 'Rp ' + new Intl.NumberFormat('id-ID').format(v);

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const errors = [];
  const open = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('budgetsaver.v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(seed));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.hero');
    return { ctx, page };
  };
  const pathsMatchNodes = (page) => page.evaluate(() => document.querySelectorAll('#mm-lines path').length === document.querySelectorAll('#mm [data-p]').length);

  /* ---------- iPhone ---------- */
  const { page } = await open({ width: 390, height: 844 });
  // label tab ringkas
  assert.deepStrictEqual(await page.locator('#tabs .tab span').allInnerTexts(), ['Beranda', 'Keluar', 'Masuk', 'Peta', 'Atur']);
  await page.click('.tabbar [data-tab="map"]');
  await page.waitForSelector('#mm');
  assert.strictEqual(await page.evaluate(() => location.hash), '#/map');
  assert.strictEqual(await page.locator('.page-head h1').innerText(), 'Peta');

  // pusat = selisih bulan ini
  const inTotal = 1500000 + 400000 + 300000 + 75000 + 25000;
  const outTotal = 640000 + 25000 + 25000 + 20000 + 150000 + 35000 + 40000 + 10000 + 22000 + 18000 + 8000 + 3000 + 290000 + 15000 + 45000;
  const center = await page.locator('#mm-c').innerText();
  assert.ok(center.includes('+' + money(inTotal - outTotal)), center);
  assert.ok(center.includes(money(inTotal)) && center.includes(money(outTotal)), center);

  // kategori urut nominal terbesar, semua terlipat
  const inCats = await page.locator('.mm-side.in .mm-node.cat .mm-t').allInnerTexts();
  assert.deepStrictEqual(inCats.map((s) => s.trim()), ['Primary Needs', 'To Invest', 'AI Subscription', 'Personal Care']);
  const outCats = await page.locator('.mm-side.out .mm-node.cat .mm-t').allInnerTexts();
  assert.deepStrictEqual(outCats.map((s) => s.trim()), ['Primary Needs', 'AI Subscription', 'Personal Care']);
  assert.strictEqual(await page.locator('.mm-node.leaf').count(), 0);
  assert.ok(await pathsMatchNodes(page), 'satu garis per node');
  // persen sisi keluar
  const pnOut = 640000 + 25000 + 25000 + 20000 + 150000 + 35000 + 40000 + 10000 + 22000 + 18000 + 8000 + 3000;
  assert.ok((await page.locator('.mm-side.out [data-k="out|Primary Needs"]').innerText()).includes(Math.round(pnOut / outTotal * 100) + '%'));
  // tebal garis mengikuti porsi
  const widths = await page.evaluate(() => [...document.querySelectorAll('.mm-side.out .mm-node.cat')].map((e) => +e.dataset.w));
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2], widths.join(','));

  // buka Primary Needs (keluar): 5 terbesar + Lainnya
  await page.click('.mm-side.out [data-k="out|Primary Needs"]');
  assert.strictEqual(await page.locator('.mm-side.out [data-k="out|Primary Needs"]').getAttribute('aria-expanded'), 'true');
  const leaves = await page.locator('.mm-side.out .mm-node.leaf .mm-t').allInnerTexts();
  assert.strictEqual(leaves.length, 5, leaves.join('|'));
  assert.ok(leaves[0].startsWith('Belanja bulanan'));
  const kopi = leaves.find((l) => /^kopi/i.test(l));
  assert.ok(kopi && kopi.includes('3×'), 'Kopi/kopi /KOPI digabung: ' + leaves.join('|'));
  assert.ok(leaves.some((l) => /^Makan siang/.test(l) && l.includes('2×')), 'spasi ganda digabung');
  const more = page.locator('.mm-side.out .mm-node.more');
  assert.ok((await more.innerText()).includes('Lainnya'));
  // grup: belanja, bensin, makan siang, kopi, galon, laundry, tanpa keterangan('' & '-'), parkir = 8 -> Lainnya 3
  assert.ok((await more.innerText()).includes('3'), await more.innerText());
  assert.ok(await pathsMatchNodes(page));
  assert.ok(await page.evaluate(() => document.querySelectorAll('#mm-lines path.grow').length === 6), 'garis cabang baru dianimasikan');

  // ubah ukuran layar tidak memutar ulang animasi garis
  await page.setViewportSize({ width: 390, height: 700 });
  await page.waitForTimeout(120);
  assert.strictEqual(await page.evaluate(() => document.querySelectorAll('#mm-lines path.grow').length), 0);
  await page.setViewportSize({ width: 390, height: 844 });

  // Lainnya -> semua + Ringkas
  await more.click();
  assert.strictEqual(await page.locator('.mm-side.out .mm-node.leaf').count(), 8);
  assert.ok(await page.locator('.mm-side.out .mm-node.more:has-text("Ringkas")').isVisible());
  assert.ok((await page.locator('.mm-side.out .mm-node.leaf .mm-t').allInnerTexts()).some((l) => l.startsWith('Tanpa keterangan') && l.includes('2×')));
  await page.click('.mm-side.out .mm-node.more:has-text("Ringkas")');
  assert.strictEqual(await page.locator('.mm-side.out .mm-node.leaf').count(), 5);

  // kategori dengan ≤6 keterangan tidak memakai Lainnya
  await page.click('.mm-side.in [data-k="in|Personal Care"]');
  assert.deepStrictEqual((await page.locator('.mm-side.in .mm-node.leaf .mm-t').allInnerTexts()).map((s) => s.trim()), ['Gaji', 'Bonus']);
  assert.strictEqual(await page.locator('.mm-side.in .mm-node.more').count(), 0);

  // tata letak HP: atas-bawah (Masuk di atas pusat, Keluar di bawah)
  const yIn = (await page.locator('.mm-side.in').boundingBox()).y;
  const yC = (await page.locator('#mm-c').boundingBox()).y;
  const yOut = (await page.locator('.mm-side.out').boundingBox()).y;
  assert.ok(yIn < yC && yC < yOut, 'urutan vertikal');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'tanpa scroll horizontal');
  await page.screenshot({ path: '/tmp/shots/map-test-mobile.png', fullPage: true });

  // panel detail Kopi: 3 transaksi
  await page.locator('.mm-side.out .mm-node.leaf', { hasText: /kopi/i }).click();
  await page.waitForSelector('.sheet .row');
  assert.strictEqual(await page.locator('.sheet .row').count(), 3);
  assert.ok((await page.locator('.sheet .summary').innerText()).includes(money(70000)));
  assert.ok((await page.locator('.sheet .summary').innerText()).includes('3×'));
  // edit salah satu dari panel
  await page.locator('.sheet .row').first().click();
  await page.waitForSelector('#f-del');
  await page.fill('#f-amount', '40000');
  await page.click('#f-save');
  await page.waitForSelector('.sheet', { state: 'detached' });
  await page.waitForTimeout(100);
  const kopi2 = await page.locator('.mm-side.out .mm-node.leaf', { hasText: /kopi/i }).innerText();
  assert.ok(kopi2.includes(money(70000 - 20000 + 40000)) || kopi2.includes(money(70000 - 25000 + 40000)), kopi2);
  assert.strictEqual(await page.locator('.mm-side.out [data-k="out|Primary Needs"]').getAttribute('aria-expanded'), 'true', 'tetap terbuka setelah edit');

  // lipat lagi
  await page.click('.mm-side.out [data-k="out|Primary Needs"]');
  assert.strictEqual(await page.locator('.mm-side.out .mm-node.leaf').count(), 0);

  // bulan lalu: hanya pengeluaran -> sisi Masuk kosong + garis putus-putus, selisih negatif
  await page.click('[data-act="month"][data-k="-1"]');
  await page.waitForSelector('#mm-in-none');
  assert.ok((await page.locator('#mm-in-none').innerText()).includes('Belum ada top up'));
  assert.ok(await page.evaluate(() => !!document.querySelector('#mm-lines path.dash')));
  assert.ok(await page.locator('#mm-c b.neg').isVisible());
  assert.ok((await page.locator('#mm-c b').innerText()).startsWith('−'));
  // dua bulan lalu: kedua sisi ada
  await page.click('[data-act="month"][data-k="-1"]');
  await page.waitForSelector('.mm-side.in .mm-node.cat');
  assert.ok((await page.locator('#mm-c b').innerText()).includes(money(200000)));
  // tiga bulan lalu: kosong
  await page.click('[data-act="month"][data-k="-1"]');
  await page.waitForSelector('.empty');
  assert.ok((await page.locator('.empty').innerText()).includes('Belum ada aliran'));
  await page.click('.monthnav .ml');
  await page.waitForSelector('#mm');

  // keyboard: Enter pada node kategori
  await page.locator('.mm-side.in [data-k="in|Primary Needs"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.mm-side.in .mm-node.leaf');

  /* ---------- Laptop ---------- */
  const { page: d } = await open({ width: 1280, height: 860 });
  await d.click('.tabbar [data-tab="map"]');
  await d.waitForSelector('#mm');
  assert.strictEqual(await d.evaluate(() => getComputedStyle(document.querySelector('#mm')).display), 'grid');
  await d.click('.mm-side.out [data-k="out|Primary Needs"]');
  await d.click('.mm-side.in [data-k="in|Personal Care"]');
  const c = await d.locator('#mm-c').boundingBox();
  const inB = await d.locator('.mm-side.in [data-k="in|Primary Needs"]').boundingBox();
  const outB = await d.locator('.mm-side.out [data-k="out|Primary Needs"]').boundingBox();
  assert.ok(inB.x + inB.width <= c.x && outB.x >= c.x + c.width, 'Masuk di kiri, Keluar di kanan');
  const leafB = await d.locator('.mm-side.out .mm-node.leaf').first().boundingBox();
  assert.ok(leafB.x >= outB.x + outB.width, 'keterangan di kanan kategori');
  const inLeaf = await d.locator('.mm-side.in .mm-node.leaf').first().boundingBox();
  const pcB = await d.locator('.mm-side.in [data-k="in|Personal Care"]').boundingBox();
  assert.ok(inLeaf.x + inLeaf.width <= pcB.x, 'keterangan Masuk di kiri kategori');
  // nama kategori tidak terpotong
  const clipped = await d.evaluate(() => [...document.querySelectorAll('.mm-node.cat .mm-t')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  assert.deepStrictEqual(clipped, []);
  assert.ok(await pathsMatchNodes(d));
  assert.ok(await d.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  // 1000px: kembali ke atas-bawah
  await d.setViewportSize({ width: 1000, height: 860 });
  await d.waitForTimeout(150);
  assert.strictEqual(await d.evaluate(() => getComputedStyle(document.querySelector('#mm')).display), 'flex');
  assert.ok(await pathsMatchNodes(d));
  await d.setViewportSize({ width: 1280, height: 860 });
  await d.waitForTimeout(150);
  await d.screenshot({ path: '/tmp/shots/map-test-desktop.png' });

  await browser.close(); server.close();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('MAP E2E OK');
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
