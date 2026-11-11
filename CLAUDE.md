# ระบบจัดสอนแทน (teachtimetables) — สรุปโครงการสำหรับทำต่อ

ระบบจัดครูสอนแทนสำหรับโรงเรียน ใช้งานบนมือถือ ฐานข้อมูลฟรี (Google Sheets) สร้างภาพตารางสอนแทน และส่งเข้ากลุ่มไลน์พร้อม @แท็กชื่อครูผู้สอนแทน
ภาษา UI และข้อความทั้งหมดเป็นภาษาไทย — คงไว้เป็นภาษาไทยเสมอ

## ความต้องการตั้งต้น (จากผู้ใช้)
1. จัดสอนแทนสำหรับใช้ในโรงเรียน ใช้งานผ่านโทรศัพท์ได้ ใช้งานง่าย
2. บันทึกตารางสอนแทนเป็นภาพได้
3. ส่งเข้ากลุ่มไลน์ พร้อมแท็กชื่อสมาชิกที่มีรายชื่อสอนแทน + ตารางสอน
4. เน้นเก็บฐานข้อมูลแบบฟรี
5. (เพิ่มภายหลัง) ไม่ให้มีแถบเตือน "แอปพลิเคชันนี้สร้างโดยผู้ใช้ Google Apps Script" → ย้ายหน้าเว็บไป GitHub Pages

## สถาปัตยกรรม

```
มือถือครู ──► GitHub Pages: index.html (UI ทั้งหมด, ไฟล์เดียว)
                 │ fetch GET  ?fn=&args=          (อ่านอย่างเดียว)
                 │ fetch POST {"fn","args"} text/plain (ต้องมี PIN)
                 ▼
            Apps Script Web app /exec  (apps-script/Code.gs = JSON API)
                 │  ├─ Google Sheets  (ฐานข้อมูล 7 ชีต)
                 │  ├─ Google Drive   (เก็บภาพ JPG แชร์สาธารณะ → URL ให้ LINE)
                 │  └─ LINE Messaging API (push / reply / profile)
LINE ──webhook POST {destination,events}──► /exec เดียวกัน (doPost แยกด้วย body.events)
```

- Repo: `pdrweb-system/teachtimetables` (branch `main`, GitHub Pages ที่ root) → `https://pdrweb-system.github.io/teachtimetables/`
- Apps Script ผูกกับ Google Sheet ของผู้ใช้ (container-bound), Deploy: Execute as **Me**, Access **Anyone**

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (HTML+CSS+JS ไฟล์เดียว, ไม่มี build step) — ขึ้น GitHub Pages |
| `apps-script/Code.gs` | Backend JSON API + LINE webhook — **คัดลอกไปวางใน Apps Script เอง** (ไม่ได้ deploy อัตโนมัติจาก repo) |
| `tests/gasmock.js` | Mock ของ SpreadsheetApp/DriveApp/UrlFetchApp/ฯลฯ ในหน่วยความจำ ให้รัน Code.gs ใน Node ได้ |
| `tests/api.test.js` | ทดสอบ API ผ่าน doGet/doPost แบบเดียวกับที่ index.html เรียก — `node tests/api.test.js` |
| `docs/SETUP-legacy-htmlservice.md` | คู่มือติดตั้งเวอร์ชันเดิม (HtmlService) — ส่วน LINE/ชีตยังใช้ได้ ส่วน Deploy ให้ดูหัวข้อด้านล่างแทน |
| `docs/sample-output.jpg` | ตัวอย่างภาพตารางสอนแทนที่ระบบสร้าง |

## สถานะปัจจุบัน

**เสร็จแล้ว**
- เวอร์ชันแรก (Apps Script HtmlService: `Code.gs` + `Index.html`) ทำครบทุกฟีเจอร์ ทดสอบด้วย mock แล้ว
- แปลงเป็น GitHub Pages + API: `index.html` push ขึ้น repo แล้ว (commit `4cc1957`, 2026-09-27) — แทน `google.script.run` ด้วย `fetch()` และมีช่องกรอก URL API ในแท็บตั้งค่า
- `apps-script/Code.gs` เวอร์ชัน API อยู่ในโฟลเดอร์นี้ ผ่าน `tests/api.test.js` 19 ข้อ (เวอร์ชันนี้สร้างใหม่ให้ตรงกับ index.html — **ถ้าใน Apps Script ของผู้ใช้มี Code.gs ที่แก้เองไว้ ให้เทียบกับตัวนั้นก่อนทับ**)

