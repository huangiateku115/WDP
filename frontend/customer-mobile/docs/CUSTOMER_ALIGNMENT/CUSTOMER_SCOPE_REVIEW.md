# Phạm vi Customer-only

WDP_CUSTOMER_ONLY_BACKEND_ALIGNMENT, 07/11/2026. Áp dụng các chênh lệch Customer đã xác minh ở Backend `b7f09b48299882075d6c16511f8419fdb040488a` so với `7a5cd84`. Đây là kiểm tra source và fixture; chưa kiểm tra deployment.

- Đọc `frontend/AGENTS.md`, chín tài liệu Phase 6A-R được yêu cầu, Website Customer và 23 màn hình Mobile. [Bằng chứng Backend theo file/dòng](../PHASE6AR/SOURCE_EVIDENCE.md), [route/method và contract](../PHASE6AR/API_CHANGE_MATRIX.csv), [gates và ownership](../PHASE6AR/SECURITY_AND_FEATURE_GATES.md).
- Website: thay đổi giới hạn trong component/hàm Customer, lifecycle copy và test Customer. Component review hợp đồng dùng chung chỉ rẽ nhánh Customer; test fixture kiểm tra nhánh Facility Staff/Manager.
- Mobile: bảy module contract thuần, adapter GET chỉ dùng fixture, một số nội dung/form demo, tests. Không đổi router, tab, store, Axios, cấu hình, manifest hay lockfile.
- Không thực hiện 11 sửa chữa allowlist Staff; không sửa Staff, Manager, Admin, BOM, Backend hoặc BE-REF. Không chạy database, provider, API live, deploy hoặc merge.
- Baseline trước sửa: 375/375 Mobile tests, SHA-256 của 1.214 file được chọn, xem [BASELINE.json](BASELINE.json). `git status` tại checkout trả lỗi không thể chuyển tới thư mục Git cha; kết luận thay đổi dựa vào hash trước/sau, không suy diễn rằng working tree sạch từ đầu.
