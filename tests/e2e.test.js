// ทดสอบหน้าเว็บ index.html แบบ end-to-end ใน Chromium (Playwright) กับ apps-script/Code.gs จริง (ผ่าน tests/gasmock.js)
// รัน: node tests/e2e.test.js [โฟลเดอร์สำหรับเก็บภาพผลลัพธ์]
//   - ต้องมี playwright 1.45 ขึ้นไป (ใช้ page.clock ตรึงวันที่ของเบราว์เซอร์; เครื่องที่ยังไม่มี: npm i -D playwright && npx playwright install chromium)
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
// config.js จริงของ repo อาจมี URL ของผู้ใช้อยู่ → ในเทสต์เสิร์ฟค่าว่างเป็นค่าเริ่มต้น (ตอนท้ายมีเทสต์ที่ตั้งค่าเอง)
globalThis.__configJs = "window.APP_CONFIG = { apiUrl: '' };";
const lineEvent = (events) => doPost({ postData: { contents: JSON.stringify({ destination: 'UBOT', events }) } });

(async () => {
  const log = { api: [], errors: [], preflight: 0 };
  const echo = {};
  let echoId = 0;

  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const pageSrv = await listen((req, res) => {
    if (req.url.split('?')[0] === '/config.js' && globalThis.__configJs != null) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(globalThis.__configJs); }
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
  let pdfjsDir = null;
  try { pdfjsDir = path.dirname(require.resolve('pdfjs-dist/build/pdf.min.js', { paths: [process.cwd(), __dirname] })); } catch (e) { /* ไม่มี pdfjs-dist → ข้ามเทสต์นำเข้า PDF */ }
  await context.route(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\//, (route) => {
    const f = route.request().url().split('/').pop();
    if (!pdfjsDir || !fs.existsSync(path.join(pdfjsDir, f))) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(path.join(pdfjsDir, f)) });
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PAGE.replace(/\/$/, '') });
  const page = await context.newPage();
  page.on('pageerror', (e) => log.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push('console: ' + m.text()); });
  // กล่องถาม (confirm / beforeunload): ปกติตอบตกลง — ตั้ง dialogMode = 'dismiss' เพื่อทดสอบกรณีตอบยกเลิก
  const dialogs = [];
  let dialogMode = 'accept';
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); return dialogMode === 'dismiss' ? d.dismiss() : d.accept(); });
  // นาฬิกาของเบราว์เซอร์ = DATE เช่นเดียวกับ backend (ปุ่ม วันนี้/พรุ่งนี้ ของหน้าเว็บใช้นาฬิกาเครื่อง); ตรึงเฉพาะ Date — timer ยังเดินปกติ
  const setClock = (date) => page.clock.setFixedTime(new Date(date + 'T08:00:00+07:00'));
  await setClock(DATE);

  let passed = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
  const idle = () => page.waitForFunction(() => !document.querySelector('#loading').classList.contains('on'));
  const toastHas = (text) => page.waitForFunction((t) => document.querySelector('#toast').textContent.indexOf(t) >= 0, text);
  const shot = (name) => OUT && page.screenshot({ path: path.join(OUT, name) });
  const hasClass = (sel, cls) => page.$eval(sel, (e, c) => e.classList.contains(c), cls);
  const closed = (id) => page.waitForFunction((i) => !document.getElementById(i).classList.contains('on'), id);
  // ที่แตะได้ซึ่งเล็กกว่า 44px (ช่องติ๊ก/ปุ่มเลือกนับทั้งแถวของ label; ช่องที่ซ่อนไว้ไม่นับ)
  const smallTargets = (scope) => page.evaluate((sc) => {
    const out = [];
    document.querySelectorAll(sc).forEach((root) => {
      root.querySelectorAll('button, select, a, label.btn, label.opt, label.datepick, input:not(.vh):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=month])').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && (r.width < 44 || r.height < 44)) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
    });
    return out;
  }, scope);
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  if (!hasFont) console.log('  (ไม่พบ @fontsource/sarabun — ภาพจะใช้ฟอนต์สำรอง)');

  try {
    // ── ตั้งค่า URL ของ API ──
    await page.goto(PAGE);
    ok(await page.$eval('#tab-more', (e) => e.classList.contains('on')), 'ยังไม่ตั้ง URL → เปิดแท็บเพิ่มเติมให้');

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

    // ── เลือกวัน: ปุ่ม วันนี้/พรุ่งนี้ + ลูกศร ──
    ok(await hasClass('#todayBtn', 'on') && await page.isHidden('#actionBar'), 'เปิดมาอยู่ที่ “วันนี้”; ยังไม่มีรายการ → ไม่แสดงแถบปุ่มล่าง');
    await page.click('#tomorrowBtn');
    await idle();
    ok(await page.evaluate(() => S.date) === '2026-09-29' && await hasClass('#tomorrowBtn', 'on') && (await page.textContent('#dayName')).indexOf('วันอังคาร') >= 0, 'ปุ่ม “พรุ่งนี้” → ไปวันถัดไป');
    await page.click('#prevDay');
    await idle();
    ok(await page.evaluate(() => S.date) === DATE && await hasClass('#todayBtn', 'on'), 'ลูกศร ‹ → กลับมาวันนี้');
    // เปิดหน้าค้างไว้ข้ามคืน แล้วกลับมาเปิดอีกวัน → ไป "วันนี้" ของวันใหม่ให้เอง (กันจัดลงวันเมื่อวานโดยไม่ตั้งใจ)
    await setClock('2026-09-29');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await toastHas('ขึ้นวันใหม่แล้ว');
    ok(await page.evaluate(() => S.date) === '2026-09-29' && await hasClass('#todayBtn', 'on'), 'ข้ามคืน → แสดงรายการของวันใหม่ให้เอง');
    await setClock(DATE);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction((d) => S.date === d, DATE);
    await idle();

    // ── ปุ่ม/ท่าปัดย้อนกลับของมือถือ: ปิดหน้าต่าง ไม่ออกจากหน้า ──
    await page.click('#addAbsentBtn');
    await page.waitForSelector('#pickModal.on');
    await page.goBack();
    await closed('pickModal');
    ok(page.url() === PAGE && await page.evaluate(() => S.plan.length) === 0, 'กดย้อนกลับขณะเปิดรายชื่อครู → ปิดหน้าต่าง (ยังอยู่หน้าเดิม)');

    await page.click('#absentList [data-act="addAbsent"]'); // ปุ่มใหญ่ในหน้าว่าง
    await page.click('#pickList button[data-name="ครูสมชาย ใจดี"]');
    const n = await page.$$eval('#absentList .slot', (x) => x.length);
    ok(n > 0, 'เพิ่มครูที่ไม่อยู่ → ดึงคาบจากตารางสอน ' + n + ' คาบ');
    ok(await page.$('#absentList select[data-f="sub"]') === null && await page.$$eval('#absentList .subpick', (x) => x.length) === n && await page.$$eval('#absentList [data-act="addAbsent"]', (x) => x.length) === 1,
      'แต่ละคาบมีปุ่มเลือกครูสอนแทน และมีปุ่มเพิ่มครูท้ายรายการ');
    const small = await smallTargets('#tab-plan, #actionBar, nav.tabbar');
    ok(small.length === 0, 'หน้าจัดสอนแทน: ที่แตะได้ทุกจุดไม่เล็กกว่า 44px' + (small.length ? ' — ' + small.join(', ') : ''));

    // ── เลือกครูสอนแทนเอง (รายชื่อครูที่ว่าง) ──
    await page.locator('#absentList .subpick').first().click();
    await page.waitForSelector('#subModal.on');
    const sub = await page.evaluate(() => ({
      ctx: document.querySelector('#subCtx').textContent,
      free: Array.prototype.map.call(document.querySelectorAll('#subList button[data-name]'), (b) => b.getAttribute('data-name')),
      first: document.querySelector('#subList button[data-name]').textContent,
      clearShown: getComputedStyle(document.querySelector('#subFoot')).display !== 'none',
    }));
    ok(sub.ctx.indexOf('คาบ ') === 0 && sub.ctx.indexOf('แทนครูสมชาย') > 0 && sub.free.length > 1 && sub.free.indexOf('ครูสมชาย ใจดี') < 0 && sub.first.indexOf('แนะนำ') >= 0 && !sub.clearShown,
      'แตะคาบ → รายชื่อครูที่ว่างในคาบนั้น (' + sub.free.length + ' คน) คนแรกมีป้าย “แนะนำ”');
    await page.click('#subList [data-toggle]');
    const busy = await page.$$eval('#subList button[disabled]', (b) => b.map((x) => x.textContent));
    ok(busy.some((t) => t.indexOf('ครูสมชาย') >= 0 && t.indexOf('ไม่อยู่วันนี้ (ลาป่วย)') >= 0) && busy.some((t) => t.indexOf('มีสอน ') >= 0), 'ครูที่ไม่ว่างแสดงเหตุผล (ไม่อยู่วันนี้ / มีสอน…) และเลือกไม่ได้');
    await shot('sub-picker.png');
    await page.click('#subList button[data-name="' + sub.free[1] + '"]');
    await closed('subModal');
    ok(await page.evaluate(() => S.plan[0].slots[0].sub) === sub.free[1] && await hasClass('#absentList .subpick', 'has') && (await page.textContent('#progress')).indexOf('จัดแล้ว 1/' + n) >= 0, 'เลือกครูสอนแทนเอง → คาบนั้นจัดแล้ว (1/' + n + ')');
    await page.locator('#absentList .subpick').first().click();
    await page.waitForSelector('#subModal.on');
    ok(await page.$eval('#subList button.cur', (b) => b.getAttribute('data-name')) === sub.free[1] && await page.isVisible('#subClearBtn'), 'เปิดซ้ำ → เห็นคนที่เลือกไว้ และมีปุ่มยกเลิกผู้สอนแทน');
    await page.click('#subClearBtn');
    await closed('subModal');
    ok(await page.evaluate(() => S.plan[0].slots[0].sub) === '' && (await page.textContent('#progress')).indexOf('จัดแล้ว 0/' + n) >= 0, 'ยกเลิกผู้สอนแทนของคาบได้');

    // ── พิมพ์ในช่องหนึ่งแล้วแตะช่องถัดไป: รายการต้องไม่ถูกสร้างใหม่ (ไม่งั้นช่องหลุดโฟกัส แป้นพิมพ์มือถือปิด) ──
    await page.click('#absentList [data-act="addSlot"]');
    await page.fill('#absentList input[data-f="room"]', 'ห้องสมุด');
    await page.click('#absentList input[data-f="subject"]');
    await page.keyboard.type('เวรประจำวัน');
    const typed = await page.evaluate(() => {
      const s = S.plan[0].slots[S.plan[0].slots.length - 1];
      return { room: s.room, subject: s.subject, focus: document.activeElement && document.activeElement.getAttribute('data-f') };
    });
    ok(typed.room === 'ห้องสมุด' && typed.subject === 'เวรประจำวัน' && typed.focus === 'subject', 'พิมพ์ห้องแล้วแตะช่องวิชาพิมพ์ต่อได้เลย (ช่องไม่หลุดโฟกัส)');
    await page.click('#absentList [data-act="rmSlot"]');

    // ── กันงานหาย: มีการแก้ไขที่ยังไม่บันทึก แล้วกดย้อนกลับ → ถามก่อนออก ──
    dialogs.length = 0;
    dialogMode = 'dismiss';
    await page.goBack();
    await page.waitForFunction(() => rearm === true);
    dialogMode = 'accept';
    ok(dialogs.length === 1 && dialogs[0].indexOf('confirm: มีการแก้ไขที่ยังไม่บันทึก') === 0 && page.url() === PAGE && await page.evaluate(() => S.dirty && S.plan.length === 1),
      'งานยังไม่บันทึก + กดย้อนกลับ → ถามก่อนออก; เลือกอยู่ต่อแล้วงานยังอยู่ครบ');

    await page.click('#autoBtn');
    ok((await page.textContent('#progress')).indexOf('จัดแล้ว ' + n + '/' + n) >= 0, 'จัดอัตโนมัติครบทุกคาบ');
    ok(await page.$$eval('#absentList .slot.bad', (x) => x.length) === 0, 'ไม่มีคาบที่ชนกัน');
    ok(await page.evaluate(() => guard && history.state && history.state.guard === 1), 'แตะหน้าจออีกครั้ง → ตั้งตัวกันออกใหม่');

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

    ok(await page.$('#sendLineBtn') === null, 'ไม่มีปุ่มส่งเข้ากลุ่ม (ไม่ใช้ push)');
    ok((await page.textContent('#previewModal .sheet-f')).indexOf('แจ้งตารางสอนแทน') >= 0, 'หน้าภาพบอกให้พิมพ์ แจ้งตารางสอนแทน ในกลุ่ม');
    // ไม่ต้องพิมพ์คำสั่งเอง: คัดลอก หรือเปิดไลน์พร้อมข้อความ
    await page.click('#copyCmdBtn');
    await toastHas('คัดลอก “แจ้งตารางสอนแทน” แล้ว');
    ok(await page.evaluate(() => navigator.clipboard.readText()) === 'แจ้งตารางสอนแทน', 'ปุ่มคัดลอกคำสั่ง → คลิปบอร์ดเป็นคำว่า แจ้งตารางสอนแทน');
    ok(await page.getAttribute('#lineOpenBtn', 'href') === 'https://line.me/R/share?text=' + encodeURIComponent('แจ้งตารางสอนแทน'), 'ปุ่มเปิดไลน์แนบคำสั่งไว้ให้');
    const smallP = await smallTargets('#previewModal');
    ok(smallP.length === 0, 'หน้าภาพ: ที่แตะได้ทุกจุดไม่เล็กกว่า 44px' + (smallP.length ? ' — ' + smallP.join(', ') : ''));
    await page.goBack(); // ย้อนกลับ = ปิดหน้าภาพ
    await closed('previewModal');
    ok(page.url() === PAGE && await hasClass('#dayState .pill', 'ok') && (await page.textContent('#saveBtn')).indexOf('ดูภาพ') >= 0, 'กดย้อนกลับ → ปิดหน้าภาพ; สถานะ “บันทึกแล้ว” ปุ่มเปลี่ยนเป็น ดูภาพ / แจ้งไลน์');
    for (const w of [360, 320]) {
      await page.setViewportSize({ width: w, height: 640 });
      ok(await page.evaluate(() => document.documentElement.scrollWidth) === w, 'หน้าจัดสอนแทนไม่มี scroll แนวนอนที่จอ ' + w + 'px');
    }
    await shot('plan-320.png');
    await page.setViewportSize({ width: 390, height: 844 });

    // ── หน้าครูไม่มีส่วนตั้งค่า LINE; ลิงก์ไปหน้าผู้ดูแลมีอยู่ ──
    await page.click('nav.tabbar button[data-tab="more"]');
    ok(await page.$('#lineBox') === null && await page.$('#tokenInput') === null, 'หน้าครูไม่มีฟอร์มตั้งค่า LINE');
    ok(await page.getAttribute('a[href="admin.html"]', 'href') === 'admin.html', 'มีลิงก์ไปหน้าผู้ดูแล');

    // ── หน้าผู้ดูแล: ต้องตั้ง/ใส่รหัสก่อน ──
    await page.goto(PAGE + 'admin.html');
    await page.waitForSelector('#setupBox', { state: 'visible' });
    ok(await page.isHidden('#adminBox'), 'ยังไม่ตั้งรหัส → เห็นแต่ฟอร์มตั้งรหัส ไม่เห็นส่วนผู้ดูแล');
    await page.fill('#newPw', 'abc');
    await page.fill('#newPw2', 'abc');
    await page.click('#setupBtn');
    await toastHas('อย่างน้อย 6');
    await page.fill('#newPw', 'secret1');
    await page.fill('#newPw2', 'secret1');
    await page.click('#setupBtn');
    await page.waitForSelector('#adminBox', { state: 'visible' });
    await idle();
    ok(true, 'ตั้งรหัสผู้ดูแลครั้งแรกแล้วเข้าสู่ระบบได้');

    await page.click('#logoutBtn');
    await page.waitForSelector('#loginBox', { state: 'visible' });
    ok(await page.isHidden('#adminBox') && (await page.$eval('#lineBox', (e) => e.innerHTML)) === '', 'ออกจากระบบ → ซ่อนส่วนผู้ดูแลและล้างข้อมูล');
    await page.fill('#loginPw', 'wrongpw');
    await page.click('#loginBox [data-show]');
    const pwShown = await page.getAttribute('#loginPw', 'type');
    await page.click('#loginBtn');
    await toastHas('ไม่ถูกต้อง');
    await idle();
    ok(await page.isHidden('#adminBox'), 'รหัสผิด → ไม่ให้เข้า');
    ok(pwShown === 'text' && await page.getAttribute('#loginPw', 'type') === 'password', 'ปุ่ม “แสดงรหัส” → เห็นรหัสที่พิมพ์ และกลับไปซ่อนเมื่อเปลี่ยนหน้าจอ');
    await page.fill('#loginPw', 'secret1');
    await page.click('#loginBtn');
    await page.waitForSelector('#adminBox', { state: 'visible' });
    await idle();
    ok(true, 'รหัสถูก → เข้าหน้าผู้ดูแล');
    await page.reload();
    await page.waitForSelector('#adminBox', { state: 'visible' });
    ok(true, 'รีเฟรชหน้าในแท็บเดิมยังอยู่ในระบบ (sessionStorage)');

    await page.fill('#tokenInput', 'tok');
    await page.click('#saveTokenBtn');
    await toastHas('เชื่อมบอท บอทสอนแทน');
    await idle();
    ok(true, 'บันทึก token → แสดงชื่อบอท');
    // ครูพิมพ์ในกลุ่ม (กลุ่มของบอท 2 กลุ่ม) → admin เห็นกลุ่ม/ชื่อไลน์ แล้วเลือกกลุ่มรับประกาศ + ผูกชื่อครู
    lineEvent([{ type: 'message', replyToken: 'r2', source: { type: 'group', groupId: 'G1', userId: 'U111' }, message: { type: 'text', text: 'สวัสดีครับ' } }]);
    lineEvent([{ type: 'message', replyToken: 'r2b', source: { type: 'group', groupId: 'GOTHER', userId: 'UX' }, message: { type: 'text', text: 'แจ้งตารางสอนแทน' } }]);
    __lineCalls.length = 0;
    await page.click('#loadLineBtn');
    await page.waitForFunction(() => document.querySelectorAll('#groupSel option').length === 3);
    await idle();
    ok((await page.textContent('#groupSel')).indexOf('กลุ่มครู G1') >= 0, 'หน้า admin แสดงกลุ่มที่บอทเห็น (พร้อมชื่อกลุ่ม)');
    await page.selectOption('#groupSel', 'G1');
    await toastHas('เลือกกลุ่มรับประกาศแล้ว');
    await idle();
    ok(await page.$eval('#groupSel', (e) => e.value) === 'G1', 'เลือกกลุ่มรับประกาศแล้ว');
    ok(await page.$('select[data-teacher]') === null, 'ไม่มีส่วนผูกชื่อครูกับไลน์');
    ok(await page.$eval('#lineBox input[readonly]', (i) => i.value) === API, 'Webhook URL = URL /exec ที่หน้าเว็บใช้อยู่');
    await page.click('#lineBox [data-copy="#hookUrl"]');
    await toastHas('คัดลอกแล้ว');
    ok(await page.evaluate(() => navigator.clipboard.readText()) === API, 'หน้า admin: ปุ่มคัดลอก Webhook URL');
    ok((await page.$eval('#cfgLine', (i) => i.value)) === "apiUrl: '" + API + "'" && await page.isVisible('#cfgHow'), 'หน้า admin สร้างบรรทัด apiUrl ให้ไปวางใน config.js');
    // ── นำเข้าตารางสอนจาก PDF (อ่านในเบราว์เซอร์ด้วย pdf.js → ตัวอย่าง → บันทึกลงชีต) ──
    if (pdfjsDir) {
      const before = rows_('ตารางสอน').filter((r) => r[0]).length;
      // ปุ่ม "เลือกไฟล์ PDF" (label) เปิดตัวเลือกไฟล์ของเครื่อง — ช่องเลือกไฟล์จริงถูกซ่อนไว้
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('label[for="impFile"]')]);
      await chooser.setFiles(path.join(ROOT, 'tests/fixtures/timetable-sample.pdf'));
      await page.waitForSelector('#impGo', { timeout: 30000 });
      const prev = await page.textContent('#impPreview');
      ok(/ตารางรายครู 2 · ตารางรายชั้น 3 · ข้าม \(ไม่ใช่ตาราง\) 1/.test(prev) && prev.indexOf('7 คาบ') >= 0 && prev.indexOf('2 ครู') >= 0, 'นำเข้า PDF: สรุปจำนวนหน้า/คาบ/ครู');
      ok(prev.indexOf('ตารางรายครูกับรายชั้นในไฟล์ไม่ตรงกัน') >= 0 && prev.indexOf('ครูวิรัตน์') >= 0, 'นำเข้า PDF: เตือนจุดที่ตารางรายชั้นขัดกับรายครู (หน้า ป.2 ชุดที่จงใจแก้)');
      ok(prev.indexOf('ครูสมศรี รักเรียน') >= 0 && (await page.$$eval('#impPreview td span.pill', (x) => x.filter((e) => e.textContent === 'เพิ่มใหม่').length)) === 2, 'นำเข้า PDF: ครูทั้งสองเป็น "เพิ่มใหม่" (ไม่มีในชีต)');
      await page.selectOption('#impView', 'ครูสมศรี รักเรียน');
      ok((await page.$$eval('#impPreview table', (t) => t[t.length - 1].textContent)).indexOf('ศิลปะ ดนตรี') >= 0, 'นำเข้า PDF: ตารางตัวอย่างรายครูแสดงวิชา');
      await page.locator('#impBox').scrollIntoViewIfNeeded();
      await shot('import-preview.png');
      ok(await page.evaluate(() => document.documentElement.scrollWidth) === 390, 'นำเข้า PDF: หน้าตัวอย่างไม่ล้นจอ 390px');
      const smallA = await smallTargets('.wrap');
      ok(smallA.length === 0, 'หน้า admin: ที่แตะได้ทุกจุดไม่เล็กกว่า 44px' + (smallA.length ? ' — ' + smallA.join(', ') : ''));
      await page.setViewportSize({ width: 320, height: 568 });
      ok(await page.evaluate(() => document.documentElement.scrollWidth) === 320, 'หน้า admin (รวมตัวอย่างนำเข้า) ไม่ล้นจอ 320px');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.check('#optDeact');
      await page.click('#impGo'); // confirm() ถูกตอบตกลงอัตโนมัติ
      await toastHas('นำเข้าแล้ว');
      await idle();
      const tt = rows_('ตารางสอน').filter((r) => r[0]);
      ok(tt.length === 7 && tt.every((r) => /^ครู(สมศรี รักเรียน|วิรัตน์ ขยันดี)$/.test(r[0])) && tt.some((r) => r[1] === 'พฤหัสบดี' && r[2] === 5 && r[3] === 'ชุมนุม' && r[4] === 'ป.2'), 'นำเข้า PDF: ตารางสอนในชีตถูกแทนที่ด้วย 7 คาบจากไฟล์ (เดิม ' + before + ')');
      ok(__book.getSheetByName('สำรองตารางสอน') && __book.getSheetByName('สำรองตารางสอน').getLastRow() === before + 1, 'นำเข้า PDF: สำรองตารางเดิมไว้');
      ok(teachers_().filter((t) => t.active).length === 2 && teachers_().some((t) => t.name === 'ครูสมศรี รักเรียน' && t.display === 'ครูสมศรี'), 'นำเข้า PDF: เพิ่มครูใหม่ + ปิดใช้งานครูตัวอย่าง');
      ok(periods_().length === 5 && periods_()[3].start === '12:30', 'นำเข้า PDF: เวลาคาบถูกแทนที่');
      ok(await page.isHidden('#impPreview') && (await page.textContent('#impStatus')).indexOf('นำเข้าเรียบร้อย') >= 0, 'นำเข้า PDF: หลังนำเข้าแสดงผลสำเร็จ');
    } else {
      console.log('  (ข้ามเทสต์นำเข้า PDF: ไม่พบ pdfjs-dist — npm i pdfjs-dist@3.11.174)');
    }

    await page.fill('#oldPw', 'secret1');
    await page.fill('#chPw', 'secret2');
    await page.fill('#chPw2', 'secret2');
    await page.click('#changePwBtn');
    await toastHas('เปลี่ยนรหัสแล้ว');
    ok(true, 'เปลี่ยนรหัสผู้ดูแลได้');
    await shot('admin.png');

    // ปิดแท็บผู้ดูแล (ล้าง session) แล้วเปิดใหม่ต้องใส่รหัส — จำลองด้วยการล้าง sessionStorage
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.waitForSelector('#loginBox', { state: 'visible' });
    ok(await page.isHidden('#adminBox'), 'เปิดใหม่โดยไม่มี session → ต้องใส่รหัส');

    await page.goto(PAGE);
    await idle();

    // ── แจ้งในกลุ่มด้วยคำสั่ง (reply) ──
    await page.click('nav.tabbar button[data-tab="plan"]');
    await page.click('#saveBtn'); // ไม่มีการแก้ไข → เปิดภาพเลย
    await page.waitForSelector('#previewModal.on');
    await page.waitForFunction(() => S.imgDrive);
    __lineCalls.length = 0;
    lineEvent([{ type: 'message', replyToken: 'r4', source: { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text: 'แจ้งตารางสอนแทน' } }]);
    const flexRep = __lineCalls.find((c) => c.path === '/v2/bot/message/reply').payload.messages;
    ok(flexRep.length === 1 && flexRep[0].type === 'flex', 'แจ้งตารางสอนแทน → การ์ด Flex (reply)');

    __lineCalls.length = 0;
    lineEvent([{ type: 'message', replyToken: 'r3', source: { type: 'group', groupId: 'G1', userId: 'U2' }, message: { type: 'text', text: 'สอนแทน' } }]);
    lineEvent([{ type: 'message', replyToken: 'r6', source: { type: 'group', groupId: 'GOTHER', userId: 'UX' }, message: { type: 'text', text: 'แจ้งตารางสอนแทน' } }]);
    ok(!__lineCalls.some((c) => c.path === '/v2/bot/message/reply'), 'คำอื่น และกลุ่มอื่น → บอทไม่ตอบ')

    await page.click('[data-close="previewModal"]');

    // ── สถิติ ──
    await page.click('nav.tabbar button[data-tab="stats"]');
    await page.fill('#statMonth', DATE.slice(0, 7));
    await page.waitForFunction(() => document.querySelectorAll('#statDates .dateitem').length === 1);
    ok(true, 'หน้าสถิติแสดงวันที่จัดสอนแทน');
    ok((await page.textContent('#monthName')).indexOf('กันยายน 2569') >= 0, 'หน้าสถิติแสดงเดือนเป็นภาษาไทย + พ.ศ.');
    await shot('stats.png');
    await page.click('#nextMonth');
    await idle();
    ok((await page.textContent('#monthName')).indexOf('ตุลาคม 2569') >= 0 && await page.$$eval('#statDates .dateitem', (x) => x.length) === 0, 'ปุ่ม › → เดือนถัดไป');
    await page.click('#prevMonth');
    await page.waitForFunction(() => document.querySelectorAll('#statDates .dateitem').length === 1);
    await idle();

    // ── กันงานหาย (ต่อ): แก้ไขแล้วกดย้อนกลับ ตอบ "ออก" → ออกจากหน้าได้ โดยถามครั้งเดียว ──
    await page.click('nav.tabbar button[data-tab="plan"]');
    await page.selectOption('#absentList select[data-f="reason"]', 'ลากิจ');
    ok(await page.evaluate(() => S.dirty && guard) && await hasClass('#dayState .pill', 'no'), 'แก้เหตุผลการลา → สถานะ “ยังไม่บันทึก”');
    dialogs.length = 0;
    await page.goBack();
    await page.waitForURL(/admin\.html$/);
    ok(dialogs.length === 1 && dialogs[0].indexOf('confirm: มีการแก้ไขที่ยังไม่บันทึก') === 0, 'กดย้อนกลับแล้วตอบออก → ออกจากหน้า (ถามครั้งเดียว ไม่มีกล่องถามซ้ำ)');

    ok(!log.api.some((c) => c.method === 'GET' && c.fn === 'getAdminData'), 'ฟังก์ชันผู้ดูแลไม่ถูกเรียกผ่าน GET');
    ok(!__lineCalls.some((c) => /message\/(push|multicast|broadcast)/.test(c.path)), 'ไม่มีการ push เลย');
    // ── ตั้ง URL ครั้งเดียวใน config.js: เครื่องใหม่ (localStorage ว่าง) ไม่ต้องกรอก ──
    globalThis.__configJs = "window.APP_CONFIG = { apiUrl: '" + API + "' };";
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('#schoolName').textContent.trim() === 'โรงเรียนตัวอย่าง');
    await idle();
    ok(await page.evaluate(() => localStorage.getItem('apiUrl') === null), 'config.js: โหลดข้อมูลได้โดยไม่ต้องกรอก URL (localStorage ว่าง)');
    await page.click('nav.tabbar button[data-tab="more"]');
    ok(await page.$eval('#apiUrlInput', (i) => i.readOnly && i.value) === API && await page.isHidden('#apiUrlSaveBtn'), 'config.js: ช่อง URL ถูกล็อก ไม่มีปุ่มบันทึก');
    await page.goto(PAGE + 'admin.html');
    await page.waitForSelector('#loginBox', { state: 'visible' });
    ok(await page.isHidden('#urlBox'), 'config.js: หน้า admin ไม่ขอ URL');
    await page.fill('#loginPw', 'secret2');
    await page.click('#loginBtn');
    await page.waitForSelector('#adminBox', { state: 'visible' });
    ok((await page.textContent('#cfgState')).indexOf('ตั้งไว้กลางแล้ว') >= 0 && await page.isHidden('#cfgHow'), 'config.js: หน้า admin แสดงว่าตั้งกลางแล้ว');
    globalThis.__configJs = "window.APP_CONFIG = { apiUrl: '' };";

    ok(log.preflight === 0, 'ไม่มี CORS preflight');
    ok(log.api.filter((c) => c.method === 'POST').every((c) => /^text\/plain/.test(c.contentType || '')), 'POST ทุกครั้งเป็น text/plain');
    ok(log.errors.length === 0, 'ไม่มี error ใน console' + (log.errors.length ? ': ' + log.errors.join(' | ') : ''));
    console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
  } catch (e) {
    console.error('ไม่ผ่าน: ' + e.message);
    if (log.errors.length) console.error(log.errors.join('\n'));
    try { const st = await page.textContent('#impStatus', { timeout: 500 }); if (st) console.error('สถานะนำเข้า PDF: ' + st); } catch (e2) { /* ไม่ได้อยู่หน้า admin */ }
    await shot('fail.png');
    process.exitCode = 1;
  } finally {
    await browser.close();
    pageSrv.close();
    apiSrv.close();
  }
})();
