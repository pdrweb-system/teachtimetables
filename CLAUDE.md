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
ครู ──► GitHub Pages: index.html (หน้าจัดสอนแทน)   ผู้ดูแล ──► admin.html (ต้องใส่รหัสผู้ดูแล)
                 │ fetch GET  ?fn=&args=          (อ่านอย่างเดียว)
                 │ fetch POST {"fn","args"} text/plain (หน้าครู: ไม่ต้องใส่รหัส / admin: ส่ง pw ทุกครั้ง)
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
| `index.html` | หน้าครู: จัดสอนแทน / สถิติ / เพิ่มเติม (HTML+CSS+JS ไฟล์เดียว, ไม่มี build step) — ขึ้น GitHub Pages |
| `admin.html` | หน้าผู้ดูแล: เข้าสู่ระบบ/ตั้งรหัสครั้งแรก → LINE token, ผูกชื่อครู, เปลี่ยนรหัส (ไฟล์เดียว; โค้ด `run`/toast/loading ซ้ำกับ index.html — แก้ที่ใดต้องดูอีกที่ด้วย) |
| `apps-script/Code.gs` | Backend JSON API + LINE webhook — **คัดลอกไปวางใน Apps Script เอง** (ไม่ได้ deploy อัตโนมัติจาก repo) |
| `tests/gasmock.js` | Mock ของ SpreadsheetApp/DriveApp/UrlFetchApp/ฯลฯ ในหน่วยความจำ ให้รัน Code.gs ใน Node ได้ |
| `tests/api.test.js` | ทดสอบ API ผ่าน doGet/doPost แบบเดียวกับที่ index.html เรียก — `node tests/api.test.js` |
| `tests/flex.test.js` | ทดสอบคำสั่ง `แจ้งตารางสอนแทน` + ตัวตรวจ Flex (property/ค่า/ขนาด) — `node tests/flex.test.js [--dump]` |
| `tests/e2e.test.js` | ทดสอบหน้าเว็บทั้ง flow ใน Chromium กับ Code.gs จริง — `node tests/e2e.test.js [โฟลเดอร์ภาพ]` |
| `README.md` | คู่มือผู้ใช้ (ภาษาไทย) สำหรับสถาปัตยกรรมปัจจุบัน: ติดตั้ง, Deploy, GitHub Pages, LINE, อัปเดตจากเวอร์ชันเดิม, FAQ |
| `.nojekyll` | ปิด Jekyll ของ GitHub Pages (ดูข้อควรระวัง) |
| `docs/SETUP-legacy-htmlservice.md` | คู่มือติดตั้งเวอร์ชันเดิม (HtmlService) — เก็บไว้อ้างอิง; คู่มือปัจจุบันคือ `README.md` |
| `docs/sample-output.jpg` | ตัวอย่างภาพตารางสอนแทนที่ระบบสร้าง |

## สถานะปัจจุบัน

**เสร็จแล้ว**
- เวอร์ชันแรก (Apps Script HtmlService: `Code.gs` + `Index.html`) ทำครบทุกฟีเจอร์ ทดสอบด้วย mock แล้ว
- แปลงเป็น GitHub Pages + API: `index.html` push ขึ้น repo แล้ว (commit `4cc1957`, 2026-09-27) — แทน `google.script.run` ด้วย `fetch()` และมีช่องกรอก URL API ในแท็บตั้งค่า
- `apps-script/Code.gs` เวอร์ชัน API อยู่ในโฟลเดอร์นี้ ผ่าน `tests/api.test.js` 19 ข้อ (เวอร์ชันนี้สร้างใหม่ให้ตรงกับ index.html — **ถ้าใน Apps Script ของผู้ใช้มี Code.gs ที่แก้เองไว้ ให้เทียบกับตัวนั้นก่อนทับ**)
- 2026-11-12: คำสั่งไลน์ `แจ้งตารางสอนแทน` → reply เป็น Flex message + แท็กชื่อ (Code.gs; `tests/flex.test.js` 32 ข้อ) — ต้องวาง Code.gs ใหม่แล้ว Deploy เวอร์ชันใหม่จึงจะใช้ได้
- 2026-11-12: เอา PIN เดิมออก → แยก 2 หน้า (index.html ครู / admin.html ผู้ดูแลที่ต้องใส่รหัส ตรวจที่ Code.gs); เทสต์ API 36 ข้อ, e2e 32 ข้อ — **ต้องวาง Code.gs ใหม่แล้ว Deploy เวอร์ชันใหม่พร้อมกับ merge หน้าเว็บ และผู้ดูแลต้องตั้งรหัสที่ admin.html ทันที**
- 2026-11-11 (branch `claude/upbeat-curie-mt0k04`): นำ `apps-script/`, `tests/`, `docs/`, `CLAUDE.md` เข้า repo; เพิ่ม `README.md` (คู่มือติดตั้งปัจจุบัน), `.nojekyll`, `tests/e2e.test.js` (ผ่าน 21 ข้อ); index.html: fetch ล้มเหลวแจ้งเป็นภาษาไทยพร้อมวิธีตรวจ (`netFail`), บันทึก URL แล้วแจ้ง "เชื่อมต่อสำเร็จ ✓", ช่อง Webhook URL ใช้ `apiUrl()` — Code.gs ไม่ได้แก้

