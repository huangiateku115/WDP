import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FACILITY_IMAGE_DRAFT_PREFIX, FACILITY_IMAGE_LIMIT, FACILITY_IMAGE_MAX_BYTES, cloudinaryFacilityConfig, facilityDraftKey,
  isApprovedFacilityImageUrl, mergeFacilityImages, planFacilityImageUploads, readFacilityImageDraft, validateFacilityImageFile,
  writeFacilityImageDraft,
} from '../src/lib/facilityImages.js';

const file = (name, type = 'image/png', size = 1024) => ({ name, type, size });

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

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

test('the facility detail page shows the saved images instead of hiding them', () => {
  const source = readFileSync(new URL('../src/pages/bom/FacilityPage.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes('facility.images?.length || 0'), 'the detail panel must count the saved images');
  assert.ok(source.includes('Manage images'), 'the detail panel must link back to the image editor');
  assert.ok(source.includes('Open facility image'), 'each detail image must open the full asset');
});

test('unsaved uploads survive a reload through session storage', () => {
  const storage = memoryStorage();
  const key = facilityDraftKey('64b7f0c2a1d3e4f5a6b7c8d9');
  assert.deepEqual(readFacilityImageDraft(key, storage), []);
  writeFacilityImageDraft(key, ['https://res.cloudinary.com/demo/image/upload/a.png', 'https://res.cloudinary.com/demo/image/upload/a.png'], storage);
  assert.deepEqual(readFacilityImageDraft(key, storage), ['https://res.cloudinary.com/demo/image/upload/a.png']);
  writeFacilityImageDraft(key, [], storage);
  assert.deepEqual(readFacilityImageDraft(key, storage), []);
});

test('draft keys are scoped per facility and for the create form', () => {
  assert.equal(facilityDraftKey('64b7f0c2a1d3e4f5a6b7c8d9'), `${FACILITY_IMAGE_DRAFT_PREFIX}64b7f0c2a1d3e4f5a6b7c8d9`);
  assert.equal(facilityDraftKey(undefined), `${FACILITY_IMAGE_DRAFT_PREFIX}new`);
});

test('a corrupt or hostile draft payload never breaks the form', () => {
  const storage = memoryStorage();
  storage.setItem('k', '{not json');
  assert.deepEqual(readFacilityImageDraft('k', storage), []);
  storage.setItem('k', JSON.stringify([42, '', ' https://images.example.test/a.png ']));
  assert.deepEqual(readFacilityImageDraft('k', storage), ['https://images.example.test/a.png']);
});

test('merging keeps server order then unsaved uploads, without duplicates', () => {
  assert.deepEqual(mergeFacilityImages(['https://a.test/1.png'], ['https://a.test/1.png', 'https://a.test/2.png', ' ']), ['https://a.test/1.png', 'https://a.test/2.png']);
  assert.equal(mergeFacilityImages(Array.from({ length: 12 }, (_, index) => `https://a.test/${index}.png`)).length, FACILITY_IMAGE_LIMIT);
});

test('the form reports per-file upload progress and clears the draft after saving', () => {
  const source = readFileSync(new URL('../src/pages/bom/FacilityPage.jsx', import.meta.url), 'utf8');
  assert.match(source, /onProgress:/);
  assert.match(source, /aria-label="Facility image upload progress"/);
  assert.match(source, /writeFacilityImageDraft\(draftKey, \[\]\)/);
  assert.match(source, /readFacilityImageDraft\(draftKey\)/);
});
