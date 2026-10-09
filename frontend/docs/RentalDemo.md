# Rental workflow web demo

Hướng dẫn hiện tại cho M4: demo web Iteration 1–3. Chưa làm Iteration 4. Phần bên dưới về Iteration 1/2 vẫn dùng được; phần Iteration 3 nằm cuối tài liệu.

Bản demo chính bằng tiếng Việt: [StaffManagerDemoVI.md](./StaffManagerDemoVI.md), gồm đường dẫn, lời trình bày và các case chờ duyệt bổ sung. Theo yêu cầu mới, đã bỏ việc ẩn menu/URL của Staff và Facility Manager. Các role khác giữ nguyên. Phạm vi trình bày vẫn chỉ là M4 Iteration 1–3, bắt đầu ở `/manager/operations` và `/staff/dashboard`.

Scope: M4 web demo - Iteration 1, 2 and 3 only. Iteration 4 is deferred. Iteration 1/2: P010/P011/P013/P064/P065. Iteration 3: P025/P026/P029/P030/P031/P038/P039/P040/P043/P044/P045. These features use browser fixtures because the required business APIs are not available in this repository. Authentication and existing real account APIs are unchanged.

## Run and demonstrate

From `frontend`, run `npm run dev`. Business demo mode defaults to enabled; keep `VITE_USE_MOCK=true` if configuring an environment file. Open the existing role workspaces directly for this demo. Login still requires the real authentication backend.

1. Open `/staff/customers`. Search `0902345678` to find Mai Trading Co. Open the customer and save verification with review notes. `/manager/customers/CUS-002` displays the same status and actor history, including in another tab.
2. Open `/staff/reservations/RES-M002`. Approve the request after customer verification. Alternatively, reject a pending reservation with a required reason. The decision and simulated customer notification persist after reload. No contract or real notification is generated.
3. Open `/manager/refunds/REF-M001`. Review the illustrative calculation (1,350,000 × 10 / 30 = 450,000 VND). Approve with an explicit reason. Only the Facility Manager demo workspace can make refund decisions.
4. Open `/staff/refunds/REF-M001`. Select **Vo Lan Anh** in the **Demo operator** dropdown. Enter a processing reference, confirm the checkbox, review and confirm processing. Other operators cannot process this assigned refund. Completion updates the shared demo payment to REFUNDED and records the amount, actor, reference and receipt. Processing again is blocked.
5. Open `/portal/payments`. The **Facility demo refund receipts** section displays the completed receipt for the sample customer Nguyen Van An. This is explicitly separate from the signed-in account. Existing Customer payment history is preserved.
6. Staff or Manager can use **New refund request**. Select PAY-M002, enter unused/billing days and a reason. The preview recalculates immediately. The request must then be approved by Manager before Staff can process it. Only one pending request per payment is permitted.

Additional customer/verification demo routes: `/manager/customers`, `/admin/customers`. The Admin user-management API screen remains separate. Existing Staff operational refund samples remain accessible from the shared queue as SREF-001/SREF-002; those historical samples belong to the separate operational fixture store.

Use a fresh private browser session for a clean demonstration. Demo data persists in browser localStorage. No MongoDB data is reset or changed.

## Feature status

| Feature | Demo roles | Reused implementation | API | Validation |
| --- | --- | --- | --- | --- |
| P010 customer directory/detail | Staff, Manager, Admin | CustomersPage, existing role layouts and Table/Details | None added | Phone/name/email search, history, unavailable records, responsive routes |
| P011 verification | Staff, Manager, Admin | CustomersPage, managerDemoStore | None added | Required notes, actor/time history, cross-tab refresh |
| P013 reservation review | Staff, Manager | ReservationsPage, Decision, managerDemoStore | None added | Verification/availability gates, required rejection reason, second-decision guard, local notification and reload |
| P064 refund request/calculation/approval | Staff requests, Manager requests/decides | FinancePage, Dialog/Decision, managerDemoStore | None added | Day validation, illustrative calculation, required decision reason, duplicate pending request and Manager-only decisions |
| P065 processing/receipt | Authorized assigned Staff; Customer reads sample receipt | FinancePage, StaffPages, PaymentHistoryPage | None added | Approval prerequisite, reference/acknowledgement, duplicate guard, shared payment/receipt and Customer receipt view |

The shared features extend the existing Manager store and its localStorage key; Staff uses the same customer/reservation/refund records. Other Staff operations keep their existing store. Dashboard, customer totals and the revenue report deduct only the recorded refund amount, preserving the remainder of partial refunds.

