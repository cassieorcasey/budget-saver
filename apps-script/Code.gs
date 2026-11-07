/**
 * Budget Saver — API Google Apps Script untuk Google Sheets
 *
 * Skrip ini harus dibuat dari dalam Google Sheet (Extensions > Apps Script),
 * jadi data selalu tersimpan di spreadsheet itu dan bisa dibuka langsung.
 *
 * Langkah singkat (detail ada di PANDUAN.md):
 *   1. Ganti API_TOKEN di bawah dengan kata sandi panjang buatan Anda sendiri.
 *   2. Jalankan fungsi setup() satu kali (memberi izin akses saat diminta).
 *   3. Deploy > New deployment > Web app
 *      Execute as: Me   |   Who has access: Anyone
 *   4. Salin URL /exec ke menu Pengaturan di aplikasi, bersama token yang sama.
 */

const API_TOKEN = 'GANTI_TOKEN_INI';

const SHEET = {
  CAT: 'Kategori',
  TOP: 'Top Up (Income)',
  EXP: 'Catat Harian (Pengeluaran)',
  DASH: 'Dashboard'
};
const HEADER_ROW = 4;
const FIRST_ROW = 5;
const LAST_ROW = 1000;
const MAX_CATEGORIES = 10;
const TOP_COLS = 5; // A Tanggal | B Kategori | C Jumlah | D Catatan | E ID
const EXP_COLS = 6; // A Tanggal | B Kategori | C Keterangan | D Jumlah | E Sisa Saldo (rumus) | F ID

/* ------------------------------------------------------------------ */
/*  Endpoint web app                                                    */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, service: 'Budget Saver', version: 1 });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!API_TOKEN || API_TOKEN === 'GANTI_TOKEN_INI') {
      return json_({ ok: false, error: 'token_belum_diatur' });
    }
    if (!safeEqual_(String(req.token || ''), API_TOKEN)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (req.action !== 'sync') {
      return json_({ ok: false, error: 'aksi_tidak_dikenal' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      ensureReady_();
      const ops = Array.isArray(req.ops) ? req.ops : [];
      const results = ops.map(function (op) {
        try {
          applyOp_(op);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) };
        }
      });
      return json_({ ok: true, results: results, data: readAll_() });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Membuat sheet yang belum ada secara otomatis, jadi setup() manual tidak wajib. */
function ensureReady_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('skrip_tidak_terikat_sheet');
  var missing = [SHEET.CAT, SHEET.TOP, SHEET.EXP].some(function (n) { return !ss.getSheetByName(n); });
  if (missing) setup();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/*  Operasi tulis                                                       */
/* ------------------------------------------------------------------ */

function applyOp_(op) {
  switch (op && op.t) {
    case 'add':
    case 'upd':
      return upsertTx_(op.k, op.row);
    case 'del':
      return deleteTx_(op.k, op.id);
    case 'catAdd':
      return catAdd_(op.name, op.note);
    case 'catUpd':
      return catUpdate_(op.from, op.name, op.note);
    case 'catDel':
      return catDelete_(op.name);
    default:
      throw new Error('operasi_tidak_dikenal');
  }
}

function txSheet_(kind) {
  if (kind === 'topup') return { sheet: sh_(SHEET.TOP), idCol: 5 };
  if (kind === 'expense') return { sheet: sh_(SHEET.EXP), idCol: 6 };
  throw new Error('jenis_transaksi_tidak_dikenal');
}

function validateTx_(row) {
  if (!row || !row.id) throw new Error('id_kosong');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date))) throw new Error('tanggal_tidak_valid');
  var amount = Number(row.amount);
  if (!isFinite(amount) || amount <= 0) throw new Error('jumlah_tidak_valid');
  if (!String(row.category || '').trim()) throw new Error('kategori_kosong');
}

