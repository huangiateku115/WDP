# Managed Inventory IMAGE-04 — Receiving Inspection Evidence

## Scope and access policy

This flow stores Facility Staff photographs as evidence for Managed Inventory receiving inspection attempts. Evidence is stored in its own upload and immutable snapshot collections. It is not copied into Customer `InventoryItem.images`, Contract Proof, Avatar, or Self-Storage inspection records.

Cloudinary upload delivery is public by URL. Upload is enabled only when `NODE_ENV` is `development` or `test`; production/staging uploads return 503 until private/signed delivery is implemented. These URLs are not private storage and evidence may contain sensitive information. Do not reuse a development Cloudinary account in production.

## API

### `GET /api/v1/inventory-items/:itemId/receiving-inspection/context`

Requires authenticated `FACILITY_STAFF`. Backend filters Item, Managed V2 Reservation, allocated Cells, and evidence snapshots by the authenticated user's assigned Facility. Returns `{ item, reservation, cells, evidence }`; reservation fields are limited to ID/code/Facility/status/balance lock/allocated Cells.

### `POST /api/v1/inventory-items/:itemId/receiving-inspection/image-uploads`

Requires authenticated `FACILITY_STAFF` assigned to the Item Facility. Multipart field `file`; header `Idempotency-Key` (8–128 permitted characters). Accepts one JPEG/PNG/WebP image up to 8 MiB and 6000 px/side/24 MP, validated from decoded bytes by Sharp. Upload is scoped to the item and Facility and uses a Backend-generated folder/public ID. Each Item may have at most 20 unattached uploads; cleanup begins after 24 hours. Response: `{ success, data: { uploadId, secureUrl, publicId, width, height, format, expiresAt } }`.

### `POST /api/v1/inventory-items/:itemId/receiving-inspection`

Existing inspection fields remain supported. Optional additions:

```json
{
  "evidenceUploadIds": ["<upload ObjectId>"],
  "idempotencyKey": "<8-128 characters>"
}
```

`evidenceUploadIds` is capped at 10. Legacy requests may omit both fields. A committed idempotency key with the same canonical payload returns the current Item before checking upload attachment status; payload/Staff mismatch returns 409. The same upload cannot attach to another snapshot.

## Atomicity, state, and retention

The existing Managed Check-in MongoDB transaction validates Staff/Facility/Reservation and all inspection rules, claims each unattached evidence upload, creates an append-only snapshot, updates the current Item projection/state and audit records, then commits together. Snapshot unique indexes protect per-Item attempt numbers and idempotency keys. Prior snapshots remain available after a rejection, correction, or later receiving attempt. Customer Item APIs do not expose snapshot evidence.

Accepted inspection data cannot be overwritten. The existing pending inbound state can complete Facility custody only by resubmitting the unchanged accepted decision/measurements/cells/note with `custodyTaken: true`; this produces a separate historical snapshot. A rejected Item may be re-inspected only after the existing customer correction and inbound-request flow makes the Item eligible again. No reservation activation, warehouse counter, or capacity transition was added.

Unattached uploads are claimed atomically into `DELETE_PENDING` after expiry with a lease; attached uploads are not cleanup candidates. Cloudinary deletion failure is retried with backoff. A successful provider delete followed by Mongo failure is repeated after lease expiry. Provider calls cannot participate in a Mongo transaction, so cleanup is eventually consistent. MongoDB transaction support requires a replica set or sharded cluster; no migrations or index operations were run as part of implementation.

## Staff UI

The Managed Receiving Queue provides a facility-scoped item context, inspection form, evidence picker (preview, upload progress, cancel/retry, remove/reorder), and historical gallery. Customer images are not used as inspection evidence. Browser/Cloudinary/replica-set integration must be verified against explicitly provisioned development/test services before production use.
