# PayOS Postman — BE-REF

## 1. Chuẩn bị MongoDB test riêng

Dùng Node.js 22 và MongoDB replica set local. Nếu instance ở 127.0.0.1:27019 đã hoạt động, dùng instance đó sau khi xác nhận đây là môi trường test riêng. Nếu cần tạo instance mới bằng Docker Desktop:

```powershell
docker run -d --name wdp-payos-mongo-test -p 127.0.0.1:27019:27017 mongo:8 --replSet wdp-pay-mock --bind_ip_all
docker exec wdp-payos-mongo-test mongosh --quiet --eval 'rs.initiate({_id:"wdp-pay-mock",members:[{_id:0,host:"localhost:27017"}]})'
docker exec wdp-payos-mongo-test mongosh --quiet --eval 'db.hello().isWritablePrimary'
```

Chờ MongoDB sẵn sàng trước khi chạy lệnh khởi tạo. Lệnh cuối phải trả true trước khi khởi động BE-REF.

## 2. Khởi động BE-REF với mock auth

Dừng tiến trình BE-REF cũ nếu đang chiếm cổng 5000. Trong một cửa sổ PowerShell riêng:

```powershell
Set-Location C:\Users\laptop\Desktop\WDP\BE-REF
$env:NODE_ENV = 'development'
$env:PORT = '5000'
$env:AUTH_MOCK_MODE = 'true'
$env:PAYOS_MOCK_MODE = 'true'
$env:PAYOS_ENABLED = 'false'
$env:MONGO_URL = 'mongodb://127.0.0.1:27019/wdp_payos_test?replicaSet=wdp-pay-mock&directConnection=true'
$env:PAYOS_CUSTOMER_ORIGIN = 'http://127.0.0.1:5000'
npm run build
npm start
```

Nếu chưa có node_modules, chạy npm ci --ignore-scripts --no-audit --no-fund trước build.

Khi AUTH_MOCK_MODE được đặt trong PowerShell như trên, BE-REF bỏ qua file .env và không nạp app Keycloak. Server bind 127.0.0.1, chỉ phục vụ nhóm route Customer PayOS, không có API login. Gate từ chối khởi động nếu thiếu PAYOS_MOCK_MODE, nếu live PayOS bật, hoặc nếu MongoDB không phải replica set local với database wdp_payos_test. Không cần Keycloak hay credentials PayOS.

Mỗi lần khởi động thành công, server tạo hai Customer riêng, một Reservation SELF_STORAGE ở CONTRACTED, một Contract DRAFT và in một dòng PAYOS_MOCK_POSTMAN trong terminal. Reservation đủ điều kiện DEPOSIT trong 24 giờ. Các token ngẫu nhiên chỉ có hiệu lực trong tiến trình đó. Giữ chúng trong Postman local, không sync hoặc chia sẻ log. Khởi động lại sẽ cấp fixture và token mới. Fixture và payment đã tạo vẫn nằm trong MongoDB test.

## 3. Gửi request bằng Postman

Dùng Postman Desktop hoặc Desktop Agent. Tạo local environment:

| Biến | Giá trị |
| --- | --- |
| baseUrl | http://127.0.0.1:5000/api/v1 |
| reservationId | reservationId từ dòng PAYOS_MOCK_POSTMAN |
| paymentAttemptKey | paymentAttemptKey từ cùng dòng |
| ownerToken | ownerToken của Customer A, đặt dạng sensitive |
| otherToken | otherToken của Customer B, đặt dạng sensitive |
| orderCode | Lấy từ response POST |

1. **Create.** Gửi POST {{baseUrl}}/reservations/{{reservationId}}/payments/payos. Đặt Authorization: Bearer {{ownerToken}}, Content-Type: application/json và Idempotency-Key: {{paymentAttemptKey}}. Body là {"purpose":"DEPOSIT"}. Kỳ vọng HTTP 201, outcome CREATED, checkoutStatus READY, status PENDING và checkoutUrl dạng https://payos-mock.invalid/checkout/<orderCode>. Lưu data.orderCode. URL này dùng để đối chiếu response.
2. **Lookup của chủ sở hữu.** Gửi GET {{baseUrl}}/reservations/{{reservationId}}/payments/payos/orders/{{orderCode}} với Bearer {{ownerToken}}. Kỳ vọng HTTP 200, cùng orderCode, paymentLinkId và amount, amountPaid bằng 0, providerStatus PENDING.
3. **Kiểm tra quyền.** Gửi lại GET trên với Bearer {{otherToken}}. Kỳ vọng HTTP 404. Bỏ token hoặc gửi token sai thì nhận 401.
4. **Replay.** Gửi lại POST với cùng token, body và key. Kỳ vọng HTTP 200, outcome REPLAYED, cùng orderCode và link. Để thử một lần 201 mới, khởi động lại để lấy fixture mới.

