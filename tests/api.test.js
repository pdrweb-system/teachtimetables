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
ok(post('linkTeacherLine', ['wrong', 'ครูสมชาย ใจดี', 'U9']).error.indexOf('ไม่รู้จัก') >= 0, 'teacher linking removed: linkTeacherLine no longer exists');
ok(get('getAdminData', [PW]).ok === false, 'admin API not reachable via GET');
ok(post('setAdminPassword', ['newsecret2', PW]).result === true && post('verifyAdmin', ['newsecret2']).ok, 'change admin password with old one');
ok(post('verifyAdmin', [PW]).ok === false, 'old password no longer works');
for (let i = 0; i < 5; i++) post('verifyAdmin', ['x' + i]);
const locked = post('verifyAdmin', ['newsecret2']);
ok(locked.ok === false && locked.error.indexOf('หลายครั้ง') >= 0, 'locked after repeated wrong passwords (even the right one)');
CacheService.getScriptCache().remove('admin_fails');
const AP = 'newsecret2';
ok(post('verifyAdmin', [AP]).ok, 'unlocked after the lock expires');

// LINE — บอทตอบคำสั่งเดียว: "แจ้งตารางสอนแทน"
ok(post('saveLineToken', [AP, 'tok']).result.name === 'บอทสอนแทน', 'saveLineToken');
const replies = () => __lineCalls.filter(c => c.path === '/v2/bot/message/reply');
const say = (text, source, token) => { __lineCalls.length = 0; line([{ type: 'message', replyToken: token || 'rt', source, message: { type: 'text', text } }]); return replies(); };
const inG = (g, u) => ({ type: 'group', groupId: g, userId: u });
const firstSub = rows.find(r => r.sub).sub;
globalThis.todayStr_ = () => date; // ให้ "วันนี้" ของคำสั่งในกลุ่ม = วันที่ทดสอบ
post('saveImageToDrive', [date, 'data:image/jpeg;base64,AAAA']);

// ยังไม่ได้เลือกกลุ่ม: เก็บรายชื่อสมาชิกแต่ไม่ตอบอะไร และ join ไม่ตั้งกลุ่ม/ไม่ทักทาย
__lineCalls.length = 0;
line([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'G1' } }]);
ok(!replies().length && !settings_()['LINE groupId'], 'join: no greeting, group not auto-set');
ok(say('แจ้งตารางสอนแทน', inG('G1', 'U111')).length === 0, 'no group chosen yet → no reply in groups');
ok(Object.keys(groupsSeen_()).indexOf('G1') >= 0, 'group G1 is noted from the event (so admin can see it)');
line([{ type: 'message', replyToken: 'rn', source: { type: 'group', groupId: 'GNOUID' }, message: { type: 'text', text: 'hi' } }]);
ok(Object.keys(groupsSeen_()).indexOf('GNOUID') >= 0, 'group noted even when the event has no userId');
say('แจ้งตารางสอนแทน', inG('GOTHER', 'UX'));

// เลือกกลุ่มในหน้า admin
const ag = post('getAdminData', [AP]).result;
ok(ag.groups.length === 3 && ag.groups.find(g => g.groupId === 'G1').name === 'กลุ่มครู G1' && /^\d{4}-/.test(ag.groups.find(g => g.groupId === 'G1').lastSeen), 'admin sees groups seen by the bot (with names)');
ok(post('setLineGroup', ['wrong', 'G1']).ok === false, 'setLineGroup needs the admin password');
ok(post('setLineGroup', [AP, 'GNOPE']).ok === false, 'cannot pick a group the bot never saw');
ok(post('setLineGroup', [AP, 'G1']).result === true && settings_()['LINE groupId'] === 'G1', 'admin picks the announce group');
ok(!('teachers' in ag) && !('members' in ag), 'getAdminData no longer lists teachers/members (no linking)');
ok(/\/ group$/.test(ag.lastEvent) && ag.lastMismatch === '', 'admin sees the last event received from LINE');

// เลือกกลุ่มแล้ว: ตอบเฉพาะกลุ่มนั้น เฉพาะข้อความ "แจ้งตารางสอนแทน" เป๊ะ ๆ
let r = say('แจ้งตารางสอนแทน', inG('G1', 'U2'));
ok(r.length === 1 && r[0].payload.messages.length === 1 && r[0].payload.messages[0].type === 'flex', 'แจ้งตารางสอนแทน → Flex card only (reply, no tagging)');
ok(!JSON.stringify(r[0].payload).includes('mention'), 'no mention in the reply');
['คำสั่ง', 'help', 'สอนแทน', 'สอนแทนพรุ่งนี้', 'แจ้งตารางสอนแทนพรุ่งนี้', 'ลงทะเบียน สมชาย', 'ตั้งกลุ่มนี้', 'แจ้งตารางสอนแทนครับ', 'สวัสดี'].forEach(t => {
  ok(say(t, inG('G1', 'U2')).length === 0, 'other words are ignored: ' + t);
});
ok(settings_()['LINE groupId'] === 'G1', 'ตั้งกลุ่มนี้ no longer changes the group');
ok(say('แจ้งตารางสอนแทน', inG('GOTHER', 'UX')).length === 0, 'other group: ignored');
say('hi', inG('GNEW2', 'UZ'));
ok(Object.keys(groupsSeen_()).indexOf('GNEW2') >= 0 && settings_()['LINE groupId'] === 'G1', 'new groups are still listed after one is chosen, without changing the choice');
doPost({ postData: { contents: JSON.stringify({ destination: 'UWRONG', events: [{ type: 'message', replyToken: 'rw', source: { type: 'group', groupId: 'GW' }, message: { type: 'text', text: 'แจ้งตารางสอนแทน' } }] }) } });
ok(PROP.getProperty('LAST_MISMATCH') && Object.keys(groupsSeen_()).indexOf('GW') < 0, 'events for another bot (wrong destination) are ignored and reported');
ok(say('แจ้งตารางสอนแทน', { type: 'room', roomId: 'R1', userId: 'U2' }).length === 0, 'rooms are ignored');
r = say('แจ้งตารางสอนแทน', { type: 'user', userId: 'U2' });
ok(r.length === 1 && r[0].payload.messages.length === 1 && r[0].payload.messages[0].type === 'flex', '1:1 chat: Flex only');
globalThis.todayStr_ = (o) => new Date(Date.UTC(2026, 8, 28 + (o || 0) + 5)).toISOString().slice(0, 10);
r = say('แจ้งตารางสอนแทน', inG('G1', 'U2'));
ok(r.length === 1 && r[0].payload.messages[0].type === 'text' && r[0].payload.messages[0].text.indexOf('ยังไม่มีการจัดสอนแทน') >= 0, 'no assignment today → short text');
globalThis.todayStr_ = () => date;
ok(post('setLineGroup', [AP, '']).result === true && !settings_()['LINE groupId'], 'admin can clear the group');
post('setLineGroup', [AP, 'G1']);

