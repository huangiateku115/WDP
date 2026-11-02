# Customer Self Storage Deposit & Balance Integration

## Trạng thái

**PARTIAL — initiation đã tích hợp; mock-confirm bị khóa có chủ đích.**

Không xác minh Live E2E. Không gọi live payment API, không ghi database, không truy cập `backend/`, không chỉnh sửa BE-REF. Không thay đổi Managed Inventory payments hoặc Staff operations.

Yêu cầu gốc quy định fail closed khi chưa xác minh được môi trường/gate. Hiện chưa có bằng chứng Backend development được phép mô phỏng thanh toán. Không dùng `import.meta.env.DEV` làm bằng chứng về môi trường Backend. Policy trong `src/lib/selfStorageStagedPayment.js` luôn disabled; allowlist cũng chặn hai mock-confirm. Không có biến môi trường hoặc config nào được sửa để tự bật chúng.

## Contract Backend đã đọc

Tiền tố `/api/v1`; route `src/routes/reservation.routes.ts:15,40-45` dùng requireAuth và requireRole CUSTOMER. Cả bốn controller so sánh Customer owner với reservation.customerId. Các controller không có DTO/body validator, không đọc `Idempotency-Key`, `If-Match` hoặc key trong body. Frontend gửi `{}` qua Axios client hiện có, không tạo key giả.

| Endpoint POST | Điều kiện thực tế | Response success.data | Hiệu ứng |
| --- | --- | --- | --- |
| `/reservations/:id/deposit` | Owner, reservation RESERVED | reservationId, purpose DEPOSIT, amount, currency VND, breakdown | Chỉ tính/trả breakdown; không tạo payment PENDING |
| `/reservations/:id/deposit/mock-confirm` | Owner, RESERVED | reservation, payment, contract | Tạo payment SUCCEEDED, reservation DEPOSIT_PAID, depositPaymentId, xóa expiresAt; tạo DRAFT contract nếu thiếu |
| `/reservations/:id/balance` | Owner, contract SIGNED và signedProofUrl có giá trị | reservationId, purpose BALANCE, amount, currency VND, breakdown, contract {_id,signedProofUrl,signedAt} | Chỉ trả breakdown; không tạo payment |
| `/reservations/:id/balance/mock-confirm` | Owner, contract SIGNED và signedProofUrl | reservation, payment | Tạo payment SUCCEEDED, reservation PAID và balancePaymentId |

Nguồn BE-REF: `src/controllers/reservations/reservation.controller.ts:276,315,406,455`.

- Success trả HTTP 200 `{success:true,data:...}` (confirmation thêm message).
- Missing reservation 404; wrong owner 403; deposit sai stage 400; thiếu signed paper proof 409; middleware có 401. Controller catch trả 500, kể cả lỗi model/accounting/invalid ObjectId; không suy diễn mọi lỗi validation đều là 400. FE xử lý cả 503/network như kết quả chưa rõ.
- Balance controller hiện không có reservation-status guard riêng. FE không mở lại payment trên PAID/ACTIVE, và không tái sử dụng chức năng này cho Managed Inventory hoặc legacy CONTRACTED.
- Không có environment/feature gate trong cả bốn handler. Không suy luận gate Managed áp dụng được ở đây.
- `confirmSignedPaper` tại `src/controllers/contracts/contract.controller.ts:129-173` ghi signedProofUrl, verifiedByStaff, verifiedAt, SIGNED và chuyển reservation CHECKIN_READY. Customer UI chỉ đọc dữ liệu; không gọi endpoint Staff hoặc mô phỏng ký giấy.
- Handover riêng tại `reservation.controller.ts:516+` yêu cầu PAID; payment không đồng nghĩa ACTIVE.

## Idempotency, zero amount và khả năng reconcile