**ยังต้องทำ (ขั้นตอนที่ผู้ใช้ทำเองในเบราว์เซอร์ — ยังไม่ยืนยันว่าทำแล้ว; วิธีทำละเอียดอยู่ใน README.md)**
1. Merge branch `claude/upbeat-curie-mt0k04` เข้า `main` (GitHub Pages เสิร์ฟจาก `main` — ก่อน merge หน้าเว็บจริงยังเป็น commit `4cc1957`)
2. เปิด GitHub Pages: repo Settings → Pages → Deploy from branch `main` / root
3. วาง `apps-script/Code.gs` ทับใน Apps Script → Deploy → จัดการการทำให้ใช้งานได้ → แก้ไข → **เวอร์ชันใหม่**
4. นำ URL `/exec` ไปกรอกในหน้าเว็บ แท็บ ⚙️ ตั้งค่า → การเชื่อมต่อ API (ไม่แนะนำฝังใน `APPS_SCRIPT_URL` เพราะหน้าเว็บเป็นสาธารณะ — ดู README หัวข้อความปลอดภัย)
5. ตรวจ Webhook URL ใน LINE Developers Console ให้เป็น `/exec` เดียวกัน
6. ถ้าเคยมี UI เดิมใน Apps Script ให้ลบไฟล์ `Index` ออก (doGet ไม่ใช้แล้ว)

## ฐานข้อมูล (Google Sheets) — `setup()` สร้างให้พร้อมข้อมูลตัวอย่าง

| ชีต | คอลัมน์ | หมายเหตุ |
|---|---|---|
| `ตั้งค่า` | หัวข้อ, ค่า, คำอธิบาย | key: `ชื่อโรงเรียน`, `LINE groupId` (ระบบกรอกเอง), `ผู้จัดตารางสอนแทน`, `ข้อความท้ายประกาศไลน์` |
| `ครู` | ชื่อครู, ชื่อที่แสดง, กลุ่มสาระ/หน้าที่, LINE userId, ชื่อในไลน์, ใช้งาน | "ชื่อครู" คือ primary key (ใช้อ้างอิงทุกที่) |
| `คาบเรียน` | คาบ, เริ่ม, สิ้นสุด | เวลาเก็บเป็นข้อความ `HH:mm` |
| `ตารางสอน` | ชื่อครู, วัน, คาบ, วิชา, ห้อง | 1 แถว = 1 คาบ; วันรับ จันทร์/จ/จ./1 ฯลฯ (`normDay_`) |
| `บันทึกสอนแทน` | รหัส, วันที่, ครูที่ไม่อยู่, เหตุผล, คาบ, วิชา, ห้อง, ครูสอนแทน, หมายเหตุ, บันทึกเมื่อ | วันที่เก็บเป็นข้อความ `yyyy-MM-dd`; ครูที่ไม่อยู่แต่ไม่มีคาบ = แถวที่ คาบ ว่าง |
| `สมาชิกไลน์` | LINE userId, ชื่อในไลน์, groupId, พบล่าสุด | เก็บอัตโนมัติจาก webhook ทุกครั้งที่มีคนพิมพ์ในกลุ่ม |
| `ภาพตารางสอนแทน` | วันที่, fileId, url, สร้างเมื่อ, ส่งไลน์เมื่อ | ภาพล่าสุดของวันใช้ตอบคำสั่ง `สอนแทน` |

