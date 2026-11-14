import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FACILITY_IMAGE_LIMIT, FACILITY_IMAGE_MAX_BYTES, cloudinaryFacilityConfig, isApprovedFacilityImageUrl,
  planFacilityImageUploads, validateFacilityImageFile,
} from '../src/lib/facilityImages.js';

const file = (name, type = 'image/png', size = 1024) => ({ name, type, size });

test('accepts JPEG, PNG and WebP images under 8 MB', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => validateFacilityImageFile(file(`ok.${type.split('/')[1]}`, type)));
});

test('rejects wrong types, empty files and files over 8 MB', () => {
  assert.throws(() => validateFacilityImageFile(undefined), /Choose an image file/);
  assert.throws(() => validateFacilityImageFile(file('scan.pdf', 'application/pdf')), /must be a JPG, PNG or WebP image/);
  assert.throws(() => validateFacilityImageFile(file('empty.png', 'image/png', 0)), /is empty/);
  assert.throws(() => validateFacilityImageFile(file('huge.png', 'image/png', FACILITY_IMAGE_MAX_BYTES + 1)), /larger than 8 MB/);
});

test('plans a batch against the 10 image gallery limit and reports each problem', () => {
  const plan = planFacilityImageUploads([file('a.png'), file('b.pdf', 'application/pdf'), file('c.jpg', 'image/jpeg')], 8);
  assert.deepEqual(plan.accepted.map((entry) => entry.name), ['a.png', 'c.jpg']);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /must be a JPG, PNG or WebP image/);
  const full = planFacilityImageUploads([file('a.png'), file('b.png')], 9);
  assert.deepEqual(full.accepted.map((entry) => entry.name), ['a.png']);
  assert.match(full.errors[0], new RegExp(`At most ${FACILITY_IMAGE_LIMIT} facility images are allowed`));
});

test('an empty selection produces no uploads and no errors', () => {
  assert.deepEqual(planFacilityImageUploads(undefined), { accepted: [], errors: [] });
  assert.deepEqual(planFacilityImageUploads([], 3), { accepted: [], errors: [] });
});

test('reads the unsigned Cloudinary preset from Vite environment variables', () => {
  assert.deepEqual(cloudinaryFacilityConfig({ VITE_CLOUDINARY_CLOUD_NAME: 'demo', VITE_CLOUDINARY_UPLOAD_PRESET: 'preset' }), { cloudName: 'demo', uploadPreset: 'preset' });
  assert.throws(() => cloudinaryFacilityConfig({}), /not configured/);
  assert.throws(() => cloudinaryFacilityConfig({ VITE_CLOUDINARY_CLOUD_NAME: 'bad name', VITE_CLOUDINARY_UPLOAD_PRESET: 'preset' }), /not configured/);
  assert.throws(() => cloudinaryFacilityConfig({ VITE_CLOUDINARY_CLOUD_NAME: 'demo' }), /not configured/);
});

test('only accepted Cloudinary delivery URLs are treated as valid facility images', () => {
  const cloud = 'demo';
  assert(isApprovedFacilityImageUrl('https://res.cloudinary.com/demo/image/upload/v1/wdp/facilities/a.png', cloud));
  for (const url of [
    'http://res.cloudinary.com/demo/image/upload/a.png',
    'https://res.cloudinary.com/other/image/upload/a.png',
    'https://evil.example.test/demo/image/upload/a.png',
    'https://user:pass@res.cloudinary.com/demo/image/upload/a.png',
    'not a url',
  ]) assert.equal(isApprovedFacilityImageUrl(url, cloud), false, url);
});

test('the facility form uploads multiple files instead of asking for URL text', () => {
  const source = readFileSync(new URL('../src/pages/bom/FacilityPage.jsx', import.meta.url), 'utf8');
  for (const expected of [
    /type="file"/, /multiple/, /accept="image\/jpeg,image\/png,image\/webp"/,
    /uploadFacilityImage/, /planFacilityImageUploads/, /Facility image gallery/, /Make cover/,
  ]) assert.match(source, expected);
});

test('the file picker copies the selection before clearing the input', () => {
  const source = readFileSync(new URL('../src/pages/bom/FacilityPage.jsx', import.meta.url), 'utf8');
  const copyIndex = source.indexOf('Array.from(event.target.files');
  const clearIndex = source.indexOf('event.target.value = ""');
  assert.ok(copyIndex > 0, 'the picker must copy the FileList');
  assert.ok(clearIndex > copyIndex, 'the input must only be cleared after the FileList was copied');
});
