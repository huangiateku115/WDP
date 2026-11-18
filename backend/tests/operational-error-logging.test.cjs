const { test } = require('node:test');
const assert = require('node:assert/strict');
const { logOperationalFailure } = require('../dist/services/operations/operational-error.logger');
const { EmailService } = require('../dist/services/email/email.service');
const cloudinary = require('../dist/config/cloudinary.config').default;

test('operational logger emits bounded structured fields without raw error message or arbitrary entity id', t => {
  let line; t.mock.method(console, 'error', value => { line = value; });
  logOperationalFailure({ operation: 'email.send', stage: 'provider_request', provider: 'gmail', error: Object.assign(new Error('OTP 123456 to private@example.com'), { code: 'ETIMEDOUT' }), entityId: 'private@example.com' });
  const row = JSON.parse(line);
  assert.equal(row.event, 'OPERATIONAL_FAILURE'); assert.equal(row.errorCategory, 'TIMEOUT'); assert.equal(row.retryable, true);
  assert.equal(Object.hasOwn(row, 'entityId'), false); assert.equal(line.includes('123456'), false); assert.equal(line.includes('private@example.com'), false);
  assert.ok(row.correlationId);
});
test('Email provider failure keeps false semantics and logs no recipient, body, subject or provider message', async t => {
  process.env.GMAIL_USER = 'mailer@example.test'; process.env.GMAIL_APP_PASSWORD = 'secret-app-password';
  t.after(() => { delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD; });
  t.mock.method(EmailService, 'getTransporter', () => ({ sendMail: async () => { throw Object.assign(new Error('OTP BODY PRIVATE RECIPIENT'), { code: 'EAUTH' }); } }));
  let line; t.mock.method(console, 'error', value => { line = value; });
  const result = await EmailService.safeSendMail('customer@gmail.com', 'private subject', '<p>OTP 765432</p>');
  assert.equal(result, false); assert.equal(line.includes('customer@gmail.com'), false); assert.equal(line.includes('private subject'), false); assert.equal(line.includes('765432'), false);
  assert.equal(JSON.parse(line).errorCategory, 'PROVIDER_AUTH');
});
test('Email success does not log failure and invalid recipient is safely classified', async t => {
  process.env.GMAIL_USER = 'mailer@example.test'; process.env.GMAIL_APP_PASSWORD = 'secret-app-password';
  t.after(() => { delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD; });
  t.mock.method(EmailService, 'getTransporter', () => ({ sendMail: async () => ({ messageId: 'safe-id' }) }));
  let lines = []; t.mock.method(console, 'error', value => lines.push(value));
  assert.equal(await EmailService.safeSendMail('customer@gmail.com', 'subject', 'body'), true); assert.equal(lines.length, 0);
  assert.equal(await EmailService.safeSendMail('private@example.test', 'subject', 'body'), false);
  assert.equal(JSON.parse(lines[0]).errorCategory, 'INPUT_VALIDATION'); assert.equal(lines[0].includes('private@example.test'), false);
});

test('inline email render and OTP template failures log safely and preserve the original throw', async t => {
  const original = new Error('OTP_TEST_123456 private-person@example.test SECRET_TEST_TOKEN');
  t.mock.method(EmailService, 'resolveReservationEmailContext', async () => ({
    toEmail: 'private-person@example.test',
    get reservationCode() { throw original; },
  }));
  let line; t.mock.method(console, 'error', value => { line = value; });
  await assert.rejects(EmailService.sendReservationCreatedEmail({ estimatedRent: 100 }), error => error === original);
  let event = JSON.parse(line); assert.equal(event.stage, 'template_render');
  assert.equal(event.operation, 'email.sendReservationCreatedEmail'); assert.equal(line.includes('OTP_TEST_123456'), false);
  assert.equal(line.includes('private-person@example.test'), false); assert.equal(line.includes('SECRET_TEST_TOKEN'), false);
  const otpError = new Error('OTP_TEST_123456 private-person@example.test');
  const badOtp = { toString() { throw otpError; } };
  await assert.rejects(EmailService.sendOtpEmail('private-person@example.test', badOtp), error => error === otpError);
  event = JSON.parse(line); assert.equal(event.stage, 'template_render'); assert.equal(line.includes('private-person@example.test'), false);
});

test('OTP provider rejection logs sanitized fields and preserves public throw behavior', async t => {
  t.mock.method(EmailService, 'getTransporter', () => ({ sendMail: async () => { throw Object.assign(new Error('OTP_TEST_123456 private-person@example.test'), { code: 'EAUTH', cause: { token: 'SECRET_TEST_TOKEN' } }); } }));
  let line; t.mock.method(console, 'error', value => { line = value; });
  await assert.rejects(EmailService.sendOtpEmail('private-person@example.test', 'OTP_TEST_123456'), /không thể gửi email/i);
  assert.equal(line.includes('OTP_TEST_123456'), false); assert.equal(line.includes('private-person@example.test'), false); assert.equal(line.includes('SECRET_TEST_TOKEN'), false);
  assert.equal(JSON.parse(line).errorCategory, 'PROVIDER_AUTH');
});
test('Cloudinary request rejection logs safe metadata and preserves rejection semantics', async t => {
  t.mock.method(cloudinary.uploader, 'upload_stream', (_options, callback) => { queueMicrotask(() => callback(Object.assign(new Error('secret provider response'), { http_code: 503 }))); return { end() {} }; });
  let line; t.mock.method(console, 'error', value => { line = value; });
  await assert.rejects(require('../dist/services/upload/cloudinary.service').CloudinaryService.uploadBuffer(Buffer.from('offline')));
  const event = JSON.parse(line); assert.equal(event.operation, 'upload.buffer'); assert.equal(event.errorCategory, 'PROVIDER_REJECTION'); assert.equal(line.includes('secret provider response'), false);
});

test('Cloudinary timeout and cleanup failures are logged without provider payloads', async t => {
  let lines = []; t.mock.method(console, 'error', value => lines.push(value));
  t.mock.method(cloudinary.uploader, 'upload_stream', (_options, callback) => { queueMicrotask(() => callback(Object.assign(new Error('signed https://secret.example/?token=SECRET_TEST_TOKEN'), { code: 'ETIMEDOUT', response: { authorization: 'SECRET_TEST_TOKEN' } }))); return { end() {} }; });
  await assert.rejects(require('../dist/services/upload/cloudinary.service').CloudinaryService.uploadInventoryImage(Buffer.from('offline'), 'folder', 'public-id'));
  assert.equal(JSON.parse(lines[0]).errorCategory, 'TIMEOUT');
  assert.equal(lines[0].includes('SECRET_TEST_TOKEN'), false); assert.equal(lines[0].includes('https://secret.example'), false);
  t.mock.method(cloudinary.uploader, 'destroy', async () => { throw Object.assign(new Error('signed URL SECRET_TEST_TOKEN'), { code: 'ECONNRESET', cause: { token: 'SECRET_TEST_TOKEN' } }); });
  await assert.rejects(require('../dist/services/upload/cloudinary.service').CloudinaryService.deleteAsset('private/public-id'));
  assert.equal(JSON.parse(lines[1]).stage, 'cloudinary_delete'); assert.equal(lines[1].includes('SECRET_TEST_TOKEN'), false);
});

