// Tiruan minimal Apps Script runtime agar Code.gs bisa dieksekusi di Node untuk pengujian.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

class FakeSheet {
  constructor(name, maxRows = 1000, maxCols = 12) {
    this.name = name; this.maxRows = maxRows; this.maxCols = maxCols;
    this.cells = new Map(); // "r,c" -> {v, f}
  }
  _k(r, c) { return r + ',' + c; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  deleteRow(r) {
    const next = new Map();
    for (const [k, cell] of this.cells) {
      const [rr, cc] = k.split(',').map(Number);
      if (rr === r) continue;
      next.set(this._k(rr > r ? rr - 1 : rr, cc), cell);
    }
    this.cells = next;
  }
  getLastRow() {
    let last = 0;
    for (const [k, cell] of this.cells) {
      if ((cell.v !== '' && cell.v != null) || cell.f) last = Math.max(last, Number(k.split(',')[0]));
    }
    return last;
  }
  getRange(a, b, c, d) {
    let row, col, nr = 1, nc = 1;
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      const toN = s => s.split('').reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0);
      col = toN(m[1]); row = Number(m[2]);
      if (m[3]) { nc = toN(m[3]) - col + 1; nr = Number(m[4]) - row + 1; }
    } else { row = a; col = b; nr = c || 1; nc = d || 1; }
    const sheet = this;
    const base = {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const rr = []; for (let j = 0; j < nc; j++) { const cell = sheet.cells.get(sheet._k(row + i, col + j)); rr.push(cell && cell.v != null ? cell.v : ''); } out.push(rr); }
        return out;
      },
      getValue() { return this.getValues()[0][0]; },
      setValues(vals) { vals.forEach((rv, i) => rv.forEach((v, j) => { const k = sheet._k(row + i, col + j); const old = sheet.cells.get(k) || {}; sheet.cells.set(k, { v, f: old.f }); })); return proxy; },
      setValue(v) { const k = sheet._k(row, col); const old = sheet.cells.get(k) || {}; sheet.cells.set(k, { v, f: old.f }); return proxy; },
      getFormula() { const cell = sheet.cells.get(sheet._k(row, col)); return (cell && cell.f) || ''; },
      setFormula(f) { sheet.cells.set(sheet._k(row, col), { v: '', f }); return proxy; },
      setFormulas(fs_) { fs_.forEach((rv, i) => rv.forEach((f, j) => { if (typeof f === 'string' && f.startsWith('=')) sheet.cells.set(sheet._k(row + i, col + j), { v: '', f }); else sheet.cells.set(sheet._k(row + i, col + j), { v: f, f: '' }); })); return proxy; }
    };
    const proxy = new Proxy(base, { get(t, p) { if (p in t) return t[p]; return () => proxy; } });
    return proxy;
  }
  hideColumns() {} setColumnWidth() {} setFrozenRows() {} setConditionalFormatRules() {}
}

class FakeSS {
  constructor() { this.sheets = [new FakeSheet('Sheet1')]; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n, i) { const s = new FakeSheet(n); if (i === 0) this.sheets.unshift(s); else this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  getSpreadsheetTimeZone() { return 'Asia/Jakarta'; }
  toast() {}
}

function loadGas({ token = 'test-token-123', noSheet = false } = {}) {
  const ss = new FakeSS();
  const out = (txt) => ({ _txt: txt, setMimeType() { return this; }, getContent: () => txt });
  const sandbox = {
    console, Logger: { log: () => {} }, Date, JSON, Math, Number, String, isFinite, Error, Array,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (noSheet ? null : ss),
      newDataValidation: () => { const b = { requireValueInRange() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } }; return b; },
      newConditionalFormatRule: () => { const b = new Proxy({}, { get: (t, p) => p === 'build' ? () => ({}) : () => b }); return b; },
      getUi: () => ({ createMenu: () => new Proxy({}, { get: () => function () { return this; } }) })
    },
    ContentService: { createTextOutput: out, MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      parseDate: (s, tz, f) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, -7)); }, // Asia/Jakarta = UTC+7
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 7 * 3600e3); return t.toISOString().slice(0, 10); }
    }
  };
  vm.createContext(sandbox);
  let code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
  code = code.replace("const API_TOKEN = 'GANTI_TOKEN_INI';", `const API_TOKEN = ${JSON.stringify(token)};`);
  // const/function di top-level vm script: ekspos lewat globalThis
  vm.runInContext(code + '\n;globalThis.__api={doPost,doGet,setup,readAll_,SHEET};', sandbox);
  return { ss, api: sandbox.__api, post: (body) => JSON.parse(sandbox.__api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()) };
}

module.exports = { loadGas };
