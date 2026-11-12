/*
 * Opt-in MongoDB replica-set readiness probe for isolated test databases only.
 * It validates MongoDB primitives used by V3; it does not invoke application services.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');

const uri = process.env.MI_V3_TEST_MONGODB_URI;
if (!uri) throw new Error('Set MI_V3_TEST_MONGODB_URI to a disposable, non-production MongoDB replica-set database.');
if (process.env.MI_V3_ALLOW_TEST_DB_WRITES !== 'YES') throw new Error('Set MI_V3_ALLOW_TEST_DB_WRITES=YES only after confirming this is a disposable test database.');
const parsed = new URL(uri);
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
if (!/test|ci/i.test(dbName)) throw new Error('Refusing writes: database name must visibly contain "test" or "ci".');
const prefix = `mi_v3_readiness_${randomUUID().replaceAll('-', '')}`;
const names = { ledger: `${prefix}_ledger`, stock: `${prefix}_stock`, session: `${prefix}_session`, cell: `${prefix}_cell` };
let client;

async function main() {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const hello = await db.admin().command({ hello: 1 });
  assert.ok(hello.setName, 'MongoDB must be a replica set to support multi-document transactions');
  for (const name of Object.values(names)) await db.createCollection(name);
  const ledger = db.collection(names.ledger), stock = db.collection(names.stock), sessions = db.collection(names.session), cells = db.collection(names.cell);
  await ledger.createIndex({ idempotencyKey: 1 }, { unique: true });
  await stock.createIndex({ skuId: 1 }, { unique: true });
  const skuId = randomUUID(), idempotencyKey = randomUUID();
  await stock.insertOne({ skuId, revision: 0, quantity: 0, weightKg: 0, volumeM3: 0 });
  await cells.insertOne({ cellId: 'test-cell', usedWeightKg: 0, usedVolumeM3: 0 });
  await sessions.insertOne({ sessionId: 'test-session', revision: 1, status: 'ACTIVE' });

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await ledger.insertOne({ skuId, idempotencyKey, action: 'ADD', quantity: 2, weightKg: 4, volumeM3: 0.2 }, { session });
      const changed = await stock.updateOne({ skuId, revision: 0 }, { $inc: { revision: 1, quantity: 2, weightKg: 4, volumeM3: 0.2 } }, { session });
      assert.equal(changed.modifiedCount, 1, 'atomic ADD compare-and-set should advance projection');
      await cells.updateOne({ cellId: 'test-cell' }, { $inc: { usedWeightKg: 4, usedVolumeM3: 0.2 } }, { session });
    });
  } finally { await session.endSession(); }
  assert.equal((await ledger.countDocuments({ idempotencyKey })).valueOf(), 1);
  assert.equal((await stock.findOne({ skuId })).quantity, 2);

  const rollbackKey = randomUUID(), rollbackSession = client.startSession();
  try {
    await assert.rejects(rollbackSession.withTransaction(async () => {
      await ledger.insertOne({ skuId, idempotencyKey: rollbackKey, action: 'ADD', quantity: 1 }, { session: rollbackSession });
      await stock.updateOne({ skuId }, { $inc: { revision: 1, quantity: 1 } }, { session: rollbackSession });
      throw new Error('injected rollback');
    }), /injected rollback/);
  } finally { await rollbackSession.endSession(); }
  assert.equal(await ledger.countDocuments({ idempotencyKey: rollbackKey }), 0);
  assert.equal((await stock.findOne({ skuId })).quantity, 2);

  await assert.rejects(ledger.insertOne({ skuId, idempotencyKey, action: 'ADD' }), error => error.code === 11000);
  const concurrent = await Promise.all([0, 1].map(async () => {
    const s = client.startSession();
    try { return await s.withTransaction(() => stock.updateOne({ skuId, revision: 1 }, { $inc: { revision: 1, quantity: 1 } }, { session: s })); }
    finally { await s.endSession(); }
  }));
  assert.ok(concurrent.some(result => result.modifiedCount === 1), 'at least one concurrent CAS should win');
  assert.equal((await stock.findOne({ skuId })).quantity, 3, 'stale concurrent revision must not apply twice');

  await sessions.updateOne({ sessionId: 'test-session', revision: 1, status: 'ACTIVE' }, { $set: { status: 'REVOKED' }, $inc: { revision: 1 } });
  const staleSessionWrite = await sessions.updateOne({ sessionId: 'test-session', revision: 1, status: 'ACTIVE' }, { $set: { lastUse: new Date() } });
  assert.equal(staleSessionWrite.matchedCount, 0, 'revoked session cannot pass revision/status compare-and-set');

  const totals = await ledger.aggregate([{ $match: { skuId } }, { $group: { _id: null, quantity: { $sum: '$quantity' }, weightKg: { $sum: '$weightKg' }, volumeM3: { $sum: '$volumeM3' } } }]).next();
  const cell = await cells.findOne({ cellId: 'test-cell' });
  assert.equal(cell.usedWeightKg, totals.weightKg);
  assert.equal(cell.usedVolumeM3, totals.volumeM3);
  await client.close(); client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }); await client.connect();
  assert.equal(await client.db(dbName).collection(names.ledger).countDocuments({ idempotencyKey }), 1, 'ledger write must persist after reconnect');
  console.log('PASS: replica-set transaction/index/CAS/rollback/replay/revoke/capacity/reconnect readiness (MongoDB primitives only).');
}

main().catch(error => { console.error(`FAIL: ${error.name}: ${error.message}`); process.exitCode = 1; })
  .finally(async () => {
    if (!client) return;
    try { const db = client.db(dbName); for (const name of Object.values(names)) await db.collection(name).drop().catch(() => {}); }
    finally { await client.close(); }
  });
