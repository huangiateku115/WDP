import mongoose, { Types } from 'mongoose';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemSpecificationModel from '../../models/inventory-items/item-specification.model';
import ManagedV3StockProjectionModel from '../../models/inventory-items/managed-v3-stock-projection.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import { UserRole } from '../../types/user.type';
import { ItemSpecificationStatus } from '../../types/item-specification.type';
import { isValidImageList } from '../../utils/image-url';
import { requireManagedInventoryReservationForRegistration } from '../reservations/managed-inventory-reservation.guard';
import { ManagedInventoryImageService } from '../upload/managed-inventory-image.service';
import { ManagedInventoryCatalogService } from './managed-inventory-catalog.service';

export class ManagedSkuError extends Error {
  constructor(public status: number, message: string, public code = 'INVALID_SKU_INPUT', public fieldErrors?: Record<string, string>) { super(message); }
}
const fail = (status: number, message: string, code = 'INVALID_SKU_INPUT', fieldErrors?: Record<string, string>): never => { throw new ManagedSkuError(status, message, code, fieldErrors); };
const obj = (value: unknown, allowed: string[], label = 'yêu cầu') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, `Nội dung ${label} không hợp lệ.`, 'INVALID_SKU_BODY');
  const unknown = Object.keys(value as Record<string, unknown>).filter(key => !allowed.includes(key));
  if (unknown.length) fail(400, `Trường ${unknown[0]} không được phép trong ${label}.`, 'INVALID_SKU_FIELD', Object.fromEntries(unknown.map(key => [key, `SKU không nhận trường ${key}; hãy dùng Item Specification cho đơn vị, kích thước và khối lượng.`])));
  return value as Record<string, unknown>;
};
const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ManagedSkuError(400, `Trường ${field} không hợp lệ.`, 'INVALID_SKU_INPUT', { [field]: `Nhập từ 1 đến ${max} ký tự.` });
  return (value as string).trim();
};
const oid = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new ManagedSkuError(400, `Trường ${field} không hợp lệ.`, 'INVALID_SKU_INPUT', { [field]: 'Chọn một giá trị hợp lệ.' });
  return new Types.ObjectId(value as string);
};
const recordDto = (row: any) => { const category = row.categoryId && typeof row.categoryId === 'object' ? row.categoryId : null; return ({ _id: row._id, skuId: row._id, inventorySchemaVersion: row.inventorySchemaVersion, customerId: row.customerId, reservationId: row.reservationId ?? row.managedReservationId, managedReservationId: row.reservationId ?? row.managedReservationId,
  facilityId: row.facilityId, itemCode: row.itemCode, name: row.name, categoryId: category?._id ?? row.categoryId, category: category?.name ?? row.category ?? 'Danh mục cũ', ...(category?.code ? { categoryCode: category.code } : {}), ...(row.description ? { description: row.description } : {}),
  images: row.images ?? [], status: row.skuStatus ?? 'ACTIVE', revision: row.managedV3Revision ?? 0, createdAt: row.createdAt, updatedAt: row.updatedAt });
};
const specDto = (row: any) => { const unit = row.quantityUnitId && typeof row.quantityUnitId === 'object' ? row.quantityUnitId : null; return ({ _id: row._id, itemSpecId: row._id, skuId: row.skuId, code: row.code, name: row.name,
  ...(row.description ? { description: row.description } : {}), quantityUnitId: unit?._id ?? row.quantityUnitId, quantityUnit: unit?.name ?? 'Đơn vị đã ngừng sử dụng', quantityUnitCode: unit?.code ?? '', dimensionsM: row.dimensionsM,
  unitWeightKg: row.unitWeightKg, unitVolumeM3: row.unitVolumeM3, images: row.images ?? [], revision: row.revision,
  status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt });
};

async function ownSku(skuId: unknown, customerId: Types.ObjectId) {
  const row = await InventoryItemModel.findOne({ _id: oid(skuId, 'skuId'), customerId, inventorySchemaVersion: 3, deletedAt: { $exists: false } }).populate('categoryId', 'code name isActive deletedAt').exec();
  if (!row) fail(404, 'SKU not found');
  return row as any;
}

