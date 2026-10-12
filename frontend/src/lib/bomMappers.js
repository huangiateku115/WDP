// Live BOM DTO mapping between the backend API contract (WDP-Backend.postman_collection.json)
// and the BOM view models used by the live Facility / Pricing / Policy pages.
import { money } from "@/components/manager/ManagerUI";

export const BOM_SERVICE_TYPES = ["SELF_STORAGE", "MANAGED_INVENTORY"];
export const BOM_UNIT_SIZES = ["SMALL", "MEDIUM", "LARGE"];
export const BOM_TERM_MONTHS = [1, 3, 6, 12];
export const BOM_CURRENCY = "VND";

// Only policy types confirmed by the backend PolicyType enum are offered live.
export const BOM_POLICY_TYPES = [
  { key: "DEPOSIT", label: "Deposit" },
  { key: "CANCELLATION", label: "Cancellation" },
  { key: "REFUND", label: "Refund" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "SHELF_CONSTRAINT", label: "Shelf constraints" },
];
export const BOM_POLICY_LABELS = Object.fromEntries(BOM_POLICY_TYPES.map(({ key, label }) => [key, label]));

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
        racks.push({
          id: rack._id,
          zoneCode: zone.code || "—",
          zoneName: zone.name || zone.code || "—",
          aisleCode: aisle.aisleCode || "—",
          rackCode: rack.rackCode || "—",
          operationalStatus: rack.operationalStatus || "—",
          cellCount: rack.cellCount ?? 0,
          availableCellCount: rack.availableCellCount ?? 0,
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

export function unitFromDto(d) {
  return {
    id: d?._id,
    code: d?.unitCode || "",
    size: d?.size || "",
    status: d?.status || "",
    volumeM3: d?.volumeM3 ?? 0,
    dimensions: d?.dimensions || {},
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
    district: a.district || a.city || "",
    city: a.city || "",
    country: a.country || "",
    address: [a.line1, a.ward, a.district, a.city, a.country].filter(Boolean).join(", "),
    contact: d?.contact || {},
    openingHours: d?.operatingHours || "",
    description: d?.description || "",
    serviceTypes: Array.isArray(d?.serviceTypes) ? d.serviceTypes : [],
    status: d?.status || "ACTIVE",
  };
}
export function facilityForm(d) {
  const f = facilityFromDto(d);
  return {
    code: f.code,
    name: f.name,
    line1: f.line1,
    ward: f.ward,
    district: f.district,
    city: f.city,
    country: f.country || "Vietnam",
    openingHours: f.openingHours,
    description: f.description,
    serviceTypes: f.serviceTypes.length ? f.serviceTypes : ["SELF_STORAGE"],
    status: f.status,
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
  if (includeCode) body.code = (form.code || "").trim().toUpperCase();
  if (form.openingHours?.trim()) body.operatingHours = form.openingHours.trim();
  if (form.description?.trim()) body.description = form.description.trim();
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
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
  };
}
export function pricingLabel(row) {
  const scope = row.service === "MANAGED_INVENTORY" ? "Managed capacity" : `${row.unitSize || ""} private unit`.trim();
  return `${scope} · every ${row.billingMonths} month(s)`;
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
  if (form.effectiveTo) body.effectiveTo = toInstant(form.effectiveTo);
  return body;
}

/* ------------------------------ Policies ------------------------------ */
export function policyFromDto(d) {
  const config = d?.config || {};
  return {
    id: d?._id,
    facilityId: d?.facilityId,
    service: d?.serviceType || "",
    type: d?.type,
    name: BOM_POLICY_LABELS[d?.type] || d?.type || "Policy",
    description: config.description || "",
    rule: config.rule || "",
    effectiveFrom: fromInstant(d?.effectiveFrom),
    effectiveTo: fromInstant(d?.effectiveTo),
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
    config,
  };
}
export function policyBody(form) {
  const body = {
    facilityId: form.facilityId,
    type: form.type,
    config: { description: (form.description || "").trim(), rule: (form.rule || "").trim() },
    effectiveFrom: toInstant(form.effectiveFrom),
    isActive: form.status === "ACTIVE",
  };
  if (form.service) body.serviceType = form.service;
  return body;
}

/* --------------------- Discounts / waivers (Policy) -------------------- */
export const BOM_DISCOUNT_TYPES = ["DISCOUNT", "WAIVER"];
export const BOM_DISCOUNT_KINDS = ["PROMOTIONAL", "LOYALTY", "FEE_WAIVER"];
export const BOM_DISCOUNT_VALUE_TYPES = ["PERCENTAGE", "FIXED", "UNDEFINED"];

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
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
    config,
  };
}
export function discountValueLabel(row) {
  if (row.valueType === "UNDEFINED") return "Not defined";
  if (row.valueType === "PERCENTAGE") return `${row.value}%`;
  return money(row.value);
}
export function discountBody(form) {
  const body = {
    facilityId: form.facilityId,
    type: form.kind === "FEE_WAIVER" ? "WAIVER" : "DISCOUNT",
    config: {
      name: (form.name || "").trim(),
      kind: form.kind,
      valueType: form.valueType,
      value: form.valueType === "UNDEFINED" ? null : Number(form.value),
      conditions: (form.conditions || "").trim(),
    },
    effectiveFrom: toInstant(form.effectiveFrom),
    isActive: form.status === "ACTIVE",
  };
  if (form.service) body.serviceType = form.service;
  if (form.effectiveTo) body.effectiveTo = toInstant(form.effectiveTo);
  return body;
}

/* --------------------- Item categories (Policy CATEGORY) ---------------- */
export const BOM_CATEGORY_TYPES = ["CATEGORY"];
export const BOM_CATEGORY_STATUS = ["ALLOWED", "PROHIBITED"];

export function categoryFromDto(d) {
  const config = d?.config || {};
  return {
    id: d?._id,
    facilityId: d?.facilityId,
    service: d?.serviceType || "",
    type: d?.type,
    name: config.name || "Item category",
    description: config.description || "",
    allowedStatus: config.allowedStatus || "ALLOWED",
    handlingNotes: config.handlingNotes || "",
    restrictions: config.restrictions || "",
    effectiveFrom: fromInstant(d?.effectiveFrom),
    effectiveTo: fromInstant(d?.effectiveTo),
    status: d?.isActive ? "ACTIVE" : "INACTIVE",
    revision: d?.version,
    config,
  };
}
export function categoryBody(form) {
  const body = {
    facilityId: form.facilityId,
    type: "CATEGORY",
    config: {
      name: (form.name || "").trim(),
      description: (form.description || "").trim(),
      allowedStatus: form.allowedStatus,
      handlingNotes: (form.handlingNotes || "").trim(),
      restrictions: (form.restrictions || "").trim(),
    },
    effectiveFrom: toInstant(form.effectiveFrom),
    isActive: form.status === "ACTIVE",
  };
  if (form.service) body.serviceType = form.service;
  if (form.effectiveTo) body.effectiveTo = toInstant(form.effectiveTo);
  return body;
}

/* ---------------------------- Reservations ---------------------------- */
export const BOM_RESERVATION_STATUSES = [
  "RESERVED", "CONTRACTED", "PAID", "ACTIVE", "OVERDUE", "CHECKED_OUT", "CLOSED", "CANCELLED",
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
    customerName: (customer && typeof customer === "object"
      ? customer.displayName || customer.fullName || customer.email
      : null) || "Customer",
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
