# สร้าง tests/fixtures/timetable-sample.pdf — PDF ตารางสอน "จำลอง" (ข้อมูลสมมติ) หน้าตาคล้ายไฟล์ที่ส่งออกจาก Word
# ไม่ต้องรันตอนทดสอบ (ไฟล์ผลลัพธ์ถูก commit ไว้แล้ว) — รันซ้ำเมื่ออยากแก้ข้อมูลตัวอย่าง:
#   pip install reportlab && python3 tests/fixtures/make_timetable_pdf.py
# หน้าในไฟล์: 1 ตารางรายชั้น ป.1/1 · 2 รายชั้น ป.2 · 3 รายครู นางสาวสมศรี รักเรียน · 4 รายครู นายวิรัตน์ ขยันดี · 5 ปก (ไม่มีตาราง)
#             6 รายชั้น ป.2 อีกชุดที่ "จงใจให้ขัดกับรายครู" (จันทร์ คาบ 2 เป็นครูวิรัตน์) ไว้ทดสอบการแจ้งเตือน
import re
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(TTFont('Thai', '/usr/share/fonts/truetype/freefont/FreeSerif.ttf'))
W, H = landscape(A4)
DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']
SLOTS = [('8.30', '9.30'), ('9.30', '10.30'), ('10.30', '11.30'), ('11.30', '12.30'),
         ('12.30', '13.30'), ('13.30', '14.30'), ('14.30', '15.30'), ('15.30', '16.30')]
TEACH = [('นางสาวสมศรี รักเรียน', 'ครูสมศรี', '1/1'), ('นายวิรัตน์ ขยันดี', 'ครูวิรัตน์', '2')]
# (วัน, คาบ 1-6, ครู, วิชาในหน้ารายครู, วิชาในหน้ารายชั้น, ห้อง)
ROWS = [
    (0, 1, 0, 'ภาษาไทย', 'ภาษาไทย', 'ป.1/1'), (0, 2, 0, 'คณิต', 'คณิตศาสตร์', 'ป.2'),
    (0, 1, 1, 'ภาษาอังกฤษ', 'ภาษาอังกฤษ', 'ป.2'), (1, 2, 1, 'คณิต', 'คณิตศาสตร์', 'ป.1/1'),
    (2, 3, 0, 'ศิลปะ ดนตรี', 'ศิลปะ ดนตรี', 'ป.1/1'), (3, 5, 1, 'ชุมนุม', 'ชุมนุม', 'ป.2'),
    (4, 4, 0, 'หลักสูตรต้านทุจริต', 'หลักสูตรต้านทุจริต', 'ป.1/1'),
]
PLC = [(0, 0), (2, 0)]  # (วัน, ครู) ช่อง 15.30-16.30 ที่ไม่มีห้อง
# คาบ 1-3 = คอลัมน์ 0-2, คอลัมน์ 3 = พักเที่ยง, คาบ 4-6 = คอลัมน์ 4-6, คอลัมน์ 7 = 15.30-16.30 (เฉพาะรายครู)
COL_OF = {1: 0, 2: 1, 3: 2, 4: 4, 5: 5, 6: 6}


def frags(c, text, cx, y, size=11):
    """วาดข้อความทีละชิ้น (เหมือน Word ที่แตกเป็นหลายส่วน): แยกที่ช่องว่าง และแยก "ป.1/1" เป็น ป.1 + / + 1"""
    parts = []
    for tok in re.split(r'( )', text):
        parts += re.split(r'(/)', tok) if re.match(r'^[ปมอ]\.\d', tok) else [tok]
    parts = [p for p in parts if p != '']
    total = sum(pdfmetrics.stringWidth(p, 'Thai', size) for p in parts)
    x = cx - total / 2
    c.setFont('Thai', size)
    for p in parts:
        c.drawString(x, y, p)
        x += pdfmetrics.stringWidth(p, 'Thai', size)


