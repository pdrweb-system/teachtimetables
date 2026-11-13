// ทดสอบตัวอ่านตารางสอนจาก PDF (timetable-import.js) กับ PDF จำลอง tests/fixtures/timetable-sample.pdf (ข้อมูลสมมติ)
// รัน: node tests/import.test.js   (ต้องมี pdfjs-dist: npm i pdfjs-dist@3.11.174 — ถ้าไม่มีจะทดสอบเฉพาะส่วนที่ไม่ใช้ PDF)
// ทดสอบกับไฟล์จริงของโรงเรียนได้ (ไม่ commit ไฟล์): REAL_PDF=/path/to/file.pdf node tests/import.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TI = require('../timetable-import.js');

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };

// ── ส่วนที่ไม่ใช้ PDF: ชื่อครู ──
ok(TI.cleanTeacher('นางสาวสมศรี รักเรียน') === 'ครูสมศรี รักเรียน', 'ตัดคำนำหน้า นางสาว → ครู');
ok(TI.cleanTeacher('นายวิรัตน์ ขยันดี') === 'ครูวิรัตน์ ขยันดี' && TI.cleanTeacher('ครูสมศรี') === 'ครูสมศรี' && TI.cleanTeacher('วิรัตน์') === 'ครูวิรัตน์', 'ชื่อทุกแบบลงท้ายเป็น ครู…');
const ex = ['ครูสมชาย ใจดี', 'ครูสมศรี', 'ครูมาลี ศรีสุข', 'ครูมาลี สุขใจ'];
ok(TI.matchTeacher('ครูสมชาย ใจดี', ex).how === 'exact', 'จับคู่ตรงตัว');
ok(TI.matchTeacher('ครูสมชายใจดี', ex).how === 'name' && TI.matchTeacher('นายสมชาย ใจดี', ex).name === 'ครูสมชาย ใจดี', 'จับคู่เมื่อตัดคำนำหน้า/ช่องว่าง');
ok(TI.matchTeacher('ครูสมศรี รักเรียน', ex).name === 'ครูสมศรี' && TI.matchTeacher('ครูสมศรี รักเรียน', ex).how === 'first', 'จับคู่จากชื่อต้นเมื่อมีคนเดียว');
ok(TI.matchTeacher('ครูมาลี ใจดี', ex) === null, 'ชื่อต้นซ้ำ 2 คน → ไม่เดา');
ok(TI.matchTeacher('ครูวิชัย', ex) === null, 'ไม่พบ → null');

