/**
 * ระบบจัดสอนแทน (Substitute Teacher Scheduler)
 * Google Apps Script + Google Sheets (ฐานข้อมูลฟรี) + LINE Messaging API
 *
 * สถาปัตยกรรม: หน้าเว็บ (index.html) อยู่บน GitHub Pages, ไฟล์นี้เป็น JSON API อย่างเดียว
 *   1) วางไฟล์นี้เป็น Code.gs ในโปรเจกต์ Apps Script ที่ผูกกับ Google Sheet (ไม่ต้องมี Index.html ใน Apps Script)
 *   2) รันฟังก์ชัน setup() หนึ่งครั้ง
 *   3) Deploy เป็น Web app (Execute as: Me, Who has access: Anyone) → นำ URL /exec ไปใส่ในหน้าเว็บ และเป็น Webhook ของ LINE
 */

// ───────────────────────── ค่าคงที่ ─────────────────────────
const SH = {
  SETTINGS: 'ตั้งค่า',
  TEACHERS: 'ครู',
  PERIODS: 'คาบเรียน',
  TIMETABLE: 'ตารางสอน',
  SUBS: 'บันทึกสอนแทน',
  MEMBERS: 'สมาชิกไลน์',
  IMAGES: 'ภาพตารางสอนแทน',
};

const HEADERS = {};
HEADERS[SH.SETTINGS] = ['หัวข้อ', 'ค่า', 'คำอธิบาย'];
HEADERS[SH.TEACHERS] = ['ชื่อครู', 'ชื่อที่แสดง', 'กลุ่มสาระ/หน้าที่', 'LINE userId', 'ชื่อในไลน์', 'ใช้งาน'];
HEADERS[SH.PERIODS] = ['คาบ', 'เริ่ม', 'สิ้นสุด'];
HEADERS[SH.TIMETABLE] = ['ชื่อครู', 'วัน', 'คาบ', 'วิชา', 'ห้อง'];
HEADERS[SH.SUBS] = ['รหัส', 'วันที่', 'ครูที่ไม่อยู่', 'เหตุผล', 'คาบ', 'วิชา', 'ห้อง', 'ครูสอนแทน', 'หมายเหตุ', 'บันทึกเมื่อ'];
HEADERS[SH.MEMBERS] = ['LINE userId', 'ชื่อในไลน์', 'groupId', 'พบล่าสุด'];
HEADERS[SH.IMAGES] = ['วันที่', 'fileId', 'url', 'สร้างเมื่อ', 'ส่งไลน์เมื่อ'];

const SET = {
  SCHOOL: 'ชื่อโรงเรียน',
  GROUP: 'LINE groupId',
  SIGNER: 'ผู้จัดตารางสอนแทน',
  FOOTER: 'ข้อความท้ายประกาศไลน์',
};

const REASONS = ['ลาป่วย', 'ลากิจ', 'ไปราชการ', 'อบรม/ประชุม', 'ลาคลอด', 'อื่น ๆ'];
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TZ = 'Asia/Bangkok';
const PROP = PropertiesService.getScriptProperties();

const HELP_TEXT = [
  '🤖 คำสั่งบอทสอนแทน',
  '• สอนแทน — ดูตารางสอนแทนวันนี้',
  '• สอนแทนพรุ่งนี้ — ดูของวันพรุ่งนี้',
  '• ลงทะเบียน ชื่อ — ผูกไลน์กับชื่อครู เช่น ลงทะเบียน สมชาย',
  '• ตั้งกลุ่มนี้ — ใช้กลุ่มนี้รับประกาศสอนแทน',
  '• คำสั่ง — แสดงรายการคำสั่ง',
].join('\n');

// ───────────────────────── JSON API (หน้าเว็บอยู่บน GitHub Pages) ─────────────────────────
// หน้าเว็บเรียก: GET  ?fn=<ชื่อ>&args=<JSON array>      → ฟังก์ชันอ่านอย่างเดียว
//               POST body (text/plain) {"fn":..,"args":[..]} → ฟังก์ชันที่เขียนข้อมูล/ส่งไลน์
// ทุกคำตอบเป็น {ok:true,result} หรือ {ok:false,error}
// ต้องตรงกับ GET_FUNCTIONS ใน index.html
const GET_API = {
  getInitData: function () { return getInitData(); },
  getDateData: function (date) { return getDateData(date); },
  getStats: function (month) { return getStats(month); },
};

