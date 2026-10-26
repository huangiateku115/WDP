'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('node:os');
const path = require('node:path');
const safety = require('./mi06b-mongo-safety.cjs');

const dbName = `wdp_mi06b1b_it_${'a'.repeat(32)}`;
const dataDir = path.join(os.tmpdir(), `wdp-mi06b-it-${'b'.repeat(32)}`);
const valid = () => ({
  NODE_ENV: 'test', MI06B_IT_RUN: '1', MI06B_IT_CONFIRM: 'LOCAL_DISPOSABLE_ONLY',
  MI06_REPEATED_INBOUND_ENABLED: 'true', MI06B_IT_DB_NAME: dbName, MI06B_IT_DATA_DIR: dataDir,
  MONGO_URL: `mongodb://127.0.0.1:27018/${dbName}?directConnection=true`,
});

test('local integration target accepts only the explicit generated test database identity', () => {
  const target = safety.getValidatedConfig(valid());
  assert.equal(target.host, '127.0.0.1');
  assert.equal(target.port, 27018);
  assert.equal(target.replicaSet, 'wdp-mi06b-it');
  assert.equal(target.dbName, dbName);
  assert.equal(target.dataDir, dataDir);
});

test('local integration target rejects non-test, unconfirmed, non-local, credentialed, or alternate targets', () => {
  const invalid = [
    { NODE_ENV: 'development' },
    { MI06B_IT_RUN: undefined },
    { MI06B_IT_CONFIRM: undefined },
    { MI06B_IT_DATA_DIR: path.join(os.tmpdir(), '..', 'shared-mongo') },
    { MONGO_URL: `mongodb+srv://127.0.0.1/${dbName}` },
    { MONGO_URL: `mongodb://localhost:27018/${dbName}?directConnection=true` },
    { MONGO_URL: `mongodb://192.0.2.1:27018/${dbName}?directConnection=true` },
    { MONGO_URL: `mongodb://127.0.0.1:27017/${dbName}?directConnection=true` },
    { MONGO_URL: `mongodb://user:password@127.0.0.1:27018/${dbName}?directConnection=true` },
    { MONGO_URL: 'mongodb://127.0.0.1:27018/wdp?directConnection=true' },
    { MONGO_URL: `mongodb://127.0.0.1:27018/${dbName}?directConnection=true&authSource=admin` },
    { MI06_REPEATED_INBOUND_ENABLED: 'false' },
  ];
  for (const override of invalid) {
    assert.throws(() => safety.getValidatedConfig({ ...valid(), ...override }), /safety check failed/);
  }
});

test('harness disables Mongoose automatic index and collection creation', () => {
  safety.setNoAutomaticIndexes();
  assert.equal(mongoose.get('autoIndex'), false);
  assert.equal(mongoose.get('autoCreate'), false);
  assert.equal(mongoose.get('bufferCommands'), false);
});
