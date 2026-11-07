const assert = require('assert');
const { loadGas } = require('./gas-harness');

const g = loadGas();
const T = 'test-token-123';
const sync = (ops = []) => g.post({ token: T, action: 'sync', ops });

// auth
assert.strictEqual(g.post({ token: 'x', action: 'sync' }).error, 'unauthorized');
assert.strictEqual(loadGas({ token: 'GANTI_TOKEN_INI' }).post({ token: 'GANTI_TOKEN_INI', action: 'sync' }).error, 'token_belum_diatur');
assert.strictEqual(g.post('{bad json').ok, false);

// tanpa menjalankan setup(): sinkron pertama menyiapkan sheet sendiri
let r = sync();
assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.data.categories.length, 4);
assert.ok(g.ss.getSheetByName('Catat Harian (Pengeluaran)') && g.ss.getSheetByName('Dashboard'));
// skrip standalone (tidak dibuat dari Google Sheet) -> pesan jelas
const lone = loadGas({ noSheet: true });
assert.strictEqual(lone.post({ token: T, action: 'sync' }).error, 'skrip_tidak_terikat_sheet');

assert.ok(g.ss.getSheetByName('Dashboard') && g.ss.getSheetByName('Kategori'));
assert.ok(!g.ss.getSheetByName('Sheet1'), 'Sheet1 kosong dihapus');
g.api.setup(); // idempoten

r = sync();
assert.ok(r.ok); assert.strictEqual(r.data.categories.length, 4);
assert.deepStrictEqual(r.data.topups, []);

// add
r = sync([
  { t: 'add', k: 'topup', row: { id: 'tp1', date: '2026-11-01', category: 'Primary Needs', amount: 100000, note: 'awal' } },
  { t: 'add', k: 'expense', row: { id: 'ex1', date: '2026-11-01', category: 'Primary Needs', amount: 90000, note: 'belanja' } },
  { t: 'add', k: 'expense', row: { id: 'ex2', date: '2026-11-04', category: 'Primary Needs', amount: 5000, note: '' } },
  { t: 'add', k: 'expense', row: { id: 'bad', date: '04/11/2026', category: 'X', amount: 5 } },
  { t: 'add', k: 'expense', row: { id: 'neg', date: '2026-11-04', category: 'X', amount: -5 } }
]);
assert.deepStrictEqual(r.results.map(x => x.ok), [true, true, true, false, false]);
assert.strictEqual(r.data.topups.length, 1);
assert.strictEqual(r.data.expenses.length, 2);
assert.strictEqual(r.data.expenses[0].date, '2026-11-01');
assert.strictEqual(r.data.expenses[0].amount, 90000);

// idempoten: kirim ulang add yang sama
r = sync([{ t: 'add', k: 'expense', row: { id: 'ex1', date: '2026-11-01', category: 'Primary Needs', amount: 90000, note: 'belanja' } }]);
assert.strictEqual(r.data.expenses.length, 2);

// update
r = sync([{ t: 'upd', k: 'expense', row: { id: 'ex2', date: '2026-11-03', category: 'To Invest', amount: 7000, note: 'ubah' } }]);
const ex2 = r.data.expenses.find(e => e.id === 'ex2');
assert.deepStrictEqual([ex2.date, ex2.category, ex2.amount, ex2.note], ['2026-11-03', 'To Invest', 7000, 'ubah']);
// rumus sisa saldo ada
const expSheet = g.ss.getSheetByName('Catat Harian (Pengeluaran)');
assert.match(expSheet.getRange(5, 5).getFormula(), /SUMIFS/);
// upsert untuk id yang belum ada
r = sync([{ t: 'upd', k: 'topup', row: { id: 'tp2', date: '2026-11-04', category: 'To Invest', amount: 400000, note: '' } }]);
assert.strictEqual(r.data.topups.length, 2);

// delete (+ baris bergeser, data lain utuh)
r = sync([{ t: 'del', k: 'expense', id: 'ex1' }]);
assert.deepStrictEqual(r.data.expenses.map(e => e.id), ['ex2']);
r = sync([{ t: 'del', k: 'expense', id: 'tidak-ada' }]);
assert.ok(r.results[0].ok);
// baris kosong terpakai ulang saat add berikutnya
r = sync([{ t: 'add', k: 'expense', row: { id: 'ex3', date: '2026-11-04', category: 'Personal Care', amount: 1000, note: '' } }]);
assert.deepStrictEqual(r.data.expenses.map(e => e.id).sort(), ['ex2', 'ex3']);

// baris yang diketik manual di Sheets (tanpa ID) diberi ID
const topSheet = g.ss.getSheetByName('Top Up (Income)');
const row = topSheet.getLastRow() + 1;
topSheet.getRange(row, 1, 1, 4).setValues([[new Date(Date.UTC(2026, 10, 10, -7)), 'Personal Care', 25000, 'manual']]);
r = sync();
const manual = r.data.topups.find(t => t.note === 'manual');
assert.ok(manual && manual.id && manual.date === '2026-11-10');
assert.strictEqual(sync().data.topups.find(t => t.note === 'manual').id, manual.id, 'ID stabil');

// kategori
r = sync([{ t: 'catAdd', name: 'Hiburan', note: 'nonton' }, { t: 'catAdd', name: 'hiburan' }]);
assert.ok(r.results.every(x => x.ok)); assert.strictEqual(r.data.categories.length, 5);
r = sync([{ t: 'catUpd', from: 'Primary Needs', name: 'Kebutuhan Pokok', note: 'makan' }]);
assert.ok(r.results[0].ok);
assert.ok(r.data.topups.some(t => t.category === 'Kebutuhan Pokok') && !r.data.topups.some(t => t.category === 'Primary Needs'));
r = sync([{ t: 'catUpd', from: 'Kebutuhan Pokok', name: 'To Invest' }]);
assert.strictEqual(r.results[0].error, 'nama_kategori_sudah_ada');
r = sync([{ t: 'catDel', name: 'Kebutuhan Pokok' }]);
assert.match(r.results[0].error, /masih_dipakai/);
r = sync([{ t: 'catDel', name: 'Hiburan' }]);
assert.ok(r.results[0].ok); assert.strictEqual(r.data.categories.length, 4);
assert.ok(r.data.categories.every(c => c.name));
// batas 10
const many = Array.from({ length: 8 }, (_, i) => ({ t: 'catAdd', name: 'K' + i }));
r = sync(many);
assert.strictEqual(r.data.categories.length, 10);
assert.match(r.results[6].error, /maksimal/);

// dashboard punya rumus
assert.match(g.ss.getSheetByName('Dashboard').getRange(6, 2).getFormula(), /SUMIFS/);
console.log('Code.gs OK');