## 4. Kiểm thử tự động

```powershell
npm run build
node --test tests/payos-payment.test.cjs tests/payos-mock-http.test.cjs tests/payos-auth-mock-local.test.cjs
$env:WDP_PAYOS_LOCAL_E2E = '1'
node --test tests/payos-auth-mock-local.test.cjs
Remove-Item Env:WDP_PAYOS_LOCAL_E2E
```

Lệnh E2E opt-in khởi động một tiến trình mock riêng trên cổng loopback tạm, dùng đúng MongoDB test ở 27019, tạo fixture mới và chạy checkout/lookup qua HTTP. Test giữ lại dữ liệu giả lập trong database test để đối chiếu. Các test mặc định kiểm cấu hình từ chối, hành vi PayOS với fixture và không ghi MongoDB.

## Live test một lần với kênh VaultSpace-Test

PayOS công bố API thật không có sandbox riêng. Live test sử dụng API chính thức của PayOS với credentials của kênh riêng VaultSpace-Test, còn Customer, Reservation và payment intent nằm trong MongoDB local wdp_payos_test. Mục tiêu là kiểm tra tạo link, không cần chuyển tiền. Fixture DEPOSIT là 2.000 VND, theo ví dụ checkout của PayOS. [Môi trường test](https://payos.vn/docs/moi-truong-test/) · [Ví dụ checkout](https://payos.vn/docs/checkout/quick-start-payos-hosted-page/)

### Chuẩn bị và khởi động

Cần một orderCode tham chiếu đã tồn tại mà GET API có thể đọc bằng bộ credentials VaultSpace-Test. Chọn order test thuộc đúng kênh, không dùng payment UNKNOWN cũ. Nếu kênh mới chưa có order tham chiếu đọc được, bước preflight sẽ bị chặn. Khi đó lấy một order test từ Dashboard hoặc nhờ PayOS xác nhận order tham chiếu thuộc kênh. Chỉ sử dụng order đó nếu API GET trả đúng mã và chữ ký hợp lệ. [API lấy thông tin link](https://payos.vn/docs/api/)

Dừng BE-REF cũ nếu đang chiếm port 5000. Mở PowerShell riêng và nhập ba khóa của VaultSpace-Test qua prompt ẩn:

```powershell
Set-Location C:\Users\laptop\Desktop\WDP\BE-REF
$env:NODE_ENV = 'development'
$env:PORT = '5000'
$env:AUTH_MOCK_MODE = 'true'
$env:PAYOS_LIVE_TEST_MODE = 'true'
$env:PAYOS_MOCK_MODE = 'false'
$env:PAYOS_ENABLED = 'false'
$env:MONGO_URL = 'mongodb://127.0.0.1:27019/wdp_payos_test?replicaSet=wdp-pay-mock&directConnection=true'
$env:PAYOS_CUSTOMER_ORIGIN = 'http://127.0.0.1:5000'
$env:PAYOS_LIVE_TEST_PROBE_ORDER_CODE = Read-Host 'Order code tham chieu cua VaultSpace-Test'
$env:PAYOS_LIVE_TEST_CLIENT_ID = [System.Net.NetworkCredential]::new('', (Read-Host 'VaultSpace-Test Client ID' -AsSecureString)).Password
$env:PAYOS_LIVE_TEST_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'VaultSpace-Test API Key' -AsSecureString)).Password
$env:PAYOS_LIVE_TEST_CHECKSUM_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'VaultSpace-Test Checksum Key' -AsSecureString)).Password
npm run build
if ($LASTEXITCODE -eq 0) { npm start }
```

BE-REF bỏ qua .env khi bật live test từ PowerShell, bind 127.0.0.1 và không nạp Keycloak. SDK chỉ dùng ba biến PAYOS_LIVE_TEST tương ứng và endpoint chính thức. Chế độ này không nhận webhook và không chạy settlement. Khi dừng server, đóng cửa sổ PowerShell riêng để kết thúc phiên có biến môi trường.

### Gửi request

1. Lấy reservationId, paymentAttemptKey và ownerToken từ dòng PAYOS_LIVE_TEST_POSTMAN. Đặt baseUrl thành http://127.0.0.1:5000/api/v1. Giữ token trong Postman local. Các khóa PayOS chỉ có ở process BE-REF.
2. Gửi **GET {{baseUrl}}/reservations/{{reservationId}}/payments/payos/live-test/preflight** với Bearer {{ownerToken}}. Chỉ tiếp tục khi HTTP 200 và data.verified là true. GET xác minh khả năng đọc order tham chiếu và checksum của kênh. Nó không xác nhận quyền tạo link. Một lần GET 404, lỗi xác thực, chữ ký thiếu hoặc sai đều không mở POST.
3. Trong vòng 5 phút, gửi **một lần** POST {{baseUrl}}/reservations/{{reservationId}}/payments/payos với Bearer {{ownerToken}}, Content-Type: application/json, Idempotency-Key: {{paymentAttemptKey}} và body {"purpose":"DEPOSIT"}. Tắt retry tự động. Thành công trả 201 CREATED, checkoutStatus READY và link thật. Server chặn mọi lần POST tiếp theo trong phiên sau khi đã nhận một lần thử hợp lệ.
4. Tra cứu bằng **GET {{baseUrl}}/reservations/{{reservationId}}/payments/payos/orders/{{orderCode}}** với Bearer {{ownerToken}}. Lấy orderCode từ response 201 hoặc từ PAYOS_CHECKOUT_DIAGNOSTIC khi kết quả tạo link chưa xác định. Nếu nhận 503 UNKNOWN, giữ nguyên orderCode và dừng tạo link. Không khởi động lại để thử POST thay cho tra cứu order gốc.

Khi provider trả business code 214, log PAYOS_CHECKOUT_DIAGNOSTIC có category, correlationId, orderCode của fixture, HTTP status và providerErrorCode. providerDescription chỉ có nhãn an toàn cố định hoặc REDACTED/UNAVAILABLE. Không xuất raw response, chữ ký hoặc credentials. Chưa có ý nghĩa chính thức được xác minh cho mã 214.

### Kiểm thử tự động live test

```powershell
npm run build
node --test tests/payos-live-test-local.test.cjs
$env:WDP_PAYOS_LOCAL_E2E = '1'
node --test tests/payos-live-test-local.test.cjs
Remove-Item Env:WDP_PAYOS_LOCAL_E2E
```

E2E opt-in ghi fixture vào MongoDB test local. Bài test chặn transport SDK để mô phỏng phản hồi PayOS có chữ ký và mã 214, đồng thời chặn kết nối ra ngoài. Không sử dụng credentials của VaultSpace-Test trong test tự động.

## Đọc log mã 214

Tra `PAYOS_CHECKOUT_DIAGNOSTIC` theo correlation và timestamp. HTTP 200 với business code khác `00` được phân loại nội bộ `PAYOS_PROVIDER_BUSINESS_NON_SUCCESS`. `providerDescription` chỉ có nhãn cố định nếu exact match allowlist, còn lại `REDACTED` hoặc `UNAVAILABLE`. **Ý nghĩa chính thức của 214 vẫn UNKNOWN.** Lấy `desc` đã lọc của đúng request từ PayOS Dashboard/support theo UTC và order gốc. Không lấy từ một request thử lại. Không chia sẻ request/response thô.

WDP yêu cầu orderCode số nguyên dương, dùng dải nội bộ 10 chữ số cho order mới và unique index theo provider/order. Đây là policy WDP, không phải giới hạn int32 của PayOS. Amount là VND nguyên dương từ Backend, description ASCII 9 ký tự và return/cancel lấy từ trusted origin. SDK 2.0.5 ký request. Không suy ra hạn mức kênh hoặc lỗi credential chỉ từ 214. [PayOS API](https://payos.vn/docs/api/) · [PayOS SDK](https://payos.vn/docs/sdks/back-end/node/)

Trước khi bật provider thật, operator xác nhận DB test/Keycloak test, kênh và quyền, callback đúng origin, credentials mới nếu từng lộ, record test chưa có intent UNKNOWN và quyền chạy một POST duy nhất. Build/test thành công với fixture là MOCK_VERIFIED. LIVE_VERIFIED cần bằng chứng từ một thao tác được duyệt riêng.
