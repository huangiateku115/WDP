# WDP Customer Mobile — Expo SDK 58

**REVIEW_REQUIRED.** Phạm vi nâng cấp là `frontend/customer-mobile/`.

## Nguyên nhân và cách khôi phục

Khi bắt đầu, Expo đã được cài ở 58.0.23. Manifest yêu cầu các phiên bản runtime SDK 58, nhưng lockfile và `node_modules` vẫn giữ 17 package runtime cũ. Router 57.0.29 còn đi cùng `expo-symbols` 57.0.3, trong khi Router 58.0.30 khai báo optional peer `expo-symbols@^58.0.4`. Router 58 còn yêu cầu Testing Library tối thiểu 14 nếu package đó có mặt. Jest Expo 58 cần preset React Native 0.88.1. Các peer này phải được giải cùng runtime React 19.3 và React Native 0.88.

Đã căn manifest theo bảng bundled modules của Expo 58.0.23 và metadata peer chính thức. Npm giải và cập nhật lockfile hiện có với resolver chuẩn. Testing Library 14 sử dụng `test-renderer` thay cho `react-test-renderer`. Node 22.19.0 đáp ứng yêu cầu 22.13+ của nhánh Node 22. [Hướng dẫn nâng SDK](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) · [Release notes SDK 58](https://expo.dev/changelog/sdk-58).

| Package | Thực tế lúc bắt đầu | Sau khi khôi phục |
| --- | --- | --- |
| `expo` | 58.0.23 | 58.0.23 |
| `expo-router` | 57.0.29 | 58.0.30 |
| `expo-symbols` | 57.0.3 transitive | 58.0.4 direct |
| `@expo/metro-runtime` | 57.0.17 | 58.0.17 |
| `@expo/ui` | 57.0.26 | 58.0.27 |
| `expo-constants` | 57.0.22 | 58.0.15 |
| `expo-font` | 57.0.4 | 58.0.11 |
| `expo-linking` | 57.0.13 | 58.0.16 |
| `expo-splash-screen` | 57.0.10 | 58.0.13 |
| `expo-status-bar` | 57.0.1 | 58.0.4 |
| `react`, `react-dom` | 19.2.3 | 19.3.0 |
| `react-native` | 0.86.3 | 0.88.1 |
| `react-native-gesture-handler` | 2.32.0 | 3.3.0 |
| `react-native-reanimated` | 4.5.1 | 4.7.1 |
| `react-native-worklets` | 0.10.1 | 0.13.0 |
| `react-native-safe-area-context` | 5.7.0 | 5.11.1 |
| `react-native-screens` | 4.26.2 | 4.30.1 |
| `react-native-svg` | 15.15.4 | 15.16.0 |
| `react-native-web` | 0.21.4 | 0.21.4 |
| `babel-preset-expo` | 57.0.16 direct | 58.0.24 |
| `@react-native/jest-preset` | 0.86.3 | 0.88.1 |
| `jest` | 29.7.0 | 30.5.2 |
| `jest-expo` | 57.0.6 | 58.0.14 |
| `@testing-library/react-native` | 13.3.3 | 14.1.0 |
| `@types/jest` | 29.5.14 | 30.0.0 |
| `@types/react` | 19.2.18 | 19.3.0 |
| Renderer dùng trong test | `react-test-renderer` 19.2.3 | `test-renderer` 1.3.0 |

## Tương thích đã xử lý

- React Native Strict API. Dùng `ScrollViewInstance` cho refs. Các slot tùy chọn của FlatList nhận `undefined`. Tab icon xử lý giá trị màu Router rộng hơn, dùng màu active/inactive hiện tại khi màu không phù hợp với API của icon.
- Expo Router. RN Web tái hiện vòng lặp redirect sau logout và protected deep link. Guard SDK 58 có đích rõ ràng cho cả hai nhóm. Ba form bản nháp tiếp tục chặn Back khi có thay đổi. Sau xác nhận bỏ thay đổi, form dùng callback `repeat()` để tiếp tục hành động Router đã chặn. [Migration Expo Router 57 → 58](https://docs.expo.dev/router/migrate/sdk-57-to-58/).
- Jest 30 và Testing Library 14. Các test chờ render, event, act và unmount. Năm assertion dùng API truy vấn composite cũ được chuyển sang spy nhận props và vẫn render FlatList thực, gồm kiểm tra độ dài dữ liệu. [Release Testing Library 14](https://github.com/callstack/react-native-testing-library/releases/tag/v14.0.0).
- Gesture Handler, Reanimated, Worklets và Expo UI dùng các phiên bản SDK 58 đã kiểm tra. App hiện không dùng trực tiếp các API gesture/animation hoặc widget Expo UI cần chuyển đổi. Metro và Babel dùng preset và module SDK 58.

## Kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Npm install, `npm ls --all`, spec manifest/lockfile | PASS. Cây dependency cuối không báo invalid hoặc missing peer. |
| `npx expo install --check` | PASS. Dependencies are up to date. |
| `npx expo-doctor@latest` | PASS 20/20 với Expo Doctor 1.21.6. |
| `npm run typecheck` | PASS. |
| `npm test -- --silent` | PASS 468/468, 11 suites, 0 skip. Lượt đầu có một timeout render. Lượt xác minh sau các chỉnh sửa tương thích qua toàn bộ. |
| `npm run export:native` | PASS sau các sửa đổi Router. Sinh Hermes `.hbc` cho iOS (4,0 MB) và Android (4,4 MB). |
| `node scripts/verify-ui-completeness.cjs` | PASS 23/23, giữ năm tab. |
| Metro | PASS. Offline SDK 58 trả `packager-status:running` trên 127.0.0.1:8091 và phục vụ RN Web. |
| RN Web smoke | PASS 7/7. Preview, booking, managed, inventory, requests, financial và care. Mỗi script báo 0 request Backend và 0 mutation. Care qua đủ năm viewport sau khi sửa việc tìm hàng FlatList ảo hóa. |
| Expo Go SDK 58 trên Android AVD | VERIFIED. Expo Go 58.0.5 chính thức đã mở màn hình login VaultSpace trên Pixel_6 read-only qua Metro 127.0.0.1:8092. Lượt đầu đã tải bundle nhưng developer menu che màn hình. Lượt sau đóng menu và xác nhận login từ cây UI. Bằng chứng ở `artifacts/expo58-upgrade/android-expo-go-login.xml`. |
| Expo Go SDK 58 trên điện thoại Android | NOT_VERIFIED. ADB không phát hiện điện thoại kết nối. |

## Kiểm tra bảo mật

`npm audit` ghi 24 mục package gồm 1 low và 23 moderate. `npm audit --omit=dev` ghi 22 mục gồm 1 low và 21 moderate. Cả hai có 0 high và 0 critical. Mỗi bộ đếm gồm các package bị ảnh hưởng gián tiếp, nên không tương đương số advisory duy nhất. Số 18 từ lượt nâng cấp ban đầu do người dùng cung cấp thuộc cây dependency khác.

Ba advisory gốc trong báo cáo hiện tại gồm prototype poisoning trong `deepmerge`, hủy traversal sau timeout trong `glob` và khả năng gây quá tải pattern trong `minimatch`. Cây `--omit=dev` vẫn tính các nhánh Jest qua peer của Expo Router/Testing Library. Các nhánh đã xác định nằm ở CLI, fingerprint và test tooling. Việc cài chúng trong cây dependency không xác nhận khả năng bị khai thác từ app chạy trên thiết bị. Npm đề xuất hạ các package chính ngoài mục tiêu SDK 58 cho một số nhánh. Giữ findings cho review riêng. [deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) · [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) · [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## File và phạm vi

- `package.json`, `package-lock.json`
- `app/_layout.tsx`, `app/(tabs)/_layout.tsx`
- `src/components/customerCare.tsx`, `src/components/managedWarehouse.tsx`
- `src/screens/InventoryFormScreen.tsx`, `src/screens/InventoryRequestScreen.tsx`, `src/screens/SupportFormScreen.tsx`
- `scripts/smoke-care.cjs` để tìm hàng ảo hóa ổn định sau khi quay lại danh sách.
- `tests/booking.test.tsx`, `tests/customer-care.test.tsx`, `tests/inventory-requests.test.tsx`, `tests/inventory.test.tsx`, `tests/managed-booking.test.tsx`, `tests/rental-documents.test.tsx`, `tests/screens.test.tsx`, `tests/setup.ts`
- `docs/EXPO58_UPGRADE_REPORT.md`

Danh sách Git trước khi sửa, bản sao manifest/lock ban đầu, phiên bản cài đặt trước nâng cấp, audit JSON và log xác minh nằm trong `artifacts/expo58-upgrade/`. Đối chiếu hash với baseline đã có cho 1.089 file Website, 257 Backend, 257 BE-REF và Axios guard đều khớp. Fixture auth, session foundation và demo store được giữ. Axios vẫn fail closed.

```text
[C2C]
TASK_ID: WDP_CUSTOMER_MOBILE_EXPO58_UPGRADE
STATE: REVIEW_REQUIRED
EXPO_SDK: 58
DEPENDENCIES: PASS
EXPO_DOCTOR: PASS 20/20
TYPECHECK: PASS
TESTS: PASS 468/468
HERMES_EXPORT: PASS ANDROID AND IOS
SMOKE_TESTS: PASS 7/7
METRO: PASS
EXPO_GO_ANDROID: NOT_VERIFIED
AXIOS: FAIL_CLOSED
BACKEND_CHANGES: 0
NON_CUSTOMER_CHANGES: 0
NEXT_RECOMMENDATION: VERIFY EXPO GO ON PHYSICAL ANDROID
```
