// Live BOM DTO mapping between the backend API contract (WDP-Backend.postman_collection.json)
// and the BOM view models used by the live Facility / Pricing / Policy pages.
import { money } from "@/components/manager/ManagerUI";
import { facilityLabel } from "@/lib/facilityLabels";

export const BOM_SERVICE_TYPES = ["SELF_STORAGE", "MANAGED_INVENTORY"];
export const BOM_UNIT_SIZES = ["SMALL", "MEDIUM", "LARGE"];
export const BOM_TERM_MONTHS = [1, 3, 6, 12];
export const BOM_CURRENCY = "VND";

// Only policy types confirmed by the backend PolicyType enum are offered live.
export const BOM_POLICY_TYPES = [
  { key: "DEPOSIT", label: "Đặt cọc" },
  { key: "CANCELLATION", label: "Hủy đơn" },
  { key: "REFUND", label: "Hoàn tiền" },
  { key: "OVERDUE", label: "Quá hạn" },
  { key: "SHELF_CONSTRAINT", label: "Ràng buộc kệ" },
];
export const BOM_POLICY_LABELS = Object.fromEntries(BOM_POLICY_TYPES.map(({ key, label }) => [key, label]));

// Display labels for backend enum values rendered in the console (never show raw codes).
export const BOM_SERVICE_LABELS = { SELF_STORAGE: "Thuê kho riêng", MANAGED_INVENTORY: "Lưu trữ hàng hóa" };
export const BOM_DISCOUNT_KIND_LABELS = { PROMOTIONAL: "Khuyến mại", LOYALTY: "Khách hàng thân thiết", FEE_WAIVER: "Miễn phụ phí" };
export const serviceLabel = (value) => BOM_SERVICE_LABELS[value] || String(value || "").replaceAll("_", " ") || "—";

