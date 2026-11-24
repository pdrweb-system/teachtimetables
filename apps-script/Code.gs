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
// เวอร์ชันของโค้ดนี้ — หน้าผู้ดูแลแสดงค่านี้ ใช้ตรวจว่า URL /exec ที่หน้าเว็บเรียกอยู่ ใช้โค้ดที่วางล่าสุดแล้วหรือยัง (เปลี่ยนทุกครั้งที่แก้ Code.gs)
const APP_VERSION = '2026-11-24c';
const PROP = PropertiesService.getScriptProperties();

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

// หน้าครู (index.html) ใช้: saveDay, saveImageToDrive — ไม่ต้องใช้รหัส
// ระบบนี้ไม่ใช้ push เลย: ส่งเข้าไลน์ทางเดียวคือบอท reply คำสั่งในกลุ่ม (ฟรี ไม่นับโควตา)
// หน้าผู้ดูแล (admin.html) ใช้ที่เหลือ — ทุกตัวที่มี pw ต้องส่งรหัสผู้ดูแลเป็นอาร์กิวเมนต์แรก
const POST_API = {
  saveDay: saveDay,
  saveImageToDrive: saveImageToDrive,
  adminStatus: adminStatus,
  setAdminPassword: setAdminPassword,
  verifyAdmin: verifyAdmin,
  getAdminData: getAdminData,
  saveLineToken: saveLineToken,
  setLineGroup: setLineGroup,
  importTimetable: importTimetable,
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  const fn = p.fn;
  if (!fn) return jsonOut_({ ok: true, result: { service: 'ระบบจัดสอนแทน API', version: APP_VERSION, time: nowStr_() } });
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
      [SET.GROUP, '', 'กลุ่มที่บอทตอบคำสั่ง — เลือกในหน้าผู้ดูแล (หลายกลุ่มคั่นด้วยจุลภาค)'],
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
  return {
    school: st[SET.SCHOOL] || '',
    signer: st[SET.SIGNER] || '',
    teachers: teachers_().map(function (t) {
      return { name: t.name, display: t.display, dept: t.dept, active: t.active };
    }),
    periods: periods_(),
    reasons: REASONS,
    today: todayStr_(0),
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

// ───────────────────────── Flex message (คำสั่ง แจ้งตารางสอนแทน) ─────────────────────────
// ไม่แท็กชื่อ (ไม่ผูกครูกับ LINE userId) — การ์ดแสดงชื่อครูผู้สอนแทนเป็นตัวหนังสือ
// ข้อจำกัดของ LINE: bubble ≤ 30 KB, carousel ≤ 12 bubble และ ≤ 50 KB, altText ≤ 1500 ตัวอักษร, text ห้ามเป็นค่าว่าง
const FLEX = {
  ROWS_PER_BUBBLE: 12,
  MAX_BUBBLES: 12,
  MAX_BUBBLE_BYTES: 30000,
  MAX_CAROUSEL_BYTES: 50000,
  C: { pri: '#1f4e8c', pri2: '#2f74c0', head: '#1f3b63', ink: '#1c2533', muted: '#6b778a', ok: '#0b7a3e', err: '#c62828', line: '#e2e8f0' },
};
function utf8Len_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** เวลาตอนสร้างข้อความ แบบเดียวกับท้ายภาพตาราง เช่น "13 พ.ย. 2569 16:14 น." (เวลาไทย, ปี พ.ศ.) */
function stampTh_() {
  const d = new Date();
  const n = function (f) { return Number(Utilities.formatDate(d, TZ, f)); };
  return n('dd') + ' ' + TH_MONTHS_SHORT[n('MM') - 1] + ' ' + (n('yyyy') + 543) + ' ' + Utilities.formatDate(d, TZ, 'HH:mm') + ' น.';
}

/** ตารางสอนแทนของวันเป็น Flex message (bubble เดียว หรือ carousel เมื่อคาบเยอะ) */
function buildFlexMessage_(dd) {
  const C = FLEX.C;
  const st = settings_();
  const tmap = {};
  teachers_().forEach(function (t) { tmap[t.name] = t; });
  const pmap = {};
  periods_().forEach(function (p) { pmap[p.p] = p; });
  const disp = function (n) { return (tmap[n] && tmap[n].display) || n; };
  const txt = function (text, opt) { return Object.assign({ type: 'text', text: String(text), wrap: true }, opt || {}); };
  // ครูที่ไม่อยู่ (เรียงตามที่บันทึก) + ป้ายชื่อพร้อมเหตุผล
  const absents = [];
  const absentLabel = {};
  const absentOrder = {};
  dd.subs.forEach(function (s) {
    if (absentLabel[s.absent]) return;
    absentLabel[s.absent] = disp(s.absent) + (s.reason ? ' (' + s.reason + ')' : '');
    absentOrder[s.absent] = absents.length;
    absents.push(absentLabel[s.absent] + (s.note ? ' — ' + s.note : ''));
  });
  // ไม่อยู่หลายคน → จัดกลุ่มตามครูที่ไม่อยู่ (มีแถวหัวกลุ่มเป็นชื่อครู) แล้วเรียงตามคาบ; คนเดียว → เรียงตามคาบ
  const multi = absents.length > 1;
  const slots = dd.subs.filter(function (s) { return s.period || s.subject; })
    .sort(function (a, b) {
      return (multi ? absentOrder[a.absent] - absentOrder[b.absent] : 0) || ((a.period || 99) - (b.period || 99));
    });

  // ตาราง 5 คอลัมน์: คาบ | เวลา | ห้อง | วิชา | ครูสอนแทน — ทุกช่องต้องอยู่บรรทัดเดียวในการ์ดกว้าง 300px (ผู้ใช้สั่ง 2026-11-15)
  // จึงไม่มีคอลัมน์ "ครูที่ไม่อยู่" (6 คอลัมน์ไม่พอที่ ข้อความถูกตัดเป็นสองบรรทัด): ชื่อครูที่ไม่อยู่อยู่บรรทัดเหนือตาราง และแถวหัวกลุ่ม
  // สัดส่วนคอลัมน์วัดจากภาพหน้าจอไลน์จริง (xxs): "08:30–09:30" ≈ 66px, "ภาษาอังกฤษ" ≈ 58px, "ครูเบญจรงค์" ≈ 62px
  const COLS = [
    { t: 'คาบ', flex: 14, align: 'center', get: function (s) { return String(s.period || '-'); } },
    { t: 'เวลา', flex: 39, align: 'center', get: function (s) { const p = pmap[s.period]; return p ? p.start + '–' + p.end : '-'; } },
    { t: 'ห้อง', flex: 16, align: 'center', get: function (s) { return s.room || '-'; } },
    { t: 'วิชา', flex: 34, headAlign: 'center', get: function (s) { return s.subject || '-'; } },
    { t: 'ครูสอนแทน', flex: 37, sub: true, get: function (s) { return s.sub ? disp(s.sub) : 'ยังไม่มี'; } },
  ];
  // เส้นตารางทุกช่อง: แต่ละช่องเป็นกล่องของตัวเอง (padding อยู่ในช่อง) คั่นด้วย separator แนวตั้งที่สูงเต็มแถว
  // และมี separator แนวนอนคั่นทุกแถว (ผู้ใช้สั่ง 2026-11-15 หลังดูการ์ดในไลน์จริง)
  const GRID = '#c3cedd';
  const cells = function (fn) {
    const out = [];
    COLS.forEach(function (c, i) {
      if (i) out.push({ type: 'separator', color: GRID });
      out.push({ type: 'box', layout: 'vertical', flex: c.flex, paddingAll: '3px', justifyContent: 'center', contents: [fn(c)] });
    });
    return out;
  };
  const headRow = {
    type: 'box', layout: 'horizontal', backgroundColor: '#e8eef7',
    // ไม่ใช้ wrap:false: ถ้าข้อความยาวเกินช่องจริง ๆ ให้ขึ้นบรรทัดใหม่ ดีกว่าถูก LINE ตัดเป็น "…"
    contents: cells(function (c) { return txt(c.t, { size: 'xxs', weight: 'bold', color: C.head, align: c.headAlign || c.align || 'start' }); }),
  };
  const row = function (s, i) {
    return {
      type: 'box', layout: 'horizontal',
      backgroundColor: s.sub ? (i % 2 ? '#f7f9fc' : '#ffffff') : '#fdecec',
      contents: cells(function (c) {
        const o = { size: 'xxs', align: c.align || 'start', color: C.ink };
        if (c.sub) { o.weight = 'bold'; o.color = s.sub ? C.ok : C.err; }
        return txt(c.get(s), o);
      }),
    };
  };
  const groupRow = function (name) { // แถวหัวกลุ่ม: ชื่อครูที่ไม่อยู่ (เฉพาะเมื่อไม่อยู่หลายคน)
    return {
      type: 'box', layout: 'vertical', backgroundColor: '#f1f4f9', paddingAll: '3px', paddingStart: '6px',
      contents: [txt('แทน' + absentLabel[name], { size: 'xxs', weight: 'bold', color: C.head })],
    };
  };
  const grid = function (rows) { // หัวตาราง + แถว โดยมีเส้นคั่นทุกแถว
    const out = [headRow];
    let cur = null, k = 0;
    rows.forEach(function (s) {
      if (multi && s.absent !== cur) { cur = s.absent; k = 0; out.push({ type: 'separator', color: GRID }); out.push(groupRow(cur)); }
      out.push({ type: 'separator', color: GRID });
      out.push(row(s, k++));
    });
    return out;
  };

  const bubble = function (rows, part, total, first, last, hidden) {
    const header = {
      type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '12px',
      background: { type: 'linearGradient', angle: '90deg', startColor: C.pri, endColor: C.pri2 },
      contents: [
        st[SET.SCHOOL] ? txt(st[SET.SCHOOL], { size: 'sm', weight: 'bold', color: '#ffffff' }) : null,
        {
          type: 'box', layout: 'horizontal', alignItems: 'center',
          contents: [
            txt('ตารางสอนแทน' + (total > 1 ? ' (' + part + '/' + total + ')' : ''), { size: 'xl', weight: 'bold', color: '#ffffff', flex: 1 }),
            {
              type: 'box', layout: 'vertical', flex: 0, cornerRadius: '14px', backgroundColor: '#ffffff33',
              paddingStart: '10px', paddingEnd: '10px', paddingTop: '2px', paddingBottom: '2px',
              contents: [txt(slots.length + ' คาบ', { size: 'sm', weight: 'bold', color: '#ffffff', wrap: false })],
            },
          ],
        },
        txt(dd.thaiDate, { size: 'md', color: '#ffffff' }),
      ].filter(Boolean),
    };

    const body = [];
    if (first) body.push(txt('ครูที่ไม่อยู่: ' + absents.join(', '), { size: 'sm', color: '#334155' }));
    if (first && !slots.length) body.push(txt('(ไม่มีคาบที่ต้องสอนแทน)', { size: 'sm', color: C.muted }));
    if (rows.length) {
      body.push({
        type: 'box', layout: 'vertical', spacing: 'none', margin: first ? 'md' : 'none', cornerRadius: '8px',
        borderWidth: 'light', borderColor: GRID,
        contents: grid(rows),
      });
    }
    if (last && hidden) body.push(txt('…และอีก ' + hidden + ' คาบ (ดูครบในภาพตาราง)', { size: 'sm', color: C.err }));

    const b = {
      // ขนาด mega (กว้าง 300px) — giga (500px) กว้างเกินจอมือถือ: ในไลน์จริงคอลัมน์ขวาสุดตกขอบจอ (ภาพจากผู้ใช้ 2026-11-15)
      // ตัวหนังสือในตารางจึงใช้ xxs ทั้งหมด และสัดส่วนคอลัมน์ 4:6:5:8:8:8 ให้ 6 คอลัมน์พอดี 300px
      type: 'bubble', size: 'mega', header: header,
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '8px', contents: body },
    };
    if (last) {
      const foot = [];
      if (dd.image) foot.push({ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '🖼️ ดูภาพตาราง', uri: dd.image.viewUrl } });
      const meta = [];
      if (st[SET.SIGNER]) meta.push(txt('ผู้จัด: ' + st[SET.SIGNER], { size: 'sm', weight: 'bold', color: '#334155', flex: 1, gravity: 'center' }));
      meta.push(txt('จัดทำเมื่อ ' + stampTh_(), { size: 'xxs', color: C.muted, flex: 1, align: 'end', gravity: 'center' }));
      foot.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: meta });
      if (st[SET.FOOTER]) foot.push(txt(st[SET.FOOTER], { size: 'xs', color: C.muted }));
      b.footer = { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: foot };
      b.styles = { footer: { separator: true } };
    }
    return b;
  };

  // แบ่งหน้าละ ROWS_PER_BUBBLE คาบ; ถ้าเกินขนาด/จำนวนที่ LINE รับได้ ให้ตัดคาบท้าย ๆ แล้วบอกว่ามีอีกกี่คาบ
  const build = function (n) {
    const pages = [];
    for (let i = 0; i < n; i += FLEX.ROWS_PER_BUBBLE) pages.push(slots.slice(i, Math.min(i + FLEX.ROWS_PER_BUBBLE, n)));
    if (!pages.length) pages.push([]);
    const bubbles = pages.map(function (rows, i) {
      return bubble(rows, i + 1, pages.length, i === 0, i === pages.length - 1, slots.length - n);
    });
    return bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles };
  };
  const fits = function (c) {
    const parts = c.type === 'carousel' ? c.contents : [c];
    return parts.every(function (b) { return utf8Len_(JSON.stringify(b)) <= FLEX.MAX_BUBBLE_BYTES; }) &&
      (c.type !== 'carousel' || utf8Len_(JSON.stringify(c)) <= FLEX.MAX_CAROUSEL_BYTES);
  };
  let n = Math.min(slots.length, FLEX.ROWS_PER_BUBBLE * FLEX.MAX_BUBBLES);
  let contents = build(n);
  while (n > 0 && !fits(contents)) contents = build(--n);

  const subs = [];
  slots.forEach(function (s) { if (s.sub && subs.indexOf(disp(s.sub)) < 0) subs.push(disp(s.sub)); });
  const alt = '📋 ตารางสอนแทน ' + dd.thaiDate + ' — ' + slots.length + ' คาบ' + (subs.length ? ' · ผู้สอนแทน: ' + subs.join(', ') : '');
  return { type: 'flex', altText: alt.length > 1500 ? alt.slice(0, 1499) + '…' : alt, contents: contents };
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

