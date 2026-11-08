# WDP — PayOS production error 214

Ngày 08/11/2026 · `WDP_PAYOS_PROVIDER_214_INVESTIGATION` · `REVIEW_REQUIRED`

**Đã xác nhận điểm lỗi.** Log Render do người dùng cung cấp, correlation `4ca4ffa7f22d57b1`, cho thấy `PROVIDER_CREATE`, SDK `APIError`, provider HTTP `200` và business code `214`. POST của WDP trả 503 `PAYOS_CHECKOUT_OUTCOME_UNKNOWN`. Với SDK 2.0.5 và source `9149930`, tổ hợp này được tái hiện chính xác khi PayOS trả envelope business non-success. SDK throw trước khi WDP nhận checkout DTO hợp lệ. **Ý nghĩa nghiệp vụ cụ thể của mã `214` là UNKNOWN.** Chưa có provider `desc` của giao dịch thật, revision Render hoặc bằng chứng đối soát.

## Revision và nguồn bằng chứng

| Hạng mục | Trạng thái |
| --- | --- |
| Git local | Worktree WDP, branch `Frontend`, HEAD `eb2bbfca1a3060426c1934fdc2747e642391ec3e`. `origin/dev` local là `9149930d718d138f741881da9c64812edf56d45c`. Backend tree giống nhau theo `git diff --name-status 9149930 HEAD -- backend`. |
| Runtime Render | `DEPLOYMENT_UNVERIFIED`. Log khớp cấu trúc chẩn đoán có trong commit `e9cf662` và snapshot `9149930`. Một format log có thể tồn tại ở nhiều commit, nên không đủ để suy ra SHA. Chưa có quyền dashboard hoặc incident timestamp để xác minh bản Live lịch sử. |
| SDK | Manifest/lock snapshot quy định `@payos/node` `^2.0.5` / `2.0.5`. Fixture đã dùng package 2.0.5 thực tế. Phiên bản installed trên Render chưa được xác minh. |
| Customer Website | Trace local `eb2bbfc`. Client, payment screen và eligibility helper liên quan khớp `9149930`. Build SHA Website production chưa được xác minh. |

