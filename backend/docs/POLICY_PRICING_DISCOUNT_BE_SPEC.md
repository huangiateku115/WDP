# Đặc tả BE: Pricing · Chính sách kinh doanh · Giảm giá

Ngày: 2026-11-18 · Nhánh: `feat/BOM+Admin` · Người lập: FE (BOM/Admin)

Mục tiêu: để BOM/Admin **tự cấu hình** được giá, chính sách và giảm giá thay vì phụ thuộc script seed,
mà không làm hỏng luồng đang chạy (báo giá Managed, đăng ký SKU, thanh toán).

---

## 1. Hiện trạng (đã đối chiếu source)

| Mảng | Trạng thái | Bằng chứng |
|---|---|---|
| **Bảng giá** (`pricing-rules`) | ✅ Đủ CRUD cho BOM/ADMIN: `POST`, `PATCH /:id`, `PATCH /:id/status`; future-only; revision; chống chồng lấn; `GET /resolve` | `src/routes/pricing-policy.routes.ts:19-24`, `src/services/pricing-policy/rule.service.ts:99-160,186-241` |
| **Chính sách** (`policies`) | 🟡 Chỉ đọc. Không đăng ký route ghi, service chặn cứng | `src/routes/pricing-policy.routes.ts:18-21`, `rule.service.ts:101` (create), `:245` (update) |
| **Giảm giá** (`DISCOUNT`/`WAIVER`) | 🔴 Không có engine: `discountAmount` luôn = 0 khi tạo đơn | `src/services/reservations/reservation.service.ts:460`, `src/services/reservations/managed-reservation.service.ts:196`; hạ tầng đã có chỗ nhận: `src/services/payments/payment-accounting.ts:44-53` |
| **Audit** | 🔴 Không ghi log cho mọi thay đổi rule/policy (kể cả pricing) | `rule.service.ts` không import `AuditLogModel` |
| **Quyền đọc policy** | 🔴 Mọi role đã đăng nhập (kể cả CUSTOMER) đọc được `GET /policies` của mọi cơ sở | `rule.service.ts:18-22` (`authorize` chỉ xét role) |
| **Config theo type** | 🟡 Chỉ `DEPOSIT`(Managed) và `CATEGORY` có schema; 6 type còn lại nhận JSON bất kỳ ≤16KB | `rule.validation.ts:59-80,121-127` |
| **`serviceType` của policy** | 🟡 Không bắt buộc; thiếu thì rơi vào scope `serviceType: {$exists:false}` và không bao giờ resolve | `rule.validation.ts:83-86`, `rule.service.ts:33-40` |

Nguyên tắc đã có sẵn trong service (phải **giữ nguyên**, không nới lỏng):

- `effectiveFrom` phải ở tương lai khi tạo (`rule.service.ts:105`), không backdate khi sửa (`:270`).
- Rule/policy đã hiệu lực là **bất biến**, chỉ được "đóng" bằng `effectiveTo` ở tương lai (`:263-274`).
- Mỗi scope `(facilityId, serviceType, type)` chỉ 1 bản hiệu lực — chồng lấn trả 409 (`:64-88`).
- Ghi đi qua transaction + `RuleScope` sequence để cấp `version` và chống ghi đồng thời (`:83-97`).

---

## 2. Phạm vi thay đổi đề xuất (BE)

### 2.1. Chính sách: append-only (tạo mới + đóng), KHÔNG cho sửa `config`

Lý do: giữ lịch sử kiểm toán sạch, tránh sửa sai `config` của policy đang được dùng để tính cọc/chặn SKU,
và tránh lỗi PATCH gửi full body (đã ghi ở `docs/BOM_ADMIN_BACKEND_GAPS.md:83`).

| Method | Path | Role | Ghi chú |
|---|---|---|---|
| `POST` | `/policies` | BOM, ADMIN | Tạo phiên bản mới; bỏ `throw 403` tại `rule.service.ts:101` |
| `PATCH` | `/policies/:id/close` | BOM, ADMIN | Body **chỉ** `{ "effectiveTo": ISO }`; route riêng để không mở đường sửa `config` |
| `PATCH` | `/policies/:id/status` | BOM, ADMIN | Chỉ cho policy **chưa** hiệu lực (`isActive: true/false`) |

**Không** mở `PATCH /policies/:id` cho `config`. Nếu vẫn muốn dùng chung `update()`, hãy chặn khi payload
có key khác `effectiveTo`.

#### Request/Response

```http
POST /api/v1/policies
Authorization: Bearer <BOM|ADMIN>
Content-Type: application/json

{
  "facilityId": "652f…",
  "serviceType": "MANAGED_INVENTORY",   // BẮT BUỘC (xem 2.4)
  "type": "DEPOSIT",                    // PolicyType
  "effectiveFrom": "2026-12-01T00:00:00.000Z",   // phải > now
  "effectiveTo": "2027-06-01T00:00:00.000Z",     // optional
  "isActive": true,                              // default true
  "config": { "calculation": "PERCENT_OF_RENT", "percentage": 20 }
}
→ 201 { "success": true, "data": PolicyDto }         // PolicyDto = rule read DTO + effectiveTo: null
```