// ───────────────────────── รหัสผู้ดูแล (หน้าตั้งค่า) ─────────────────────────
// เก็บเป็น SHA-256(salt:รหัส) ใน Script Properties (ADMIN_SALT / ADMIN_HASH) — ไม่เก็บรหัสจริง ไม่อยู่ในชีต
// ใส่ผิดครบ ADMIN_MAX_FAILS ครั้ง ล็อก ADMIN_LOCK_SEC วินาที (นับรวมทุกคน เพราะแยกผู้ใช้ไม่ได้)
const ADMIN_MAX_FAILS = 5;
const ADMIN_LOCK_SEC = 900;
const ADMIN_MIN_LEN = 6;

function adminHash_(salt, pw) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function adminGuard_(pw) {
  const stored = PROP.getProperty('ADMIN_HASH');
  if (!stored) throw new Error('ยังไม่ได้ตั้งรหัสผู้ดูแล');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails')) || 0;
  if (fails >= ADMIN_MAX_FAILS) throw new Error('ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ ' + Math.round(ADMIN_LOCK_SEC / 60) + ' นาทีแล้วลองใหม่');
  if (adminHash_(PROP.getProperty('ADMIN_SALT') || '', str_(pw)) !== stored) {
    cache.put('admin_fails', String(fails + 1), ADMIN_LOCK_SEC);
    throw new Error('รหัสผู้ดูแลไม่ถูกต้อง');
  }
  if (fails) cache.remove('admin_fails');
}

