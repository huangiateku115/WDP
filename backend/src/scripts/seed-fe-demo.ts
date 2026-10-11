import 'dotenv/config';
import mongoose from 'mongoose';
import { activeIntervalOverlapFilter, canSeedFacilityWorkflow, canSeedSupportWorkflow, connectedSeedDatabaseMatches, createIfMissing, effectiveAt, insertWithinScopeTransaction, isAllowedSeedDatabase, isSeedDryRun, resolveOptionalSeedUser, resolveUniqueEffectiveRule, SeedIntervalConflict, selectOperationalFacility, stableSeedId } from './seed-fe-demo-utils';

const dryRun = isSeedDryRun(process.argv, process.env.FE_SEED_DRY_RUN);
const confirmed = process.env.FE_SEED_CONFIRM === 'YES';
const databaseName = process.env.FE_SEED_DATABASE;
// Prevent model compilation from issuing implicit index/collection writes, including in dry-run mode.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

if (process.env.NODE_ENV === 'production') {
  console.error('FE demo seed refuses to run when NODE_ENV=production.');
  process.exitCode = 1;
} else if (!dryRun && !confirmed) {
  console.log('No database changes made. Use NODE_ENV=development, FE_SEED_TARGET=DEVELOPMENT, FE_SEED_CONFIRM=YES, and FE_SEED_DATABASE=test to opt in.');
} else if (!dryRun && (process.env.NODE_ENV !== 'development' || process.env.FE_SEED_TARGET !== 'DEVELOPMENT' || !isAllowedSeedDatabase(databaseName))) {
  console.error('Seed refused. Writes require development mode, FE_SEED_TARGET=DEVELOPMENT, and FE_SEED_DATABASE=test.');
  process.exitCode = 1;
} else if (!isAllowedSeedDatabase(databaseName)) {
  console.error('Seed refused: explicitly set FE_SEED_DATABASE=test for the development database.');
  process.exitCode = 1;
} else {
  void main();
}