Script Properties: `SS_ID`, `FOLDER_ID` (โฟลเดอร์ Drive "ภาพตารางสอนแทน"), `LINE_TOKEN`, `BOT_USER_ID`, `ADMIN_SALT` + `ADMIN_HASH` (SHA-256 ของ `salt:รหัส` — ลืมรหัสให้ลบสองตัวนี้แล้วตั้งใหม่ที่ admin.html)

## API contract (ต้องตรงกันทั้งสองฝั่ง)

คำตอบทุกตัว: `{ok:true, result}` หรือ `{ok:false, error:"ข้อความไทย"}`

| ฟังก์ชัน | วิธี | args | หมายเหตุ |
|---|---|---|---|
| `getInitData` | GET | – | ชื่อโรงเรียน, ครู, คาบ, เหตุผลการลา, วันนี้ (เวลาไทย) — **ไม่มี sheetUrl/webAppUrl แล้ว** (ย้ายไป getAdminData) |
| `getDateData` | GET | `date` | ตารางสอนของวันนั้น, รายการสอนแทน, `monthCounts` (ไม่นับวันนั้น), ภาพล่าสุด |
| `getStats` | GET | `yyyy-MM` | ภาระสอนแทนรายครู + รายวัน |
| `saveDay` | POST | `date, rows[]` | **แทนที่ทั้งวัน**, ตรวจชื่อครู/สอนแทนตัวเอง/ซ้ำคาบ, ใช้ LockService, ลบรายการภาพของวันนั้น |
| `saveImageToDrive` | POST | `date, dataUrl` | JPEG base64 → Drive แชร์ "ทุกคนที่มีลิงก์" → `lh3.googleusercontent.com/d/<id>` |
| `sendToLine` | POST | `date, dataUrl\|null` | push ภาพ + textV2 mention เข้ากลุ่ม; ถ้า dataUrl เป็น null ใช้ภาพล่าสุดใน Drive |
| `adminStatus` | POST | – | `{hasPassword}` — หน้า admin ใช้เลือกว่าจะแสดงฟอร์มตั้งรหัสหรือเข้าสู่ระบบ |
| `setAdminPassword` | POST | `newPw, oldPw?` | ยังไม่มีรหัส = ตั้งครั้งแรก (ใครก็ได้ — ผู้ดูแลต้องตั้งทันทีหลัง Deploy); มีแล้ว = ต้องส่ง oldPw; ยาว ≥ 6 |
| `verifyAdmin` | POST | `pw` | |
| `getAdminData` | POST | `pw` | ข้อมูลบอท, โควตา, กลุ่ม, ครู+userId, สมาชิกไลน์, sheetUrl, webAppUrl |
| `saveLineToken` | POST | `pw, token` | ตรวจ token ด้วย `/v2/bot/info` ก่อนบันทึก, เก็บ `BOT_USER_ID` |
| `linkTeacherLine` | POST | `pw, teacherName, userId` | ผูก/ยกเลิกผูกด้วยมือ |
| `sendLineTest` | POST | `pw` | |

ถ้าเพิ่มฟังก์ชันใหม่: เพิ่มใน `GET_API`/`POST_API` (Code.gs) และถ้าเป็น GET ให้เพิ่มใน `GET_FUNCTIONS` (index.html) ด้วย

## LINE