function upsertTx_(kind, row) {
  validateTx_(row);
  var t = txSheet_(kind);
  var sheet = t.sheet;
  var date = Utilities.parseDate(String(row.date), tz_(), 'yyyy-MM-dd');
  var category = String(row.category).trim();
  var amount = Number(row.amount);
  var note = String(row.note || '');

  var r = findRowById_(sheet, t.idCol, row.id);
  if (!r) r = nextRow_(sheet);

  if (kind === 'topup') {
    sheet.getRange(r, 1, 1, 5).setValues([[date, category, amount, note, row.id]]);
  } else {
    sheet.getRange(r, 1, 1, 4).setValues([[date, category, note, amount]]);
    var f = sheet.getRange(r, 5);
    if (!f.getFormula()) f.setFormula(expFormula_(r));
    sheet.getRange(r, 6).setValue(row.id);
  }
}

function deleteTx_(kind, id) {
  var t = txSheet_(kind);
  var r = findRowById_(t.sheet, t.idCol, id);
  if (r) t.sheet.deleteRow(r);
}

function findRowById_(sheet, idCol, id) {
  var last = sheet.getLastRow();
  if (last < FIRST_ROW) return 0;
  var ids = sheet.getRange(FIRST_ROW, idCol, last - FIRST_ROW + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return FIRST_ROW + i;
  }
  return 0;
}

/** Baris kosong pertama (berdasarkan kolom Kategori). Menambah baris bila penuh. */
function nextRow_(sheet) {
  var max = sheet.getMaxRows();
  var n = Math.max(1, max - FIRST_ROW + 1);
  var cats = sheet.getRange(FIRST_ROW, 2, n, 1).getValues();
  for (var i = 0; i < cats.length; i++) {
    if (String(cats[i][0]).trim() === '') return FIRST_ROW + i;
  }
  sheet.insertRowsAfter(max, 50);
  return max + 1;
}

function expFormula_(r) {
  var top = "'" + SHEET.TOP + "'!";
  return '=IF(B' + r + '="","",' +
    'SUMIFS(' + top + '$C$5:$C$' + LAST_ROW + ',' + top + '$B$5:$B$' + LAST_ROW + ',B' + r + ',' +
    top + '$A$5:$A$' + LAST_ROW + ',"<="&A' + r + ')' +
    '-SUMIFS($D$5:D' + r + ',$B$5:B' + r + ',B' + r + '))';
}

/* ------------------------------------------------------------------ */
/*  Kategori                                                            */
/* ------------------------------------------------------------------ */

function readCategories_() {
  var s = sh_(SHEET.CAT);
  return s.getRange(FIRST_ROW, 1, MAX_CATEGORIES, 2).getValues()
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) { return { name: String(r[0]).trim(), note: String(r[1] || '') }; });
}

function writeCategories_(list) {
  var out = [];
  for (var i = 0; i < MAX_CATEGORIES; i++) {
    out.push(list[i] ? [list[i].name, list[i].note || ''] : ['', '']);
  }
  sh_(SHEET.CAT).getRange(FIRST_ROW, 1, MAX_CATEGORIES, 2).setValues(out);
}

function catAdd_(name, note) {
  name = String(name || '').trim();
  if (!name) throw new Error('nama_kategori_kosong');
  var list = readCategories_();
  var exists = list.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
  if (exists) return;
  if (list.length >= MAX_CATEGORIES) throw new Error('maksimal_' + MAX_CATEGORIES + '_kategori');
  list.push({ name: name, note: String(note || '') });
  writeCategories_(list);
}

function catUpdate_(from, name, note) {
  from = String(from || '').trim();
  name = String(name || '').trim();
  if (!name) throw new Error('nama_kategori_kosong');
  var list = readCategories_();
  var idx = -1;
  list.forEach(function (c, i) { if (c.name === from) idx = i; });
  if (idx < 0) {
    // Pengiriman ulang setelah timeout: perubahan nama sudah diterapkan sebelumnya.
    if (list.some(function (c) { return c.name === name; })) return;
    throw new Error('kategori_tidak_ditemukan');
  }
  var clash = list.some(function (c, i) { return i !== idx && c.name.toLowerCase() === name.toLowerCase(); });
  if (clash) throw new Error('nama_kategori_sudah_ada');
  list[idx] = { name: name, note: String(note || '') };
  writeCategories_(list);
  if (name !== from) {
    renameInColumn_(sh_(SHEET.TOP), from, name);
    renameInColumn_(sh_(SHEET.EXP), from, name);
  }
}