async function main() {
  const report = { created: 0, existing: 0, skipped: 0, conflicts: 0, planned: 0,
    notes: [] as string[], userWarnings: [] as string[] };
  const dataset = { facilities: [] as any[], units: [] as any[], pricing: [] as any[], policies: [] as any[],
    maintenanceTickets: [] as any[], supportRequests: [] as any[], users: [] as any[], operationalFacility: null as any };
  const opsWorkflow: { status: 'skipped' | 'partial' | 'planned' | 'seeded'; reason: string; maintenance: string; support: string; notifications: string } = {
    status: 'skipped', reason: '', maintenance: 'skipped', support: 'skipped', notifications: 'skipped',
  };
  try {
    const { connectDatabase } = await import('../config/database');
    await connectDatabase();
    if (!connectedSeedDatabaseMatches(databaseName, mongoose.connection.name)) {
      throw new Error('Seed refused: connected database name does not exactly match FE_SEED_DATABASE=test. URI and credentials are not displayed.');
    }

    const [Facility, StorageUnit, User, PricingRule, Policy, RuleScope, MaintenanceTicket, SupportRequest,
      SupportMessage, Notification] = await Promise.all([
      import('../models/facilities/facility.model').then(m => m.default),
      import('../models/storage-units/storage-unit.model').then(m => m.default),
      import('../models/users/user.model').then(m => m.default),
      import('../models/pricing-policy/pricing-rule.model').then(m => m.default),
      import('../models/pricing-policy/policy.model').then(m => m.default),
      import('../models/pricing-policy/rule-scope.model').then(m => m.default),
      import('../models/maintenance-tickets/maintenance-ticket.model').then(m => m.default),
      import('../models/support-requests/support-request.model').then(m => m.default),
      import('../models/support-requests/support-message.model').then(m => m.default),
      import('../models/notifications/notification.model').then(m => m.default),
    ]);
    const { FacilityServiceType: ServiceType, FacilityStatus } = await import('../types/facility.type');
    const { StorageUnitSize, StorageUnitStatus } = await import('../types/storage-unit.type');
    const { TermUnit, PolicyType } = await import('../types/pricing-policy.type');
    const { UserRole } = await import('../types/user.type');
    const { MaintenanceCategory, MaintenancePriority } = await import('../types/maintenance-ticket.type');
    const { SupportCategory, SupportPriority } = await import('../types/support-request.type');
    const { NotificationMethod } = await import('../types/notification.type');
    const { MaintenanceTicketService } = await import('../services/maintenance-tickets/maintenance-ticket.service');
    const { SupportRequestService } = await import('../services/support-requests/support-request.service');

    const findOptionalUser = (envName: string, role: string) => resolveOptionalSeedUser(
      envName, role, process.env[envName], email => User.findOne({ email }).exec(), report.userWarnings);
    const customer = await findOptionalUser('SEED_CUSTOMER_EMAIL', UserRole.CUSTOMER);
    const staff = await findOptionalUser('SEED_STAFF_EMAIL', UserRole.FACILITY_STAFF);
    const manager = await findOptionalUser('SEED_MANAGER_EMAIL', UserRole.FACILITY_MANAGER);
    const bom = await findOptionalUser('SEED_BOM_EMAIL', UserRole.BOM);
    for (const [role, user] of [[UserRole.CUSTOMER, customer], [UserRole.FACILITY_STAFF, staff], [UserRole.FACILITY_MANAGER, manager], [UserRole.BOM, bom]] as Array<[string, any]>) {
      if (user) dataset.users.push({ role, id: String(user._id) });
    }

    const configuredOperationalFacilityId = process.env.SEED_OPERATIONAL_FACILITY_ID?.trim();
    let configuredOperationalFacility: any = null;
    let invalidOperationalFacilityReason = '';
    if (configuredOperationalFacilityId) {
      if (!/^[a-f\d]{24}$/i.test(configuredOperationalFacilityId)) invalidOperationalFacilityReason = 'ID is malformed';
      else {
        configuredOperationalFacility = await Facility.findOne({ _id: configuredOperationalFacilityId, status: FacilityStatus.ACTIVE,
          deletedAt: { $exists: false } }).exec();
        if (!configuredOperationalFacility) invalidOperationalFacilityReason = 'facility does not exist, is inactive, or is deleted';
        else if (!canSeedFacilityWorkflow(staff, manager, configuredOperationalFacility)) {
          invalidOperationalFacilityReason = 'facility is not assigned to both valid active Staff and Manager users';
          configuredOperationalFacility = null;
        }
      }
      if (invalidOperationalFacilityReason) {
        const warning = `SEED_OPERATIONAL_FACILITY_ID: ${invalidOperationalFacilityReason}; all operational demo workflows are skipped and no fallback facility will be selected.`;
        report.userWarnings.push(warning);
        report.notes.push(warning);
      }
    }

    const facilities = [
      {
        code: 'FE-DEMO-HCM-01', name: 'VaultSpace Ho Chi Minh',
        address: { line1: '18 Nguyen Van Huong', ward: 'Thao Dien', district: 'Thu Duc City', city: 'Ho Chi Minh City', country: 'VN' },
        contact: { email: 'hcm-demo@example.test', phone: '+84-28-5550-0101' },
        serviceTypes: [ServiceType.SELF_STORAGE, ServiceType.MANAGED_INVENTORY], status: FacilityStatus.ACTIVE,
        description: 'FE-DEMO sample facility. Contact and imagery are fictional frontend placeholders.',
        operatingHours: 'Daily 08:00-20:00 (demo)', images: ['https://picsum.photos/seed/wdp-fe-demo-hcm/1200/800'],
      },
      {
        code: 'FE-DEMO-HN-01', name: 'VaultSpace Hanoi',
        address: { line1: '42 Lac Long Quan', ward: 'Buoi', district: 'Tay Ho', city: 'Hanoi', country: 'VN' },
        contact: { email: 'hanoi-demo@example.test', phone: '+84-24-5550-0102' },
        serviceTypes: [ServiceType.SELF_STORAGE], status: FacilityStatus.ACTIVE,
        description: 'FE-DEMO sample facility. Contact and imagery are fictional frontend placeholders.',
        operatingHours: 'Daily 08:00-20:00 (demo)', images: ['https://picsum.photos/seed/wdp-fe-demo-hanoi/1200/800'],
      },
    ];

    const seedCreate = async (model: any, id: string, naturalFilter: Record<string, unknown>, data: Record<string, unknown>, label: string) => {
      const result = await createIfMissing(model, id, naturalFilter, data, dryRun);
      if (result.status === 'existing') { report.existing++; return { document: result.document, created: false }; }
      if (result.status === 'conflict') {
        report.conflicts++;
        report.notes.push(`${label} skipped: existing natural-key record is not marked FE-DEMO.`);
        return { document: null, created: false };
      }
      if (result.status === 'planned') { report.planned++; return { document: result.document, created: false }; }
      report.created++;
      return { document: result.document, created: true };
    };

    const facilityRows: Array<{ document: any | null; created: boolean; spec: typeof facilities[number] }> = [];
    for (const spec of facilities) {
      const seeded = await seedCreate(Facility, stableSeedId('facility', spec.code), { code: spec.code }, spec as unknown as Record<string, unknown>, `Facility ${spec.code}`);
      const existing = seeded.document;
      if (!existing) { facilityRows.push({ document: null, created: false, spec }); continue; }
      if (existing.status !== FacilityStatus.ACTIVE || existing.deletedAt ||
          JSON.stringify(existing.serviceTypes).indexOf(ServiceType.SELF_STORAGE) < 0) {
        report.notes.push(`Facility ${spec.code} is not active/self-storage-enabled; dependent demo data omitted.`);
        facilityRows.push({ document: null, created: false, spec });
      } else facilityRows.push({ ...seeded, spec });
      if (existing) dataset.facilities.push({ code: spec.code, id: String(existing._id), serviceTypes: existing.serviceTypes });
    }

    const unitSpecs = [
      ['HCM', '01', StorageUnitSize.SMALL, [2, 2, 2]], ['HCM', '02', StorageUnitSize.SMALL, [2.2, 2, 2]],
      ['HCM', '03', StorageUnitSize.SMALL, [2, 2.5, 2]], ['HCM', '04', StorageUnitSize.MEDIUM, [3, 2.5, 2.5]],
      ['HCM', '05', StorageUnitSize.MEDIUM, [3.2, 2.5, 2.5]], ['HCM', '06', StorageUnitSize.LARGE, [4, 3, 2.5]],
      ['HN', '01', StorageUnitSize.SMALL, [2, 2, 2]], ['HN', '02', StorageUnitSize.MEDIUM, [3, 2.5, 2.5]],
      ['HN', '03', StorageUnitSize.LARGE, [4, 3, 2.5]],
    ] as const;
    const unitsByCode = new Map<string, any>();
    for (const [city, suffix, size, dimensions] of unitSpecs) {
      const facilityRow = facilityRows.find(row => row.spec.code === `FE-DEMO-${city}-01`);
      if (!facilityRow?.document) continue;
      const unitCode = `FE-DEMO-${city}-${suffix}`;
      const seeded = await seedCreate(StorageUnit, stableSeedId('unit', unitCode), { facilityId: facilityRow.document._id, unitCode }, {
        facilityId: facilityRow.document._id, unitCode, size,
        dimensions: { lengthM: dimensions[0], widthM: dimensions[1], heightM: dimensions[2] },
        description: 'FE-DEMO frontend sample; no reservation is implied.',
        images: [`https://picsum.photos/seed/wdp-${unitCode.toLowerCase()}/900/600`],
        status: StorageUnitStatus.AVAILABLE,
      }, `StorageUnit ${unitCode}`);
      if (seeded.document) unitsByCode.set(unitCode, seeded.document);
      if (seeded.document) dataset.units.push({ code: unitCode, id: String(seeded.document._id), facilityId: String(facilityRow.document._id), size, status: seeded.document.status });
    }

    const pricingSpecs: Array<{ facility: any; serviceType: string; unitSize?: string; term: { value: number; unit: string }; price: number }> = [];
    for (const row of facilityRows.filter(x => x.document)) {
      for (const [size, oneMonth, threeMonth] of [
        [StorageUnitSize.SMALL, 1_200_000, 3_300_000], [StorageUnitSize.MEDIUM, 1_800_000, 5_100_000], [StorageUnitSize.LARGE, 2_700_000, 7_500_000],
      ] as const) {
        pricingSpecs.push({ facility: row.document, serviceType: ServiceType.SELF_STORAGE, unitSize: size,
          term: { value: 1, unit: TermUnit.MONTH }, price: oneMonth });
        pricingSpecs.push({ facility: row.document, serviceType: ServiceType.SELF_STORAGE, unitSize: size,
          term: { value: 3, unit: TermUnit.MONTH }, price: threeMonth });
      }
    }
    const pricingIdentity: Array<{ id: string; spec: typeof pricingSpecs[number] }> = [];
    for (const spec of pricingSpecs) {
      const key = ['pricing', String(spec.facility._id), spec.serviceType, String(spec.unitSize), String(spec.term.value), spec.term.unit];
      const _id = stableSeedId(...key);
      const filter = activeIntervalOverlapFilter({ facilityId: spec.facility._id, serviceType: spec.serviceType, unitSize: spec.unitSize,
        'term.value': spec.term.value, 'term.unit': spec.term.unit }, { effectiveFrom: new Date('2026-01-01T00:00:00.000Z') });
      const existingById = await PricingRule.findById(_id).exec();
      const overlap = await PricingRule.findOne(filter).exec();
      if (existingById) { report.existing++; pricingIdentity.push({ id: String(_id), spec }); dataset.pricing.push({ id: String(_id), facilityId: String(spec.facility._id), serviceType: spec.serviceType, size: spec.unitSize, term: spec.term, amount: existingById.price, currency: existingById.currency }); continue; }
      if (overlap) {
        report.conflicts++;
        report.notes.push(`Pricing conflict ${spec.facility.code ?? spec.facility._id}/${spec.unitSize}/${spec.term.value}M: active interval exists; preserved.`);
        continue;
      }
      if (dryRun) {
        report.planned++;
        dataset.pricing.push({ id: String(_id), facilityId: String(spec.facility._id), serviceType: spec.serviceType, size: spec.unitSize, term: spec.term, amount: spec.price, currency: 'VND' });
        continue;
      }
      const data = { facilityId: spec.facility._id, serviceType: spec.serviceType, unitSize: spec.unitSize, term: spec.term,
        price: spec.price, currency: 'VND', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), isActive: true };
      const inserted = await seedEffectiveRule(PricingRule, RuleScope, 'pricing', data);
      if (!inserted) {
        report.conflicts++;
        report.notes.push(`Pricing conflict ${spec.facility.code ?? spec.facility._id}/${spec.unitSize}/${spec.term.value}M detected during serialized insert; existing interval preserved.`);
        continue;
      }
      report.created++;
      pricingIdentity.push({ id: String(_id), spec });
      dataset.pricing.push({ id: String(_id), facilityId: String(spec.facility._id), serviceType: spec.serviceType, size: spec.unitSize, term: spec.term, amount: spec.price, currency: 'VND' });
    }

    const policySpecs = [
      { type: PolicyType.DEPOSIT, config: { amount: 500000, currency: 'VND' } },
      { type: PolicyType.CANCELLATION, config: { demoOnly: true, note: 'Illustrative UI sample; cancellation policy engine is not implemented.' } },
      { type: PolicyType.REFUND, config: { demoOnly: true, note: 'Illustrative UI sample; refund workflow is not implemented.' } },
      { type: PolicyType.OVERDUE, config: { demoOnly: true, note: 'Illustrative UI sample; overdue automation is not implemented.' } },
    ];
    const policyIdentity: Array<{ id: string; facility: any; type: string }> = [];
    for (const row of facilityRows.filter(x => x.document)) for (const spec of policySpecs) {
      const _id = stableSeedId('policy', String(row.document._id), ServiceType.SELF_STORAGE, spec.type);
      const filter = activeIntervalOverlapFilter({ facilityId: row.document._id, serviceType: ServiceType.SELF_STORAGE, type: spec.type },
        { effectiveFrom: new Date('2026-01-01T00:00:00.000Z') });
      const existingById = await Policy.findById(_id).exec();
      const overlap = await Policy.findOne(filter).exec();
      if (existingById) { report.existing++; policyIdentity.push({ id: String(_id), facility: row.document, type: spec.type }); dataset.policies.push({ id: String(_id), facilityId: String(row.document._id), facilityCode: row.spec.code, type: spec.type, effectiveFrom: existingById.effectiveFrom }); continue; }
      if (overlap) {
        report.conflicts++;
        report.notes.push(`Policy conflict ${row.spec.code}/${spec.type}: active interval exists; preserved.`);
        continue;
      }
      if (dryRun) {
        report.planned++;
        dataset.policies.push({ id: String(_id), facilityId: String(row.document._id), facilityCode: row.spec.code, type: spec.type, effectiveFrom: '2026-01-01T00:00:00.000Z' });
        continue;
      }
      const data = { facilityId: row.document._id, serviceType: ServiceType.SELF_STORAGE, type: spec.type, config: spec.config,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), isActive: true };
      const inserted = await seedEffectiveRule(Policy, RuleScope, 'policy', data);
      if (!inserted) {
        report.conflicts++;
        report.notes.push(`Policy conflict ${row.spec.code}/${spec.type} detected during serialized insert; existing interval preserved.`);
        continue;
      }
      report.created++;
      policyIdentity.push({ id: String(_id), facility: row.document, type: spec.type });
      dataset.policies.push({ id: String(_id), facilityId: String(row.document._id), facilityCode: row.spec.code, type: spec.type, effectiveFrom: '2026-01-01T00:00:00.000Z' });
    }

    const publicHcm = facilityRows.find(row => row.spec.code === 'FE-DEMO-HCM-01')?.document;
    // An explicit but invalid selection must never fall back to an unrelated demo facility.
    const operationalFacility = selectOperationalFacility(configuredOperationalFacilityId, configuredOperationalFacility,
      publicHcm, staff, manager);
    const operationsAuthorized = Boolean(operationalFacility && canSeedFacilityWorkflow(staff, manager, operationalFacility));
    if (operationsAuthorized && operationalFacility) {
      dataset.operationalFacility = { id: String(operationalFacility._id), code: operationalFacility.code,
        source: configuredOperationalFacilityId ? 'existing development facility' : 'public catalog demo facility' };
    }

    const missingOperationsReason = invalidOperationalFacilityReason ||
      (!staff ? report.userWarnings.find(w => w.startsWith('SEED_STAFF_EMAIL:')) : '') ||
      (!manager ? report.userWarnings.find(w => w.startsWith('SEED_MANAGER_EMAIL:')) : '') ||
      'No selected operational facility is already assigned to both active Staff and Manager users. Set SEED_OPERATIONAL_FACILITY_ID to an existing facility they already share.';
    const canSeedMaintenance = Boolean(operationsAuthorized && operationalFacility && staff && manager);
    const canSeedSupport = Boolean(operationalFacility && canSeedSupportWorkflow(customer, staff, manager, operationalFacility));
    if (!canSeedMaintenance) {
      report.skipped += 3;
      opsWorkflow.maintenance = 'skipped';
      report.notes.push(`Maintenance workflow skipped (3 tickets): ${missingOperationsReason}`);
    }
    if (!canSeedSupport) {
      report.skipped += 7;
      opsWorkflow.support = 'skipped';
      const customerReason = !customer
        ? report.userWarnings.find(w => w.startsWith('SEED_CUSTOMER_EMAIL:'))
        : missingOperationsReason;
      report.notes.push(`Support workflow skipped (4 requests, 3 messages): ${customerReason || missingOperationsReason}`);
    }
    if (!canSeedMaintenance) report.notes.push(`Staff notification skipped: ${missingOperationsReason}`);
    if (!canSeedSupport) report.notes.push(`Customer notification skipped: ${!customer
      ? report.userWarnings.find(w => w.startsWith('SEED_CUSTOMER_EMAIL:')) || 'Customer account is unavailable.'
      : missingOperationsReason}`);

    if (dryRun) {
      if (canSeedMaintenance) { report.planned += 3; opsWorkflow.maintenance = 'planned'; }
      if (canSeedSupport) { report.planned += 7; opsWorkflow.support = 'planned'; }
      if (canSeedMaintenance) report.planned++;
      else report.skipped++;
      if (canSeedSupport) report.planned++;
      else report.skipped++;
      opsWorkflow.notifications = canSeedMaintenance && canSeedSupport ? 'planned'
        : canSeedMaintenance || canSeedSupport ? 'partial' : 'skipped';
      if (opsWorkflow.maintenance === 'planned' || opsWorkflow.support === 'planned') {
        opsWorkflow.status = 'planned';
        opsWorkflow.reason = 'Eligible workflows are planned; no optional operational records are written in dry-run.';
      } else {
        opsWorkflow.reason = 'Optional operational workflows were skipped; see section-specific notes and userWarnings.';
      }
    } else if (operationalFacility && (canSeedMaintenance || canSeedSupport)) {
      const managerActor = manager as any;
      const staffActor = staff as any;
      const scenarioUnits = [...unitsByCode.values()].filter(unit => unit.facilityId.toString() === operationalFacility._id.toString()).slice(0, 3);
      if (!scenarioUnits.length) {
        scenarioUnits.push(...await StorageUnit.find({ facilityId: operationalFacility._id, status: StorageUnitStatus.AVAILABLE,
          deletedAt: { $exists: false } }).sort({ unitCode: 1 }).limit(3).exec());
      }
      const facilitySuffix = String(operationalFacility._id).slice(-6).toUpperCase();

      if (canSeedMaintenance) {
        for (let index = 0; index < 3; index++) {
          const suffix = String(index + 1).padStart(2, '0');
          const status = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'][index];
          const title = `FE-DEMO Maintenance ${facilitySuffix}-${suffix}: ${status} example`;
          const existing = await MaintenanceTicket.findOne({ title }).exec();
          let ticket: any;
          let created = false;
          if (existing) { ticket = existing; report.existing++; }
          else {
            ticket = await MaintenanceTicketService.create({ facilityId: String(operationalFacility._id), storageUnitId: scenarioUnits[index] && String(scenarioUnits[index]._id),
              title, description: 'FE-DEMO fictional maintenance example; no unit status transition is implied.',
              category: index === 0 ? MaintenanceCategory.CLEANING : MaintenanceCategory.GENERAL,
              priority: index === 2 ? MaintenancePriority.HIGH : MaintenancePriority.MEDIUM }, managerActor);
            report.created++; created = true;
          }
          if (created && index >= 1) ticket = await MaintenanceTicketService.assign(String(ticket._id), { assignedTo: String(staff._id) }, managerActor);
          if (created && index === 2) ticket = await MaintenanceTicketService.updateStatus(String(ticket._id), { status: 'IN_PROGRESS' }, staffActor);
          dataset.maintenanceTickets.push({ id: String(ticket._id), title: ticket.title, status: ticket.status,
            facilityId: String(ticket.facilityId), storageUnitId: ticket.storageUnitId ? String(ticket.storageUnitId) : undefined });
        }
        opsWorkflow.maintenance = 'seeded';
        const title = 'FE-DEMO staff-maintenance update';
        const found = await Notification.findOne({ userId: staff._id, title }).exec();
        if (found) report.existing++;
        else { await Notification.create({ userId: staff._id, title,
          content: 'FE-DEMO staff-maintenance notification for the seeded maintenance workflow.',
          isRead: false, sentVia: [NotificationMethod.IN_APP] } as any); report.created++; }
      }

      if (canSeedSupport) {
        for (let index = 0; index < 4; index++) {
          const suffix = String(index + 1).padStart(2, '0');
          const status = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'][index];
          const subject = `FE-DEMO Support ${facilitySuffix}-${suffix}: ${status} example`;
          const existing = await SupportRequest.findOne({ subject }).exec();
          let request: any;
          let created = false;
          if (existing) { request = existing; report.existing++; }
          else {
            const relatedUnit = scenarioUnits[index % Math.max(scenarioUnits.length, 1)];
            request = await SupportRequestService.create({ customerId: String(customer._id), facilityId: String(operationalFacility._id),
              category: index % 2 ? SupportCategory.RENTAL : SupportCategory.ACCESS, subject,
              description: 'FE-DEMO fictional support example for frontend states.', priority: index === 3 ? SupportPriority.LOW : SupportPriority.MEDIUM,
              relatedEntity: relatedUnit ? { type: 'STORAGE_UNIT', id: String(relatedUnit._id) } : { type: 'FACILITY', id: String(operationalFacility._id) } }, managerActor);
            report.created++; created = true;
          }
          if (created && index >= 1) request = await SupportRequestService.assign(String(request._id), { staffId: String(staff._id) }, managerActor);
          if (created && index >= 2) request = await SupportRequestService.updateStatus(String(request._id), { status: 'IN_PROGRESS' }, staffActor);
          if (created && index === 3) request = await SupportRequestService.updateStatus(String(request._id), { status: 'RESOLVED', resolutionNote: 'FE-DEMO example resolution; no actual service work performed.' }, staffActor);
          if (created && index === 0) { await SupportRequestService.addMessage(String(request._id), { message: 'FE-DEMO customer public message asking for access guidance.' }, customer as any); report.created++; }
          if (created && index === 2) {
            await SupportRequestService.addMessage(String(request._id), { message: 'FE-DEMO public reply from assigned staff.' }, staffActor);
            await SupportRequestService.addMessage(String(request._id), { message: 'FE-DEMO internal staff note.', isInternal: true }, staffActor);
            report.created += 2;
          }
          dataset.supportRequests.push({ id: String(request._id), subject: request.subject, status: request.status,
            facilityId: request.facilityId ? String(request.facilityId) : undefined, customerId: String(request.customerId) });
        }
        opsWorkflow.support = 'seeded';
        const title = 'FE-DEMO customer-support update';
        const found = await Notification.findOne({ userId: customer._id, title }).exec();
        if (found) report.existing++;
        else { await Notification.create({ userId: customer._id, title,
          content: 'FE-DEMO customer-support notification for the seeded support workflow.',
          isRead: false, sentVia: [NotificationMethod.IN_APP] } as any); report.created++; }
      }
      if (!canSeedSupport) report.skipped++;
      opsWorkflow.notifications = canSeedMaintenance && canSeedSupport ? 'seeded'
        : canSeedMaintenance || canSeedSupport ? 'partial' : 'skipped';
      const workflowStates = [opsWorkflow.maintenance, opsWorkflow.support];
      opsWorkflow.status = workflowStates.every(state => state === 'seeded') ? 'seeded'
        : workflowStates.some(state => state === 'seeded') ? 'partial' : 'skipped';
      opsWorkflow.reason = workflowStates.filter(state => state === 'skipped').length
        ? 'One or more optional workflows were skipped; see section-specific notes and userWarnings.'
        : 'Operational records use the selected facility and current lifecycle services.';
    } else {
      if (!canSeedMaintenance) report.skipped++;
      if (!canSeedSupport) report.skipped++;
      opsWorkflow.reason = 'Optional operational workflows were skipped; see section-specific notes and userWarnings.';
    }

    report.notes.push('Reservation, Contract, Inspection and AccessLog examples omitted: current reservation creation requires a VERIFIED CustomerProfile and a future hold; contract/payment/check-in depend on enforced lifecycle transitions. No payment provider was called and no lifecycle state was fabricated.');
    report.notes.push('Pricing and policies target 2026-10-10 with proposed half-open interval [2026-01-01, infinity). Any active overlapping interval, including one beginning in the future, is preserved and reported as a conflict.');
    report.notes.push('Managed Inventory pricing omitted: current frontend pricing does not define a volume-based term price contract, so representative amounts could be misleading.');
    if (dryRun) report.notes.push('Dry-run does not write data; pricing/policy resolution checks are read-only and can run against existing records.');
    await verifyResolutions(PricingRule, Policy, pricingIdentity, policyIdentity, report);
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'confirmed-development-seed', database: databaseName, opsWorkflow, ...report, dataset }, null, 2));
  } catch (error) {
    report.notes.push(error instanceof Error ? error.message : 'Seed failed safely.');
    opsWorkflow.reason = 'Seed terminated before all requested work completed; see notes.';
    console.error(JSON.stringify({ mode: dryRun ? 'dry-run' : 'confirmed-development-seed', database: databaseName, opsWorkflow, ...report, dataset }, null, 2));
    process.exitCode = 1;
  } finally {
    try { await mongoose.disconnect(); } catch { /* preserve the seed result */ }
  }
}

