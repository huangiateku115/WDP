# PayOS Local Frontend + Render Backend Development

This guide connects the local Vite Customer Frontend to a separately approved Render staging Backend through an HTTPS tunnel. The tunnel serves the local development server; it does not deploy the Frontend.

## Safety gate

The reported Render service runs with `NODE_ENV=production` and uses MongoDB Atlas. Its isolation from production data and payment credentials has not been verified in this task. Treat `https://wdp-m4ns.onrender.com` as production until an operator confirms a separate staging service, database, Keycloak configuration and PayOS sandbox credentials. Do not add tunnel origins to a shared production service and do not set `PAYOS_ENABLED=true` there.

The Backend sample keeps `PAYOS_ENABLED=false`. A PayOS checkout request can create a real provider payment link. Keep the gate off until an isolated staging service and test reservation are confirmed and real-payment testing is separately approved. No payment is created by these setup instructions.

## Prerequisites

- Node.js and npm compatible with the repository.
- The WDP repository checked out locally.
- `cloudflared` installed. On this machine it was already available as version `2026.9.3`; no software was installed for this task. If it is missing on another Windows computer, install it from Cloudflare's official instructions, then open a new PowerShell window.
- An isolated Render staging Backend before enabling PayOS.
- A temporary Cloudflare Quick Tunnel is acceptable for short development sessions. It creates a public HTTPS address to the local app, so do not display private/customer data while it is active.

## Local Frontend environment

Create or update `frontend/.env.local` yourself; do not replace an existing file. Use:

```dotenv
VITE_USE_MOCK=false
VITE_API_BASE_URL=https://<approved-staging-api-host>/api/v1
```

For the currently reported API host, the URL would be `https://wdp-m4ns.onrender.com/api/v1`, but use it only after confirming that this is an isolated staging service. Keep `VITE_API_BASE_URL` on the local Vite machine. Never put `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, database URLs or other server credentials in any `VITE_*` variable.

No code reference to `VITE_ENABLE_PAYOS_CHECKOUT` was found. It is not the PayOS availability switch. The Backend's `PAYOS_ENABLED` controls checkout availability.

## Start the local Frontend and HTTPS tunnel

Open two PowerShell terminals from the repository.

### Terminal A — Vite

```powershell
Set-Location .\frontend
npm run dev
```

Vite is bound to `localhost:5173`; it exits with an error if that port is occupied instead of silently choosing another port. Keep this terminal running.

### Terminal B — Quick Tunnel

```powershell
cloudflared tunnel --url http://localhost:5173
```

Copy the actual `https://….trycloudflare.com` URL printed by `cloudflared`. Do not use a sample or hardcode an old generated hostname. The address exists only while this tunnel process runs and can change after restart.

Vite rejects unknown Host headers by default. Before testing through the tunnel, stop Terminal A with `Ctrl+C`, set the one exact hostname (no scheme, port, path, wildcard or trailing slash), then restart Vite:

```powershell
$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = '<actual-hostname-from-cloudflared>'
Set-Location .\frontend
npm run dev
```

This uses Vite's documented additional-host allowlist; Vite remains bound to `localhost`, and `server.allowedHosts` is never set to `true`. For another tunnel hostname, replace the value and restart Vite. If Vite rejects the hostname, check that the value is exactly the hostname from the current tunnel and that no wildcard was used.

The React app uses `BrowserRouter` and Vite's SPA fallback. Test a direct visit to:

```text
https://<actual-hostname-from-cloudflared>/portal/payments/<24-character-reservation-id>
```

Sign in again on the tunnel origin. Browser local/session storage is origin-scoped, so a session created on `http://localhost:5173` does not automatically carry over to the HTTPS tunnel origin.

## Render staging environment

Configure these values only on the **isolated staging Backend** after confirming its data and provider account are non-production. Do not edit Render settings as part of this code task.

| Variable | Staging value / rule | Secret? |
|---|---|---|
| `NODE_ENV` | Keep `production`; the Backend must enforce HTTPS | No |
| `PAYOS_CUSTOMER_ORIGIN` | `https://<actual-tunnel-hostname>` — origin only, with no path, query, fragment or trailing slash | No |
| `PAYOS_WEBHOOK_URL` | `https://<staging-api-host>/api/v1/payments/payos/webhook` | No |
| `CORS_ORIGINS` | Exact comma-separated origins: `http://localhost:5173,http://127.0.0.1:5173,https://<actual-tunnel-hostname>` | No |
| `PAYOS_ENABLED` | Keep `false` until staging isolation and explicit test approval are confirmed; only then may an authorized operator enable it on staging | No |
| `PAYOS_CLIENT_ID` | Store the staging provider's value in Render's protected environment settings | Treat as server-side configuration |
| `PAYOS_API_KEY` | Store only in Render's protected environment settings | **Secret** |
| `PAYOS_CHECKSUM_KEY` | Store only in Render's protected environment settings | **Secret** |

The exact origin list must have no wildcards, paths or trailing slashes. The existing Backend validates a production Customer origin as HTTPS and validates the webhook URL as HTTP(S), with production HTTPS enforced. Do not change `NODE_ENV` to bypass those checks. Keep the currently registered webhook unchanged unless the PayOS operator separately approves registration for the isolated staging service; a staging service should use its own webhook URL and sandbox configuration.

