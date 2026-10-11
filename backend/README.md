# WDP backend

Express + TypeScript + Mongoose; authentication uses the existing Keycloak client.

## Local development

Run commands from `backend/`:

1. Use an existing reachable Keycloak instance, or optionally start local Keycloak with `docker compose up -d keycloak`.
2. Each developer must create their own `backend/.env` from `.env.example` and
   set the shared MongoDB Atlas development URI supplied by the team:
   `MONGO_URL=<shared-mongodb-atlas-development-uri>`.
   Replace the placeholder before startup. Never commit `.env`, the URI, or credentials.
   The backend reads its MongoDB connection exclusively from `MONGO_URL`, with no fallback.
3. Configure the existing Keycloak realm `wdp-realm` and confidential client
   `wdp-backend` at `http://localhost:8081`. Set its development client secret
   in your local environment. Preserve the existing service-account permissions
   and login/direct-access-grant configuration. Compose does not provision the realm/client.
4. Run `npm ci`, then `npm run dev`.
   For compiled startup: `npm run build`, then `npm start`.

Environment validation runs before MongoDB connection, Keycloak admin authentication,
and HTTP listening, in that order. Missing/invalid configuration or failed initialization
exits nonzero. `PORT` defaults to 3000; issuer/JWKS default to the configured Keycloak
base URL and realm. Explicit issuer/JWKS settings remain supported.
SIGINT/SIGTERM drain HTTP requests before disconnecting MongoDB; shutdown has a 15-second limit.

## Health and verification

`GET http://localhost:3000/api/v1/health` returns 200 when MongoDB is connected:

```json
{"success":true,"service":"wdp-backend","database":"connected"}
```

It returns 503 with `success:false` and `database:"disconnected"` when MongoDB is unavailable.
Run `npm run build` and `node --test tests/infrastructure.test.cjs`.
Tests simulate dependencies and readiness; they do not prove a live MongoDB/Keycloak connection.

## MongoDB Compass

- Open Compass and add a connection using the same shared Atlas development URI
  configured as `MONGO_URL` in your `backend/.env`.
- Connect and select the development database specified by that URI (for example `wdp`).
- MongoDB may not physically create/show a database until the first collection/document
  is written. Leave creation to future Mongoose models; do not create dummy collections.
- If access fails, confirm your team's Atlas network access and database-user permissions.

Development uses the shared MongoDB Atlas cluster. No local MongoDB service is required
or provided by Compose. Compose retains only the existing Keycloak service and volume.

## Frontend demo data

`npm run seed:fe -- --dry-run` previews a non-destructive demo seed. A write run
requires `FE_SEED_CONFIRM=YES`, a development-mode process, and the database name
`wdp`; set existing account emails as documented in [FE_DEMO_SEED.md](docs/FE_DEMO_SEED.md).
The script creates only missing `FE-DEMO` records and never resets or deletes data.
Review the guide's lifecycle omissions and effective-date behavior before running it.

## Facility API (BE-02)

All `/api/v1/facilities` endpoints require existing Keycloak authentication.
Reads allow authenticated users; writes require `ADMIN` or `BOM`.
Facility-scope enforcement is not implemented; reads include all facilities,
including INACTIVE records. FACILITY_MANAGER has no write access in this phase.

| Method | Path | Action |
| --- | --- | --- |
| POST | `/api/v1/facilities` | Create (201) |
| GET | `/api/v1/facilities` | List with pagination |
| GET | `/api/v1/facilities/:id` | Read one |
| PATCH | `/api/v1/facilities/:id` | Update allowed fields |
| PATCH | `/api/v1/facilities/:id/status` | Set ACTIVE/INACTIVE |

Example create body:

```json
{
  "code": "HCM-01",
  "name": "Ho Chi Minh Facility",
  "address": { "line1": "1 Example Street", "city": "Ho Chi Minh City", "country": "VN" },
  "serviceTypes": ["SELF_STORAGE", "MANAGED_INVENTORY"]
}
```

Optional fields: `address.ward`, `address.district`, `contact.phone`, `contact.email`,
`description`, `operatingHours` (plain descriptive string), `images` (up to 10 HTTP(S)
URL references, max 2048 characters each), and `status` (default ACTIVE).
Code is trimmed/uppercased and protected by a unique index; status and serviceTypes
have separate indexes. Partial address/contact updates preserve sibling fields.
Provided strings must be non-empty; null/unset operations are not supported.
Unknown/immutable fields and MongoDB update operators are rejected.