- Backend tự sinh `deposit-${reservationId}-${Date.now()}` / `balance-${reservationId}-${Date.now()}` tại controller:345,489. Không có client-key replay response.
- Model `src/models/payments/reservation-payment.model.ts:23-28` có unique index cho key và một SUCCEEDED mỗi reservation/purpose. Đây là định nghĩa schema, chưa xác minh index đã được cài ở database. Không coi duplicate-key 500 là replay thành công.
- Controller tạo payment rồi mới lưu reservation/contract, không có transaction. Lỗi giữa các bước có thể để ledger và reservation lệch nhau; GET reservation không đủ chứng minh callback chưa chạy.
- Model amount `min:Number.MIN_VALUE` tại dòng 11 yêu cầu số dương. Initiation có thể trả 0 từ breakdown nhưng confirmation không có đường zero-amount settlement riêng; FE hiển thị blocker, không giả lập completion.
- Read endpoints đang dùng: owned `GET /reservations/me`, `GET /contracts/me` và contract detail đã kiểm tra association. Không invent GET payment-status. Reservation payment pointers được dùng để ràng buộc response confirmation; không claim có ledger lookup khi chỉ refresh reservation.
- Nếu callback được mở sau khi có bằng chứng môi trường: busy-ref chống double-click; localStorage marker theo Customer/reservation/purpose được ghi trước callback; callback không được tự retry hoặc tái gửi sau refresh. Lưu marker thất bại thì không gửi. Marker không bảo đảm đa thiết bị/cross-tab transaction; Backend vẫn cần tự bảo vệ tính nguyên tử. Hai callback hiện vẫn bị khóa thực tế.

## Frontend hiện có và thay đổi

- Legacy `/reservations/:id/mock-pay` tại `reservation.controller.ts:200-239` là owner-only atomic update SELF_STORAGE CONTRACTED → PAID; không tạo ledger deposit/balance. Giữ nguyên helper, component và contract-signing flow.
- `usesSelfStorageStagedPayment` chọn flow mới cho RESERVED/DEPOSIT_PAID/CHECKIN_READY; PAID/ACTIVE dùng flow mới khi có payment pointer. CONTRACTED và paid legacy không có pointer giữ component cũ. Không fallback sau lỗi API mới.
- Route `/portal/payments/:reservationId` và auth giữ nguyên. Thêm link Review Deposit & Balance tại reservation/contract navigation hiện có. Không tạo route mới.
- Component mới dùng xanh/cam, Card/Button/Details và CustomerScreen hiện có. Số tiền dùng breakdown Backend; không tính lại tổng tiền, không gọi amount-ready là payment PENDING.
- Balance khóa khi contract không SIGNED, sai association/owner hoặc thiếu proof; hướng dẫn Customer liên hệ Staff.
- Nút mock-confirm hiện disabled trên development, không render trên production. Helper và allowlist cùng fail closed; không có tự động confirmation hoặc provider mới.

## File trong phạm vi task

1. `src/api/selfStoragePaymentApi.js` — mới: initiation và callback helper có safety gate.
2. `src/lib/selfStorageStagedPayment.js` — mới: policy, stage routing, ownership/paper proof và response validators.
3. `src/components/customer/SelfStorageStagedPayment.jsx` — mới: quote UI, GET refresh, guarded callback và uncertain-outcome lock.
4. `src/api/confirmedContract.js` — thêm đúng hai initiation POST; callback patterns có guard luôn false.
5. `src/components/customer/RentalLifecycleIntegration.jsx` — chọn component Self Storage theo flow, giữ route và Managed branches.
6. `src/components/customer/SelfStorageMockPayment.jsx` — chỉ thêm navigation cho ba trạng thái flow mới; không sửa legacy payment handler.
7. `tests/self-storage-staged-payment.test.mjs` — 22 unit/component fixture tests.
8. `tests/self-storage-staged-payment-browser.cjs` — browser fixture, chặn external API.
9. `docs/SelfStoragePaymentIntegration.md` — báo cáo này.

## Verification

- Syntax parse: 274 JS/JSX/TS/TSX sources PASS.
- `npm run build`: PASS; cảnh báo chunk >500 kB còn tồn tại.
- `npm test`: 72/72 PASS, gồm 22 tests mới và Managed regressions.
- `node --test tests/managed-warehouse-booking.test.cjs`: 3/3 PASS.
- Self Storage staged browser: PASS, 56 fixture API requests, 7 initiation POST, **0 confirmation POST**, 0 live requests. Test 320/390/768/1024/1440/1920 px; navigation, proof gate, double click, errors, reconcile, không fallback.
- Managed Balance browser: PASS, 51 fixture requests, 1 initiation và 2 mock-confirm fixtures (503 retry), 0 live requests.
- Legacy Self Storage browser: PASS, 176 fixture requests. Dùng runner cũ với RESERVED bỏ khỏi danh sách legacy (được kiểm thử riêng bằng staged runner); không chụp đè screenshot cũ. Test signing/navigation, errors, payment/refresh, old PAID reload.
- Tests confirmation thành công của component mới dùng policy injected chỉ trong test; **không chứng minh callback đã được bật hoặc runtime payment đã hoàn tất**.
- Không claim live E2E PASS. Không xác minh database indexes, deployment environment, real ledger integrity hay zero-amount settlement bằng API thật.

