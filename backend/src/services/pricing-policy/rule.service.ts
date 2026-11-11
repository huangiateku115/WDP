import mongoose, { ClientSession, HydratedDocument, Model, Types } from 'mongoose';
import PricingModel from '../../models/pricing-policy/pricing-rule.model';
import PolicyModel from '../../models/pricing-policy/policy.model';
import ScopeModel from '../../models/pricing-policy/rule-scope.model';
import FacilityModel from '../../models/facilities/facility.model';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { Policy, PricingBasis, PricingRule } from '../../types/pricing-policy.type';
import { IUser, UserRole } from '../../types/user.type';
import * as validation from './rule.validation';
import { Kind, RuleError } from './rule.validation';
import { intervalsOverlap, pricingRevisionAt, pricingRevisionsFor, projectPricingRevision } from './pricing-revision';

type Actor = Pick<IUser, 'role' | '_id'> | undefined;
type Rule = PricingRule | Policy;
function authorize(actor: Actor, write = false) {
  if (!actor) throw new RuleError(401, 'Authentication required');
  if (!Object.values(UserRole).includes(actor.role) ||
      (write && ![UserRole.BOM, UserRole.ADMIN].includes(actor.role))) throw new RuleError(403, 'Bạn không có đủ quyền truy cập!');
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof RuleError) throw error;
    const e = error as { code?: number; name?: string; hasErrorLabel?: (label: string) => boolean };
    if (e?.code === 11000 || e?.name === 'VersionError' || e?.hasErrorLabel?.('TransientTransactionError')) throw new RuleError(409, 'Concurrent rule change; retry');
    if (['ValidationError', 'CastError'].includes(e?.name || '')) throw new RuleError(400, 'Invalid rule data');
    throw new RuleError(500, 'Internal Server Error');
  }
}
function keyFilter(kind: Kind, record: Rule | Record<string, unknown>) {
  const key: Record<string, unknown> = {
    facilityId: record.facilityId,
    serviceType: record.serviceType ?? { $exists: false },
  };
  if (kind === 'policy') key.type = (record as Policy).type;
  else {
    const pricing = record as PricingRule;
    if (pricing.billingBasis) key.billingBasis = pricing.billingBasis;
    key.unitSize = pricing.unitSize ?? { $exists: false };
    key['term.value'] = pricing.term.value;
    key['term.unit'] = pricing.term.unit;
  }
  return key;
}
function scopeId(kind: Kind, key: Record<string, unknown>) {
  return JSON.stringify([kind, String(key.facilityId), key.serviceType,
    ...(kind === 'policy' ? [key.type] : [key.billingBasis, key.unitSize, key['term.value'], key['term.unit']])]);
}
export class RuleService {
  private readonly model: Model<Rule>;
  constructor(private readonly kind: Kind) {
    this.model = (kind === 'pricing' ? PricingModel : PolicyModel) as unknown as Model<Rule>;
  }
  private async parent(record: Rule | Record<string, unknown>, session: ClientSession) {
    const facility = await FacilityModel.findById(record.facilityId).session(session).exec();
    if (!facility || facility.deletedAt) throw new RuleError(404, 'Facility not found');
    if (facility.status !== FacilityStatus.ACTIVE) throw new RuleError(409, 'ACTIVE Facility required');
    if (record.serviceType && !facility.serviceTypes.includes(record.serviceType as FacilityServiceType)) throw new RuleError(409, 'Facility does not support serviceType');
  }
  private async overlap(record: Rule, session: ClientSession, exclude?: Types.ObjectId) {
    if (!record.isActive) return;
    if (this.kind === 'pricing') {
      const candidates = await this.model.find({ ...keyFilter(this.kind, record), isActive: true,
        ...(exclude ? { _id: { $ne: exclude } } : {}) }).session(session).exec();
      const proposed = pricingRevisionsFor(record as PricingRule);
      for (const candidate of candidates as PricingRule[]) {
        for (const left of pricingRevisionsFor(candidate)) {
          if (proposed.some(right => intervalsOverlap(left, right))) throw new RuleError(409, 'Effective period overlaps an active rule');
        }
      }
      return;
    }
    const filter = {
      ...keyFilter(this.kind, record), isActive: true,
      ...(exclude ? { _id: { $ne: exclude } } : {}),
      ...(record.effectiveTo ? { effectiveFrom: { $lt: record.effectiveTo } } : {}),
      $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gt: record.effectiveFrom } }],
    };
    if (await this.model.exists(filter).session(session).exec()) throw new RuleError(409, 'Effective period overlaps an active rule');
  }
  private async transaction<T>(key: Record<string, unknown>, operation: (session: ClientSession, version: number) => Promise<T>): Promise<T> {
    const _id = scopeId(this.kind, key);
    // Initialize outside the transaction so first-writer upsert races can be retried safely.
    try { await ScopeModel.updateOne({ _id }, { $setOnInsert: { sequence: 0 } }, { upsert: true }).exec(); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        // This must be the first transaction operation, before any interval reads.
        const guard = await ScopeModel.findOneAndUpdate({ _id }, { $inc: { sequence: 1 } }, { new: true, session }).exec();
        if (!guard || !Number.isSafeInteger(guard.sequence)) throw new RuleError(409, 'Version allocation failed');
        return operation(session, guard.sequence);
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
  }
  async create(input: unknown, actor: Actor) {
    authorize(actor, true);
    if (this.kind === 'policy') throw new RuleError(403, 'Business policies are system-controlled and read-only');
    const data = validation.body(this.kind, input);
    return safe(() => this.transaction(keyFilter(this.kind, data), async (session, version) => {
      // Evaluate inside the retried transaction; never insert a backdated version.
      if ((data.effectiveFrom as Date).getTime() <= Date.now()) throw new RuleError(409, 'New versions must start in the future');
      await this.parent(data, session);
      const document = new this.model({ ...data, version, ...(actor?._id ? { createdBy: actor._id } : {}) });
      await this.overlap(document, session);
      await document.save({ session });
      return document;
    }));
  }
  async get(resourceId: unknown, actor: Actor) {
    authorize(actor);
    const _id = validation.id(resourceId);
    return safe(async () => {
      const record = await this.model.findById(_id).exec();
      if (!record) throw new RuleError(404, 'Rule not found');
      return record;
    });
  }
  async list(input: unknown, actor: Actor) {
    authorize(actor);
    const { filter, page, limit } = validation.list(this.kind, input);
    return safe(async () => {
      const [data, total] = await Promise.all([
        this.model.find(filter).sort({ effectiveFrom: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        this.model.countDocuments(filter).exec(),
      ]);
      return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  async resolve(input: unknown, actor: Actor) {
    authorize(actor);
    const { key, at } = validation.resolver(this.kind, input);
    return safe(async () => {
      const filter = this.kind === 'pricing'
        ? { ...keyFilter(this.kind, key), isActive: true }
        : { ...keyFilter(this.kind, key), ...RuleService.effectiveFilter(at) };
      const results = await this.model.find(filter).lean().exec();
      if (this.kind === 'pricing') {
        const effective = (results as PricingRule[]).flatMap(record => {
          const revision = pricingRevisionAt(record, at);
          return revision ? [projectPricingRevision(record, revision)] : [];
        });
        if (!effective.length) throw new RuleError(404, 'No effective rule');
        if (effective.length !== 1) throw new RuleError(409, 'Ambiguous effective rules');
        return effective[0];
      }
      if (!results.length) throw new RuleError(404, 'No effective rule');
      if (results.length !== 1) throw new RuleError(409, 'Ambiguous effective rules');
      return results[0];
    });
  }
  private static effectiveFilter(at: Date) {
    return { isActive: true, effectiveFrom: { $lte: at }, $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }] };
  }
  async currentPublicPricing(facilityId: string, at = new Date()) {
    if (this.kind !== 'pricing') throw new RuleError(500, 'Pricing resolver unavailable');
    return safe(async () => {
      const records = await this.model.find({ facilityId: new Types.ObjectId(facilityId), isActive: true, $and: [
        { $or: [
          { serviceType: FacilityServiceType.SELF_STORAGE },
          { serviceType: FacilityServiceType.MANAGED_INVENTORY, billingBasis: PricingBasis.PER_M3 },
        ] },
      ] }).lean().exec();
      const keys = new Set<string>();
      return (records as PricingRule[]).flatMap(record => {
        const rule = record as PricingRule;
        const revision = pricingRevisionAt(rule, at);
        if (!revision) return [];
        const key = JSON.stringify([rule.serviceType, rule.unitSize ?? null, rule.term.value, rule.term.unit]);
        if (keys.has(key)) throw new RuleError(409, 'Ambiguous effective pricing rules');
        keys.add(key);
        return {
          _id: (record as any)._id,
          serviceType: rule.serviceType,
          ...(rule.billingBasis ? { billingBasis: rule.billingBasis } : {}),
          ...(rule.unitSize ? { unitSize: rule.unitSize } : {}),
          term: { value: rule.term.value, unit: rule.term.unit },
          price: revision.price,
          currency: revision.currency,
          effectiveFrom: revision.effectiveFrom,
          ...(revision.effectiveTo ? { effectiveTo: revision.effectiveTo } : {}),
        };
      });
    });
  }
  private applyPricingUpdate(document: HydratedDocument<PricingRule>, changes: Record<string, unknown>, version: number, now: Date) {
    const timeline = pricingRevisionsFor(document);
    const requestedStart = changes.effectiveFrom as Date | undefined;
    const nextPrice = (changes.price as number | undefined) ?? document.price;
    const nextCurrency = (changes.currency as string | undefined) ?? document.currency;
    if (document.effectiveFrom > now) {
      const nextStart = requestedStart ?? document.effectiveFrom;
      if (nextStart <= now) throw new RuleError(409, 'Cannot backdate a future Pricing Rule');
      const effectiveTo = (changes.effectiveTo as Date | undefined) ?? document.effectiveTo;
      if (effectiveTo && effectiveTo <= nextStart) throw new RuleError(400, 'effectiveTo must be later than effectiveFrom');
      if (Array.isArray(document.priceRevisions) && document.priceRevisions.length) {
        const history = timeline.map(revision => ({ ...revision }));
        const latestIndex = history.length - 1;
        const latest = history[latestIndex];
        if (!latest) throw new RuleError(409, 'Latest Pricing Rule revision is unavailable');
        if (latest.effectiveFrom.getTime() !== document.effectiveFrom.getTime()) throw new RuleError(409, 'Latest Pricing Rule revision is inconsistent');
        if (latestIndex > 0) {
          const previous = history[latestIndex - 1];
          if (!previous) throw new RuleError(409, 'Previous Pricing Rule revision is unavailable');
          if (nextStart <= previous.effectiveFrom) throw new RuleError(409, 'New effectiveFrom overlaps an earlier Pricing Rule revision');
          previous.effectiveTo = nextStart;
        }
        history[latestIndex] = { version, price: nextPrice, currency: nextCurrency, effectiveFrom: nextStart, ...(effectiveTo ? { effectiveTo } : {}) };
        document.set({ priceRevisions: history, price: nextPrice, currency: nextCurrency,
          effectiveFrom: nextStart, effectiveTo, version });
        return;
      }
      document.set({ ...changes, price: nextPrice, currency: nextCurrency,
        effectiveFrom: nextStart, effectiveTo, version });
      return;
    }

    const current = pricingRevisionAt(document, now);
    if (!current) throw new RuleError(409, 'An expired or inactive Pricing Rule revision is immutable');
    if (!requestedStart) throw new RuleError(400, 'effectiveFrom is required when revising a Pricing Rule that is already effective');
    if (requestedStart <= now) throw new RuleError(409, 'A new Pricing Rule price must start in the future');
    const currentIndex = timeline.findIndex(revision => revision.effectiveFrom.getTime() === current.effectiveFrom.getTime() && revision.version === current.version);
    if (currentIndex < 0) throw new RuleError(409, 'Current Pricing Rule revision is unavailable');
    const currentRevision = timeline[currentIndex];
    if (!currentRevision) throw new RuleError(409, 'Current Pricing Rule revision is unavailable');
    const effectiveTo = (changes.effectiveTo as Date | undefined) ?? currentRevision.effectiveTo;
    if (currentRevision.effectiveTo && requestedStart >= currentRevision.effectiveTo) {
      throw new RuleError(409, 'New price must begin before the current Pricing Rule period ends');
    }
    if (effectiveTo && effectiveTo <= requestedStart) throw new RuleError(400, 'effectiveTo must be later than the new effectiveFrom');
    const revisionPrice = (changes.price as number | undefined) ?? currentRevision.price;
    const revisionCurrency = (changes.currency as string | undefined) ?? currentRevision.currency;
    const history = timeline.map((revision, index) => index === currentIndex
      ? { ...revision, effectiveTo: requestedStart }
      : revision);
    history.push({ version, price: revisionPrice, currency: revisionCurrency, effectiveFrom: requestedStart, ...(effectiveTo ? { effectiveTo } : {}) });
    document.set({ priceRevisions: history, price: revisionPrice, currency: revisionCurrency,
      effectiveFrom: requestedStart, effectiveTo, version });
  }
  async update(resourceId: unknown, input: unknown, actor: Actor, statusOnly = false) {
    authorize(actor, true);
    if (this.kind === 'policy') throw new RuleError(403, 'Business policies are system-controlled and read-only');
    const _id = validation.id(resourceId);
    const changes = statusOnly
      ? { isActive: validation.boolean(validation.object(input, ['isActive']).isActive) }
      : validation.body(this.kind, input, true);
    return safe(async () => {
      const initial = await this.model.findById(_id).exec();
      if (!initial) throw new RuleError(404, 'Rule not found');
      if (!Number.isSafeInteger(initial.version)) throw new RuleError(409, 'Pricing Rule version is unavailable; reload and retry');
      // Scope fields are immutable, so the initial read only identifies the lock.
      return this.transaction(keyFilter(this.kind, initial), async (session, version) => {
        const document = await this.model.findById(_id).session(session).exec();
        if (!document) throw new RuleError(404, 'Rule not found');
        if (document.version !== initial.version) throw new RuleError(409, 'Pricing Rule changed concurrently; reload and retry');
        const now = new Date();
        if (this.kind === 'pricing' && !statusOnly) {
          await this.parent(document, session);
          const pricing = document as unknown as HydratedDocument<PricingRule>;
          this.applyPricingUpdate(pricing, changes, version, now);
          validation.range(pricing);
          await this.overlap(pricing, session, pricing._id);
          await pricing.save({ session });
          return pricing;
        }
        if (document.effectiveFrom <= now) {
          // Only prospective closure is allowed. Expired history and prior cutoffs cannot be rewritten.
          if (statusOnly || Object.keys(changes).length !== 1 || !('effectiveTo' in changes) ||
              !(changes.effectiveTo instanceof Date) || changes.effectiveTo <= now ||
              (document.effectiveTo && (document.effectiveTo <= now || changes.effectiveTo > document.effectiveTo))) {
            throw new RuleError(409, 'Effective rule is immutable; only prospective closure is allowed');
          }
        } else {
          if (changes.effectiveFrom instanceof Date && changes.effectiveFrom <= now) throw new RuleError(409, 'Cannot backdate a future rule');
          // Deactivation/closure remain possible if the facility was subsequently disabled.
          if (!(statusOnly && changes.isActive === false)) await this.parent(document, session);
        }
        document.set(changes);
        if (this.kind === 'policy' && (document as Policy).type === 'DEPOSIT' && (document as Policy).serviceType === FacilityServiceType.MANAGED_INVENTORY) {
          validation.validateManagedDepositConfig((document as Policy).config);
        }
        if (this.kind === 'policy' && (document as Policy).type === 'CATEGORY' && 'config' in changes) {
          const policy = document as unknown as Policy;
          if (policy.serviceType !== FacilityServiceType.MANAGED_INVENTORY) throw new RuleError(400, 'CATEGORY policies require MANAGED_INVENTORY serviceType');
          policy.config = validation.validateCategoryPolicyConfig(policy.config);
        }
        validation.range(document);
        document.version = version;
        await this.overlap(document, session, document._id);
        await document.save({ session });
        return document;
      });
    });
  }
}
export const pricingService = new RuleService('pricing');
export const policyService = new RuleService('policy');