Saving a Render environment change with **Save only** does not apply it until a later deploy. Render provides deploy/rebuild options when saving environment variables; coordinate any staging restart with the operator and do not change the shared production service. [Render environment variable documentation](https://render.com/docs/configure-environment-variables)

Temporary tunnel URLs change after restart. Update `PAYOS_CUSTOMER_ORIGIN` and the single matching entry in `CORS_ORIGINS` for the current tunnel, then deploy/restart only the isolated staging Backend. Remove the old origin when it is no longer used.

## Health, CORS and route checks

Use the approved staging API hostname. These checks do not create a Payment:

```powershell
Invoke-RestMethod 'https://<staging-api-host>/api/v1/health'
```

The health route reports database connection status; do not publish its output if it contains operational details.

Check CORS preflight without sending a payment request:

```powershell
curl.exe -i -X OPTIONS 'https://<staging-api-host>/api/v1/reservations/<reservation-id>/payments/payos' `
  -H 'Origin: https://<actual-tunnel-hostname>' `
  -H 'Access-Control-Request-Method: POST' `
  -H 'Access-Control-Request-Headers: authorization,content-type,idempotency-key'
```

The response should allow the exact requested origin and the `Authorization`, `Content-Type` and `Idempotency-Key` headers. A CORS preflight only confirms browser policy; it does not prove Customer authorization or payment eligibility.

The Customer API base remains `/api/v1`. Checkout creation is `POST /reservations/:id/payments/payos`; status/history are read from the Backend. Do not test checkout creation merely to check configuration: with `PAYOS_ENABLED=true`, that request can create a provider checkout link.

## Return and cancel behavior

The Backend builds both PayOS `returnUrl` and `cancelUrl` from the immutable Payment Reservation ID and `PAYOS_CUSTOMER_ORIGIN`, using:

```text
https://<actual-tunnel-hostname>/portal/payments/<reservation-id>
```

The Reservation ID must remain the same. The current Customer route is `/portal/payments/:reservationId`. After return or cancellation, the page reads Payment status/history from the Backend. Query parameters and the redirect itself are not settlement evidence. Only Backend `providerSettlementStatus=VERIFIED` plus `applicationStatus=APPLIED` is shown as an applied payment; refresh and history recovery do not create a second intent.

The Backend retains its Reservation/Contract ownership, eligibility, pricing, idempotency and signed webhook checks. A missing or malformed production `PAYOS_CUSTOMER_ORIGIN` is rejected as `PAYOS_CONFIGURATION_MISSING`; that code is also used for other required PayOS configuration failures, so verify variable **presence and validity by name** in Render without copying or printing secret values. `PAYOS_ENABLED=false` results in `PAYOS_CHECKOUT_DISABLED`.

## Webhook reachability

The application route is `POST /api/v1/payments/payos/webhook` and verifies the PayOS signature before applying any event. Do not disable signature verification or use browser return parameters as a substitute. Verify the registered URL in the PayOS operator console and use its test-webhook feature only against the isolated staging service. Do not send an invented or unsigned event to the shared production service. A `GET` request is not a webhook verification test.

## Troubleshooting

- **`PAYOS_CHECKOUT_DISABLED`:** `PAYOS_ENABLED` is not exactly `true` on the Backend process. Keep it disabled on production; confirm staging isolation and authorization before enabling on staging.
- **`PAYOS_CONFIGURATION_MISSING`:** check that `PAYOS_CUSTOMER_ORIGIN` is a public HTTPS origin only, `PAYOS_WEBHOOK_URL` is a valid HTTPS endpoint, and required server-side PayOS credentials exist in the protected Render settings. Never print credential values.
- **CORS error:** compare the browser's `Origin` exactly to one `CORS_ORIGINS` entry, including scheme and port. Remove paths, trailing slashes and wildcards. Check preflight response headers. A tunnel hostname is not interchangeable with `localhost`.
- **Vite Host blocked:** set `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` to the current hostname only and restart Vite. Do not set `server.allowedHosts=true`.
- **PayOS provider error or uncertain result:** check the original Payment's status/history in the Customer page and Backend logs using safe request identifiers. Do not create another Payment to clear an uncertain outcome. Keep webhook signature validation and manual reconciliation behavior unchanged.
- **Login works on localhost but not the tunnel:** sign in again at the tunnel origin; browser storage is separate per origin. If the Backend's authentication setup rejects the new origin, resolve that in the isolated staging configuration; do not copy browser tokens across origins.

## Stop and restore normal localhost development

1. Stop `cloudflared` with `Ctrl+C` in Terminal B; this closes the public tunnel.
2. Stop Vite with `Ctrl+C` in Terminal A.
3. In Terminal A, clear the one-host override and start Vite locally:

```powershell
Remove-Item Env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS -ErrorAction SilentlyContinue
Set-Location .\frontend
npm run dev
```

4. Restore your local API URL in your personal `frontend/.env.local` if desired. Do not overwrite this file automatically; it may contain developer-only settings.
5. Confirm the tunnel process is stopped and remove any temporary tunnel origin from the isolated staging `CORS_ORIGINS` and `PAYOS_CUSTOMER_ORIGIN` before using a different tunnel or ending the test window.

Temporary Cloudflare Quick Tunnels are for testing/development, not production customer traffic. Anyone with the active public URL can reach the local dev server while it is running. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
