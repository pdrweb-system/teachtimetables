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
  image: {
    url: (v) => typeof v === 'string' && /^https:\/\//.test(v) && v.length <= 2000,
    size: ONE_OF(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '3xl', '4xl', '5xl', 'full']),
    aspectRatio: (v) => { const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(v); return !!m && +m[1] >= 1 && +m[2] >= 1 && +m[2] <= 3 * +m[1]; },
    aspectMode: ONE_OF(['cover', 'fit']), backgroundColor: COLOR, flex: (v) => Number.isInteger(v) && v >= 0, margin: SPACE, action: 1,
    align: ONE_OF(['start', 'end', 'center']), gravity: ONE_OF(['top', 'bottom', 'center']),
  },
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
      ['header', 'hero', 'body', 'footer'].forEach((k) => { if (node[k]) { if (node[k].type !== 'box' && !(k === 'hero' && node[k].type === 'image')) bad(p + '.' + k, 'ต้องเป็น box (hero เป็นรูปได้)'); walk(node[k], p + '.' + k); } });
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
    } else if ((node.type === 'text' || node.type === 'image') && node.action) {
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
const periodsShown = (allText(flex.contents.body).match(/"text":"\d+","size":"lg"/g) || []).map((s) => +s.match(/\d+/)[0]);
ok(periodsShown.join() === periodsShown.slice().sort((a, b) => a - b).join(), 'เรียงคาบจากเช้าไปเย็น');
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

// ── 4.1) ภาพขนาดอยู่ในเกณฑ์ → ใช้ภาพจาก Drive เป็น hero ของการ์ด ──
const jpeg = (w, h, pad) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]), Buffer.alloc(pad || 8), Buffer.from([0xff, 0xd9])]).toString('base64');
const withImage = (dataUrl) => { post('saveDay', [DATE, rows]); const r = post('saveImageToDrive', [DATE, dataUrl]).result; return { r, msg: say('แจ้งตารางสอนแทน')[0].payload.messages[0] }; };
let wi = withImage(jpeg(1024, 700));
ok(wi.r.width === 1024 && wi.r.height === 700, 'อ่านกว้าง×สูงของ JPEG ที่อัปโหลดได้ (1024×700)');
let hb = wi.msg.contents;
ok(wi.msg.type === 'flex' && hb.type === 'bubble' && hb.hero && hb.hero.type === 'image' && /^https:\/\/lh3\.googleusercontent\.com\/d\/FILE\d+$/.test(hb.hero.url), 'มีภาพใน Drive → การ์ดแสดงภาพ (hero) จาก URL ของ Drive');
ok(hb.hero.aspectRatio === '1024:700' && hb.hero.size === 'full' && hb.hero.aspectMode === 'fit' && hb.hero.action.uri.indexOf('drive.google.com/file/d/') >= 0, 'hero: อัตราส่วนตามภาพจริง ไม่ครอป แตะแล้วเปิดภาพเต็มใน Drive');
ok(flexProblems(wi.msg).length === 0, 'การ์ดแบบมีภาพผ่านการตรวจโครงสร้าง' + (flexProblems(wi.msg).length ? ': ' + flexProblems(wi.msg).join(' | ') : ''));
ok(hb.size === 'giga' && !JSON.stringify(hb).includes('"layout":"horizontal","spacing":"md"'), 'การ์ดแบบมีภาพไม่มีแถวรายคาบ (ภาพแสดงตารางแล้ว) และไม่เป็น carousel');
const imgText = allText(hb.body);
ok(imgText.indexOf('ครูที่ไม่อยู่') >= 0 && subNames.every((n) => imgText.indexOf(disp(n)) >= 0) && /คาบ \d/.test(imgText) && imgText.indexOf('ยังไม่มีผู้สอนแทน คาบ') >= 0, 'ใต้ภาพสรุปเป็นตัวหนังสือ: ครูที่ไม่อยู่ ผู้สอนแทน (คาบไหน) และคาบที่ยังไม่มีคนแทน (เผื่อภาพโหลดไม่ขึ้น)');
ok(hb.footer && allText(hb.footer).indexOf('เปิดภาพเต็ม') >= 0 && wi.msg.altText.indexOf('ตารางสอนแทน') >= 0, 'มีปุ่มเปิดภาพเต็ม และ altText ครบ');
const tall = withImage(jpeg(1024, 3500));
ok(tall.r.height === 3500 && !tall.msg.contents.hero && (tall.msg.contents.type === 'bubble' || tall.msg.contents.type === 'carousel'), 'ภาพสูงเกิน 1024px → ไม่ใช้ภาพ ใช้การ์ดแบบรายคาบแทน');
const wide = withImage(jpeg(1080, 600));
ok(!wide.msg.contents.hero, 'ภาพกว้างเกิน 1024px → ไม่ใช้ภาพ ใช้การ์ดแบบรายคาบแทน');
const big = withImage(jpeg(900, 600, 1100000));
ok(big.r.width === 0 && !big.msg.contents.hero, 'ไฟล์ภาพเกิน 1 MB → ไม่ใช้ภาพ (บันทึกขนาดเป็น 0)');
const png = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(800, 16); png.writeUInt32BE(500, 20);
ok(JSON.stringify(imageSize_(Array.from(png, (b) => (b > 127 ? b - 256 : b)))) === '{"w":800,"h":500}' && imageSize_([1, 2, 3]) === null, 'imageSize_: อ่าน PNG ได้ และไฟล์แปลก ๆ คืน null');
post('saveDay', [DATE, rows]); // ล้างภาพของวัน (บันทึกใหม่ = ภาพเดิมไม่ตรงข้อมูล)
ok(!say('แจ้งตารางสอนแทน')[0].payload.messages[0].contents.hero, 'หลังบันทึกข้อมูลใหม่ ภาพเก่าถูกถอน → ไม่แสดงภาพที่ไม่ตรงข้อมูล');

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