// Resource photography is an ordered list of absolute HTTP(S) URLs on the backend
// (facility.model.ts / storage-unit.model.ts). The console renders `images` only in that
// order and treats the first entry as the public catalog cover.
export function httpImages(value) {
  return Array.isArray(value) ? value.filter((url) => typeof url === "string" && /^https?:\/\//i.test(url)) : [];
}

export const responseData = (response) => response?.data?.data ?? response?.data ?? null;
export function responseList(response) {
  const body = response?.data;
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return { rows, pagination: body?.pagination ?? null };
}

export function bomFutureDate(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
// A rule/policy whose effectiveFrom already passed is immutable except for a prospective
// effectiveTo, so the edit form must not send the scope, price or config fields.
export function isEffectiveRecord(record) {
  return Boolean(record?.effectiveFrom) && record.effectiveFrom <= new Date().toISOString().slice(0, 10);
}
export function toInstant(dateStr) {
  return dateStr ? new Date(`${dateStr}T00:00:00.000Z`).toISOString() : undefined;
}
export function fromInstant(value) {
  return value ? String(value).slice(0, 10) : "";
}

/* ------------------- Warehouse map, units, managed inventory ------------------- */
// Flattens the /warehouse-map read model (zones -> aisles -> racks) into rack rows.
export function warehouseFromDto(dto) {
  const zones = Array.isArray(dto?.zones) ? dto.zones : [];
  const racks = [];
  zones.forEach((zone) => {
    (zone.aisles || []).forEach((aisle) => {
      (aisle.racks || []).forEach((rack) => {
        const utilization = rack.utilization || {};
        const dims = rack.dimensions || {};
        const envelopeM3 = (Number(dims.widthM) || 0) * (Number(dims.depthM) || 0) * (Number(dims.heightM) || 0);
        racks.push({
          id: rack._id,
          zoneCode: zone.code || "—",
          zoneName: zone.name || zone.code || "—",
          aisleCode: aisle.aisleCode || "—",
          rackCode: rack.rackCode || "—",
          operationalStatus: rack.operationalStatus || "—",
          cellCount: rack.cellCount ?? 0,
          availableCellCount: rack.availableCellCount ?? 0,
          envelopeM3,
          ratedCapacityKg: utilization.ratedCapacityKg ?? utilization.maxWeightKg ?? 0,
          allocatableCapacityKg: utilization.allocatableCapacityKg ?? 0,
          usedWeightKg: utilization.usedWeightKg ?? 0,
          utilizationStatus: utilization.status || "EMPTY",
        });
      });
    });
  });
  return { zones, racks };
}

/* ------------------ Warehouse structure list collections ------------------ */
export function zoneFromDto(d) {
  return {
    id: d?._id,
    facilityId: d?.facilityId || "",
    code: d?.code || "",
    name: d?.name || "",
    description: d?.description || "",
    color: d?.color || "",
    sortOrder: d?.sortOrder ?? 0,
    isActive: d?.isActive !== false,
  };
}

export function rackFromDto(d) {
  const dims = d?.dimensions || {};
  const widthM = Number(dims.widthM) || 0;
  const depthM = Number(dims.depthM) || 0;
  const heightM = Number(dims.heightM) || 0;
  return {
    id: d?._id,
    facilityId: d?.facilityId || "",
    zoneId: d?.zoneId || "",
    aisleCode: d?.aisleCode || "",
    rackCode: d?.rackCode || "",
    dimensions: { widthM, depthM, heightM },
    levelCount: d?.levelCount ?? 0,
    cellsPerLevel: d?.cellsPerLevel ?? 0,
    cellCount: (d?.levelCount ?? 0) * (d?.cellsPerLevel ?? 0),
    maxWeightKgPerLevel: d?.maxWeightKgPerLevel ?? 0,
    maxWeightKg: d?.maxWeightKg ?? (d?.levelCount ?? 0) * (d?.maxWeightKgPerLevel ?? 0),
    mapX: d?.mapX ?? 0,
    mapY: d?.mapY ?? 0,
    orientation: d?.orientation ?? 0,
    operationalStatus: d?.operationalStatus || "",
    envelopeM3: widthM * depthM * heightM,
  };
}

export function cellFromDto(d) {
  const dims = d?.dimensions || {};
  const widthM = Number(dims.widthM) || 0;
  const depthM = Number(dims.depthM) || 0;
  const usableHeightM = dims.usableHeightM === undefined ? null : Number(dims.usableHeightM);
  return {
    id: d?._id,
    rackId: d?.rackId || "",
    zoneId: d?.zoneId || "",
    code: d?.code || "",
    levelNumber: d?.levelNumber ?? 0,
    cellNumber: d?.cellNumber ?? 0,
    dimensions: { widthM, depthM, usableHeightM },
    maxWeightKg: d?.maxWeightKg ?? 0,
    usableVolumeM3: usableHeightM === null ? null : widthM * depthM * usableHeightM,
    operationalStatus: d?.operationalStatus || "",
  };
}

export function unitFromDto(d) {
  const images = httpImages(d?.images);
  return {
    id: d?._id,
    facilityId: d?.facilityId?._id || d?.facilityId || "",
    code: d?.unitCode || "",
    size: d?.size || "",
    status: d?.status || "",
    volumeM3: d?.volumeM3 ?? 0,
    dimensions: d?.dimensions || {},
    description: d?.description || "",
    images,
    coverImage: images[0] || "",
  };
}

export function inventoryItemFromDto(d) {
  return {
    id: d?._id,
    code: d?.itemCode || "",
    name: d?.name || "",
    category: d?.category || "",
    quantity: d?.quantity ?? 0,
    quantityUnit: d?.quantityUnit || "",
    totalVolumeM3: d?.totalVolumeM3 ?? 0,
    totalWeightKg: d?.totalWeightKg ?? 0,
    status: d?.status || "",
    placed: Boolean(d?.currentCellId),
    facilityId: d?.facilityId || "",
    customerId: d?.customerId || "",
    reservationId: d?.managedReservationId || "",
    description: d?.description || "",
    unitWeightKg: d?.unitWeightKg ?? 0,
    unitVolumeM3: d?.unitVolumeM3 ?? 0,
    unitDimensionsM: d?.unitDimensionsM || null,
    preferredCellId: d?.preferredCellId || null,
    currentCellId: d?.currentCellId || null,
    inboundRequestedAt: d?.inboundRequestedAt || "",
    inboundConfirmedAt: d?.inboundConfirmedAt || "",
    rejectionReason: d?.inboundRejection?.reason || "",
    createdAt: d?.createdAt || "",
    updatedAt: d?.updatedAt || "",
  };
}

// ItemMovement ledger rows (GET /inventory-items/:id/movements). Management roles also
// receive customerId/performedBy, which is what the BOM/Admin console displays.
export function itemMovementFromDto(d) {
  return {
    id: d?._id,
    type: d?.type || "",
    sourceCellId: d?.sourceCellId || null,
    cellId: d?.destinationCellId || null,
    quantity: d?.quantity ?? 0,
    quantityUnit: d?.quantityUnit || "",
    totalWeightKg: d?.actualTotalWeightKg ?? 0,
    totalVolumeM3: d?.actualTotalVolumeM3 ?? 0,
    performedBy: d?.performedBy || "",
    performedAt: d?.performedAt || d?.createdAt || "",
    // INBOUND uses inspectionNote, OUTBOUND handoverNote and RELOCATION relocationNote.
    note: d?.inspectionNote || d?.handoverNote || d?.relocationNote || "",
    physicalPackingConfirmed: d?.physicalPackingConfirmed,
  };
}

/* ----------------------------- Facilities ----------------------------- */
export function facilityFromDto(d) {
  const a = d?.address || {};
  return {
    id: d?._id,
    code: d?.code || "",
    name: d?.name || "",
    line1: a.line1 || "",
    ward: a.ward || "",
    district: a.district || "",
    city: a.city || "",
    country: a.country || "",
    address: [a.line1, a.ward, a.district, a.city, a.country].filter(Boolean).join(", "),
    contact: d?.contact || {},
    contactPhone: d?.contact?.phone || "",
    contactEmail: d?.contact?.email || "",
    openingHours: d?.operatingHours || "",
    description: d?.description || "",
    serviceTypes: Array.isArray(d?.serviceTypes) ? d.serviceTypes : [],
    images: httpImages(d?.images),
    coverImage: httpImages(d?.images)[0] || "",
    status: d?.status || "ACTIVE",
    managedVisitSchedule: d?.managedVisitSchedule || null,
    deleted: Boolean(d?.deletedAt),
  };
}
export function facilityForm(d) {
  const f = facilityFromDto(d);
  const schedule = f.managedVisitSchedule;
  const weeklyHours = Array.from({ length: 7 }, (_, weekday) => {
    const configured = schedule?.weeklyHours?.find((entry) => entry.weekday === weekday);
    return { weekday, enabled: Boolean(configured), opensAt: configured?.opensAt || "09:00", closesAt: configured?.closesAt || "18:00" };
  });
  return {
    code: f.code,
    name: f.name,
    line1: f.line1,
    ward: f.ward,
    district: f.district,
    city: f.city,
    country: f.country || "Vietnam",
    contactPhone: f.contactPhone,
    contactEmail: f.contactEmail,
    openingHours: f.openingHours,
    description: f.description,
    serviceTypes: f.serviceTypes.length ? f.serviceTypes : ["SELF_STORAGE"],
    images: f.images,
    status: f.status,
    visitScheduleEnabled: Boolean(schedule),
    visitScheduleDraft: { slotDurationMinutes: schedule?.slotDurationMinutes || 60, weeklyHours },
  };
}
export function facilityBody(form, { includeCode = false } = {}) {
  const address = {
    line1: (form.line1 || form.address || "").trim(),
    city: (form.city || form.district || "").trim(),
    country: (form.country || "Vietnam").trim(),
  };
  if (form.ward?.trim()) address.ward = form.ward.trim();
  if (form.district?.trim()) address.district = form.district.trim();
  const body = {
    name: (form.name || "").trim(),
    address,
    serviceTypes: form.serviceTypes?.length ? form.serviceTypes : ["SELF_STORAGE"],
    status: form.status || "ACTIVE",
  };
  // phone/email are optional but individually validated; an empty contact object is rejected,
  // so the group is only sent when at least one value is present.
  const contact = {};
  if (form.contactPhone?.trim()) contact.phone = form.contactPhone.trim();
  if (form.contactEmail?.trim()) contact.email = form.contactEmail.trim();
  if (Object.keys(contact).length) body.contact = contact;
  if (includeCode) body.code = (form.code || "").trim().toUpperCase();
  if (form.openingHours?.trim()) body.operatingHours = form.openingHours.trim();
  if (form.description?.trim()) body.description = form.description.trim();
  if ("visitScheduleEnabled" in form && form.serviceTypes?.includes("MANAGED_INVENTORY")) {
    body.managedVisitSchedule = form.visitScheduleEnabled ? {
      timeZone: "Asia/Ho_Chi_Minh",
      slotDurationMinutes: Number(form.visitScheduleDraft?.slotDurationMinutes),
      weeklyHours: (form.visitScheduleDraft?.weeklyHours || []).filter((entry) => entry.enabled)
        .map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })),
    } : null;
  }
  if (Array.isArray(form.images)) {
    body.images = form.images.map((url) => String(url).trim()).filter(Boolean);
  }
  return body;
}

