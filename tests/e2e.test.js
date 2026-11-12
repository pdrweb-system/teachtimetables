// ทดสอบหน้าเว็บ index.html แบบ end-to-end ใน Chromium (Playwright) กับ apps-script/Code.gs จริง (ผ่าน tests/gasmock.js)
// รัน: node tests/e2e.test.js [โฟลเดอร์สำหรับเก็บภาพผลลัพธ์]
//   - ต้องมี playwright (เครื่องที่ยังไม่มี: npm i -D playwright && npx playwright install chromium)
//   - ฟอนต์ Sarabun: npm i @fontsource/sarabun (ถ้าไม่มี ภาพจะใช้ฟอนต์สำรองของระบบ — ผลทดสอบยังใช้ได้)
// จำลองให้เหมือนของจริง: หน้าเว็บกับ API อยู่คนละ origin (ตรวจ CORS), API ตอบ 302 ไป /macros/echo แบบ Apps Script
// และไม่รองรับ OPTIONS (ถ้าหน้าเว็บยิง CORS preflight จะล้มทันที)
require('./gasmock.js');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || '';
const DATE = '2026-09-28'; // วันจันทร์ — ใช้วันตายตัวให้ผลเหมือนเดิมทุกครั้งที่รัน

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8'), { filename: 'Code.gs' });
setup();
// "วันนี้" ของ backend = DATE (มีผลกับ getInitData และคำสั่ง สอนแทน ในกลุ่มไลน์)
globalThis.todayStr_ = function (off) {
  const p = DATE.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + (off || 0))).toISOString().slice(0, 10);
};

function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}
function fontFile(weight) {
  try {
    return require.resolve('@fontsource/sarabun/files/sarabun-thai-' + weight + '-normal.woff2', { paths: [process.cwd(), __dirname] });
  } catch (e) { return null; }
}
const lineEvent = (events) => doPost({ postData: { contents: JSON.stringify({ destination: 'UBOT', events }) } });