async function assertNoStockOrHistory(skuId: Types.ObjectId) {
  const [projection, movement] = await Promise.all([
    ManagedV3StockProjectionModel.findOne({ skuId }).select('_id').lean().exec(),
    ItemMovementModel.findOne({ itemId: skuId }).select('_id').lean().exec(),
  ]);
  if (projection || movement) fail(409, 'Item Specification cannot be changed after stock or movement history exists');
}

function parseSpec(input: unknown, partial = false) {
  const data = obj(input, ['code', 'name', 'description', 'quantityUnitId', 'dimensionsM', 'unitWeightKg', 'images'], 'Item Specification');
  if (!partial && ['code', 'name', 'quantityUnitId', 'dimensionsM', 'unitWeightKg'].some(key => data[key] === undefined)) fail(400, 'Thiếu thông tin bắt buộc của Item Specification.', 'INVALID_ITEM_SPECIFICATION', { quantityUnitId: 'Chọn đơn vị tính do Admin/BOM cung cấp.' });
  const out: Record<string, any> = {};
  for (const key of ['code', 'name'] as const) if (data[key] !== undefined) out[key] = text(data[key], key, key === 'name' ? 160 : 48);
  if (out.code) { out.code = out.code.toUpperCase(); if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(out.code)) fail(400, 'Mã loại hàng không đúng định dạng.', 'INVALID_ITEM_SPECIFICATION', { code: 'Mã chỉ được chứa chữ, số, gạch ngang và gạch dưới.' }); }
  if (data.quantityUnitId !== undefined) out.quantityUnitId = oid(data.quantityUnitId, 'quantityUnitId');
  if (data.description !== undefined) { if (typeof data.description !== 'string' || (data.description as string).trim().length > 2000) fail(400, 'Mô tả Item không hợp lệ.', 'INVALID_ITEM_SPECIFICATION', { description: 'Mô tả tối đa 2000 ký tự.' }); out.description = (data.description as string).trim(); }
  if (data.dimensionsM !== undefined) {
    const dimensions = obj(data.dimensionsM, ['widthM', 'depthM', 'heightM']);
    const values = ['widthM', 'depthM', 'heightM'].map(key => dimensions[key]);
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) fail(400, 'Kích thước phải là số dương, hữu hạn.', 'INVALID_ITEM_SPECIFICATION', { dimensionsM: 'Nhập chiều dài, rộng và cao hợp lệ.' });
    out.dimensionsM = Object.fromEntries(['widthM', 'depthM', 'heightM'].map((key, i) => [key, values[i]]));
    if (['widthM', 'depthM', 'heightM'].every(key => dimensions[key] !== undefined)) {
      out.unitVolumeM3 = Math.round((values[0] as number * (values[1] as number) * (values[2] as number) + Number.EPSILON) * 1_000_000) / 1_000_000;
      if (!Number.isFinite(out.unitVolumeM3) || out.unitVolumeM3 <= 0) fail(400, 'Thể tích tính được không hợp lệ.', 'INVALID_ITEM_SPECIFICATION', { dimensionsM: 'Kiểm tra lại các kích thước.' });
    }
  }
  if (data.unitWeightKg !== undefined) { if (typeof data.unitWeightKg !== 'number' || !Number.isFinite(data.unitWeightKg) || data.unitWeightKg <= 0) fail(400, 'Khối lượng phải là số dương, hữu hạn.', 'INVALID_ITEM_SPECIFICATION', { unitWeightKg: 'Nhập khối lượng lớn hơn 0 kg.' }); out.unitWeightKg = data.unitWeightKg; }
  if (data.images !== undefined) { if (!isValidImageList(data.images)) fail(400, 'Danh sách hình ảnh không hợp lệ.', 'INVALID_ITEM_SPECIFICATION', { images: 'Chỉ dùng tối đa 10 URL hình ảnh HTTP(S) hợp lệ.' }); out.images = data.images; }
  return out;
}