**ยังต้องทำ (ขั้นตอนที่ผู้ใช้ทำเองในเบราว์เซอร์ — ยังไม่ยืนยันว่าทำแล้ว)**
1. เปิด GitHub Pages: repo Settings → Pages → Deploy from branch `main` / root
2. วาง `apps-script/Code.gs` ทับใน Apps Script → Deploy → จัดการการทำให้ใช้งานได้ → แก้ไข → **เวอร์ชันใหม่**
3. นำ URL `/exec` ไปกรอกในหน้าเว็บ แท็บ ⚙️ ตั้งค่า → การเชื่อมต่อ API (หรือฝังใน `APPS_SCRIPT_URL` ใน index.html)
4. ตรวจ Webhook URL ใน LINE Developers Console ให้เป็น `/exec` เดียวกัน
5. Commit โฟลเดอร์ `apps-script/`, `tests/`, `docs/`, `CLAUDE.md` เข้า repo (ตอนนี้ repo มีแค่ `index.html`)
6. ถ้าเคยมี UI เดิมใน Apps Script ให้ลบไฟล์ `Index` ออก (doGet ไม่ใช้แล้ว)

## ฐานข้อมูล (Google Sheets) — `setup()` สร้างให้พร้อมข้อมูลตัวอย่าง

| ชีต | คอลัมน์ | หมายเหตุ |
|---|---|---|
| `ตั้งค่า` | หัวข้อ, ค่า, คำอธิบาย | key: `ชื่อโรงเรียน`, `รหัส PIN` (ค่าเริ่ม 1234), `LINE groupId` (ระบบกรอกเอง), `ผู้จัดตารางสอนแทน`, `ข้อความท้ายประกาศไลน์` |
| `ครู` | ชื่อครู, ชื่อที่แสดง, กลุ่มสาระ/หน้าที่, LINE userId, ชื่อในไลน์, ใช้งาน | "ชื่อครู" คือ primary key (ใช้อ้างอิงทุกที่) |
| `คาบเรียน` | คาบ, เริ่ม, สิ้นสุด | เวลาเก็บเป็นข้อความ `HH:mm` |
| `ตารางสอน` | ชื่อครู, วัน, คาบ, วิชา, ห้อง | 1 แถว = 1 คาบ; วันรับ จันทร์/จ/จ./1 ฯลฯ (`normDay_`) |
| `บันทึกสอนแทน` | รหัส, วันที่, ครูที่ไม่อยู่, เหตุผล, คาบ, วิชา, ห้อง, ครูสอนแทน, หมายเหตุ, บันทึกเมื่อ | วันที่เก็บเป็นข้อความ `yyyy-MM-dd`; ครูที่ไม่อยู่แต่ไม่มีคาบ = แถวที่ คาบ ว่าง |
| `สมาชิกไลน์` | LINE userId, ชื่อในไลน์, groupId, พบล่าสุด | เก็บอัตโนมัติจาก webhook ทุกครั้งที่มีคนพิมพ์ในกลุ่ม |
| `ภาพตารางสอนแทน` | วันที่, fileId, url, สร้างเมื่อ, ส่งไลน์เมื่อ | ภาพล่าสุดของวันใช้ตอบคำสั่ง `สอนแทน` |

Script Properties: `SS_ID`, `FOLDER_ID` (โฟลเดอร์ Drive "ภาพตารางสอนแทน"), `LINE_TOKEN`, `BOT_USER_ID`

## API contract (ต้องตรงกันทั้งสองฝั่ง)

คำตอบทุกตัว: `{ok:true, result}` หรือ `{ok:false, error:"ข้อความไทย"}`

