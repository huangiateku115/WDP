import mongoose, { ClientSession, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import ReservationModel from '../../models/reservations/reservation.model';
import StorageUnitModel from '../../models/storage-units/storage-unit.model';
import CustomerProfileModel from '../../models/users/customer-profile.model';
import ContractModel from '../../models/contracts/contract.model';
import { ContractStatus } from '../../types/contract.type';
import PricingRuleModel from '../../models/pricing-policy/pricing-rule.model';
import PolicyModel from '../../models/pricing-policy/policy.model';
import { pricingRevisionAt } from '../pricing-policy/pricing-revision';
import { IReservation, ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';
import { VerificationStatus } from '../../types/customer-profile.type';
import { StorageUnitStatus } from '../../types/storage-unit.type';
import { captureTermsAcceptance } from '../terms/terms.catalog';

export interface SuggestedStorageUnit {
  _id: Types.ObjectId | string;
  unitCode: string;
  size: string;
  volumeM3?: number;
  dimensions?: {
    lengthM: number;
    widthM: number;
    heightM: number;
  };
  sameSize: boolean;
}

export class ReservationError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: { suggestedUnits?: SuggestedStorageUnit[] }
  ) {
    super(message);
    this.name = 'ReservationError';
  }
}

export class ReservationService {
  private static bookingPayloadHash(data: {
    customerId: string; facilityId: string; storageUnitId: string; startDate: Date; endDate: Date; pricingPolicyId: string; termsVersionId?: string;
  }): string {
    const canonical = {
      customerId: String(data.customerId).toLowerCase(),
      facilityId: String(data.facilityId).toLowerCase(),
      storageUnitId: String(data.storageUnitId).toLowerCase(),
      startDate: new Date(data.startDate).toISOString(),
      endDate: new Date(data.endDate).toISOString(),
      pricingPolicyId: String(data.pricingPolicyId).toLowerCase(),
      serviceType: FacilityServiceType.SELF_STORAGE,
      termsVersionId: data.termsVersionId,
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private static async findBookingReplay(customerId: string, idempotencyKey: string, payloadHash: string, session?: ClientSession) {
    let query: any = ReservationModel.findOne({ customerId, bookingIdempotencyKey: idempotencyKey });
    if (session && typeof query.session === 'function') query = query.session(session);
    const existing = await query.exec();
    if (!existing) return null;
    if (existing.bookingPayloadHash !== payloadHash) {
      throw new ReservationError(409, 'This booking request key was already used with different reservation details.');
    }
    // Nếu đơn cũ đã bị CANCELLED, không coi là Replay hợp lệ để cho phép tạo đơn mới
    if (existing.status === ReservationStatus.CANCELLED) {
      return null;
    }
    return existing;
  }

  /**
   * Bộ lọc kiểm tra giao cắt khoảng thời gian (Overlap Filter) cho Kho Tự Quản.
   * Hai khoảng thời gian [S1, E1] và [S2, E2] giao nhau khi: S1 < E2 VÀ E1 > S2.
   * Các đơn ở trạng thái khác ngày (S2 >= E1 hoặc E2 <= S1) sẽ không bao giờ bị chặn.
   */
  static buildOverlapFilter(startDate: Date, endDate: Date, now = new Date()) {
    const committedStatuses = [
      ReservationStatus.DEPOSIT_PAID,
      ReservationStatus.CHECKIN_READY,
      ReservationStatus.PAID,
      ReservationStatus.ACTIVE,
      ReservationStatus.OVERDUE,
    ];
    const temporaryHoldStatuses = [
      ReservationStatus.RESERVED,
      ReservationStatus.CONTRACTED,
    ];

    return {
      // Đơn mới bắt đầu TRƯỚC khi đơn cũ kết thúc VÀ kết thúc SAU khi đơn cũ bắt đầu
      startDate: { $lt: endDate },
      endDate: { $gt: startDate },
      // Chỉ xét các trạng thái đang chiếm dụng kho
      status: {
        $in: [...committedStatuses, ...temporaryHoldStatuses],
      },
      // Lọc bỏ các đơn RESERVED/CONTRACTED đã quá hạn (expiresAt <= now)
      $or: [
        { status: { $in: committedStatuses } },
        {
          status: { $in: temporaryHoldStatuses },
          expiresAt: { $gt: now },
        },
      ],
    };
  }

  /**
   * Thuật toán kiểm tra đụng lịch (Overlap)
   * Trả về true nếu bị trùng lịch, false nếu an toàn.
   */
  private static async checkOverlap(
    storageUnitId: Types.ObjectId,
    startDate: Date,
    endDate: Date,
    session: ClientSession
  ): Promise<boolean> {
    const overlapQuery = {
      storageUnitId,
      ...this.buildOverlapFilter(startDate, endDate),
    };

    const overlappingBooking = await ReservationModel.exists(overlapQuery).session(session).exec();
    return overlappingBooking !== null;
  }

  /**
   * Tìm danh sách các kho khả thi khác (Alternative Units) trong cùng cơ sở
   * không bị trùng lịch trong khoảng thời gian [startDate, endDate].
   * Ưu tiên gợi ý kho cùng kích thước (sameSize: true) trước, sau đó đến kích thước khác.
   */
  static async findAvailableAlternatives(
    facilityId: string | Types.ObjectId,
    excludeUnitId: string | Types.ObjectId,
    preferredSize: string | undefined,
    startDate: Date,
    endDate: Date,
    session?: ClientSession
  ): Promise<SuggestedStorageUnit[]> {
    try {
      const facilityObjectId = typeof facilityId === 'string' ? new Types.ObjectId(facilityId) : facilityId;
      const overlapFilter = {
        facilityId: facilityObjectId,
        serviceType: FacilityServiceType.SELF_STORAGE,
        ...this.buildOverlapFilter(startDate, endDate),
      };

      let resQuery: any = ReservationModel.find(overlapFilter);
      if (session && typeof resQuery?.session === 'function') {
        resQuery = resQuery.session(session);
      }
      if (typeof resQuery?.select === 'function') {
        resQuery = resQuery.select('storageUnitId');
      }
      if (typeof resQuery?.lean === 'function') {
        resQuery = resQuery.lean();
      }
      const overlappingReservations = typeof resQuery?.exec === 'function' ? await resQuery.exec() : await resQuery;

      const occupiedIds = new Set<string>([excludeUnitId.toString()]);
      if (Array.isArray(overlappingReservations)) {
        for (const r of overlappingReservations) {
          if (r?.storageUnitId) {
            occupiedIds.add(r.storageUnitId.toString());
          }
        }
      }

      const occupiedObjectIds = Array.from(occupiedIds)
        .filter(id => /^[a-fA-F0-9]{24}$/.test(id))
        .map(id => new Types.ObjectId(id));

      const unitFilter = {
        facilityId: facilityObjectId,
        status: StorageUnitStatus.AVAILABLE,
        deletedAt: { $exists: false },
        _id: { $nin: occupiedObjectIds },
      };

      let unitQuery: any = StorageUnitModel.find(unitFilter);
      if (session && typeof unitQuery?.session === 'function') {
        unitQuery = unitQuery.session(session);
      }
      if (typeof unitQuery?.select === 'function') {
        unitQuery = unitQuery.select('_id unitCode size volumeM3 dimensions status');
      }
      if (typeof unitQuery?.lean === 'function') {
        unitQuery = unitQuery.lean();
      }
      const rawCandidates = typeof unitQuery?.exec === 'function' ? await unitQuery.exec() : await unitQuery;

      const availableCandidates = (Array.isArray(rawCandidates) ? rawCandidates : []).filter(
        (u: any) =>
          u &&
          u._id &&
          !occupiedIds.has(u._id.toString()) &&
          (!u.status || u.status === StorageUnitStatus.AVAILABLE) &&
          !u.deletedAt
      );

      availableCandidates.sort((a: any, b: any) => {
        const aSameSize = preferredSize && a.size === preferredSize ? 1 : 0;
        const bSameSize = preferredSize && b.size === preferredSize ? 1 : 0;
        if (aSameSize !== bSameSize) {
          return bSameSize - aSameSize;
        }
        return String(a.unitCode || '').localeCompare(String(b.unitCode || ''));
      });

      return availableCandidates.slice(0, 5).map((u: any) => ({
        _id: u._id,
        unitCode: u.unitCode,
        size: u.size,
        ...(u.volumeM3 !== undefined ? { volumeM3: u.volumeM3 } : {}),
        ...(u.dimensions !== undefined ? { dimensions: u.dimensions } : {}),
        sameSize: Boolean(preferredSize && u.size === preferredSize),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Tính toán tiền thuê và tiền cọc dựa trên Pricing Policy và thời hạn thuê
   */
  static async calculatePricing(
    pricingPolicyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    estimatedRent: number;
    depositAmount: number;
    durationDays: number;
    basePrice: number;
    currency: string;
    pricingRevisionVersion?: number;
    effectiveFrom?: Date;
  }> {
    if (!pricingPolicyId) {
      throw new ReservationError(400, 'pricingPolicyId là bắt buộc.');
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      throw new ReservationError(400, 'Khoảng thời gian thuê không hợp lệ.');
    }

    let basePrice = 0;
    let currency = 'VND';
    let pricingRevisionVersion: number | undefined;
    let effectiveFrom: Date | undefined;
    const pricingRule = await PricingRuleModel.findById(pricingPolicyId).exec();
    if (pricingRule) {
      const revision = pricingRule.isActive ? pricingRevisionAt(pricingRule, start) : undefined;
      if (!revision) throw new ReservationError(409, 'Pricing Rule is not effective for the requested rental start date.');
      basePrice = revision.price;
      currency = revision.currency;
      pricingRevisionVersion = revision.version;
      effectiveFrom = revision.effectiveFrom;
    } else {
      const policy = await PolicyModel.findById(pricingPolicyId).exec();
      if (policy && typeof policy.config?.price === 'number') {
        basePrice = policy.config.price as number;
        currency = typeof policy.config?.currency === 'string' ? policy.config.currency : 'VND';
      } else {
        throw new ReservationError(400, 'Không tìm thấy chính sách giá (Pricing Policy) hợp lệ.');
      }
    }

    const diffMs = end.getTime() - start.getTime();
    const durationDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const estimatedRent = Math.round((durationDays / 30) * basePrice);
    const depositAmount = durationDays < 30 ? Math.round(basePrice * 0.5) : basePrice;

    return { estimatedRent, depositAmount, durationDays, basePrice, currency,
      ...(pricingRevisionVersion !== undefined ? { pricingRevisionVersion } : {}),
      ...(effectiveFrom !== undefined ? { effectiveFrom } : {}) };
  }

  /**
   * Tạo Đơn đặt chỗ mới (Áp dụng Transaction & Write-Conflict)
   */
  static async createReservation(data: {
    customerId: string;
    facilityId: string;
    storageUnitId: string;
    startDate: Date;
    endDate: Date;
    pricingPolicyId: string;
    termsAccepted?: boolean;
    termsVersionId?: string;
  }): Promise<IReservation> {
    const result = await this.createReservationWithOutcome(data);
    return result.reservation;
  }

  static async createReservationWithOutcome(data: {
    customerId: string;
    facilityId: string;
    storageUnitId: string;
    startDate: Date;
    endDate: Date;
    pricingPolicyId: string;
    termsAccepted?: boolean;
    termsVersionId?: string;
    idempotencyKey?: string;
  }): Promise<{ reservation: IReservation; replayed: boolean }> {

    const idempotencyKey = data.idempotencyKey?.trim();
    if (idempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey)) {
      throw new ReservationError(400, 'A valid booking Idempotency-Key is required.');
    }
    let payloadHash: string | undefined;
    if (idempotencyKey) {
      try {
      payloadHash = this.bookingPayloadHash(data);
      } catch {
        throw new ReservationError(400, 'Reservation dates are invalid.');
      }
      const replay = await this.findBookingReplay(data.customerId, idempotencyKey, payloadHash);
      if (replay) return { reservation: replay, replayed: true };
    }
    let termsAcceptance;
    try { termsAcceptance = captureTermsAcceptance(FacilityServiceType.SELF_STORAGE, data.termsVersionId, data.termsAccepted); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      throw new ReservationError(message === 'TERMS_VERSION_STALE' ? 409 : message === 'NO_EFFECTIVE_TERMS' ? 503 : 400,
        message === 'TERMS_VERSION_STALE' ? 'Terms have changed. Review and accept the current version before continuing.' : message === 'NO_EFFECTIVE_TERMS' ? 'No effective Terms are configured for this service.' : 'Customer acceptance of the current Terms is required.');
    }
    
    // 1. Kiểm tra Gate Verification (Bắt buộc KH phải VERIFIED)
    const profile = await CustomerProfileModel.findOne({ userId: data.customerId }).exec();
    if (!profile || profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw new ReservationError(403, 'Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt.');
    }

    const now = new Date();
    const startDate = data.startDate ? new Date(data.startDate) : new Date(now);
    const endDate = new Date(data.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new ReservationError(400, 'Ngày bắt đầu hoặc ngày kết thúc không hợp lệ.');
    }

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (startDate < todayStart) {
      throw new ReservationError(400, 'Ngày bắt đầu thuê không được nằm trong quá khứ.');
    }

    if (endDate <= startDate) {
      throw new ReservationError(400, 'Ngày kết thúc phải lớn hơn ngày bắt đầu.');
    }

    // 2. Tự tính toán tiền thuê và tiền cọc từ Pricing Policy
    const pricing = await this.calculatePricing(
      data.pricingPolicyId,
      startDate,
      endDate
    );
    const { estimatedRent, depositAmount } = pricing;

    const session = await mongoose.startSession();
    try {
      let createdReservation: IReservation | null = null;
      let replayed = false;
      
      await session.withTransaction(async () => {
        if (idempotencyKey && payloadHash) {
          const replay = await this.findBookingReplay(data.customerId, idempotencyKey, payloadHash, session);
          if (replay) {
            createdReservation = replay;
            replayed = true;
            return;
          }
        }
        // 3. KHÓA KHO BẰNG WRITE-CONFLICT (Kỹ thuật ép tăng version)
        // Nếu 2 người cùng đặt kho này, lệnh $inc sẽ khiến Mongo lock document này lại.
        // Người đến sau sẽ phải đợi, hoặc bị văng lỗi WriteConflict và retry.
        const unit = await StorageUnitModel.findOneAndUpdate(
          { _id: data.storageUnitId, facilityId: data.facilityId },
          { $inc: { bookingVersion: 1 } },
          { new: true, session }
        ).exec();

        if (!unit) {
          throw new ReservationError(404, 'Không tìm thấy Kho hoặc Kho không thuộc Cơ sở này.');
        }

        // Tạm thời chỉ làm luồng cho LOCKER (SELF_STORAGE)
        if (!unit.size || unit.status === 'INACTIVE' || unit.status === 'MAINTENANCE') {
          throw new ReservationError(400, 'Kho này đang bị khóa hoặc bảo trì, không thể đặt.');
        }

        // 4. THUẬT TOÁN KIỂM TRA OVERLAP & GỢI Ý KHO THAY THẾ
        const isOverlapping = await this.checkOverlap(
          unit._id as Types.ObjectId, 
          startDate, 
          endDate, 
          session
        );

        if (isOverlapping) {
          const suggestedUnits = await this.findAvailableAlternatives(
            data.facilityId,
            unit._id as Types.ObjectId,
            unit.size,
            startDate,
            endDate,
            session
          );

          const formatDate = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
          const rangeText = `${formatDate(startDate)} đến ${formatDate(endDate)}`;
          const unitLabel = unit.unitCode ? `Kho ${unit.unitCode}` : 'Kho này';

          let conflictMessage: string;
          if (suggestedUnits.length > 0) {
            const suggestionLabels = suggestedUnits
              .map(u => `${u.unitCode} (${u.size})`)
              .join(', ');
            conflictMessage = `${unitLabel} đã có người đặt trong khoảng thời gian từ ${rangeText}. Gợi ý các kho khả dụng khác trong khoảng thời gian này: ${suggestionLabels}.`;
          } else {
            conflictMessage = `${unitLabel} đã có người đặt trong khoảng thời gian từ ${rangeText}. Hiện tại cơ sở này không còn kho trống nào khác trong khoảng thời gian bạn chọn, vui lòng chọn khoảng thời gian khác.`;
          }

          throw new ReservationError(409, conflictMessage, { suggestedUnits });
        }

        // Revalidate the verified profile in the same transaction before creating
        // the Reservation and its contract snapshot.
        let profileQuery: any = CustomerProfileModel.findOne({ userId: data.customerId });
        if (typeof profileQuery.session === 'function') profileQuery = profileQuery.session(session);
        if (typeof profileQuery.populate === 'function') profileQuery = profileQuery.populate('userId', 'displayName email phone');
        const verifiedProfile = await profileQuery.exec();
        if (!verifiedProfile || verifiedProfile.verificationStatus !== VerificationStatus.VERIFIED) {
          throw new ReservationError(403, 'Tài khoản chưa được xác minh CCCD. Vui lòng cập nhật và chờ duyệt.');
        }

        // 5. TẠO ĐƠN CONTRACTED VÀ HỢP ĐỒNG DRAFT TRONG CÙNG TRANSACTION.
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // Hold 24 tiếng theo chuẩn SRS V2

        // Tạo chuỗi random cho Reservation Code (VD: BKG-240101-ABCD)
        const dateString = new Date().toISOString().slice(2,10).replace(/-/g, '');
        const randomString = Math.random().toString(36).substring(2, 6).toUpperCase();
        const reservationCode = `BKG-${dateString}-${randomString}`;

        const reservation = new ReservationModel({
          reservationCode,
          customerId: data.customerId,
          facilityId: data.facilityId,
          serviceType: FacilityServiceType.SELF_STORAGE,
          rentalPaymentFlow: 'FULL_UPFRONT_V1',
          rentalPricingSnapshot: { pricingRuleId: String(data.pricingPolicyId), revisionVersion: pricing.pricingRevisionVersion ?? null,
            currency: pricing.currency, unitPrice: pricing.basePrice, durationDays: pricing.durationDays,
            estimatedRent, taxAmount: 0, discountAmount: 0, effectiveFrom: pricing.effectiveFrom ?? null },
          termsAcceptance,
          ...(idempotencyKey && payloadHash ? { bookingIdempotencyKey: idempotencyKey, bookingPayloadHash: payloadHash } : {}),
          storageUnitId: unit._id,
          
          startDate,
          endDate,
          
          status: ReservationStatus.CONTRACTED,
          
          pricingPolicyId: new Types.ObjectId(data.pricingPolicyId),
          estimatedRent,
          depositAmount,
          
          signingDeadline: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days SLA to inspect and sign
          expiresAt, // Đồng hồ đếm ngược 24h
          
          statusHistory: [{
            status: ReservationStatus.CONTRACTED,
            actorId: data.customerId,
            reason: 'Self-Storage reservation created; full-rent PayOS payment is pending.'
          }]
        });

        await reservation.save({ session });

        const profileUser: any = verifiedProfile.userId && typeof verifiedProfile.userId === 'object'
          ? verifiedProfile.userId
          : {};
        const contractContent = {
          schemaVersion: 1, reservationId: String(reservation._id), reservationCode: reservation.reservationCode,
          customerId: String(reservation.customerId), facilityId: String(reservation.facilityId), serviceType: reservation.serviceType,
          bookingFlowVersion: 1, rentalPaymentFlow: reservation.rentalPaymentFlow,
          storageUnitId: String(unit._id), storageUnitSize: unit.size, startDate, endDate,
          pricing: { estimatedRent, currency: pricing.currency, depositAmount, taxAmount: reservation.taxAmount || 0,
            discountAmount: reservation.discountAmount || 0, pricingPolicyId: String(reservation.pricingPolicyId) },
          termsAcceptance: reservation.termsAcceptance ? { documentCode: reservation.termsAcceptance.documentCode,
            version: reservation.termsAcceptance.version, versionId: reservation.termsAcceptance.versionId,
            serviceType: reservation.termsAcceptance.serviceType, contentHash: reservation.termsAcceptance.contentHash,
            acceptedAt: reservation.termsAcceptance.acceptedAt } : null,
          signingDeadline: reservation.signingDeadline,
        };
        const contractContentHash = createHash('sha256').update(JSON.stringify(contractContent)).digest('hex');
        const contract = new ContractModel({
          contractCode: `CTR-${reservation.reservationCode}`,
          reservationId: reservation._id,
          customerId: reservation.customerId,
          status: ContractStatus.DRAFT,
          customerSnapshot: {
            identityCard: verifiedProfile.identityCard,
            address: verifiedProfile.address,
            taxCode: verifiedProfile.taxCode,
            fullName: profileUser.displayName,
            email: profileUser.email,
            phone: profileUser.phone,
          },
          pricingSnapshot: {
            estimatedRent,
            depositAmount,
            taxAmount: reservation.taxAmount || 0,
            discountAmount: reservation.discountAmount || 0,
            pricingPolicyId: reservation.pricingPolicyId,
          },
          currentContentVersion: 1,
          contentVersions: [{ version: 1, contentHash: contractContentHash, content: contractContent,
            createdBy: reservation.customerId, createdAt: now }],
          signatures: [],
          termsVersion: reservation.termsAcceptance?.version ?? 'legacy',
        });
        await contract.save({ session });
        createdReservation = reservation;
      });

      return { reservation: createdReservation!, replayed };
    } catch (error: any) {
      if (idempotencyKey && payloadHash) {
        // A concurrent insert or an ambiguous transaction result may have committed
        // the original Reservation. Recover only by the same Customer/key/hash.
        const replay = await this.findBookingReplay(data.customerId, idempotencyKey, payloadHash).catch((lookupError) => {
          if (lookupError instanceof ReservationError && lookupError.code === 409) throw lookupError;
          return null;
        });
        if (replay) return { reservation: replay, replayed: true };
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