## Iteration 3 — M4 web: đường dẫn và kịch bản demo

Chạy `npm run dev` trong thư mục `frontend`. Dùng URL mà Vite in ra; ví dụ `http://localhost:5173`. Mở các đường dẫn dưới đây trên cùng một origin, trong hai tab của cùng trình duyệt. Không mở một tab bằng `localhost` và tab kia bằng `127.0.0.1` vì dữ liệu browser sẽ khác nhau.

Login vẫn cần backend thật. Với buổi demo giao diện, mở trực tiếp `/manager/operations` và `/staff/dashboard`; dropdown **Demo operator** chỉ chọn người thao tác trong dữ liệu mẫu, không phải đăng nhập thật hoặc cơ chế bảo mật backend.

| Feature M4 | Màn hình / đường dẫn | Nội dung trình bày |
| --- | --- | --- |
| P044 | `/manager/tasks` hoặc `/manager/operations` | Giao/reassign task cho Staff đủ loại nghiệp vụ; lý do bắt buộc; kiểm tra trùng giờ; lịch sử phân công |
| P045 | `/manager/operations`, `/staff/facility-operations` | Board nhóm theo Staff; lọc ngày/loại/status/người; hạn trễ màu đỏ; task HIGH chưa giao được cảnh báo |
| P030 | `/staff/inspections/STASK-INSP001`, `/staff/inspections/STASK-INSP002` | Inspection trước/sau; checklist, condition, notes, ảnh; liên kết inspection với rental và unit |
| P039 | `/staff/handovers/STASK-HO001` | Bàn giao đúng unit sau payment và inspection; checklist, hướng dẫn access, xác nhận khách, actor/time |
| P025 | `/staff/check-ins/STASK-CI001` | Check-in có kiểm tra tiền, inspection và handover; chuyển rental Active và unit OCCUPIED |
| P040 | `/manager/facility-operations` hoặc `/staff/facility-operations`, tab **Access simulation** | Lock/unlock, suspend/resume, reset/revoke; actor/action/time; không kết nối thiết bị |
| P029 | `/manager/extensions` hoặc tab **Contract extensions** ở `/staff/facility-operations` | Quote 25.000 VND/ngày minh họa; kiểm tra unit, ngày và booking xung đột; lưu phiên bản hợp đồng và tạo phí chờ thanh toán |
| P043 | `/manager/charges`, tab **Extra charges** ở `/staff/facility-operations` | Phí hư hỏng có inspection reference; Manager duyệt/miễn; ghi nhận thanh toán demo; chặn checkout còn phí |
| P026 | `/staff/checkouts/STASK-CO001` | Checkout sau inspection và xử lý phí; đóng rental, thu hồi access; unit hư hỏng vào MAINTENANCE |
| P031 | `/manager/maintenance`, `/staff/maintenance`, tab **Create maintenance** | Tạo ticket, priority, assignee; chặn unit; Staff xử lý; sửa xong trả unit về AVAILABLE |
| P038 | `/manager/support`, `/staff/support/STASK-SUP001` | Phân công, trao đổi, Open → In progress → Resolved → Closed; ghi chú bắt buộc và thông báo khách mô phỏng |

Manager có cùng checklist cho dữ liệu Iteration 3, tại `/manager/work/<TYPE>/<TASK_ID>`. Ví dụ `/manager/work/INSPECTION/STASK-INSP001`, `/manager/work/CHECK_IN/STASK-CI001`, `/manager/work/CHECKOUT/STASK-CO001`, `/manager/work/SUPPORT/STASK-SUP001`. Các link **Open checklist** từ board đi thẳng đến những màn hình này. Staff chỉ thao tác task được giao cho Demo operator đang chọn; Manager dùng phạm vi facility.

### Demo tuần tự khoảng 10–15 phút