const POST_API = {
  saveDay: saveDay,
  saveImageToDrive: saveImageToDrive,
  sendToLine: sendToLine,
  getAdminData: getAdminData,
  saveLineToken: saveLineToken,
  linkTeacherLine: linkTeacherLine,
  sendLineTest: sendLineTest,
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  const fn = p.fn;
  if (!fn) return jsonOut_({ ok: true, result: { service: 'ระบบจัดสอนแทน API', time: nowStr_() } });
  if (!GET_API[fn]) return jsonOut_({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + fn });
  try {
    const args = p.args ? JSON.parse(p.args) : [];
    return jsonOut_({ ok: true, result: GET_API[fn].apply(null, args) });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ระบบสอนแทน')
    .addItem('ติดตั้ง / ซ่อมแซมชีต', 'setup')
    .addToUi();
}

// ───────────────────────── ติดตั้ง ─────────────────────────
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ให้สร้างสคริปต์จากเมนู ส่วนขยาย > Apps Script ของ Google Sheet');
  PROP.setProperty('SS_ID', ss.getId());
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]])
        .setFontWeight('bold').setBackground('#1f4e8c').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });

  // คอลัมน์ที่ต้องเก็บเป็นข้อความ (กันวันที่/เวลา/รหัสถูกแปลงอัตโนมัติ)
  sheet_(SH.SETTINGS).getRange('B:B').setNumberFormat('@');
  sheet_(SH.PERIODS).getRange('B:C').setNumberFormat('@');
  sheet_(SH.SUBS).getRange('B:B').setNumberFormat('@');
  sheet_(SH.IMAGES).getRange('A:A').setNumberFormat('@');
  sheet_(SH.TEACHERS).getRange('D:D').setNumberFormat('@');

  seedIfEmpty_();

  // Dropdown ในชีตตารางสอน
  const tt = sheet_(SH.TIMETABLE);
  tt.getRange('A2:A').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sheet_(SH.TEACHERS).getRange('A2:A'), true).setAllowInvalid(true).build());
  tt.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'], true)
    .setAllowInvalid(true).build());
  sheet_(SH.SUBS).getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(REASONS, true).setAllowInvalid(true).build());

  // ลบชีตเปล่าเริ่มต้น
  ['Sheet1', 'แผ่นงาน1', 'ชีต1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  Logger.log('ติดตั้งเสร็จ — ต่อไปให้กรอกข้อมูลครู/ตารางสอน แล้ว Deploy เป็น Web app');
}

function seedIfEmpty_() {
  const st = sheet_(SH.SETTINGS);
  if (st.getLastRow() < 2) {
    st.getRange(2, 1, 4, 3).setValues([
      [SET.SCHOOL, 'โรงเรียนตัวอย่าง', 'แสดงบนหัวภาพตารางสอนแทน'],
      [SET.GROUP, '', 'ระบบกรอกให้อัตโนมัติเมื่อเชิญบอทเข้ากลุ่มไลน์'],
      [SET.SIGNER, 'งานวิชาการ', 'แสดงท้ายภาพ'],
      [SET.FOOTER, 'ขอบคุณคุณครูทุกท่านที่ช่วยดูแลนักเรียน 🙏', 'ข้อความท้ายประกาศในไลน์'],
    ]);
  }

  const pr = sheet_(SH.PERIODS);
  if (pr.getLastRow() < 2) {
    pr.getRange(2, 1, 7, 3).setValues([
      [1, '08:30', '09:20'], [2, '09:20', '10:10'], [3, '10:20', '11:10'], [4, '11:10', '12:00'],
      [5, '13:00', '13:50'], [6, '13:50', '14:40'], [7, '14:40', '15:30'],
    ]);
  }

  const te = sheet_(SH.TEACHERS);
  if (te.getLastRow() < 2) {
    const sample = [
      ['ครูสมชาย ใจดี', 'ครูสมชาย', 'คณิตศาสตร์'],
      ['ครูสมหญิง รักเรียน', 'ครูสมหญิง', 'ภาษาไทย'],
      ['ครูวิชัย เก่งกล้า', 'ครูวิชัย', 'วิทยาศาสตร์'],
      ['ครูมาลี ศรีสุข', 'ครูมาลี', 'ภาษาอังกฤษ'],
      ['ครูประเสริฐ มั่นคง', 'ครูประเสริฐ', 'สังคมศึกษา'],
      ['ครูนภา แสงทอง', 'ครูนภา', 'ศิลปะ'],
    ];
    te.getRange(2, 1, sample.length, 6).setValues(sample.map(function (r) { return [r[0], r[1], r[2], '', '', true]; }));

    const tt = sheet_(SH.TIMETABLE);
    if (tt.getLastRow() < 2) {
      const rows = [];
      ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'].forEach(function (day, d) {
        sample.forEach(function (t, i) {
          for (let p = 1; p <= 7; p++) {
            if ((p + i + d) % 7 < 4) rows.push([t[0], day, p, t[2], 'ป.' + (((i + p) % 6) + 1) + '/1']);
          }
        });
      });
      tt.getRange(2, 1, rows.length, 5).setValues(rows);
    }
  }
}