let pdfjsPath = null;
try { pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.js', { paths: [process.cwd(), __dirname] }); } catch (e) { /* ไม่มี */ }

async function parseFile(buf) {
  const pdfjs = require(pdfjsPath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push(TI.parsePage(TI.fromPdfItems(tc.items)));
  }
  return pages;
}

// ข้อมูลต้นทางของไฟล์จำลอง (ตรงกับ ROWS ใน tests/fixtures/make_timetable_pdf.py) — หน้ารายครูใช้ชื่อวิชาแบบย่อ
const EXPECTED = [
  'ครูสมศรี รักเรียน|จันทร์|1|ภาษาไทย|ป.1/1', 'ครูสมศรี รักเรียน|จันทร์|2|คณิต|ป.2', 'ครูวิรัตน์ ขยันดี|จันทร์|1|ภาษาอังกฤษ|ป.2',
  'ครูวิรัตน์ ขยันดี|อังคาร|2|คณิต|ป.1/1', 'ครูสมศรี รักเรียน|พุธ|3|ศิลปะ ดนตรี|ป.1/1', 'ครูวิรัตน์ ขยันดี|พฤหัสบดี|5|ชุมนุม|ป.2',
  'ครูสมศรี รักเรียน|ศุกร์|4|หลักสูตรต้านทุจริต|ป.1/1',
].sort();
const line = (r) => [r.teacher, r.day, r.period, r.subject, r.room].join('|');

(async () => {
  if (!pdfjsPath) {
    console.log('  (ข้ามเทสต์ที่ใช้ PDF: ไม่พบ pdfjs-dist — npm i pdfjs-dist@3.11.174)');
    console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
    return;
  }
  const all = await parseFile(fs.readFileSync(path.join(__dirname, 'fixtures/timetable-sample.pdf')));
  ok(all.map((p) => p.kind).join() === 'class,class,teacher,teacher,none,class', 'ชนิดของแต่ละหน้า: ' + all.map((p) => p.kind).join());
  ok(all[0].room === 'ป.1/1' && all[1].room === 'ป.2', 'อ่านห้องจากหัวตารางรายชั้น');
  ok(all[2].owner === 'นางสาวสมศรี รักเรียน' && all[2].homeroom === '1/1', 'อ่านชื่อครูและชั้นประจำชั้นจากหัวตารางรายครู');
  ok(all[4].warnings.length === 0, 'หน้าปกไม่มีตาราง → ข้ามเงียบ ๆ');

  const good = all.slice(0, 5); // หน้า 1-5 (ไม่รวมหน้า 6 ที่จงใจให้ขัดกัน)
  let b = TI.build(good, { existingTeachers: [] });
  ok(b.source === 'teacher' && b.stats.teacherPages === 2 && b.stats.classPages === 2 && b.stats.skippedPages === 1, 'ใช้ตารางรายครู นับหน้าถูก: ' + JSON.stringify(b.stats));
  ok(JSON.stringify(b.rows.map(line).sort()) === JSON.stringify(EXPECTED), 'แถวที่อ่านได้ตรงกับข้อมูลต้นทางทุกช่อง (ข้าม PLC)\n  ได้:   ' + b.rows.map(line).sort().join(' ; ') + '\n  ควรได้: ' + EXPECTED.join(' ; '));
  ok(b.periods.length === 5 && b.periods[0].start === '08:30' && b.periods[3].start === '12:30' && b.periods[3].p === 4, 'คาบที่มีข้อมูลเรียงตามเวลา ข้ามช่วงพักเที่ยง (คาบ 4 = 12:30; คาบที่ไม่มีใครสอนเลยไม่ถูกนับ): ' + JSON.stringify(b.periods.map((p) => p.p + '@' + p.start)));
  ok(b.warnings.length === 0, 'ตารางรายชั้นกับรายครูตรงกัน → ไม่มีคำเตือน' + (b.warnings.length ? ': ' + b.warnings.join(' | ') : ''));
  ok(b.teachers.length === 2 && b.teachers[0].display === 'ครูสมศรี' && b.teachers[0].dept === 'ภาษาไทย' && b.teachers[0].how === 'new', 'ชื่อที่แสดง + เดากลุ่มสาระ (วิชาที่สอนบ่อยสุด ไม่นับชุมนุม/โฮมรูม)');

  const b2 = TI.build(good, { skipNoRoom: false, existingTeachers: [] });
  ok(b2.rows.filter((r) => r.subject === 'PLC' && r.room === '').length === 2 && b2.periods.length === 6 && b2.periods[5].start === '15:30', 'ไม่ข้ามช่องไม่มีห้อง → PLC เข้ามา และมีคาบ 15:30 เพิ่ม');

  const b3 = TI.build(good, { existingTeachers: ['ครูสมศรี', 'ครูตัวอย่าง'] });
  ok(b3.teachers[0].name === 'ครูสมศรี' && b3.teachers[0].how === 'first' && b3.rows.some((r) => r.teacher === 'ครูสมศรี'), 'ครูที่ตรงกับชีตใช้ชื่อในชีต');

  const b4 = TI.build(good.filter((p) => p.kind !== 'teacher'), { existingTeachers: [] });
  ok(b4.source === 'class' && b4.rows.length === EXPECTED.length && b4.rows.every((r) => r.teacher.indexOf('ครู') === 0 && r.room), 'มีแต่ตารางรายชั้น → อ่านครูจากช่อง ห้องจากหัวตาราง');
  ok(b4.rows.find((r) => r.room === 'ป.2' && r.day === 'จันทร์' && r.period === 2).teacher === 'ครูสมศรี' && b4.rows.find((r) => r.subject === 'คณิตศาสตร์'), 'รายชั้น: ครู/วิชา/คาบถูกช่อง');

  // หน้า 6 = รายชั้น ป.2 ที่ครูจันทร์ คาบ 2 เป็นครูวิรัตน์ แต่รายครูบอกครูสมศรี → ต้องเตือน
  const b5 = TI.build([all[0], all[5], all[2], all[3]], { existingTeachers: [] });
  ok(b5.warnings.length >= 2 && /ป\.2 วันจันทร์ 09:30.*ครูวิรัตน์.*ครูสมศรี/.test(b5.warnings.join('\n')), 'รายชั้น≠รายครู → เตือนจุดที่ขัดกัน: ' + b5.warnings.join(' | '));

  const b6 = TI.build([all[4]], { existingTeachers: [] });
  ok(b6.rows.length === 0 && b6.source === 'none', 'ไฟล์ไม่มีตาราง → ไม่มีแถว');

  if (process.env.REAL_PDF) {
    const real = TI.build(await parseFile(fs.readFileSync(process.env.REAL_PDF)), { existingTeachers: [] });
    console.log('  ไฟล์จริง: ' + real.rows.length + ' แถว, ' + real.teachers.length + ' ครู, คาบ ' + real.periods.length + ', คำเตือน ' + real.warnings.length);
    real.warnings.forEach((w) => console.log('    ' + w));
    ok(real.rows.length > 0, 'อ่านไฟล์จริงได้');
  }
  console.log('ผ่านทั้งหมด ' + passed + ' ข้อ');
})().catch((e) => { console.error('ไม่ผ่าน: ' + (e && e.message)); process.exit(1); });