- ข้อความแท็กชื่อใช้ **Text message v2** (`type:"textV2"` + `substitution` แบบ `mention`) — placeholder `{t0}` ต้อง escape `{`/`}` ในข้อความอื่นเป็น `{{`/`}}` (ฟังก์ชัน `esc` ใน `buildLineMessage_`) ถ้าไม่มีใครแท็กได้จะส่ง `type:"text"` ธรรมดา
- แท็กได้เฉพาะครูที่มี `LINE userId` — ได้จากคำสั่ง `ลงทะเบียน <ชื่อ>` ในกลุ่ม หรือผูกเองในหน้าตั้งค่า
- **โควตา**: push เข้ากลุ่มนับตามจำนวนสมาชิกในกลุ่ม (แผนฟรีจำกัดต่อเดือน); **reply ฟรี** → คำสั่ง `สอนแทน`/`สอนแทนพรุ่งนี้` ในกลุ่มเป็นทางประหยัด (บอทตอบภาพ+แท็ก)
- คำสั่งกลุ่ม: `แจ้งตารางสอนแทน[พรุ่งนี้|มะรืน]`, `สอนแทน`, `สอนแทนพรุ่งนี้`, `สอนแทนมะรืน`, `ลงทะเบียน ชื่อ`, `ตั้งกลุ่มนี้`, `คำสั่ง`
- **`แจ้งตารางสอนแทน`** (`buildFlexMessage_` + `buildMentionNotice_`): reply = Flex ตาราง (bubble เดียว ≤ `FLEX.ROWS_PER_BUBBLE` = 15 คาบ, เกินนั้นเป็น carousel) + ในกลุ่มตามด้วย textV2 แท็กผู้สอนแทน (Flex ใส่ mention ไม่ได้; ไม่มีใครผูกไลน์ = ไม่ส่งข้อความที่สอง); แชต 1:1 ส่ง Flex อย่างเดียว
  - ข้อจำกัด LINE: bubble ≤ 30 KB, carousel ≤ 12 bubble/≤ 50 KB (1 คาบ ≈ 1 KB → แสดงได้ราว 45 คาบ เกินนั้นตัดท้ายพร้อมข้อความ "…และอีก N คาบ"), text ห้ามว่าง, altText ≤ 1500
  - ถ้า LINE ปฏิเสธ Flex จะ reply ซ้ำด้วยข้อความแบบเดิม (`buildLineMessage_`) — reply token ยังใช้ได้เมื่อคำขอแรกล้ม
  - ไม่มีเครื่องมือ render Flex จริงใน sandbox (api.line.me ถูกบล็อก) — ตรวจด้วย `tests/flex.test.js`; ถ้าแก้หน้าตาให้ผู้ใช้ลองในกลุ่มจริง หรือวาง JSON จาก `--dump` ใน Flex Message Simulator ของ LINE
- เชิญบอทเข้ากลุ่ม → event `join` ตั้ง `LINE groupId` อัตโนมัติ
- Apps Script อ่าน HTTP header ไม่ได้ → **ตรวจ `X-Line-Signature` ไม่ได้**; กันด้วยการเทียบ `destination` กับ `BOT_USER_ID` เท่านั้น
- ปุ่ม Verify ใน LINE Console มักขึ้น 302 (Apps Script redirect) — ปกติ ให้ทดสอบด้วยการพิมพ์ `คำสั่ง` ในกลุ่ม

## หน้าเว็บ (index.html)

- state กลางอยู่ใน `S` (`init`, `date`, `dd`, `plan`, `dirty`, `img`, `imgDrive`); render ใหม่ทั้งรายการด้วย `render()` + event delegation
- localStorage: `apiUrl` (URL /exec) — ห่อ try/catch แล้ว
- แท็บ (index.html): จัดสอนแทน / สถิติ / เพิ่มเติม (URL API, โหลดข้อมูลใหม่, คำสั่งไลน์, ลิงก์ไป admin.html); modal แบบ bottom sheet (เลือกครู, ภาพ)
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
- **แบ่งสิทธิ์ 2 ระดับ (ผู้ใช้สั่ง 2026-11-12; PIN เดิมถูกเอาออก)**: หน้าครูไม่ใช้รหัส — ใครรู้ URL /exec อ่าน/แก้รายการสอนแทน/ส่งไลน์ได้; ฟังก์ชัน admin (`adminGuard_`) ตรวจรหัสที่เซิร์ฟเวอร์ทุกครั้ง, ใส่ผิด 5 ครั้งล็อก 15 นาทีด้วย CacheService (`admin_fails`, นับรวมทุกคน), อยู่ใน POST เท่านั้น (ไม่ผ่าน GET); รหัสเก็บฝั่งหน้าเว็บใน `sessionStorage` เฉพาะแท็บ (`adminpw`)
- ข้อความ error รหัสผิดต้องมี "รหัสผู้ดูแลไม่ถูกต้อง" เพราะ `fail()` ใน admin.html ใช้ข้อความนี้ตัดสินว่าให้เด้งกลับหน้าเข้าสู่ระบบ (ข้อความล็อกจงใจไม่มีคำนี้)
- **ห้ามลบ `.nojekyll`** — ถ้าไม่มี GitHub Pages จะรัน Jekyll/Liquid กับไฟล์ `.md` (CLAUDE.md มี `{{`/`}}`) ซึ่งอาจทำให้ build เพี้ยนหรือล้ม
- `ScriptApp.getService().getUrl()` อาจคืน URL อื่น (เช่น `/dev`) → ช่อง Webhook URL ในหน้าตั้งค่าจึงแสดง `apiUrl()` (URL /exec ที่หน้าเว็บเรียกอยู่จริง) ก่อน `webAppUrl`
- sandbox ของ Claude เข้า `*.github.io` ไม่ได้ → ตรวจสถานะ GitHub Pages จริงเองไม่ได้ ต้องถามผู้ใช้

