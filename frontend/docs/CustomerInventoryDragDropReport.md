# Managed Inventory — Drag & Drop Images

## Files
- Modified source: `src/components/customer/inventory/InventoryImagePicker.jsx` only.
- Added fixture browser runner `.design-reference/check-inventory-drag-drop.cjs` and this report. Screenshots `.design-reference/inventory-drag-{320,390,768,1024,1440,1920}.png`.

## Implementation
Native file input is retained. Both choose(event) and drop(event) call handleFilesSelected(files), which contains the existing normalization, count limit, file validation, fingerprint deduplication, preview/queue and upload invocation. upload/remove/move/commit functions are unchanged. Dropzone is local to the upload control, not page-wide. Standard enter/over/leave/drop events prevent navigation; stopPropagation avoids overlapping ancestor handling. A drag depth ref prevents nested enter/leave flicker. Supported image MIME drag activates green border/background and text 'Drop images to upload'; drop/leave clears it. Disabled/missing reservation/full states do not start extra uploads. Input focus remains keyboard accessible, dropzone has focus-within ring and status text for screen readers; no animation added.

## Contract and validation
API client, FormData file/managedReservationId, Idempotency-Key, retry/cancel/progress, auth/quota and upload metadata validation are untouched. Existing 10 image / 8 MiB / JPEG PNG WebP checks remain; dimensions <=6000 per side and <=24MP are checked by existing createImageBitmap/helper flow. Backend remains authoritative for content/single-frame validation. Uploaded images remain UNATTACHED until existing Item create/Save succeeds. No direct Cloudinary request and no synthesized secure URLs.
Mixed invalid/valid drops pass through the original per-file validation and queue rules; accepted files upload and rejected files show existing notice. Existing slice-to-available-slot policy and fingerprint duplicate protection are preserved; no upload business-rule redesign.

## Verification
- Syntax parse 219 JS/JSX sources PASS.
- Production build PASS, existing >500 kB chunk warning remains.
- npm test 6/6 PASS (readiness, attached/uploaded URL emission, abort/cancel/session guard, file/dimension boundaries, metadata validation).
- New drag/drop browser fixtures PASS: single, multiple, repeated additions, mixed valid/invalid, duplicate suppression, nested drag state, no browser navigation, 10-image cap, quota/network retry same key, Register attach, Edit existing-image preservation, remove/discard/reorder/Save, Choose Files, persisted refresh, auth expiry. 73 intercepted fixture requests; no live requests.
- Existing IMAGE-01–IMAGE-03 Choose Files regression PASS: 66 intercepted fixture requests, 0 live requests. First concurrent run timed out at session-expiry redirect; isolated rerun PASS without code changes.
- Responsive PASS: 320/390/768/1024/1440/1920 px, no horizontal document overflow. Native file selection remains available for mobile/touch.

## Limitations and scope
Drag tests dispatch browser DataTransfer/File drag events; physical OS drag gestures were not manually exercised. No live Backend mutations were performed; create/PATCH/discard/upload requests were all intercepted by fixtures. Single-frame image contents remain Backend-validated as before. No Backend/BE-REF access, no API/auth/routes/dependencies/business changes, no other role UI changes.