// ───────────────────────── Helpers ─────────────────────────
let _ss = null;
function ss_() {
  if (_ss) return _ss;
  const id = PROP.getProperty('SS_ID');
  _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) throw new Error('ระบบยังไม่ได้ติดตั้ง — ให้รันฟังก์ชัน setup ก่อน');
  return _ss;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต "' + name + '" — ให้รันฟังก์ชัน setup');
  return sh;
}

function rows_(name) {
  const sh = sheet_(name);
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, HEADERS[name].length).getValues();
}

function str_(v) { return v == null ? '' : String(v).trim(); }

function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return str_(v);
}

function timeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'HH:mm');
  return str_(v).replace('.', ':');
}

function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function todayStr_(offsetDays) {
  return Utilities.formatDate(new Date(Date.now() + (offsetDays || 0) * 86400000), TZ, 'yyyy-MM-dd');
}

function checkDate_(d) {
  d = str_(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  return d;
}

function weekdayOf_(date) {
  const p = date.split('-').map(Number);
  return DAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
}

function thaiDate_(date) {
  const p = date.split('-').map(Number);
  return 'วัน' + weekdayOf_(date) + 'ที่ ' + p[2] + ' ' + TH_MONTHS[p[1] - 1] + ' ' + (p[0] + 543);
}

function normDay_(v) {
  const s = str_(v).replace(/^วัน/, '');
  const map = {
    'จ': 'จันทร์', 'จ.': 'จันทร์', 'อ': 'อังคาร', 'อ.': 'อังคาร', 'พ': 'พุธ', 'พ.': 'พุธ',
    'พฤ': 'พฤหัสบดี', 'พฤ.': 'พฤหัสบดี', 'พฤหัส': 'พฤหัสบดี', 'ศ': 'ศุกร์', 'ศ.': 'ศุกร์',
    'ส': 'เสาร์', 'ส.': 'เสาร์', 'อา': 'อาทิตย์', 'อา.': 'อาทิตย์',
    '1': 'จันทร์', '2': 'อังคาร', '3': 'พุธ', '4': 'พฤหัสบดี', '5': 'ศุกร์', '6': 'เสาร์', '7': 'อาทิตย์',
  };
  return map[s] || s;
}

function settings_() {
  const out = {};
  rows_(SH.SETTINGS).forEach(function (r) { if (str_(r[0])) out[str_(r[0])] = str_(r[1]); });
  return out;
}

function setSetting_(key, value) {
  const sh = sheet_(SH.SETTINGS);
  const n = sh.getLastRow();
  if (n >= 2) {
    const keys = sh.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (str_(keys[i][0]) === key) { sh.getRange(i + 2, 2).setValue(value); return; }
    }
  }
  sh.appendRow([key, value, '']);
}

function teachers_() {
  return rows_(SH.TEACHERS).map(function (r, i) {
    return {
      row: i + 2,
      name: str_(r[0]),
      display: str_(r[1]) || str_(r[0]),
      dept: str_(r[2]),
      userId: str_(r[3]),
      lineName: str_(r[4]),
      active: !/^(false|ไม่|ไม่ใช้|no|n|0)$/i.test(str_(r[5])),
    };
  }).filter(function (t) { return t.name; });
}

function periods_() {
  return rows_(SH.PERIODS).map(function (r) {
    return { p: Number(r[0]), start: timeStr_(r[1]), end: timeStr_(r[2]) };
  }).filter(function (x) { return x.p > 0; }).sort(function (a, b) { return a.p - b.p; });
}

function timetableFor_(weekday) {
  return rows_(SH.TIMETABLE).map(function (r) {
    return { teacher: str_(r[0]), day: normDay_(r[1]), period: Number(r[2]) || 0, subject: str_(r[3]), room: str_(r[4]) };
  }).filter(function (x) { return x.teacher && x.day === weekday && x.period > 0; });
}

function subsAll_() {
  return rows_(SH.SUBS).map(function (r) {
    return {
      id: str_(r[0]), date: dateStr_(r[1]), absent: str_(r[2]), reason: str_(r[3]),
      period: Number(r[4]) || 0, subject: str_(r[5]), room: str_(r[6]), sub: str_(r[7]), note: str_(r[8]),
    };
  }).filter(function (x) { return x.date && x.absent; });
}

