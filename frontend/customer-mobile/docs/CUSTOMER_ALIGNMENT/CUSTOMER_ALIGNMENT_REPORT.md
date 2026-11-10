# WDP Customer-only Backend alignment

**REVIEW_REQUIRED.** Website đã qua production build và toàn bộ 158 test sau khi khôi phục dependencies từ lockfile. Mobile hoàn tất lớp contract và fixture offline.

| Phần | Báo cáo |
| --- | --- |
| A — Scope và baseline | [Scope review](CUSTOMER_SCOPE_REVIEW.md) |
| B — Website và thay đổi theo file | [Website changes](CUSTOMER_WEBSITE_CHANGES.md) |
| C — Mobile, DTO và presentation | [Mobile changes](CUSTOMER_MOBILE_CHANGES.md) |
| D — Backend consistency | [Source evidence](../PHASE6AR/SOURCE_EVIDENCE.md), [API matrix](../PHASE6AR/API_CHANGE_MATRIX.csv), revision `b7f09b4` |
| E/H — Tích hợp giữ nguyên và danh sách diff | [Preservation](CUSTOMER_PRESERVATION.md), [before/after hashes](PRESERVATION.json) |
| F — Test/build | [Contract tests](CUSTOMER_API_CONTRACT_TESTS.md) |
| G/I — Security và phần còn lại | [Blockers](CUSTOMER_BLOCKERS.md) |

Website kiểm tra closure theo từng thao tác, giữ idempotency/version và cleanup đủ điều kiện, khóa ký Managed của Customer đến khi Backend ràng buộc nội dung review. Self dùng lifecycle đã xác nhận và chỉ chuyển Unit khi Customer chọn, giữ ngày và đi qua bước xác nhận lại. Support giữ text-only và lọc internal. Mobile làm sạch DTO và dữ liệu trình bày, giữ fail-closed ở mọi HTTP method.

```text
[C2C]
TASK_ID: WDP_CUSTOMER_ONLY_BACKEND_ALIGNMENT
STATE: REVIEW_REQUIRED
BACKEND_BASELINE: b7f09b4
SCOPE: CUSTOMER_WEB_AND_CUSTOMER_MOBILE_ONLY
CUSTOMER_WEB_FILES_CHANGED: 11
CUSTOMER_MOBILE_FILES_CHANGED: 17
NON_CUSTOMER_ROLE_FILES_CHANGED: 0
BACKEND_FILES_CHANGED: 0
WEBSITE_BUILD: PASS
WEBSITE_TESTS: 158/158 FULL; 8/8 FOCUSED
MOBILE_TESTS: 447/447; 7/7 RN WEB SMOKE; HERMES IOS AND ANDROID PASS
MOBILE_AXIOS: FAIL_CLOSED
LIVE_API_MUTATIONS: 0
BLOCKERS: REVIEW-BOUND SIGNING; VERIFIED DEPLOYMENT AND NATIVE TRANSPORT/GATES
NEXT_RECOMMENDATION: REVIEW OFFLINE CONTRACTS BEFORE ANY LIVE MOBILE INTEGRATION
```
