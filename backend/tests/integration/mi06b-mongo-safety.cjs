'use strict';

const mongoose = require('mongoose');
const os = require('node:os');
const path = require('node:path');

const CONFIRMATION = 'LOCAL_DISPOSABLE_ONLY';
const RUN_CONFIRMATION = '1';
const REPLICA_SET = 'wdp-mi06b-it';
const HOST = '127.0.0.1';
const PORT = 27018;
const DB_NAME_RE = /^wdp_mi06b1b_it_[a-f0-9]{32}$/;
const equalPath = (left, right) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase()
  : left === right;

function failClosed(message) {
  throw new Error(`MI-06B integration safety check failed: ${message}`);
}

function getValidatedConfig(env = process.env) {
  if (env.NODE_ENV !== 'test') failClosed('NODE_ENV must be exactly test');
  if (env.MI06B_IT_RUN !== RUN_CONFIRMATION) failClosed('explicit MI06B_IT_RUN=1 opt-in is required');
  if (env.MI06B_IT_CONFIRM !== CONFIRMATION) failClosed('explicit disposable-database confirmation is required');
  if (env.MI06_REPEATED_INBOUND_ENABLED?.trim().toLowerCase() !== 'true') {
    failClosed('the isolated test process must explicitly enable the test-only request service');
  }

  const dbName = env.MI06B_IT_DB_NAME;
  if (typeof dbName !== 'string' || !DB_NAME_RE.test(dbName)) {
    failClosed('MI06B_IT_DB_NAME must be a fresh wdp_mi06b1b_it_<32 hex> name');
  }
  const rawDataDir = env.MI06B_IT_DATA_DIR;
  if (typeof rawDataDir !== 'string' || !rawDataDir) failClosed('MI06B_IT_DATA_DIR must name the dedicated temporary server directory');
  const dataDir = path.resolve(rawDataDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (!/^wdp-mi06b-it-[a-f0-9]{32}$/i.test(path.basename(dataDir)) ||
      !equalPath(path.dirname(dataDir), tempRoot)) {
    failClosed('MI06B_IT_DATA_DIR must be a unique direct child of the OS temporary directory');
  }
  const rawUri = env.MONGO_URL;
  if (typeof rawUri !== 'string' || !rawUri) failClosed('MONGO_URL must be supplied explicitly');

  let uri;
  try { uri = new URL(rawUri); }
  catch { failClosed('MONGO_URL is malformed'); }
  if (uri.protocol !== 'mongodb:' || uri.hostname !== HOST || uri.port !== String(PORT) ||
      uri.username || uri.password || uri.hash || uri.pathname !== `/${dbName}`) {
    failClosed('MONGO_URL must target only the generated database on mongodb://127.0.0.1:27018');
  }
  const params = [...uri.searchParams.entries()];
  if (params.length !== 1 || uri.searchParams.getAll('directConnection').length !== 1 ||
      uri.searchParams.get('directConnection') !== 'true' ||
      params.some(([key]) => key !== 'directConnection')) {
    failClosed('MONGO_URL must specify only directConnection=true; replica-set identity is checked by hello');
  }
  return { uri: rawUri, dbName, dataDir, host: HOST, port: PORT, replicaSet: REPLICA_SET };
}

function setNoAutomaticIndexes() {
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  mongoose.set('bufferCommands', false);
}

async function connectAndVerify(config) {
  setNoAutomaticIndexes();
  await mongoose.connect(config.uri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  try {
    const connection = mongoose.connection;
    if (connection.host !== config.host || Number(connection.port) !== config.port || connection.name !== config.dbName) {
      failClosed('connected MongoDB identity differs from the explicit test target');
    }

    const hello = await connection.db.admin().command({ hello: 1 });
    const expectedMember = `${HOST}:${PORT}`;
    if (hello.setName !== REPLICA_SET || hello.isWritablePrimary !== true ||
        !Array.isArray(hello.hosts) || hello.hosts.length !== 1 || hello.hosts[0] !== expectedMember ||
        (hello.me && hello.me !== expectedMember)) {
      failClosed('MongoDB must be the writable primary of the one-member approved local replica set');
    }
    const commandLine = await connection.db.admin().command({ getCmdLineOpts: 1 });
    const parsed = commandLine?.parsed ?? {};
    const configuredBindIp = parsed.net?.bindIp;
    const bindIps = Array.isArray(configuredBindIp) ? configuredBindIp : [configuredBindIp];
    if (parsed.net?.port !== PORT || bindIps.length !== 1 || bindIps[0] !== HOST || parsed.net?.bindIpAll === true ||
        parsed.replication?.replSetName !== REPLICA_SET || !equalPath(path.resolve(parsed.storage?.dbPath ?? ''), config.dataDir)) {
      failClosed('mongod must bind only 127.0.0.1:27018 and use the approved temporary directory and replica-set name');
    }
    return connection;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    throw error;
  }
}

async function createAndVerifyRequestEventIndexes(RequestModel, EventModel) {
  // Create only the two collections used by this integration suite. Never call syncIndexes().
  await RequestModel.createIndexes();
  await EventModel.createIndexes();
  const requestIndexes = await RequestModel.collection.listIndexes().toArray();
  const eventIndexes = await EventModel.collection.listIndexes().toArray();
  const unresolved = requestIndexes.find(index => index.name === 'inventory_inbound_request_one_unresolved_per_item');
  const eventOperationKey = eventIndexes.find(index => index.unique &&
    index.key.customerId === 1 && index.key.scopeType === 1 && index.key.scopeId === 1 &&
    index.key.operation === 1 && index.key.idempotencyKey === 1);
  const eventVersion = eventIndexes.find(index => index.unique && index.key.requestId === 1 && index.key.resultingVersion === 1);
  if (!unresolved || !unresolved.unique ||
      JSON.stringify(unresolved.partialFilterExpression) !== JSON.stringify({ state: { $in: [
        'PENDING_INSPECTION', 'DISCREPANCY', 'ACCEPTED_PENDING_CONFIRMATION', 'RETURN_PENDING',
      ] } }) || !eventOperationKey || !eventVersion) {
    failClosed('required partial request and unique event indexes were not installed as declared');
  }
  return { requestIndexes, eventIndexes };
}

async function dropOnlyGeneratedTestDatabase(config) {
  if (!DB_NAME_RE.test(config.dbName) || config.host !== HOST || config.port !== PORT || config.replicaSet !== REPLICA_SET ||
      !/^wdp-mi06b-it-[a-f0-9]{32}$/i.test(path.basename(config.dataDir)) ||
      !equalPath(path.dirname(config.dataDir), path.resolve(os.tmpdir()))) {
    failClosed('refusing cleanup because the target is not the generated test database');
  }
  const connection = mongoose.connection;
  if (connection.readyState !== 1 || connection.host !== HOST || Number(connection.port) !== PORT || connection.name !== config.dbName) {
    failClosed('refusing cleanup because the active connection identity changed');
  }
  const hello = await connection.db.admin().command({ hello: 1 });
  if (hello.setName !== REPLICA_SET || hello.isWritablePrimary !== true ||
      !Array.isArray(hello.hosts) || hello.hosts.length !== 1 || hello.hosts[0] !== `${HOST}:${PORT}`) {
    failClosed('refusing cleanup because replica-set identity changed');
  }
  const commandLine = await connection.db.admin().command({ getCmdLineOpts: 1 });
  const parsed = commandLine?.parsed ?? {};
  const configuredBindIp = parsed.net?.bindIp;
  const bindIps = Array.isArray(configuredBindIp) ? configuredBindIp : [configuredBindIp];
  if (parsed.net?.port !== PORT || bindIps.length !== 1 || bindIps[0] !== HOST || parsed.net?.bindIpAll === true ||
      parsed.replication?.replSetName !== REPLICA_SET || !equalPath(path.resolve(parsed.storage?.dbPath ?? ''), config.dataDir)) {
    failClosed('refusing cleanup because mongod command-line identity changed');
  }
  await connection.dropDatabase();
}

module.exports = {
  CONFIRMATION,
  REPLICA_SET,
  HOST,
  PORT,
  getValidatedConfig,
  setNoAutomaticIndexes,
  connectAndVerify,
  createAndVerifyRequestEventIndexes,
  dropOnlyGeneratedTestDatabase,
};