/* ------------------------------ Pricing ------------------------------- */
export function pricingFromDto(d) {
  const term = d?.term || {};
  return {
    id: d?._id,
    facilityId: d?.facilityId,
    service: d?.serviceType,
    unitSize: d?.unitSize || "",
    billingMonths: term.value ?? 1,
    termUnit: term.unit || "MONTH",
    rate: d?.price ?? 0,
    currency: d?.currency || BOM_CURRENCY,
    effectiveFrom: fromInstant(d?.effectiveFrom),
    effectiveTo: fromInstant(d?.effectiveTo),
    hasEffectiveTo: hasEffectiveTo(d),
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
  };
}
export function pricingLabel(row) {
  const scope = row.service === "MANAGED_INVENTORY"
    ? "Công suất lưu trữ"
    : `Kho riêng ${facilityLabel(row.unitSize || "")}`.trim();
  return `${scope} · chu kỳ ${row.billingMonths} tháng`;
}
export function pricingBody(form) {
  const body = {
    facilityId: form.facilityId,
    serviceType: form.service,
    term: { value: Number(form.billingMonths), unit: "MONTH" },
    price: Number(form.rate),
    currency: form.currency || BOM_CURRENCY,
    effectiveFrom: toInstant(form.effectiveFrom),
    isActive: form.status === "ACTIVE",
  };
  if (form.service === "SELF_STORAGE") body.unitSize = form.unitSize;
  // scope() forces billingBasis for Managed rules, so the create body must carry it.
  if (form.service === "MANAGED_INVENTORY") body.billingBasis = "PER_M3";
  if (form.effectiveTo) body.effectiveTo = toInstant(form.effectiveTo);
  return body;
}
// PATCH /pricing-rules/:id only accepts effectiveFrom, effectiveTo, price and currency.
export function pricingUpdateBody(form, { effective = false } = {}) {
  if (effective) return form.effectiveTo ? { effectiveTo: toInstant(form.effectiveTo) } : {};
  const body = {
    price: Number(form.rate),
    currency: (form.currency || BOM_CURRENCY).trim().toUpperCase(),
    effectiveFrom: toInstant(form.effectiveFrom),
  };
  if (form.effectiveTo) body.effectiveTo = toInstant(form.effectiveTo);
  return body;
}

