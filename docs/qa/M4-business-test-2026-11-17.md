# Kiểm thử nghiệp vụ M4 — 17/11/2026

## Phạm vi đã chạy

Chạy API thật trên backend Render với bộ dữ liệu **mô phỏng TEST-M4 ở database test / HCM 1** đã được người dùng cho phép. Thanh toán, ký giấy và hàng vật lý là dữ liệu mô phỏng; không nghiệm thu PayOS, upload Cloudinary, ký giấy thực hoặc xác minh khách có mặt thực. Backend tự chạy chức năng gửi email PIN khi bàn giao; lượt này chưa xác nhận email đã tới hộp thư.

Các thao tác ghi được thực hiện qua API bằng đúng tài khoản Customer, Staff và Manager. Sau đó mở giao diện Manager để đối chiếu tồn, lịch sử và phiên đã đóng. **Không phải toàn bộ thao tác đã bấm qua giao diện Staff/Customer.** Không sửa mã nguồn backend, không commit/push.

## Kết quả theo issue

| Issue | Ca đã chạy | Kết quả | Giới hạn nghiệm thu |
| --- | --- | --- | --- |
| 027 | Thiếu xác nhận hiện diện; mở phiên INBOUND; đóng phiên; thử nhập mới bằng phiên đã đóng | Thiếu xác nhận → 400 ATTESTATION_REQUIRED; đủ xác nhận mô phỏng → 201; phiên đúng 60 phút; đóng → 200; dùng lại phiên đã đóng → 409 ACCESS_SESSION_SCOPE_INVALID | Chưa chờ đủ 60 phút để thử hết hạn tự nhiên; chưa chạy thu hồi/khác cơ sở trong lượt này. |
| 028 | Staff bàn giao Managed CHECKIN_READY; thử UNSAFE; gọi lại | UNSAFE → 409; GOOD → 200 ACTIVE; lưu đúng Staff và thời điểm; gọi lại vẫn cùng handoverAt, không tạo lần thứ hai | Đầu vào hợp đồng/thanh toán là fixture. Chưa nghiệm thu vòng tạo/thanh toán/ký/upload thật. |
| 029 | Thiếu xác minh danh tính; bàn giao Self; PIN sai/đúng; gọi lại bàn giao | Thiếu xác minh → 422; bàn giao → 200 ACTIVE, kho OCCUPIED, PIN 6 số; sai PIN → 401, đúng PIN → 200 UNLOCK_SUCCESS | **Có lỗi phản hồi gọi lại bàn giao** mô tả bên dưới. Chưa xác nhận email PIN đã nhận. |
| 031 | Nhập 10, gửi lại cùng khóa; thử ô ngoài phân bổ; xuất 3; xuất vượt tồn; chuyển 2 | Nhập 201, replay không cộng tồn; ô ngoài đơn bị chặn; xuất vượt tồn bị chặn; preview xuất/chuyển 200 nhưng **confirm đều 400** | **Bị chặn backend, chưa hoàn tất chuỗi nhập → xuất → chuyển.** |
| 033 | Manager phân công lịch OUTBOUND/RELOCATION; Staff check-in/đóng; Staff nghiệm thu trả kho Self; Manager đọc lại hợp đồng | Phân công 200, mở phiên 201, đóng 200; trả kho 200 CHECKED_OUT, yêu cầu COMPLETED, hợp đồng TERMINATED, kho AVAILABLE; nghiệm thu lặp bị chặn 400 | Chưa kiểm đủ toàn bộ bộ lọc/hàng chờ Manager hoặc phạm vi cơ sở khác. Lịch bổ sung là fixture, không phải ca đặt lịch qua API. |

## Diễn biến chính — giờ Việt Nam

