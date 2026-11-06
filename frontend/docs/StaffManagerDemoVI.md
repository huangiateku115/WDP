# Hướng dẫn cho giao diện tiếng Anh

## Managed Inventory V2 — kiểm chứng API ngày 02/11/2026

Kiểm chứng giao diện bổ sung: đơn `MIR-261102-947413` (`6ae8b981a2bf26d5e8947414`) đã chạy Pay Balance → PENDING; người dùng bấm Confirm simulated Balance → CHECKIN_READY. Staff mở `/staff/inventory/inbound/6ae8b982a2bf26d5e894741b?flow=managed-v2`, xác nhận placement và Confirm first inbound; giao diện đọc lại **ACTIVE / IN_STORAGE** thành công. Đã sửa route chi tiết inbound bị thiếu và khôi phục query `flow=managed-v2` cho hàng chờ first inbound. Các bước chuẩn bị deposit, item, inspection và ký hợp đồng của đơn này được thực hiện qua API, không được coi là toàn bộ luồng đã click bằng browser. Không dùng đơn ACTIVE này để nhập lần đầu lần nữa.

Đã bổ sung xác nhận Balance mô phỏng trên giao diện Customer: mở `/portal/payments/<reservationId>`, bấm **Pay Balance (MOCK)**, chờ receipt PENDING, chọn **Mock Confirm Balance** rồi **Confirm simulated Balance**. Nút chỉ hiện khi development và `VITE_ENABLE_MANAGED_BALANCE_MOCK=true`, đơn đúng Customer, hợp đồng hiện hành đủ hai chữ ký và khoản balance đang chờ được xác minh trong phiên hiện tại. Reload hoặc kết quả không rõ chỉ cho GET refresh. Backend phải trả CHECKIN_READY và frontend đọc lại mới xác nhận hoàn tất. Đơn mẫu bên dưới đã trả balance nên sẽ không cho thanh toán lại. Kiểm tra lượt bổ sung: build PASS, 25/25 tests PASS; chưa chạy nút Balance mới bằng trình duyệt với một đơn PENDING mới.

Đơn demo `MIR-261102-9473D9` (`6ae875fea2bf26d5e89473da`) thuộc Ho Chi Minh Facility 3. Customer `pdat0703@gmail.com` đã tạo đơn cho Cell `MI-DEMO-R01-L4-C4`, trả deposit mô phỏng 3.600đ và balance mô phỏng 14.400đ. Backend GET xác nhận trạng thái hiện tại **CHECKIN_READY**. Hàng `DEMO-MI-261102-A` (`6ae8762da2bf26d5e89473e5`) đã được Staff kiểm nhận ACCEPTED, đang **RECEIVED_PENDING_ACCEPTANCE**. Hợp đồng `CTR-MIR-261102-9473D9` đã có chữ ký Customer và Facility Staff trên cùng phiên bản 1.

Luồng trình bày: Customer mở `/portal/reservations/6ae875fea2bf26d5e89473da` để xem deposit và trạng thái đơn; Staff mở `/staff/inventory/inbound/6ae8762da2bf26d5e89473e5?flow=managed-v2` để xem biên bản nhận hàng và mục **First inbound confirmation**. Mục này dùng API `POST /inventory-items/:id/confirm-inbound` và chỉ xác nhận thành công khi backend cho phép nhập kho trong thời hạn thuê. Đơn bắt đầu **10/11/2026** nên lần kiểm chứng ngày 02/11 trả **409**; chưa có trạng thái ACTIVE hoặc hàng IN_STORAGE. Không bấm lặp lại để cố vượt điều kiện ngày.

Thanh toán trên đây đều là MOCK development, không phải giao dịch thật. Backend local cần `MI_MANAGED_DEPOSIT_FLOW_ENABLED=true`; frontend cần `VITE_ENABLE_MANAGED_DEPOSIT_MOCK=true` cho nút xác nhận deposit mô phỏng. Hai cờ đã được đặt trong file cấu hình local bị Git bỏ qua; môi trường khác phải cấu hình riêng. Build và 22/22 test frontend đạt; chưa kiểm chứng thao tác nút mới trong trình duyệt hoặc ảnh Cloudinary thật.

---

Bản hướng dẫn hiện hành: [StaffManagerWorkflowDemo.docx](StaffManagerWorkflowDemo.docx), gồm 8 trang phân biệt quyền, các trang chồng lặp, đường dẫn và thao tác demo bằng tên nút tiếng Anh. Các nhãn tiếng Việt trong phần lịch sử bên dưới không còn khớp giao diện hiện tại.

Staff và Manager dùng chung dữ liệu; Manager duyệt đặt chỗ/phân công, Staff xử lý vận hành. Check-in và Inspection hiện còn chồng lặp giao diện; không demo lặp thao tác. Chưa thay đổi quyền hay bỏ trang trong lượt đổi ngôn ngữ.

Kiểm chứng: 14/14 test, 5 bộ browser fixture và build PASS. Không xác nhận live database hoặc Cloudinary trong lượt này. Nội dung khách nhập và dữ liệu lịch sử giữ nguyên ngôn ngữ.

---

# Cập nhật ngày 26/10/2026

Đã bổ sung bảng công việc và mô phỏng truy cập dùng API. Xem [phạm vi triển khai và giới hạn backend](StaffManagerImplementation.md).

- Manager: `/manager/operations` xem việc theo ngày, `/manager/tasks` mở ticket để phân công.
- Staff: `/staff/tasks` xem việc và ticket được giao.
- Hai vai trò: `/manager/access` hoặc `/staff/access`, chọn đơn ACTIVE, nhập PIN mô phỏng, xác nhận gửi. Đây là mô phỏng phần mềm.
- Đã sửa lỗi nhận kho đọc contract trước khi khởi tạo và khôi phục ba API hợp đồng giấy bị mất trong allowlist sau merge.
- Không dùng phần hướng dẫn mock/lịch sử bên dưới để khẳng định hoàn tiền, gia hạn hay phí phát sinh đã có API.
- Word ngày 22/10 là kịch bản cũ, chưa chứa các trang mới này. Lượt 26/10 kiểm tra bằng fixture, chưa xác minh lại Cloudinary/database thật.

---

# Kiểm thử demo thực tế — 22/10/2026

- Backend health: database connected. Đã đăng nhập Manager và Staff bằng trình duyệt.
- PASS dữ liệu thật: Manager duyệt đơn; Customer ký và mock-pay để chuẩn bị; Staff tạo/hoàn tất CHECK_IN, rồi CHECK_OUT. Đã kiểm tra ACTIVE/OCCUPIED và CHECKED_OUT/AVAILABLE.
- PASS dữ liệu thật: tạo, phân công và xử lý maintenance/support đến CLOSED; gửi ghi chú nội bộ và đăng xuất cả hai vai trò.
- BLOCKED: upload hợp đồng giấy trả `cloud_name is disabled`. Cần người phụ trách backend/Cloudinary khôi phục dịch vụ ảnh. Frontend hiển thị lỗi rõ ràng; chưa xác nhận live luồng giấy → balance → handover.
- Chỉ dùng bản ghi thử mới trong lượt này. Đơn `BKG-261022-LLUY` đã CHECKED_OUT; không dùng lại để demo thao tác mới. Các ticket thử đã CLOSED.
- Hướng dẫn trình bày: `StaffManagerDemoTrenLop.docx`, gồm đường dẫn, dữ liệu nhập, thao tác và lời trình bày. Không lưu mật khẩu trong tài liệu.
- Các kết quả fixture và ghi chú lịch sử bên dưới không thay thế kết quả live ở mục này.

---

# Bản demo chỉ dùng API — sau khi kiểm tra dev, 22/10/2026

Đã chạy `git fetch origin` và `git pull --ff-only origin dev` trên nhánh làm việc Frontend. Kết quả Already up to date; HEAD và origin/dev cùng `a3b03fa`. Không có API backend mới từ dev trong lượt này. Giữ nguyên thay đổi frontend chưa commit.

## Các trang đang hiển thị

