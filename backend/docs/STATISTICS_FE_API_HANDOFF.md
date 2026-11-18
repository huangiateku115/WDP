# VaultSpace Statistics API — FE Handoff

**Scope:** Backend Statistics Phase 1–5. **Base path:** `/api/v1/statistics`. All endpoints use `GET` and return read-only analytics or a file download.

## Authentication and access

Send `Authorization: Bearer <access-token>` on every request. The Statistics router requires an authenticated user with role `ADMIN`, `BOM`, or `FACILITY_MANAGER`.

| Role | Scope |
|---|---|
| `ADMIN` | System wide, or one active Facility with `facilityId`. |
| `BOM` | System wide, or one Facility, subject to existing scope rules. |
| `FACILITY_MANAGER` | Only the assigned active Facility. A different `facilityId`, system wide request, or missing/invalid assignment is rejected. |
| `CUSTOMER`, `FACILITY_STAFF` | Forbidden. |

Unauthenticated requests return `401`; unauthorized roles and Facility scope violations return `403`. Scope is resolved by the service before aggregation and before export rendering.

## API catalog (22 endpoints)

| Method | URL | Purpose | Roles | Common query parameters | FE group |
|---|---|---|---|---|---|
| GET | `/statistics/overview` | Reservations, paid bookings, collections, customer totals | ADMIN, BOM, MANAGER | `fromDate`, `toDate`, `facilityId`, `serviceType`, `comparePrevious` | Admin/BOM/Manager overview |
| GET | `/statistics/revenue` | Verified PayOS collected amount and trends | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity`, `comparePrevious` | Financial |
| GET | `/statistics/facilities-ranking` | Facility ranking by collection, customers, reservations | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `sortBy`, `sortOrder`, `page`, `limit` | Admin/BOM comparison |
| GET | `/statistics/customers` | Verified renter/customer aggregates | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity` | Customer trends |
| GET | `/statistics/service-mix` | Service type booking/payment mix | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType` | Business mix |
| GET | `/statistics/unit-demand` | Unit demand by type/size | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `unitSize` | Demand |
| GET | `/statistics/rental-trends` | Booking and rental trend series | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity` | Demand/trends |
| GET | `/statistics/utilization` | Self Storage utilization summary | ADMIN, BOM, MANAGER | dates, `facilityId` | Storage |
| GET | `/statistics/storage-capacity` | Current Storage Unit status/capacity snapshot | ADMIN, BOM, MANAGER | `facilityId`, `unitSize`, `status` | Storage |
| GET | `/statistics/managed-capacity` | Current V4 Cell capacity and stock reconciliation | ADMIN, BOM, MANAGER | `facilityId` | Managed capacity |
| GET | `/statistics/reservations` | Reservation cohort, payment evidence, status and trends | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `unitSize`, `granularity` | Reservations |
| GET | `/statistics/contracts-lifecycle` | Contract evidence, current lifecycle and renewals | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `unitSize`, `expiringWithinDays` | Contracts |
| GET | `/statistics/managed-operations` | Committed schema V4 ADD/REMOVE/MOVE operations | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity`, `action`, `skuId`, `itemSpecId`, `reservationId`, `page`, `limit` | Operations |
| GET | `/statistics/incidents` | Maintenance ticket counts, categories, duration | ADMIN, BOM, MANAGER | dates, `facilityId`, `granularity`, `status` | Incidents |
| GET | `/statistics/payments-analysis` | PayOS payment intents by status and verified captures | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity`, `paymentStatus` | Payments |
| GET | `/statistics/financial-analytics` | Verified successful PayOS captures by period/facility/purpose | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity`, `comparePrevious`, `paymentStatus=SUCCEEDED` only | Financial |
| GET | `/statistics/product-and-operations` | Combined service, demand, customer and V4 operations view | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `granularity` | Product/operations |
| GET | `/statistics/facilities-kpi` | Facility KPIs, incidents, contracts and capacity utilization | ADMIN, BOM, MANAGER | dates, `facilityId`, `serviceType`, `sortBy`, `sortOrder`, `expiringWithinDays`, `page`, `limit` | Admin/BOM/Manager overview |
| GET | `/statistics/filters` | Scoped Facilities and supported enum values | ADMIN, BOM, MANAGER | optional `facilityId` | Filter controls |
| GET | `/statistics/export/csv` | Download a supported report as UTF-8 CSV | ADMIN, BOM, MANAGER | `reportType` plus that report's filters | Export |
| GET | `/statistics/export/xlsx` | Download a supported report as XLSX | ADMIN, BOM, MANAGER | `reportType` plus that report's filters | Export |
| GET | `/statistics/export/pdf` | Download a supported report as Vietnamese PDF | ADMIN, BOM, MANAGER | `reportType` plus that report's filters | Export |

All event filters use Vietnam calendar dates (`Asia/Ho_Chi_Minh`) with inclusive `fromDate` and inclusive `toDate` translated to `[start, endExclusive)`. Incident `status` accepts only `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`; export incident status uses the same enum and rejects status values from other domains. Date range is capped at 366 calendar days. `granularity` is `day`, `week`, or `month`; pagination uses `page` and `limit` where exposed.

### Export report types and filters

Each export route accepts one of: `facilities-kpi`, `revenue`, `financial-analytics`, `managed-operations`, `storage-capacity`, `managed-capacity`, `reservations`, `contracts-lifecycle`, `incidents`.

Common filters are `fromDate`, `toDate`, `facilityId`. Report filters: facilities KPI (`serviceType`, `sortBy`, `sortOrder`, `expiringWithinDays`); revenue (`serviceType`, `granularity`, `comparePrevious`); financial analytics (`serviceType`, `granularity`, `comparePrevious`, `paymentStatus=SUCCEEDED`); managed operations (`serviceType`, `granularity`, `action`, `skuId`, `itemSpecId`, `reservationId`); storage capacity (`unitSize`, `status`); reservations (`serviceType`, `granularity`, `unitSize`); contracts lifecycle (`serviceType`, `unitSize`, `expiringWithinDays`); incidents (`granularity`, `status`). Managed capacity has no additional filter. Snapshot exports (`storage-capacity`, `managed-capacity`) reject `fromDate` and `toDate`. Unsupported filters and pagination on export requests return a structured `400`, never silently disappear.

Exports reuse the Phase 1–4 service results. The bound is 1,000 flattened rows, 8 MB, 25 seconds and two concurrent exports. An over-limit report returns `413` with a narrowing hint. Nothing is silently truncated. Financial export only includes verified successful PayOS captures; `paymentStatus` other than `SUCCEEDED` is rejected for financial analytics.

### Filter compatibility by endpoint

| Endpoint | Accepted filters |
|---|---|
| overview | dates, Facility, service type, comparePrevious |
| revenue | dates, Facility, service type, granularity, comparePrevious |
| facilities-ranking | dates, Facility, service type, sortBy/sortOrder, page/limit |
| customers | dates, Facility, service type, granularity |
| service-mix | dates, Facility, service type |
| unit-demand | dates, Facility, service type, unitSize |
| rental-trends | dates, Facility, service type, granularity |
| utilization | dates, Facility |
| storage-capacity | Facility, unitSize, StorageUnit status (snapshot; dates are descriptive only) |
| managed-capacity | Facility (V4 current snapshot; no date filters) |
| reservations | dates, Facility, service type, unitSize, granularity |
| contracts-lifecycle | dates, Facility, service type, unitSize, expiringWithinDays |
| managed-operations | dates, Facility, service type, granularity, action, skuId, itemSpecId, reservationId, page/limit |
| incidents | dates, Facility, granularity, Maintenance status |
| payments-analysis | dates, Facility, service type, granularity, PaymentStatus |
| financial-analytics | dates, Facility, service type, granularity, comparePrevious, paymentStatus=SUCCEEDED only |
| product-and-operations | dates, Facility, service type, granularity |
| facilities-kpi | dates, Facility, service type, sortBy/sortOrder, expiringWithinDays, page/limit |
| filters | optional Facility scope |

## Response contract

JSON success responses use `{ "success": true, "data": ..., "meta": ... }`. `data` contains report metrics/series. `meta` contains applicable Facility scope, timezone, generated time, period or `snapshotAt`, data basis/completeness and limitations. Export period labels normalize `meta.period`, `meta.requestedPeriod`, or top-level `fromDate`/`toDateExclusive` to Vietnamese calendar dates; `toDateExclusive` is rendered as the final included date. Snapshot labels retain `snapshotAt` and explicitly say current snapshot. Paginated endpoints include pagination fields under `data`.

- Dates represent a Vietnam local calendar range; event cohorts use `[fromDate, toDateExclusive)`.
- Capacity/status APIs are current snapshots. `snapshotAt` identifies when the snapshot was assembled; it does not make it historical occupancy.
- `null` means unavailable or unverified. Render it as unavailable; do not coerce it to zero. Export cells use “Không có dữ liệu xác minh”.
- Read `meta.dataCompleteness` and `meta.limitations` before displaying derived capacity/financial ratios.
- Financial `collectedAmount` is verified PayOS capture cash received, not recognized revenue. Refund, net cash flow and recognized revenue are null.
- Managed capacity uses `ManagedCellStock` + `ManagedItemInstance` V4 reconciled against schema V4 movement ledger. Unreconciled usage/utilization remains null.

Errors are JSON `{ "success": false, "code": "...", "message": "..." }`. Common codes: `UNAUTHENTICATED` (401); `STATISTICS_FORBIDDEN`, `FACILITY_SCOPE_FORBIDDEN`, `FACILITY_ASSIGNMENT_REQUIRED` (403); `INVALID_QUERY`, `INVALID_DATE`, `INVALID_DATE_RANGE`, `DATE_RANGE_TOO_LARGE`, `INVALID_STATUS`, `INVALID_PAYMENT_STATUS`, `UNSUPPORTED_REPORT_TYPE`, `UNSUPPORTED_REPORT_FILTER`, `SNAPSHOT_DATE_FILTER_UNSUPPORTED`, `EXPORT_PAGINATION_UNSUPPORTED` (400); `EXPORT_ROW_LIMIT_EXCEEDED`, `EXPORT_FILE_SIZE_LIMIT_EXCEEDED` (413); `EXPORT_BUSY` (429); `EXPORT_TIMEOUT` (503).

## Dashboard mapping

- **Admin Dashboard:** `overview`, `facilities-ranking`, `facilities-kpi`, `filters`; add `revenue` and `financial-analytics` for collections.
- **BOM Dashboard:** `overview`, `service-mix`, `unit-demand`, `rental-trends`, `facilities-ranking`, `facilities-kpi`, `product-and-operations`.
- **Facility Manager Dashboard:** same operational reports with server enforced assigned Facility scope.
- **Financial Analytics:** `revenue`, `payments-analysis`, `financial-analytics`.
- **Storage & Managed Capacity:** `utilization`, `storage-capacity`, `managed-capacity`.
- **Managed Operations:** `managed-operations`, `product-and-operations`.
- **Reservations/Contracts:** `reservations`, `contracts-lifecycle`.
- **Incidents:** `incidents` and the open incident KPI in `facilities-kpi`.
- **Export Reports:** one of the three export paths plus a supported `reportType` and dashboard filters.

## Export integration (TypeScript)

```ts
async function downloadStatisticsExport(
  format: 'csv' | 'xlsx' | 'pdf',
  reportType: string,
  filters: Record<string, string>,
  token: string,
) {
  const url = new URL(`/api/v1/statistics/export/${format}`, window.location.origin);
  url.searchParams.set('reportType', reportType);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = await response.json(); // failures are JSON, not a file
    throw new Error(error.message || `Export failed (${response.status})`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `statistics.${format}`;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = objectUrl; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
}
```

The API sends `Content-Disposition: attachment; filename="vaultspace-statistics-{reportType}-{YYYY-MM-DD}.{format}"`, the format MIME type, `Content-Length`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. Keep the request in the authenticated app context; do not persist the Blob longer than needed.

CSV is UTF-8 with BOM, Vietnamese headers, CSV quoting and formula-injection protection. XLSX has “Thông tin báo cáo” and “Dữ liệu” sheets with typed numeric/date cells and formula-injection protection. PDF is A4 landscape and embeds Roboto fonts for Vietnamese. Deployments must install the declared `pdfmake` dependency and retain its bundled Roboto font files; `pdfmake` is MIT and Roboto is Apache 2.0. The backend allows only those bundled PDF font paths and denies remote resources.

## Known limitations

- No verified refund ledger; refund amount, net cash flow and recognized revenue are unavailable (`null`).
- Partial/full Outbound cannot be reliably distinguished for all historical movement evidence.
- Current capacity snapshot is not historical occupancy.
- V4 managed capacity can report null when source coverage or ledger reconciliation is incomplete or mismatched.
- Export has explicit row/file/time/concurrency limits; narrow filters after a `413`.
- Database runtime behavior and production data were not verified in this handoff.

**Verification state:** `DB_RUNTIME_VERIFICATION: NOT_PERFORMED`; `POSTMAN_LIVE_VERIFICATION: NOT_PERFORMED`; `PRODUCTION_READINESS: NOT_VERIFIED`.
