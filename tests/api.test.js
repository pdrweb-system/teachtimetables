// ทดสอบ apps-script/Code.gs ผ่าน doGet/doPost แบบเดียวกับที่ index.html เรียก
// รัน: node tests/api.test.js
require('./gasmock.js');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), { filename: 'Code.gs' });

const get = (fn, args) => JSON.parse(doGet({ parameter: { fn, args: JSON.stringify(args || []) } }).getContent());
const post = (fn, args) => JSON.parse(doPost({ postData: { contents: JSON.stringify({ fn, args: args || [] }) } }).getContent());
const line = (events) => doPost({ postData: { contents: JSON.stringify({ destination: 'UBOT', events }) } });
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

setup();
let pushes = 0;
const realFetch = UrlFetchApp.fetch;
UrlFetchApp.fetch = (u, o) => { if (/message\/(push|multicast|broadcast|narrowcast)/.test(u)) pushes++; return realFetch(u, o); };

// GET
const init = get('getInitData');
ok(init.ok && init.result.teachers.length === 6 && init.result.periods.length === 7, 'getInitData');
ok(get('saveDay', ['2026-09-28', []]).ok === false, 'saveDay must not be callable via GET');
ok(get('nope').error.indexOf('ไม่รู้จัก') >= 0, 'unknown GET fn');

const date = '2026-09-28'; // วันจันทร์
const dd = get('getDateData', [date]).result;
ok(dd.weekday === 'จันทร์' && dd.timetable.length > 0, 'getDateData');

// สร้างรายการสอนแทนให้ครูสมชาย โดยเลือกครูที่ว่างในคาบนั้น
const absent = 'ครูสมชาย ใจดี';
const busy = p => dd.timetable.filter(x => x.period === p).map(x => x.teacher);
const rows = dd.timetable.filter(x => x.teacher === absent).map(s => ({
  absent, reason: 'ลาป่วย', note: '', period: s.period, subject: s.subject, room: s.room,
  sub: init.result.teachers.map(t => t.name).find(n => n !== absent && busy(s.period).indexOf(n) < 0) || '',
}));

// POST
ok(post('verifyPin', ['1234']).ok === false, 'PIN removed: verifyPin no longer exists');
ok(!('sheetUrl' in init.result) && !('webAppUrl' in init.result), 'getInitData does not expose sheet/web app URL');
const saved = post('saveDay', [date, rows]);
ok(saved.ok && saved.result.subs.length === rows.length, 'saveDay');
post('saveDay', [date, rows]);
ok(rows_('บันทึกสอนแทน').filter(r => r[2]).length === rows.length, 'resave replaces the day, no duplicates');
ok(post('saveDay', [date, [{ absent, sub: absent, period: 1 }]]).ok === false, 'self-substitution rejected');
ok(post('sendToLine', [date, null]).ok === false && post('sendLineTest', ['x']).ok === false, 'push removed: sendToLine / sendLineTest no longer exist');

// รหัสผู้ดูแล
const PW = 'secret1';
ok(post('adminStatus').result.hasPassword === false, 'no admin password yet');
ok(post('getAdminData', [PW]).ok === false, 'admin API refused before a password is set');
ok(post('setAdminPassword', ['abc']).ok === false, 'too-short admin password rejected');
ok(post('setAdminPassword', [PW]).result === true, 'first-time admin password set');
ok(post('adminStatus').result.hasPassword === true, 'adminStatus now true');
ok(!JSON.stringify(__props).includes(PW), 'plain admin password is not stored');
ok(post('setAdminPassword', ['hacker1']).ok === false, 'cannot overwrite password without the old one');
ok(post('verifyAdmin', ['wrong']).error.indexOf('ไม่ถูกต้อง') >= 0, 'wrong admin password rejected');
ok(post('verifyAdmin', [PW]).result === true, 'verifyAdmin');
ok(post('saveLineToken', ['wrong', 'tok']).ok === false && !__props.LINE_TOKEN, 'saveLineToken needs the admin password');
ok(post('linkTeacherLine', ['wrong', 'ครูสมชาย ใจดี', 'U9']).ok === false, 'linkTeacherLine needs the admin password');
ok(get('getAdminData', [PW]).ok === false, 'admin API not reachable via GET');
ok(post('setAdminPassword', ['newsecret2', PW]).result === true && post('verifyAdmin', ['newsecret2']).ok, 'change admin password with old one');
ok(post('verifyAdmin', [PW]).ok === false, 'old password no longer works');
for (let i = 0; i < 5; i++) post('verifyAdmin', ['x' + i]);
const locked = post('verifyAdmin', ['newsecret2']);
ok(locked.ok === false && locked.error.indexOf('หลายครั้ง') >= 0, 'locked after repeated wrong passwords (even the right one)');
CacheService.getScriptCache().remove('admin_fails');
const AP = 'newsecret2';
ok(post('verifyAdmin', [AP]).ok, 'unlocked after the lock expires');