def table(c, ncols, cell_fn, plc_fn=None, y_top=470):
    xs = [70, 150] + [150 + (i + 1) * (W - 70 - 150 - 60) / ncols for i in range(ncols)]
    xs = [70, 150] + [150 + (i + 1) * ((W - 60 - 150) / ncols) for i in range(ncols)]
    rowh = 48
    # หัวตาราง
    c.rect(70, y_top, W - 130, 24)
    frags(c, 'วัน / เวลา', 110, y_top + 8)
    for k in range(ncols):
        a, b = SLOTS[k]
        cx = (xs[k + 1] + xs[k + 2]) / 2 if False else 150 + (k + 0.5) * ((W - 60 - 150) / ncols)
        frags(c, '%s - %s' % (a, b), cx, y_top + 8, 10)
    colw = (W - 60 - 150) / ncols
    for r in range(5):
        top = y_top - r * rowh
        c.rect(70, top - rowh, W - 130, rowh)
        frags(c, 'วัน' + DAYS[r], 110, top - rowh / 2 - 4, 11)
        for k in range(ncols):
            cx = 150 + (k + 0.5) * colw
            if k == 3:
                if r == 0:
                    c.saveState(); c.translate(cx + 5, y_top - rowh * 2.5); c.rotate(90)
                    c.setFont('Thai', 11); c.drawCentredString(0, 0, 'พักรับประทานอาหารกลางวัน'); c.restoreState()
                continue
            lines = cell_fn(r, k)
            if lines:
                frags(c, lines[0], cx, top - rowh / 2 + 6, 11)
                frags(c, lines[1], cx, top - rowh / 2 - 12, 11)
    for k in range(ncols + 1):
        c.line(150 + k * colw, y_top, 150 + k * colw, y_top - 5 * rowh)


def title(c, lines):
    c.setFont('Thai', 14)
    for i, t in enumerate(lines):
        c.drawCentredString(W / 2, 520 - i * 22, t)


c = canvas.Canvas('tests/fixtures/timetable-sample.pdf', pagesize=(W, H))


def class_page(room, mutate=None):
    num = room.replace('ป.', '')
    title(c, ['ตารางเรียนชั้นประถมศึกษาปีที่ %s   ภาคเรียนที่ 1   ปีการศึกษา 2569' % num])
    def cell(r, k):
        p = {0: 1, 1: 2, 2: 3, 4: 4, 5: 5, 6: 6}.get(k)
        for (d, pp, t, s, cs, rm) in ROWS:
            if d == r and pp == p and rm == room:
                if mutate and mutate == (room, d, pp): t = 1
                return [cs, TEACH[t][1]]
        return None
    table(c, 7, cell, y_top=480)
    c.showPage()


def teacher_page(ti):
    full, short, home = TEACH[ti]
    title(c, ['ตารางสอน %s   ภาคเรียนที่ 1   ปีการศึกษา 2569' % full, 'จำนวน 20 ชั่วโมง/สัปดาห์   ครูประจำชั้นประถมศึกษาปีที่ %s' % home])
    def cell(r, k):
        if k == 7:
            return ['PLC', ''] if (r, ti) in PLC else None
        p = {0: 1, 1: 2, 2: 3, 4: 4, 5: 5, 6: 6}.get(k)
        for (d, pp, t, s, cs, rm) in ROWS:
            if d == r and pp == p and t == ti:
                return [s, rm]
        return None
    table(c, 8, cell, y_top=480)
    c.setFont('Thai', 12)
    c.drawString(120, 150, 'ผู้อำนวยการโรงเรียน')
    c.drawString(600, 150, 'ครูผู้สอน (%s)' % full)
    c.showPage()


class_page('ป.1/1')
class_page('ป.2')
teacher_page(0)
teacher_page(1)
c.setFont('Thai', 20); c.drawCentredString(W / 2, H / 2, 'ปก — โรงเรียนตัวอย่าง'); c.showPage()
class_page('ป.2', mutate=('ป.2', 0, 2))
c.save()
print('wrote tests/fixtures/timetable-sample.pdf')