| Nội dung | Staff | Manager |
| --- | --- | --- |
| Khách hàng | [Mở](http://localhost:5173/staff/customers) | [Mở](http://localhost:5173/manager/customers) |
| Đặt chỗ và hợp đồng | [Mở](http://localhost:5173/staff/reservations) | [Mở](http://localhost:5173/manager/reservations) |
| Nhận kho luồng cũ | [Mở](http://localhost:5173/staff/check-ins) | [Mở](http://localhost:5173/manager/work/CHECK_IN) |
| Bàn giao hợp đồng giấy | [Mở](http://localhost:5173/staff/handovers) | [Mở](http://localhost:5173/manager/work/HANDOVER) |
| Biên bản hiện trạng | [Mở](http://localhost:5173/staff/inspections) | [Mở](http://localhost:5173/manager/work/INSPECTION) |
| Trả kho — vừa nối API | [Mở](http://localhost:5173/staff/checkouts) | [Mở](http://localhost:5173/manager/work/CHECKOUT) |
| Bảo trì | [Mở](http://localhost:5173/staff/maintenance) | [Mở](http://localhost:5173/manager/maintenance) |
| Hỗ trợ | [Mở](http://localhost:5173/staff/support) | [Mở](http://localhost:5173/manager/support) |

Trang mặc định/logo dẫn về Reservations. Dashboard, công việc/phân công tổng hợp, hoàn tiền, gia hạn, phí, báo cáo, kho/vị trí và inventory tạm ẩn trong hai workspace. Phân công ticket vẫn ở trang Maintenance/Support. Code cũ và workspace Customer/Admin/BOM giữ nguyên. Đây là giới hạn hiển thị tạm thời, không thay thế kiểm soát quyền backend. Cấu hình phạm vi nằm trong `src/lib/facilityWorkspace.js`.

## Demo trả kho mới

1. Sau khi đã bàn giao, mở trang **Trả kho** đúng vai trò ở bảng trên. Chọn một đơn Self Storage ACTIVE hoặc OVERDUE thuộc cơ sở; tủ phải OCCUPIED.
2. Chọn hiện trạng GOOD/EXCELLENT nếu tốt, DAMAGED nếu hỏng, NEEDS_CLEANING nếu cần dọn dẹp. Nhập ghi chú; có thể thêm tối đa ba URL ảnh đã lưu. Chưa có upload ảnh riêng cho Inspection này.
3. Tích checklist → **Lưu biên bản trả kho**. Backend tạo CHECK_OUT DRAFT, chưa đổi trạng thái đơn/tủ. Trang chi tiết dùng Inspection ID, không phải Reservation ID.
4. Kiểm tra lại hiện trạng trong trang chi tiết, tích checklist → **Hoàn tất trả kho → Xác nhận trả kho**.
5. Frontend đọc lại điều kiện và gọi `PATCH /inspections/<inspectionId>/complete`, sau đó đọc lại đơn/tủ. Kết quả cần thấy:
   - Đơn CHECKED_OUT; tủ AVAILABLE khi GOOD/EXCELLENT.
   - Đơn CHECKED_OUT; tủ MAINTENANCE khi DAMAGED/NEEDS_CLEANING.
6. Tải lại trang: biên bản COMPLETED và không có nút trả kho lần nữa. Nếu có nháp sẵn, mở nháp đó, không tạo thêm. Khi lỗi hoặc đơn/tủ chưa đồng bộ, dừng thao tác và kiểm tra backend.

Lời trình bày: “Nhân viên ghi nhận hiện trạng khi khách trả kho. Hệ thống kết thúc sử dụng và xác định tủ có thể cho thuê tiếp hay phải bảo trì. Phí hư hỏng và hoàn cọc thuộc luồng riêng, không tự xử lý ở bước này.”

**Kiểm chứng:** build PASS, bốn bộ browser fixture (review, inspection, facility operations, checkout) kiểm tra luồng API. Không ghi dữ liệu thật và chưa chạy E2E Atlas/Cloudinary trong lượt này. Backend vẫn cần kiểm soát scope/trạng thái/transaction ở completeInspection; frontend không sửa backend.

---

# Demo Staff / Facility Manager — API thật (cập nhật 22/10/2026)

Phần này thay thế các ghi chú API cũ bên dưới. Hướng dẫn dữ liệu mẫu ở cuối file chỉ dùng khi bật mock; không dùng mã REF/RES/STASK mẫu trong chế độ API thật.

## Chuẩn bị

- Backend chạy tại `http://localhost:5000`; frontend chạy trong thư mục `frontend` bằng `npm run dev`.
- `.env.local`: `VITE_USE_MOCK=false`, địa chỉ API `http://localhost:5000/api/v1`. Không đưa file môi trường hoặc mật khẩu lên Git.
- Mở [đăng nhập](http://localhost:5173/login). Manager: `pdat0702@gmail.com`; Staff: `dattpse182773@fpt.edu.vn`. Dùng hai hồ sơ trình duyệt riêng để giữ hai phiên đăng nhập độc lập.
- Cả hai tài khoản cần `assignedFacilityId` đúng cơ sở của đơn. Dùng Mongo ID thật; lấy từ trang chi tiết. Không dùng lại đơn cũ đã hết hạn hoặc đã ACTIVE để demo thao tác lần đầu.
- Các đường dẫn dưới dùng cổng 5173. Nếu Vite in cổng khác, thay cổng tương ứng.

## 1. Khách hàng và đặt chỗ

1. Manager mở [Customers](http://localhost:5173/manager/customers), chọn hồ sơ cần kiểm tra và xác minh nếu còn PENDING. Chỉ xác minh khi dữ liệu hợp lệ.
2. Manager mở [Reservations](http://localhost:5173/manager/reservations), chọn đơn Self Storage thuộc cơ sở. Với luồng cũ RESERVED, xem chi tiết rồi duyệt/từ chối. Đơn DEPOSIT_PAID theo luồng mới chuyển sang xử lý hợp đồng giấy; không duyệt lại.
3. Staff mở [Reservations](http://localhost:5173/staff/reservations), chọn cùng đơn. Staff đọc được đơn và hợp đồng; không có nút duyệt/từ chối của Manager.
4. Sau thao tác ở cửa sổ Manager, chuyển lại cửa sổ Staff hoặc bấm tải lại để lấy trạng thái backend. Đây là đọc lại dữ liệu, không phải WebSocket thời gian thực.

Lời trình bày: “Manager kiểm tra và quyết định đặt chỗ. Staff theo dõi cùng dữ liệu trong cơ sở để thực hiện nghiệp vụ tại quầy.”

## 2. Hợp đồng giấy → thanh toán còn lại → bàn giao Self Storage

1. Mở chi tiết đơn từ danh sách trên. Khối **Hợp đồng giấy và bàn giao** tự tìm hợp đồng theo Reservation ID, kiểm tra đúng khách và cơ sở.
2. Bấm **Xem dữ liệu in hợp đồng → Xác nhận**. Đây là dữ liệu hợp đồng từ API, chưa phải mẫu hợp đồng PDF pháp lý hoàn chỉnh.
3. Với đơn CONTRACTED/DEPOSIT_PAID chưa có bằng chứng, chọn ảnh JPEG/PNG/WEBP hoặc PDF hợp đồng đã ký, tối đa 10 MB. Điền số hợp đồng giấy nếu có.
4. Tích xác nhận đã kiểm tra → **Xác nhận hợp đồng giấy → Xác nhận**. Frontend gửi field `proofFile`, đọc lại hợp đồng SIGNED/có bằng chứng và đơn CHECKIN_READY.
5. **Bước Customer:** khách thanh toán số dư. Frontend Staff/Manager không nhận tiền thay khách và không tự đặt PAID. Hiện trang Customer Self Storage chưa nối endpoint balance mới; để demo xuyên suốt cần người phụ trách Customer hoàn thiện hoặc dùng Postman với token Customer:
   - `POST /reservations/<reservationId>/balance`: xem khoản còn phải trả.
   - `POST /reservations/<reservationId>/balance/mock-confirm`: xác nhận thanh toán mô phỏng, chỉ dùng dữ liệu demo development; không gọi lặp hoặc coi là chuyển tiền thật.
6. Trở lại chi tiết đơn, bấm **Tải lại hợp đồng**. Chỉ khi backend trả PAID, hợp đồng SIGNED và có bằng chứng mới xuất hiện **Bàn giao kho**.
7. Kiểm tra thực tế, tích xác nhận → **Bàn giao kho → Xác nhận**. Frontend kiểm tra lại đơn/tủ, gọi API handover rồi đọc lại ACTIVE/OCCUPIED. Nếu lỗi hoặc trạng thái chưa đồng bộ, không báo thành công.
8. Có thể mở trực tiếp [Staff Handover](http://localhost:5173/staff/handovers) hoặc [Manager Handover](http://localhost:5173/manager/work/HANDOVER), nhập Reservation ID thật.

Lời trình bày: “Em xác nhận bằng chứng hợp đồng đã ký. Khách thanh toán phần còn lại, sau đó nhân viên bàn giao và kiểm tra trạng thái sử dụng kho từ backend.”

**Phân biệt luồng cũ:** [Staff Check-in](http://localhost:5173/staff/check-ins), [Staff Inspection](http://localhost:5173/staff/inspections), [Manager Check-in](http://localhost:5173/manager/work/CHECK_IN) dùng CHECK_IN DRAFT → COMPLETED cho đơn Self Storage cũ. Contract ID tự lấy theo đơn. Không dùng completeInspection để bỏ qua luồng hợp đồng giấy hoặc Managed V2; frontend chặn các trường hợp đó. Handover mới không tự hoàn tất một biên bản Inspection riêng.

## 3. Bảo trì: tạo → giao việc → xử lý → đóng

1. Staff mở [Maintenance](http://localhost:5173/staff/maintenance), điền tiêu đề, mô tả, nhóm, ưu tiên; Storage Unit ID không bắt buộc. Bấm **Lưu yêu cầu**. Ghi lại ID được trả về.
2. Yêu cầu mới OPEN chưa xuất hiện trong danh sách cá nhân của Staff cho tới khi được giao. Manager mở [Maintenance](http://localhost:5173/manager/maintenance), tìm yêu cầu rồi mở chi tiết.
3. Manager nhập **Staff User ID** thật thuộc cơ sở → **Phân công → Xác nhận**. Đây là User ID, không phải email hay Customer Profile ID. Chưa có danh bạ Staff trong màn hình này.
4. Staff tải lại trang, mở yêu cầu được giao → **Chuyển sang IN_PROGRESS → Xác nhận**.
5. Sau xử lý, nhập **Kết quả xử lý**, ví dụ “Đã kiểm tra và thay khóa cửa kho” → **Chuyển sang RESOLVED → Xác nhận**.
6. Kiểm tra kết quả → **Chuyển sang CLOSED → Xác nhận**. Tải lại để thấy dữ liệu vẫn được lưu.
7. Case phụ: Manager sửa nội dung khi chưa CLOSED; **Bỏ phân công** khi ASSIGNED đưa về OPEN. Staff không có nút phân công.

Lời trình bày: “Manager phân công nhân viên cùng cơ sở. Staff chỉ thấy và xử lý ticket được giao, ghi rõ kết quả trước khi đóng.”

## 4. Hỗ trợ: phân công và trao đổi

1. Manager mở [Support](http://localhost:5173/manager/support), chọn yêu cầu có sẵn hoặc tạo mới bằng Customer User ID thật.
2. Phân công Staff như bảo trì. Staff mở [Support](http://localhost:5173/staff/support), chọn yêu cầu được giao.
3. Trong **Trao đổi**, nhập ghi chú. Mặc định là **Ghi chú nội bộ**. Bấm **Gửi tin nhắn → Xác nhận**, kiểm tra nội dung đọc lại.
4. Nếu cần trả lời khách, chọn **Gửi cho khách hàng** và kiểm tra phạm vi trong hộp xác nhận trước khi gửi. Không đưa thông tin nội bộ vào tin công khai.
5. Xử lý ASSIGNED → IN_PROGRESS → nhập kết quả → RESOLVED → CLOSED. Dùng tìm kiếm, lọc trạng thái và phân trang khi cần.

## 5. Mức kiểm chứng và việc tiếp theo

- Đã kiểm thử frontend bằng trình duyệt với API giả lập: quyền Staff/Manager, tự lấy hợp đồng, upload multipart, điều kiện thanh toán/bàn giao, sai cơ sở, lỗi HTTP, phản hồi không đồng bộ, tạo/sửa/phân công/bỏ phân công và đóng ticket, tin nội bộ, màn hình hẹp.
- Chưa nghiệm thu end-to-end với Atlas/Cloudinary hoặc giao dịch thật trong lượt này. Không sửa backend, không tạo đơn hay thanh toán trên database chung.
- Trong phạm vi Staff/Manager, CHECK_OUT đã nối API ở bản cập nhật đầu tài liệu. Tiếp theo cần kiểm thử thực tế ảnh ký giấy, trạng thái sau thanh toán/trả kho và bổ sung chọn nhân viên thuận tiện khi có API danh bạ phù hợp.
- Phối hợp người làm Customer để nối thanh toán Self Storage mới. Đây là phụ thuộc để demo xuyên suốt, không tính màn hình thanh toán Customer là phần Staff/Manager.
- Hoàn tiền/gia hạn/phí phát sinh vẫn chờ API tương ứng; không trình bày dữ liệu demo là dữ liệu backend.
- Tài liệu Word ngày 19/10 dùng nhiều snapshot 09–12/10: quyền Staff và luồng mới phải đối chiếu source hiện tại. Managed Receiving, ảnh chứng cứ, Confirm Inbound có liên quan role Staff nhưng không tự suy ra thuộc phần được giao trong Excel; giữ phần của nhóm, chỉ mở rộng khi xác nhận phân công.

---

# Phụ lục: kịch bản mock lịch sử (không dùng cho API thật)

# Kịch bản demo tiếng Việt — M4, Iteration 1–3

> **Cập nhật 12/10/2026:** hướng dẫn phía dưới dành cho dữ liệu demo khi `VITE_USE_MOCK=true`. Frontend hiện có chế độ API thật cho khách hàng/xác minh và đặt chỗ Manager khi `VITE_USE_MOCK=false`. File `.env.local` trên máy đang chọn API thật, base URL `http://localhost:5000/api/v1`; file này không đưa lên Git.
>
> Với API thật: đăng nhập đúng Staff/Manager; Manager cần `assignedFacilityId` từ backend. Khách hàng dùng CustomerProfile ID thật. Đơn Self Storage dùng `RESERVED → CONTRACTED/CANCELLED`, không dùng mã CUS/RES/REF mẫu trong hướng dẫn này. Managed Reservation mở theo ID qua mục Managed Inventory vì chưa có API danh sách theo cơ sở. Staff chưa có API đọc/duyệt đơn. Hoàn tiền hiển thị chờ backend, không tạo receipt hoặc đổi Payment thành REFUNDED. Các thiếu sót backend được ghi trong `BackendApiAudit.md`.

> **Phase 2 API thật:** Manager dùng link Inspection/Check-in hoặc `/manager/work/INSPECTION`, `/manager/work/CHECK_IN`. Chọn đơn PAID, nhập Contract ID SIGNED, lưu CHECK_IN DRAFT rồi hoàn tất với Inspection ID. Checklist được lưu trong notes. Chỉ báo nhận kho thành công sau khi backend xác nhận ACTIVE/OCCUPIED. Staff hiện chỉ xem vì thiếu quyền đọc reservation/contract; xem phần Phase 2 trong `BackendApiAudit.md`. Các mã STASK bên dưới vẫn là demo riêng.

**Để thao tác theo từng trang, mở mục 11.** Mục 9 là các case chờ duyệt có sẵn; mục 12 ghi kết quả kiểm thử. Các mục 3–8 là lời trình bày và luồng tổng thể.

## 1. Phần em phụ trách

Em phụ trách các chức năng web của **nhân viên cơ sở (Staff)** và **quản lý cơ sở (Facility Manager)** thuộc M4 trong Iteration 1–3, đối chiếu các sheet Iter1, Iter2, Iter3 của Excel tracking.

| Iteration | Mã chức năng | Nội dung trình bày |
| --- | --- | --- |
| Iteration 1 | P010, P011 | Danh sách/chi tiết khách hàng; xác minh khách hàng và lịch sử thay đổi |
| Iteration 2 | P013, P064, P065 | Duyệt đặt chỗ; tạo/tính/duyệt yêu cầu hoàn tiền; nhân viên ghi nhận xử lý hoàn tiền |
| Iteration 3 | P025, P026, P029, P030, P031 | Nhận kho, trả kho, gia hạn hợp đồng, kiểm tra hiện trạng, bảo trì |
| Iteration 3 | P038, P039, P040, P043, P044, P045 | Xử lý hỗ trợ, bàn giao, mô phỏng quyền truy cập, phí phát sinh, phân công nhân viên, bảng công việc |

**Không tính vào phần trình bày:** Iteration 4, dashboard KPI/báo cáo, quản lý kho/vị trí lưu trữ, nhập/xuất/di chuyển inventory, các chức năng của Admin, Customer và Business Operations Manager. P034/P035 trong Iteration 3 là mobile/Flutter, không nằm trong bản demo web này.

Customer chỉ xuất hiện ở bước xem kết quả hoàn tiền/phí để minh họa đầu ra của luồng M4; không trình bày cả workspace Customer là phần em làm. Màn hình tổng quan công việc của Staff phục vụ luồng vận hành web; không gọi đó là sản phẩm Flutter đã hoàn thành.

## 2. Chuẩn bị trước khi lên demo

1. Mở terminal tại `frontend`, chạy `npm run dev`.
2. Dùng đúng một địa chỉ Vite in ra, ví dụ `http://localhost:5173`. Tất cả đường dẫn trong tài liệu nối vào địa chỉ đó.
3. Mở một cửa sổ riêng tư mới để có dữ liệu mẫu sạch. Mở hai tab trong cùng cửa sổ:
   - **Tab quản lý:** `/manager/operations`.
   - **Tab nhân viên:** `/staff/dashboard`.
4. Không dùng `localhost` cho một tab và `127.0.0.1` cho tab còn lại: hai địa chỉ có vùng dữ liệu browser khác nhau.
5. Chọn nhân viên phù hợp bằng **Demo operator**:

| Nhân viên mẫu | Vai trò trong demo | Dùng khi |
| --- | --- | --- |
| Pham Quoc Bao — STAFF-001 | Nhân viên vận hành | Inspection, handover, check-in, checkout |
| Vo Lan Anh — STAFF-002 | Nhân viên chăm sóc khách hàng | Hoàn tiền, support; check-in/checkout nếu được giao |
| Dang Minh Duc — STAFF-003 | Nhân viên bảo trì | Maintenance và inspection nếu được giao |

Dropdown này chọn người thao tác trong fixture, **không phải đăng nhập thật**. Đăng nhập vẫn dùng backend hiện có. Khi backend chưa sẵn sàng, mở trực tiếp các đường dẫn demo trên.

**Hiện không ẩn màn hình nào.** Menu và URL của Staff/Facility Manager đã được mở lại, kể cả các chức năng ngoài M4. Khi demo, chỉ trình bày các chức năng trong bảng phạm vi ở mục 1. Admin, Customer và BOM giữ nguyên. Không cần cấu hình `VITE_M4_DEMO_SCOPE`.

## 3. Lời mở đầu — khoảng 30 giây

> “Phần em phụ trách là M4 ở Iteration 1 đến 3, tập trung vào hai vai trò nhân viên cơ sở và quản lý cơ sở. Em sẽ trình bày từ kiểm tra khách hàng, duyệt đặt chỗ và hoàn tiền đến phân công công việc, nhận kho, bàn giao, gia hạn và trả kho. Hiện đây là bản demo giao diện và luồng nghiệp vụ bằng dữ liệu mẫu lưu trong trình duyệt. Các thao tác thanh toán, thông báo và quyền truy cập được mô phỏng vì API chưa đầy đủ.”

## 4. Iteration 1 — tìm và xác minh khách hàng

**Màn hình:** `/staff/customers` và `/manager/customers/CUS-002`.

**Thao tác:**

1. Tại tab Staff, tìm `0902345678` để thấy Mai Trading Co.
2. Mở chi tiết khách hàng `CUS-002`: giới thiệu thông tin liên hệ, rental hiện tại, lịch sử thuê và thanh toán.
3. Chọn VERIFIED, nhập Review notes: **“Đã kiểm tra thông tin khách hàng trong buổi demo.”**
4. Bấm **Save verification**.
5. Chuyển sang tab Manager, mở `/manager/customers/CUS-002`: cùng trạng thái và lịch sử người/thời điểm xác minh.

**Lời trình bày:**

> “Ở Iteration 1, nhân viên và quản lý có thể tìm khách hàng theo tên, email hoặc số điện thoại, xem hồ sơ và lịch sử thuê. Khi xác minh, hệ thống yêu cầu ghi chú và lưu người thao tác cùng thời điểm để có thể kiểm tra lại.”

**Điểm kiểm tra:** bỏ trống ghi chú thì chưa lưu được. Không trình bày màn hình Admin vì đó không phải role đang demo.

## 5. Iteration 2 — duyệt đặt chỗ và hoàn tiền

### 5.1. Duyệt yêu cầu đặt chỗ — P013

**Màn hình:** `/staff/reservations/RES-M002` hoặc `/manager/reservations/RES-M002`.

1. Dùng khách hàng `CUS-002` vừa xác minh.
2. Mở `RES-M002`, giới thiệu thông tin đặt chỗ, trạng thái và điều kiện được duyệt.
3. Bấm **Approve → Confirm approval**.
4. Cho xem timeline và thông báo được lưu cục bộ. Reload để thấy quyết định đã được giữ.
5. Nếu muốn demo từ chối, dùng một yêu cầu khác còn PENDING; **Reject** phải có lý do. Không dùng lại yêu cầu đã duyệt.

> “Nhân viên hoặc quản lý chỉ được quyết định yêu cầu đang chờ xử lý. Trước khi duyệt, hệ thống kiểm tra khách hàng và tài nguyên. Nếu từ chối thì cần lý do; quyết định được lưu trong lịch sử và tạo thông báo mô phỏng cho khách.”

### 5.2. Tính và duyệt hoàn tiền — P064

**Màn hình:** `/manager/refunds/REF-M001`.

1. Cho xem thanh toán gốc, thời gian chưa sử dụng và phép tính mẫu: **1.350.000 × 10 / 30 = 450.000 VND**.
2. Bấm **Approve**, nhập Approval reason: **“Đã kiểm tra khoản thanh toán và thời gian chưa sử dụng.”**
3. Bấm **Confirm approval**. Giải thích rằng duyệt chưa đồng nghĩa đã chuyển tiền.

> “Quản lý kiểm tra số tiền hoàn và phải ghi rõ lý do duyệt. Yêu cầu chưa được duyệt thì nhân viên không thể ghi nhận hoàn tiền thành công. Công thức ở bản này là minh họa, chưa phải chính sách hoàn tiền thực tế đã nối API.”

Có thể mở **New refund request** để giới thiệu form tạo yêu cầu, phép tính tự cập nhật và kiểm tra không tạo trùng yêu cầu đang chờ cho cùng thanh toán. Không cần làm thêm nếu thời gian ngắn.

### 5.3. Nhân viên ghi nhận xử lý — P065

**Màn hình:** `/staff/refunds/REF-M001`.

1. Chọn **Vo Lan Anh** ở Demo operator.
2. Nhập reference mẫu **DEMO-REFUND-001**, chọn phương thức chuyển khoản và tick xác nhận.
3. Bấm nút ghi nhận xử lý rồi xác nhận trong hộp thoại.
4. Cho xem trạng thái hoàn tất, thanh toán được cập nhật và biên nhận.
5. Có thể mở `/portal/payments` trong tab phụ, phần **Facility demo refund receipts** của khách mẫu Nguyen Van An, để minh họa đầu ra.

> “Nhân viên được giao xử lý hoàn tiền phải kiểm tra quyết định duyệt, phương thức và mã tham chiếu. Sau khi xác nhận, hệ thống cập nhật trạng thái và tạo biên nhận mẫu. Cùng yêu cầu không được xử lý hai lần. Bản demo này không chuyển tiền thật.”

## 6. Iteration 3 — phân công và vận hành cơ sở

### 6.1. Quản lý phân công — P044/P045

**Màn hình:** `/manager/tasks` và `/staff/tasks`.

1. Nhập Assignment reason: **“Điều phối lại nhân viên trực nhận kho.”**
2. Đổi người nhận task `STASK-CI001` từ Pham Quoc Bao sang Vo Lan Anh.
3. Sang tab Staff, chọn **Vo Lan Anh**: task mới xuất hiện trong danh sách công việc của nhân viên.
4. Quản lý giao lại task cho **Pham Quoc Bao**, Staff cũng chọn **Pham Quoc Bao** để chạy chuỗi tiếp theo.
5. Giới thiệu lọc ngày, nhân viên, loại công việc và trạng thái; công việc quá hạn màu đỏ, HIGH chưa có người nhận được cảnh báo.

> “Quản lý giao công việc trong phạm vi cơ sở cho nhân viên có nghiệp vụ phù hợp. Nhân viên chỉ thấy công việc được giao cho mình. Việc đổi người phụ trách có lý do và lịch sử; bảng công việc cập nhật theo trạng thái xử lý.”

### 6.2. Kiểm tra hiện trạng, bàn giao và nhận kho — P030/P039/P025

**Thực hiện đúng thứ tự:**

| Bước | URL | Thao tác | Kết quả |
| --- | --- | --- | --- |
| Kiểm tra trước khi nhận | `/staff/inspections/STASK-INSP001` | GOOD, ảnh nhỏ nếu có, tick 4 mục, Operation notes → Save inspection → Confirm demo operation | Inspection gắn rental và unit, có ghi chú/người/thời điểm |
| Bàn giao | `/staff/handovers/STASK-HO001` | Tick 3 mục, nhập Customer acknowledgement và notes → Confirm private unit handover → xác nhận | Có xác nhận bàn giao và thông tin hướng dẫn access |
| Nhận kho | `/staff/check-ins/STASK-CI001` | Tick checklist, nhập notes → Activate paid rental → xác nhận | `SRNT-001` Active, unit A-101 OCCUPIED |

Ghi chú có thể dùng **“Đã kiểm tra hiện trạng kho và xác nhận với khách hàng.”** Xác nhận khách dùng **“Nguyen Van An xác nhận nhận kho A-101.”**

> “Trước khi nhận kho, nhân viên phải kiểm tra đúng unit và ghi nhận hiện trạng. Sau đó có bước bàn giao và xác nhận của khách. Khi thanh toán cùng các điều kiện đã đủ, nhân viên xác nhận check-in; rental hoạt động và unit được đánh dấu đang sử dụng.”

**Tình huống bị chặn:** mở `/staff/check-ins/STASK-CI002` để thấy rental chưa trả tiền không được kích hoạt. Ảnh inspection lưu trong browser, tối đa 3 ảnh với tổng dung lượng 2 MB, không upload lên backend.

### 6.3. Mô phỏng quyền truy cập — P040

**Màn hình:** `/manager/operations`, tab **Access simulation**.

1. Chọn `SRNT-001` vừa Active, nhập lý do.
2. **UNLOCK → LOCK → SUSPEND**.
3. Thử UNLOCK khi đang SUSPENDED: bị chặn.
4. **RESUME → UNLOCK**, cho xem nhật ký người/thao tác/thời điểm.
5. Nếu giới thiệu RESET, giải thích đây là phiên bản access mô phỏng. Nếu bấm REVOKE, để ở cuối vì access đã thu hồi không tái sử dụng được.

> “Quyền truy cập trong phạm vi này là bản ghi phần mềm. Có trạng thái khóa/mở, đình chỉ và thu hồi; thao tác được lưu lại. Không có RFID, khóa thông minh hay thiết bị thật kết nối với hệ thống.”

### 6.4. Gia hạn và phiên bản hợp đồng — P029

**Màn hình:** `/manager/extensions`.

1. Chọn **SRNT-003** — rental mẫu khác đang Active.
2. Chọn ngày sau hôm nay 7 ngày; ghi lý do **“Khách đề nghị thuê thêm 7 ngày.”**
3. Xem quote **175.000 VND** với giá minh họa **25.000 VND/ngày**, rồi bấm **Approve extension**.
4. Cho xem contract v2, ngày kết thúc cũ/mới, phí và người/thời điểm.
5. Sang `/manager/charges`, ghi reference/notes **DEMO-EXT-001**, bấm **Record demo payment** cho phí gia hạn. Hoàn thành bước này trước checkout.

> “Gia hạn phải kiểm tra ngày và khả năng tiếp tục sử dụng unit, tránh chồng lấn booking. Ngày và giá mới được lưu theo phiên bản để giữ lại lịch sử. Gia hạn tạo khoản phí phải xử lý trước khi đóng rental.”

**Tình huống bị chặn:** nhập lại đúng ngày đã gia hạn, hoặc gia hạn chạm booking mẫu từ ngày +60 đến +90. Chưa sinh PDF hợp đồng thật; đây là phiên bản dữ liệu hợp đồng trong demo.

### 6.5. Phí hư hỏng và trả kho — P030/P043/P026

**Màn hình:** `/staff/inspections/STASK-INSP002`, `/staff/checkouts/STASK-CO001`, `/manager/charges`.

1. Staff chọn Pham Quoc Bao. Inspection checkout: chọn MINOR_DAMAGE, Damage observations **“Cửa kho bị trầy xước.”**, ảnh nếu có, checklist và notes → Save inspection.
2. Mở checkout, tick checklist, nhập Extra charge proposal **100000**, notes → Complete checkout → Confirm demo operation.
3. Cho xem rental **vẫn Active**, unit **vẫn OCCUPIED**; phí đang PENDING_MANAGER_REVIEW. Đây mới là đề xuất phí, chưa được đóng rental.
4. Manager mở `/manager/charges`, nhập lý do **“Đã đối chiếu inspection và phí sửa chữa.”**, bấm **Approve charge**.
5. Ghi nhận **Record demo payment** với reference/notes, hoặc Manager **Waive** kèm lý do. Staff không tự miễn phí hoặc thanh toán khoản chưa duyệt.
6. Quay lại checkout, xác nhận hoàn tất. Nếu đã reload, tick checklist và nhập notes lại. Không cần đề xuất lại phí cũ.
7. Rental thành **Closed**, access **REVOKED**, unit A-203 thành **MAINTENANCE** do còn hư hỏng. Có task bảo trì HIGH chưa giao để quản lý xử lý tiếp.

> “Phí phát sinh phải có lý do và liên kết tới inspection. Khi khoản phí chưa thanh toán hoặc chưa được miễn, hệ thống không đóng rental và không giải phóng unit. Sau khi xử lý phí, checkout mới hoàn tất; unit hư hỏng vẫn phải bảo trì trước khi sử dụng lại.”

Có thể mở `/portal/payments`, phần **Iteration 3 facility demo adjustments**, để minh họa khách mẫu Le Thu Ha nhìn thấy khoản phí và trạng thái. Đây là phần xem kết quả liên quan tới M4, không phải demo toàn bộ role Customer.

### 6.6. Bảo trì — P031

**Màn hình:** tab **Create maintenance** tại `/manager/operations`, rồi `/staff/maintenance`.

1. Tạo issue **“Kiểm tra bản lề cửa kho”**, chọn unit trống **B-106**, priority HIGH, assignee **Dang Minh Duc** → Create ticket and block unit.
2. Unit chuyển MAINTENANCE. Quản lý có thể đổi priority/giao lại task từ board với lý do.
3. Staff chọn **Dang Minh Duc**, mở ticket mới trong `/staff/maintenance`.
4. Lưu In progress với notes **“Đã bắt đầu kiểm tra.”**
5. Lưu Completed/resolved với notes **“Đã sửa và xác nhận unit an toàn.”** Unit B-106 về AVAILABLE.

> “Ticket bảo trì có mức ưu tiên, trạng thái và người phụ trách. Trong lúc bảo trì, unit bị chặn sử dụng. Khi nhân viên xử lý xong và ghi kết quả, unit mới được trả về trạng thái sẵn sàng.”

Task bảo trì phát sinh từ checkout A-203 cũng có thể được quản lý giao cho Duc rồi xử lý tương tự. Ưu tiên chọn một chuỗi bảo trì để tiết kiệm thời gian.

### 6.7. Hỗ trợ khách hàng — P038

**Màn hình:** `/staff/support/STASK-SUP001`. Staff chọn **Vo Lan Anh**.

1. Chọn In progress; response **“Nhân viên đang kiểm tra yêu cầu truy cập.”** và notes → Save operational status → xác nhận.
2. Chọn Completed/resolved; response **“Đã hướng dẫn khách truy cập kho.”**, notes giải quyết → lưu và xác nhận.
3. Nhập Closure note **“Khách đã xác nhận vấn đề được giải quyết.”** → Close support ticket → xác nhận.
4. Manager xem cùng ticket tại `/manager/work/SUPPORT/STASK-SUP001`. Tab Customer notifications tại `/manager/operations` có thông báo mô phỏng.

> “Yêu cầu hỗ trợ được phân công, có trao đổi và ghi chú giải quyết. Trạng thái đi từ Open qua In progress tới Resolved rồi Closed; không thể đi thẳng từ Open tới resolved. Thông báo được ghi nhận trong dữ liệu demo, chưa gửi email thật.”

## 7. Tên nút trên giao diện và cách nói tiếng Việt

| Trên giao diện | Khi trình bày |
| --- | --- |
| Customers / Save verification | Khách hàng / lưu kết quả xác minh |
| Approve / Reject | Duyệt / từ chối |
| New refund request | Tạo yêu cầu hoàn tiền |
| Demo operator | Nhân viên thao tác trong dữ liệu mẫu |
| Assignment reason | Lý do phân công hoặc điều phối lại |
| Inspection / Save inspection | Kiểm tra hiện trạng / lưu kết quả kiểm tra |
| Customer acknowledgement | Xác nhận bàn giao của khách hàng |
| Activate paid rental | Xác nhận nhận kho cho rental đã thanh toán |
| Access simulation | Mô phỏng quyền truy cập |
| Approve extension | Duyệt gia hạn |
| Approve charge / Waive | Duyệt phí / miễn phí |
| Record demo payment | Ghi nhận thanh toán mô phỏng |
| Complete checkout | Hoàn tất trả kho |
| In progress / Completed / Close support ticket | Đang xử lý / hoàn tất giải quyết / đóng yêu cầu hỗ trợ |
| Confirm demo operation | Xác nhận thao tác demo |

## 8. Lời kết và câu trả lời khi được hỏi

> “Phần M4 web Iteration 1–3 hiện có các màn hình và luồng thao tác cho Staff và Facility Manager, có kiểm tra điều kiện, phân công, trạng thái và lịch sử. Em đã kiểm tra các luồng chính và các trường hợp bị chặn. Iteration 4 chưa đưa vào buổi demo; bước tiếp theo là nối các API nghiệp vụ còn thiếu.”

**Nếu hỏi có dữ liệu thật không:** “Dữ liệu nghiệp vụ đang là fixture lưu trong browser. Refresh giữ dữ liệu; các tab cùng origin cập nhật cùng bộ dữ liệu. Chưa xác nhận luồng end-to-end với backend.”

**Nếu hỏi vì sao không đăng nhập:** “Đăng nhập vẫn dùng backend thật hiện có. Hôm nay em mở trực tiếp workspace để demo giao diện; dropdown nhân viên là công cụ chọn fixture, không thay thế xác thực.”

**Nếu hỏi phần Customer/Admin/BOM:** “Em chỉ trình bày phần Staff/Facility Manager thuộc M4 Iteration 1–3. Các role còn lại của nhóm được giữ nguyên.”

**Nếu hỏi sao dữ liệu khách khác nhau giữa hai chuỗi:** “Fixture Iteration 1/2 dùng ID CUS-/RES-/REF-, còn vận hành Iteration 3 dùng SCUS-/SRNT-/STASK-. Chúng là hai bộ dữ liệu minh họa; em không trình bày là một rental chạy xuyên suốt backend.”

**Nếu cần demo lại:** mở cửa sổ riêng tư mới. Không xóa database thật. Nếu một nút bị chặn, kiểm tra người nhận task, điều kiện thanh toán/inspection/handover, ghi chú bắt buộc và trạng thái hiện tại trước.

## 9. Case chờ duyệt bổ sung — chọn để demo trực tiếp

Các case này có ID riêng, không thay thế chuỗi chính phía trên. Với dữ liệu đã lưu, reload trang để nhận các case còn thiếu; các quyết định đã thực hiện được giữ nguyên. Dùng cửa sổ riêng tư mới nếu cần tất cả case trở lại trạng thái ban đầu.

| Case | Role được thao tác | URL / bản ghi | Kết quả cần cho xem |
| --- | --- | --- | --- |
| Xác minh không đạt — P011 | Staff hoặc Manager | `/staff/customers/CUS-DEMO-004` hoặc `/manager/customers/CUS-DEMO-004` | Chọn REJECTED, nhập ghi chú rồi Save verification; lưu người/thời điểm và trạng thái từ chối |
| Duyệt đặt chỗ hợp lệ — P013 | Staff hoặc Manager | `/staff/reservations/RES-DEMO-APPROVE` hoặc `/manager/reservations/RES-DEMO-APPROVE` | Khách CUS-001 đã VERIFIED, capacity 2 m³; Approve → Confirm approval; trạng thái APPROVED |
| Từ chối đặt chỗ — P013 | Staff hoặc Manager | `/staff/reservations/RES-DEMO-REJECT` hoặc `/manager/reservations/RES-DEMO-REJECT` | Reject; lý do “Khách đề nghị thay đổi thời gian thuê, cần tạo yêu cầu mới”; trạng thái REJECTED |
| Không được duyệt unit bảo trì — P013 | Staff hoặc Manager | `/staff/reservations/RES-DEMO-BLOCKED` hoặc `/manager/reservations/RES-DEMO-BLOCKED` | Unit A-102 đang MAINTENANCE; không thể Approve dù khách đã xác minh; có thể Reject với lý do |
| Từ chối hoàn tiền — P064 | **Manager** | `/manager/refunds/REF-DEMO-REJECT` | Reject; lý do “Chưa đủ căn cứ xác nhận số ngày chưa sử dụng”; không cho Staff xử lý payout |
| Duyệt phí hư hỏng — P043 | **Manager** | `/manager/charges`, ID `SCHG-DEMO-APPROVE` | 150.000 VND, inspection `SINSP-DEMO-001`; nhập lý do → Approve charge; trạng thái PENDING_PAYMENT |
| Miễn phí vệ sinh — P043 | **Manager** | `/manager/charges`, ID `SCHG-DEMO-WAIVE` | 60.000 VND; nhập lý do “Miễn phí vệ sinh theo quyết định quản lý trong demo” → Waive; trạng thái WAIVED |

### Case phối hợp Manager → Staff → checkout

1. Mở `/staff/checkouts/STASK-DEMO-CO001`, chọn **Pham Quoc Bao**. Rental `SRNT-DEMO-001`, unit riêng **B-107** đã có inspection checkout mẫu. Còn hai phí chưa xử lý nên checkout bị chặn.
2. Manager vào `/manager/charges`: duyệt `SCHG-DEMO-APPROVE` (150.000 VND) và miễn `SCHG-DEMO-WAIVE` (60.000 VND), mỗi quyết định có ghi chú.
3. Staff vào `/staff/facility-operations`, tab **Extra charges**. Chọn đúng khoản 150.000 VND, nhập **DEMO-DAMAGE-RECEIPT-001** ở Settlement / waiver reason rồi bấm **Record demo payment**. Khoản chưa được Manager duyệt không thanh toán được; Staff không có nút Waive.
4. Quay lại `/staff/checkouts/STASK-DEMO-CO001`, tick đủ checklist, nhập notes, để đề xuất phí mới bằng 0 → Complete checkout → Confirm demo operation.
5. Rental Closed, access bị thu hồi; B-107 vào MAINTENANCE do hư hỏng. Quản lý có thể giao task bảo trì vừa sinh ra.

> “Ở case này, nhân viên không thể tự đóng rental khi còn phí. Quản lý duyệt phí sửa chữa và miễn khoản vệ sinh có lý do; nhân viên ghi nhận thanh toán khoản đã duyệt. Khi mọi khoản đều PAID hoặc WAIVED, checkout mới hoàn tất.”

### Phân quyền cần nói rõ

- **Staff và Manager:** xác minh khách; duyệt/từ chối reservation đang chờ xử lý.
- **Manager:** duyệt/từ chối refund; duyệt hoặc miễn phí phát sinh; phân công nhân viên.
- **Vo Lan Anh (Staff):** xử lý refund đã duyệt và được giao, có reference và xác nhận.
- **Staff được giao rental:** ghi nhận thanh toán phí đã duyệt, inspection/handover/check-in/out theo nghiệp vụ của nhân viên.
- **Support/maintenance:** là xử lý công việc và giải quyết ticket; không gọi chung là “duyệt yêu cầu”.

Các quyền trên là guard của bản demo browser; không tuyên bố thay thế phân quyền backend.

## 10. Điểm khác với tài liệu API thuê kho

`docs_rental_workflow.md` mô tả backend: hoàn tất inspection CHECK_IN tự đưa reservation sang ACTIVE; checkout đi qua CHECKED_OUT rồi mới CLOSED. Bản demo hiện tách inspection → handover → check-in và đóng rental sau xử lý phí. Vì vậy, trình bày là demo giao diện/nghiệp vụ; không tuyên bố các bước đã gọi đúng API end-to-end, sinh hợp đồng thật hoặc PIN thật. Đăng nhập, tạo tài khoản, khách tạo đơn/ký hợp đồng/thanh toán là phần phối hợp với role khác, không tính toàn bộ vào M4.

## 11. Sổ tay thao tác theo từng trang

Đây là phần mở ra để thao tác ngay khi demo. Các URL dùng cùng địa chỉ Vite. Chạy chuỗi chính theo thứ tự; case bổ sung có ID `DEMO` dùng riêng. Mỗi quyết định thường chỉ thực hiện một lần, nên mở cửa sổ riêng tư mới khi muốn chạy lại từ đầu.

### 11.1. Tổng quan công việc nhân viên — `/staff/dashboard`

1. Chọn **Pham Quoc Bao** tại **Demo operator**.
2. Giới thiệu các thẻ số lượng và danh sách công việc trong ngày. Trang hiện cả công việc inventory vì đã bỏ việc ẩn; không trình bày inventory là phần M4.
3. Đổi sang **Vo Lan Anh**, rồi **Dang Minh Duc** để thấy danh sách theo người được giao.
4. Chọn lại **Pham Quoc Bao** trước inspection/handover/check-in.

**Kết quả:** danh sách thay đổi theo nhân viên. Đây là dashboard công việc web, không phải dashboard KPI hoặc Flutter.

### 11.2. Danh sách khách — `/staff/customers`, `/manager/customers`

1. Trong **Search customer**, nhập `0902345678`; chỉ còn Mai Trading Co.
2. Xóa tìm kiếm, nhập `Mai` hoặc email để giới thiệu các kiểu tìm kiếm.
3. Bấm tên Mai Trading Co. để mở `CUS-002`.

**Kết quả:** thấy hồ sơ, tình trạng xác minh và số rental hoạt động. Staff/Manager đọc cùng bộ fixture Iteration 1/2.

### 11.3. Chi tiết và xác minh khách — `/staff/customers/CUS-002`

1. Xem **Customer profile**, **Active rentals**, **Rental history**, **Payment summary**, **Support history**.
2. Tại **Verification decision**, chọn **VERIFIED**.
3. Nhập **Review notes**: `Đã kiểm tra thông tin liên hệ và hồ sơ khách hàng.`
4. Bấm **Save verification**.
5. Mở `/manager/customers/CUS-002` ở tab Manager, xem **Verification history** và trạng thái VERIFIED.

**Case từ chối riêng:** mở `/staff/customers/CUS-DEMO-004`, chọn REJECTED, notes `Thông tin cần được bổ sung để đối chiếu.` → Save verification. Không dùng CUS-002 để từ chối trước khi chạy luồng duyệt `RES-M002`.

**Case bắt buộc:** để notes trống, nút lưu bị vô hiệu hóa.

### 11.4. Danh sách và quyết định đặt chỗ — `/staff/reservations`, `/manager/reservations`

1. Mở danh sách: **Reservation status** = PENDING; **Reservation service** = MANAGED_INVENTORY để lọc đơn capacity, hoặc SELF_STORAGE để lọc đơn unit. **Reservation move-in date** dùng lọc ngày nhận kho; để trống nếu muốn thấy mọi ngày. Bấm mã reservation trong bảng; trang này không có ô tìm theo mã.
2. Chuỗi chính: mở `/staff/reservations/RES-M002` **sau khi CUS-002 đã VERIFIED**.
3. Xem khách, dịch vụ, thời gian và điều kiện tài nguyên. Bấm **Approve → Confirm approval**.
4. Cho xem lịch sử và thông báo mô phỏng; reload để thấy vẫn APPROVED.

**Case bổ sung thực hiện độc lập:**

| Trang chi tiết | Bấm/nhập | Kết quả |
| --- | --- | --- |
| `/staff/reservations/RES-DEMO-APPROVE` | Approve → Confirm approval | APPROVED, khách CUS-001 đã VERIFIED |
| `/manager/reservations/RES-DEMO-REJECT` | Reject → **Rejection reason** `Khách đề nghị đổi lịch thuê.` → Confirm rejection | REJECTED và lưu lý do |
| `/manager/reservations/RES-DEMO-BLOCKED` | Xem unit A-102 đang MAINTENANCE; thử điều kiện duyệt | Approve bị vô hiệu hóa; không thể bỏ qua bảo trì |

**Case bắt buộc:** hộp thoại Reject không xác nhận được nếu thiếu lý do. Reservation đã quyết định không được duyệt/từ chối lần nữa.

### 11.5. Danh sách hoàn tiền và tạo yêu cầu — `/staff/refunds`, `/manager/refunds`

1. Mở trang, giới thiệu bảng **Refund review queue**, số tiền, trạng thái duyệt và trạng thái xử lý.
2. Mở `/manager/refunds/REF-DEMO-REJECT` trước: **Reject**, nhập **Rejection reason** `Chưa đủ căn cứ xác nhận thời gian chưa sử dụng.` → **Confirm rejection**.
3. Quay lại `/staff/refunds`, bấm **New refund request**.
4. Chọn **Original paid payment** = `PAY-M002`.
5. Nhập **Unused prepaid days** = `3`, **Billing period days** = `30`.
6. Nhập **Refund request reason** = `Khách đề nghị hoàn tiền 3 ngày chưa sử dụng.`
7. Xem phép tính **200.000 VND**, bấm **Submit demo request**.
8. Ghi lại mã `REF-...` mới ở URL. Mở cùng mã tại `/manager/refunds/<mã-vừa-tạo>` nếu muốn tiếp tục Manager duyệt.

**Lưu ý thứ tự:** `PAY-M002` ban đầu đã có `REF-DEMO-REJECT` chờ duyệt. Nếu chưa từ chối hoặc xử lý yêu cầu đó, tạo thêm sẽ báo đang có refund chờ review. Đây là kiểm tra chống trùng, không phải lỗi form.

**Case bắt buộc:** nhập `31` ngày chưa sử dụng trong kỳ `30` ngày → nút Submit bị vô hiệu hóa. Yêu cầu mới chưa duyệt → Staff chưa xử lý payout được. Các sample `SREF-001/SREF-002` là bộ fixture cũ; không dùng chúng thay cho luồng chia sẻ `REF-M001`.

### 11.6. Manager duyệt hoàn tiền — `/manager/refunds/REF-M001`

1. Xem thanh toán gốc `PAY-M001`, kỳ 30 ngày, chưa sử dụng 10 ngày, số tiền **450.000 VND**.
2. Bấm **Approve**.
3. Nhập **Approval reason** = `Đã kiểm tra thanh toán gốc và 10 ngày chưa sử dụng.`
4. Bấm **Confirm approval**.

**Kết quả:** APPROVED, xử lý vẫn PENDING, có người duyệt và lý do. Thiếu lý do không xác nhận được. Duyệt chưa chuyển tiền.

### 11.7. Staff xử lý hoàn tiền — `/staff/refunds/REF-M001`

1. Chọn **Vo Lan Anh** trong Demo operator.
2. Chọn **Transfer method** = `Bank transfer`.
3. Nhập **Demo processing reference** = `DEMO-REFUND-001`.
4. Tick xác nhận kiểm tra khoản hoàn tiền.
5. Bấm **Review refund processing → Confirm demo processing**.
6. Xem **Demo refund receipt**, reference, người xử lý, số tiền và trạng thái thanh toán REFUNDED.

**Case quyền:** chọn Pham Quoc Bao → không xử lý được refund này. Refund chưa duyệt hoặc bị từ chối cũng không xử lý được. Hoàn tất rồi thì không được xử lý lần hai.

### 11.8. Bảng vận hành/phân công — `/manager/operations`, `/manager/tasks`

1. Ở tab **Daily board / assignment**, chọn ngày hiện tại trong **Task date**.
2. Thử **Staff filter**, **Task type**, **Status filter**, rồi đưa về All để thấy toàn bộ.
3. Nhập **Assignment reason (required)** = `Điều phối lại nhân viên trực nhận kho.`
4. Tại dòng `STASK-CI001`, đổi **Assignment** sang **Vo Lan Anh**.
5. Sang `/staff/tasks`, chọn Vo Lan Anh: xuất hiện `STASK-CI001`.
6. Manager giao task về Pham Quoc Bao; Staff chọn lại Bao trước chuỗi nhận kho.
7. Nếu cần, dùng dropdown **Priority** tại task đang mở để đổi mức ưu tiên; cũng phải có lý do.

**Kết quả:** task được giao đúng nhân viên đủ nghiệp vụ và được đồng bộ giữa tab. Không chọn được Maintenance cho task check-in. Sau checkout hư hỏng, task HIGH chưa giao xuất hiện tại nhóm **Unassigned**; dùng cùng cách trên giao cho Dang Minh Duc.

### 11.9. Công việc của Staff — `/staff/tasks`, `/staff/tasks/STASK-CI001`

1. Chọn Pham Quoc Bao, tìm mã `STASK-CI001` ở **Search task or rental**.
2. Thử **Task type**, **Task status**, **Priority**, **Due date**.
3. Bấm **Open task** ở dòng phù hợp.
4. Khi task còn PENDING, bấm **Start task → Confirm demo operation**.
5. Bấm **Open operational workflow** để đến checklist check-in. Bắt đầu task không tự kích hoạt rental; vẫn phải hoàn thành inspection và handover.

**Kết quả:** task IN_PROGRESS và có timeline. Nếu đổi người được chọn sang nhân viên không được giao, chi tiết task không còn khả dụng.

### 11.10. Inspection trước/sau — `/staff/inspections`

**Trước bàn giao:** mở `/staff/inspections/STASK-INSP001`, chọn Pham Quoc Bao.

1. **Condition** = GOOD.
2. **Inspection photos**: chọn ảnh PNG/JPG nhỏ nếu có; xem preview.
3. Tick cả 4 checklist. **Damage observations** có thể trống nếu GOOD.
4. **Operation notes** = `Đã kiểm tra cửa, vệ sinh và an toàn kho A-101.`
5. Bấm **Save inspection → Confirm demo operation**.

**Sau sử dụng:** mở `/staff/inspections/STASK-INSP002`.

1. **Condition** = MINOR_DAMAGE.
2. **Damage observations** = `Cửa kho bị trầy xước.`
3. Ảnh nếu có, đủ 4 checklist, **Operation notes** = `Đã ghi nhận hư hỏng khi khách trả kho.`
4. Save inspection → Confirm demo operation.

**Kết quả:** Completed operation, lưu condition, notes, actor/time và ảnh; inspection gắn rental/unit. Thiếu checklist/notes hoặc condition hỏng mà không có mô tả thì chưa lưu được. Chỉ nhận tối đa 3 ảnh, tổng 2 MB. **Cancel** trong hộp thoại không lưu inspection.

### 11.11. Bàn giao — `/staff/handovers/STASK-HO001`

1. Chỉ làm sau inspection GOOD của `STASK-INSP001`; Staff chọn Bao.
2. Tick đủ 3 checklist.
3. **Customer acknowledgement** = `Nguyen Van An xác nhận nhận kho A-101 và hướng dẫn truy cập.`
4. **Operation notes** = `Đã bàn giao đúng unit và hướng dẫn khách.`
5. **Confirm private unit handover → Confirm demo operation**.

**Kết quả:** có bản ghi handover CONFIRMED, người/thời điểm và xác nhận khách. Chưa có xác nhận khách thì nút bị khóa. Tiếp tục sang check-in; không nói handover tự gọi API kích hoạt backend.

### 11.12. Nhận kho — `/staff/check-ins/STASK-CI001`

1. Điều kiện: payment SUCCESS, inspection GOOD, handover CONFIRMED, đúng unit đang RESERVED; Staff chọn Bao.
2. Tick đủ 3 checklist.
3. **Operation notes** = `Đã xác nhận thanh toán và khách bắt đầu sử dụng kho.`
4. **Activate paid rental → Confirm demo operation**.

**Kết quả:** `SRNT-001` Active, A-101 OCCUPIED; lưu người và thời điểm. Mở `/staff/check-ins/STASK-CI002`, tick/notes vẫn không kích hoạt được vì chưa thanh toán.

### 11.13. Access simulation — `/manager/operations` hoặc `/staff/facility-operations`

1. Bấm tab **Access simulation**; **Rental** = `SRNT-001` sau khi Active.
2. **Operation reason** = `Kiểm tra quyền truy cập trong demo.`
3. **UNLOCK → LOCK**: quan sát trạng thái Unlocked/Locked.
4. **RESET**: tạo phiên bản access mới trong fixture, khóa lại; xem sự kiện RESET.
5. **SUSPEND → UNLOCK**: thấy lỗi access suspended, dữ liệu không đổi theo thao tác bị chặn.
6. **RESUME → UNLOCK**: mở được lại.
7. **REVOKE** để cuối: access bị thu hồi; không RESET để tái sử dụng được.

**Kết quả:** mỗi thao tác có actor/action/time. Đây là mô phỏng phần mềm, không phải PIN hoặc khóa thật. Ở Staff, chỉ thao tác rental được giao.

### 11.14. Gia hạn — `/manager/extensions`

1. **Rental** = `SRNT-003` còn Active, chưa checkout.
2. **New contract end date** = 7 ngày sau ngày kết thúc hiện tại đang hiển thị. Với fixture mới, ngày kết thúc ban đầu là ngày hiện tại.
3. **Operation reason** = `Khách đề nghị thuê thêm 7 ngày.`
4. Xem **Quote** 175.000 VND → **Approve extension**.
5. Xem bảng phiên bản mới v2, ngày cũ/mới, charge và actor/time.
6. Mở `/manager/charges`; tìm khoản có rental `SRNT-003`, reason `Extension 7 days`.
7. **Settlement / waiver reason** = `DEMO-EXT-001` → **Record demo payment** ở đúng dòng đó.

**Case bị chặn:** ngày mới bằng ngày hiện tại của hợp đồng; ngày không hợp lệ; hoặc chạm booking mẫu ngày +60 đến +90. Phải xử lý phí gia hạn trước checkout `SRNT-003`. Không dùng cùng ngày để duyệt gia hạn lần nữa.

### 11.15. Phí phát sinh — `/manager/charges`, tab Extra charges ở `/staff/facility-operations`

**Hai khoản có sẵn cho demo độc lập:**

1. Manager nhập **Settlement / waiver reason** = `Đã kiểm tra inspection SINSP-DEMO-001.`
2. Dòng **SCHG-DEMO-APPROVE** / 150.000 VND / `SRNT-DEMO-001`: **Approve charge** → PENDING_PAYMENT.
3. Đổi reason = `Miễn phí vệ sinh theo quyết định quản lý.`
4. Dòng **SCHG-DEMO-WAIVE** / 60.000 VND: **Waive** → WAIVED.
5. Staff chọn Bao, mở `/staff/facility-operations` → **Extra charges**.
6. **Settlement / waiver reason** = `DEMO-DAMAGE-RECEIPT-001`.
7. Ở đúng dòng SCHG-DEMO-APPROVE, **Record demo payment** → PAID.

**Kết quả:** phí có inspection reference và trạng thái. Staff không có nút miễn phí và không thanh toán khoản chưa duyệt. Khoản PAID/WAIVED không được xử lý lại. Với phí 100.000 VND tạo từ checkout `SRNT-003`, thao tác giống trên nhưng phải chọn đúng dòng rental và amount.

### 11.16. Trả kho — `/staff/checkouts`

**Case có sẵn:** `/staff/checkouts/STASK-DEMO-CO001`, Bao, B-107.

1. Trước khi xử lý 2 khoản ở mục 11.15, xem **Operation blocked**: còn outstanding charges.
2. Sau khi khoản 150.000 PAID và 60.000 WAIVED, tick đủ 3 checklist.
3. **Extra charge proposal (VND)** = `0`.
4. **Operation notes** = `Đã xử lý phí và xác nhận khách trả kho B-107.`
5. **Complete checkout → Confirm demo operation**.

**Kết quả:** rental Closed, access REVOKED; B-107 MAINTENANCE, có task bảo trì HIGH chưa giao.

**Case tự tạo phí:** `/staff/checkouts/STASK-CO001` sau inspection MINOR_DAMAGE của STASK-INSP002 và sau xử lý phí gia hạn.

1. Tick 3 mục, **Extra charge proposal (VND)** = `100000`, Operation notes = `Đề xuất phí sửa cửa theo inspection.`
2. Complete checkout → Confirm demo operation. **Rental vẫn Active** vì mới đề xuất phí.
3. Manager duyệt phí, Staff/Manager ghi nhận payment hoặc Manager miễn phí có lý do.
4. Quay lại trang checkout: tick/notes lại nếu đã reload, đề xuất phí mới để `0`, Complete checkout → xác nhận.

Không tạo lại phí cũ. Khi thông báo vẫn chặn, kiểm tra còn khoản gia hạn hoặc khoản damage nào chưa PAID/WAIVED.

### 11.17. Bảo trì — `/manager/maintenance`, `/staff/maintenance`

1. Manager mở `/manager/maintenance` để xem queue; bấm link **Assignment / new maintenance ticket** để về workspace, tab **Create maintenance**.
2. **Issue** = `Kiểm tra bản lề cửa kho B-106`.
3. **Empty unit** = `UNIT-B106`, **Priority** = HIGH, **Maintenance assignee** = Dang Minh Duc.
4. **Create ticket and block unit**. Unit B-106 vào MAINTENANCE, tạo ticket/task.
5. Staff mở `/staff/maintenance`, Demo operator = Duc; bấm **Open task** ở task vừa tạo.
6. **Operational status** = In progress; **Operational notes** = `Đã bắt đầu kiểm tra cửa.`
7. **Save operational status → Confirm demo operation**.
8. Chọn Completed / resolved; Operational notes = `Đã sửa và kiểm tra an toàn.` → Save operational status → xác nhận.

**Kết quả:** ticket RESOLVED, task COMPLETED, B-106 AVAILABLE. Chưa bắt đầu xử lý mà chọn Completed thì bị chặn. Chỉ chọn unit trống khi tạo ticket từ form này. Với task HIGH sinh từ checkout, giao cho Duc tại board rồi xử lý tương tự.

### 11.18. Support — `/manager/support`, `/staff/support`

1. Staff chọn Lan Anh, mở `/staff/support/STASK-SUP001`.
2. **Operational status** = In progress.
3. **Demo customer response** = `Nhân viên đang kiểm tra yêu cầu truy cập.`
4. **Operational notes** = `Đã tiếp nhận và bắt đầu xử lý.`
5. **Save operational status → Confirm demo operation**.
6. Operational status = Completed / resolved; response = `Đã hướng dẫn truy cập kho.`; Operational notes = `Khách đã nhận hướng dẫn.` → lưu và xác nhận.
7. Khi hiện **Closure note**, nhập `Khách xác nhận vấn đề đã giải quyết.`
8. **Close support ticket → Confirm demo operation**.
9. Manager mở `/manager/support` → **Open checklist** ở cùng task: trạng thái CLOSED.

**Case bị chặn:** chọn Completed ngay từ Open; notes trống; nhân viên không được giao task. Lưu ý support/maintenance dùng nhãn **Operational notes**; inspection/handover/check-in/checkout dùng **Operation notes**.

### 11.19. Manager trực tiếp mở checklist — `/manager/work/<TYPE>/<TASK_ID>`

Manager có thể thao tác cùng bộ dữ liệu facility mà không cần đổi Demo operator của Staff. Mở từ **Open checklist** tại board để có đúng đường dẫn.

| Chức năng | Trang Manager mẫu | Nhập và xác nhận |
| --- | --- | --- |
| Inspection | `/manager/work/INSPECTION/STASK-INSP001` | Condition, checklist, ảnh/notes → Save inspection → Confirm demo operation |
| Handover | `/manager/work/HANDOVER/STASK-HO001` | Checklist, Customer acknowledgement, notes → Confirm private unit handover → xác nhận |
| Check-in | `/manager/work/CHECK_IN/STASK-CI001` | Checklist và notes, đủ prerequisites → Activate paid rental → xác nhận |
| Checkout | `/manager/work/CHECKOUT/STASK-DEMO-CO001` | Đã xử lý phí, checklist, notes, charge mới 0 → Complete checkout → xác nhận |
| Support | `/manager/work/SUPPORT/STASK-SUP001` | Response/Operational notes, In progress → Completed → Closure note → đóng ticket |
| Maintenance | `/manager/work/MAINTENANCE/STASK-MNT002` | Operational notes, In progress → Completed, mỗi bước Save operational status → xác nhận |

Không chạy lại cả Manager và Staff trên cùng task đã hoàn tất. Muốn demo hai cách thực hiện, dùng hai cửa sổ riêng tư khác nhau hoặc chỉ cho Manager xem lại kết quả của Staff.

### 11.20. Thông báo và kết quả khách — trang phụ minh họa

1. `/manager/operations` → tab **Customer notifications**: xem customer ID, nội dung và thời điểm của các thao tác support/phí.
2. `/portal/payments` → **Facility demo refund receipts** → **View demo refund receipt**: xem receipt của refund REF-M001 sau khi xử lý.
3. Cùng trang, phần **Iteration 3 facility demo adjustments**: xem khoản phí và trạng thái của khách mẫu SCUS-003.

Đây là xem đầu ra liên quan tới luồng M4. Không demo toàn bộ Customer như phần của bạn; không có email hay payment thật được gửi.

## 12. Kết quả kiểm thử — 09/10/2026

Đã chạy ba bộ kiểm thử trên dữ liệu demo trong phiên trình duyệt riêng, không thay đổi dữ liệu demo đang lưu của bạn. Các nhóm dưới đây đều **PASS**:

| Nhóm | Nội dung đã kiểm tra |
| --- | --- |
| Khách hàng và đặt chỗ | Tìm theo SĐT, duyệt/từ chối hồ sơ, duyệt/từ chối đặt chỗ, chặn đơn có tủ đang bảo trì; cập nhật giữa hai tab và sau tải lại |
| Hoàn tiền | Tạo yêu cầu, kiểm tra số ngày và số tiền, duyệt/từ chối có lý do, đúng Staff được phân công xử lý, xác nhận chuyển khoản và xem receipt; chặn thao tác sai quyền, xử lý trùng hoặc chưa được duyệt |
| Các case bổ sung | CUS-DEMO-004; RES-DEMO-APPROVE, RES-DEMO-REJECT, RES-DEMO-BLOCKED; REF-DEMO-REJECT; SCHG-DEMO-APPROVE và SCHG-DEMO-WAIVE |
| Phí và trả kho | Manager duyệt 150.000đ, miễn 60.000đ; Staff ghi nhận thanh toán rồi trả kho; chặn checkout còn phí chưa xử lý, chuyển tủ bị hỏng sang bảo trì và lưu kết quả sau tải lại |
| Phân công và nhận kho | Điều kiện phân công/đổi ưu tiên; mở chi tiết và Start task; checklist inspection, giới hạn ảnh, lưu ảnh, hủy xác nhận không ghi dữ liệu; handover cần người xác nhận; kích hoạt đơn đã thanh toán và chặn đơn chưa thanh toán |
| Gia hạn và quyền truy cập | Tính phí, phiên bản gia hạn, chặn xung đột và trùng lịch; bấm UNLOCK, LOCK, RESET, SUSPEND, RESUME, REVOKE; chặn mở khóa khi bị đình chỉ |
| Bảo trì và hỗ trợ | Manager tạo ticket và khóa tủ, Staff xử lý rồi hoàn tất để nhả tủ; phản hồi khách, chuyển support sang RESOLVED rồi CLOSED; Manager xem cùng kết quả và có thông báo khách |
| Giao diện và lưu dữ liệu | Hai bộ kiểm thử kiểm tra tổng cộng 40 lượt trang ở kích thước desktop/mobile; menu và đường dẫn đã được mở lại; không ghi nhận lỗi JavaScript trong các phiên kiểm thử |

Đã kiểm tra trực tiếp bằng thao tác trình duyệt các form inspection, handover, check-in, task, access, extension, maintenance và support. Sửa một lỗi nhãn truy cập của ô **Closure note** và kiểm tra lại thành công bước đóng ticket.

Các bộ kiểm thử nằm tại:

- `.design-reference/check-rental-demo.cjs`
- `.design-reference/check-facility-operations.cjs`
- `.design-reference/check-staff-manager-ui.cjs`

`npm run build` thành công. Vite còn cảnh báo bundle chính lớn hơn 500 kB; cảnh báo này không làm build thất bại.

**Giới hạn kết quả:** đây là kiểm thử giao diện và logic dữ liệu demo trong trình duyệt. Chưa xác nhận đăng nhập Staff/Manager, API backend, chuyển tiền hoặc khóa cửa thật. Khi trình bày, nói rõ các thao tác này đang mô phỏng nghiệp vụ để demo Iteration 1–3.
