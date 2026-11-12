const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
process.env.NODE_ENV = 'test';
process.env.MONGO_URL ||= 'mongodb://localhost:27017/wdp_test';
process.env.KEYCLOAK_BASE_URL ||= 'http://localhost:8081';
process.env.KEYCLOAK_CLIENT_SECRET ||= 'test-only';
const Upload = require('../dist/models/inventory-items/inventory-image-upload.model').default;
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const Item = require('../dist/models/inventory-items/inventory-item.model').default;
const { CloudinaryService } = require('../dist/services/upload/cloudinary.service');
const { ManagedInventoryImageService: service } = require('../dist/services/upload/managed-inventory-image.service');
const { validateInventoryImage } = require('../dist/services/upload/inventory-image-validation.service');
const sharp = require('sharp');
const customerId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439071');
const reservationId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439021');
const itemId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439031');
const session = { withTransaction: async work => work(), endSession: async () => {} };
class Query {
  constructor(value) { this.value = value; }
  session(value) { assert.equal(value, session); return this; }
  sort() { return this; } limit() { return this; } select() { return this; } lean() { return this; }
  exec() { return Promise.resolve(this.value); }
}
const actor = { _id: customerId, role: 'CUSTOMER' };
const existingUpload = (overrides = {}) => ({ _id: new mongoose.Types.ObjectId(), customerId, managedReservationId: reservationId, secureUrl: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg', publicId: 'wdp/managed-inventory/a', sha256: 'abc', width: 2, height: 2, format: 'jpg', status: 'UNATTACHED', itemId: undefined, expiresAt: new Date(Date.now() + 60000), ...overrides });

test('image validator decodes JPEG, PNG and WebP bytes and rejects MIME spoofing/corruption/oversize', async () => {
  for (const [format, mime] of [['jpeg','image/jpeg'], ['png','image/png'], ['webp','image/webp']]) {
    const bytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#456789' } }).toFormat(format).toBuffer();
    const result = await validateInventoryImage(bytes, mime);
    assert.deepEqual([result.format, result.width, result.height], [format === 'jpeg' ? 'jpg' : format, 16, 12]);
    await assert.rejects(validateInventoryImage(bytes, 'image/png' === mime ? 'image/jpeg' : 'image/png'), /MIME|format/i);
  }
  await assert.rejects(validateInventoryImage(Buffer.from('not an image'), 'image/png'), /invalid|valid/i);
  await assert.rejects(validateInventoryImage(Buffer.alloc(8 * 1024 * 1024 + 1), 'image/png'), /8 MiB/i);
});

test('legacy URLs already on the same Item remain unchanged without upload lookup', async t => {
  const legacy = 'https://legacy.example.test/customer-item.jpg';
  t.mock.method(Upload, 'findOne', () => { throw Error('legacy image must not require upload metadata'); });
  await service.attachNewImages([legacy], [legacy], itemId, customerId, reservationId, session);
});

test('new image URL cannot be attached if it is not owned by this Customer and Reservation', async t => {
  t.mock.method(Upload, 'findOne', () => new Query(null));
  await assert.rejects(service.attachNewImages(['https://res.cloudinary.com/demo/image/upload/a.jpg'], [], itemId, customerId, reservationId, session), error => error.status === 403);
});

test('an upload already attached to another Item is rejected', async t => {
  const upload = existingUpload({ status: 'ATTACHED', itemId: new mongoose.Types.ObjectId() });
  t.mock.method(Upload, 'findOne', () => new Query(upload));
  await assert.rejects(service.attachNewImages([upload.secureUrl], [], itemId, customerId, reservationId, session), error => error.status === 409);
});

test('attachment uses conditional UNATTACHED ownership update in the caller transaction', async t => {
  const upload = existingUpload();
  let query, update, options;
  t.mock.method(Upload, 'findOne', filter => { assert.equal(filter.customerId, customerId); assert.equal(filter.managedReservationId, reservationId); return new Query(upload); });
  t.mock.method(Upload, 'updateOne', (...args) => { [query, update, options] = args; return new Query({ modifiedCount: 1 }); });
  await service.attachNewImages([upload.secureUrl], [], itemId, customerId, reservationId, session);
  assert.equal(query.status, 'UNATTACHED'); assert.equal(query.expiresAt.$gt instanceof Date, true);
  assert.equal(update.$set.status, 'ATTACHED'); assert.equal(update.$set.itemId, itemId); assert.equal(options.session, session);
});

test('Item image count cannot exceed ten', async () => {
  await assert.rejects(service.attachNewImages(Array(11).fill('https://legacy.example.test/image.jpg'), [], itemId, customerId, reservationId, session), error => error.status === 400);
});

test('attached uploads cannot be removed and are not sent to Cloudinary deletion', async t => {
  const upload = existingUpload({ status: 'ATTACHED', itemId });
  t.mock.method(Upload, 'findOne', () => new Query(upload));
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { throw Error('must not delete attached item evidence'); });
  await assert.rejects(service.remove(upload._id.toString(), actor), error => error.status === 409);
});

test('remove schedules unused upload cleanup no earlier than its 24-hour expiry', async t => {
  const upload = existingUpload(); let update;
  t.mock.method(Upload, 'findOne', () => new Query(upload));
  t.mock.method(Upload, 'findOneAndUpdate', (filter, value) => { assert.equal(filter.status, 'UNATTACHED'); update = value; return new Query({ ...upload, ...value.$set }); });
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { throw Error('must wait until expiry'); });
  const result = await service.remove(upload._id.toString(), actor);
  assert.equal(result.deleted, false); assert.ok(result.scheduledFor > new Date()); assert.ok(update.$set.discardRequestedAt instanceof Date);
});