Chủ Render vào service → **Deploys**, lấy SHA và mốc UTC của bản Live chạy **lúc lỗi**, hoặc image digest kèm SHA build nếu dùng image. Đối chiếu mốc đó với dòng log correlation và bản ghi build về SDK installed. Bản deploy mới nhất chỉ hữu ích nếu chứng minh cũng phục vụ request sự cố. [Render Deploys](https://render.com/docs/deploys) · [Render Logs](https://render.com/docs/logging).

## Từ HTTP 200 đến lỗi checkout

1. `backend/src/services/payments/payos-payment.service.ts:104–118` khởi tạo SDK bằng cấu hình server và gọi `paymentRequests.create(data,{maxRetries:0})`. SDK `lib/resources/v2/payment-requests/payment-requests.js:20–25` POST `/v2/payment-requests` với chữ ký. WDP truyền amount VND từ intent, orderCode gốc, description và return/cancel URL. [PayOS Create Payment Link](https://payos.vn/docs/api/) · [PayOS Node SDK](https://payos.vn/docs/sdks/back-end/node/).
2. SDK `lib/client.js:284–332` kiểm HTTP status rồi parse JSON. Với HTTP 200, SDK vẫn gọi `makeStatusError` nếu `code !== '00' || !data`. `lib/core/error.js:7–16,43–63` lưu `status`, `code`, `desc`; status 200 đi vào nhánh `APIError` mặc định. Code `214` khác `00` nên nhánh này đủ để throw trước khi trả data hay qua bước kiểm chữ ký của success response. Mã provider ở đây không phải HTTP status. Tài liệu PayOS minh họa success bằng `code: "00"` với checkout data. Tìm trực tiếp `214` trong API reference, Node SDK guide và FAQ công khai không thấy định nghĩa. [PayOS API](https://payos.vn/docs/api/) · [PayOS FAQ](https://payos.vn/docs/cau-hoi-thuong-gap/).
3. `createProviderLink:582–610` đã claim intent từ NOT_CREATED sang CREATING trước khi await gateway. Stage chỉ chuyển `PROVIDER_RESPONSE_VALIDATION` khi gateway resolve. `PROVIDER_CREATE` kèm APIError 200/214 phù hợp với throw **tại await SDK**, trước validation link của WDP và trước `PERSIST_CHECKOUT_LINK:636`. `providerResponseReceived:true` trong log do catch thấy HTTP status hợp lệ ở `:656–660`; cờ này xác nhận SDK có metadata phản hồi, không xác nhận checkout DTO thành công.
4. `classifyProviderCreateError:167–192` xử lý các status HTTP 401/403, 400/422, 429 và tín hiệu timeout/network. HTTP 200 với code business không có nhánh riêng, nên rơi vào `PAYOS_PROVIDER_UNKNOWN_ERROR`. `logCheckoutDiagnostic:194–208` chỉ giữ field allowlist, không xuất `desc`. `createProviderLink:649–665` cố cập nhật CREATING → UNKNOWN và trả 503. Việc ghi UNKNOWN là best effort. `persistenceConfirmed:false` không phủ định intent đã lưu, cũng không xác nhận trạng thái DB hiện tại.
5. HTTP 200 của provider xác nhận transport trả được phản hồi. Business non-success làm SDK reject. Checkout READY cần DTO hợp lệ và write/readback thành công. Tiền nhận và áp dụng là hai trạng thái riêng, theo signed webhook và transactional application tại `handleWebhook:780–958`. Không suy ra link tồn tại hoặc funds đã được thu từ mã `214`.

**Mức tin cậy.** Cao cho failure stage và cơ chế SDK business-envelope rejection, dựa trên log incident cùng fixture tái hiện. UNKNOWN cho ý nghĩa `214`, nguyên nhân nghiệp vụ upstream, trạng thái tiền và deployment/config cụ thể. Không có dấu hiệu timeout transport hay write READY failure là lỗi phát sinh đầu tiên của log này.

## Đối soát và cấu hình

**Payment chưa đối soát.** Chưa có quyền read-only vào DB hoặc PayOS channel, nên chưa biết Payment ID/orderCode, amount/currency, checkoutState hay settlement/application thực tế. DEPOSIT phù hợp với flow và UI do người dùng cung cấp, cần đối chiếu record. Với quyền được duyệt, operator tìm intent theo reservation + owner + PAYOS + DEPOSIT quanh incident timestamp, ghép bằng `sha256("PAYOS_CHECKOUT:" + paymentId).slice(0,16)` (`payos-payment.service.ts:147–148`). Đọc `providerReference` (orderCode gốc), purpose, amount/currency, status, checkoutState, settlement/application, presence link, timestamps và webhook/capture evidence. Giữ các identifier đầy đủ trong kênh vận hành hạn chế.

Chủ kênh PayOS tra **orderCode gốc** trong dashboard hoặc GET `/v2/payment-requests/{id}` với quyền chỉ đọc. Xin **`desc` tương ứng mã `214` của request create tại mốc UTC đó**, hoặc diễn giải chính thức đã lọc qua hỗ trợ PayOS. Cần thêm provider request reference nếu có và kết quả lookup link, status, `amountPaid`, cùng xác nhận order/amount/link có khớp hay không. Không lấy `desc` của một GET thất bại khác để diễn giải POST. Không chia sẻ raw body, request header, credentials, signature, URL/QR, dữ liệu ngân hàng hoặc Customer. [PayOS API và kênh hỗ trợ](https://payos.vn/docs/api/).

**GET detail của WDP được bỏ qua.** `getCustomerStatus:710–745` có thể ghi DB và chạy `reconcileCheckoutState:669–707`. GET history `:747–777` chỉ đọc trong snapshot nhưng audit chưa xác nhận deployment và owner authorization nên không gọi. Không dùng checkout POST hoặc key mới để tìm Payment ID. Replay nội bộ chỉ có thể tra order cũ khi UNKNOWN. PENDING thiếu URL gốc cần reconciliation, không dựng lại link. Lỗi lookup hoặc mã 214 không phải bằng chứng không thu tiền.

**Config production chưa xác minh.** Source `:63–119,327–346` kiểm gate, presence của `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` và URL của `PAYOS_CUSTOMER_ORIGIN`, `PAYOS_WEBHOOK_URL`. Nếu runtime khớp source, log PROVIDER_CREATE nghĩa là preflight local đã qua. Điều đó không chứng minh ba credential cùng đúng kênh hoặc quyền/kênh đang hoạt động. Operator kiểm presence, cùng channel và đúng môi trường qua kho secret được duyệt, origin HTTPS và quyền tạo link/status channel trong PayOS Dashboard. Kiểm host hiệu lực nếu SDK nhận `PAYOS_BASE_URL` override. Chỉ gửi verdict đã lọc. Hạn chế kênh là giả thuyết cho đến khi có `desc` hoặc xác nhận PayOS.

## Website và đề xuất Backend

Local Website gửi `{purpose:"DEPOSIT"}` cho deposit, cùng `Idempotency-Key` đã lưu trước POST (`payosPaymentClient.js:119–134`, `SelfStoragePayosCheckout.jsx:430–513`). Busy ref chặn double click cùng mount. SessionStorage giữ key khi reload cùng tab/origin và Backend chặn intent unresolved cross-tab. HTTP 503 giữ UNKNOWN và refresh history, không tự POST hay tạo payment thay thế (`SelfStoragePayosCheckout.jsx:531–590`). Chỉ hiện/tiếp tục link server trả cho payment PENDING/READY đủ điều kiện. Không thấy defect Website gây incident. [Trace Website đầy đủ](PAYOS_FRONTEND_EXECUTION_TRACE.md).

**Đề xuất Backend chỉ cho diagnostics.** Ở `classifyProviderCreateError`, thêm category nội bộ cho `APIError` HTTP 2xx có business code đã lọc, ví dụ `PAYOS_PROVIDER_BUSINESS_NON_SUCCESS`. Không gán ý nghĩa riêng cho `214` đến khi có xác nhận. Log chỉ category và safe code. Không dump `error`, `error.message` hoặc `desc` thô vì SDK có thể gắn payload. Giữ public 503 UNKNOWN, cùng key/order và reconcile; không đổi thành FAILED, không mở retry. Test 2xx non-success, 2xx thiếu data, các nhánh 4xx/timeout và log redaction. Nếu thay đổi telemetry có vấn đề, rollback riêng category và giữ trạng thái payment. Sửa nguyên nhân upstream còn chờ `desc` và đối soát.

## Kiểm thử

- Backend **69/69**, gồm 68 regression hiện có và một fixture tạm dùng chính SDK 2.0.5. Fake HTTP 200, code 214, data null và `desc` synthetic tái hiện đúng APIError, stage, category và cờ trong log. Fixture xác nhận một lần gọi fake create, không có checkout URL, UNKNOWN giữ orderCode, lookup không có kết quả giữ UNKNOWN và PENDING thiếu URL giữ reconciliation. Cả hai lookup không tạo lần thanh toán mới.
- Lệnh Backend trong snapshot tạm `9149930` là `node --require <temp>/no-network.cjs --import tsx --test tests/payos-214-audit-fixture.test.cjs`. Preload chặn socket/TLS/HTTP/fetch thật và bỏ credential env. Chỉ test fake fetch cung cấp phản hồi. Lượt đầu test mới thiếu bộ credential synthetic nên 68 qua và 1 fail ở preflight; thêm giá trị giả vào setup tạm rồi chạy lại 69 qua. Không thêm test file vào repo.
- Website **41/41**, `node --test tests/payos-checkout.test.mjs tests/customer-payment-load.test.mjs`. Xác minh contract, stable key, history/status, READY-only và 503 recovery không POST tiếp. Không chạy live provider, app payment-detail, history, DB, deploy hay sửa application source.

```text
[C2C]
TASK_ID: WDP_PAYOS_PROVIDER_214_INVESTIGATION
STATE: REVIEW_REQUIRED
RENDER_SHA: DEPLOYMENT_UNVERIFIED
SDK_ERROR: APIError
PROVIDER_HTTP_STATUS: 200
PROVIDER_ERROR_CODE: 214
PROVIDER_ERROR_MEANING: UNKNOWN
FAILURE_STAGE: PROVIDER_CREATE
ROOT_CAUSE: SDK REJECTED PROVIDER BUSINESS NON-SUCCESS ENVELOPE; UNDERLYING 214 REASON UNKNOWN
CONFIDENCE: HIGH FOR FAILURE MECHANISM; UNKNOWN FOR UPSTREAM BUSINESS CAUSE
PAYMENT_RECONCILED: NO
BACKEND_FIX_REQUIRED: UNDERLYING FIX UNDETERMINED; DIAGNOSTICS IMPROVEMENT PROPOSED
FRONTEND_FIX_REQUIRED: NO DEFECT IDENTIFIED
LIVE_PAYMENT_POST_REQUESTS: 0
SOURCE_CHANGES: NONE
NEXT_RECOMMENDATION: OBTAIN INCIDENT LIVE SHA AND SANITIZED 214 DESC; LOOK UP ORIGINAL ORDER READ-ONLY
```
