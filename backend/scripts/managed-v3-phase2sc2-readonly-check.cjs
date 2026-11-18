/* Read-only Access Session scope/index audit. Never prints record IDs or customer data. */
require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');
const { requiredAccessSessionIndexes, classifyRequiredIndex } = require('./managed-access-index-compatibility.cjs');

async function main() {
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL is not configured.');
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 6000 });
  try {
    await client.connect();
    const db = client.db();
    if (db.databaseName !== 'test') throw new Error(`Diagnostic expects database test; selected database is ${db.databaseName}.`);
    const hello = await db.admin().command({ hello: 1 });
    const buildInfo = await db.admin().command({ buildInfo: 1 });
    const collection = db.collection('managedaccesssessions');
    const indexes = await collection.listIndexes().toArray();
    const now = new Date();
    const [activeSessionCount, expiredStillActiveCount, missingPrimaryCount, malformedPrimaryCount, missingOrEmptyScopeCount, duplicateIdsWithinScopeCount,
      primaryOutsideScopeCount, malformedScopeElementCount, duplicatePrimaryRows, duplicateScopeRows] = await Promise.all([
      collection.countDocuments({ status: 'ACTIVE' }),
      collection.countDocuments({ status: 'ACTIVE', expiresAt: { $lte: now } }),
      collection.countDocuments({ status: 'ACTIVE', $or: [{ reservationId: { $exists: false } }, { reservationId: null }] }),
      collection.countDocuments({ status: 'ACTIVE', reservationId: { $exists: true, $ne: null },
        $expr: { $ne: [{ $type: '$reservationId' }, 'objectId'] } }),
      collection.countDocuments({ status: 'ACTIVE', $or: [{ scopedReservationIds: { $exists: false } },
        { scopedReservationIds: null }, { scopedReservationIds: { $size: 0 } }, { scopedReservationIds: { $not: { $type: 'array' } } }] }),
      collection.countDocuments({ status: 'ACTIVE', $expr: { $and: [ { $isArray: '$scopedReservationIds' },
        { $gt: [{ $size: '$scopedReservationIds' }, { $size: { $setUnion: ['$scopedReservationIds', '$scopedReservationIds'] } }] } ] } }),
      collection.countDocuments({ status: 'ACTIVE', reservationId: { $exists: true, $ne: null },
        $expr: { $not: { $in: ['$reservationId', { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }] } } }),
      collection.countDocuments({ status: 'ACTIVE', $expr: { $anyElementTrue: { $map: {
        input: { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] }, as: 'scopeId',
        in: { $ne: [{ $type: '$$scopeId' }, 'objectId'] },
      } } } }),
      collection.aggregate([
        { $match: { status: 'ACTIVE', reservationId: { $exists: true, $ne: null } } },
        { $group: { _id: '$reservationId', sessionCount: { $sum: 1 } } }, { $match: { sessionCount: { $gt: 1 } } },
        { $count: 'duplicatePrimaryGroups' },
      ]).toArray(),
      collection.aggregate([
        { $match: { status: 'ACTIVE' } },
        { $project: { effectiveScope: { $setUnion: [
          { $cond: [{ $isArray: '$scopedReservationIds' }, '$scopedReservationIds', []] },
          { $cond: [{ $eq: [{ $ifNull: ['$reservationId', null] }, null] }, [], ['$reservationId']] },
        ] } } },
        { $unwind: '$effectiveScope' },
        { $group: { _id: '$effectiveScope', sessionCount: { $sum: 1 } } },
        { $match: { sessionCount: { $gt: 1 } } }, { $count: 'duplicateCompleteScopeGroups' },
      ]).toArray(),
    ]);
    const indexReadiness = requiredAccessSessionIndexes.map(expected => classifyRequiredIndex(indexes, expected, buildInfo.versionArray));
    console.log(JSON.stringify({
      status: 'READ_ONLY_DIAGNOSTIC_COMPLETE', mode: 'READ_ONLY', database: db.databaseName,
      topology: hello.setName ? 'replicaSet' : hello.msg === 'isdbgrid' ? 'mongos' : 'other', replicaSet: hello.setName || null,
      serverVersion: buildInfo.version, serverVersionArray: buildInfo.versionArray,
      currentIndexes: indexes.map(index => ({ name: index.name, key: index.key, unique: Boolean(index.unique),
        partialFilterExpression: index.partialFilterExpression ?? null, sparse: Boolean(index.sparse),
        expireAfterSeconds: index.expireAfterSeconds ?? null, collation: index.collation ?? null })),
      requiredIndexReadiness: indexReadiness,
      scopeCounts: { activeSessionCount, expiredStillActiveCount, missingPrimaryCount, malformedPrimaryCount, missingOrEmptyScopeCount, duplicateIdsWithinScopeCount,
        primaryOutsideScopeCount, malformedScopeElementCount,
        duplicatePrimaryGroups: duplicatePrimaryRows[0]?.duplicatePrimaryGroups ?? 0,
        duplicateCompleteScopeGroups: duplicateScopeRows[0]?.duplicateCompleteScopeGroups ?? 0 },
      writesPerformed: false, credentialsRedacted: true,
    }, null, 2));
  } finally { await client.close(); }
}

main().catch(error => {
  const message = String(error?.message ?? 'Unknown error').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI REDACTED]');
  console.error(JSON.stringify({ status: 'READ_ONLY_DIAGNOSTIC_FAILED', name: error?.name || 'Error', code: error?.code || null,
    message, writesPerformed: false, credentialsRedacted: true }));
  process.exitCode = 1;
});