List query: `page=1&limit=20&status=ACTIVE&serviceType=SELF_STORAGE&search=HCM`.
Limit is 1–100; page is 1–1000000. Search is a literal case-insensitive match on
code, name, or address.city. Without status, both ACTIVE and INACTIVE are included.
Deleted rows are hidden from normal list/detail reads. ADMIN/BOM may request
`includeDeleted=true`; `DELETE /api/v1/facilities/:id` soft-deletes and
`POST /api/v1/facilities/:id/restore` restores. Neither operation cascades, and
the unique code remains reserved while deleted.
Responses use `{success:true,data:...}`; list additionally returns
`pagination: {page,limit,total,totalPages}`. Invalid input/ID returns 400,
missing records 404, duplicate codes 409. Production error messages follow
Phase 0's generic safe messages.

Deactivation only changes status; soft deletion records `deletedAt` and `deletedBy` without cascading.
Future booking modules must explicitly enforce ACTIVE status. Atlas index creation
must succeed for database-level uniqueness; these isolated tests do not verify live indexes.
Run `npm run build` then `node --test tests/facility.test.cjs tests/infrastructure.test.cjs`.
Facility tests mock persistence/authentication boundaries and never connect to Atlas.

## Storage Unit API (BE-03)

All endpoints require a Keycloak bearer token and an active backend user.
No inventory items, pricing, reservation/rental flows or physical DELETE are implemented.

| Method | Path |
| --- | --- |
| POST / GET | `/api/v1/facilities/:facilityId/storage-units` |
| GET / PATCH / DELETE | `/api/v1/storage-units/:id` |
| PATCH | `/api/v1/storage-units/:id/status` |
| POST | `/api/v1/storage-units/:id/restore` |

Create example:

```json
{
  "unitCode": "A-01",
  "size": "SMALL",
  "dimensions": { "lengthM": 2, "widthM": 3, "heightM": 4 }
}
```

The parent must exist, be ACTIVE, and support SELF_STORAGE. Code is trimmed and
uppercased, with a unique compound index on `{facilityId:1,unitCode:1}`; the same code
is allowed in another facility. A second index covers `facilityId,status,size`.
Dimensions are finite positive meters; their product must be finite and positive.
The server derives `volumeM3` (24 above). Client-supplied volume or facility reassignment
is rejected. Updating dimensions requires all three values, to keep volume consistent.
Optional description is a non-empty string (max 2000 characters).
Optional `images` accepts up to 10 HTTP(S) URL references (max 2048 characters each);
it does not upload or store image data.

List query: `page=1&limit=20&status=AVAILABLE&size=SMALL&search=A-01`.
Limit is 1–100, page 1–1000000. Search matches literal unitCode text, case-insensitively.
List responses have `data` and `pagination: {page,limit,total,totalPages}`.

### Status and authorization

- Create defaults to AVAILABLE; AVAILABLE, MAINTENANCE, INACTIVE are the only
  administrative create/status values. Status changes use the dedicated status endpoint.
- HELD/OCCUPIED are reserved for future lifecycle modules. All resource edits and
  status changes on a HELD/OCCUPIED unit return 409, even for ADMIN.
- Resource edits and transitions to AVAILABLE require an ACTIVE SELF_STORAGE parent.
  MAINTENANCE/INACTIVE remain permitted under an inactive parent.
- ADMIN/BOM manage all facilities. FACILITY_MANAGER manages only its persisted
  `assignedFacilityId`; missing/different assignments return 403.
- FACILITY_STAFF reads only its assigned facility and cannot write.
  CUSTOMER/ADMIN/BOM may read across facilities, including all statuses. These reads
  are resource catalog endpoints, not a promise of booking availability.
- Facility API authorization is unchanged. General/multi-facility assignment management
  remains BE-17 work; assignments must come from a trusted administrative process.
- Optimistic document version checks reject simultaneous stale writes with 409.
  Future lifecycle writers must also honor version checks/atomic state predicates.
  Parent eligibility is checked before writes, not locked across collections; future
  booking flows need transactional coordination with concurrent Facility changes.

## Testing with Postman

Set a Postman environment variable `baseUrl` to `http://localhost:3000/api/v1`
(or your staging API URL). Check `GET {{baseUrl}}/health`.
For Facility and Storage Unit requests, select Authorization > Bearer Token and
enter your Keycloak access token. Use Body > raw > JSON for POST/PATCH requests
with the examples above. Keep tokens in local Postman variables; do not commit them.