function renameInColumn_(sheet, from, to) {
  var last = sheet.getLastRow();
  if (last < FIRST_ROW) return;
  var rng = sheet.getRange(FIRST_ROW, 2, last - FIRST_ROW + 1, 1);
  var vals = rng.getValues();
  var changed = false;
  vals.forEach(function (v) {
    if (String(v[0]).trim() === from) { v[0] = to; changed = true; }
  });
  if (changed) rng.setValues(vals);
}

function catDelete_(name) {
  name = String(name || '').trim();
  var used = countUse_(sh_(SHEET.TOP), name) + countUse_(sh_(SHEET.EXP), name);
  if (used > 0) throw new Error('kategori_masih_dipakai_' + used + '_transaksi');
  var list = readCategories_().filter(function (c) { return c.name !== name; });
  writeCategories_(list);
}

function countUse_(sheet, name) {
  var last = sheet.getLastRow();
  if (last < FIRST_ROW) return 0;
  return sheet.getRange(FIRST_ROW, 2, last - FIRST_ROW + 1, 1).getValues()
    .filter(function (v) { return String(v[0]).trim() === name; }).length;
}

/* ------------------------------------------------------------------ */
/*  Baca semua data                                                     */
/* ------------------------------------------------------------------ */

function readAll_() {
  var tz = tz_();
  var fmt = function (d) {
    if (d instanceof Date) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return String(d || '');
  };

  var topSheet = sh_(SHEET.TOP);
  var topups = [];
  readBlock_(topSheet, TOP_COLS).forEach(function (r) {
    var v = r.v;
    var amount = Number(v[2]);
    if (!String(v[1]).trim() || v[2] === '' || !isFinite(amount)) return;
    var id = String(v[4] || '');
    if (!id) { id = newId_(); topSheet.getRange(r.row, 5).setValue(id); } // baris yang diketik manual di Sheets
    topups.push({ id: id, date: fmt(v[0]), category: String(v[1]).trim(), amount: amount, note: String(v[3] || '') });
  });

  var expSheet = sh_(SHEET.EXP);
  var expenses = [];
  readBlock_(expSheet, EXP_COLS).forEach(function (r) {
    var v = r.v;
    var amount = Number(v[3]);
    if (!String(v[1]).trim() || v[3] === '' || !isFinite(amount)) return;
    var id = String(v[5] || '');
    if (!id) {
      id = newId_();
      expSheet.getRange(r.row, 6).setValue(id);
      if (!expSheet.getRange(r.row, 5).getFormula()) expSheet.getRange(r.row, 5).setFormula(expFormula_(r.row));
    }
    expenses.push({ id: id, date: fmt(v[0]), category: String(v[1]).trim(), note: String(v[2] || ''), amount: amount });
  });

  return { categories: readCategories_(), topups: topups, expenses: expenses, serverTime: new Date().toISOString() };
}

function readBlock_(sheet, ncols) {
  var last = sheet.getLastRow();
  if (last < FIRST_ROW) return [];
  return sheet.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, ncols).getValues()
    .map(function (v, i) { return { v: v, row: FIRST_ROW + i }; });
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 14);
}

/* ------------------------------------------------------------------ */
/*  Util                                                                */
/* ------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }

function sh_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new Error('Sheet "' + name + '" belum ada. Jalankan setup() dulu.');
  return s;
}

/* ------------------------------------------------------------------ */
/*  Setup (aman dijalankan berulang; tidak menimpa data)                */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Budget Saver').addItem('Siapkan sheet', 'setup').addToUi();
}

