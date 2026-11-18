import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('BOM mappers keep facility and unit photography and flag Managed reservations',()=>{
  const mapper=read('../src/lib/bomMappers.js');
  assert.match(mapper,/export function httpImages\(value\)/);
  assert.match(mapper,/value\.filter\(\(url\) => typeof url === "string" && \/\^https\?:\\\/\\\/\/i\.test\(url\)\)/);
  const unit=mapper.slice(mapper.indexOf('export function unitFromDto'),mapper.indexOf('export function inventoryItemFromDto'));
  assert.match(unit,/const images = httpImages\(d\?\.images\)/);
  assert.match(unit,/images,/);
  assert.match(unit,/coverImage: images\[0\] \|\| ""/);
  const facility=mapper.slice(mapper.indexOf('export function facilityFromDto'),mapper.indexOf('export function facilityForm'));
  assert.match(facility,/images: httpImages\(d\?\.images\)/);
  assert.match(facility,/coverImage: httpImages\(d\?\.images\)\[0\] \|\| ""/);
  assert.match(mapper,/isManaged: d\?\.serviceType === "MANAGED_INVENTORY"/);
});

test('BOM reservation reads request both service scopes for one facility and never swallow a failure',()=>{
  const data=read('../src/lib/bomApiData.js');
  assert.match(data,/const RESERVATION_SERVICE_TYPES = \["SELF_STORAGE", "MANAGED_INVENTORY"\]/);
  assert.match(data,/\{ signal, params: \{ serviceType \} \}/);
  assert.match(data,/export async function loadFacilityReservationsAll/);
  // The scopes are read one after another (no cross-facility fan-out) and a failure is surfaced.
  assert.match(data,/const failedServiceTypes = \[\]/);
  assert.match(data,/failedServiceTypes\.push\(serviceType\)/);
  assert.doesNotMatch(data,/\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(data,/export async function loadReservations\(/);
});

test('Oversight, unit register and facility console render saved photography',()=>{
  const oversight=read('../src/pages/bom/OversightLivePage.jsx');
  assert.match(oversight,/import \{ ResourceThumb \} from "@\/components\/bom\/ResourceImages"/);
  assert.match(oversight,/label: "Photo", render: \(f\) => <ResourceThumb src=\{f\.coverImage\}/);
  assert.match(oversight,/label: "Photo", render: \(r\) => <ResourceThumb src=\{r\.coverImage\}/);
  assert.match(oversight,/loadFacilityReservationsAll/);
  assert.match(oversight,/reservations\.failedServiceTypes\.length > 0/);
  assert.match(read('../src/pages/shared/StorageUnitsPage.jsx'),/label: "Photo", render: \(r\) => <ResourceThumb src=\{r\.coverImage\}/);
  assert.match(read('../src/pages/bom/FacilityPage.jsx'),/<ResourceGallery images=\{facility\.images\}/);
});

test('Oversight and rental report route Managed reservations to the Managed detail page',()=>{
  const oversight=read('../src/pages/bom/OversightLivePage.jsx');
  assert.match(oversight,/reservationsBase = "\/bom\/reservations"/);
  assert.match(oversight,/to=\{`\$\{reservationsBase\}\/\$\{r\.isManaged \? "managed\/" : ""\}\$\{r\.id\}`\}/);
  const report=read('../src/pages/bom/RentalReportLivePage.jsx');
  assert.match(report,/to=\{`\$\{basePath\}\/reservations\/\$\{r\.isManaged \? "managed\/" : ""\}\$\{r\.id\}`\}/);
  assert.match(read('../src/routes/AdminRoutes.jsx'),/reservationsBase="\/admin\/reservations"/);
});

test('Customers see unit photography on the public facility page and in the booking step',()=>{
  const catalog=read('../src/components/customer/PublicFacilityCatalog.jsx');
  assert.match(catalog,/\{o\.imageUrl\?<PublicImage className="vs-option-image" src=\{o\.imageUrl\}/);
  const booking=read('../src/components/customer/RentalBookingIntegration.jsx');
  assert.match(booking,/const httpImage=value=>typeof value==='string'/);
  assert.match(booking,/\{httpImage\(u\.images\?\.\[0\]\)&&<img src=\{u\.images\[0\]\}/);
});

test('Admin account creation assigns the selected Facility in the same flow',()=>{
  const page=read('../src/pages/admin/UsersLivePage.jsx');
  assert.match(page,/const needsFacility = \["FACILITY_MANAGER", "FACILITY_STAFF"\]\.includes\(role\)/);
  assert.match(page,/await assignAdminUserFacility\(createdId, facilityId\)/);
  // The failure path is Vietnamese and links straight to the account page, not to an instruction.
  assert.match(page,/Hãy mở trang tài khoản để gán cơ sở\./);
  assert.match(page,/to=\{`\/admin\/users\/\$\{unassignedId\}`\}/);
  const lib=read('../src/lib/adminUsers.js');
  assert.match(lib,/return userIdFromResponse\(response\)/);
});
