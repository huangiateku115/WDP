import { createHash } from 'node:crypto';

export const FE_SEED_DEVELOPMENT_DATABASE = 'test';

export function isAllowedSeedDatabase(databaseName: string | undefined): boolean {
  return databaseName === FE_SEED_DEVELOPMENT_DATABASE;
}

export function connectedSeedDatabaseMatches(configuredName: string | undefined, connectedName: string | undefined): boolean {
  return isAllowedSeedDatabase(configuredName) && connectedName === configuredName;
}

export function isSeedDryRun(args: string[], dryRunSetting: string | undefined): boolean {
  return args.includes('--dry-run') || dryRunSetting === 'YES';
}

export function optionalUserWarning(envName: string, expectedRole: string, emailSetting: string | undefined, user: any): string | null {
  const prefix = `${envName}:`;
  if (!emailSetting?.trim()) return `${prefix} missing or empty; optional ${expectedRole} workflows may be skipped.`;
  if (!user) return `${prefix} no existing user matched the configured setting; optional workflows may be skipped.`;
  if (!user.isActive) return `${prefix} matching user is inactive; optional workflows may be skipped.`;
  if (user.role !== expectedRole) return `${prefix} matching user has an incorrect role (expected ${expectedRole}); optional workflows may be skipped.`;
  return null;
}

export async function resolveOptionalSeedUser(envName: string, expectedRole: string, emailSetting: string | undefined,
  lookup: (normalizedEmail: string) => Promise<any>, warnings: string[]): Promise<any | null> {
  if (!emailSetting?.trim()) {
    warnings.push(optionalUserWarning(envName, expectedRole, emailSetting, null)!);
    return null;
  }
  let user: any;
  try { user = await lookup(emailSetting.trim().toLowerCase()); }
  catch { throw new Error(`Database lookup failed for optional account setting ${envName}.`); }
  const warning = optionalUserWarning(envName, expectedRole, emailSetting, user);
  if (warning) {
    warnings.push(warning);
    return null;
  }
  return user;
}

export async function resolveUniqueEffectiveRule(model: any, scope: Record<string, unknown>, at: Date) {
  const rows = await model.find({
    ...scope,
    isActive: true,
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }],
  }).select('_id effectiveFrom effectiveTo isActive').lean().exec();
  if (rows.length === 0) return { status: 'missing' as const, rule: null };
  if (rows.length > 1) return { status: 'conflict' as const, rule: null };
  return { status: 'resolved' as const, rule: rows[0] };
}

export function stableSeedId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

export function canSeedFacilityWorkflow(staff: any, manager: any, facility: any): boolean {
  return Boolean(facility && facility.status === 'ACTIVE' && !facility.deletedAt && staff?.isActive && manager?.isActive &&
    staff.role === 'FACILITY_STAFF' && manager.role === 'FACILITY_MANAGER' &&
    staff.assignedFacilityId?.toString() === facility._id?.toString() &&
    manager.assignedFacilityId?.toString() === facility._id?.toString());
}

export function canSeedSupportWorkflow(customer: any, staff: any, manager: any, facility: any): boolean {
  return Boolean(customer?.isActive && customer.role === 'CUSTOMER' && canSeedFacilityWorkflow(staff, manager, facility));
}

export function selectOperationalFacility(configuredFacilityId: string | undefined, configuredFacility: any,
  publicCatalogFacility: any, staff: any, manager: any): any | null {
  if (configuredFacilityId) return canSeedFacilityWorkflow(staff, manager, configuredFacility) ? configuredFacility : null;
  return canSeedFacilityWorkflow(staff, manager, publicCatalogFacility) ? publicCatalogFacility : null;
}

export function effectiveAt(record: { effectiveFrom: Date; effectiveTo?: Date; isActive: boolean }, at: Date): boolean {
  return record.isActive && record.effectiveFrom <= at && (!record.effectiveTo || record.effectiveTo > at);
}

export interface EffectiveInterval { effectiveFrom: Date; effectiveTo?: Date; }

export function intervalsOverlap(a: EffectiveInterval, b: EffectiveInterval): boolean {
  return (!b.effectiveTo || a.effectiveFrom < b.effectiveTo) &&
    (!a.effectiveTo || b.effectiveFrom < a.effectiveTo);
}

export function activeIntervalOverlapFilter(scope: Record<string, unknown>, proposed: EffectiveInterval) {
  return {
    ...scope,
    isActive: true,
    ...(proposed.effectiveTo ? { effectiveFrom: { $lt: proposed.effectiveTo } } : {}),
    $or: [
      { effectiveTo: { $exists: false } },
      { effectiveTo: { $gt: proposed.effectiveFrom } },
    ],
  };
}

export class SeedIntervalConflict extends Error {
  constructor() { super('Pricing/policy interval conflict; existing rule preserved.'); }
}

export async function insertWithinScopeTransaction<T>(adapter: {
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
  nextVersion(): Promise<number>;
  hasActiveOverlap(): Promise<boolean>;
  insert(version: number): Promise<T>;
}): Promise<T> {
  return adapter.withTransaction(async () => {
    const version = await adapter.nextVersion();
    if (await adapter.hasActiveOverlap()) throw new SeedIntervalConflict();
    return adapter.insert(version);
  });
}

export async function createIfMissing(model: any, id: string, naturalFilter: Record<string, unknown>, data: Record<string, unknown>, dryRun: boolean) {
  const byId = await model.findOne({ _id: id }).exec();
  const found = byId ?? await model.findOne(naturalFilter).exec();
  if (found) {
    const source = found.toObject?.() ?? found;
    const markedDemo = Boolean(byId) || ['description', 'title', 'subject'].some(key => typeof source[key] === 'string' && source[key].startsWith('FE-DEMO'));
    return { status: markedDemo ? 'existing' as const : 'conflict' as const, document: markedDemo ? found : null };
  }
  if (dryRun) return { status: 'planned' as const, document: { ...data, _id: id } };
  const [document] = await model.create([{ ...data, _id: id }]);
  return { status: 'created' as const, document };
}
