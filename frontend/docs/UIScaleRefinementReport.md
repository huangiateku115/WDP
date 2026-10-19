# VaultSpace UI Scale & Layout Refinement

Ngày: 19/10/2026. Phạm vi: refinement Public Homepage hero và Customer Portal, không redesign.

## Nguyên nhân

- Hero dùng headline tối đa 86 px, ảnh cao cố định 560 px, media có padding đáy và caption lệch trái -32 px. Ở tablet, tỷ lệ ảnh và giới hạn chiều cao còn khiến frame ảnh hẹp hơn media chứa caption.
- CustomerScreen dùng title 30/36 px; experience.css nới container từ max-w-6xl lên 1280 px. Input/select cao 48 px, card padding 24 px, metadata gap 20 px, content padding desktop 32 px. Các khoảng cách này cộng dồn gây cảm giác phóng lớn.
- Item Detail xếp metadata dài rồi mới tới gallery, các nút nằm trong một hàng flex chung; Placement Preview có nhiều khoảng cách lớn.
- Root font, Tailwind và shared UI không có zoom/scale bất thường. Không thay root font size hoặc dùng zoom/scale để thu nhỏ giao diện.

## Thay đổi source

| File | Thay đổi |
| --- | --- |
| `src/layouts/public-site.css` | Chỉ chỉnh các rule hero/caption/finder: heading clamp, gap, padding, frame aspect-ratio, chiều cao, caption inset, CTA 46 px. Giữ ảnh warehouse, object-fit cover/object-position 55% center, màu và React Bits. |
| `src/layouts/customer-compact.css` — mới | CSS chỉ áp dụng bên trong `.customer-portal`: typography, max-width, header/navigation, cards, inputs/tables, metadata/gallery/actions/Placement Preview, responsive và reduced-motion. |
| `src/layouts/CustomerLayout.jsx` | Thêm class phạm vi và import CSS compact. Giữ nav, links, handlers, auth và Outlet. |
| `src/components/common/CustomerScreen.jsx` | Thêm class hook cho heading/content/Details. CSS compact chỉ có hiệu lực dưới CustomerLayout. |
| `src/components/customer/inventory/InventoryIntegration.jsx` | Thêm wrapper metadata/gallery và class gallery/fallback; nhóm nút refresh/history và thao tác Item. Giữ toàn bộ dữ liệu, điều kiện, đường dẫn, handlers và URL ảnh. |
| `src/components/customer/inventory/InventoryItemForm.jsx` | Chỉ thêm class `inventory-item-form`. |
| `src/components/customer/inventory/PlacementPreview.jsx` | Chỉ thêm class `inventory-placement`. |

Không sửa global CSS, Tailwind config, shared Button/Card/Input, API, DTO, auth, routes, business helpers, token storage hoặc Backend. Không thay ảnh, attachment lifecycle, animations trong chế độ thông thường hoặc chức năng Inbound/Outbound. Không truy cập thư mục backend bị cấm; BE-REF không được sửa.

## Kết quả giao diện

- Hero giữ concept text trái/warehouse phải, CTA cam, location selector và card xanh phủ trên ảnh. Heading desktop clamp(44px,4.2vw,72px), mobile 40–56 px; CTA 46 px. Frame có tỷ lệ responsive, chiều cao desktop không quá 490 px; caption nằm trong frame thay vì tràn ra ngoài.
- Portal max-width 1200 px; title 24–30 px; body 14 px, labels 12–13 px; input/select 40 px; button mặc định 40 px; header 60 px; navigation gọn, vẫn cuộn ngang và focus được bằng bàn phím.
- Card padding desktop 20 px/mobile 16 px. Khoảng cách section 16–20 px. Table vẫn giữ scroll wrapper; không co chữ để ép bảng vào màn hình.
- Item metadata 3 cột ở desktop rộng, 2 cột từ 390 px, 1 cột tại 320 px. Gallery nằm cạnh metadata từ 1024 px, xếp dưới trên mobile, ảnh object-contain trong frame 4:3. Không crop nội dung ảnh Item.
- Hai nhóm action rõ hơn; form và Placement Preview giảm gap/padding. Toàn bộ thông tin, edit controls, image controls và preview action được giữ nguyên.