function latestImage_(date) {
  const list = rows_(SH.IMAGES).filter(function (r) { return dateStr_(r[0]) === date && str_(r[2]); });
  if (!list.length) return null;
  const r = list[list.length - 1];
  return { fileId: str_(r[1]), url: str_(r[2]), viewUrl: 'https://drive.google.com/file/d/' + str_(r[1]) + '/view' };
}

// ───────────────────────── API สำหรับหน้าเว็บ ─────────────────────────
function getInitData() {
  const st = settings_();
  let webAppUrl = '';
  try { webAppUrl = ScriptApp.getService().getUrl(); } catch (e) { /* ignore */ }
  return {
    school: st[SET.SCHOOL] || '',
    signer: st[SET.SIGNER] || '',
    teachers: teachers_().map(function (t) {
      return { name: t.name, display: t.display, dept: t.dept, active: t.active, linked: !!t.userId };
    }),
    periods: periods_(),
    reasons: REASONS,
    today: todayStr_(0),
    sheetUrl: ss_().getUrl(),
    webAppUrl: webAppUrl,
  };
}

function getDateData(date) {
  date = checkDate_(date);
  const weekday = weekdayOf_(date);
  const month = date.slice(0, 7);
  const all = subsAll_();
  const monthCounts = {};
  all.forEach(function (s) {
    if (s.sub && s.date !== date && s.date.slice(0, 7) === month) monthCounts[s.sub] = (monthCounts[s.sub] || 0) + 1;
  });
  const subs = all.filter(function (s) { return s.date === date; })
    .sort(function (a, b) { return (a.period || 99) - (b.period || 99); });
  return {
    date: date,
    weekday: weekday,
    thaiDate: thaiDate_(date),
    timetable: timetableFor_(weekday),
    subs: subs,
    monthCounts: monthCounts,
    image: latestImage_(date),
  };
}

/** บันทึกรายการสอนแทนของทั้งวัน (แทนที่ข้อมูลเดิมของวันนั้น) */
function saveDay(date, rows) {
  date = checkDate_(date);
  const names = {};
  teachers_().forEach(function (t) { names[t.name] = true; });
  const now = nowStr_();

  const clean = (rows || []).map(function (r) {
    const absent = str_(r.absent);
    const sub = str_(r.sub);
    if (!names[absent]) throw new Error('ไม่พบชื่อครู: ' + absent);
    if (sub && !names[sub]) throw new Error('ไม่พบชื่อครู: ' + sub);
    if (sub && sub === absent) throw new Error(absent + ' สอนแทนตัวเองไม่ได้');
    return [Utilities.getUuid().slice(0, 8), date, absent, str_(r.reason), Number(r.period) || '',
      str_(r.subject), str_(r.room), sub, str_(r.note), now];
  });

  const seen = {};
  clean.forEach(function (c) {
    if (!c[7] || !c[4]) return;
    const k = c[7] + '|' + c[4];
    if (seen[k]) throw new Error(c[7] + ' ถูกจัดสอนแทนซ้ำในคาบ ' + c[4]);
    seen[k] = true;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SH.SUBS);
    const W = HEADERS[SH.SUBS].length;
    const n = sh.getLastRow();
    const keep = n > 1 ? sh.getRange(2, 1, n - 1, W).getValues().filter(function (r) {
      return str_(r[2]) && dateStr_(r[1]) !== date;
    }) : [];
    keep.forEach(function (r) { r[1] = dateStr_(r[1]); });
    const all = keep.concat(clean).sort(function (a, b) {
      if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
      return (Number(a[4]) || 99) - (Number(b[4]) || 99);
    });
    if (n > 1) sh.getRange(2, 1, n - 1, W).clearContent();
    if (all.length) sh.getRange(2, 1, all.length, W).setValues(all);

    // ภาพเดิมของวันนี้ไม่ตรงกับข้อมูลใหม่แล้ว → ลบออกจากรายการ (ไฟล์ใน Drive ยังอยู่)
    const im = sheet_(SH.IMAGES);
    const m = im.getLastRow();
    if (m > 1) {
      const IW = HEADERS[SH.IMAGES].length;
      const imgs = im.getRange(2, 1, m - 1, IW).getValues().filter(function (r) { return dateStr_(r[0]) !== date; });
      imgs.forEach(function (r) { r[0] = dateStr_(r[0]); });
      im.getRange(2, 1, m - 1, IW).clearContent();
      if (imgs.length) im.getRange(2, 1, imgs.length, IW).setValues(imgs);
    }
  } finally {
    lock.releaseLock();
  }
  return getDateData(date);
}

/** เก็บภาพตารางสอนแทนลง Google Drive (ใช้ทั้งส่งไลน์และตอบคำสั่งในกลุ่ม) */
function saveImageToDrive(date, dataUrl) {
  date = checkDate_(date);
  return saveImage_(date, dataUrl);
}