function assertCustomer(actor: any) { if (actor?.role !== UserRole.CUSTOMER || !actor?._id) fail(403, 'Customer role required'); }
function expectedRevision(value: unknown) { const match = typeof value === 'string' ? value.match(/^\"?(\d+)\"?$/) : null; if (!match) return fail(428, 'If-Match revision is required'); return Number(match![1]); }

export class ManagedSkuService {
  static async create(input: unknown, actor: any) {
    assertCustomer(actor); const data = obj(input, ['managedReservationId', 'itemCode', 'name', 'categoryId', 'description', 'images'], 'SKU');
    const reservationId = oid(data.managedReservationId, 'managedReservationId');
    const categoryId = oid(data.categoryId, 'categoryId');
    const itemCode = text(data.itemCode, 'itemCode', 48).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(itemCode)) fail(400, 'Mã SKU không đúng định dạng.', 'INVALID_SKU_INPUT', { itemCode: 'Mã chỉ được chứa chữ, số, gạch ngang và gạch dưới.' });
    const name = text(data.name, 'name', 160);
    if (data.description !== undefined && (typeof data.description !== 'string' || data.description.trim().length > 2000)) fail(400, 'Mô tả SKU không hợp lệ.', 'INVALID_SKU_INPUT', { description: 'Mô tả tối đa 2000 ký tự.' });
    const images: string[] = data.images === undefined ? [] : data.images as string[];
    if (!isValidImageList(images)) fail(400, 'Danh sách hình ảnh không hợp lệ.', 'INVALID_SKU_INPUT', { images: 'Chỉ dùng tối đa 10 URL HTTP(S) hợp lệ.' });
    const session = await mongoose.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const reservation: any = await requireManagedInventoryReservationForRegistration(reservationId, actor._id, undefined, session);
        const category: any = await ManagedInventoryCatalogService.requireActive('category', categoryId.toString(), session);
        const row: any = new InventoryItemModel({ inventorySchemaVersion: 3, facilityId: reservation.facilityId, customerId: actor._id,
          reservationId, managedReservationId: reservationId, itemCode, name, categoryId, description: (data.description as string | undefined)?.trim(),
          images: images as string[], createdBy: actor._id, skuStatus: 'ACTIVE', status: 'REGISTERED' as any, currentCellId: null });
        if (images.length) await ManagedInventoryImageService.attachNewImages(images, [], row._id, actor._id, reservationId, session);
        await row.save({ session }); result = recordDto({ ...row.toObject(), categoryId: category });
      });
      return result;
    } catch (error: any) { if (error?.code === 11000) fail(409, 'Mã SKU đã được sử dụng tại cơ sở này.', 'SKU_CODE_CONFLICT', { itemCode: 'Mã SKU đã tồn tại tại cơ sở.' }); throw error; }
    finally { await session.endSession(); }
  }
  static async listMine(actor: any, query: unknown = {}) {
    assertCustomer(actor); const q = obj(query, ['page', 'limit']);
    const page = q.page === undefined ? 1 : Number(q.page), limit = q.limit === undefined ? 20 : Number(q.limit);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'Thông tin phân trang không hợp lệ.', 'INVALID_SKU_PAGINATION', { page: 'Trang phải là số nguyên dương.', limit: 'Giới hạn mỗi trang từ 1 đến 100.' });
    const filter = { customerId: actor._id, inventorySchemaVersion: 3, deletedAt: { $exists: false } };
    const [rows, total] = await Promise.all([InventoryItemModel.find(filter).populate('categoryId', 'code name isActive deletedAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(), InventoryItemModel.countDocuments(filter).exec()]);
    return { data: rows.map(recordDto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  static async get(skuId: unknown, actor: any) { assertCustomer(actor); const row = await ownSku(skuId, actor._id); return recordDto(row); }
  static async update(skuId: unknown, input: unknown, ifMatch: unknown, actor: any) {
    assertCustomer(actor); const row = await ownSku(skuId, actor._id), revision = expectedRevision(ifMatch);
    const changes = obj(input, ['name', 'categoryId', 'description', 'images'], 'SKU');
    if (!Object.keys(changes).length) fail(400, 'Chưa có thông tin cần cập nhật.', 'INVALID_SKU_INPUT');
    const set: any = {};
    if (changes.name !== undefined) set.name = text(changes.name, 'name', 160);
    if (changes.categoryId !== undefined) set.categoryId = oid(changes.categoryId, 'categoryId');
    if (changes.description !== undefined) { if (typeof changes.description !== 'string' || (changes.description as string).trim().length > 2000) fail(400, 'Mô tả SKU không hợp lệ.', 'INVALID_SKU_INPUT', { description: 'Mô tả tối đa 2000 ký tự.' }); set.description = (changes.description as string).trim(); }
    if (changes.images !== undefined) { if (!isValidImageList(changes.images)) fail(400, 'Danh sách hình ảnh không hợp lệ.', 'INVALID_SKU_INPUT', { images: 'Chỉ dùng tối đa 10 URL HTTP(S) hợp lệ.' }); set.images = changes.images; }
    const session = await mongoose.startSession();
    try {
      let saved: any;
      await session.withTransaction(async () => {
        const current: any = await InventoryItemModel.findOne({ _id: row._id, customerId: actor._id, inventorySchemaVersion: 3, managedV3Revision: revision, deletedAt: { $exists: false } }).session(session).exec();
        if (!current) fail(409, 'SKU vừa được cập nhật. Hãy tải lại trước khi thử lại.', 'SKU_REVISION_CONFLICT');
        if (set.categoryId) await ManagedInventoryCatalogService.requireActive('category', set.categoryId.toString(), session);
        if (set.images) await ManagedInventoryImageService.attachNewImages(set.images, current.images ?? [], current._id, actor._id, current.reservationId ?? current.managedReservationId, session);
        saved = await InventoryItemModel.findOneAndUpdate({ _id: row._id, customerId: actor._id, inventorySchemaVersion: 3, managedV3Revision: revision, deletedAt: { $exists: false } }, { $set: set, $inc: { managedV3Revision: 1 } }, { returnDocument: 'after', runValidators: true, session }).exec();
        if (!saved) fail(409, 'SKU vừa được cập nhật. Hãy tải lại trước khi thử lại.', 'SKU_REVISION_CONFLICT');
      });
      return recordDto(await InventoryItemModel.findById(saved!._id).populate('categoryId', 'code name isActive deletedAt').exec());
    } finally { await session.endSession(); }
  }
  static async listSpecifications(skuId: unknown, actor: any) { assertCustomer(actor); const sku = await ownSku(skuId, actor._id); const rows = await ItemSpecificationModel.find({ skuId: sku._id, customerId: actor._id, status: { $ne: ItemSpecificationStatus.DELETED } }).populate('quantityUnitId', 'code name isActive deletedAt').sort({ createdAt: 1, _id: 1 }).lean().exec(); return rows.map(specDto); }
  static async createSpecification(skuId: unknown, input: unknown, actor: any) {
    assertCustomer(actor); const sku = await ownSku(skuId, actor._id), data = parseSpec(input);
    const reservationId = sku.reservationId ?? sku.managedReservationId; if (!reservationId) fail(409, 'SKU reservation scope is missing');
    await requireManagedInventoryReservationForRegistration(reservationId, actor._id, sku.facilityId);
    const session = await mongoose.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        await ManagedInventoryCatalogService.requireActive('quantityUnit', data.quantityUnitId.toString(), session);
        const row: any = new ItemSpecificationModel({ ...data, skuId: sku._id, customerId: sku.customerId, reservationId, facilityId: sku.facilityId, createdBy: actor._id });
        if (data.images?.length) await ManagedInventoryImageService.attachNewSpecificationImages(data.images, [], row._id, actor._id, reservationId, session);
        await row.save({ session }); result = row;
      });
      return specDto(await ItemSpecificationModel.findById(result._id).populate('quantityUnitId', 'code name isActive deletedAt').exec());
    } catch (error: any) { if (error?.code === 11000) fail(409, 'Mã Item Specification đã tồn tại trong SKU này.', 'ITEM_SPECIFICATION_CODE_CONFLICT', { code: 'Mã loại hàng đã được sử dụng trong SKU.' }); throw error; }
    finally { await session.endSession(); }
  }
  static async updateSpecification(skuId: unknown, specId: unknown, input: unknown, ifMatch: unknown, actor: any) {
    assertCustomer(actor); const sku = await ownSku(skuId, actor._id), revision = expectedRevision(ifMatch), id = oid(specId, 'itemSpecId');
    const reservationId = sku.reservationId ?? sku.managedReservationId;
    if (!reservationId) fail(409, 'SKU reservation scope is missing');
    await requireManagedInventoryReservationForRegistration(reservationId, actor._id, sku.facilityId);
    await assertNoStockOrHistory(sku._id);
    const changes = parseSpec(input, true); if (!Object.keys(changes).length) fail(400, 'Chưa có thông tin cần cập nhật.', 'INVALID_ITEM_SPECIFICATION');
    const session = await mongoose.startSession();
    try {
      let saved: any;
      await session.withTransaction(async () => {
        const current: any = await ItemSpecificationModel.findOne({ _id: id, skuId: sku._id, customerId: actor._id, revision, status: ItemSpecificationStatus.ACTIVE }).session(session).exec();
        if (!current) fail(409, 'Item Specification vừa được cập nhật. Hãy tải lại trước khi thử lại.', 'ITEM_SPECIFICATION_REVISION_CONFLICT');
        if (changes.quantityUnitId) await ManagedInventoryCatalogService.requireActive('quantityUnit', changes.quantityUnitId.toString(), session);
        if (changes.dimensionsM) {
          const dimensions = { ...(current.dimensionsM.toObject?.() ?? current.dimensionsM), ...changes.dimensionsM };
          changes.dimensionsM = dimensions;
          changes.unitVolumeM3 = Math.round((dimensions.widthM * dimensions.depthM * dimensions.heightM + Number.EPSILON) * 1_000_000) / 1_000_000;
          if (!Number.isFinite(changes.unitVolumeM3) || changes.unitVolumeM3 <= 0) fail(400, 'Thể tích tính được không hợp lệ.', 'INVALID_ITEM_SPECIFICATION', { dimensionsM: 'Kiểm tra lại các kích thước.' });
        }
        if (changes.images) await ManagedInventoryImageService.attachNewSpecificationImages(changes.images, current.images ?? [], current._id, actor._id, reservationId, session);
        saved = await ItemSpecificationModel.findOneAndUpdate({ _id: id, skuId: sku._id, customerId: actor._id, revision, status: ItemSpecificationStatus.ACTIVE }, { $set: changes, $inc: { revision: 1 } }, { returnDocument: 'after', runValidators: true, session }).exec();
        if (!saved) fail(409, 'Item Specification vừa được cập nhật. Hãy tải lại trước khi thử lại.', 'ITEM_SPECIFICATION_REVISION_CONFLICT');
      });
      return specDto(await ItemSpecificationModel.findById(saved!._id).populate('quantityUnitId', 'code name isActive deletedAt').exec());
    } finally { await session.endSession(); }
  }
  static async deleteSpecification(skuId: unknown, specId: unknown, ifMatch: unknown, actor: any) {
    assertCustomer(actor); const sku = await ownSku(skuId, actor._id), revision = expectedRevision(ifMatch), id = oid(specId, 'itemSpecId');
    const reservationId = sku.reservationId ?? sku.managedReservationId;
    if (!reservationId) fail(409, 'SKU không còn phạm vi Reservation hợp lệ.', 'SKU_RESERVATION_SCOPE_MISSING');
    await requireManagedInventoryReservationForRegistration(reservationId, actor._id, sku.facilityId);
    await assertNoStockOrHistory(sku._id);
    const saved = await ItemSpecificationModel.findOneAndUpdate({ _id: id, skuId: sku._id, customerId: actor._id, revision, status: ItemSpecificationStatus.ACTIVE }, { $set: { status: ItemSpecificationStatus.DELETED, deletedAt: new Date(), deletedBy: actor._id }, $inc: { revision: 1 } }, { returnDocument: 'after', runValidators: true }).exec();
    if (!saved) fail(404, 'Không tìm thấy Item Specification hoặc bản ghi vừa thay đổi.', 'ITEM_SPECIFICATION_NOT_FOUND'); return specDto(await ItemSpecificationModel.findById(saved!._id).populate('quantityUnitId', 'code name isActive deletedAt').exec());
  }
}