## Staging deployment (Node hosting, e.g. Railway)

Docker is optional for local Keycloak and is not required for backend deployment.
Use Node.js 22.12+ with the backend as the hosting service's root directory:

```sh
npm ci
npm run build
npm start
```

Install devDependencies during the build (TypeScript is needed);
do not use `npm ci --omit=dev` before building. The start command runs `dist/server.js`.

Configure these values in the hosting environment, never in committed files:

| Variable | Requirement |
| --- | --- |
| NODE_ENV | Set `production` for staging/production |
| PORT | Provider-supplied listening port; defaults to 3000 |
| MONGO_URL | Required shared Atlas **development/staging** URI including the agreed database name |
| KEYCLOAK_BASE_URL | Required reachable Keycloak HTTP(S) base URL; use HTTPS on staging |
| KEYCLOAK_CLIENT_SECRET | Required secret of the existing confidential client |
| KEYCLOAK_REALM | Defaults to `wdp-realm`; match the existing realm |
| KEYCLOAK_CLIENT_ID | Defaults to `wdp-backend`; match the existing client |
| KEYCLOAK_ISSUER | Optional override; must exactly match token issuer |
| KEYCLOAK_JWKS_URI | Optional override for the reachable signing-key endpoint |
| CORS_ORIGINS | Comma-separated exact frontend origins; no paths, credentials, wildcard or trailing slash |

Development defaults allow `http://localhost:5173` and `http://127.0.0.1:5173`
when CORS_ORIGINS is unset. Production/test default to an empty origin allowlist.
Set your actual staging frontend origin via hosting settings; localhost may be
included explicitly if needed. Requests without Origin (Postman/server clients)
still work. Disallowed browser origins receive no CORS permission headers; CORS
does not replace authentication. Bearer auth uses Authorization, not cookie credentials.

Before release:
1. Configure Keycloak's existing client/service-account permissions and valid token issuer.
   Keycloak must be reachable from the deployment; localhost values are only local examples.
2. Configure Atlas network access for hosting egress and least-privilege database access.
   Confirm Facility and StorageUnit indexes are created successfully before accepting writes;
   no destructive index synchronization or database reset is part of this change.
3. Configure frontend CORS origins and hosting health check `/api/v1/health`.
   HTTP starts only after Atlas connection and Keycloak admin initialization succeed.
4. Verify real login, health and resource permissions in staging using Postman. Mocked tests
   do not establish live Keycloak/Atlas availability or database index enforcement.

Run all isolated regression tests after building:

```sh
node --test tests/facility.test.cjs tests/infrastructure.test.cjs tests/storage-unit.test.cjs tests/cors.test.cjs
```

Tests never connect to shared Atlas or reset data.

## Pricing & Policy API (BE-15)

Facility-scoped, effective-dated pricing rules and opaque policy configuration are
available under `/api/v1/pricing-rules` and `/api/v1/policies`. BOM/ADMIN can write;
authenticated users can read. No Swagger or pricing/payment calculations are added.
See [Postman requests and effective-date rules](docs/phase-3-postman.md) for exact
bodies, query parameters, status codes, versioning and remaining SRS decisions.

Writes require Atlas multi-document transactions. A shared scope document serializes
overlap checks; there is no unsafe nontransactional fallback. Already-effective
content is immutable, with prospective end-date closure supported for replacement.

Run `npm run build`, then:

```sh
node --test tests/pricing-policy.test.cjs tests/facility.test.cjs tests/storage-unit.test.cjs tests/infrastructure.test.cjs tests/cors.test.cjs
```

## Maintenance Ticket API (BE-12)

Facility-scoped maintenance tickets use `/api/v1/maintenance-tickets`. Tickets
follow `OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED`; resolving requires a
note, and lifecycle timestamps are server-managed. Deletes are soft deletes and
are limited to OPEN tickets. Ticket operations never mutate StorageUnit status.
See [Phase 5 Postman requests](docs/phase-5-maintenance-postman.md) for request
bodies, roles, scope rules, and the transition matrix.

# Support API (Phase 6)

Support endpoints are mounted at `/api/v1/support-requests` and require a Keycloak bearer token. Request examples, roles, lifecycle rules, and Postman checks are in [`docs/phase-6-support-postman.md`](docs/phase-6-support-postman.md). Customer ownership is derived from the authenticated user; internal messages are never returned to customers. Manual escalation targets an active Facility Manager assigned to the ticket facility. No SLA duration or automated SLA job is configured.