test('Cloudinary deletion failure remains DELETE_PENDING with a retry time after expiry', async t => {
  const upload = existingUpload({ expiresAt: new Date(0), nextDeleteAt: new Date(0) });
  const claimed = { ...upload, status: 'DELETE_PENDING', deleteAttempts: 0 };
  let next;
  let startCount = 0;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Upload, 'find', () => { startCount++; return new Query(startCount === 1 ? [upload] : []).sort().limit().select().lean(); });
  t.mock.method(Upload, 'findOne', () => new Query(upload));
  t.mock.method(Item, 'exists', () => new Query(null));
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => {
    if (filter.status === 'UNATTACHED' || filter.status?.$in?.includes('UNATTACHED')) { assert.equal(update.$set.status, 'DELETE_PENDING'); return new Query({ ...claimed, cleanupLeaseToken: update.$set.cleanupLeaseToken }); }
    return new Query(null);
  });
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { throw Error('simulated Cloudinary failure'); });
  t.mock.method(Upload, 'updateOne', (_filter, update) => { next = update.$set; return new Query({ modifiedCount: 1 }); });
  const result = await service.cleanupExpired();
  assert.deepEqual(result, { deleted: 0 });
  assert.equal(next.deleteAttempts, 1); assert.ok(next.nextDeleteAt instanceof Date); assert.match(next.lastDeleteError, /retry/i);
});

test('expired cleanup retains an upload when an Item references its URL', async t => {
  const upload = existingUpload({ expiresAt: new Date(0) });
  let update;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Upload, 'findOne', () => new Query(upload));
  t.mock.method(Item, 'exists', () => new Query({ _id: itemId }));
  t.mock.method(Upload, 'updateOne', (_filter, value, options) => { update = value; assert.equal(options.session, session); return new Query({ modifiedCount: 1 }); });
  const claimed = await service.claimForCleanup(upload._id);
  assert.equal(claimed, null); assert.equal(update.$set.status, 'ATTACHED');
});

