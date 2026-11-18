/* Controlled Access Session index migration draft. Default mode is read-only; --apply is explicit. */
require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');
const { requiredAccessSessionIndexes, classifyRequiredIndex } = require('./managed-access-index-compatibility.cjs');
const expectedIndexes = requiredAccessSessionIndexes;
const indexStatus = classifyRequiredIndex;

async function inspectScopes(collection) {
  const [active, missingPrimary, malformedPrimary, malformedScope, missingOrEmptyScope, duplicateIdsWithinScope, primaryOutsideScope, duplicates] = await Promise.all([
    collection.countDocuments({ status: 'ACTIVE' }),
    collection.countDocuments({ status: 'ACTIVE', $or: [{ reservationId: { $exists: false } }, { reservationId: null }] }),
    collection.countDocuments({ status: 'ACTIVE', reservationId: { $exists: true, $ne: null }, $expr: { $ne: [{ $type: '$reservationId' }, 'objectId'] } }),
    collection.countDocuments({ status: 'ACTIVE', $expr: { $anyElementTrue: { $map: { input: { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }, as: 'scopeId', in: { $ne: [{ $type: '$$scopeId' }, 'objectId'] } } } } }),
    collection.countDocuments({ status: 'ACTIVE', $or: [{ scopedReservationIds: { $exists: false } }, { scopedReservationIds: null }, { scopedReservationIds: { $size: 0 } }, { scopedReservationIds: { $not: { $type: 'array' } } }] }),
    collection.countDocuments({ status: 'ACTIVE', $expr: { $and: [{ $isArray: '$scopedReservationIds' }, { $gt: [{ $size: '$scopedReservationIds' }, { $size: { $setUnion: ['$scopedReservationIds', '$scopedReservationIds'] } }] }] } }),
    collection.countDocuments({ status: 'ACTIVE', reservationId: { $exists: true, $ne: null }, $expr: { $not: { $in: ['$reservationId', { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }] } } }),
    collection.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $project: { effectiveScope: { $setUnion: [{ $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }, { $cond: [{ $eq: [{ $ifNull: ['$reservationId', null] }, null] }, [], ['$reservationId']] }] } } },
      { $unwind: '$effectiveScope' }, { $group: { _id: '$effectiveScope', sessionCount: { $sum: 1 } } }, { $match: { sessionCount: { $gt: 1 } } }, { $count: 'duplicateCompleteScopeGroups' },
    ]).toArray(),
  ]);
  return { active, missingPrimary, malformedPrimary, malformedScope, missingOrEmptyScope, duplicateIdsWithinScope, primaryOutsideScope, duplicateCompleteScopeGroups: duplicates[0]?.duplicateCompleteScopeGroups ?? 0 };
}

function buildCreateIndexOptions(required) {
  if (!required || typeof required.partialFilterExpression !== 'object' || required.partialFilterExpression === null || Array.isArray(required.partialFilterExpression)) {
    throw new TypeError(`Required index ${required?.name ?? '(unnamed)'} must have an object partialFilterExpression.`);
  }
  if (typeof required.name !== 'string' || !required.name || !required.key || typeof required.key !== 'object') throw new TypeError('Required index specification is malformed.');
  return { unique: required.unique === true, partialFilterExpression: { ...required.partialFilterExpression }, name: required.name };
}

function scopeBlockers(scopeAudit) {
  const blockers = [];
  if (scopeAudit.missingPrimary) blockers.push('ACTIVE sessions are missing the primary Reservation ID.');
  if (scopeAudit.malformedPrimary) blockers.push('ACTIVE sessions have a malformed primary Reservation ID.');
  if (scopeAudit.missingOrEmptyScope) blockers.push('ACTIVE sessions have a missing or empty complete scope.');
  if (scopeAudit.duplicateIdsWithinScope) blockers.push('ACTIVE session scopes contain duplicate Reservation IDs.');
  if (scopeAudit.primaryOutsideScope) blockers.push('ACTIVE session primary IDs are absent from their stored scope.');
  if (scopeAudit.malformedScope) blockers.push('ACTIVE session scope contains non-ObjectId values.');
  if (scopeAudit.duplicateCompleteScopeGroups) blockers.push('ACTIVE sessions overlap on one or more complete-scope Reservation IDs.');
  return blockers;
}

function createPlan(indexPlan) {
  return indexPlan.filter(row => ['MISSING', 'MISSING_COEXISTING_INDEX'].includes(row.status)).map(row => {
    const required = expectedIndexes.find(index => index.name === row.name);
    return { name: required.name, key: { ...required.key }, unique: required.unique,
      partialFilterExpression: { ...required.partialFilterExpression }, compatibilityStatus: row.status };
  });
}

