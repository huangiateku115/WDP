# VaultSpace frontend

## Run locally (PowerShell)

Use Node.js 22.12+ and the backend configuration supplied privately by the backend team.

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Copy the example only on first setup; preserve an existing `.env.local`. Open the URL printed by Vite.

The example uses real backend data (`VITE_USE_MOCK=false`) at `http://localhost:5000/api/v1`. Start backend separately using its private `.env`, install its dependencies and run `npm run dev` inside `backend`. Verify `/api/v1/health` before signing in.

`localhost` means the computer running the browser. For a shared backend, set `VITE_API_BASE_URL` to its reachable URL and ask the backend team to configure the allowed frontend origin. Never put backend credentials in a `VITE_` variable.

## Managed Inventory development demo

Set these public flags in `frontend/.env.local` for simulated deposit and balance confirmation:

```env
VITE_ENABLE_MANAGED_DEPOSIT_MOCK=true
VITE_ENABLE_MANAGED_BALANCE_MOCK=true
```

The local backend also requires:

```env
NODE_ENV=development
MI_MANAGED_DEPOSIT_FLOW_ENABLED=true
```

Restart both services after configuration changes. Mock confirmations default to false and are disabled in production builds. Without the flags, data remains readable but simulated confirmation buttons are unavailable. Payments are simulated.

Use accounts supplied by the team. Staff and Manager need the correct assigned Facility. Managed V2 requires configured capacity, available Cells, pricing, deposit/category policies and a transaction-capable development database. Self Storage and legacy Managed orders cannot substitute for V2 orders. First inbound requires the rental start time to have arrived.

Never add API secrets, passwords or database connection strings to this example or README.

Local `.env` files are ignored by Git. Commit only `.env.example` with safe placeholders. See [Staff/Manager demo guide](docs/StaffManagerDemoVI.md).

## Checks

```powershell
npm test
npm run build
```