```http
PATCH /api/v1/policies/:id/close
{ "effectiveTo": "2026-12-01T00:00:00.000Z" }        // > now; > effectiveFrom
→ 200 { "success": true, "data": PolicyDto }
```

```http
PATCH /api/v1/policies/:id/status
{ "isActive": false }                                 // chỉ policy có effectiveFrom > now
→ 200 { "success": true, "data": PolicyDto }
```

#### Mã lỗi (dùng lại `RuleError`, không tạo mã mới)

| HTTP | Message (giữ nguyên tiếng Anh như hiện tại) | Khi nào |
|---|---|---|
| 400 | `effectiveFrom is required` / `Invalid …` | Thiếu/sai định dạng |
| 403 | `Business policies are system-controlled and read-only` | Chỉ còn khi role không phải BOM/ADMIN |
| 409 | `New versions must start in the future` | `effectiveFrom <= now` |
| 409 | `Effective period overlaps an active rule` | Chồng lấn cùng scope |
| 409 | `Effective rule is immutable; only prospective closure is allowed` | Sửa policy đã hiệu lực ngoài `effectiveTo` tương lai |
| 409 | `Facility is not ACTIVE` / `Facility does not support serviceType` | `parent()` |
| 409 | `Policy scope would be left without an effective version` | **mới** — xem 2.5 |

### 2.2. Validate `config` theo `type` (bắt buộc trước khi mở form)

`rule.validation.validateConfig` hiện chỉ có DEPOSIT-Managed và CATEGORY. Cần thêm schema tối thiểu:

| type | config | Ghi chú |
|---|---|---|
| `DEPOSIT` (SELF_STORAGE) | `{ amount: number>0, currency: "VND" }` | seeder đang dùng |
| `DEPOSIT` (MANAGED) | `{ calculation: "PERCENT_OF_RENT", percentage: number>=0 }` | đã có |
| `CANCELLATION` / `REFUND` / `OVERDUE` | `{ description?: string }` | chưa có engine → chỉ thông tin |
| `DISCOUNT` / `WAIVER` | xem 2.6 | cần chốt nghiệp vụ |
| `CATEGORY` | `{ allowedCategories: string[1..100], blockedCategories?: string[] }` | đã có |
| `SHELF_CONSTRAINT` | `{ description?: string }` | chưa có engine |

### 2.3. Audit cho mọi thay đổi

- Thêm vào `ActionType` (`src/types/audit.type.ts`): `POLICY_CREATE`, `POLICY_CLOSE`, `POLICY_STATUS_CHANGE`,
  `PRICING_CREATE`, `PRICING_UPDATE`, `PRICING_STATUS_CHANGE`.
- Ghi `AuditLog` **trong cùng transaction** khi `create/update/close/status` thành công:
  `{ actorId, actorRole, action, entityType: 'Policy'|'PricingRule', entityId, facilityId, before, after }`.
- `before/after` chỉ chứa field an toàn (đã có `SAFE_AUDIT_DETAIL_FIELDS` trong `audit.service.ts:26-31`).

### 2.4. Siết quyền đọc policy

- `GET /policies`, `GET /policies/:id`: chỉ `ADMIN`, `BOM`, `FACILITY_MANAGER`.
- `CUSTOMER` chỉ dùng `GET /policies/resolve` (đúng nhu cầu hiện tại: `components/customer/RentalPeriodIntegration.jsx:106`).
- Lý do: policy chứa `config` chiết khấu/đặt cọc của **mọi** cơ sở; hiện mọi role đọc được.

### 2.5. Bắt buộc `serviceType` + guard "không để scope trống"

- `POST /policies`: `serviceType` **required** (400 nếu thiếu). Tránh policy vô hình do `keyFilter` dùng
  `serviceType: {$exists:false}`.
- Guard vận hành: khi `close`/`status=false` mà scope `(facilityId, serviceType, type)` sẽ **không còn bản hiệu lực**
  trong tương lai, trả `409 Policy scope would be left without an effective version`.
  Lý do: `managed-reservation.service.ts:166-176` và `inventory-item.service.ts:421-430` yêu cầu **đúng 1** policy
  hiệu lực; thiếu = ngừng bán Managed / không đăng ký SKU được.
- Thứ tự thao tác đúng (cần ghi trong docs/UI): **(1) tạo bản mới hiệu lực từ X → (2) đóng bản cũ từ X**.

### 2.6. Giảm giá — cần chốt nghiệp vụ trước, sau đó là phần việc nhỏ

Hạ tầng đã sẵn: `discountAmount` có trong model đơn (`models/reservations/reservation.model.ts:124`),
trong mọi breakdown (`payment-accounting.ts:44-53`), và đã được trả về/hiển thị ở FE. Chỉ thiếu **người tính**.