test('upload requires Customer role and blocks public-delivery uploads in production', async t => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  await assert.rejects(service.upload(undefined, reservationId.toString(), 'image-key-123', { _id: customerId, role: 'FACILITY_STAFF' }), error => error.status === 403);
  process.env.NODE_ENV = 'production';
  await assert.rejects(service.upload(undefined, reservationId.toString(), 'image-key-123', actor), error => error.status === 503);
  process.env.NODE_ENV = previous;
});

test('unattached upload cap blocks another Cloudinary write', async t => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async () => ({ _id: reservationId, facilityId: new mongoose.Types.ObjectId() }));
  t.mock.method(Upload, 'findOne', () => new Query(null));
  t.mock.method(Upload, 'countDocuments', () => new Query(20));
  t.mock.method(CloudinaryService, 'uploadInventoryImage', async () => { throw Error('should not upload over pending limit'); });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  await assert.rejects(service.upload({ buffer: bytes, size: bytes.length, mimetype: 'image/png' }, reservationId.toString(), 'upload-key-123', actor), error => error.status === 429);
  process.env.NODE_ENV = previous;
});

test('same idempotency key and image returns the existing upload without duplicating Cloudinary asset', async t => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  const facilityId = new mongoose.Types.ObjectId();
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async () => ({ _id: reservationId, facilityId }));
  let saved = null, cloudinaryCalls = 0, createCalls = 0;
  t.mock.method(Upload, 'findOne', () => new Query(saved));
  t.mock.method(Upload, 'countDocuments', () => new Query(0));
  t.mock.method(CloudinaryService, 'uploadInventoryImage', async (_buffer, folder, publicId) => { cloudinaryCalls++; assert.match(folder, /^wdp\/managed-inventory\//); assert.ok(publicId); return { secureUrl: 'https://res.cloudinary.com/demo/image/upload/test.jpg', publicId: `${folder}/${publicId}`, format: 'png', width: 2, height: 2 }; });
  t.mock.method(Upload, 'create', async docs => { createCalls++; saved = { ...docs[0], _id: new mongoose.Types.ObjectId() }; return [saved]; });
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => { assert.equal(filter.status, 'UPLOADING'); saved = { ...saved, ...update.$set }; return new Query(saved); });
  t.mock.method(Upload, 'updateOne', () => new Query({ modifiedCount: 1 }));
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#654321' } }).png().toBuffer();
  const file = { buffer: bytes, size: bytes.length, mimetype: 'image/png' };
  const first = await service.upload(file, reservationId.toString(), 'upload-key-unique', actor);
  const replay = await service.upload(file, reservationId.toString(), 'upload-key-unique', actor);
  assert.equal(first.uploadId.toString(), replay.uploadId.toString()); assert.equal(createCalls, 1); assert.equal(cloudinaryCalls, 1);
  process.env.NODE_ENV = previous;
});

