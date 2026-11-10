# Phase 6B.1A — Đối chiếu phạm vi

Task-start HEAD là `b7f09b48299882075d6c16511f8419fdb040488a`. Git index không có staged diff. Lệnh status từ worktree cha bị hạn chế quyền chdir. Metadata ghi các đường dẫn tracked có bytes khác index, các đường dẫn chưa tracked và các index entry ngoài phạm vi hash. So sánh bytes trực tiếp không áp dụng chuẩn hóa CRLF, vì vậy danh sách này có thể gồm chênh lệch dòng do checkout. [Git state và task-start SHA-256](PHASE6B1A_BASELINE.json).

Manifest dưới đây tính theo task-start, bao gồm báo cáo. Dependency, cache Metro và artifacts tạo bởi export/smoke nằm ngoài manifest source. Phạm vi đối chiếu Backend và BE-REF dùng các tập source đã ghi ở phase Customer alignment.

Đã kiểm 1.827 hash gồm 1.313 Frontend, 257 Backend và 257 BE-REF. Mọi file baseline đều đọc được. Chỉ `fixtureAdapter.ts` đổi hash. Customer Website, các role ngoài Customer, Backend và BE-REF có 0 chênh lệch trong tập kiểm kê.

| Trạng thái | File trong `frontend/customer-mobile/` |
| --- | --- |
| Sửa | `src/api/contracts/fixtureAdapter.ts` |
| Mới | `src/api/contracts/fixtureAuth.ts` |
| Mới | `src/state/createFixtureAuthSession.ts` |
| Mới | `tests/fixture-auth-session.test.ts` |
| Mới | `docs/PHASE6B1A_BASELINE.json` |
| Mới | `docs/PHASE6B1A_AUTH_REPORT.md` |
| Mới | `docs/PHASE6B1A_SESSION_DESIGN.md` |
| Mới | `docs/PHASE6B1A_CONTRACT_TESTS.md` |
| Mới | `docs/PHASE6B1A_PRESERVATION.md` |

Kiểm kê UI đạt 23/23 thiết kế. Năm tab, màn hình demo và Expo Router guards giữ nguyên theo hash. Mobile Axios guard SHA-256 là `cfc5016fd0b5cd0e60183f7a73adf1ca30e2de6ff97ebbedfdbfdcb1b500d774`. Các test kiểm tra GET, POST, PUT, PATCH, DELETE, HEAD và OPTIONS bị chặn trước khi đến Axios adapter.