async function seedEffectiveRule(model: any, ScopeModel: any, kind: 'pricing' | 'policy', data: Record<string, any>) {
  const key = kind === 'pricing'
    ? { facilityId: data.facilityId, serviceType: data.serviceType, unitSize: data.unitSize, 'term.value': data.term.value, 'term.unit': data.term.unit }
    : { facilityId: data.facilityId, serviceType: data.serviceType, type: data.type };
  const scopeId = JSON.stringify([kind, String(data.facilityId), data.serviceType,
    ...(kind === 'pricing' ? [data.unitSize, data.term.value, data.term.unit] : [data.type])]);
  await ScopeModel.updateOne({ _id: scopeId }, { $setOnInsert: { sequence: 0 } }, { upsert: true }).exec();
  const session = await mongoose.startSession();
  try {
    try {
      await insertWithinScopeTransaction({
        withTransaction: work => session.withTransaction(work, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }),
        nextVersion: async () => {
          const guard = await ScopeModel.findOneAndUpdate({ _id: scopeId }, { $inc: { sequence: 1 } }, { new: true, session }).exec();
          if (!guard || !Number.isSafeInteger(guard.sequence)) throw new Error('Pricing/policy version allocation failed.');
          return guard.sequence;
        },
        hasActiveOverlap: async () => Boolean(await model.exists(activeIntervalOverlapFilter(key, {
          effectiveFrom: data.effectiveFrom, effectiveTo: data.effectiveTo,
        })).session(session).exec()),
        insert: async version => new model({ ...data, _id: stableSeedId(kind, String(data.facilityId), data.serviceType,
          ...(kind === 'pricing' ? [data.unitSize, data.term.value, data.term.unit] : [data.type])), version }).save({ session }),
      });
      return true;
    } catch (error) {
      if (error instanceof SeedIntervalConflict) return false;
      throw error;
    }
  } finally { await session.endSession(); }
}

