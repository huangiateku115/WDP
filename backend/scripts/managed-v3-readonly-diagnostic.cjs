/*
 * Read-only MongoDB connection/schema diagnostic for Managed Inventory V3.
 * Reads the existing Backend MONGO_URL through dotenv. Performs no writes,
 * migrations, fixture setup, or cleanup. Safe to run from Windows PowerShell.
 */
require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URL;
if (!uri) {
  console.error(JSON.stringify({ status: 'BLOCKED', reason: 'MONGO_URL is not configured in Backend environment.' }));
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(uri);
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) throw new Error('Unsupported MongoDB URI scheme');
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', stage: 'uri-parse', errorName: error.name, message: error.message }));
  process.exit(2);
}

const selectedDatabase = decodeURIComponent(parsed.pathname.slice(1).split('/')[0] || 'test');
const safeError = error => ({
  errorName: error?.name || 'UnknownError',
  code: error?.code || null,
  message: String(error?.message || 'Unknown MongoDB error').replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[URI REDACTED]'),
});

async function main() {
  console.log(JSON.stringify({
    stage: 'configuration', scheme: parsed.protocol, host: parsed.hostname,
    uriHasDatabasePath: parsed.pathname.length > 1,
    dbNameOverride: parsed.searchParams.get('dbName'),
    selectedDatabase, credentialsRedacted: true,
  }));

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 7000 });
  try {
    await client.connect();
    const db = client.db();
    const ping = await db.admin().command({ ping: 1 });
    const hello = await db.admin().command({ hello: 1 });
    const topology = hello.setName ? 'replicaSet' : hello.msg === 'isdbgrid' ? 'mongos' : 'other';
    console.log(JSON.stringify({
      stage: 'connection', status: 'PASS', ping: ping.ok === 1 ? 'PASS' : 'FAIL',
      selectedDatabase: db.databaseName, topology, replicaSet: hello.setName || null,
      transactionTopologySupported: Boolean(hello.setName || hello.msg === 'isdbgrid'),
    }));

    try {
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      const names = collections.map(row => row.name).sort();
      console.log(JSON.stringify({ stage: 'collections', status: 'PASS', count: names.length, names }));
      const likelyManagedCollections = names.filter(name => /movement|cellstock|stockprojection|batchplacement|physicalunit|footprint|accesssession|cellallocation/i.test(name));
      for (const name of likelyManagedCollections) {
        try {
          const indexes = await db.collection(name).listIndexes().toArray();
          console.log(JSON.stringify({ stage: 'indexes', status: 'PASS', collection: name,
            indexes: indexes.map(({ name: indexName, key, unique, sparse, expireAfterSeconds }) => ({ name: indexName, key, unique: Boolean(unique), sparse: Boolean(sparse), expireAfterSeconds })) }));
        } catch (error) {
          console.log(JSON.stringify({ stage: 'indexes', status: 'NOT_VERIFIED', collection: name, ...safeError(error) }));
        }
      }
    } catch (error) {
      console.log(JSON.stringify({ stage: 'collections', status: 'NOT_VERIFIED', ...safeError(error) }));
    }
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ stage: 'connection', status: 'FAIL', ...safeError(error) }));
  process.exitCode = 1;
});
