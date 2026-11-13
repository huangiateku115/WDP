import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const pickerPath = fileURLToPath(new URL('../src/components/customer/inventory/InventoryImagePicker.jsx', import.meta.url));
const formPath = fileURLToPath(new URL('../src/components/customer/inventory/InventoryItemForm.jsx', import.meta.url));

test('picker accepts the readiness callback used by the registration form', async () => {
  const [picker, form] = await Promise.all([readFile(pickerPath, 'utf8'), readFile(formPath, 'utf8')]);
  assert.match(form, /onReady=\{setImagesReady\}/);
  assert.match(picker, /function InventoryImagePicker\(\{[^}]*\bonReady\s*=\s*\(\)\s*=>\s*\{\}/);
  assert.match(picker, /onReady\?\.\(inventoryImagesReady\(next\)\)/);
});

test('existing Item image URLs are attached while only completed uploads join the emitted URL list', async () => {
  const picker = await readFile(pickerPath, 'utf8');
  assert.match(picker, /value\.filter\(httpImage\)\.map\(\(secureUrl, index\).*status:\s*'attached',\s*legacy:\s*true/s);
  assert.match(picker, /next\.filter\(image=>\['attached','uploaded'\]\.includes\(image\.status\)\)/);
});

test('picker aborts active uploads during unmount and exposes per-upload cancel', async () => {
  const picker = await readFile(pickerPath, 'utf8');
  assert.match(picker, /controllers\.current\.forEach\(controller\s*=>\s*controller\.abort\(\)\)/);
  assert.match(picker, /controllers\.current\.get\(image\.id\)\?\.abort\(\)/);
});

test('session changes during upload move the row out of uploading so it can be retried', async () => {
  const picker = await readFile(pickerPath, 'utf8');
  assert.equal((picker.match(/getAccessToken\(\)\s*!==\s*token/g) || []).length, 4);
  assert.equal((picker.match(/status:\s*'cancelled',\s*error:\s*'Phiên đăng nhập đã đổi khi tải ảnh/g) || []).length, 2);
});