function saveImage_(date, dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(png|jpeg));base64,(.+)$/);
  if (!m) throw new Error('ข้อมูลภาพไม่ถูกต้อง');
  const ext = m[2] === 'png' ? 'png' : 'jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], 'สอนแทน_' + date + '_' + Date.now() + '.' + ext);
  const file = folder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    throw new Error('แชร์ภาพแบบ "ทุกคนที่มีลิงก์" ไม่ได้ (บัญชีโรงเรียนอาจปิดไว้) — ใช้บัญชี Gmail ส่วนตัวติดตั้งแทน');
  }
  const url = 'https://lh3.googleusercontent.com/d/' + file.getId();
  sheet_(SH.IMAGES).appendRow([date, file.getId(), url, nowStr_(), '']);
  return { fileId: file.getId(), url: url, viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view' };
}

function folder_() {
  const id = PROP.getProperty('FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* สร้างใหม่ */ }
  }
  const f = DriveApp.createFolder('ภาพตารางสอนแทน');
  PROP.setProperty('FOLDER_ID', f.getId());
  return f;
}

/** ส่งภาพ + ข้อความแท็กชื่อเข้ากลุ่มไลน์ (push — ใช้โควตาข้อความ) */
function sendToLine(date, dataUrl) {
  date = checkDate_(date);
  if (!PROP.getProperty('LINE_TOKEN')) throw new Error('ยังไม่ได้ใส่ Channel access token (เมนู ตั้งค่า)');
  const groupId = settings_()[SET.GROUP];
  if (!groupId) throw new Error('ยังไม่ได้เชื่อมกลุ่มไลน์ — เชิญบอทเข้ากลุ่มก่อน');

  const dd = getDateData(date);
  if (!dd.subs.length) throw new Error('ยังไม่มีรายการสอนแทนของวันนี้');

  let img = null;
  if (dataUrl) img = saveImage_(date, dataUrl);
  else img = dd.image;

  const msgs = [];
  if (img) msgs.push({ type: 'image', originalContentUrl: img.url, previewImageUrl: img.url });
  const built = buildLineMessage_(dd, true);
  msgs.push(built.message);
  lineApi_('/v2/bot/message/push', { to: groupId, messages: msgs });

  if (img) {
    const sh = sheet_(SH.IMAGES);
    const n = sh.getLastRow();
    const ids = n > 1 ? sh.getRange(2, 2, n - 1, 1).getValues() : [];
    for (let i = ids.length - 1; i >= 0; i--) {
      if (str_(ids[i][0]) === img.fileId) { sh.getRange(i + 2, 5).setValue(nowStr_()); break; }
    }
  }
  return { ok: true, untagged: built.untagged };
}

/** สร้างข้อความประกาศ (textV2 + mention เมื่อทำได้) */
function buildLineMessage_(dd, allowMention) {
  const tmap = {};
  teachers_().forEach(function (t) { tmap[t.name] = t; });
  const pmap = {};
  periods_().forEach(function (p) { pmap[p.p] = p; });
  const disp = function (n) { return (tmap[n] && tmap[n].display) || n; };

  const slots = dd.subs.filter(function (s) { return s.period || s.subject; });
  const bySub = [];
  const idx = {};
  slots.forEach(function (s) {
    if (!s.sub) return;
    if (!(s.sub in idx)) { idx[s.sub] = bySub.length; bySub.push({ name: s.sub, list: [] }); }
    bySub[idx[s.sub]].list.push(s);
  });

  const untagged = bySub.filter(function (g) { return !(tmap[g.name] && tmap[g.name].userId); })
    .map(function (g) { return disp(g.name); });
  const useMention = allowMention && bySub.some(function (g) { return tmap[g.name] && tmap[g.name].userId; });
  const esc = function (s) { return useMention ? String(s).replace(/[{}]/g, function (c) { return c + c; }) : String(s); };

  const absents = [];
  const seenA = {};
  dd.subs.forEach(function (s) {
    if (seenA[s.absent]) return;
    seenA[s.absent] = true;
    absents.push('• ' + disp(s.absent) + (s.reason ? ' (' + s.reason + ')' : '') + (s.note ? ' — ' + s.note : ''));
  });

  const slotLine = function (s) {
    const p = pmap[s.period];
    const where = [s.room, s.subject].filter(String).join(' ');
    return '   ◦ คาบ ' + (s.period || '-') + (p ? ' (' + p.start + '-' + p.end + ')' : '') +
      (where ? ' ' + where : '') + ' แทน' + disp(s.absent);
  };

  let text = esc('📋 ตารางสอนแทน\n' + dd.thaiDate + '\n\n🙏 ครูที่ไม่อยู่\n' + absents.join('\n') + '\n');
  const subst = {};
  if (bySub.length) {
    text += esc('\n👩‍🏫 ผู้สอนแทน\n');
    bySub.forEach(function (g, i) {
      const t = tmap[g.name];
      if (useMention && t && t.userId) {
        const key = 't' + i;
        subst[key] = { type: 'mention', mentionee: { type: 'user', userId: t.userId } };
        text += '▪️ {' + key + '} ' + esc('(' + disp(g.name) + ')') + '\n';
      } else {
        text += esc('▪️ ' + disp(g.name) + '\n');
      }
      text += esc(g.list.sort(function (a, b) { return (a.period || 99) - (b.period || 99); }).map(slotLine).join('\n') + '\n');
    });
  }
  const open = slots.filter(function (s) { return !s.sub; });
  if (open.length) text += esc('\n⚠️ ยังไม่มีผู้สอนแทน\n' + open.map(slotLine).join('\n') + '\n');
  if (!slots.length) text += esc('\n(ไม่มีคาบที่ต้องสอนแทน)\n');
  const footer = settings_()[SET.FOOTER];
  if (footer) text += esc('\n' + footer);

  text = text.trim();
  if (text.length > 4900) text = text.slice(0, 4900) + '…';
  const message = useMention ? { type: 'textV2', text: text, substitution: subst } : { type: 'text', text: text };
  return { message: message, untagged: untagged };
}

