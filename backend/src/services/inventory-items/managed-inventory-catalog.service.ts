import { ClientSession, Types } from 'mongoose';
import CategoryModel from '../../models/inventory-items/managed-inventory-category.model';
import QuantityUnitModel from '../../models/inventory-items/managed-inventory-quantity-unit.model';
import { UserRole } from '../../types/user.type';

type CatalogKind = 'category' | 'quantityUnit';
type Actor = { _id: Types.ObjectId; role: UserRole };
type AnyCatalogModel = typeof CategoryModel | typeof QuantityUnitModel;

export class ManagedInventoryCatalogError extends Error {
  constructor(public status: number, message: string, public code: string, public fieldErrors?: Record<string, string>) { super(message); }
}
const fail = (status: number, message: string, code: string, fieldErrors?: Record<string, string>): never => { throw new ManagedInventoryCatalogError(status, message, code, fieldErrors); };
const modelFor = (kind: CatalogKind): AnyCatalogModel => kind === 'category' ? CategoryModel : QuantityUnitModel;
const idField = (kind: CatalogKind) => kind === 'category' ? 'categoryId' : 'quantityUnitId';
const entityName = (kind: CatalogKind) => kind === 'category' ? 'Danh mục' : 'Đơn vị tính';
function assertRead(actor: Actor) {
  if (!actor?._id || ![UserRole.ADMIN, UserRole.BOM, UserRole.CUSTOMER].includes(actor.role)) fail(403, 'Bạn không có quyền xem danh mục.', 'CATALOG_FORBIDDEN');
}
function assertManage(actor: Actor) {
  if (!actor?._id || ![UserRole.ADMIN, UserRole.BOM].includes(actor.role)) fail(403, 'Chỉ Admin hoặc BOM được quản lý dữ liệu danh mục.', 'CATALOG_FORBIDDEN');
}
function object(value: unknown, allowed: string[], kind: CatalogKind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Dữ liệu gửi lên không hợp lệ.', 'INVALID_CATALOG_INPUT');
  const unknown = Object.keys(value as Record<string, unknown>).filter(key => !allowed.includes(key));
  if (unknown.length) fail(400, `Trường ${unknown[0]} không được phép.`, 'INVALID_CATALOG_FIELD', Object.fromEntries(unknown.map(key => [key, `${key} không được hỗ trợ trong ${entityName(kind)}.`])));
  return value as Record<string, unknown>;
}
function validId(value: unknown, field: string, kind: CatalogKind): Types.ObjectId {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, `${field} không hợp lệ.`, 'INVALID_CATALOG_ID', { [field]: 'Chọn một giá trị danh mục hợp lệ.' });
  return new Types.ObjectId(value as string);
}
function text(value: unknown, field: string, max: number, kind: CatalogKind): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${field} không hợp lệ.`, 'INVALID_CATALOG_INPUT', { [field]: `Nhập ${field} từ 1 đến ${max} ký tự.` });
  return (value as string).trim();
}
function adminDto(row: any, kind: CatalogKind) {
  return { [idField(kind)]: row._id, id: row._id, code: row.code, name: row.name, description: row.description ?? '', sortOrder: row.sortOrder,
    isActive: row.isActive && !row.deletedAt, deletedAt: row.deletedAt ?? null, createdBy: row.createdBy, updatedBy: row.updatedBy,
    createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function customerDto(row: any, kind: CatalogKind) {
  return { [idField(kind)]: row._id, id: row._id, code: row.code, name: row.name, description: row.description ?? '', sortOrder: row.sortOrder };
}
function pagination(query: unknown) {
  const q = object(query ?? {}, ['page', 'limit', 'search', 'status'], 'category');
  const page = q.page === undefined ? 1 : Number(q.page), limit = q.limit === undefined ? 20 : Number(q.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'Thông tin phân trang không hợp lệ.', 'INVALID_CATALOG_PAGINATION', { page: 'Trang phải là số nguyên dương.', limit: 'Giới hạn mỗi trang từ 1 đến 100.' });
  if (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 100)) fail(400, 'Từ khóa tìm kiếm không hợp lệ.', 'INVALID_CATALOG_FILTER', { search: 'Từ khóa tối đa 100 ký tự.' });
  if (q.status !== undefined && !['ACTIVE', 'INACTIVE', 'ALL'].includes(String(q.status))) fail(400, 'Bộ lọc trạng thái không hợp lệ.', 'INVALID_CATALOG_FILTER', { status: 'Chọn ACTIVE, INACTIVE hoặc ALL.' });
  return { page, limit, search: String(q.search ?? '').trim(), status: String(q.status ?? 'ALL') };
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export class ManagedInventoryCatalogService {
  static async list(kind: CatalogKind, query: unknown, actor: Actor, activeOnly = false) {
    assertRead(actor);
    if (!activeOnly) assertManage(actor);
    const { page, limit, search, status } = pagination(query), Model = modelFor(kind);
    const filter: any = {};
    if (activeOnly) { filter.isActive = true; filter.deletedAt = { $exists: false }; }
    else if (status === 'ACTIVE') { filter.isActive = true; filter.deletedAt = { $exists: false }; }
    else if (status === 'INACTIVE') filter.$or = [{ isActive: false }, { deletedAt: { $exists: true } }];
    if (search) filter.$and = [...(filter.$and ?? []), { $or: [{ code: { $regex: escapeRegex(search), $options: 'i' } }, { name: { $regex: escapeRegex(search), $options: 'i' } }] }];
    const [rows, total] = await Promise.all([Model.find(filter).sort({ sortOrder: 1, name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(), Model.countDocuments(filter).exec()]);
    const dto = activeOnly ? customerDto : adminDto;
    return { data: rows.map(row => dto(row, kind)), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
  static async get(kind: CatalogKind, input: unknown, actor: Actor) {
    assertManage(actor); const Model = modelFor(kind), row = await Model.findById(validId(input, idField(kind), kind)).lean().exec();
    if (!row) fail(404, `${entityName(kind)} không tồn tại.`, 'CATALOG_NOT_FOUND');
    return adminDto(row, kind);
  }
  static async create(kind: CatalogKind, input: unknown, actor: Actor) {
    assertManage(actor); const data = object(input, ['code', 'name', 'description', 'sortOrder'], kind);
    const max = kind === 'category' ? 48 : 32;
    const code = text(data.code, 'code', max, kind).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) fail(400, 'Mã chỉ được chứa chữ in hoa, số, dấu gạch ngang hoặc gạch dưới.', 'INVALID_CATALOG_INPUT', { code: 'Mã danh mục không đúng định dạng.' });
    const name = text(data.name, 'name', kind === 'category' ? 120 : 80, kind);
    const description = data.description === undefined ? '' : typeof data.description === 'string' && data.description.length <= 1000 ? (data.description as string).trim() : fail(400, 'Mô tả không hợp lệ.', 'INVALID_CATALOG_INPUT', { description: 'Mô tả tối đa 1000 ký tự.' });
    const sortOrder = data.sortOrder === undefined ? 0 : Number(data.sortOrder);
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) fail(400, 'Thứ tự sắp xếp không hợp lệ.', 'INVALID_CATALOG_INPUT', { sortOrder: 'Nhập số nguyên từ 0 đến 1.000.000.' });
    const Model = modelFor(kind);
    try { return adminDto(await Model.create({ code, name, description, sortOrder, isActive: true, createdBy: actor._id, updatedBy: actor._id }), kind); }
    catch (error: any) { if (error?.code === 11000) fail(409, 'Mã danh mục đã tồn tại.', 'CATALOG_CODE_CONFLICT', { code: 'Mã này đã được sử dụng.' }); throw error; }
  }
  static async update(kind: CatalogKind, inputId: unknown, input: unknown, actor: Actor) {
    assertManage(actor); const id = validId(inputId, idField(kind), kind), data = object(input, ['name', 'description', 'sortOrder', 'isActive'], kind), Model = modelFor(kind);
    if (!Object.keys(data).length) fail(400, 'Chưa có thông tin cần cập nhật.', 'INVALID_CATALOG_INPUT');
    const set: Record<string, unknown> = { updatedBy: actor._id };
    if (data.name !== undefined) set.name = text(data.name, 'name', kind === 'category' ? 120 : 80, kind);
    if (data.description !== undefined) { if (typeof data.description !== 'string' || data.description.length > 1000) fail(400, 'Mô tả không hợp lệ.', 'INVALID_CATALOG_INPUT', { description: 'Mô tả tối đa 1000 ký tự.' }); set.description = (data.description as string).trim(); }
    if (data.sortOrder !== undefined) { const value = Number(data.sortOrder); if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) fail(400, 'Thứ tự sắp xếp không hợp lệ.', 'INVALID_CATALOG_INPUT', { sortOrder: 'Nhập số nguyên từ 0 đến 1.000.000.' }); set.sortOrder = value; }
    if (data.isActive !== undefined) { if (typeof data.isActive !== 'boolean') fail(400, 'Trạng thái không hợp lệ.', 'INVALID_CATALOG_INPUT', { isActive: 'Trạng thái phải là true hoặc false.' }); set.isActive = data.isActive; }
    const row = await Model.findOneAndUpdate({ _id: id, deletedAt: { $exists: false } }, { $set: set }, { returnDocument: 'after', runValidators: true }).exec();
    if (!row) fail(404, `${entityName(kind)} không tồn tại hoặc đã ngừng sử dụng.`, 'CATALOG_NOT_FOUND');
    return adminDto(row, kind);
  }
  static async remove(kind: CatalogKind, inputId: unknown, actor: Actor) {
    assertManage(actor); const id = validId(inputId, idField(kind), kind), Model = modelFor(kind);
    const row = await Model.findOneAndUpdate({ _id: id, deletedAt: { $exists: false } }, { $set: { isActive: false, deletedAt: new Date(), updatedBy: actor._id } }, { returnDocument: 'after' }).exec();
    if (!row) fail(404, `${entityName(kind)} không tồn tại hoặc đã ngừng sử dụng.`, 'CATALOG_NOT_FOUND');
    return adminDto(row, kind);
  }
  static async requireActive(kind: CatalogKind, input: unknown, session?: ClientSession) {
    const id = validId(input, idField(kind), kind), Model = modelFor(kind);
    let query = Model.findOne({ _id: id, isActive: true, deletedAt: { $exists: false } }).lean();
    if (session) query = query.session(session);
    const row = await query.exec();
    if (!row) fail(422, `${entityName(kind)} không còn hiệu lực.`, 'CATALOG_VALUE_INACTIVE', { [idField(kind)]: `Chọn ${entityName(kind).toLowerCase()} đang hoạt động.` });
    return row;
  }
}