const admin = post('getAdminData', [AP]).result;
ok(admin.hasToken && admin.groupId === 'G1' && admin.sheetUrl && admin.webAppUrl, 'getAdminData (with sheet/web app URL)');
ok(get('getStats', ['2026-09']).result.dates.length === 1, 'getStats');

// นำเข้าตารางสอน (จาก PDF → ผู้ดูแลตรวจ → ส่งมาบันทึก)
const imp = (payload, pw) => post('importTimetable', [pw === undefined ? AP : pw, payload]);
const ttRows = () => rows_('ตารางสอน').filter(r => r[0]);
const base = [
  { teacher: 'ครูสมศรี รักเรียน', day: 'จันทร์', period: 1, subject: 'ภาษาไทย', room: 'ป.1/1' },
  { teacher: 'ครูสมศรี รักเรียน', day: 'จันทร์', period: 2, subject: 'คณิต', room: 'ป.2' },
  { teacher: 'ครูสมชาย ใจดี', day: 'พฤหัส', period: 3, subject: 'วิทย์', room: 'ป.3' },
];
ok(imp({ rows: base }, 'wrong').ok === false && ttRows().length > 3, 'importTimetable needs the admin password (nothing changed)');
ok(imp({ rows: [] }).ok === false, 'import: empty rows rejected');
ok(imp({ rows: base }).error.indexOf('ไม่พบครู') >= 0, 'import: unknown teacher rejected unless added');
ok(imp({ rows: [{ teacher: 'ครูสมชาย ใจดี', day: 'วันเสาร์ที่', period: 1 }] }).error.indexOf('วันไม่ถูกต้อง') >= 0, 'import: invalid day rejected');
ok(imp({ rows: [{ teacher: 'ครูสมชาย ใจดี', day: 'จันทร์', period: 0 }] }).error.indexOf('คาบไม่ถูกต้อง') >= 0, 'import: invalid period rejected');
ok(imp({ rows: [base[2], base[2]] }).error.indexOf('สองรายการ') >= 0, 'import: duplicate teacher/day/period rejected');
const before = ttRows().length;
ok(imp({ rows: base, mode: 'replace', addTeachers: [{ name: 'ครูสมศรี รักเรียน', display: 'ครูสมศรี', dept: 'ภาษาไทย' }], deactivateOthers: true,
  periods: [{ p: 1, start: '8:30', end: '9:30' }, { p: 2, start: '09:30', end: '10:30' }] }).result.rows === 3, 'import: replace succeeds');
ok(ttRows().length === 3 && ttRows().every(r => r[1] === 'จันทร์' || r[1] === 'พฤหัสบดี'), 'import: timetable replaced, day names normalised (พฤหัส → พฤหัสบดี)');
const bk = __book.getSheetByName('สำรองตารางสอน');
ok(bk && bk.getLastRow() === before + 1, 'import: previous timetable backed up (' + before + ' rows)');
const tch = teachers_();
ok(tch.find(t => t.name === 'ครูสมศรี รักเรียน' && t.display === 'ครูสมศรี' && t.dept === 'ภาษาไทย' && t.active), 'import: new teacher added with display name and group');
ok(tch.filter(t => t.active).length === 2 && !tch.find(t => t.name === 'ครูมาลี ศรีสุข').active, 'import: teachers not in the new timetable deactivated');
ok(periods_().length === 2 && periods_()[0].start === '08:30', 'import: periods replaced (times padded to HH:mm)');
const d2 = get('getDateData', ['2026-09-28']).result;
ok(d2.timetable.length === 2 && d2.timetable.some(x => x.teacher === 'ครูสมศรี รักเรียน' && x.room === 'ป.1/1'), 'import: new timetable is what the planner sees');
ok(imp({ rows: [{ teacher: 'ครูสมชาย ใจดี', day: 'อังคาร', period: 4, subject: 'ศิลปะ', room: 'ป.4' }], mode: 'append' }).result.rows === 1 && ttRows().length === 4, 'import: append adds rows without removing');

ok(pushes === 0, 'the system never pushes (reply only)');
console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