// ───────────────────────── สถิติ ─────────────────────────
function getStats(month) {
  month = str_(month);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('รูปแบบเดือนไม่ถูกต้อง');
  const subs = subsAll_().filter(function (s) { return s.date.slice(0, 7) === month; });
  const subCount = {};
  const absentDays = {};
  const dates = {};
  subs.forEach(function (s) {
    if (s.sub) subCount[s.sub] = (subCount[s.sub] || 0) + 1;
    absentDays[s.absent] = absentDays[s.absent] || {};
    absentDays[s.absent][s.date] = true;
    if (!dates[s.date]) dates[s.date] = { date: s.date, thaiDate: thaiDate_(s.date), slots: 0, open: 0, absents: {} };
    dates[s.date].absents[s.absent] = true;
    if (s.period || s.subject) {
      dates[s.date].slots++;
      if (!s.sub) dates[s.date].open++;
    }
  });
  return {
    month: month,
    teachers: teachers_().filter(function (t) { return t.active; }).map(function (t) {
      return {
        name: t.name, display: t.display, dept: t.dept,
        subs: subCount[t.name] || 0,
        absentDays: Object.keys(absentDays[t.name] || {}).length,
      };
    }).sort(function (a, b) { return b.subs - a.subs || a.display.localeCompare(b.display, 'th'); }),
    dates: Object.keys(dates).sort().reverse().map(function (d) {
      const x = dates[d];
      return { date: x.date, thaiDate: x.thaiDate, slots: x.slots, open: x.open, absents: Object.keys(x.absents).length };
    }),
  };
}

// ───────────────────────── ตั้งค่า LINE ─────────────────────────
function getAdminData() {
  const st = settings_();
  const hasToken = !!PROP.getProperty('LINE_TOKEN');
  let bot = null;
  let quota = null;
  if (hasToken) {
    try {
      const b = lineApi_('/v2/bot/info', null, 'get');
      bot = { name: b.displayName, basicId: b.basicId };
    } catch (e) { bot = { error: e.message }; }
    try {
      const q = lineApi_('/v2/bot/message/quota', null, 'get');
      const c = lineApi_('/v2/bot/message/quota/consumption', null, 'get');
      quota = { type: q.type, limit: q.value, used: c.totalUsage };
    } catch (e) { /* ไม่แสดงโควตา */ }
  }
  return {
    hasToken: hasToken,
    bot: bot,
    quota: quota,
    groupId: st[SET.GROUP] || '',
    teachers: teachers_().map(function (t) {
      return { name: t.name, display: t.display, userId: t.userId, lineName: t.lineName, active: t.active };
    }),
    members: rows_(SH.MEMBERS).map(function (r) {
      return { userId: str_(r[0]), name: str_(r[1]) || '(ไม่ทราบชื่อ)', lastSeen: str_(r[3]) };
    }).filter(function (m) { return m.userId; }),
  };
}

