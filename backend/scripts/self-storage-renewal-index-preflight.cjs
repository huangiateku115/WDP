#!/usr/bin/env node
'use strict';

// Read-only inspection. This script never creates, alters, drops, or syncs indexes.
const { MongoClient } = require('mongodb');

const required = {
  name: 'renewal_extension_single_success',
  key: { reservationId: 1, extensionId: 1, purpose: 1 },
  unique: true,
  partialFilterExpression: {
    purpose: 'RENEWAL',
    status: 'SUCCEEDED',
    extensionId: { $type: 'objectId' },
  },
};

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function indexMatches(actual) {
  return actual?.name === required.name && actual?.unique === true &&
    JSON.stringify(stable(actual.key)) === JSON.stringify(stable(required.key)) &&
    JSON.stringify(stable(actual.partialFilterExpression)) === JSON.stringify(stable(required.partialFilterExpression));
}

async function main() {
  const uri = process.env.MONGO_URL;
  const expectedDb = parseArg('--expected-db');
  if (!uri || !expectedDb) throw new Error('Set MONGO_URL and pass --expected-db <database>. URI is never printed.');
  const parsed = new URL(uri);
  const uriDb = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (uriDb && uriDb !== expectedDb) throw new Error(`Database mismatch: URI selects "${uriDb}", expected "${expectedDb}".`);

  const client = new MongoClient(uri, { readPreference: 'primary' });
  try {
    await client.connect();
    const db = client.db(expectedDb);
    const collection = db.collection('reservationpayments');
    const indexes = await collection.listIndexes().toArray();
    const named = indexes.find(index => index.name === required.name);
    const sameKey = indexes.filter(index => JSON.stringify(stable(index.key)) === JSON.stringify(stable(required.key)));
    const duplicateGroups = await collection.aggregate([
      { $match: { purpose: 'RENEWAL', status: 'SUCCEEDED', extensionId: { $type: 'objectId' } } },
      { $group: { _id: { reservationId: '$reservationId', extensionId: '$extensionId', purpose: '$purpose' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'groups' },
    ], { readConcern: { level: 'majority' } }).toArray();
    const legacyWithoutExtensionId = await collection.countDocuments({ purpose: 'RENEWAL', status: 'SUCCEEDED',
      $or: [{ extensionId: { $exists: false } }, { extensionId: null }] }, { readConcern: { level: 'majority' } });
    const duplicateCount = duplicateGroups[0]?.groups ?? 0;
    const status = named ? (indexMatches(named) ? 'SATISFIED' : 'INCOMPATIBLE_OPTIONS') : 'MISSING';
    const migrationReadiness = duplicateCount > 0 || status === 'INCOMPATIBLE_OPTIONS'
      ? 'BLOCKED'
      : status === 'SATISFIED' ? 'SATISFIED' : 'READY_FOR_MIGRATION_APPROVAL';
    console.log(JSON.stringify({ database: expectedDb, collection: 'reservationpayments', readOnly: true,
      indexStatus: status, matchingKeyPatternCount: sameKey.length,
      sameKeyOtherIndexes: sameKey.filter(index => index.name !== required.name).map(index => ({ name: index.name, unique: index.unique === true })),
      successfulRenewalDuplicateGroups: duplicateCount, historicalRenewalsWithoutExtensionId: legacyWithoutExtensionId,
      migrationReadiness }, null, 2));
    if (status === 'INCOMPATIBLE_OPTIONS' || duplicateCount > 0) process.exitCode = 2;
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ readOnly: true, outcome: 'BLOCKED', error: error.message }, null, 2));
  process.exitCode = 1;
});