| ฟังก์ชัน | วิธี | args | หมายเหตุ |
|---|---|---|---|
| `getInitData` | GET | – | ชื่อโรงเรียน, ครู, คาบ, เหตุผลการลา, วันนี้ (เวลาไทย), sheetUrl, webAppUrl |
| `getDateData` | GET | `date` | ตารางสอนของวันนั้น, รายการสอนแทน, `monthCounts` (ไม่นับวันนั้น), ภาพล่าสุด |
| `getStats` | GET | `yyyy-MM` | ภาระสอนแทนรายครู + รายวัน |
| `verifyPin` | POST | `pin` | |
| `saveDay` | POST | `pin, date, rows[]` | **แทนที่ทั้งวัน**, ตรวจชื่อครู/สอนแทนตัวเอง/ซ้ำคาบ, ใช้ LockService, ลบรายการภาพของวันนั้น |
| `saveImageToDrive` | POST | `pin, date, dataUrl` | JPEG base64 → Drive แชร์ "ทุกคนที่มีลิงก์" → `lh3.googleusercontent.com/d/<id>` |
| `sendToLine` | POST | `pin, date, dataUrl\|null` | push ภาพ + textV2 mention เข้ากลุ่ม; ถ้า dataUrl เป็น null ใช้ภาพล่าสุดใน Drive |
| `getAdminData` | POST | `pin` | ข้อมูลบอท, โควตา, กลุ่ม, ครู+userId, สมาชิกไลน์ |
| `saveLineToken` | POST | `pin, token` | ตรวจ token ด้วย `/v2/bot/info` ก่อนบันทึก, เก็บ `BOT_USER_ID` |
| `linkTeacherLine` | POST | `pin, teacherName, userId` | ผูก/ยกเลิกผูกด้วยมือ |
| `sendLineTest` | POST | `pin` | |

ถ้าเพิ่มฟังก์ชันใหม่: เพิ่มใน `GET_API`/`POST_API` (Code.gs) และถ้าเป็น GET ให้เพิ่มใน `GET_FUNCTIONS` (index.html) ด้วย

## LINE

- ข้อความแท็กชื่อใช้ **Text message v2** (`type:"textV2"` + `substitution` แบบ `mention`) — placeholder `{t0}` ต้อง escape `{`/`}` ในข้อความอื่นเป็น `{{`/`}}` (ฟังก์ชัน `esc` ใน `buildLineMessage_`) ถ้าไม่มีใครแท็กได้จะส่ง `type:"text"` ธรรมดา
- แท็กได้เฉพาะครูที่มี `LINE userId` — ได้จากคำสั่ง `ลงทะเบียน <ชื่อ>` ในกลุ่ม หรือผูกเองในหน้าตั้งค่า
- **โควตา**: push เข้ากลุ่มนับตามจำนวนสมาชิกในกลุ่ม (แผนฟรีจำกัดต่อเดือน); **reply ฟรี** → คำสั่ง `สอนแทน`/`สอนแทนพรุ่งนี้` ในกลุ่มเป็นทางประหยัด (บอทตอบภาพ+แท็ก)
- คำสั่งกลุ่ม: `สอนแทน`, `สอนแทนพรุ่งนี้`, `สอนแทนมะรืน`, `ลงทะเบียน ชื่อ`, `ตั้งกลุ่มนี้`, `คำสั่ง`
- เชิญบอทเข้ากลุ่ม → event `join` ตั้ง `LINE groupId` อัตโนมัติ
- Apps Script อ่าน HTTP header ไม่ได้ → **ตรวจ `X-Line-Signature` ไม่ได้**; กันด้วยการเทียบ `destination` กับ `BOT_USER_ID` เท่านั้น
- ปุ่ม Verify ใน LINE Console มักขึ้น 302 (Apps Script redirect) — ปกติ ให้ทดสอบด้วยการพิมพ์ `คำสั่ง` ในกลุ่ม

## หน้าเว็บ (index.html)

