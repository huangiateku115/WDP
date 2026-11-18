# WDP — Stitch original handoff recovered from ChatGPT attachments

These are the two exact original text exports uploaded by the user, plus split HTML screen references.

## Priority and purpose
- UI reference ONLY. Treat the 27 HTML screens as static Stitch prototypes, not running React Native code or authoritative API behavior.
- **Backend current source** is the source of truth for Self Storage eligibility, renewal, PayOS and access PIN.
- Customer Web is a reference for existing integration, subject to independent verification.
- The screens are meant for **visual/layout fidelity**: spacing, components, typography, color and navigation hierarchy.
- Some Stitch mockups contain old payments/deposit language, demo prices/dates and QR/NFC/Smart Pass visuals that may NOT exist or be safe to implement as functional behavior.

## Original sources
1. `originals/Pasted text(20261118-030030).txt` — 16 HTML screens.
2. `originals/Pasted text (2)(7).txt` — 11 HTML screens.

## Screen index

| Batch | # | Stitch screen title | Extracted file |
| --- | ---: | --- | --- |
| 1 | 1 | Warehouse Map & Cell Selection | `screens/batch01_screen01.html` |
| 1 | 2 | My Rentals & Lifecycle | `screens/batch01_screen02.html` |
| 1 | 3 | Explore Facilities | `screens/batch01_screen03.html` |
| 1 | 4 | Managed Inventory | `screens/batch01_screen04.html` |
| 1 | 5 | Customer Dashboard | `screens/batch01_screen05.html` |
| 1 | 6 | Chi tiết cơ sở kho | `screens/batch01_screen06.html` |
| 1 | 7 | Chọn ô kho tự quản | `screens/batch01_screen07.html` |
| 1 | 8 | Xác nhận đặt chỗ | `screens/batch01_screen08.html` |
| 1 | 9 | Thời hạn thuê & Báo giá | `screens/batch01_screen09.html` |
| 1 | 10 | Đăng nhập tài khoản | `screens/batch01_screen10.html` |
| 1 | 11 | Tài khoản cá nhân | `screens/batch01_screen11.html` |
| 1 | 12 | Đọc & Ký hợp đồng điện tử | `screens/batch01_screen12.html` |
| 1 | 13 | Chi tiết thanh toán cọc & cước | `screens/batch01_screen13.html` |
| 1 | 14 | Chi tiết hợp đồng & Vòng đời thuê | `screens/batch01_screen14.html` |
| 1 | 15 | Chi tiết kiện hàng lưu kho | `screens/batch01_screen15.html` |
| 1 | 16 | Xác nhận thuê ô kho | `screens/batch01_screen16.html` |
| 2 | 1 | Trung tâm thông báo | `screens/batch02_screen01.html` |
| 2 | 2 | Lịch sử hàng hóa | `screens/batch02_screen02.html` |
| 2 | 3 | Yêu cầu nhập thêm hàng | `screens/batch02_screen03.html` |
| 2 | 4 | Yêu cầu xuất kho | `screens/batch02_screen04.html` |
| 2 | 5 | Trung tâm hỗ trợ | `screens/batch02_screen05.html` |
| 2 | 6 | Đăng ký hàng hóa | `screens/batch02_screen06.html` |
| 2 | 7 | Tạo tài khoản VaultSpace | `screens/batch02_screen07.html` |
| 2 | 8 | Khám phá kho ký gửi | `screens/batch02_screen08.html` |
| 2 | 9 | Thông tin cơ sở | `screens/batch02_screen09.html` |
| 2 | 10 | Chọn thời gian thuê | `screens/batch02_screen10.html` |
| 2 | 11 | Sơ đồ kho | `screens/batch02_screen11.html` |

## Review instructions
1. Verify source integrity: compare the `originals/` source files against user-upload originals; do not claim equivalence to any other 23-screen handoff unless checked.
2. Read each relevant Self Storage original HTML screen and compare it to current Mobile routes/screens. Use the split screen files to ease analysis.
3. Produce a mapping: Stitch screen -> actual Mobile route -> Backend functionality -> Customer Web behavior -> visual gap -> proposed work.
4. Do not infer an implemented function from mock UI; anything not supported by Backend must remain unavailable or visibly informational.
5. Preserve Managed Inventory code untouched; this task is Self Storage audit and proposal only.
6. Do not mutate data, source code or payment flows. No test payments.

## How to use this pack
Extract the zip into `C:\Users\laptop\Desktop\WDP\frontend\customer-mobile\design-reference\stitch-recovered-20261118\` (create that directory if needed). Do not overwrite existing source files.
