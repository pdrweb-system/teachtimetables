// In-memory mock ของ Google Apps Script services ที่ Code.gs ใช้ (รันใน Node ได้)
// ใช้: require('./gasmock.js') แล้วโหลด Code.gs ด้วย vm.runInThisContext
(function (G) {
  function Sheet(name) { this.name = name; this.data = []; }
  Sheet.prototype.getLastRow = function () {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i] && this.data[i].some(v => v !== '' && v != null)) return i + 1;
    return 0;
  };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    const sh = this;
    if (typeof r === 'string') return { setNumberFormat() { return this; }, setDataValidation() { return this; } };
    nr = nr || 1; nc = nc || 1;
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (sh.data[r - 1 + i] || [])[c - 1 + j]; row.push(v == null ? '' : v); } out.push(row); } return out; },
      setValues(v) { for (let i = 0; i < nr; i++) { sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
      setValue(v) { sh.data[r - 1] = sh.data[r - 1] || []; sh.data[r - 1][c - 1] = v; return this; },
      clearContent() { for (let i = 0; i < nr; i++) if (sh.data[r - 1 + i]) for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = ''; return this; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
      setNumberFormat() { return this; }, setDataValidation() { return this; },
    };
  };
  Sheet.prototype.appendRow = function (row) { this.data[this.getLastRow()] = row.slice(); };
  Sheet.prototype.setFrozenRows = function () {};

  const book = {
    sheets: {}, getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return (this.sheets[n] = new Sheet(n)); },
    getId() { return 'SSID'; }, setSpreadsheetTimeZone() {}, getSpreadsheetTimeZone() { return 'Asia/Bangkok'; },
    getUrl() { return 'https://docs.google.com/spreadsheets/d/SSID'; },
    getSheets() { return Object.values(this.sheets); }, deleteSheet(s) { delete this.sheets[s.name]; },
  };
  G.__book = book;

  const props = {};
  G.__props = props;
  G.PropertiesService = { getScriptProperties() { return { getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }; } };
  G.SpreadsheetApp = {
    getActiveSpreadsheet: () => book, openById: () => book,
    newDataValidation() { const b = { requireValueInRange: () => b, requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; },
    getUi() { return { createMenu() { const m = { addItem: () => m, addToUi() {} }; return m; } }; },
  };
  const pad = n => ('0' + n).slice(-2);
  G.Utilities = {
    formatDate(d, tz, fmt) { // รองรับเฉพาะ Asia/Bangkok (UTC+7)
      const t = new Date(d.getTime() + 7 * 3600000);
      return fmt.replace('yyyy', t.getUTCFullYear()).replace('MM', pad(t.getUTCMonth() + 1)).replace('dd', pad(t.getUTCDate()))
        .replace('HH', pad(t.getUTCHours())).replace('mm', pad(t.getUTCMinutes())).replace('ss', pad(t.getUTCSeconds()));
    },
    getUuid() { return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2); },
    base64Decode(s) { return s.length; }, newBlob(b, t, n) { return { b, t, n }; },
  };
  G.LockService = { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } };
  const cache = {};
  G.CacheService = { getScriptCache() { return { get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }; } };
  let fid = 0;
  G.DriveApp = {
    Access: {}, Permission: {}, getFolderById() { return this.createFolder(); },
    createFolder() { return { getId: () => 'FOLDER', createFile() { const id = 'FILE' + (++fid); return { getId: () => id, setSharing() {} }; } }; },
  };
  // LINE API ปลอม — เก็บทุกคำขอไว้ใน __lineCalls
  G.__lineCalls = [];
  G.UrlFetchApp = {
    fetch(url, opt) {
      const path = url.replace('https://api.line.me', '');
      G.__lineCalls.push({ path, method: opt.method, payload: opt.payload ? JSON.parse(opt.payload) : null });
      let body = '{}';
      if (path === '/v2/bot/info') body = JSON.stringify({ userId: 'UBOT', displayName: 'บอทสอนแทน', basicId: '@123abc' });
      else if (path.indexOf('/member/') >= 0 || path.indexOf('/profile/') >= 0) body = JSON.stringify({ displayName: 'LINE-' + path.split('/').pop() });
      else if (path === '/v2/bot/message/quota') body = JSON.stringify({ type: 'limited', value: 300 });
      else if (path === '/v2/bot/message/quota/consumption') body = JSON.stringify({ totalUsage: 12 });
      return { getResponseCode: () => 200, getContentText: () => body };
    },
  };
  G.ScriptApp = { getService() { return { getUrl: () => 'https://script.google.com/macros/s/XYZ/exec' }; } };
  G.Logger = { log() {} };
  G.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput(t) { return { content: t, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } }; },
  };
  G.HtmlService = {};
})(globalThis);