test('concurrent attachment attempts cannot claim one upload for two Items', async t => {
  const upload = existingUpload(); let claims = 0;
  t.mock.method(Upload, 'findOne', () => new Query(upload));
  t.mock.method(Upload, 'updateOne', () => new Query({ modifiedCount: ++claims === 1 ? 1 : 0 }));
  const results = await Promise.allSettled([
    service.attachNewImages([upload.secureUrl], [], itemId, customerId, reservationId, session),
    service.attachNewImages([upload.secureUrl], [], new mongoose.Types.ObjectId(), customerId, reservationId, session),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
});

test('create persists uploaded URL and ATTACHED metadata inside the same transaction session', async t => {
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  const reservation = { _id: reservationId, facilityId: new mongoose.Types.ObjectId(), customerId, serviceType: 'MANAGED_INVENTORY',
    status: 'CHECKIN_READY', bookingFlowVersion: 3, endDate: new Date('2030-01-01T00:00:00.000Z'), inventoryVersion: 0 };
  const upload = existingUpload();
  const transaction = { withTransaction: async work => work(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => transaction);
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async (_id, _customer, _facility, usedSession) => { assert.equal(usedSession, transaction); return reservation; });
  t.mock.method(ReservationModel, 'findOneAndUpdate', (filter, update, options) => {
    assert.equal(String(filter._id), String(reservationId)); assert.equal(String(filter.customerId), String(customerId));
    assert.equal(filter.bookingFlowVersion, 3); assert.equal(filter.status, 'CHECKIN_READY'); assert.equal(options.session, transaction);
    assert.equal(update.$inc.inventoryVersion, 1); return new Query({ ...reservation, inventoryVersion: 1 });
  });
  t.mock.method(Upload, 'findOne', filter => { assert.equal(filter.secureUrl, upload.secureUrl); return { session: value => { assert.equal(value, transaction); return new Query(upload); } }; });
  t.mock.method(Upload, 'updateOne', (_filter, update, options) => { assert.equal(options.session, transaction); assert.equal(update.$set.status, 'ATTACHED'); return new Query({ modifiedCount: 1 }); });
  t.mock.method(Item.prototype, 'save', async function(options) { assert.equal(options.session, transaction); });
  const saved = await require('../dist/services/inventory-items/inventory-item.service').InventoryItemService.create({
    managedReservationId: reservationId.toString(), itemCode: 'IMAGE-01', name: 'Photo lot', category: 'DOCUMENTS', quantity: 1,
    quantityUnit: 'box', unitWeightKg: 2, unitDimensionsM: { widthM: 1, depthM: 1, heightM: 1 }, images: [upload.secureUrl],
  }, actor);
  assert.deepEqual(saved.images, [upload.secureUrl]);
});

test('item save failure aborts the mocked transaction and leaves upload unattached', async t => {
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  const reservation = { _id: reservationId, facilityId: new mongoose.Types.ObjectId(), customerId, serviceType: 'MANAGED_INVENTORY',
    status: 'CHECKIN_READY', bookingFlowVersion: 3, endDate: new Date('2030-01-01T00:00:00.000Z'), inventoryVersion: 0 };
  const upload = existingUpload(); let status = 'UNATTACHED';
  const transaction = { withTransaction: async work => { try { await work(); } catch (error) { status = 'UNATTACHED'; throw error; } }, endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => transaction);
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async () => reservation);
  t.mock.method(ReservationModel, 'findOneAndUpdate', (_filter, _update, options) => { assert.equal(options.session, transaction); return new Query({ ...reservation, inventoryVersion: 1 }); });
  t.mock.method(Upload, 'findOne', () => ({ session: value => { assert.equal(value, transaction); return new Query({ ...upload, get status(){return status;} }); } }));
  t.mock.method(Upload, 'updateOne', (_filter, update, options) => { assert.equal(options.session, transaction); status = update.$set.status; return new Query({ modifiedCount: 1 }); });
  t.mock.method(Item.prototype, 'save', async function(options) { assert.equal(options.session, transaction); throw Error('simulated item write failure'); });
  await assert.rejects(require('../dist/services/inventory-items/inventory-item.service').InventoryItemService.create({
    managedReservationId: reservationId.toString(), itemCode: 'IMAGE-ROLLBACK', name: 'Photo lot', category: 'DOCUMENTS', quantity: 1,
    quantityUnit: 'box', unitWeightKg: 2, unitDimensionsM: { widthM: 1, depthM: 1, heightM: 1 }, images: [upload.secureUrl],
  }, actor), error => error.status === 500);
  assert.equal(status, 'UNATTACHED');
});

test('Cloudinary upload failure leaves a durable placeholder for same-key retry and expiry cleanup', async t => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async () => ({ _id: reservationId, facilityId: new mongoose.Types.ObjectId() }));
  let record = null;
  t.mock.method(Upload, 'findOne', () => new Query(record));
  t.mock.method(Upload, 'countDocuments', () => new Query(0));
  t.mock.method(CloudinaryService, 'uploadInventoryImage', async () => { throw Error('provider internals must not leak'); });
  t.mock.method(Upload, 'create', async docs => { record = { ...docs[0], _id: new mongoose.Types.ObjectId() }; return [record]; });
  t.mock.method(Upload, 'updateOne', () => new Query({ modifiedCount: 1 }));
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  await assert.rejects(service.upload({ buffer: bytes, size: bytes.length, mimetype: 'image/png' }, reservationId.toString(), 'upload-key-failed', actor), error => error.status === 502 && error.message.includes('retry with the same Idempotency-Key'));
  assert.equal(record.status, 'UPLOADING');
  assert.match(record.publicId, /^wdp\/managed-inventory\//);
  assert.match(record.secureUrl, /^pending:\/\//);
  process.env.NODE_ENV = previous;
});

test('unique quota slots enforce the unattached upload limit under concurrent requests', async t => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  const reservation = { _id: reservationId, facilityId: new mongoose.Types.ObjectId() };
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async () => reservation);
  t.mock.method(Upload, 'countDocuments', () => new Query(19));
  const records = new Map(), slots = new Set(); let cloudinaryCalls = 0;
  t.mock.method(Upload, 'create', async docs => {
    const record = { ...docs[0], _id: new mongoose.Types.ObjectId() };
    if (slots.has(record.quotaSlot)) throw Object.assign(Error('duplicate quota slot'), { code: 11000 });
    slots.add(record.quotaSlot); records.set(record.idempotencyKey, record); return [record];
  });
  t.mock.method(Upload, 'findOne', filter => new Query(records.get(filter.idempotencyKey) || null));
  t.mock.method(CloudinaryService, 'uploadInventoryImage', async (_buffer, folder, publicId) => { cloudinaryCalls++; return { secureUrl: `https://res.cloudinary.com/demo/${publicId}.png`, publicId: `${folder}/${publicId}`, format: 'png', width: 2, height: 2 }; });
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => {
    const record = [...records.values()].find(row => row._id.equals(filter._id));
    if (!record || record.status !== 'UPLOADING' || record.uploadLeaseToken !== filter.uploadLeaseToken) return new Query(null);
    Object.assign(record, update.$set); record.status = update.$set.status; return new Query(record);
  });
  t.mock.method(Upload, 'updateOne', () => new Query({ modifiedCount: 1 }));
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  const request = key => service.upload({ buffer: bytes, size: bytes.length, mimetype: 'image/png' }, reservationId.toString(), key, actor);
  const results = await Promise.allSettled([request('quota-boundary-A'), request('quota-boundary-B')]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected' && row.reason.status === 429).length, 1);
  assert.equal(slots.size, 1); assert.equal(cloudinaryCalls, 1);
  process.env.NODE_ENV = previous;
});