function saveLineToken(token) {
  token = str_(token);
  if (!token) throw new Error('กรุณาวาง Channel access token');
  const old = PROP.getProperty('LINE_TOKEN');
  PROP.setProperty('LINE_TOKEN', token);
  try {
    const b = lineApi_('/v2/bot/info', null, 'get');
    PROP.setProperty('BOT_USER_ID', b.userId);
    return { name: b.displayName };
  } catch (e) {
    if (old) PROP.setProperty('LINE_TOKEN', old); else PROP.deleteProperty('LINE_TOKEN');
    throw new Error('Token ใช้ไม่ได้: ' + e.message);
  }
}

function linkTeacherLine(teacherName, userId) {
  const t = teachers_().filter(function (x) { return x.name === teacherName; })[0];
  if (!t) throw new Error('ไม่พบชื่อครู');
  userId = str_(userId);
  let lineName = '';
  if (userId) {
    const m = rows_(SH.MEMBERS).filter(function (r) { return str_(r[0]) === userId; })[0];
    lineName = m ? str_(m[1]) : '';
  }
  sheet_(SH.TEACHERS).getRange(t.row, 4, 1, 2).setValues([[userId, lineName]]);
  return true;
}

function sendLineTest() {
  const groupId = settings_()[SET.GROUP];
  if (!groupId) throw new Error('ยังไม่ได้เชื่อมกลุ่มไลน์');
  lineApi_('/v2/bot/message/push', { to: groupId, messages: [{ type: 'text', text: '✅ ทดสอบระบบจัดสอนแทน — เชื่อมต่อกลุ่มสำเร็จ\n\n' + HELP_TEXT }] });
  return true;
}

// ───────────────────────── LINE API ─────────────────────────
function lineApi_(path, payload, method) {
  const token = PROP.getProperty('LINE_TOKEN');
  if (!token) throw new Error('ยังไม่ได้ใส่ Channel access token');
  const opt = {
    method: method || 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  };
  if (payload) opt.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch('https://api.line.me' + path, opt);
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 300) {
    let msg = body;
    try { const j = JSON.parse(body); msg = j.message + (j.details ? ' ' + JSON.stringify(j.details) : ''); } catch (e) { /* raw */ }
    if (code === 429) msg = 'โควตาข้อความเดือนนี้หมดแล้ว (หรือส่งถี่เกินไป) — ใช้คำสั่ง "สอนแทน" ในกลุ่มแทนได้ฟรี';
    throw new Error('LINE ' + code + ': ' + msg);
  }
  return body ? JSON.parse(body) : {};
}

// ───────────────────────── POST: หน้าเว็บ + LINE webhook ─────────────────────────
// URL /exec เดียวรับทั้งสองแบบ: LINE ส่ง {destination, events:[..]}, หน้าเว็บส่ง {fn, args}
function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return ok_();
  }
  if (body && body.events) return handleLineWebhook_(body);
  if (body && body.fn) {
    if (!POST_API[body.fn]) return jsonOut_({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + body.fn });
    try {
      return jsonOut_({ ok: true, result: POST_API[body.fn].apply(null, body.args || []) });
    } catch (err) {
      return jsonOut_({ ok: false, error: err.message });
    }
  }
  return ok_();
}

function handleLineWebhook_(body) {
  try {
    const botId = PROP.getProperty('BOT_USER_ID');
    if (botId && body.destination && body.destination !== botId) return ok_();
    (body.events || []).forEach(function (ev) {
      try { handleEvent_(ev); } catch (err) { console.error(err); }
    });
  } catch (err) {
    console.error(err);
  }
  return ok_();
}

function ok_() { return ContentService.createTextOutput('OK'); }

function handleEvent_(ev) {
  const src = ev.source || {};
  if (src.type === 'group' && ev.type === 'join') {
    setSetting_(SET.GROUP, src.groupId);
    reply_(ev.replyToken, [{ type: 'text', text: 'สวัสดีครับ 👋 ตั้งกลุ่มนี้เป็นกลุ่มรับประกาศสอนแทนแล้ว\nให้คุณครูแต่ละท่านพิมพ์ "ลงทะเบียน ชื่อ" เพื่อให้ระบบแท็กชื่อได้\n\n' + HELP_TEXT }]);
    return;
  }
  if (src.type === 'group' && !settings_()[SET.GROUP]) setSetting_(SET.GROUP, src.groupId);
  if (src.userId) upsertMember_(src.groupId || '', src.userId, false);
  if (ev.type === 'memberJoined' && ev.joined) {
    (ev.joined.members || []).forEach(function (m) { if (m.userId) upsertMember_(src.groupId || '', m.userId, false); });
  }
  if (ev.type === 'message' && ev.message && ev.message.type === 'text') handleText_(ev);
}

function reply_(token, messages) {
  if (!token) return;
  lineApi_('/v2/bot/message/reply', { replyToken: token, messages: messages });
}

