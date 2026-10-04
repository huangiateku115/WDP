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