/* ------------------------------ Policies ------------------------------ */
// The backend keeps a policy rule inside `config` (amount/currency, calculation/percentage or
// allowedCategories/blockedCategories); it never returns a `config.rule` string, so the console
// summarises the fields the document really carries instead of leaving the column blank.
function policyRuleLabel(config) {
  if (!config || typeof config !== "object") return "";
  if (Array.isArray(config.allowedCategories) || Array.isArray(config.blockedCategories)) {
    return `${(config.allowedCategories || []).length} danh mục được phép · ${(config.blockedCategories || []).length} danh mục bị chặn`;
  }
  if (config.calculation === "PERCENTAGE" && Number.isFinite(Number(config.percentage))) return `${config.percentage}%`;
  if (Number.isFinite(Number(config.amount))) return money(Number(config.amount));
  return "";
}

// `effectiveTo` is stored by the backend but is absent from every read DTO today, so screens must
// tell "open-ended" apart from "the API did not return it" instead of always printing 1 giá trị.
const hasEffectiveTo = (d) => Boolean(d) && Object.prototype.hasOwnProperty.call(d, "effectiveTo");

export function policyFromDto(d) {
  const config = d?.config || {};
  return {
    id: d?._id,
    facilityId: d?.facilityId,
    service: d?.serviceType || "",
    type: d?.type,
    name: BOM_POLICY_LABELS[d?.type] || d?.type || "Chính sách",
    description: config.description || "",
    rule: typeof config.rule === "string" && config.rule ? config.rule : policyRuleLabel(config),
    effectiveFrom: fromInstant(d?.effectiveFrom),
    effectiveTo: fromInstant(d?.effectiveTo),
    hasEffectiveTo: hasEffectiveTo(d),
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
    config,
  };
}