Cần quyết 5 điểm (chưa có trong code/SRS):

1. Giá trị: `PERCENT` trên tiền thuê hay `AMOUNT` cố định? Có mức trần không?
2. Phạm vi: theo `facilityId + serviceType`, hay theo hạng khách / mã khuyến mại?
3. Điều kiện: kỳ hạn tối thiểu, số đơn trước đó, thời gian thuê?
4. Xếp tầng: có cho nhiều policy cùng hiệu lực (ưu tiên/cộng dồn) không? Nếu không, phải có guard 1-bản-hiệu-lực như DEPOSIT.
5. Áp vào `rentAmount` (và có trừ `deposit`/`tax` không)?

Đề xuất tối giản (nếu chưa chốt được): `DISCOUNT = { valueType: "PERCENT", value: 0..100 }` áp trên `estimatedRent`
tại thời điểm tạo đơn, không cộng dồn, 1 policy hiệu lực / scope. Điểm chèn:

- `reservation.service.ts` (~line 455-465) và `managed-reservation.service.ts` (~line 190-196): resolve policy
  DISCOUNT/WAIVER theo `facilityId + serviceType + at`, tính `discountAmount`, truyền vào `calculateRentalPaymentBreakdown`,
  lưu vào reservation và snapshot.
- Trả thêm `discount: { policyId, valueType, value, amount }` trong quote/estimate response để FE hiển thị lý do.

---

## 3. Acceptance criteria

**Policy**
- [ ] BOM tạo được policy `DEPOSIT` (Managed, 20%) hiệu lực từ ngày mai; `GET /policies/resolve` trả đúng bản đó.
- [ ] Tạo policy chồng lấn cùng scope → 409 `Effective period overlaps an active rule`.
- [ ] Tạo với `effectiveFrom` trong quá khứ → 409 `New versions must start in the future`.
- [ ] `PATCH /:id/close { effectiveTo }` trên policy đang hiệu lực → 200; sau ngày đó `resolve` trả 404 (không còn hiệu lực).
- [ ] Đóng policy DEPOSIT/CATEGORY duy nhất → 409 `Policy scope would be left without an effective version`.
- [ ] `PATCH /:id` có `config` → 403/405 (không có route).
- [ ] Tạo policy thiếu `serviceType` → 400.
- [ ] CUSTOMER gọi `GET /policies` → 403; `GET /policies/resolve` → 200.
- [ ] Mỗi lần tạo/đóng/status đều có 1 bản ghi `AuditLog` tương ứng, thấy được trong `GET /audit/logs?entityType=Policy`.

**Pricing**
- [ ] Mọi create/update/status đều ghi `AuditLog` (hiện đang thiếu).
- [ ] `PATCH /pricing-rules/:id` trên rule đã hiệu lực vẫn tạo revision (giữ nguyên hành vi hiện tại).

**Discount** (sau khi chốt câu hỏi 2.6)
- [ ] Đơn tạo trong thời gian policy hiệu lực có `discountAmount > 0` và `totalDue` khớp `rent + tax - discount`.
- [ ] Đơn tạo trước khi policy hiệu lực giữ `discountAmount = 0`.
- [ ] `GET /reservations/:id` trả `discountAmount` + lý do (policyId) để FE hiển thị.

---

## 4. Việc FE đã chuẩn bị (không cần chờ BE)

- `lib/ruleEffect.js` + `components/bom/RuleEffectBadge.jsx`: badge **Đang hiệu lực / Sắp hiệu lực / Đã đóng / Ngừng sử dụng**
  cho bảng giá, chính sách, giảm giá, danh mục hàng (có unit test `tests/bom-rule-effect.test.mjs`).
- `lib/bomCapabilities.js`: flag `policyWrite: false` + lý do hiển thị; nút "Tạo chính sách"/"Đóng từ ngày…" render ở dạng
  **disabled** kèm lý do (đúng hình dạng cuối, không giả vờ hoạt động).
- Khi BE xong, FE nối theo checklist trong header của `lib/bomCapabilities.js`:
  1. `bomPolicyApi.create/close/setActive` trong `src/api/bomApi.js`
  2. allowlist `POST /policies`, `PATCH /policies/:id/close`, `PATCH /policies/:id/status` trong `src/api/confirmedContract.js`
  3. `lib/bomMappers.policyBody` + `policyCloseBody`, route `policies/new`, form theo `type`
  4. đổi `policyWrite: true`

## 5. Ước lượng

| Hạng mục | Ước lượng |
|---|---|
| 2.1 + 2.5 route/guard policy | 0.5 ngày |
| 2.2 validate config theo type | 0.5 ngày |
| 2.3 audit (policy + pricing) | 0.5 ngày |
| 2.4 siết quyền đọc | 0.25 ngày |
| 2.6 discount engine (bản tối giản) | 1–1.5 ngày |
| Test/E2E + docs | 0.5 ngày |
| **Tổng** | **~3.5–4 ngày** (không gồm chờ chốt nghiệp vụ giảm giá) |