/** หน้าผู้ดูแลเรียกก่อนแสดงฟอร์ม: ตั้งรหัสแล้วหรือยัง */
function adminStatus() { return { hasPassword: !!PROP.getProperty('ADMIN_HASH') }; }

/** ตั้งรหัสครั้งแรก (ยังไม่มีรหัส) หรือเปลี่ยนรหัส (ต้องส่งรหัสเดิม) */
function setAdminPassword(newPw, oldPw) {
  newPw = str_(newPw);
  if (newPw.length < ADMIN_MIN_LEN) throw new Error('รหัสผู้ดูแลต้องยาวอย่างน้อย ' + ADMIN_MIN_LEN + ' ตัวอักษร');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (PROP.getProperty('ADMIN_HASH')) adminGuard_(oldPw);
    const salt = Utilities.getUuid();
    PROP.setProperty('ADMIN_SALT', salt);
    PROP.setProperty('ADMIN_HASH', adminHash_(salt, newPw));
  } finally {
    lock.releaseLock();
  }
  return true;
}

function verifyAdmin(pw) { adminGuard_(pw); return true; }

// ───────────────────────── ตั้งค่า LINE (ผู้ดูแลเท่านั้น) ─────────────────────────
function getAdminData(pw) {
  adminGuard_(pw);
  const st = settings_();
  const hasToken = !!PROP.getProperty('LINE_TOKEN');
  let bot = null;
  if (hasToken) {
    try {
      const b = lineApi_('/v2/bot/info', null, 'get');
      bot = { name: b.displayName, basicId: b.basicId };
    } catch (e) { bot = { error: e.message }; }
  }
  let webAppUrl = '';
  try { webAppUrl = ScriptApp.getService().getUrl(); } catch (e) { /* ignore */ }
  return {
    sheetUrl: ss_().getUrl(),
    webAppUrl: webAppUrl,
    hasToken: hasToken,
    bot: bot,
    groupIds: selectedGroups_(),
    groupId: selectedGroups_()[0] || '', // เดิมเลือกได้กลุ่มเดียว — คงไว้ให้โค้ดเก่าอ่านได้
    groups: knownGroups_(hasToken),
    lastEvent: PROP.getProperty('LAST_EVENT') || '',
    lastMismatch: PROP.getProperty('LAST_MISMATCH') || '',
    lastCommand: PROP.getProperty('LAST_COMMAND') || '',
    version: APP_VERSION,
  };
}