1. **Phân công và board:** Mở `/manager/tasks`, nhập **Assignment reason** trước, rồi giao `STASK-CI001` từ Pham Quoc Bao sang Vo Lan Anh. Mở `/staff/tasks`, chọn **Vo Lan Anh**: task xuất hiện. Quay lại Manager, giao về **Pham Quoc Bao** để tiếp tục chuỗi dưới đây; Staff cũng chọn Bao. Có thể thử giao task này cho Maintenance để giải thích kiểm tra qualification (dropdown không cung cấp người không phù hợp).
2. **Inspection → bàn giao → check-in:** Mở `/staff/inspections/STASK-INSP001`, giữ GOOD, tải ảnh nhỏ nếu có, tick 4 mục và nhập notes → Save inspection → Confirm demo operation. Mở `/staff/handovers/STASK-HO001`, tick 3 mục, nhập tên/xác nhận khách và notes → xác nhận. Sau đó `/staff/check-ins/STASK-CI001`, tick checklist, notes → Activate paid rental. Rental `SRNT-001` thành Active, unit A-101 thành OCCUPIED. Mở `STASK-CI002` để chỉ ra rental chưa trả tiền sẽ bị chặn.
3. **Access:** `/manager/facility-operations`, tab Access simulation; chọn `SRNT-001`, nhập lý do. UNLOCK → LOCK → SUSPEND; thử UNLOCK để thấy bị chặn; RESUME rồi UNLOCK. RESET tăng phiên bản access mô phỏng; REVOKE là bước cuối vì không thể tái sử dụng access đã revoke. Nhật ký lưu người và thời điểm. Không có khóa thật, QR thật hoặc thiết bị thật.
4. **Gia hạn:** `/manager/extensions`, chọn `SRNT-003`, chọn ngày sau hôm nay 7 ngày, nhập lý do, xem quote **175.000 VND** rồi Approve extension. Bảng lịch sử có v2 và ngày cũ/mới. Gia hạn trùng ngày hoặc chạm booking mẫu từ ngày +60 đến +90 bị chặn. `/manager/charges`: nhập reference/notes, Record demo payment cho phí gia hạn để không còn phí này khi checkout.
5. **Checkout có hư hỏng:** `/staff/inspections/STASK-INSP002`, chọn MINOR_DAMAGE, ghi “Door scratched”, có thể tải ảnh, tick đủ, notes → Save inspection. `/staff/checkouts/STASK-CO001`: tick checklist, đề xuất **100.000 VND**, notes → Complete checkout → Confirm. Rental vẫn Active, unit vẫn OCCUPIED; có phí PENDING_MANAGER_REVIEW, chưa đóng rental.
6. **Duyệt phí và đóng rental:** `/manager/charges`: lý do duyệt → Approve charge → Record demo payment với reference, hoặc Manager Waive có lý do. `/portal/payments`, phần **Iteration 3 facility demo adjustments**, cho xem phí và trạng thái của khách mẫu Le Thu Ha (SCUS-003). Quay về checkout, xác nhận lại; nếu reload thì tick/notes lại. Form không tạo trùng phí đã đề xuất. Rental Closed, access REVOKED; unit A-203 chuyển MAINTENANCE và phát sinh task HIGH chưa giao. Board hiển thị cảnh báo để Manager giao cho Maintenance.
7. **Bảo trì:** `/manager/facility-operations`, tab Create maintenance, chọn unit trống B-106, nhập issue/priority, giao Dang Minh Duc. Unit bị chặn MAINTENANCE. `/staff/maintenance`, chọn Demo operator **Dang Minh Duc**, mở ticket mới: lưu In progress có notes, sau đó Completed có notes. Unit B-106 về AVAILABLE. Manager có thể đổi priority/giao lại trong board với lý do. Với ticket hư hỏng sau checkout, giao task HIGH chưa có người rồi xử lý tương tự.
8. **Support:** `/staff/support/STASK-SUP001`, chọn **Vo Lan Anh**. Nhập response và notes, lưu In progress. Sau đó chọn Completed/resolved, nhập ghi chú giải quyết; cuối cùng nhập Closure note và Close support ticket. Không được đi thẳng từ Open sang resolved. Manager đọc cùng ticket qua `/manager/work/SUPPORT/STASK-SUP001`. Tab Customer notifications ở workspace hiển thị message mô phỏng theo customer; không gửi email thật.
9. **Persistence:** Reload hoặc chuyển hai tab để chứng minh phân công, trạng thái và lịch sử được giữ. Khi trình bày, nói rõ đây là demo UI/business flow, chưa xác nhận API end-to-end.

### Phạm vi và dữ liệu