## การทดสอบ

- `node tests/api.test.js` และ `node tests/flex.test.js` — ต้องผ่านทุกข้อก่อน commit การแก้ Code.gs
- `node tests/e2e.test.js [โฟลเดอร์ภาพ]` — ทดสอบหน้าเว็บทั้ง flow (ตั้ง URL → เพิ่มครู → จัดอัตโนมัติ → ภาพ → หน้าผู้ดูแล: ตั้งรหัส/เข้า-ออก/เปลี่ยนรหัส/LINE → ส่งไลน์ → สถิติ) บน viewport 390×844 กับ Code.gs จริง; ให้รันทุกครั้งที่แก้ index.html หรือ Code.gs ใส่โฟลเดอร์ภาพเพื่อดู `preview.jpg`/screenshot
  - หน้าเว็บกับ API ใช้ http server ในเครื่องคนละ origin; API ตอบ 302 ไป `/macros/echo` แบบ Apps Script และตอบ OPTIONS ด้วย 405 (จับ CORS preflight ได้)
  - ใช้ server จริงแทน `page.route` เพราะ Playwright route **ไม่ดักคำขอที่ตามหลัง redirect** (คำขอ echo จะหลุดออกเน็ตแล้วล้ม)
  - "วันนี้" ของ backend ถูกตรึงเป็น 2026-09-28 (วันจันทร์) โดยแทน `todayStr_` ในเทสต์
- ฟอนต์ Sarabun: sandbox ไม่มี internet ไป Google Fonts → `npm i @fontsource/sarabun` ในโฟลเดอร์ที่รันคำสั่ง (เช่น scratchpad แล้วรัน `node /path/to/tests/e2e.test.js` จากที่นั่น) เทสต์จะดัก `fonts.googleapis.com` มาใช้ไฟล์ local ให้เอง; ถ้าไม่มีจะใช้ฟอนต์สำรอง (เทสต์ยังผ่าน)

## ไอเดียต่อยอด (ยังไม่ได้ทำ)

- ฝัง `APPS_SCRIPT_URL` ใน index.html เพื่อไม่ต้องกรอกในทุกเครื่อง (ข้อเสีย: หน้าเว็บเป็นสาธารณะ = เปิดเผย URL ที่อ่านข้อมูลได้ — ดูทางเลือกลิงก์ `#api=` ด้านล่าง)
- ลบภาพเก่าใน Drive อัตโนมัติ (ตอนนี้ภาพถูกสร้างซ้ำทุกครั้งที่เปิดตัวอย่าง/ส่ง)
- PWA (manifest + icon) ให้ "เพิ่มไปยังหน้าจอหลัก" สวยขึ้น
- แจ้งเตือนส่วนตัว (push 1:1) ให้ครูที่ถูกจัด หรือส่งตอนเช้าอัตโนมัติด้วย time-driven trigger
- รหัสแยกรายผู้ใช้ (ตอนนี้รหัสผู้ดูแลเป็นรหัสเดียว) หรือใส่รหัสให้หน้าครูด้วยถ้าต้องการกัน URL หลุด
- ลิงก์ตั้งค่า URL อัตโนมัติ (เช่น `…/teachtimetables/#api=<url>`) ให้ผู้ดูแลแชร์ในกลุ่มไลน์ แทนการให้แต่ละเครื่องวาง URL เอง และไม่ต้องฝัง URL ในหน้าเว็บสาธารณะ
- นำเข้าตารางสอนจาก Excel

## วิธีทำงานกับ repo นี้ (ผู้ใช้สั่งไว้)

- หลังแก้งานเสร็จและเทสต์ผ่าน ให้ commit และ **push ขึ้น branch ทันทีทุกครั้ง** โดยไม่ต้องถามซ้ำ
- งานรอบใหม่ให้เปิด **PR เข้า `main`** (ถ้ายังไม่มี PR ของ branch นั้น)
