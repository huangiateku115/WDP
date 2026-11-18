import { Request } from 'express';
import { AuditLogModel } from '../../models/audit/audit.model';
import UserModel from '../../models/users/user.model';
import { IAuditLog } from '../../types/audit.type';
import { UserRole } from '../../types/user.type';
import { AuditReadError, parseAuditLogQuery, parseAuditSubjectQuery } from './audit-read.validation';

const PII_MASK_LIST = ['identityCard', 'creditCard', 'password', 'pinCode'];

export class AuditService {
  static auditListDto(value: any) {
    const row = value && typeof value.toObject === 'function' ? value.toObject() : value;
    return {
      _id: row._id,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      facilityId: row.facilityId ?? null,
      createdAt: row.createdAt,
    };
  }

  private static readonly SAFE_AUDIT_DETAIL_FIELDS = new Set([
    'displayName', 'name', 'code', 'status', 'isActive', 'role', 'targetRole', 'previousFacilityId', 'newFacilityId', 'related', 'nested',
    'facilityId', 'storageUnitId', 'pricingRuleId', 'maintenanceTicketId', 'supportRequestId', 'targetUserId',
    'entityType', 'entityId', 'action', 'actorId', 'actorRole', 'reasonCode', 'type', 'capacity',
    'price', 'currency', 'serviceType', 'unitType', 'createdAt', 'updatedAt', 'deletedAt', 'country',
  ]);