- Excel Iteration 3: P034/P035 là phần mobile/Flutter, không thực hiện trong phạm vi web đã yêu cầu. Không tính chúng là hoàn thành.
- P039/P040: bản tracking còn mô tả credential/hardware; demo dùng checklist bàn giao và access simulation theo Product, không tuyên bố đã tích hợp khóa phần cứng.
- Iteration 4 chưa triển khai trong lần này. Inventory, storage-location và report cũ không đưa vào kịch bản M4 Iteration 3; menu và route vẫn hiển thị để nhóm sử dụng.
- Dữ liệu Iteration 3 dùng `VaultSpace_staff_priority3_demo_v1`, cả Manager và Staff cùng đọc/ghi. Dữ liệu Iteration 1/2 vẫn dùng key Manager riêng và các ID `CUS-/RES-/REF-`. Không trình bày hai bộ fixture này là backend xuyên suốt.
- Ảnh được lưu dưới dạng data URL trong browser, tối đa 3 ảnh / tổng 2 MB mỗi inspection; không upload lên server. Để lặp demo sạch, dùng cửa sổ riêng tư mới. Không xóa MongoDB hay dữ liệu thật.
- Giá gia hạn, booking hold mẫu, thanh toán, miễn phí, notifications và access đều là dữ liệu minh họa. Chưa có PDF hợp đồng thật hoặc cổng thanh toán/API thiết bị.

Kiểm tra tự động Iteration 3: `.design-reference/check-facility-operations.cjs`. Script dùng Edge headless và Playwright có sẵn trong Codex runtime; không thêm dependency dự án. Nó kiểm tra luồng Manager–Staff, các guard giữ nguyên state khi bị chặn, inspection có ảnh, checkout/phí, gia hạn/booking conflict, maintenance/support, persistence và responsive routes.

Kết quả kiểm tra: luồng Iteration 3 và 18 lượt kiểm tra route ở 1440/390 px đã qua, không có lỗi JavaScript. Hồi quy Iteration 1/2 cũng qua, gồm 22 lượt kiểm tra route. Vite production build qua; còn cảnh báo bundle lớn hơn 500 kB.

## Modified files

- `src/lib/managerDemoStore.js`: shared demo mutations, actor validation/history, refund request and processing, net-payment helper; rereads the latest saved state before a mutation.
- `src/pages/manager/CustomersPage.jsx`: shared role-aware customer screen, phone search and verification history.
- `src/pages/manager/ReservationsPage.jsx`: shared Staff/Manager review and verification prerequisite.
- `src/pages/manager/FinancePage.jsx`: request form, required Manager decision reason, Staff processing and receipts.
- `src/pages/staff/StaffPages.jsx`: reuse shared finance screen, retaining legacy refund detail samples.
- `src/pages/customer/PaymentHistoryPage.jsx`: read-only facility demo receipt section for the named sample customer.
- `src/pages/manager/DashboardPage.jsx`, `src/pages/manager/ReportsPage.jsx`: preserve financial totals after partial refunds; add REFUNDED report filter.
- `src/components/manager/ManagerUI.jsx`: optional decision reason requirement and REFUNDED badge.
- `src/routes/StaffRoutes.jsx`, `src/layouts/StaffLayout.jsx`: customer/reservation links and shared pages.
- `src/routes/AdminRoutes.jsx`, `src/layouts/AdminLayout.jsx`: separate demo customer directory/detail.

No new production source files, services, dependencies or backend endpoints. New support files: this guide and `.design-reference/check-rental-demo.cjs` for browser validation. Screenshots are QA artifacts.

## Validation and limits

- Frontend build succeeds. The existing >500 kB main-bundle warning remains.
- New browser tests cover shared decisions/receipts, Customer receipt view, permissions, unchanged data on rejected mutations, net revenue and 22 desktop/mobile route checks without JavaScript errors.
- Existing Customer booking/contract persistence regression passes.
- Existing Staff operational regression covers 56 desktop/mobile routes, check-in/payment gates, inspection/handover, inbound/relocation/outbound, damage/maintenance/support and legacy refunds.
- No lint/test npm scripts are defined; browser helpers provide the available functional checks.

Demo states retain the repository's PENDING/APPROVED/REJECTED conventions. Backend lifecycle, DTOs, server authorization/facility scope, concurrent transactions, real notification, policy snapshots and payouts still require confirmed backend integration. The unused-day formula is a named illustrative policy, not the unconfirmed production cancellation tiers. Browser checks model demo permissions only. localStorage does not provide atomic cross-tab transactions.

Backend is unnecessary for these business demos. Running real login/profile still needs the existing Express/Keycloak/MongoDB setup documented in the backend README. No real API end-to-end verification is claimed.