function upsertMember_(groupId, userId, force) {
  const cache = CacheService.getScriptCache();
  const ck = 'm_' + userId;
  const cached = cache.get(ck);
  if (cached && !force) return cached === '1' ? '' : cached;

  let name = '';
  try {
    const p = groupId
      ? lineApi_('/v2/bot/group/' + groupId + '/member/' + userId, null, 'get')
      : lineApi_('/v2/bot/profile/' + userId, null, 'get');
    name = p.displayName || '';
  } catch (e) { /* ignore */ }

  const sh = sheet_(SH.MEMBERS);
  const vals = rows_(SH.MEMBERS);
  let i = -1;
  for (let k = 0; k < vals.length; k++) if (str_(vals[k][0]) === userId) { i = k; break; }
  if (i >= 0) {
    sh.getRange(i + 2, 1, 1, 4).setValues([[userId, name || vals[i][1], groupId || vals[i][2], nowStr_()]]);
    name = name || str_(vals[i][1]);
  } else {
    sh.appendRow([userId, name, groupId, nowStr_()]);
  }
  cache.put(ck, name || '1', 21600);
  return name;
}

function handleText_(ev) {
  const text = str_(ev.message.text).replace(/\s+/g, ' ');
  const src = ev.source || {};
  const inGroup = src.type === 'group' || src.type === 'room';

  if (/^(คำสั่ง|ช่วยเหลือ|help)$/i.test(text)) {
    reply_(ev.replyToken, [{ type: 'text', text: HELP_TEXT }]);
    return;
  }

  if (/^ตั้งกลุ่มนี้$/.test(text) && src.type === 'group') {
    setSetting_(SET.GROUP, src.groupId);
    reply_(ev.replyToken, [{ type: 'text', text: '✅ ตั้งกลุ่มนี้เป็นกลุ่มรับประกาศสอนแทนแล้ว' }]);
    return;
  }

  let m = text.match(/^ลงทะเบียน ?(.*)$/);
  if (m) {
    registerTeacher_(ev, str_(m[1]), inGroup);
    return;
  }

  m = text.match(/^สอนแทน ?(วันนี้|พรุ่งนี้|มะรืน(?:นี้)?)?$/);
  if (m) {
    const off = !m[1] || m[1] === 'วันนี้' ? 0 : (m[1] === 'พรุ่งนี้' ? 1 : 2);
    const dd = getDateData(todayStr_(off));
    if (!dd.subs.length) {
      reply_(ev.replyToken, [{ type: 'text', text: 'ยังไม่มีการจัดสอนแทนของ' + dd.thaiDate }]);
      return;
    }
    const msgs = [];
    if (dd.image) msgs.push({ type: 'image', originalContentUrl: dd.image.url, previewImageUrl: dd.image.url });
    msgs.push(buildLineMessage_(dd, inGroup).message);
    reply_(ev.replyToken, msgs);
  }
}

function registerTeacher_(ev, arg, inGroup) {
  const src = ev.source || {};
  const key = arg.replace(/^ครู/, '').trim();
  if (!key) {
    reply_(ev.replyToken, [{ type: 'text', text: 'พิมพ์ "ลงทะเบียน" ตามด้วยชื่อ เช่น ลงทะเบียน สมชาย' }]);
    return;
  }
  const hits = teachers_().filter(function (t) {
    return [t.name, t.display].some(function (x) { return x.replace(/^ครู/, '').indexOf(key) >= 0; });
  });
  if (hits.length !== 1) {
    const msg = hits.length
      ? 'พบหลายชื่อ: ' + hits.map(function (t) { return t.name; }).join(', ') + '\nกรุณาพิมพ์ชื่อให้ชัดขึ้น'
      : 'ไม่พบชื่อ "' + key + '" ในรายชื่อครู กรุณาตรวจสอบกับผู้ดูแลระบบ';
    reply_(ev.replyToken, [{ type: 'text', text: msg }]);
    return;
  }
  const t = hits[0];
  const lineName = upsertMember_(src.groupId || '', src.userId, true);
  sheet_(SH.TEACHERS).getRange(t.row, 4, 1, 2).setValues([[src.userId, lineName]]);
  if (inGroup) {
    reply_(ev.replyToken, [{
      type: 'textV2',
      text: '{u} ✅ ลงทะเบียนเป็น ' + t.name.replace(/[{}]/g, function (c) { return c + c; }) + ' เรียบร้อย',
      substitution: { u: { type: 'mention', mentionee: { type: 'user', userId: src.userId } } },
    }]);
  } else {
    reply_(ev.replyToken, [{ type: 'text', text: '✅ ลงทะเบียนเป็น ' + t.name + ' เรียบร้อย' }]);
  }
}
