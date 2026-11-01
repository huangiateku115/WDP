# Báo cáo Customer Mobile · Phase 1

## Kết quả

Đã tạo foundation React Native/Expo độc lập tại `frontend/customer-mobile/`, 6 UI chính bằng native components. Không thay đổi website, dependencies/config của website hoặc các thay đổi working tree có sẵn. Không truy cập `backend/`; không cần đọc BE-REF vì phase này không tích hợp APIs.

## Phiên bản đã cài

| Thành phần | Phiên bản |
| --- | --- |
| Expo | 57.0.31 |
| React / React Native | 19.2.3 / 0.86.3 |
| Expo Router | 57.0.29 |
| TypeScript | 6.0.3 |
| Zustand | 5.0.16 |
| React Hook Form / resolvers | 7.91.0 / 6.0.2 |
| Zod / Axios | 4.6.7 / 1.21.0 |
| Safe area / screens | 5.7.0 / 4.26.2 |
| SVG / Ionicons package | 15.15.4 / 15.1.1 |
| Reanimated / Worklets | 4.5.1 / 0.10.1 |
| Jest / Jest Expo / RNTL | 29.7.0 / 57.0.6 / 13.3.3 |

Native peers được pin theo template và bundledNativeModules của SDK 57; đã xử lý Worklets phiên bản npm tự chọn không khớp SDK, bổ sung Babel/Metro runtime peers rõ ràng. Không dùng legacy-peer-deps, force install hoặc sửa dependencies web. `package-lock.json` mới chỉ thuộc mobile.

## Thiết kế và screens

Đã đọc README/manifest và HTML của 6 screens ưu tiên (01/02/09/13/21/22) cùng Registration để làm auth skeleton. Tokens giữ Emerald Vault Modernist: mint, emerald, cam, Inter, cards, status chips, section header và 5 tabs. Artwork thay bằng vector gốc cục bộ thay ảnh remote chưa xác minh; không copy scripts/HTML DOM vào native.

1. Login: form validation, password visibility, local demo entry, link Registration.
2. Dashboard: greeting, fixture notice, kỳ thuê active, reminder minh họa, quick links, facility card.
3. Explore: fixture facility list, tìm kiếm không dấu, service filters, empty state, detail navigation.
4. My Rentals: filters, service/status cards, kỳ hạn và giá mẫu, detail navigation.
5. Inventory: search/category, registered quantity tách stock, unknown stock, read-only item summary.
6. Profile: hồ sơ minh họa, local compact-card switch, support information, logout.

Registration là form foundation (không tạo account); preview detail là generic native stack shell (không phải full designs 03/10/14). Không triển khai booking, payments hoặc operations.

Các claim prototype bị loại bỏ: NFC/Smart Pass, climate, chứng nhận điện tử, insurance, automatic billing/refund, payment-provider success, live sync/access. Không có actual mutation, PIN hoặc QR giả được mô tả như tính năng thật. Mọi content customer bằng tiếng Việt.

## Reusable components và navigation

`AppText`, `Screen`, `Card`, `Button`, `Input`, `SectionTitle`, `Chip`, `Filter`, `FixtureNotice`, `StateCard`, `Icon`, `Brand`, `CustomerHeader`, Facility/Rental/Inventory cards và WarehouseArt.

Root native Stack → Auth group hoặc 5 Customer tabs. Native stack preview đứng ngoài tabs; Back trả về previous route. Protected-route logic chỉ dành cho demo; chưa phải auth/role enforcement Backend.

## Kiểm thử thực hiện

| Kiểm tra | Kết quả |
| --- | --- |
| `npm run typecheck` | PASS strict TypeScript, gồm tests |
| `npm test` | 2 suites, 24/24 PASS |
| `npm run check:versions` | Dependencies up to date theo map SDK cục bộ; endpoint kiểm tra online không truy cập được |
| `npm ls --depth=0` | PASS, không báo invalid direct peers |
| `expo export --platform android --platform ios --max-workers 2 --output-dir artifacts/native` | PASS cả hai Hermes HBC bundles, 39 assets; iOS ~3.6 MB, Android ~3.9 MB |
| Metro `expo start --offline --port 8091 --max-workers 2` | PASS startup, localhost phục vụ app |
| RN Web smoke bổ trợ | PASS login/logout, auth registration/back, five tabs, stack detail/back, search empty, direct tab sau logout quay về login |
| RN Web layout 320/390/768 | PASS document overflow checks; đã xem screenshot Login/Home |
| `npm run verify:website` | 1.074 file đối chiếu SHA-256: changed=[], missing=[] |

Unit/native component tests kiểm tra 6 screens, missing fixtures, search/filter, local state, validation, detail route params/back, loading/error/empty primitives và chặn transport Axios với cả năm methods. Preview smoke chặn mọi origin ngoài localhost; không có request Backend hoặc mutation. Tất cả fixtures tách khỏi UI.

**Chưa có Android/iOS simulator hoặc device test.** Host là Windows, không có adb/xcrun trong PATH. Hermes export không phải APK/IPA và không chứng minh chạy trên device; RN Web screenshots cũng không được coi là ảnh simulator. Chưa kiểm thử keyboard/font scaling/TalkBack/VoiceOver native, device safe-area, OS Back hoặc performance thiết bị thật.

Screenshots bổ trợ ở `artifacts/screenshots/`: login, home, explore, rentals, inventory, profile 390px và home 320/768. Badge dev tooling trên ảnh preview không phải UI production. Artifacts/cache/node_modules đều gitignored.

## Dependency/security dependency còn lại

`docs/dependency-audit.json` ghi kết quả npm audit ở thời điểm cài: **19 findings (13 low, 6 high, 0 critical)**. Chuỗi high gồm SDK CLI/nested Zod và Router/query-string/decode-uri-component; Zod dùng trực tiếp trong form đã là 4.6.7. Audit gợi ý thay major SDK/Router hoặc thậm chí downgrade Expo; không thực hiện `audit fix --force` vì có thể phá compatibility.

Đây là blocker cần xử lý trước release production, không phải bằng chứng app Phase 1 đã production-ready. Cần review SDK mới/patch upstream hoặc remediation có kiểm chứng và chạy lại native tests/device builds. Không có compatibility blocker đang ngăn typecheck/test/native bundling của bộ version đã pin. Không claim online Expo Doctor PASS.

## 17 thiết kế còn lại

03 Facility Detail; 04 Unit Selection; 05 Rental Period/Pricing; 06 Reservation Confirmation; 07 Warehouse Map; 08 Managed Booking Review; 10 Rental Detail; 11 Contract Review; 12 Payment Detail; 14 Inventory Detail; 15 Register/Edit Inventory; 16 Repeated Inbound; 17 Canonical Outbound; 18 Movement History; 19 Notifications; 20 Support; 23 Registration đầy đủ.

Các shell 03/10/14/23 hiện chỉ để kiểm tra navigation/form foundation. `docs/design-map.json` ghi rõ screens complete và scaffold. Không mở rộng Phase 2 hoặc tích hợp APIs tự động.

## Hướng tiếp theo

Kiểm tra native trên Android/iOS với toolchain phù hợp và rà dependency audit trước khi release. Sau đó audit source/contract Backend cho từng nhóm Customer feature, role/ownership, gate, DTO, errors và lifecycle. Không chuyển nút prototype thành operations thật khi chưa có contract xác minh; không bỏ network guard chỉ bằng cấu hình Vite/Expo env.