function setup() {
  var ss = ss_();
  var created = [];

  var cat = ss.getSheetByName(SHEET.CAT);
  if (!cat) {
    cat = ss.insertSheet(SHEET.CAT);
    cat.getRange('A1').setValue('Daftar Kategori');
    cat.getRange('A2').setValue('Maks. 10 kategori. Nama ini muncul di dropdown & Dashboard.');
    cat.getRange('A4:B4').setValues([['Kategori', 'Catatan']]);
    cat.getRange(FIRST_ROW, 1, 4, 2).setValues([
      ['Personal Care', 'Sabun, skincare, potong rambut'],
      ['Primary Needs', 'Makan, transport, kebutuhan pokok'],
      ['To Invest', 'Dana yang disisihkan untuk investasi'],
      ['AI Subscription', 'Langganan tools AI']
    ]);
    styleSheet_(cat, 'Daftar Kategori', ['A4:B4'], [260, 360]);
    created.push(SHEET.CAT);
  }

  var top = ss.getSheetByName(SHEET.TOP);
  if (!top) {
    top = ss.insertSheet(SHEET.TOP);
    top.getRange('A1').setValue('Top Up / Alokasi ke Kategori');
    top.getRange('A2').setValue('Catat setiap uang yang masuk ke sebuah kategori. Bisa diisi dari aplikasi atau langsung di sini.');
    top.getRange(HEADER_ROW, 1, 1, TOP_COLS).setValues([['Tanggal', 'Kategori', 'Jumlah (IDR)', 'Catatan', 'ID']]);
    styleSheet_(top, 'Top Up', ['A4:E4'], [120, 180, 140, 320, 90]);
    top.getRange(FIRST_ROW, 1, LAST_ROW - FIRST_ROW + 1, 1).setNumberFormat('dd mmm yyyy');
    top.getRange(FIRST_ROW, 3, LAST_ROW - FIRST_ROW + 1, 1).setNumberFormat('#,##0');
    created.push(SHEET.TOP);
  }
  if (!top.getRange(HEADER_ROW, 5).getValue()) top.getRange(HEADER_ROW, 5).setValue('ID');

  var exp = ss.getSheetByName(SHEET.EXP);
  if (!exp) {
    exp = ss.insertSheet(SHEET.EXP);
    exp.getRange('A1').setValue('Catatan Pengeluaran Harian');
    exp.getRange('A2').setValue('Kolom E otomatis. Saldo kategori merah = melebihi alokasi.');
    exp.getRange(HEADER_ROW, 1, 1, EXP_COLS).setValues([['Tanggal', 'Kategori', 'Keterangan', 'Jumlah (IDR)', 'Sisa Saldo Kategori', 'ID']]);
    styleSheet_(exp, 'Pengeluaran', ['A4:F4'], [120, 180, 280, 140, 170, 90]);
    exp.getRange(FIRST_ROW, 1, LAST_ROW - FIRST_ROW + 1, 1).setNumberFormat('dd mmm yyyy');
    exp.getRange(FIRST_ROW, 4, LAST_ROW - FIRST_ROW + 1, 2).setNumberFormat('#,##0');
    created.push(SHEET.EXP);
  }
  if (!exp.getRange(HEADER_ROW, 6).getValue()) exp.getRange(HEADER_ROW, 6).setValue('ID');

  // Dropdown kategori untuk pengisian manual di Sheets.
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(cat.getRange(FIRST_ROW, 1, MAX_CATEGORIES, 1), true)
    .setAllowInvalid(false)
    .build();
  top.getRange(FIRST_ROW, 2, LAST_ROW - FIRST_ROW + 1, 1).setDataValidation(rule);
  exp.getRange(FIRST_ROW, 2, LAST_ROW - FIRST_ROW + 1, 1).setDataValidation(rule);

  // Kolom ID disembunyikan (dipakai aplikasi untuk edit/hapus).
  top.hideColumns(5);
  exp.hideColumns(6);

  if (!ss.getSheetByName(SHEET.DASH)) {
    buildDashboard_(ss);
    created.push(SHEET.DASH);
  }

  // Hapus lembar kosong bawaan bila ada.
  ['Sheet1', 'Lembar1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s);
  });

  var msg = created.length
    ? 'Sheet dibuat: ' + created.join(', ') + '. Lanjut ke Deploy > New deployment > Web app.'
    : 'Semua sheet sudah ada. Tidak ada yang diubah.';
  Logger.log(msg);
  try { ss.toast(msg, 'Budget Saver', 8); } catch (e) { /* tidak ada UI */ }
}

