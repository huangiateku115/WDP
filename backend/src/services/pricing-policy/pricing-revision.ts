import { PricingRevision, PricingRule } from '../../types/pricing-policy.type';

type PricingRecord = Pick<PricingRule, 'version' | 'price' | 'currency' | 'effectiveFrom' | 'effectiveTo' | 'priceRevisions'>;

function asDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const result = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(result.getTime()) ? result : undefined;
}

export function pricingRevisionsFor(record: PricingRecord): PricingRevision[] {
  if (record.priceRevisions !== undefined && (!Array.isArray(record.priceRevisions) || record.priceRevisions.length === 0)) {
    throw new Error('Pricing Rule revision history is malformed');
  }
  const raw = record.priceRevisions === undefined
    ? [{ version: record.version, price: record.price, currency: record.currency,
      effectiveFrom: record.effectiveFrom, effectiveTo: record.effectiveTo }]
    : record.priceRevisions;
  const revisions = raw.map((entry) => {
    const effectiveFrom = asDate(entry.effectiveFrom);
    const effectiveTo = asDate(entry.effectiveTo);
    if (!Number.isSafeInteger(entry.version) || entry.version < 1 ||
        typeof entry.price !== 'number' || !Number.isFinite(entry.price) || entry.price <= 0 ||
        typeof entry.currency !== 'string' || !/^[A-Z]{3}$/.test(entry.currency) ||
        !effectiveFrom || (entry.effectiveTo !== undefined && entry.effectiveTo !== null && !effectiveTo) ||
        (effectiveTo && effectiveTo <= effectiveFrom)) {
      throw new Error('Pricing Rule contains invalid price revision history');
    }
    return { version: entry.version, price: entry.price, currency: entry.currency, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}) };
  });
  for (let index = 1; index < revisions.length; index++) {
    const previous = revisions[index - 1];
    const current = revisions[index];
    if (!previous || !current) throw new Error('Pricing Rule revision history is incomplete');
    if (current.effectiveFrom <= previous.effectiveFrom ||
        !previous.effectiveTo || previous.effectiveTo.getTime() !== current.effectiveFrom.getTime()) {
      throw new Error('Pricing Rule revision history is not strictly ordered and contiguous');
    }
  }
  const latest = revisions[revisions.length - 1];
  if (!latest) throw new Error('Pricing Rule revision history is empty');
  const topLevelStart = asDate(record.effectiveFrom);
  const topLevelEnd = asDate(record.effectiveTo);
  if (!topLevelStart || latest.effectiveFrom.getTime() !== topLevelStart.getTime() ||
      latest.price !== record.price || latest.currency !== record.currency ||
      (latest.effectiveTo?.getTime() ?? null) !== (topLevelEnd?.getTime() ?? null)) {
    throw new Error('Pricing Rule latest fields do not match its revision history');
  }
  return revisions;
}

export function pricingRevisionAt(record: PricingRecord, at: Date): PricingRevision | undefined {
  if (!Number.isFinite(at.getTime())) throw new Error('Pricing resolution date is invalid');
  const matches = pricingRevisionsFor(record).filter(revision =>
    revision.effectiveFrom <= at && (!revision.effectiveTo || revision.effectiveTo > at));
  if (matches.length > 1) throw new Error('Pricing Rule revision history overlaps');
  return matches[0];
}

export function projectPricingRevision<T extends PricingRecord>(record: T, revision: PricingRevision): Omit<T, 'priceRevisions'> & PricingRevision {
  const document = record as PricingRecord & { toObject?: () => Record<string, unknown> };
  const plain = typeof document.toObject === 'function' ? document.toObject() : { ...record };
  const { priceRevisions: _history, ...rest } = plain;
  return { ...rest, version: revision.version, price: revision.price, currency: revision.currency,
    effectiveFrom: revision.effectiveFrom, ...(revision.effectiveTo ? { effectiveTo: revision.effectiveTo } : {}) } as Omit<T, 'priceRevisions'> & PricingRevision;
}

export function intervalsOverlap(a: PricingRevision, b: PricingRevision): boolean {
  return (!a.effectiveTo || a.effectiveTo > b.effectiveFrom) &&
    (!b.effectiveTo || b.effectiveTo > a.effectiveFrom);
}