test('two cleanup workers cannot claim or delete the same unattached asset concurrently', async t => {
  const upload = existingUpload({ expiresAt: new Date(0), nextDeleteAt: new Date(0), quotaSlot: 0 });
  let row = { ...upload }, deleteCalls = 0;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Upload, 'find', () => new Query([{ _id: row._id }]).sort().limit().select().lean());
  t.mock.method(Upload, 'findOne', filter => new Query(row.status === 'UNATTACHED' && filter._id.equals(row._id) ? row : null));
  t.mock.method(Item, 'exists', () => new Query(null));
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => {
    if (filter.status === 'UNATTACHED' || filter.status?.$in?.includes('UNATTACHED')) {
      if (row.status !== 'UNATTACHED') return new Query(null);
      row = { ...row, ...update.$set, status: 'DELETE_PENDING' }; return new Query(row);
    }
    if (filter.status === 'DELETE_PENDING' && row.status === 'DELETE_PENDING' && (!row.cleanupLeaseUntil || row.cleanupLeaseUntil <= new Date())) {
      row = { ...row, ...update.$set }; return new Query(row);
    }
    return new Query(null);
  });
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { deleteCalls++; return { result: 'ok' }; });
  t.mock.method(Upload, 'updateOne', (_filter, update) => { row = { ...row, status: update.$set.status || row.status }; return new Query({ modifiedCount: 1 }); });
  await Promise.all([service.cleanupExpired(), service.cleanupExpired()]);
  assert.equal(deleteCalls, 1); assert.equal(row.status, 'DELETED');
});

