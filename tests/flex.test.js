// ทดสอบคำสั่ง "แจ้งตารางสอนแทน" (reply เป็น Flex message + ข้อความแท็กชื่อ) และตรวจโครงสร้าง Flex ตามข้อกำหนดของ LINE
// รัน: node tests/flex.test.js   (พิมพ์ JSON ของ Flex ออกมาดูได้ด้วย: node tests/flex.test.js --dump)
require('./gasmock.js');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), { filename: 'Code.gs' });

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const post = (fn, args) => JSON.parse(doPost({ postData: { contents: JSON.stringify({ fn, args: args || [] }) } }).getContent());
const line = (events) => doPost({ postData: { contents: JSON.stringify({ destination: 'UBOT', events }) } });
const say = (text, source) => {
  __lineCalls.length = 0;
  line([{ type: 'message', replyToken: 'rt', source: source || { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text } }]);
  return __lineCalls.filter((c) => c.path === '/v2/bot/message/reply');
};
const bytes = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

// ── ตัวตรวจ Flex (ส่วนที่ใช้ในระบบนี้) ตาม Messaging API reference ──
const ONE_OF = (list) => (v) => list.indexOf(v) >= 0;
const PX = (v) => /^\d+(\.\d+)?px$/.test(v);
const PCT = (v) => /^\d+(\.\d+)?%$/.test(v);
const KW = ['none', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const SPACE = (v) => KW.indexOf(v) >= 0 || PX(v);
const COLOR = (v) => /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
const POS_OFFSET = { position: ONE_OF(['relative', 'absolute']), offsetTop: SPACE, offsetBottom: SPACE, offsetStart: SPACE, offsetEnd: SPACE };
const RULES = {
  bubble: { size: ONE_OF(['nano', 'micro', 'deca', 'hecto', 'kilo', 'mega', 'giga']), direction: ONE_OF(['ltr', 'rtl']), header: 1, hero: 1, body: 1, footer: 1, styles: 1, action: 1 },
  carousel: { contents: 1 },
  box: Object.assign({
    layout: ONE_OF(['horizontal', 'vertical', 'baseline']), contents: 1, backgroundColor: COLOR, borderColor: COLOR,
    borderWidth: (v) => PX(v) || ONE_OF(['none', 'light', 'normal', 'medium', 'semi-bold', 'bold'])(v),
    cornerRadius: SPACE, width: (v) => PX(v) || PCT(v), maxWidth: (v) => PX(v) || PCT(v), height: (v) => PX(v) || PCT(v), maxHeight: (v) => PX(v) || PCT(v),
    flex: (v) => Number.isInteger(v) && v >= 0, spacing: SPACE, margin: SPACE,
    paddingAll: (v) => SPACE(v) || PCT(v), paddingTop: (v) => SPACE(v) || PCT(v), paddingBottom: (v) => SPACE(v) || PCT(v),
    paddingStart: (v) => SPACE(v) || PCT(v), paddingEnd: (v) => SPACE(v) || PCT(v), action: 1,
    justifyContent: ONE_OF(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']),
    alignItems: ONE_OF(['flex-start', 'center', 'flex-end']),
    background: (v) => v && v.type === 'linearGradient' && /^\d+(\.\d+)?deg$/.test(v.angle) && COLOR(v.startColor) && COLOR(v.endColor),
  }, POS_OFFSET),
  text: Object.assign({
    text: (v) => typeof v === 'string' && v.trim().length > 0, flex: (v) => Number.isInteger(v) && v >= 0, margin: SPACE,
    size: (v) => ONE_OF(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '3xl', '4xl', '5xl'])(v) || PX(v),
    align: ONE_OF(['start', 'end', 'center']), gravity: ONE_OF(['top', 'bottom', 'center']), wrap: (v) => typeof v === 'boolean',
    maxLines: (v) => Number.isInteger(v) && v >= 0, weight: ONE_OF(['regular', 'bold']), color: COLOR,
    style: ONE_OF(['normal', 'italic']), decoration: ONE_OF(['none', 'underline', 'line-through']), action: 1,
  }, POS_OFFSET),
  separator: { margin: SPACE, color: COLOR },
  button: Object.assign({
    action: 1, flex: (v) => Number.isInteger(v) && v >= 0, margin: SPACE, height: ONE_OF(['sm', 'md']),
    style: ONE_OF(['primary', 'secondary', 'link']), color: COLOR, gravity: ONE_OF(['top', 'bottom', 'center']),
  }, POS_OFFSET),
};

function flexProblems(msg) {
  const errs = [];
  const bad = (p, m) => errs.push(p + ': ' + m);
  if (msg.type !== 'flex') bad('message', 'type ไม่ใช่ flex');
  if (typeof msg.altText !== 'string' || !msg.altText.trim() || [...msg.altText].length > 1500) bad('altText', 'ว่างหรือยาวเกิน 1500');
  const action = (a, p) => {
    if (!a || a.type !== 'uri') return bad(p, 'action ต้องเป็น uri');
    if (!/^(https?|line|tel):/.test(a.uri || '') || a.uri.length > 1000) bad(p, 'uri ไม่ถูกต้อง');
    if (a.label != null && (!String(a.label).trim() || [...a.label].length > 20)) bad(p, 'label ว่างหรือเกิน 20 ตัวอักษร');
  };
  const walk = (node, p) => {
    if (!node || typeof node !== 'object') return bad(p, 'ไม่ใช่ object');
    const rule = RULES[node.type];
    if (!rule) return bad(p, 'type ไม่รู้จัก: ' + node.type);
    Object.keys(node).forEach((k) => {
      if (k === 'type') return;
      if (!(k in rule)) return bad(p, 'property ไม่รู้จัก: ' + node.type + '.' + k);
      if (typeof rule[k] === 'function' && !rule[k](node[k])) bad(p + '.' + k, 'ค่าไม่ถูกต้อง: ' + JSON.stringify(node[k]));
    });
    if (node.type === 'carousel') {
      if (!Array.isArray(node.contents) || !node.contents.length || node.contents.length > 12) bad(p, 'carousel ต้องมี 1–12 bubble');
      (node.contents || []).forEach((b, i) => { if (b.type !== 'bubble') bad(p, 'carousel มีของที่ไม่ใช่ bubble'); walk(b, p + '[' + i + ']'); });
    } else if (node.type === 'bubble') {
      ['header', 'hero', 'body', 'footer'].forEach((k) => { if (node[k]) { if (node[k].type !== 'box') bad(p + '.' + k, 'ต้องเป็น box'); walk(node[k], p + '.' + k); } });
      Object.keys(node.styles || {}).forEach((k) => {
        if (['header', 'hero', 'body', 'footer'].indexOf(k) < 0) bad(p + '.styles', 'block ไม่รู้จัก ' + k);
        const s = node.styles[k];
        Object.keys(s).forEach((sk) => {
          if (['backgroundColor', 'separator', 'separatorColor'].indexOf(sk) < 0) bad(p + '.styles.' + k, 'property ไม่รู้จัก ' + sk);
        });
      });
      if (node.action) action(node.action, p + '.action');
    } else if (node.type === 'box') {
      if (!node.layout) bad(p, 'box ต้องมี layout');
      if (!Array.isArray(node.contents) || !node.contents.length) bad(p, 'box ต้องมี contents');
      (node.contents || []).forEach((c, i) => walk(c, p + '.contents[' + i + ']'));
      if (node.action) action(node.action, p + '.action');
    } else if (node.type === 'button') {
      action(node.action, p + '.action');
    } else if (node.type === 'text' && node.action) {
      action(node.action, p + '.action');
    }
  };
  walk(msg.contents, 'contents');
  const c = msg.contents || {};
  if (c.type === 'bubble' && bytes(c) > 30000) bad('contents', 'bubble เกิน 30 KB');
  if (c.type === 'carousel') {
    if (bytes(c) > 50000) bad('contents', 'carousel เกิน 50 KB');
    (c.contents || []).forEach((b, i) => { if (bytes(b) > 30000) bad('contents[' + i + ']', 'bubble เกิน 30 KB'); });
  }
  return errs;
}
const allText = (o) => JSON.stringify(o);

// ── เตรียมข้อมูล: วันจันทร์ 2026-09-28, ครูสมชายลา (มีคาบ), ครูนภาลา (หมายเหตุมีปีกกา) ──
setup();
const DATE = '2026-09-28';
globalThis.todayStr_ = (off) => { const d = new Date(Date.UTC(2026, 8, 28 + (off || 0))); return d.toISOString().slice(0, 10); };
const dd0 = getDateData(DATE);
const teachers = teachers_().map((t) => t.name);
const busy = (p) => dd0.timetable.filter((x) => x.period === p).map((x) => x.teacher);
const absent = 'ครูสมชาย ใจดี';
const absent2 = 'ครูนภา แสงทอง';
const taken = {};
const rows = dd0.timetable.filter((x) => x.teacher === absent).map((s, i) => {
  const sub = i === 1 ? '' : (teachers.find((n) => n !== absent && n !== absent2 && busy(s.period).indexOf(n) < 0 && !taken[n + s.period]) || '');
  if (sub) taken[sub + s.period] = 1;
  return { absent, reason: 'ลาป่วย', note: '', period: s.period, subject: s.subject, room: s.room, sub };
});
rows.push({ absent: absent2, reason: 'ไปราชการ', note: 'อบรม {ออนไลน์}', period: '', subject: '', room: '', sub: '' });
ok(post('saveDay', [DATE, rows]).ok, 'บันทึกข้อมูลตัวอย่าง');
post('setAdminPassword', ['secret1']);
post('saveLineToken', ['secret1', 'tok']);
const subNames = [...new Set(rows.filter((r) => r.sub).map((r) => r.sub))];
const linkedName = subNames[0];
line([{ type: 'message', replyToken: 'r0', source: { type: 'group', groupId: 'G1', userId: 'U111' }, message: { type: 'text', text: 'สวัสดี' } }]);
ok(post('setLineGroup', ['secret1', 'G1']).ok, 'เลือกกลุ่มรับประกาศ');
const disp = (n) => teachers_().find((t) => t.name === n).display;

// ── 1) ในกลุ่ม: reply = Flex อย่างเดียว (ไม่แท็กชื่อ) ──
let rep = say('แจ้งตารางสอนแทน');
ok(rep.length === 1, 'ตอบด้วย reply (ไม่ใช่ push) 1 ครั้ง');
let msgs = rep[0].payload.messages;
ok(msgs.length === 1 && msgs[0].type === 'flex', 'ในกลุ่ม: Flex อย่างเดียว');
ok(!JSON.stringify(msgs).includes('mention'), 'ไม่มีการแท็กชื่อ (mention)');
const flex = msgs[0];
const probs = flexProblems(flex);
ok(probs.length === 0, 'Flex ผ่านการตรวจโครงสร้าง' + (probs.length ? ':\n  ' + probs.join('\n  ') : ''));
ok(flex.contents.type === 'bubble', 'คาบไม่เยอะ → bubble เดียว');
const slotsCount = rows.filter((r) => r.period).length;
ok(allText(flex.contents.header).indexOf(slotsCount + ' คาบ') >= 0 && allText(flex.contents.header).indexOf('วันจันทร์ที่ 28 กันยายน 2569') >= 0, 'หัวการ์ดมีวันที่และจำนวนคาบ');
ok(subNames.every((n) => allText(flex).indexOf(disp(n)) >= 0), 'แสดงชื่อผู้สอนแทนครบ');
ok(allText(flex).indexOf('ยังไม่มีผู้สอนแทน') >= 0, 'คาบที่ยังไม่มีคนแทนแสดงเป็นสีแดง');
ok(allText(flex).indexOf('ครูนภา (ไปราชการ) — อบรม {ออนไลน์}') >= 0, 'แสดงครูที่ไม่อยู่ + เหตุผล + หมายเหตุ (Flex ไม่ต้อง escape ปีกกา)');
ok(flex.altText.indexOf('ตารางสอนแทน') >= 0 && flex.altText.indexOf(disp(subNames[0])) >= 0, 'altText (แสดงในการแจ้งเตือน) มีชื่อผู้สอนแทน');
// ── โครงสร้างตารางแบบเดียวกับภาพ: หัวตาราง + แถวละคาบ ──
const body0 = flex.contents.body.contents;
ok(/^ครูที่ไม่อยู่: /.test(body0[0].text) && body0[0].text.indexOf('ครูนภา (ไปราชการ) — อบรม {ออนไลน์}') >= 0 && body0[0].text.indexOf('ครูสมชาย (ลาป่วย)') >= 0, 'บรรทัด "ครูที่ไม่อยู่: …" เหมือนในภาพ (ทุกคน + เหตุผล + หมายเหตุ)');
const table = body0.find((c) => c.type === 'box' && c.layout === 'vertical');
const colHead = table.contents[0].contents.map((c) => c.text);
ok(colHead.join('|') === 'คาบ|เวลา|ห้อง|วิชา|ครูที่ไม่อยู่|ครูสอนแทน', 'หัวตาราง 6 คอลัมน์ เหมือนในภาพ: ' + colHead.join('|'));
const dataRows = table.contents.slice(1);
const cellsOf = (r) => r.contents.map((c) => c.text);
ok(dataRows.length === slotsCount && dataRows.every((r) => cellsOf(r).length === 6), 'หนึ่งแถวต่อหนึ่งคาบ (' + dataRows.length + ' แถว) แถวละ 6 ช่อง');
const pNums = dataRows.map((r) => +cellsOf(r)[0]);
ok(pNums.join() === pNums.slice().sort((a, b) => a - b).join(), 'เรียงคาบจากเช้าไปเย็น: ' + pNums.join());
ok(/^\d\d:\d\d–\d\d:\d\d$/.test(cellsOf(dataRows[0])[1]) && /^ป\./.test(cellsOf(dataRows[0])[2]), 'ช่องเวลา (08:30–09:30) และห้อง (ป.…) ตรงตำแหน่ง');
const openRows = dataRows.filter((r) => cellsOf(r)[5] === 'ยังไม่มีผู้สอนแทน');
ok(openRows.length >= 1 && openRows.every((r) => r.backgroundColor === '#fdecec' && r.contents[5].color === '#c62828'), 'คาบที่ยังไม่มีคนแทน: พื้นแดงอ่อน ตัวหนังสือแดง');
const doneRows = dataRows.filter((r) => cellsOf(r)[5] !== 'ยังไม่มีผู้สอนแทน');
ok(doneRows.length >= 1 && doneRows.every((r) => r.contents[5].weight === 'bold' && r.contents[5].color === '#0b7a3e' && r.backgroundColor !== '#fdecec'), 'คาบที่มีผู้สอนแทน: ชื่อครูสีเขียวตัวหนา');
const meta = flex.contents.footer.contents.find((c) => c.type === 'box' && c.layout === 'horizontal');
ok(meta && /^ผู้จัด: /.test(meta.contents[0].text) && /^จัดทำเมื่อ \d{1,2} \S+ 25\d\d \d\d:\d\d น\.$/.test(meta.contents[1].text), 'ท้ายการ์ด: "ผู้จัด: …" ซ้าย และ "จัดทำเมื่อ 13 พ.ย. 2569 16:14 น." ขวา เหมือนท้ายภาพ: ' + (meta && meta.contents[1].text));
ok(flex.contents.size === 'giga' && flex.contents.header.contents[1].contents[0].text === 'ตารางสอนแทน', 'หัวการ์ด: ชื่อโรงเรียน / ตารางสอนแทน / วันที่ + ป้ายจำนวนคาบ');
ok(!flex.contents.footer || !allText(flex.contents.footer).includes('"button"'), 'ยังไม่มีภาพ → ไม่มีปุ่มดูภาพ');


// ── 2) แชต 1:1 กับบอท → Flex อย่างเดียว ──
rep = say('แจ้งตารางสอนแทน', { type: 'user', userId: 'U2' });
ok(rep.length === 1 && rep[0].payload.messages.length === 1 && rep[0].payload.messages[0].type === 'flex', 'แชต 1:1 → Flex อย่างเดียว');

// ── 3) วันที่ไม่มีการจัด / คำอื่น ──
const realToday = globalThis.todayStr_;
globalThis.todayStr_ = (o) => realToday((o || 0) + 1); // พรุ่งนี้ (ไม่มีการจัด)
rep = say('แจ้งตารางสอนแทน');
globalThis.todayStr_ = realToday;
ok(rep.length === 1 && rep[0].payload.messages[0].type === 'text' && rep[0].payload.messages[0].text.indexOf('วันอังคารที่ 29 กันยายน 2569') >= 0, 'วันที่ไม่มีการจัด → ตอบข้อความแจ้ง');
['แจ้งตารางสอนแทน พรุ่งนี้', 'แจ้งตารางสอนแทนพรุ่งนี้', 'แจ้งตารางสอนแทนครับ', 'คำสั่ง', 'สอนแทน'].forEach((t) => ok(say(t).length === 0, 'ข้อความอื่นไม่ตอบ: ' + t));

// ── 4) มีภาพใน Drive → ปุ่มดูภาพ ──
const img = post('saveImageToDrive', [DATE, 'data:image/jpeg;base64,AAAA']).result;
msgs = say('แจ้งตารางสอนแทน')[0].payload.messages;
const btn = JSON.parse(allText(msgs[0].contents.footer)).contents.find((c) => c.type === 'button');
ok(btn && btn.action.uri === img.viewUrl && flexProblems(msgs[0]).length === 0, 'มีภาพ → ปุ่ม "ดูภาพตาราง" เปิดไฟล์ใน Drive');

// ── 5) คาบเยอะ → carousel, เกินขนาดที่ LINE รับ → ตัดคาบท้ายพร้อมบอกจำนวน ──
const fake = (n) => ({
  thaiDate: 'วันจันทร์ที่ 28 กันยายน 2569', image: null,
  subs: Array.from({ length: n }, (_, i) => ({ absent: teachers[i % 6], reason: 'ลาป่วย', note: 'หมายเหตุยาวพอสมควรสำหรับทดสอบขนาดข้อความ', period: (i % 7) + 1, subject: 'วิชาตัวอย่างชื่อยาวพอสมควร', room: 'ม.' + ((i % 6) + 1) + '/' + ((i % 3) + 1), sub: i % 4 ? teachers[(i + 1) % 6] : '' })),
});
const sizes = {};
[1, 15, 16, 30, 45, 400].forEach((n) => {
  const m = buildFlexMessage_(fake(n));
  const p = flexProblems(m);
  sizes[n] = (m.contents.type === 'carousel' ? m.contents.contents.length + ' bubbles' : 'bubble') + ', ' + Math.round(bytes(m.contents) / 100) / 10 + ' KB';
  ok(p.length === 0, n + ' คาบ: Flex ถูกต้องและไม่เกินขนาด (' + sizes[n] + ')' + (p.length ? ':\n  ' + p.join('\n  ') : ''));
});
ok(buildFlexMessage_(fake(FLEX.ROWS_PER_BUBBLE)).contents.type === 'bubble', FLEX.ROWS_PER_BUBBLE + ' คาบยังเป็น bubble เดียว');
ok(buildFlexMessage_(fake(FLEX.ROWS_PER_BUBBLE + 1)).contents.type === 'carousel', 'เกิน ' + FLEX.ROWS_PER_BUBBLE + ' คาบ → carousel');
const huge = buildFlexMessage_(fake(400));
ok(huge.contents.contents.length <= 12 && /…และอีก \d+ คาบ/.test(allText(huge)), '400 คาบ → ไม่เกิน 12 bubble และบอกว่ามีอีกกี่คาบ');

// ── 6) LINE ปฏิเสธ Flex → ตอบเป็นข้อความธรรมดาแทน ──
const realFetch = UrlFetchApp.fetch;
UrlFetchApp.fetch = (url, opt) => {
  const r = realFetch(url, opt);
  if (/message\/reply/.test(url) && opt.payload.indexOf('"type":"flex"') >= 0) {
    return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ message: 'A message (messages[0]) in the request body is invalid' }) };
  }
  return r;
};
const realErr = console.error;
console.error = () => {};
rep = say('แจ้งตารางสอนแทน');
UrlFetchApp.fetch = realFetch;
console.error = realErr;
ok(rep.length === 2 && rep[1].payload.messages[0].type === 'text' && rep[1].payload.messages[0].text.indexOf('ตารางสอนแทน') >= 0, 'Flex ถูกปฏิเสธ → ตอบข้อความธรรมดาแทน');

if (process.argv.indexOf('--dump') >= 0) {
  console.log(JSON.stringify(say('แจ้งตารางสอนแทน')[0].payload.messages, null, 2));
  console.log(sizes);
}
console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