// LINE
ok(post('saveLineToken', [AP, 'tok']).result.name === 'บอทสอนแทน', 'saveLineToken');
line([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'G1' } }]);
ok(settings_()['LINE groupId'] === 'G1', 'join event sets group');
// บอทใช้ร่วมกับระบบอื่น: กลุ่มอื่นต้องไม่ถูกตั้งเป็นกลุ่มประกาศ/ไม่ได้คำตอบ/ไม่ถูกเก็บสมาชิก
__lineCalls.length = 0;
line([{ type: 'message', replyToken: 'rx', source: { type: 'group', groupId: 'GOTHER', userId: 'UX' }, message: { type: 'text', text: 'คำสั่ง' } }]);
ok(!__lineCalls.some(c => c.path === '/v2/bot/message/reply') && settings_()['LINE groupId'] === 'G1', 'other group: ignored (no reply, group unchanged)');
ok(!rows_('สมาชิกไลน์').some(r => r[0] === 'UX'), 'other group: member not stored');
line([{ type: 'join', replyToken: 'rj', source: { type: 'group', groupId: 'GOTHER' } }]);
ok(settings_()['LINE groupId'] === 'G1', 'join of another group does not replace the configured group');
line([{ type: 'message', replyToken: 'rs', source: { type: 'group', groupId: 'GNEW', userId: 'UY' }, message: { type: 'text', text: 'ตั้งกลุ่มนี้' } }]);
ok(settings_()['LINE groupId'] === 'GNEW', 'ตั้งกลุ่มนี้ works from any group');
line([{ type: 'message', replyToken: 'rs2', source: { type: 'group', groupId: 'G1', userId: 'UY' }, message: { type: 'text', text: 'ตั้งกลุ่มนี้' } }]);
ok(settings_()['LINE groupId'] === 'G1', 'ตั้งกลุ่มนี้ switches back');
__lineCalls.length = 0;
line([{ type: 'message', replyToken: 'ru', source: { type: 'user', userId: 'U2' }, message: { type: 'text', text: 'คำสั่ง' } }]);
ok(__lineCalls.some(c => c.path === '/v2/bot/message/reply'), '1:1 chat still gets replies');
const firstSub = rows.find(r => r.sub).sub;
line([{ type: 'message', replyToken: 'r2', source: { type: 'group', groupId: 'G1', userId: 'U111' },
  message: { type: 'text', text: 'ลงทะเบียน ' + firstSub.replace(/^ครู/, '').split(' ')[0] } }]);
ok(teachers_().find(t => t.name === firstSub).userId === 'U111', 'ลงทะเบียน links userId');

post('saveImageToDrive', [date, 'data:image/jpeg;base64,AAAA']);
globalThis.todayStr_ = () => date; // ให้ "วันนี้" ของคำสั่งในกลุ่ม = วันที่ทดสอบ
__lineCalls.length = 0;
line([{ type: 'message', replyToken: 'r5', source: { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text: 'สอนแทน' } }]);
const rep = __lineCalls.find(c => c.path === '/v2/bot/message/reply').payload;
ok(rep.messages[0].type === 'image' && rep.messages[1].type === 'textV2', 'สอนแทน replies image + textV2');
ok(rep.messages[1].substitution.t0.mentionee.userId === 'U111', 'mention substitution');

__lineCalls.length = 0;
line([{ type: 'message', replyToken: 'r3', source: { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text: 'คำสั่ง' } }]);
ok(__lineCalls.some(c => c.path === '/v2/bot/message/reply'), 'คำสั่ง replies (free)');

const admin = post('getAdminData', [AP]).result;
ok(admin.hasToken && admin.groupId === 'G1' && admin.sheetUrl && admin.webAppUrl, 'getAdminData (with sheet/web app URL)');
ok(get('getStats', ['2026-09']).result.dates.length === 1, 'getStats');

ok(pushes === 0, 'the system never pushes (reply only)');
console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
