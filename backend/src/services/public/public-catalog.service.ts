import { Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import { FacilityError } from '../facilities/facility.validation';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { StorageUnitStatus, StorageUnitSize } from '../../types/storage-unit.type';
import { pricingService } from '../pricing-policy/rule.service';
import { isHttpImageUrl } from '../../utils/image-url';

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new FacilityError(400, 'Invalid facility ID');
  return value.toLowerCase();
}
function publicFacility(f: Record<string, unknown>) {
  const address = (f.address || {}) as Record<string, unknown>;
  const contact = (f.contact || {}) as Record<string, unknown>;
  return {
    _id: f._id, code: f.code, name: f.name,
    address: Object.fromEntries(['line1', 'ward', 'district', 'city', 'country'].filter(k => address[k] !== undefined).map(k => [k, address[k]])),
    ...(Object.keys(contact).length ? { contact: Object.fromEntries(['phone', 'email'].filter(k => contact[k] !== undefined).map(k => [k, contact[k]])) } : {}),
    serviceTypes: f.serviceTypes, ...(f.description ? { description: f.description } : {}),
    ...(f.operatingHours ? { operatingHours: f.operatingHours } : {}),
    images: Array.isArray(f.images) ? f.images.filter(isHttpImageUrl).slice(0, 10) : [],
  };
}
function pagination(query: Record<string, unknown>) {
  const int = (key: string, fallback: number, max: number) => {
    const v = query[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > max) throw new FacilityError(400, `Invalid ${key}`);
    return Number(v);
  };
  return { page: int('page', 1, 1000000), limit: int('limit', 20, 100) };
}
export class PublicCatalogService {
  static async listFacilities(query: unknown) {
    if (!query || typeof query !== 'object' || Array.isArray(query)) throw new FacilityError(400, 'Invalid query');
    const q = query as Record<string, unknown>;
    if (Object.keys(q).some(k => !['page', 'limit', 'serviceType', 'search'].includes(k))) throw new FacilityError(400, 'Unsupported query');
    const { page, limit } = pagination(q);
    const filter: Record<string, unknown> = { status: FacilityStatus.ACTIVE, deletedAt: { $exists: false } };
    if (q.serviceType !== undefined) {
      if (!Object.values(FacilityServiceType).includes(q.serviceType as FacilityServiceType)) throw new FacilityError(400, 'Invalid serviceType');
      filter.serviceTypes = q.serviceType;
    }
    if (q.search !== undefined) {
      if (typeof q.search !== 'string' || !q.search.trim() || q.search.length > 100) throw new FacilityError(400, 'Invalid search');
      const literal = q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['code', 'name', 'address.city'].map(field => ({ [field]: { $regex: literal, $options: 'i' } }));
    }
    const [records, total] = await Promise.all([
      FacilityModel.find(filter).select('code name address contact serviceTypes description operatingHours images').sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      FacilityModel.countDocuments(filter).exec(),
    ]);
    return { data: records.map(f => publicFacility(f as unknown as Record<string, unknown>)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  static async getFacility(resourceId: unknown) {
    const _id = id(resourceId);
    const f = await FacilityModel.findOne({ _id, status: FacilityStatus.ACTIVE, deletedAt: { $exists: false } })
      .select('code name address contact serviceTypes description operatingHours images').lean().exec();
    if (!f) throw new FacilityError(404, 'Facility not found');
    return publicFacility(f as unknown as Record<string, unknown>);
  }
  private static async activeFacility(resourceId: unknown) {
    const _id = id(resourceId);
    const f = await FacilityModel.findOne({ _id, status: FacilityStatus.ACTIVE, deletedAt: { $exists: false } }).select('serviceTypes').lean().exec();
    if (!f) throw new FacilityError(404, 'Facility not found');
    return { facilityId: new Types.ObjectId(_id), serviceTypes: f.serviceTypes };
  }
  private static async selfStorageFacility(resourceId: unknown) {
    const facility = await this.activeFacility(resourceId);
    if (!facility.serviceTypes.includes(FacilityServiceType.SELF_STORAGE)) throw new FacilityError(404, 'Facility not found');
    return facility.facilityId;
  }
  static async storageOptions(resourceId: unknown) {
    const facilityId = await this.selfStorageFacility(resourceId);
    const rows = await StorageUnitModel.aggregate([
      { $match: { facilityId, status: StorageUnitStatus.AVAILABLE, deletedAt: { $exists: false } } },
      { $sort: { 'images.0': -1, createdAt: 1, _id: 1 } },
      { $group: { _id: '$size', availableCount: { $sum: 1 }, imageUrl: { $first: { $arrayElemAt: ['$images', 0] } } } },
      { $project: { _id: 0, size: '$_id', availableCount: 1, imageUrl: 1 } },
      { $sort: { size: 1 } },
    ]).exec();
    const bySize = new Map(rows.map((r: { size: StorageUnitSize; availableCount: number; imageUrl?: string }) => [r.size, r]));
    return { availabilityIsInformational: true, options: Object.values(StorageUnitSize).map(size => {
      const row = bySize.get(size);
      return { size, availableCount: row?.availableCount || 0, ...(row?.imageUrl && isHttpImageUrl(row.imageUrl) ? { imageUrl: row.imageUrl } : {}) };
    }) };
  }
  static async pricing(resourceId: unknown) {
    const { facilityId, serviceTypes } = await this.activeFacility(resourceId);
    const pricing = await pricingService.currentPublicPricing(facilityId.toString());
    return {
      ...(serviceTypes.includes(FacilityServiceType.SELF_STORAGE) ? { selfStorage: pricing.filter(r => r.serviceType === FacilityServiceType.SELF_STORAGE) } : {}),
      ...(serviceTypes.includes(FacilityServiceType.MANAGED_INVENTORY) ? { managedInventory: pricing.filter(r => r.serviceType === FacilityServiceType.MANAGED_INVENTORY) } : {}),
    };
  }
}
