# Đối chiếu phạm vi cuối

Đã kiểm đủ 1.214 file baseline (700 Frontend, 257 Backend, 257 BE-REF). Có 16 file code/test hiện có được sửa và 12 file mới, tổng cộng **11 Website và 17 Mobile** tính cả test/script. Các file Staff, Manager, Admin, BOM, Backend và BE-REF trong baseline có cùng hash. [Baseline](BASELINE.json) · [Hash trước và sau](PRESERVATION.json).

Baseline loại trừ .env/secrets, symlink, Git metadata, dependencies và output tạo bởi test/build. Thư mục báo cáo gồm bảy Markdown, hai JSON baseline/preservation và tám test logs. Hermes, thư mục tạm và screenshot smoke nằm dưới `customer-mobile/artifacts/`. Đã khôi phục Website `node_modules` từ lockfile sau khi người dùng xác nhận. Hash manifest và lockfile Website/Mobile trùng baseline.

- Website: không đổi route/auth/axiosClient/confirmedContract/inventoryApi. PayOS checkout, payment history, QR payload, availability, canonical outbound, A4 safe print và notification files giữ nguyên. Không chuyển sang legacy hoặc mock khi API chưa hỗ trợ.
- Facility contract review branch không bị khóa bởi thay đổi Customer; fixture kiểm tra cả Staff và Manager. Không đổi API ký dùng chung.
- Mobile: 23 design và năm tab giữ nguyên; route/app config, store và Axios client giữ nguyên. SHA-256 guard: `cfc5016fd0b5cd0e60183f7a73adf1ca30e2de6ff97ebbedfdbfdcb1b500d774`. Không có transport thật trong fixture adapters.

`git status` không khả dụng vì Git không chuyển được vào worktree cha. `git show` qua Git metadata xác nhận HEAD và đối chiếu từng file; chỉ 10 file sửa có HEAD byte-for-byte trùng baseline. Do đó danh sách cuối dùng hash task-start, tránh quy các thay đổi có sẵn vào task. Không commit, merge hoặc deploy.