test('cleanup claim wins atomically against attachment and prevents later attach', async t => {
  const upload = existingUpload({ expiresAt: new Date(0), nextDeleteAt: new Date(0) });
  let row = { ...upload };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Upload, 'findOne', () => ({ session: () => new Query(row) }));
  t.mock.method(Item, 'exists', () => new Query(null));
  t.mock.method(Upload, 'findOneAndUpdate', (_filter, update) => { row = { ...row, ...update.$set, status: 'DELETE_PENDING' }; return new Query(row); });
  const claimed = await service.claimForCleanup(upload._id);
  assert.equal(claimed.status, 'DELETE_PENDING');
  await assert.rejects(service.attachNewImages([upload.secureUrl], [], itemId, customerId, reservationId, session), error => error.status === 409);
});

test('attached images never enter automatic cleanup selection', async t => {
  let selection;
  t.mock.method(Upload, 'find', filter => { selection = filter; return new Query([]).sort().limit().select().lean(); });
  t.mock.method(Upload, 'findOneAndUpdate', () => new Query(null));
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { assert.fail('attached asset must not be deleted'); });
  await service.cleanupExpired();
  assert.deepEqual(selection.status.$in, ['UPLOADING', 'UNATTACHED']);
});

test('Cloudinary success with Mongo update failure is recovered by same-key retry and same public ID', async t => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  const reservationGuard = require('../dist/services/reservations/managed-inventory-reservation.guard');
  t.mock.method(reservationGuard, 'requireManagedInventoryReservationForRegistration', async () => ({ _id: reservationId, facilityId: new mongoose.Types.ObjectId() }));
  let record = null, callCount = 0, assetIds = [];
  t.mock.method(Upload, 'findOne', () => new Query(record));
  t.mock.method(Upload, 'countDocuments', () => new Query(0));
  t.mock.method(Upload, 'create', async docs => { record = { ...docs[0], _id: new mongoose.Types.ObjectId() }; return [record]; });
  t.mock.method(CloudinaryService, 'uploadInventoryImage', async (_buffer, folder, publicId) => { assetIds.push(publicId); return { secureUrl: `https://res.cloudinary.com/demo/${publicId}.png`, publicId: `${folder}/${publicId}`, format: 'png', width: 2, height: 2 }; });
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => {
    if (filter.status === 'UPLOADING' && filter.uploadLeaseToken) {
      callCount++;
      if (callCount === 1) throw Error('MongoDB temporarily unavailable after Cloudinary upload');
      record = { ...record, ...update.$set }; return new Query(record);
    }
    if (filter.status === 'UPLOADING') { record = { ...record, ...update.$set }; return new Query(record); }
    return new Query(null);
  });
  t.mock.method(Upload, 'updateOne', (_filter, update) => { if (update.$unset?.uploadLeaseToken) { record.uploadLeaseToken = undefined; record.uploadLeaseUntil = undefined; } return new Query({ modifiedCount: 1 }); });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  const file = { buffer: bytes, size: bytes.length, mimetype: 'image/png' };
  await assert.rejects(service.upload(file, reservationId.toString(), 'mongo-recovery-key', actor), error => error.status === 502);
  assert.equal(record.status, 'UPLOADING'); assert.ok(record.publicId);
  record.uploadLeaseUntil = new Date(0);
  const recovered = await service.upload(file, reservationId.toString(), 'mongo-recovery-key', actor);
  assert.equal(record.status, 'UNATTACHED'); assert.equal(assetIds.length, 2); assert.equal(assetIds[0], assetIds[1]);
  assert.equal(recovered.secureUrl, record.secureUrl);
  process.env.NODE_ENV = previous;
});