## Cần bổ sung trước khi mở confirmation

Cần bằng chứng/config xác nhận Backend development được phép mock; khi có căn cứ thì xác định cơ chế gate rõ ràng mà production không thể bật, đồng bộ policy/helper/allowlist và kiểm thử lại. Không tự bật chỉ từ một Frontend dev flag. Backend không có idempotent callback replay hoặc transaction trong source hiện tại; giới hạn này phải được giữ rõ, không tự sửa Backend hoặc retry callback. Không có production payment-provider contract để tích hợp.

## Xác nhận FAIL CLOSED sau phản hồi của chủ dự án

**BACKEND DEPENDENCY — mock-confirm chưa khả dụng; không đánh dấu tích hợp toàn bộ đã hoàn tất.** Chủ dự án xác nhận chưa có bằng chứng/config bổ sung và yêu cầu giữ khóa đến khi Backend có environment gate được xác minh. Không chỉ cần một lời xác nhận môi trường development; cần kiểm chứng gate thực tế cho cả hai endpoint.

Kết quả kiểm tra runtime: policy luôn false; helper ném lỗi trước Axios; allowlist từ chối POST tới cả hai Self Storage mock-confirm. UI development disabled, production không hiển thị nút. NODE_ENV=development, Vite DEV và các cờ mock của Self Storage/Managed đều không mở khóa. Logic callback và initiation được giữ nguyên; không sửa code runtime ở lượt kiểm tra này.

Backend cần bổ sung hoặc xác nhận trước khi xem xét mở khóa:

1. Gate phía server áp dụng cho **cả deposit/mock-confirm và balance/mock-confirm**, mặc định tắt; từ chối trước mọi thao tác ghi khi không được bật. Tên cờ/config và response lỗi phải được Backend xác nhận, Frontend không tự đặt tên contract.
2. Gate từ chối trong production ngay cả khi cờ enable bị đặt nhầm. NODE_ENV=development đơn lẻ không đủ. Cần bằng chứng source/config triển khai và fixture/test chứng minh bật/tắt/production-denied.
3. Xác nhận deployment development được phép mock và dùng database test riêng được phép ghi; không gửi secrets qua chat. Việc xác minh này chưa cho phép Frontend tự chạy live mutation.
4. Xác nhận ownership/role, RESERVED cho deposit và hợp đồng SIGNED + signedProofUrl cho balance vẫn được kiểm tra trong môi trường bật gate. Không gọi endpoint Staff từ Customer.
5. Xác nhận contract retry/reconciliation: source hiện không nhận client idempotency key, tự sinh timestamp key và không có transaction bao trùm payment/reservation/contract. Nếu Backend chưa bổ sung replay/atomicity, Frontend phải giữ chế độ callback một lần và khóa sau kết quả chưa rõ; không thể tuyên bố retry an toàn hoặc bảo đảm đa thiết bị chỉ bằng localStorage.
6. Xác nhận unique indexes thực tế đã tồn tại và cách xử lý duplicate/partial write, cùng chính sách zero-amount (hiện chưa có đường settlement hợp lệ).

Các điều kiện 1–3 là dependency để cân nhắc mở mock development; các điểm 4–6 phải có contract rõ trước khi tuyên bố workflow an toàn/hoàn tất. Không sửa Backend để thực hiện các đề xuất này trong task Frontend. Không tự thêm hoặc bật Vite flags. Chỉ thay đổi gate Frontend trong một lần triển khai được cho phép sau khi đã kiểm chứng Backend gate.

Lượt kiểm tra này chỉ sửa báo cáo và thêm hai regression tests: flags không bypass policy/helper/allowlist, và gọi trực tiếp disabled onClick vẫn không gửi callback. Không chạy live payment mutations.

Kết quả kiểm tra lại sau chỉ đạo FAIL CLOSED: `node --test tests/self-storage-staged-payment.test.mjs` **24/24 PASS**; `npm test` **74/74 PASS**. Chỉ chạy unit/fixture, không chạy live API. Không chạy lại production build vì lượt này không thay đổi runtime source/config/dependency. Số 72/72 ở mục Verification phía trên là kết quả lần tích hợp trước.