async function applyMissingIndexes(collection, indexPlan, logger = console) {
  const planned = createPlan(indexPlan);
  const state = { writeAttempted: false, writeSucceeded: false, indexesCreated: [], indexOutcomes: planned.map(index => ({ ...index, status: 'NOT_ATTEMPTED' })) };
  for (const plannedIndex of planned) {
    const outcome = state.indexOutcomes.find(row => row.name === plannedIndex.name);
    const required = expectedIndexes.find(index => index.name === plannedIndex.name);
    const options = buildCreateIndexOptions(required);
    state.writeAttempted = true;
    outcome.status = 'WRITE_ATTEMPTED';
    try {
      await collection.createIndex(required.key, options);
    } catch (error) {
      outcome.error = { name: error?.name ?? 'Error', code: error?.code ?? null, message: error?.message ?? 'Unknown createIndex error' };
      try {
        const afterFailure = await collection.listIndexes().toArray();
        const actual = indexStatus(afterFailure, required, []);
        outcome.status = actual.status === 'SATISFIED' ? 'VERIFIED_PRESENT_AFTER_ERROR' : 'NOT_CREATED';
        if (actual.status === 'SATISFIED') state.indexesCreated.push(required.name);
      } catch (verificationError) {
        outcome.status = 'POST_FAILURE_STATE_UNVERIFIED';
        outcome.verificationError = { name: verificationError?.name ?? 'Error', code: verificationError?.code ?? null, message: verificationError?.message ?? 'Unknown verification error' };
      }
      state.writeSucceeded = false;
      logger.error(JSON.stringify({ status: 'MIGRATION_APPLY_FAILED', ...state, credentialsRedacted: true }, null, 2));
      return { ...state, failure: { name: error?.name ?? 'Error', code: error?.code ?? null, message: error?.message ?? 'Unknown createIndex error' } };
    }
    const afterCreate = await collection.listIndexes().toArray();
    const actual = indexStatus(afterCreate, required, []);
    if (actual.status !== 'SATISFIED') {
      outcome.status = 'CREATED_BUT_NOT_VERIFIED';
      state.writeSucceeded = false;
      logger.error(JSON.stringify({ status: 'MIGRATION_POST_CREATE_VERIFICATION_FAILED', ...state, credentialsRedacted: true }, null, 2));
      return { ...state, failure: { name: 'PostCreateVerificationError', code: null, message: `Index ${required.name} was not verified after createIndex.` } };
    }
    outcome.status = 'CREATED_AND_VERIFIED';
    state.indexesCreated.push(required.name);
  }
  state.writeSucceeded = planned.length === state.indexesCreated.length;
  return state;
}

async function runMigration({ client, apply = false, logger = console }) {
  const db = client.db();
  if (db.databaseName !== 'test') throw new Error(`Migration draft only targets database test; selected database is ${db.databaseName}.`);
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error('Replica-set topology is required; no index operation was attempted.');
  const buildInfo = await db.admin().command({ buildInfo: 1 });
  const collection = db.collection('managedaccesssessions');
  const currentIndexes = await collection.listIndexes().toArray();
  const indexPlan = expectedIndexes.map(index => indexStatus(currentIndexes, index, buildInfo.versionArray));
  const scopeAudit = await inspectScopes(collection);
  const blockers = scopeBlockers(scopeAudit);
  for (const index of indexPlan.filter(row => row.status === 'INCOMPATIBLE_OPTIONS')) blockers.push(`Index ${index.name} is incompatible (${index.reason}); existing indexes: ${index.existingNames.join(', ') || 'none'}. No index will be dropped or replaced.`);
  const plan = createPlan(indexPlan);
  if (blockers.length) {
    return { status: 'MIGRATION_BLOCKED', mode: apply ? 'WRITE_NOT_STARTED' : 'READ_ONLY', database: db.databaseName, replicaSet: hello.setName,
      serverVersion: buildInfo.version, serverVersionArray: buildInfo.versionArray, indexPlan, createPlan: plan, scopeAudit, blockers,
      writeAttempted: false, writeSucceeded: false, indexesCreated: [], credentialsRedacted: true };
  }
  if (!apply) {
    return { status: 'READY_FOR_MIGRATION_APPROVAL', mode: 'READ_ONLY', database: db.databaseName, replicaSet: hello.setName,
      serverVersion: buildInfo.version, serverVersionArray: buildInfo.versionArray,
      currentIndexes: currentIndexes.map(index => ({ name: index.name, key: index.key, unique: Boolean(index.unique), partialFilterExpression: index.partialFilterExpression ?? null })),
      indexPlan, createPlan: plan, scopeAudit, nextAction: 'Review output and obtain explicit migration approval; rerun with --apply only after approval.',
      writeAttempted: false, writeSucceeded: false, indexesCreated: [], credentialsRedacted: true };
  }
  const writeState = await applyMissingIndexes(collection, indexPlan, logger);
  if (writeState.failure) return { status: 'MIGRATION_APPLY_FAILED', mode: 'WRITE', database: db.databaseName, replicaSet: hello.setName,
    serverVersion: buildInfo.version, indexPlan, createPlan: plan, scopeAudit, ...writeState, credentialsRedacted: true };
  return { status: 'MIGRATION_APPLIED_AND_VERIFIED', mode: 'WRITE', database: db.databaseName, replicaSet: hello.setName,
    serverVersion: buildInfo.version, verifiedIndexes: writeState.indexOutcomes, scopeAudit, ...writeState, credentialsRedacted: true };
}

async function main() {
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL is not configured.');
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 6000 });
  try {
    await client.connect();
    const result = await runMigration({ client, apply: process.argv.includes('--apply') });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'MIGRATION_BLOCKED' || result.status === 'MIGRATION_APPLY_FAILED') process.exitCode = result.status === 'MIGRATION_BLOCKED' ? 2 : 1;
  } finally { await client.close(); }
}

if (require.main === module) main().catch(error => {
  const message = String(error?.message ?? 'Unknown error').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI REDACTED]');
  console.error(JSON.stringify({ status: 'MIGRATION_BLOCKED_OR_FAILED', name: error?.name || 'Error', code: error?.code || null,
    message, writeAttempted: false, writeSucceeded: false, indexesCreated: [], credentialsRedacted: true }));
  process.exitCode = 1;
});

module.exports = { indexStatus, inspectScopes, buildCreateIndexOptions, scopeBlockers, createPlan, applyMissingIndexes, runMigration };