test('Cloudinary deletion succeeds but Mongo status write fails; expired lease allows an idempotent retry', async t => {
  const upload = existingUpload({ expiresAt: new Date(0), nextDeleteAt: new Date(0) });
  let row = { ...upload }, deleteCalls = 0, statusWriteCalls = 0;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Upload, 'find', () => new Query(row.status === 'UNATTACHED' ? [{ _id: row._id }] : []).sort().limit().select().lean());
  t.mock.method(Upload, 'findOne', () => new Query(row.status === 'UNATTACHED' ? row : null));
  t.mock.method(Item, 'exists', () => new Query(null));
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => {
    if (filter.status === 'UNATTACHED') { row = { ...row, ...update.$set, status: 'DELETE_PENDING' }; return new Query(row); }
    if (filter.status === 'DELETE_PENDING' && row.status === 'DELETE_PENDING' && (!row.cleanupLeaseUntil || row.cleanupLeaseUntil <= new Date())) { row = { ...row, ...update.$set }; return new Query(row); }
    return new Query(null);
  });
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { deleteCalls++; return { result: deleteCalls === 1 ? 'ok' : 'not found' }; });
  t.mock.method(Upload, 'updateOne', (_filter, update) => {
    if (update.$set.status === 'DELETED' && statusWriteCalls++ === 0) throw Error('MongoDB unavailable after Cloudinary delete');
    row = { ...row, ...(update.$set || {}), ...(update.$unset?.cleanupLeaseToken ? { cleanupLeaseToken: undefined, cleanupLeaseUntil: undefined } : {}) };
    return new Query({ modifiedCount: 1 });
  });
  await service.cleanupExpired();
  assert.equal(row.status, 'DELETE_PENDING'); assert.equal(deleteCalls, 1);
  row.cleanupLeaseUntil = new Date(0);
  await service.cleanupExpired();
  assert.equal(row.status, 'DELETED'); assert.equal(deleteCalls, 2);
});

test('Cloudinary deletion failure retries after backoff and reaches DELETED on success', async t => {
  const upload = existingUpload({ expiresAt: new Date(0), nextDeleteAt: new Date(0) });
  let row = { ...upload }, deleteCalls = 0;
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Upload, 'find', () => new Query(row.status === 'UNATTACHED' ? [{ _id: row._id }] : []).sort().limit().select().lean());
  t.mock.method(Upload, 'findOne', () => new Query(row.status === 'UNATTACHED' ? row : null));
  t.mock.method(Item, 'exists', () => new Query(null));
  t.mock.method(Upload, 'findOneAndUpdate', (filter, update) => {
    if (filter.status === 'UNATTACHED') { row = { ...row, ...update.$set, status: 'DELETE_PENDING' }; return new Query(row); }
    if (filter.status === 'DELETE_PENDING' && row.status === 'DELETE_PENDING' && (!row.cleanupLeaseUntil || row.cleanupLeaseUntil <= new Date()) && row.nextDeleteAt <= new Date()) { row = { ...row, ...update.$set }; return new Query(row); }
    return new Query(null);
  });
  t.mock.method(CloudinaryService, 'deleteAsset', async () => { if (++deleteCalls === 1) throw Error('transient Cloudinary outage'); return { result: 'ok' }; });
  t.mock.method(Upload, 'updateOne', (_filter, update) => {
    row = { ...row, ...(update.$set || {}) };
    if (update.$unset?.cleanupLeaseToken) { row.cleanupLeaseToken = undefined; row.cleanupLeaseUntil = undefined; }
    return new Query({ modifiedCount: 1 });
  });
  await service.cleanupExpired();
  assert.equal(row.status, 'DELETE_PENDING'); assert.equal(row.deleteAttempts, 1); assert.equal(deleteCalls, 1);
  row.nextDeleteAt = new Date(0);
  await service.cleanupExpired();
  assert.equal(row.status, 'DELETED'); assert.equal(deleteCalls, 2);
});
