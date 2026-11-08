import test from 'node:test';
import assert from 'node:assert/strict';
import { receivingUpload } from '../src/lib/receivingUpload.js';

const upload = { uploadId: 'a'.repeat(24), secureUrl: 'https://res.cloudinary.com/demo/image.png', publicId: 'demo/image', width: 128, height: 128, format: 'png', expiresAt: '2030-01-01T00:00:00.000Z' };
const response = value => ({ data: { success: true, data: value } });
test('receiving evidence becomes ready only with a verified unexpired image receipt', () => {
  assert.equal(receivingUpload(response(upload), Date.parse('2026-11-08')), upload);
  for (const invalid of [null, { ...upload, uploadId: undefined }, { ...upload, width: 0 }, { ...upload, secureUrl: 'http://example.com/image.png' }, { ...upload, format: 'pdf' }]) {
    assert.throws(() => receivingUpload(response(invalid), Date.parse('2026-11-08')));
  }
  assert.throws(() => receivingUpload(response(upload), Date.parse('2031-01-01')));
  assert.throws(() => receivingUpload({ data: { success: false, data: upload } }));
});