function styleSheet_(sheet, title, headerRanges, widths) {
  sheet.getRange('A1').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setFontColor('#6e6e73');
  headerRanges.forEach(function (a1) {
    sheet.getRange(a1).setFontWeight('bold').setBackground('#1d1d1f').setFontColor('#ffffff');
  });
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.setFrozenRows(HEADER_ROW);
}

function buildDashboard_(ss) {
  var d = ss.insertSheet(SHEET.DASH, 0);
  var T = "'" + SHEET.TOP + "'!";
  var E = "'" + SHEET.EXP + "'!";
  d.getRange('A1').setValue('Dashboard Budget Amplop');
  d.getRange('A3').setValue('Bulan dilihat');
  d.getRange('B3').setFormula('=DATE(YEAR(TODAY()),MONTH(TODAY()),1)').setNumberFormat('mmmm yyyy');
  d.getRange('C3').setValue('← ganti dengan tanggal 1 bulan yang ingin dilihat');
  d.getRange('A4').setValue('Total Cash');
  d.getRange('B4').setFormula('=D16');
  d.getRange('A5:G5').setValues([['Kategori', 'Total Top Up', 'Total Terpakai', 'Saldo', 'Terpakai Bulan Ini', '% Saldo', 'Sisa Amplop']]);

  for (var i = 0; i < MAX_CATEGORIES; i++) {
    var r = 6 + i;
    d.getRange(r, 1, 1, 7).setFormulas([[
      '=IF(Kategori!A' + (5 + i) + '="","",Kategori!A' + (5 + i) + ')',
      '=IF(A' + r + '="","",SUMIFS(' + T + '$C$5:$C$1000,' + T + '$B$5:$B$1000,A' + r + '))',
      '=IF(A' + r + '="","",SUMIFS(' + E + '$D$5:$D$1000,' + E + '$B$5:$B$1000,A' + r + '))',
      '=IF(A' + r + '="","",B' + r + '-C' + r + ')',
      '=IF(A' + r + '="","",SUMIFS(' + E + '$D$5:$D$1000,' + E + '$B$5:$B$1000,A' + r + ',' + E + '$A$5:$A$1000,">="&$B$3,' + E + '$A$5:$A$1000,"<"&EDATE($B$3,1)))',
      '=IF(A' + r + '="","",IF(B' + r + '=0,0,MAX(0,MIN(1,D' + r + '/B' + r + '))))',
      '=IF(A' + r + '="","","["&REPT("█",ROUND(F' + r + '*10,0))&REPT("░",10-ROUND(F' + r + '*10,0))&"]")'
    ]]);
  }
  d.getRange('A16:G16').setFormulas([[
    'TOTAL', '=SUM(B6:B15)', '=SUM(C6:C15)', '=SUM(D6:D15)', '=SUM(E6:E15)',
    '=IF(B16=0,0,MAX(0,MIN(1,D16/B16)))', ''
  ]]);

  d.getRange('B4').setNumberFormat('#,##0');
  d.getRange('B6:E16').setNumberFormat('#,##0');
  d.getRange('F6:F16').setNumberFormat('0%');
  d.getRange('A1').setFontSize(18).setFontWeight('bold');
  d.getRange('A4:B4').setFontWeight('bold');
  d.getRange('A5:G5').setFontWeight('bold').setBackground('#1d1d1f').setFontColor('#ffffff');
  d.getRange('A16:G16').setFontWeight('bold');
  [180, 140, 140, 140, 160, 90, 150].forEach(function (w, i) { d.setColumnWidth(i + 1, w); });

  var red = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0).setFontColor('#ff3b30').setRanges([d.getRange('D6:D16')]).build();
  d.setConditionalFormatRules([red]);
}
