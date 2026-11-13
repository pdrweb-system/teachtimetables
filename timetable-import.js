/* อ่านตารางสอนจากข้อความของ PDF (ตำแหน่ง x,y จาก pdf.js) → แถวสำหรับชีต "ตารางสอน"
 *
 * ใช้ได้ 2 แบบของไฟล์ PDF (ที่เลือกข้อความได้ — เช่นส่งออกจาก Word/Excel; PDF สแกนอ่านไม่ได้):
 *   - ตารางรายครู : หัว "ตารางสอน <ชื่อครู> …" ช่องละ "วิชา + ห้อง"
 *   - ตารางรายชั้น: หัว "ตารางเรียนชั้นประถมศึกษาปีที่ 1/1 …" ช่องละ "วิชา + ครู"
 * หน้าที่ไม่ใช่ตาราง (ปก ฯลฯ) ถูกข้าม ถ้ามีรายครูจะใช้รายครู (รายชั้นเป็นข้อมูลซ้ำ)
 *
 * ไม่ผูกกับ DOM — ใช้ในหน้าเว็บ (window.TimetableImport) และในเทสต์ Node (module.exports)
 * โค้ดเขียนแบบ ES5 ให้เหมือนส่วนอื่นของหน้าเว็บ
 *
 * รูปแบบ item ที่รับเข้า: { str, x, y, w, h, rot } (จาก pdf.js textContent: x=transform[4], y=transform[5],
 * w=width, h=height, rot=ข้อความเอียง/แนวตั้ง) — y มากอยู่บน
 */