async function verifyResolutions(PricingRule: any, Policy: any,
  pricing: Array<{ id: string; spec: any }>, policies: Array<{ id: string; facility: any; type: string }>, report: any) {
  const at = new Date('2026-10-10T00:00:00.000Z');
  const checks = { pricing: { checked: 0, passed: 0, failed: 0, conflicts: 0 },
    policies: { checked: 0, passed: 0, failed: 0, conflicts: 0 } };
  for (const entry of pricing) {
    checks.pricing.checked++;
    const result = await resolveUniqueEffectiveRule(PricingRule, {
      facilityId: entry.spec.facility._id, serviceType: entry.spec.serviceType,
      unitSize: entry.spec.unitSize, 'term.value': entry.spec.term.value, 'term.unit': entry.spec.term.unit,
    }, at);
    if (result.status === 'conflict') {
      checks.pricing.conflicts++;
      report.notes.push(`Pricing verification conflict: ${entry.spec.facility.code ?? entry.spec.facility._id}/${entry.spec.unitSize}/${entry.spec.term.value}${entry.spec.term.unit}; multiple rules resolve at 2026-10-10.`);
    } else if (result.status !== 'resolved' || String(result.rule._id) !== entry.id || !effectiveAt(result.rule, at)) {
      checks.pricing.failed++;
      report.notes.push(`Pricing verification failed: ${entry.spec.facility.code ?? entry.spec.facility._id}/${entry.spec.unitSize}/${entry.spec.term.value}${entry.spec.term.unit} did not uniquely resolve to its seeded ID at 2026-10-10.`);
    } else checks.pricing.passed++;
  }
  for (const entry of policies) {
    checks.policies.checked++;
    const result = await resolveUniqueEffectiveRule(Policy, {
      facilityId: entry.facility._id, serviceType: 'SELF_STORAGE', type: entry.type,
    }, at);
    if (result.status === 'conflict') {
      checks.policies.conflicts++;
      report.notes.push(`Policy verification conflict: ${entry.facility.code}/${entry.type}; multiple rules resolve at 2026-10-10.`);
    } else if (result.status !== 'resolved' || String(result.rule._id) !== entry.id || !effectiveAt(result.rule, at)) {
      checks.policies.failed++;
      report.notes.push(`Policy verification failed: ${entry.facility.code}/${entry.type} did not uniquely resolve to its seeded ID at 2026-10-10.`);
    } else checks.policies.passed++;
  }
  report.resolutionChecks = checks;
  const failed = checks.pricing.failed + checks.pricing.conflicts + checks.policies.failed + checks.policies.conflicts;
  report.notes.push(`Read-only Pricing/Policy resolution checks for 2026-10-10: ${checks.pricing.passed}/${checks.pricing.checked} pricing and ${checks.policies.passed}/${checks.policies.checked} policy scopes uniquely resolved; ${failed} failed/conflicting scopes.`);
  if (failed) process.exitCode = 1;
}