/* --------------------- Discounts / waivers (Policy) -------------------- */
export const BOM_DISCOUNT_TYPES = ["DISCOUNT", "WAIVER"];
export const BOM_DISCOUNT_KINDS = ["PROMOTIONAL", "LOYALTY", "FEE_WAIVER"];

export function discountFromDto(d) {
  const config = d?.config || {};
  const kind = config.kind || (d?.type === "WAIVER" ? "FEE_WAIVER" : "PROMOTIONAL");
  return {
    id: d?._id,
    facilityId: d?.facilityId,
    service: d?.serviceType || "",
    policyType: d?.type,
    kind,
    name: config.name || (kind === "FEE_WAIVER" ? "Fee waiver" : "Discount"),
    valueType: config.valueType || "UNDEFINED",
    value: config.value ?? "",
    conditions: config.conditions || "",
    effectiveFrom: fromInstant(d?.effectiveFrom),
    effectiveTo: fromInstant(d?.effectiveTo),
    hasEffectiveTo: hasEffectiveTo(d),
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
    config,
  };
}
export function discountValueLabel(row) {
  if (row.valueType === "UNDEFINED") return "Chưa xác định";
  if (row.valueType === "PERCENTAGE") return `${row.value}%`;
  return money(row.value);
}

/* --------------------- Item categories (Policy CATEGORY) ---------------- */
// The backend CATEGORY policy stores only { allowedCategories[], blockedCategories[] } and
// requires serviceType MANAGED_INVENTORY, so the console edits those two lists directly.
const asCategoryList = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);

export function categoryFromDto(d) {
  const config = d?.config || {};
  const allowed = asCategoryList(config.allowedCategories);
  const blocked = asCategoryList(config.blockedCategories);
  return {
    id: d?._id,
    facilityId: d?.facilityId,
    service: d?.serviceType || "",
    type: d?.type,
    name: allowed.length ? allowed.join(", ") : "Danh mục hàng hóa",
    allowedCategories: allowed.join("\n"),
    blockedCategories: blocked.join("\n"),
    allowedCount: allowed.length,
    blockedCount: blocked.length,
    effectiveFrom: fromInstant(d?.effectiveFrom),
    effectiveTo: fromInstant(d?.effectiveTo),
    hasEffectiveTo: hasEffectiveTo(d),
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
    config,
  };
}

/* ---------------------------- Reservations ---------------------------- */
export const BOM_RESERVATION_STATUSES = [
  "RESERVED", "DEPOSIT_PAID", "CHECKIN_READY", "CONTRACTED", "PAID", "ACTIVE", "OVERDUE", "CHECKED_OUT", "CLOSED", "CANCELLED",
];

export function reservationFromDto(d) {
  const customer = d?.customerId;
  const unit = d?.storageUnitId;
  const facility = d?.facilityId;
  return {
    id: d?._id,
    code: d?.reservationCode || "",
    facilityId: facility && typeof facility === "object" ? facility._id : facility,
    service: d?.serviceType,
    // Managed reservations have their own detail route (GET /reservations/managed/:id).
    isManaged: d?.serviceType === "MANAGED_INVENTORY",
    customerName: (customer && typeof customer === "object"
      ? customer.displayName || customer.fullName || customer.email
      : null) || "Khách hàng",
    unitCode: unit && typeof unit === "object" ? unit.unitCode : undefined,
    unitSize: unit && typeof unit === "object" ? unit.size : undefined,
    allocatedCapacity: d?.allocatedCapacity ?? null,
    startDate: fromInstant(d?.startDate),
    endDate: fromInstant(d?.endDate),
    status: d?.status || "RESERVED",
    estimatedRent: d?.estimatedRent ?? 0,
    depositAmount: d?.depositAmount ?? 0,
    createdAt: d?.createdAt || "",
  };
}