(function (root) {
  'use strict';

  var DAY_NAMES = { 'จันทร์': 'จันทร์', 'อังคาร': 'อังคาร', 'พุธ': 'พุธ', 'พฤหัสบดี': 'พฤหัสบดี', 'พฤหัส': 'พฤหัสบดี',
    'ศุกร์': 'ศุกร์', 'เสาร์': 'เสาร์', 'อาทิตย์': 'อาทิตย์' };
  var DAY_RE = /^(?:วัน)?\s*(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)$/;
  var ROOM_RE = /^[ปมอ]\.?\s*\d+(?:\s*\/\s*\d+)?$/;
  var TITLE_RE = /^(?:นางสาว|นาง|นาย|น\.ส\.|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.|ดร\.|ครู|อาจารย์|อ\.)\s*/;
  // วิชา/กิจกรรมที่ไม่ใช่กลุ่มสาระ — ไม่นับตอนเดากลุ่มสาระของครู
  var NON_ACADEMIC = /^(?:homeroom|โฮมรูม|plc|ชุมนุม|แนะแนว|สวดมนต์|ลูกเสือ|เนตรนารี|กิจกรรม.*|หน้าที่.*|.*ต้านทุจริต)$/i;

  function trim(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^ | $/g, ''); }

  /* ───────── ส่วนที่ 1: อ่านทีละหน้า ───────── */

  // รวมชิ้นข้อความในบรรทัดเดียวกัน (เรียงซ้ายไปขวา) — เว้นวรรคเมื่อช่องว่างเกิน 2.5pt
  function lineText(items) {
    var arr = items.slice().sort(function (a, b) { return a.x - b.x; });
    var out = '';
    for (var i = 0; i < arr.length; i++) {
      if (i > 0) {
        var gap = arr[i].x - (arr[i - 1].x + arr[i - 1].w);
        if (gap > 2.5) out += ' ';
      }
      out += arr[i].str;
    }
    return trim(out);
  }

  // จัดกลุ่มเป็นบรรทัดตามค่า y (ใกล้กันไม่เกิน tol) — คืน [{y, items}] เรียงจากบนลงล่าง
  function toLines(items, tol) {
    var arr = items.slice().sort(function (a, b) { return b.y - a.y; });
    var lines = [];
    arr.forEach(function (it) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    return lines;
  }

  function timeTokens(it) {
    var out = [];
    var re = /(\d{1,2})[.:](\d{2})/g, m;
    var len = it.str.length || 1;
    while ((m = re.exec(it.str))) {
      var x0 = it.x + it.w * (m.index / len);
      var x1 = it.x + it.w * ((m.index + m[0].length) / len);
      out.push({ h: +m[1], m: +m[2], x0: x0, x1: x1, y: it.y });
    }
    return out;
  }
  function hhmm(h, m) { return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }

  function roomPrefix(kind) { return kind.indexOf('ประถม') >= 0 ? 'ป.' : (kind.indexOf('มัธยม') >= 0 ? 'ม.' : 'อ.'); }
  function normRoom(s) { return trim(s).replace(/\s*\/\s*/g, '/').replace(/^([ปมอ])\.?\s*(\d)/, '$1.$2'); }

  /** อ่านหนึ่งหน้า → { kind: 'teacher'|'class'|'none', owner, room, homeroom, cells[], warnings[] } */
  function parsePage(rawItems) {
    var res = { kind: 'none', owner: '', room: '', homeroom: '', cells: [], warnings: [] };
    var items = rawItems.filter(function (it) { return trim(it.str) !== '' && it.w > 0; });
    if (!items.length) return res;
    var flat = items.filter(function (it) { return !it.rot; });
    var rotated = items.filter(function (it) { return it.rot; });

    // 1) หัวตาราง
    var lines = toLines(flat, 3);
    var texts = lines.map(function (l) { return { y: l.y, text: lineText(l.items) }; });
    var m;
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i].text;
      if (res.kind === 'none' && /^ตารางสอน\s+/.test(t)) {
        res.kind = 'teacher';
        res.owner = trim(t.replace(/^ตารางสอน\s+/, '').replace(/\s*(ภาคเรียน|ภาคการศึกษา|ปีการศึกษา).*$/, ''));
      } else if (res.kind === 'none' && /^ตารางเรียน/.test(t)) {
        m = /(ประถมศึกษา|มัธยมศึกษา|อนุบาล)\S*\s*ปีที่\s*(\d+(?:\s*\/\s*\d+)?)/.exec(t);
        if (m) { res.kind = 'class'; res.room = roomPrefix(m[1]) + trim(m[2]).replace(/\s*\/\s*/g, '/'); }
      }
      m = /ครูประจำชั้น\S*\s*ปีที่\s*(\d+(?:\s*\/\s*\d+)?)/.exec(t);
      if (m && !res.homeroom) res.homeroom = trim(m[1]).replace(/\s*\/\s*/g, '/');
    }
    if (res.kind === 'none') return res;

    // 2) หัวคอลัมน์ = บรรทัดที่มีเวลาหลายค่า (เริ่ม–สิ้นสุด เรียงเป็นคู่)
    var best = null;
    lines.forEach(function (l) {
      var toks = [];
      l.items.forEach(function (it) { toks = toks.concat(timeTokens(it)); });
      if (toks.length >= 4 && (!best || toks.length > best.toks.length)) best = { y: l.y, toks: toks };
    });
    if (!best) { res.warnings.push('ไม่พบแถวเวลาของตาราง'); res.kind = 'none'; return res; }
    best.toks.sort(function (a, b) { return a.x0 - b.x0; });
    if (best.toks.length % 2) { res.warnings.push('จำนวนเวลาในหัวตารางเป็นเลขคี่ — อ่านคอลัมน์สุดท้ายไม่ได้'); best.toks.pop(); }
    var cols = [];
    for (var c = 0; c + 1 < best.toks.length; c += 2) {
      var a = best.toks[c], b = best.toks[c + 1];
      cols.push({ start: hhmm(a.h, a.m), end: hhmm(b.h, b.m), x0: a.x0, x1: b.x1, mid: (a.x0 + b.x1) / 2, brk: false });
    }
    if (cols.length < 2) { res.warnings.push('พบคอลัมน์เวลาน้อยเกินไป'); res.kind = 'none'; return res; }
    var firstLeft = cols[0].x0;
    cols.forEach(function (col, k) {
      var prev = k > 0 ? cols[k - 1].mid : col.mid - (cols[1].mid - cols[0].mid);
      var next = k < cols.length - 1 ? cols[k + 1].mid : col.mid + (cols[k].mid - cols[k - 1].mid);
      col.left = (prev + col.mid) / 2;
      col.right = (col.mid + next) / 2;
    });
    function colOf(x) {
      for (var k = 0; k < cols.length; k++) if (x >= cols[k].left && x < cols[k].right) return k;
      return -1;
    }

    // 3) ป้ายวัน (ซ้ายสุด) → แถว
    var days = [];
    flat.forEach(function (it) {
      var dm = DAY_RE.exec(trim(it.str));
      if (dm && it.x < firstLeft && it.y < best.y) days.push({ name: DAY_NAMES[dm[1]], y: it.y });
    });
    days.sort(function (p, q) { return q.y - p.y; });
    if (!days.length) { res.warnings.push('ไม่พบป้ายวัน (จันทร์–ศุกร์) ในตาราง'); res.kind = 'none'; return res; }
    var step = days.length > 1 ? (days[0].y - days[days.length - 1].y) / (days.length - 1) : 50;
    days.forEach(function (d, k) {
      d.top = k === 0 ? d.y + step / 2 : (days[k - 1].y + d.y) / 2;
      d.bottom = k === days.length - 1 ? d.y - step / 2 : (d.y + days[k + 1].y) / 2;
    });
    function rowOf(y) {
      for (var k = 0; k < days.length; k++) if (y <= days[k].top && y > days[k].bottom) return k;
      return -1;
    }

    // 4) ข้อความแนวตั้ง (เช่น "พักรับประทานอาหารกลางวัน") = คอลัมน์พัก
    rotated.forEach(function (it) { var k = colOf(it.x + 6); if (k < 0) k = colOf(it.x); if (k >= 0) cols[k].brk = true; });

    // 5) แจกข้อความลงช่อง
    var grid = {};
    flat.forEach(function (it) {
      if (it.y >= best.y - 1) return;
      if (DAY_RE.test(trim(it.str)) && it.x < firstLeft) return;
      var k = colOf(it.x + it.w / 2), r = rowOf(it.y);
      if (k < 0 || r < 0 || cols[k].brk) return;
      var key = r + ':' + k;
      (grid[key] = grid[key] || []).push(it);
    });
    Object.keys(grid).forEach(function (key) {
      var rc = key.split(':'), r = +rc[0], k = +rc[1];
      var cl = toLines(grid[key], 3).map(function (l) { return lineText(l.items); }).filter(function (s) { return s; });
      if (!cl.length) return;
      res.cells.push({ day: days[r].name, start: cols[k].start, end: cols[k].end, lines: cl });
    });
    res.columns = cols.map(function (c) { return { start: c.start, end: c.end, brk: c.brk }; });
    return res;
  }

  /* ───────── ส่วนที่ 2: รวมทุกหน้า → แถวตารางสอน ───────── */

  function cleanTeacher(raw) {
    var s = trim(raw).replace(/^ครู\s*/, 'ครู');
    if (!s) return '';
    if (/^(ครู|อาจารย์|อ\.|นาย|นาง|นางสาว|น\.ส\.|ว่าที่)/.test(s)) {
      // รูปแบบ "นางสาวสมศรี รักเรียน" → "ครูสมศรี รักเรียน" (ใช้คำว่า ครู นำหน้าให้เหมือนข้อมูลตัวอย่าง)
      return 'ครู' + s.replace(TITLE_RE, '').replace(/^\s+/, '');
    }
    return 'ครู' + s;
  }
  function displayOf(name) {
    var rest = name.replace(/^ครู/, '');
    return 'ครู' + (rest.split(' ')[0] || rest);
  }
  /** คีย์เปรียบเทียบชื่อ: ตัดคำนำหน้ากับช่องว่าง */
  function nameKey(s) { return trim(s).replace(TITLE_RE, '').replace(/\s+/g, ''); }
  function firstKey(s) { return trim(s).replace(TITLE_RE, '').split(' ')[0] || ''; }

  /**
   * จับคู่ชื่อที่ได้จาก PDF กับชื่อครูที่มีในชีต
   * exact = ตรงทุกตัวอักษร, name = ตรงกันเมื่อตัดคำนำหน้า/ช่องว่าง, first = ตรงชื่อต้นและมีคนเดียว
   */
  function matchTeacher(name, existing) {
    var i, k = nameKey(name), f = firstKey(name), hits = [];
    for (i = 0; i < existing.length; i++) if (existing[i] === name) return { name: existing[i], how: 'exact' };
    for (i = 0; i < existing.length; i++) if (nameKey(existing[i]) === k) return { name: existing[i], how: 'name' };
    for (i = 0; i < existing.length; i++) if (firstKey(existing[i]) === f && f) hits.push(existing[i]);
    if (hits.length === 1) return { name: hits[0], how: 'first' };
    return null;
  }

  /**
   * pages: ผลของ parsePage ของทุกหน้า
   * opts: { skipNoRoom (ข้ามช่องที่ไม่มีห้อง เช่น PLC — ค่าเริ่ม true), existingTeachers: [ชื่อในชีต] }
   * คืน { source, rows[], teachers[], periods[], warnings[], stats }
   */
  function build(pages, opts) {
    opts = opts || {};
    var skipNoRoom = opts.skipNoRoom !== false;
    var existing = opts.existingTeachers || [];
    var warnings = [];
    var teacherPages = pages.filter(function (p) { return p.kind === 'teacher'; });
    var classPages = pages.filter(function (p) { return p.kind === 'class'; });
    var src = teacherPages.length ? teacherPages : classPages;
    var source = teacherPages.length ? 'teacher' : (classPages.length ? 'class' : 'none');
    pages.forEach(function (p) { (p.warnings || []).forEach(function (w) { warnings.push(w); }); });

    var raw = [];   // { teacher, day, start, end, subject, room }
    var slotUse = {};
    src.forEach(function (p) {
      p.cells.forEach(function (cell) {
        var lines = cell.lines, subject = '', room = '', teacher = '';
        if (p.kind === 'teacher') {
          teacher = cleanTeacher(p.owner);
          var last = lines[lines.length - 1];
          if (lines.length >= 2 && ROOM_RE.test(last)) { room = normRoom(last); subject = lines.slice(0, -1).join(' '); }
          else if (lines.length === 1 && ROOM_RE.test(lines[0])) { room = normRoom(lines[0]); subject = ''; }
          else { subject = lines.join(' '); }
          if (!room && skipNoRoom) return;
          if (!subject) warnings.push(teacher + ' วัน' + cell.day + ' ' + cell.start + ': ช่องมีแต่ห้อง ไม่มีชื่อวิชา');
        } else {
          room = p.room;
          if (lines.length >= 2) { teacher = cleanTeacher(lines[lines.length - 1]); subject = lines.slice(0, -1).join(' '); }
          else { subject = lines[0]; warnings.push(p.room + ' วัน' + cell.day + ' ' + cell.start + ': ช่อง "' + subject + '" ไม่มีชื่อครู — ข้าม'); return; }
        }
        slotUse[cell.start + '-' + cell.end] = 1;
        raw.push({ teacher: teacher, day: cell.day, start: cell.start, end: cell.end, subject: subject, room: room });
      });
    });

    // ไฟล์ที่มีทั้งรายครูและรายชั้น: เทียบสองชุดว่าตรงกัน (ห้อง+วัน+เวลา → ครูคนเดียวกัน) ถ้าไม่ตรง = ไฟล์เองขัดกัน
    if (teacherPages.length && classPages.length) {
      var tmap = {}, cmap = {}, roomsInClass = {};
      raw.forEach(function (r) {
        if (!r.room) return;
        var k = r.room + '|' + r.day + '|' + r.start + '-' + r.end;
        (tmap[k] = tmap[k] || []).push(firstKey(r.teacher));
      });
      classPages.forEach(function (p) {
        roomsInClass[p.room] = 1;
        p.cells.forEach(function (cell) {
          if (cell.lines.length < 2) return;
          cmap[p.room + '|' + cell.day + '|' + cell.start + '-' + cell.end] = firstKey(cleanTeacher(cell.lines[cell.lines.length - 1]));
        });
      });
      var diffs = [];
      Object.keys(cmap).forEach(function (k) {
        var have = tmap[k] || [];
        if (have.indexOf(cmap[k]) < 0) diffs.push(k.split('|')[0] + ' วัน' + k.split('|')[1] + ' ' + k.split('|')[2].split('-')[0] + ': ตารางรายชั้นเป็นครู' + cmap[k] + ' แต่ตารางรายครู' + (have.length ? 'เป็นครู' + have.join('/') : 'ไม่มี'));
      });
      Object.keys(tmap).forEach(function (k) {
        if (roomsInClass[k.split('|')[0]] && !(k in cmap)) diffs.push(k.split('|')[0] + ' วัน' + k.split('|')[1] + ' ' + k.split('|')[2].split('-')[0] + ': ตารางรายครูมีครู' + tmap[k].join('/') + ' แต่ตารางรายชั้นว่าง');
      });
      if (diffs.length) {
        warnings.push('ตารางรายครูกับรายชั้นในไฟล์ไม่ตรงกัน ' + diffs.length + ' จุด (ตรวจไฟล์ต้นฉบับ):');
        diffs.slice(0, 15).forEach(function (d) { warnings.push('  • ' + d); });
        if (diffs.length > 15) warnings.push('  • …และอีก ' + (diffs.length - 15) + ' จุด');
      }
    }

    // คาบ = ช่วงเวลาที่มีข้อมูลจริง เรียงตามเวลาเริ่ม (คอลัมน์พักที่ไม่มีข้อมูลจึงไม่ถูกนับเป็นคาบ)
    var slots = Object.keys(slotUse).map(function (k) { var a = k.split('-'); return { start: a[0], end: a[1] }; })
      .sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); });
    var periods = slots.map(function (s, i) { return { p: i + 1, start: s.start, end: s.end }; });
    var pOf = {};
    periods.forEach(function (s) { pOf[s.start + '-' + s.end] = s.p; });

    var rows = [], seen = {}, tinfo = {}, order = [];
    raw.forEach(function (r) {
      var mt = matchTeacher(r.teacher, existing);
      var name = mt ? mt.name : r.teacher;
      var key = name + '|' + r.day + '|' + pOf[r.start + '-' + r.end];
      if (seen[key]) { warnings.push(name + ' วัน' + r.day + ' คาบ ' + pOf[r.start + '-' + r.end] + ': มีมากกว่า 1 ช่อง (ใช้ช่องแรก)'); return; }
      seen[key] = 1;
      rows.push({ teacher: name, day: r.day, period: pOf[r.start + '-' + r.end], subject: r.subject, room: r.room });
      if (!tinfo[name]) { tinfo[name] = { name: name, found: r.teacher, how: mt ? mt.how : 'new', display: displayOf(r.teacher), rows: 0, subjects: {} }; order.push(name); }
      tinfo[name].rows++;
      if (r.subject && !NON_ACADEMIC.test(r.subject)) tinfo[name].subjects[r.subject] = (tinfo[name].subjects[r.subject] || 0) + 1;
    });
    var teachers = order.map(function (n) {
      var t = tinfo[n], best = '', bc = 0;
      Object.keys(t.subjects).forEach(function (s) { if (t.subjects[s] > bc) { best = s; bc = t.subjects[s]; } });
      return { name: n, found: t.found, how: t.how, display: t.display, dept: best, rows: t.rows };
    });
    var dispCount = {};
    teachers.forEach(function (t) { if (t.how === 'new') dispCount[t.display] = (dispCount[t.display] || 0) + 1; });
    Object.keys(dispCount).forEach(function (d) { if (dispCount[d] > 1) warnings.push('ชื่อที่แสดง "' + d + '" ซ้ำกัน ' + dispCount[d] + ' คน — แก้ในชีต "ครู" ให้ต่างกัน'); });

    return {
      source: source, rows: rows, teachers: teachers, periods: periods, warnings: warnings,
      stats: { teacherPages: teacherPages.length, classPages: classPages.length, skippedPages: pages.length - teacherPages.length - classPages.length },
    };
  }

  /** แปลง textContent.items ของ pdf.js เป็น item ที่ parsePage ต้องการ */
  function fromPdfItems(items) {
    return items.map(function (it) {
      var t = it.transform;
      return { str: it.str, x: t[4], y: t[5], w: it.width, h: it.height, rot: Math.abs(t[1]) > 0.1 || Math.abs(t[2]) > 0.1 };
    });
  }

  var api = { parsePage: parsePage, build: build, matchTeacher: matchTeacher, fromPdfItems: fromPdfItems, cleanTeacher: cleanTeacher };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimetableImport = api;
})(typeof window !== 'undefined' ? window : this);