  private static sanitizeHistoricalPayload(value: any, depth = 0, keyContext?: string): any {
    // Audit snapshots are schemaless Mixed values. Only expose explicitly approved keys;
    // unknown shapes and scalar values fail closed instead of being copied to clients.
    if (value == null) return null;
    if (keyContext && typeof value !== 'object') {
      if (this.SAFE_AUDIT_DETAIL_FIELDS.has(keyContext)
        && !(typeof value === 'string' && /@|bearer\s|https?:\/\/|\b\d{7,}\b/i.test(value))) return value;
      return '[REDACTED:UNREVIEWED_VALUE]';
    }
    if (typeof value !== 'object') {
      return '[REDACTED:UNREVIEWED_VALUE]';
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (value?._bsontype === 'ObjectId') return String(value);
    if (depth >= 8) return '[REDACTED:DEPTH_LIMIT]';
    if (Array.isArray(value)) return value.slice(0, 100).map(item => this.sanitizeHistoricalPayload(item, depth + 1, keyContext));
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 100)) {
      if (!this.SAFE_AUDIT_DETAIL_FIELDS.has(key)) continue;
      if (nested == null) { result[key] = null; continue; }
      result[key] = this.sanitizeHistoricalPayload(nested, depth + 1, key);
    }
    return result;
  }

  static auditDetailDto(value: any) {
    const row = value && typeof value.toObject === 'function' ? value.toObject() : value;
    return { ...this.auditListDto(row), before: row.before ? this.sanitizeHistoricalPayload(row.before) : null,
      after: row.after ? this.sanitizeHistoricalPayload(row.after) : null, updatedAt: row.updatedAt };
  }

  static async listLogs(queryInput: unknown, actor: { role?: UserRole } | undefined) {
    if (!actor) throw new AuditReadError(401, 'AUTH_REQUIRED', 'Authentication required');
    if (![UserRole.ADMIN, UserRole.BOM].includes(actor.role as UserRole)) throw new AuditReadError(403, 'AUDIT_FORBIDDEN', 'Role cannot access global Audit Logs');
    const query = parseAuditLogQuery(queryInput);
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;
    if (actor.role === UserRole.BOM) {
      const targetActorId = (query.filter as any).actorId;
      if (targetActorId) {
        const target = await UserModel.findById(targetActorId).select('role').lean().exec();
        if (!target) throw new AuditReadError(404, 'AUDIT_SUBJECT_NOT_FOUND', 'Audit actor not found');
        if ([UserRole.ADMIN, UserRole.BOM].includes(target.role)) {
          throw new AuditReadError(403, 'AUDIT_SUBJECT_FORBIDDEN', 'BOM cannot audit ADMIN or BOM actors');
        }
      }
      const pipeline = [
        { $match: query.filter },
        { $lookup: { from: UserModel.collection.name, localField: 'actorId', foreignField: '_id', as: '_currentActor' } },
        { $match: { _currentActor: { $elemMatch: { role: { $nin: [UserRole.ADMIN, UserRole.BOM] } } } } },
        { $facet: {
          items: [
            { $sort: { createdAt: direction, _id: direction } }, { $skip: skip }, { $limit: query.limit },
            { $project: { _id: 1, actorId: 1, actorRole: 1, action: 1, entityType: 1, entityId: 1, facilityId: 1, createdAt: 1 } },
          ],
          total: [{ $count: 'value' }],
        } },
      ];
      const [result] = await AuditLogModel.aggregate(pipeline as any).exec();
      const items = (result?.items ?? []).map((row: any) => this.auditListDto(row));
      const total = result?.total?.[0]?.value ?? 0;
      return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
    }
    const [rows, total] = await Promise.all([
      AuditLogModel.find(query.filter as any).select('actorId actorRole action entityType entityId facilityId createdAt')
        .sort({ createdAt: direction, _id: direction }).skip(skip).limit(query.limit).lean().exec(),
      AuditLogModel.countDocuments(query.filter as any).exec(),
    ]);
    return { items: rows.map(row => this.auditListDto(row)),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  static async listSubjects(queryInput: unknown, actor: { role?: UserRole } | undefined) {
    if (!actor) throw new AuditReadError(401, 'AUTH_REQUIRED', 'Authentication required');
    if (![UserRole.ADMIN, UserRole.BOM].includes(actor.role as UserRole)) throw new AuditReadError(403, 'AUDIT_FORBIDDEN', 'Role cannot access Audit Subjects');
    const query = parseAuditSubjectQuery(queryInput, actor.role as UserRole);
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await Promise.all([
      UserModel.find(query.filter as any).select('displayName email role assignedFacilityId isActive')
        .populate('assignedFacilityId', 'name code').sort({ displayName: 1, _id: 1 })
        .skip(skip).limit(query.limit).lean().exec(),
      UserModel.countDocuments(query.filter as any).exec(),
    ]);
    return {
      items: rows.map((row: any) => {
        const facility = row.assignedFacilityId && typeof row.assignedFacilityId === 'object' ? row.assignedFacilityId : null;
        return { _id: row._id, displayName: row.displayName, email: row.email, role: row.role,
          assignedFacility: facility ? { _id: facility._id, name: facility.name, code: facility.code } : null,
          isActive: row.isActive };
      }),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  /**
   * Đệ quy lặp qua các field, nếu gặp field nằm trong danh sách cần Mask thì bôi đen bằng ******
   */
  static maskPII(data: any): any {
    if (!data) return data;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) {
      return data.map(item => this.maskPII(item));
    }

    const maskedData: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (PII_MASK_LIST.includes(key)) {
          maskedData[key] = '******';
        } else {
          maskedData[key] = this.maskPII(data[key]);
        }
      }
    }
    return maskedData;
  }

  /**
   * Helper function to log an action to the database.
   * Fire-and-forget to avoid blocking the main API response.
   */
  static logAction(payload: IAuditLog): void {
    try {
      // Clone payload để mask dữ liệu trước khi lưu
      const maskedPayload = { ...payload };
      if (maskedPayload.before) maskedPayload.before = this.maskPII(maskedPayload.before);
      if (maskedPayload.after) maskedPayload.after = this.maskPII(maskedPayload.after);

      // Run asynchronously without waiting
      AuditLogModel.create(maskedPayload).catch((err) => {
        console.error('Failed to save Audit Log:', err);
      });
    } catch (error) {
      console.error('Error in AuditService.logAction:', error);
    }
  }
}