## So sánh trước/sau — fixture tại 1440 px

| Chỉ số | Trước | Sau |
| --- | --- | --- |
| Hero heading | 83.52 px | 60.48 px |
| Hero photo height | 560 px | 490 px |
| Customer page title | 36 px | 30 px |
| Customer container | 1280 px | 1200 px |
| Input/select tiêu chuẩn | 48 px | 40 px |
| Item Detail document height | 1710 px | 1143 px |

Chiều cao trang là số đo fixture, thay đổi theo số trường/ảnh/thông báo của dữ liệu thực.

## Kiểm thử

- Syntax parse: **PASS**, 215 JS/JSX/TS/TSX sources.
- Production build: **PASS**; cảnh báo chunk >500 KB còn tồn tại.
- `npm test`: **PASS**, 6 tests.
- Inventory contract, Managed contract và Self Storage contract regression: **PASS**.
- Public browser regression: **PASS**, 31 GET fixture; 6 routes, mobile menu/Escape, help search/FAQ, facilities filters/pagination, pricing/terms, loading/empty/error, image decode và reduced-motion.
- Inventory browser regression: **PASS**, 72 request fixture; đăng ký/edit DTO, guards, pagination, detail/history, preferred Cell, ownership/network/401.
- IMAGE-01 → IMAGE-03 browser regression: **PASS**, 66 request fixture; upload multipart/idempotency, validation/quota/network/retry, register/refresh, preview, add/remove/discard/reorder/save/reload, cap 10 ảnh, session expiry. Không đổi test nghiệp vụ này.
- Responsive browser mới: **PASS** cho Homepage, Item Detail và Edit ở **320,390,768,1024,1440,1920 px**. Kiểm tra document overflow, caption bounds, original photo decode, title/container/input sizing và navigation focus. Không có pageerror hoặc mutation request trong test scale.
- Đã xem trực tiếp ảnh desktop/mobile sau sửa. Không thấy text/button overlap hoặc ảnh Item bị cắt trong các fixture đã kiểm tra.
- Hash baseline xác nhận chỉ 6 source có sẵn trong bảng trên thay đổi, cộng CSS mới. **58 file trong src/api, src/lib, src/routes, src/services giữ nguyên hash**. React Bits source và các role layout khác giữ nguyên.

Mọi API trong browser test đều được intercept bằng fixture; không thực hiện live Backend mutation. Regression dùng port local thay thế trong bộ nhớ, không sửa test cũ. Ảnh warehouse giữ URL gốc và được decode thật; ảnh Item là dữ liệu fixture.

## QA artifacts

- `.design-reference/check-ui-scale.cjs`: browser responsive fixture runner (`before`/`after`).
- `.design-reference/ui-scale-baseline.json`: hash source trước thay đổi.
- `.design-reference/ui-scale-before-metrics.json`, `ui-scale-after-metrics.json`.
- `.design-reference/ui-scale-{before,after}-{home,detail}-{320,390,768,1024,1440,1920}.png`.
- `.design-reference/ui-scale-{before,after}-edit-{390,1440}.png`.
- Các screenshot của regression Public/Inventory/Images được tạo lại khi chạy test hiện có. `dist/` là output build, không commit.

Giới hạn: kiểm tra bằng Edge headless với fixture, chưa xác nhận toàn bộ nội dung live và mọi trạng thái dài/ngoại lệ của tất cả Portal pages. Navigation hẹp và bảng rộng chủ động dùng cuộn ngang nội bộ, không phải document overflow. Ảnh Public vẫn phụ thuộc nhà cung cấp ảnh hiện có. Không thay dependency hoặc cấu hình build để xử lý cảnh báo bundle ngoài phạm vi UI.