- state กลางอยู่ใน `S` (`init`, `date`, `dd`, `plan`, `pin`, `dirty`, `img`, `imgDrive`); render ใหม่ทั้งรายการด้วย `render()` + event delegation
- localStorage: `subpin` (PIN), `apiUrl` (URL /exec) — ห่อ try/catch แล้ว
- แท็บ: จัดสอนแทน / สถิติ / ตั้งค่า, modal แบบ bottom sheet (เลือกครู, ภาพ, PIN)
- **จัดอัตโนมัติ** (`autoAssign`): เรียงคาบจากเช้าไปเย็น เลือกครูว่างที่ `score` ต่ำสุด = สอนแทนเดือนนี้ + สอนแทนวันนี้×2 + คาบสอนเอง×0.3, เสมอกันให้กลุ่มสาระเดียวกับครูที่ลาก่อน
- ครูว่าง (`candidates`) = ใช้งานอยู่ ∧ ไม่ได้ลา ∧ ไม่มีคาบตัวเองในคาบนั้น ∧ ยังไม่ถูกจัดคาบนั้น; `slotConflict` แสดงแถบแดง
- **ภาพ** วาดด้วย canvas 1080px (`drawImage`), ตัดบรรทัดภาษาไทยด้วย `Intl.Segmenter('th')` (มี regex fallback), ฟอนต์ Sarabun จาก Google Fonts, ส่งออก JPEG 0.92
- หลังเปิดภาพตัวอย่าง จะอัปโหลดลง Drive เบื้องหลังเพื่อให้คำสั่ง `สอนแทน` ในกลุ่มมีภาพ
- โค้ดฝั่งหน้าเว็บเขียนแบบ ES5 (`var`, `function`) เพื่อรองรับมือถือเก่า — คงสไตล์นี้ไว้

## ข้อควรระวัง

- POST จากหน้าเว็บ **ห้ามตั้ง `Content-Type`** (ให้เป็น text/plain อัตโนมัติ) ไม่งั้นเบราว์เซอร์ยิง CORS preflight ซึ่ง Apps Script ไม่รองรับ
- แก้ Code.gs แล้วต้อง Deploy **เวอร์ชันใหม่** ทุกครั้ง (Save อย่างเดียว URL /exec ยังใช้โค้ดเก่า); แก้ index.html แล้วผู้ใช้อาจต้อง hard refresh (เคยเจอ cache เก่าทำให้มองไม่เห็นการ์ด "การเชื่อมต่อ API")
- บัญชี Google Workspace ของโรงเรียนอาจห้ามแชร์ "ทุกคนที่มีลิงก์" → ภาพส่งไลน์ไม่ได้ แนะนำติดตั้งด้วย Gmail ส่วนตัว
- วันที่/เวลาในชีตตั้ง number format เป็นข้อความ (`@`) ใน `setup()` เพื่อกัน Sheets แปลงเป็น Date; โค้ดอ่านด้วย `dateStr_`/`timeStr_` รองรับทั้งสองแบบ
- เขตเวลา `Asia/Bangkok` ตายตัว (`TZ`); ปี พ.ศ. = ค.ศ. + 543
- PIN เป็นรหัสร่วมตัวเดียวเก็บในชีต (plain text) และจำในเครื่องผู้ใช้; ใครมีลิงก์ดูข้อมูล GET ได้โดยไม่ต้องใช้ PIN

## การทดสอบ

- `node tests/api.test.js` — ต้องผ่านทุกข้อก่อน commit การแก้ Code.gs
- ทดสอบหน้าเว็บ: เปิด `index.html` ด้วย Playwright (มี Chromium) แล้ว stub `fetch` ให้เรียกฟังก์ชันใน Code.gs ผ่าน `doGet`/`doPost` ของ mock — viewport 390×844, เช็ก `document.documentElement.scrollWidth === 390`, ดูภาพจาก `#previewImg`
- ไม่มี internet ไป Google Fonts ใน sandbox → ใช้ `npm i @fontsource/sarabun` แล้วแทน `<link>` ด้วย `@font-face` ไฟล์ local ตอนทดสอบเท่านั้น

## ไอเดียต่อยอด (ยังไม่ได้ทำ)

- ฝัง `APPS_SCRIPT_URL` ใน index.html เพื่อไม่ต้องกรอกในทุกเครื่อง
- ลบภาพเก่าใน Drive อัตโนมัติ (ตอนนี้ภาพถูกสร้างซ้ำทุกครั้งที่เปิดตัวอย่าง/ส่ง)
- PWA (manifest + icon) ให้ "เพิ่มไปยังหน้าจอหลัก" สวยขึ้น
- แจ้งเตือนส่วนตัว (push 1:1) ให้ครูที่ถูกจัด หรือส่งตอนเช้าอัตโนมัติด้วย time-driven trigger
- PIN แยกรายผู้ใช้ / hash PIN
- นำเข้าตารางสอนจาก Excel