(async () => {
  const log = { api: [], errors: [], preflight: 0 };
  const echo = {};
  let echoId = 0;

  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const pageSrv = await listen((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  const apiSrv = await listen((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { log.preflight++; res.writeHead(405); return res.end(); }
    if (u.pathname === '/macros/echo') {
      const out = echo[u.searchParams.get('user_content_key')];
      res.writeHead(200, { 'Content-Type': out.mime, 'Access-Control-Allow-Origin': '*' });
      return res.end(out.getContent());
    }
    if (u.pathname !== '/macros/s/TEST/exec') { res.writeHead(404); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      if (req.method === 'GET') {
        const parameter = {};
        u.searchParams.forEach((v, k) => { parameter[k] = v; });
        out = doGet({ parameter });
        log.api.push({ method: 'GET', fn: parameter.fn });
      } else {
        out = doPost({ postData: { contents: body } });
        log.api.push({ method: 'POST', fn: JSON.parse(body).fn, contentType: req.headers['content-type'] });
      }
      const key = 'k' + (++echoId);
      echo[key] = out;
      res.writeHead(302, { Location: '/macros/echo?user_content_key=' + key, 'Access-Control-Allow-Origin': '*' });
      res.end();
    });
  });
  const deadSrv = await listen(() => {});
  const DEAD = 'http://127.0.0.1:' + deadSrv.address().port + '/macros/s/GONE/exec';
  deadSrv.close(); // พอร์ตนี้ปิดแล้ว → จำลอง URL ที่เชื่อมต่อไม่ได้
  const PAGE = 'http://127.0.0.1:' + pageSrv.address().port + '/';
  const API = 'http://127.0.0.1:' + apiSrv.address().port + '/macros/s/TEST/exec';

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok', hasTouch: true });
  const hasFont = !!fontFile(400);
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => {
    const url = route.request().url();
    if (!hasFont) return route.fulfill({ contentType: 'text/css', body: '' }); // ไม่มีฟอนต์ → ใช้ฟอนต์สำรอง (ไม่ให้เกิด error ใน console)
    if (url.startsWith('https://fonts.googleapis.com/')) {
      const css = [400, 600, 700].map((w) => '@font-face{font-family:"Sarabun";font-weight:' + w +
        ';src:url(https://fonts.gstatic.com/local/' + w + '.woff2) format("woff2");}').join('\n');
      return route.fulfill({ contentType: 'text/css', body: css });
    }
    return route.fulfill({ contentType: 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' },
      body: fs.readFileSync(fontFile(url.split('/').pop().split('.')[0])) });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  let passed = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
  const idle = () => page.waitForFunction(() => !document.querySelector('#loading').classList.contains('on'));
  const toastHas = (text) => page.waitForFunction((t) => document.querySelector('#toast').textContent.indexOf(t) >= 0, text);
  const shot = (name) => OUT && page.screenshot({ path: path.join(OUT, name) });
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  if (!hasFont) console.log('  (ไม่พบ @fontsource/sarabun — ภาพจะใช้ฟอนต์สำรอง)');

  try {
    // ── ตั้งค่า URL ของ API ──
    await page.goto(PAGE);
    ok(await page.$eval('#tab-settings', (e) => e.classList.contains('on')), 'ยังไม่ตั้ง URL → เปิดแท็บตั้งค่าให้');

    await page.fill('#apiUrlInput', DEAD);
    await page.click('#apiUrlSaveBtn');
    await toastHas('เชื่อมต่อ Apps Script ไม่ได้');
    await idle();
    ok(true, 'URL ที่เชื่อมต่อไม่ได้ → แจ้งเป็นภาษาไทยพร้อมวิธีตรวจ (ไม่ใช่ "Failed to fetch")');
    log.errors.length = 0; // error ของคำขอที่ตั้งใจให้ล้ม

    await page.fill('#apiUrlInput', API);
    await page.click('#apiUrlSaveBtn');
    await toastHas('เชื่อมต่อสำเร็จ ✓ โรงเรียนตัวอย่าง');
    await idle();
    ok(true, 'URL ถูกต้อง → โหลดข้อมูลผ่าน GET + 302 และแจ้งเชื่อมต่อสำเร็จ');

    // ── จัดสอนแทน ──
    await page.click('nav.tabbar button[data-tab="plan"]');
    ok((await page.textContent('#dayName')).indexOf('วันจันทร์ที่ 28 กันยายน 2569') >= 0, 'แสดงวันไทย + พ.ศ.');
    await page.click('#addAbsentBtn');
    await page.click('#pickList button[data-name="ครูสมชาย ใจดี"]');
    const n = await page.$$eval('#absentList .slot', (x) => x.length);
    ok(n > 0, 'เพิ่มครูที่ไม่อยู่ → ดึงคาบจากตารางสอน ' + n + ' คาบ');
    await page.click('#autoBtn');
    ok((await page.textContent('#progress')).indexOf('จัดแล้ว ' + n + '/' + n) >= 0, 'จัดอัตโนมัติครบทุกคาบ');
    ok(await page.$$eval('#absentList .slot.bad', (x) => x.length) === 0, 'ไม่มีคาบที่ชนกัน');

    // ── บันทึก + ภาพ (ไม่ต้องใช้ PIN) ──
    await page.click('#saveBtn');
    ok(await page.$('#pinModal') === null, 'ไม่มีหน้าจอขอ PIN');
    await page.waitForSelector('#previewModal.on', { timeout: 15000 });
    await idle();
    const img = await page.$eval('#previewImg', (i) => ({ src: i.src, w: i.naturalWidth }));
    ok(img.src.indexOf('data:image/jpeg;base64,') === 0 && img.w === 1080, 'สร้างภาพ JPEG กว้าง 1080px');
    ok(await page.evaluate(() => document.documentElement.scrollWidth) === 390, 'ไม่มี scroll แนวนอนที่จอ 390px');
    await page.waitForFunction(() => S.imgDrive);
    ok(log.api.some((c) => c.fn === 'saveImageToDrive'), 'อัปโหลดภาพลง Drive เบื้องหลัง');
    if (OUT) fs.writeFileSync(path.join(OUT, 'preview.jpg'), Buffer.from(img.src.split(',')[1], 'base64'));
    await shot('preview-modal.png');

    await page.click('#sendLineBtn');
    await toastHas('token');
    await idle();
    ok(true, 'ส่งไลน์ก่อนใส่ token → แจ้งข้อผิดพลาด');
    await page.click('[data-close="previewModal"]');

    // ── ตั้งค่า LINE ──
    await page.click('nav.tabbar button[data-tab="settings"]');
    await page.click('#loadLineBtn');
    await page.fill('#tokenInput', 'tok');
    await page.click('#saveTokenBtn');
    await toastHas('เชื่อมบอท บอทสอนแทน');
    await idle();
    ok(true, 'บันทึก token → แสดงชื่อบอท');
    lineEvent([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'G1' } }]);
    const subName = rows_('บันทึกสอนแทน').filter((r) => r[7])[0][7];
    lineEvent([{ type: 'message', replyToken: 'r2', source: { type: 'group', groupId: 'G1', userId: 'U111' },
      message: { type: 'text', text: 'ลงทะเบียน ' + subName.replace(/^ครู/, '').split(' ')[0] } }]);
    await page.click('#loadLineBtn');
    await page.waitForFunction(() => /เชื่อมแล้ว/.test(document.querySelector('#lineBox').textContent));
    await idle();
    ok(await page.$$eval('#lineBox .pill.ok', (x) => x.length) >= 2, 'กลุ่มเชื่อมแล้ว + ครูลงทะเบียนแล้ว (' + subName + ')');
    ok(await page.$eval('#lineBox input[readonly]', (i) => i.value) === API, 'Webhook URL = URL /exec ที่หน้าเว็บใช้อยู่');
    await shot('settings-line.png');

    // ── ส่งเข้ากลุ่มไลน์ ──
    await page.click('nav.tabbar button[data-tab="plan"]');
    await page.click('#saveBtn'); // ไม่มีการแก้ไข → เปิดภาพเลย
    await page.waitForSelector('#previewModal.on');
    await page.waitForFunction(() => S.imgDrive);
    __lineCalls.length = 0;
    await page.click('#sendLineBtn');
    await toastHas('ส่งเข้ากลุ่มไลน์แล้ว');
    const push = __lineCalls.find((c) => c.path === '/v2/bot/message/push').payload;
    ok(push.to === 'G1' && push.messages[0].type === 'image' && push.messages[1].type === 'textV2' &&
      push.messages[1].substitution.t0.mentionee.userId === 'U111', 'push เข้ากลุ่ม = ภาพ + textV2 แท็กชื่อ');

    __lineCalls.length = 0;
    lineEvent([{ type: 'message', replyToken: 'r3', source: { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text: 'สอนแทน' } }]);
    const rep = __lineCalls.find((c) => c.path === '/v2/bot/message/reply');
    ok(rep && rep.payload.messages[0].type === 'image' && rep.payload.messages[1].type === 'textV2', 'คำสั่ง สอนแทน ในกลุ่ม → ตอบภาพ + แท็กชื่อ (reply ฟรี)');

    // ── สถิติ ──
    await page.click('nav.tabbar button[data-tab="stats"]');
    await page.fill('#statMonth', DATE.slice(0, 7));
    await page.waitForFunction(() => document.querySelectorAll('#statDates .dateitem').length === 1);
    ok(true, 'หน้าสถิติแสดงวันที่จัดสอนแทน');
    await shot('stats.png');

    ok(log.preflight === 0, 'ไม่มี CORS preflight');
    ok(log.api.filter((c) => c.method === 'POST').every((c) => /^text\/plain/.test(c.contentType || '')), 'POST ทุกครั้งเป็น text/plain');
    ok(log.errors.length === 0, 'ไม่มี error ใน console' + (log.errors.length ? ': ' + log.errors.join(' | ') : ''));
    console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
  } catch (e) {
    console.error('ไม่ผ่าน: ' + e.message);
    if (log.errors.length) console.error(log.errors.join('\n'));
    await shot('fail.png');
    process.exitCode = 1;
  } finally {
    await browser.close();
    pageSrv.close();
    apiSrv.close();
  }
})();