/** กลุ่มที่บอทเคยเห็น event (จาก GROUPS_SEEN) พร้อมชื่อกลุ่มจาก LINE — ให้ผู้ดูแลเลือกกลุ่มรับประกาศ */
function knownGroups_(withNames) {
  const seen = groupsSeen_();
  selectedGroups_().forEach(function (g) { if (!(g in seen)) seen[g] = ''; });
  return Object.keys(seen).sort(function (a, b) { return seen[b] < seen[a] ? -1 : (seen[b] > seen[a] ? 1 : 0); }).map(function (g) {
    let name = '';
    if (withNames) {
      try { name = lineApi_('/v2/bot/group/' + g + '/summary', null, 'get').groupName || ''; } catch (e) { /* ไม่ทราบชื่อ */ }
    }
    return { groupId: g, name: name, lastSeen: seen[g] };
  });
}

/** กลุ่มที่ให้บอทตอบคำสั่ง — เลือกได้หลายกลุ่ม (เช่น กลุ่มครู + กลุ่มทดสอบ; ผู้ใช้สั่ง 2026-11-24) เก็บในชีตตั้งค่าคั่นด้วยจุลภาค */
function selectedGroups_() {
  return str_(settings_()[SET.GROUP]).split(/[\s,]+/).filter(Boolean);
}