1. **19:43:23** mở phiên INBOUND `6afc4becf34e91673ab514ee`; hạn **20:43:23**, đúng 60 phút.
2. **19:44:12** Customer nhập 10 thùng vào C1; tạo duy nhất movement ADD `6afc4c1cf34e91673ab514f3`. Gửi lại đúng khóa trả `replayed=true`, cùng movement.
3. **19:44:51** Staff bàn giao Managed đơn 028; chuyển ACTIVE, gọi lại không đổi handoverAt.
4. **19:45:21** Staff bàn giao Self đơn 029; cấp PIN 6 số. Mở sai PIN thất bại, đúng PIN thành công.
5. **19:46:00** đóng INBOUND; dùng lại phiên cho yêu cầu nhập mới bị chặn.
6. Thêm một lịch OUTBOUND TEST-M4 đang trong giờ bằng công cụ fixture, Manager thực sự phân công qua API rồi Staff check-in lúc **19:46:54**. Preview xuất 3/10 thành công, nhưng confirm lỗi 400; không có REMOVE. Đóng phiên **19:48:17**.
7. Tương tự thêm lịch RELOCATION TEST-M4; Manager phân công và Staff mở phiên lúc **19:48:52**. Preview chuyển 2 từ C1 sang C2 thành công, nhưng confirm lỗi 400; không có MOVE. Đóng phiên **19:49:33**.
8. **19:49:45** Staff nghiệm thu trả kho Self đơn 033: CHECKED_OUT, hợp đồng TERMINATED do trả sớm, kho AVAILABLE. Không chuyển/hoàn tiền.

Hai lịch bổ sung chỉ dùng để thử thao tác trong phiên ngay lúc chạy, không thay đổi lịch thật, lịch gốc ngày mai, giờ hệ thống hay điều kiện backend. Không coi việc seed lịch hiện tại là kiểm thử thành công tính khả dụng/đặt lịch Customer.

## Lỗi cần chuyển backend

### 1. Xác nhận xuất V3 luôn báo skuId không hợp lệ với SKU hợp lệ

- URL: `POST /api/v1/inventory-items/d9b7c1de2c3112e7a0fef036/v3/outbound`.
- Customer chủ đơn, phiên OUTBOUND ACTIVE đúng scope, revision SKU 1 và session 0, tồn 10, xuất 3; preview cùng dữ liệu trả READY / 200.
- Confirm trả **400**, `code=INVALID_INPUT`, `message=skuId không hợp lệ.`; gửi lại cùng khóa vẫn 400.
- Local code cho thấy `confirm` đổi chuỗi SKU thành ObjectId rồi truyền vào `directOwnedSku`; hàm này lại gọi bộ kiểm tra `oid` chỉ nhận chuỗi. Đây là nguyên nhân phù hợp với lỗi Render; không phải thiếu quyền Staff hay dữ liệu số lượng.
- Vị trí: `backend/src/services/inventory-items/managed-inventory-v3-outbound.service.ts`: `oid` dòng 40, `directOwnedSku` dòng 190/192, `confirm` dòng 376/378; nhánh transaction còn truyền ObjectId vào `loadDirectCandidateState` dòng 384. Backend cần thống nhất kiểu ID cho tất cả nhánh, kiểm tra commit và replay, không chỉ sửa controller.

### 2. Xác nhận di chuyển V3 gặp cùng lỗi kiểu SKU

- URL: `POST /api/v1/inventory-items/d9b7c1de2c3112e7a0fef036/v3/relocation`.
- Phiên RELOCATION ACTIVE, nguồn C1/đích C2 đều thuộc đơn; preview 200 READY, sức chứa đủ.
- Confirm trả **400 INVALID_INPUT — skuId không hợp lệ.**
- Local code: `backend/src/services/inventory-items/managed-inventory-v3-relocation.service.ts`: `oid` dòng 36, `ownedSkuForHistory` dòng 69/71, `confirm` dòng 301/302 đổi ObjectId rồi truyền vào hàm đòi chuỗi. Backend cần sửa đường truyền kiểu ID, kiểm thử MOVE và replay.

### 3. Gọi lại bàn giao Self trả trạng thái cấp quyền sai

