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
const saved = post('saveDay', [date, rows]);
ok(saved.ok && saved.result.subs.length === rows.length, 'saveDay');
post('saveDay', [date, rows]);
ok(rows_('บันทึกสอนแทน').filter(r => r[2]).length === rows.length, 'resave replaces the day, no duplicates');
ok(post('saveDay', [date, [{ absent, sub: absent, period: 1 }]]).ok === false, 'self-substitution rejected');
ok(post('sendToLine', [date, null]).error.indexOf('token') >= 0, 'sendToLine needs token');

// LINE
ok(post('saveLineToken', ['tok']).result.name === 'บอทสอนแทน', 'saveLineToken');
line([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'G1' } }]);
ok(settings_()['LINE groupId'] === 'G1', 'join event sets group');
const firstSub = rows.find(r => r.sub).sub;
line([{ type: 'message', replyToken: 'r2', source: { type: 'group', groupId: 'G1', userId: 'U111' },
  message: { type: 'text', text: 'ลงทะเบียน ' + firstSub.replace(/^ครู/, '').split(' ')[0] } }]);
ok(teachers_().find(t => t.name === firstSub).userId === 'U111', 'ลงทะเบียน links userId');

__lineCalls.length = 0;
const sent = post('sendToLine', [date, 'data:image/jpeg;base64,AAAA']);
ok(sent.ok, 'sendToLine ok');
const push = __lineCalls.find(c => c.path === '/v2/bot/message/push').payload;
ok(push.to === 'G1' && push.messages[0].type === 'image' && push.messages[1].type === 'textV2', 'push = image + textV2');
ok(push.messages[1].substitution.t0.mentionee.userId === 'U111', 'mention substitution');

__lineCalls.length = 0;
line([{ type: 'message', replyToken: 'r3', source: { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text: 'คำสั่ง' } }]);
ok(__lineCalls.some(c => c.path === '/v2/bot/message/reply'), 'คำสั่ง replies (free)');

const admin = post('getAdminData').result;
ok(admin.hasToken && admin.groupId === 'G1' && admin.quota.used === 12, 'getAdminData');
ok(get('getStats', ['2026-09']).result.dates.length === 1, 'getStats');

console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