/** เลือกกลุ่มที่ให้บอทตอบ: groupIds = array (หรือข้อความ groupId เดียว แบบเดิม); ว่าง = ล้างการเลือก */
function setLineGroup(pw, groupIds) {
  adminGuard_(pw);
  const list = (Array.isArray(groupIds) ? groupIds : str_(groupIds).split(/[\s,]+/))
    .map(str_).filter(function (g, i, a) { return g && a.indexOf(g) === i; });
  const known = knownGroups_(false).map(function (g) { return g.groupId; });
  list.forEach(function (g) {
    if (known.indexOf(g) < 0) throw new Error('ยังไม่เคยเห็นกลุ่มนี้ — ให้ใครสักคนพิมพ์อะไรก็ได้ในกลุ่มก่อน แล้วกดรีเฟรช');
  });
  setSetting_(SET.GROUP, list.join(','));
  return true;
}

function saveLineToken(pw, token) {
  adminGuard_(pw);
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

// ───────────────────────── นำเข้าตารางสอน (ผู้ดูแลเท่านั้น) ─────────────────────────
/**
 * นำเข้าตารางสอนที่อ่านจาก PDF (หน้า admin อ่านไฟล์ในเบราว์เซอร์ แล้วส่งแถวที่ผู้ดูแลตรวจแล้วมาที่นี่)
 * payload: { rows:[{teacher,day,period,subject,room}], mode:'replace'|'append',
 *            addTeachers:[{name,display,dept}] (ครูใหม่ที่จะเพิ่มลงชีต "ครู"),
 *            periods:[{p,start,end}] | null (ถ้าส่งมา = แทนที่ชีต "คาบเรียน"),
 *            deactivateOthers:boolean (เฉพาะ replace: ปิดใช้งานครูที่ไม่อยู่ในตารางใหม่) }
 * replace จะสำรองตารางเดิมไว้ในชีต "สำรองตารางสอน" ก่อน (เก็บแค่ครั้งล่าสุด)
 */
function importTimetable(pw, payload) {
  adminGuard_(pw);
  payload = payload || {};
  const rows = payload.rows || [];
  if (!rows.length) throw new Error('ไม่มีข้อมูลตารางสอนให้นำเข้า');
  if (rows.length > 3000) throw new Error('ข้อมูลมากเกินไป (เกิน 3,000 แถว)');
  const mode = payload.mode === 'append' ? 'append' : 'replace';

  const have = {};
  teachers_().forEach(function (t) { have[t.name] = true; });
  const toAdd = [];
  (payload.addTeachers || []).forEach(function (t) {
    const name = str_(t.name);
    if (!name || have[name]) return;
    if (name.length > 100) throw new Error('ชื่อครูยาวเกินไป: ' + name);
    have[name] = true;
    toAdd.push([name, str_(t.display) || name, str_(t.dept).slice(0, 100), '', '', true]);
  });

  const seen = {};
  const used = {};
  const clean = rows.map(function (r, i) {
    const teacher = str_(r.teacher);
    if (!have[teacher]) throw new Error('แถวที่ ' + (i + 1) + ': ไม่พบครู "' + teacher + '" ในชีต (ต้องเพิ่มครูใหม่ด้วย)');
    const day = normDay_(r.day);
    if (DAYS.indexOf(day) < 0) throw new Error('แถวที่ ' + (i + 1) + ': วันไม่ถูกต้อง "' + str_(r.day) + '"');
    const period = Number(r.period);
    if (!(period >= 1 && period <= 20 && period % 1 === 0)) throw new Error('แถวที่ ' + (i + 1) + ': คาบไม่ถูกต้อง "' + str_(r.period) + '"');
    const k = teacher + '|' + day + '|' + period;
    if (seen[k]) throw new Error(teacher + ' มีสองรายการในวัน' + day + ' คาบ ' + period);
    seen[k] = true;
    used[teacher] = true;
    return [teacher, day, period, str_(r.subject).slice(0, 100), str_(r.room).slice(0, 50)];
  });

  let periodRows = null;
  if (payload.periods && payload.periods.length) {
    const ps = {};
    periodRows = payload.periods.map(function (x) {
      const p = Number(x.p);
      const st = str_(x.start).replace('.', ':'), en = str_(x.end).replace('.', ':');
      if (!(p >= 1 && p <= 20 && p % 1 === 0) || ps[p]) throw new Error('เลขคาบในรายการเวลาไม่ถูกต้อง/ซ้ำ');
      if (!/^\d{1,2}:\d{2}$/.test(st) || !/^\d{1,2}:\d{2}$/.test(en)) throw new Error('รูปแบบเวลาไม่ถูกต้อง (คาบ ' + p + ')');
      ps[p] = true;
      const pad = function (v) { return v.length < 5 ? '0' + v : v; };
      return [p, pad(st), pad(en)];
    }).sort(function (a, b) { return a[0] - b[0]; });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let deactivated = 0;
  try {
    const tt = sheet_(SH.TIMETABLE);
    const n = tt.getLastRow();
    if (mode === 'replace') {
      // สำรองของเดิมก่อนทับ
      const ss = ss_();
      let bk = ss.getSheetByName('สำรองตารางสอน');
      if (!bk) bk = ss.insertSheet('สำรองตารางสอน');
      const bn = bk.getLastRow();
      if (bn > 0) bk.getRange(1, 1, bn, 7).clearContent();
      bk.getRange(1, 1, 1, 7).setValues([HEADERS[SH.TIMETABLE].concat(['', 'สำรองเมื่อ'])]);
      bk.getRange(2, 7, 1, 1).setValues([[nowStr_()]]);
      if (n > 1) bk.getRange(2, 1, n - 1, 5).setValues(tt.getRange(2, 1, n - 1, 5).getValues());
      if (n > 1) tt.getRange(2, 1, n - 1, 5).clearContent();
    }
    if (toAdd.length) {
      const ts = sheet_(SH.TEACHERS);
      ts.getRange(ts.getLastRow() + 1, 1, toAdd.length, 6).setValues(toAdd);
    }
    const start = mode === 'replace' ? 2 : Math.max(tt.getLastRow(), 1) + 1;
    tt.getRange(start, 1, clean.length, 5).setValues(clean);
    if (mode === 'replace' && payload.deactivateOthers) {
      teachers_().forEach(function (t) {
        if (!used[t.name] && t.active) { sheet_(SH.TEACHERS).getRange(t.row, 6).setValue(false); deactivated++; }
      });
    }
    if (periodRows) {
      const pr = sheet_(SH.PERIODS);
      const pn = pr.getLastRow();
      if (pn > 1) pr.getRange(2, 1, pn - 1, 3).clearContent();
      pr.getRange(2, 1, periodRows.length, 3).setValues(periodRows);
    }
  } finally {
    lock.releaseLock();
  }
  return { rows: clean.length, teachersAdded: toAdd.length, deactivated: deactivated, periods: periodRows ? periodRows.length : 0, mode: mode };
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
    if (code === 429) msg = 'LINE จำกัดอัตราการเรียกใช้ชั่วคราว (ส่งถี่เกินไป) กรุณารอสักครู่แล้วลองใหม่';
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
    if (botId && body.destination && body.destination !== botId) {
      noteDiag_('LAST_MISMATCH', 'destination ' + body.destination + ' ไม่ตรงกับบอทที่ใส่ Token ไว้');
      return ok_();
    }
    const first = (body.events || [])[0];
    if (first) noteDiag_('LAST_EVENT', (first.type || '?') + ' / ' + ((first.source || {}).type || '?'));
    (body.events || []).forEach(function (ev) {
      try { handleEvent_(ev); } catch (err) { console.error(err); }
    });
  } catch (err) {
    console.error(err);
  }
  return ok_();
}

function ok_() { return ContentService.createTextOutput('OK'); }

// บอทตัวเดียวอาจถูกใช้ร่วมกับระบบอื่น (ระบบเดิมส่งต่อ webhook มา) → event จากกลุ่มอื่นก็มาถึงที่นี่ด้วย
// - ทุกกลุ่มที่เห็น event จะถูกจดไว้ (GROUPS_SEEN) ให้ผู้ดูแลเลือกกลุ่มรับประกาศในหน้า admin
//   (จดจาก groupId ของ event เอง ไม่พึ่ง userId เพราะ LINE ไม่ส่ง userId ของคนที่ยังไม่ยินยอม)
// - ยังไม่ได้เลือกกลุ่ม: ไม่ตอบอะไรในกลุ่ม
// - เลือกกลุ่มแล้ว (setLineGroup): ตอบเฉพาะกลุ่มนั้น กลุ่ม/ห้องอื่นถูกเมิน
// - แชต 1:1 กับบอทตอบคำสั่งได้เสมอ
// คำสั่งเดียวที่บอทตอบ: "แจ้งตารางสอนแทน" (ดู handleText_) — ไม่ทักทาย ไม่ตอบ join ฯลฯ
function handleEvent_(ev) {
  const src = ev.source || {};
  const cmd = commandOf_(ev);
  if (src.type === 'room') { if (cmd) noteCommand_(cmd, 'ไม่ตอบ: พิมพ์ในห้องแชต (room) — ใช้ในกลุ่มหรือแชต 1:1 แทน'); return; }
  if (src.type === 'group' && src.groupId) noteGroup_(src.groupId);
  const groups = selectedGroups_();
  if (src.type === 'group' && !groups.length) { if (cmd) noteCommand_(cmd, 'ไม่ตอบ: ยังไม่ได้เลือก "กลุ่มไลน์ที่ให้บอทตอบ" ในหน้าผู้ดูแล'); return; }
  if (src.type === 'group' && groups.indexOf(src.groupId) < 0) { if (cmd) noteCommand_(cmd, 'ไม่ตอบ: พิมพ์ในกลุ่มที่ไม่ได้เลือกไว้ในหน้าผู้ดูแล'); return; }
  if (!cmd) return;
  try {
    handleText_(ev);
    noteCommand_(cmd, 'ตอบแล้ว');
  } catch (err) {
    noteCommand_(cmd, 'ตอบไม่สำเร็จ: ' + err.message);
    throw err;
  }
}

// ข้อความนี้เป็นคำสั่งของบอทหรือไม่ (คืนคำสั่งแบบไม่มีเว้นวรรค หรือ '' ถ้าไม่ใช่)
function commandOf_(ev) {
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return '';
  const text = str_(ev.message.text).replace(/\s+/g, '');
  return Object.prototype.hasOwnProperty.call(LINE_COMMANDS, text) ? text : '';
}

// ผลของคำสั่งล่าสุด (ตอบแล้ว / ไม่ตอบเพราะอะไร / error จาก LINE) ให้หน้าผู้ดูแลแสดง — คำสั่งมีไม่บ่อย จึงเขียนทุกครั้ง
function noteCommand_(cmd, result) {
  try { PROP.setProperty('LAST_COMMAND', nowStr_() + ' — "' + cmd + '" → ' + result); } catch (e) { /* ไม่ให้การบันทึกทำให้ตอบไม่ได้ */ }
}

// กลุ่มที่เคยเห็น event: { groupId: 'yyyy-MM-dd HH:mm:ss' (ล่าสุด) } เก็บใน Script Properties (เก็บไม่เกิน 20 กลุ่ม)
function groupsSeen_() {
  try { return JSON.parse(PROP.getProperty('GROUPS_SEEN') || '{}') || {}; } catch (e) { return {}; }
}
function noteGroup_(groupId) {
  const cache = CacheService.getScriptCache();
  if (cache.get('gs_' + groupId)) return; // จดแล้วในช่วงนี้ ไม่ต้องเขียนซ้ำทุกข้อความ
  const all = groupsSeen_();
  all[groupId] = nowStr_();
  const ids = Object.keys(all).sort(function (a, b) { return all[b] < all[a] ? -1 : 1; }).slice(0, 20);
  const keep = {};
  ids.forEach(function (g) { keep[g] = all[g]; });
  PROP.setProperty('GROUPS_SEEN', JSON.stringify(keep));
  cache.put('gs_' + groupId, '1', 3600);
}

// บันทึกเหตุการณ์ล่าสุดไว้ให้หน้า admin ใช้ตรวจว่า LINE/ระบบเดิมส่ง event มาถึงหรือไม่ (เขียนไม่เกินนาทีละครั้ง)
function noteDiag_(key, text) {
  const cache = CacheService.getScriptCache();
  if (cache.get('dg_' + key)) return;
  PROP.setProperty(key, nowStr_() + ' — ' + text);
  cache.put('dg_' + key, '1', 60);
}

function reply_(token, messages) {
  if (!token) return;
  lineApi_('/v2/bot/message/reply', { replyToken: token, messages: messages });
}

/** คำสั่งที่บอทตอบ → วันที่นับจากวันนี้ (ต้องตรงกับ LINE_CMD ใน index.html); ข้อความอื่นไม่ตอบ */
const LINE_COMMANDS = { 'แจ้งตารางสอนแทน': 0, 'แจ้งตารางสอนแทนพรุ่งนี้': 1 };

/** "แจ้งตารางสอนแทน" (วันนี้) / "แจ้งตารางสอนแทนพรุ่งนี้" → reply เป็นการ์ด Flex; เว้นวรรคในคำสั่งไม่มีผล */
function handleText_(ev) {
  const text = str_(ev.message.text).replace(/\s+/g, '');
  if (!Object.prototype.hasOwnProperty.call(LINE_COMMANDS, text)) return;

  const dd = getDateData(todayStr_(LINE_COMMANDS[text]));
  if (!dd.subs.length) {
    reply_(ev.replyToken, [{ type: 'text', text: 'ยังไม่มีการจัดสอนแทนของ' + dd.thaiDate }]);
    return;
  }
  try {
    reply_(ev.replyToken, [buildFlexMessage_(dd)]);
  } catch (err) {
    // Flex ถูก LINE ปฏิเสธ (เช่น ข้อมูลยาวผิดปกติ) → ตอบเป็นข้อความธรรมดาแทน (reply token ยังใช้ได้เมื่อคำขอแรกล้ม)
    console.error('Flex reply failed: ' + err.message);
    reply_(ev.replyToken, [buildLineMessage_(dd, false).message]);
  }
}
