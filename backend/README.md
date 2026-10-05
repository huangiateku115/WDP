# WDP backend

Express + TypeScript + Mongoose; authentication uses the existing Keycloak client.

## Local development

Run commands from `backend/`:

1. Start Docker Desktop, then `docker compose up -d keycloak`.
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
`description`, `operatingHours` (plain descriptive string), and `status` (default ACTIVE).
Code is trimmed/uppercased and protected by a unique index; status and serviceTypes
have separate indexes. Partial address/contact updates preserve sibling fields.
Provided strings must be non-empty; null/unset operations are not supported.
Unknown/immutable fields and MongoDB update operators are rejected.

List query: `page=1&limit=20&status=ACTIVE&serviceType=SELF_STORAGE&search=HCM`.
Limit is 1–100; page is 1–1000000. Search is a literal case-insensitive match on
code, name, or address.city. Without status, both ACTIVE and INACTIVE are included.
Responses use `{success:true,data:...}`; list additionally returns
`pagination: {page,limit,total,totalPages}`. Invalid input/ID returns 400,
missing records 404, duplicate codes 409. Production error messages follow
Phase 0's generic safe messages.

Deactivation only changes status: no delete/cascade or booking behavior exists here.
Future booking modules must explicitly enforce ACTIVE status. Atlas index creation
must succeed for database-level uniqueness; these isolated tests do not verify live indexes.
Run `npm run build` then `node --test tests/facility.test.cjs tests/infrastructure.test.cjs`.
Facility tests mock persistence/authentication boundaries and never connect to Atlas.
