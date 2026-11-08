# Điều kiện trước khi kết nối live

| Khả năng | Trạng thái và điều kiện |
| --- | --- |
| Website build/full regression | RESOLVED. Sau khi người dùng xác nhận, `npm ci --ignore-scripts --no-audit --no-fund` cài 281 package từ lockfile. Production build qua và 158/158 test qua sau khi cập nhật hai fixture. Hash manifest và lockfile trùng baseline. |
| Managed Customer signing | BACKEND DEPENDENCY: cần compare-and-sign nguyên tử với version/hash Customer đã xem; GET trước POST không đủ. Giữ đọc/refresh/progress. |
| Contract print raw / Support private association | Raw print thiếu kiểm tra ownership/facility tương ứng, giữ A4 từ detail đã xác thực. Support dùng text-only cho tới khi Backend xác minh được từng loại private ID. |
| Mobile auth/read | Cần deployment/version/base URL đã duyệt, luồng session native không lộ secret, chính sách logout/re-login và cache theo user. Không có refresh endpoint đã xác nhận. Kết nối từng read adapter và kiểm tra failure/missing data; không fallback fixture. |
| Mobile Self/Managed booking | Cần kiểm tra deployment cho catalogue, exact availability/calendar, server quote, overlap/unknown-create recovery, stock/snapshot tương ứng. Managed V2 deposit/check-in/balance có gate development; không fallback legacy. |
| Mobile Inventory | Cần chấp thuận riêng cho mutation và runtime gates; MI06 repeated create/amend/canonical outbound không mở production theo source. Read/cancel có guard riêng. Cần E2E về key/version, custody, stock và closure khi có môi trường được phép. |
| Payments và Self handover | Self PayOS Website giữ nguyên. Mobile chưa duyệt return/deep link, HTTPS, server provider/webhook, retry/reconciliation. Không có Managed PayOS. Không mở mock Self dựa vào Vite env; không coi production-deny là xác nhận simulator an toàn. Self handover còn giới hạn dev/test trong source. |
| Notification/Support | Kết nối owner-scoped reads/read-one và public conversation sau phê duyệt. Bulk/push/typed destinations/attachments và private associations không có contract đủ để mở. |
| Native acceptance | Hermes/RN Web không xác minh hardware Back, keyboard, accessibility, session storage, resume, native redirect hoặc E2E trên thiết bị. |

Chi tiết điều kiện và mã nguồn: [Phase 6A-R security and gates](../PHASE6AR/SECURITY_AND_FEATURE_GATES.md). Không sửa Backend hoặc mở runtime gate trong task này.