- Lần đầu `POST /reservations/a1d6f1c828a859df4642ca2d/handover` trả 200, `accessProvisioning.status=SIMULATED`, PIN đủ 6 số.
- Lần gọi lại trả 200 nhưng thông báo **“Quyền truy cập số chưa được cấp”**, `accessProvisioning.status=UNAVAILABLE`, không trả PIN ở cùng vị trí như lần đầu.
- Thực tế PIN vẫn lưu trong đơn và Customer mở cửa mô phỏng thành công ngay sau đó.
- Backend cần trả kết quả replay nhất quán với quyền đã cấp; giữ nguyên actor/thời gian và không gửi thêm email hoặc tạo PIN khác.

### Ghi nhận cần làm rõ, chưa kết luận mất/sai tồn

- GET cell-stock trả đúng 10 thùng, 10 kg, 0,080 m³; `ledgerStatus=REPLAYED` nhưng `reconciliationStatus=UNKNOWN`, lý do `CANONICAL_LEDGER_OR_PROJECTION_UNVERIFIED`.
- GET outbound/context lại trả `reconciliationStatus=RECONCILED` cho cùng SKU. Backend cần làm rõ hai cấp đối soát hoặc thống nhất trạng thái; lượt này không thấy sai số lượng hay counter.

## Đối chiếu trạng thái cuối

- Managed 027/031: ACTIVE; **10 thùng tại C1**, 10 kg, 0,080 m³; usedCapacityM3=0,08.
- Ô C2: 0; C3 (đơn 028): 0. Chỉ **một ADD**, không có REMOVE/MOVE; lỗi confirm chưa làm thay đổi tồn.
- Managed 028: ACTIVE, bàn giao bởi Staff `dattpse182773`.
- Self 029: ACTIVE, kho OCCUPIED; PIN mô phỏng đã cấp, không đưa PIN vào báo cáo.
- Self 033: CHECKED_OUT, yêu cầu trả COMPLETED, hợp đồng TERMINATED, kho AVAILABLE.
- Ba phiên test đều CHECKED_OUT, **không còn phiên test ACTIVE**. Lịch OUTBOUND gốc ngày 18/11 vẫn chưa phân công, không bị thay đổi.

Giao diện Manager đã đối chiếu:

- **Hàng hóa và tồn kho → Xem tồn và lịch sử**: tổng 10, đơn vị Thùng, lịch sử chỉ một lần Nhập hàng lúc 19:44:12.
- **Lịch đến kho và phiên truy cập**: 3 lượt hoàn tất, 3 phiên đã rời kho, đang hoạt động 0.
- Nhãn SKU vẫn “Đã đăng ký” trong khi tồn là 10: trạng thái hồ sơ đăng ký khác số lượng vật lý; không dùng nhãn này để suy ra tồn bằng 0.

## Bằng chứng và cập nhật tracker

- Nhật ký API đã lược bỏ PIN: `artifacts/TEST-M4-20261117-run.json`.
- Đọc lại DB cuối lượt: `artifacts/TEST-M4-20261117-final.json`.
- Bộ ban đầu 26 bản ghi; lượt chạy phát sinh thêm lịch, phiên, biến động và access log qua nghiệp vụ, xem ID trong nhật ký trước khi dọn. Không chạy lại seed để reset kết quả.
- **027:** Chờ QA bổ sung hết hạn tự nhiên/thu hồi/phạm vi; phần mở/đóng và chặn sau đóng đã đạt.
- **028:** Ca bàn giao với fixture đã đạt; chờ nghiệm thu đầu vào thật nếu yêu cầu bao gồm payment/giấy ký.
- **029:** Có lỗi backend phản hồi replay; ca cấp PIN và mở cửa đã đạt.
- **031:** Bị chặn BE — confirm xuất và di chuyển trả 400; nhập/chống trùng đã đạt.
- **033:** Các ca phân công và trả kho đã đạt; chưa đánh dấu toàn bộ issue hoàn tất chỉ dựa trên các ca này.
