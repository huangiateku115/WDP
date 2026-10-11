# Frontend demo seed

This script adds fictional `FE-DEMO` records for the existing Facility, StorageUnit,
PricingRule, Policy, MaintenanceTicket, SupportRequest, SupportMessage and in-app
Notification models. It does not create users, profiles, inventory, payments or
other business domains. Demo image URLs are HTTPS references to Picsum; no upload
service is involved.

## Setup and safety

Use only the team's shared **development** Atlas URI and the existing development
Keycloak settings in `backend/.env`. Set these existing-account references:

```dotenv
SEED_CUSTOMER_EMAIL=
SEED_STAFF_EMAIL=
SEED_MANAGER_EMAIL=
SEED_BOM_EMAIL=
FE_SEED_DATABASE=test
```

Customer, staff, manager and BOM email settings are all optional. Catalog data does
not require any user accounts. If a setting is missing, empty, unmatched, inactive,
or has the wrong role, the report includes a warning naming the setting and reason;
it never prints an email address. The script never creates or changes users, roles,
facility assignments, Keycloak accounts or customer verification.

`FE-DEMO-HCM-01` and `FE-DEMO-HN-01` are public catalog demo facilities.
Maintenance/support records use a separate operational facility. Optionally set
`SEED_OPERATIONAL_FACILITY_ID` to an existing active, non-deleted development
facility only when both configured staff and manager are already assigned to it.
Without that setting, the script uses `FE-DEMO-HCM-01` only if both users are already
assigned there. If neither is eligible, operational scenarios are reported as
skipped; the script never changes user assignments to make them eligible.

Review the planned catalog data without writes. This works without any user email
settings and does not create users or other account records:

```sh
npm run seed:fe -- --dry-run
```

Alternatively, in PowerShell use the environment flag (which avoids npm argument
forwarding):

```powershell
$env:FE_SEED_DATABASE = 'test'
$env:FE_SEED_DRY_RUN = 'YES'
npm run seed:fe
```

Both dry-run forms make no writes. Dry-run verifies the connected database name.
The script does not select or switch databases. After confirming that `MONGO_URL`
points to the development Atlas cluster whose database is exactly `test`, set all
write guards and run:

```sh
NODE_ENV=development FE_SEED_TARGET=DEVELOPMENT FE_SEED_CONFIRM=YES FE_SEED_DATABASE=test npm run seed:fe
```

On PowerShell set `$env:NODE_ENV = 'development'`, `$env:FE_SEED_TARGET = 'DEVELOPMENT'`,
`$env:FE_SEED_CONFIRM = 'YES'` and `$env:FE_SEED_DATABASE = 'test'` before running
`npm run seed:fe`. The development target, exact database name and post-connect
database-name check are required; only the explicitly allowed development database
name `test` is accepted, and production mode is refused. Normal execution
without confirmation exits without connecting. The script never prints the URI,
only creates missing rows, preserves existing demo rows and reports natural-key
collisions. It uses deterministic IDs and performs no delete, drop or reset
operation. It closes MongoDB on success and failure.

## Dataset and lifecycle limits

- Facilities: `FE-DEMO-HCM-01` (Self-Storage + Managed Inventory) and
  `FE-DEMO-HN-01` (Self-Storage), with fictional Vietnamese addresses and
  placeholder contact data.
- Nine AVAILABLE storage units (six in HCM, three in Hanoi). Dimensions are the
  source of `volumeM3`; no unit is set HELD/OCCUPIED and support/maintenance does
  not mutate unit status.
- For both Self-Storage facilities, each size SMALL/MEDIUM/LARGE receives 1- and
  3-month VND pricing effective from 2026-01-01 and resolvable on 2026-10-10.
  There are 12 expected pricing scopes total. Prices are frontend demo values.
  Four policies are seeded per facility: DEPOSIT (`500000 VND`) and illustrative
  CANCELLATION/REFUND/OVERDUE configs explicitly marked `demoOnly` (8 expected
  policies total). Thus the complete core catalog is 2 Facilities, 9 AVAILABLE
  StorageUnits, 12 PricingRules and 8 Policies, independent of configured users.
- Pricing/Policy demo rules propose the half-open interval
  `[2026-01-01T00:00:00Z, infinity)`. Overlap follows `[effectiveFrom, effectiveTo)`:
  an active rule beginning in 2026 or 2027 conflicts, while a historical interval
  ending at `2026-01-01T00:00:00Z` is adjacent and does not. Every proposed interval
  is checked, including future active rules; insertion rechecks under the RuleScope
  transaction serialization. On conflict, the seed does not insert, deactivate,
  rewrite or delete the existing rule. Resolve checks for inserted/existing demo
  scopes target `2026-10-10T00:00:00Z`. Do not treat illustrative policy config as
  implemented business behavior.
- Maintenance requires valid active Staff and Manager accounts already assigned
  to the selected operational facility. Support additionally requires a valid
  active Customer. Each workflow is gated and reported separately; missing accounts
  skip only dependent records, while catalog data continues. A supplied invalid
  `SEED_OPERATIONAL_FACILITY_ID` skips operational workflows and never falls back
  to a different facility. Eligible records are created
  Maintenance OPEN/ASSIGNED/IN_PROGRESS examples and Support OPEN/ASSIGNED/
  IN_PROGRESS/RESOLVED examples through the current services for legal transitions.
  It also adds public/internal support messages and IN_APP maintenance/support
  notices only for valid users with corresponding seeded workflows. Notification
  `type` is omitted because the existing optional enum has no maintenance/support
  value; no checkout/payment/contract event is implied. Existing services still
  enforce authorization and lifecycle transitions.

The current dataset is a catalog and selected operational-state demo, not a full
rental lifecycle. **Reservations, contracts, inspections and access logs are NOT
currently seeded.**
Reservations require a VERIFIED customer profile and a future hold; a contract or
occupied unit depends on the approved reservation/payment/check-in lifecycle.
The seed does not fabricate those relationships, call payment providers, change
verification, or create fake access/inspection events. Managed Inventory pricing
is also omitted because the current pricing contract does not define representative
volume-based frontend prices. No Reservation, Contract, Inspection or AccessLog
collection is created solely for the demo.

## Seed report accounting

The JSON report includes `mode`, `database`, `created`, `existing`, `skipped`,
`conflicts`, `planned`, catalog arrays (`facilities`, `units`, `pricing`, `policies`),
`opsWorkflow` section statuses, and `userWarnings`. It separates these counters:
`created` counts inserted records (including support messages and notifications),
`existing` counts recognized demo records retained on rerun, `skipped` counts
operational workflow records omitted because there is no eligible assigned facility,
`conflicts` counts preserved natural-key or active pricing/policy interval conflicts,
and `planned` counts records a dry-run would create. With no eligible operational
facility and no valid users, 12 workflow records are skipped (3 maintenance tickets,
4 support requests, 3 support messages and 2 notifications). With valid Staff and
Manager but no Customer, maintenance and its staff notification can proceed while
the 7 support records and customer notification are skipped. An eligible complete
workflow creates the same 12 records. Messages and notifications are represented
in totals and notes, not dedicated dataset arrays. Counts vary with existing data
and interval conflicts. Pricing/Policy verification is read-only, applies the
RuleService effective-date filter at `2026-10-10`, and requires no authenticated
actor; missing and ambiguous scopes are reported separately.

## Postman

Use the current standalone `WDP-Backend.postman_collection.json` and
`WDP-Local.postman_environment.json` handoff. Copy facility/unit IDs and the
generated pricing/policy IDs from the seed report into the corresponding local
environment values. When scoped workflow examples were seeded, also copy the
MaintenanceTicket and SupportRequest IDs plus the existing Staff/Customer IDs.
For example, map the report fields into these local Postman variables:

```text
facilityId          <- dataset.facilities[0].id
storageUnitId       <- dataset.units[0].id
pricingRuleId       <- dataset.pricing[0].id
policyId            <- dataset.policies[0].id
maintenanceTicketId <- dataset.maintenanceTickets[0].id
supportRequestId    <- dataset.supportRequests[0].id
staffId             <- dataset.users[role=FACILITY_STAFF].id
customerId          <- dataset.users[role=CUSTOMER].id
```

Login using your own Keycloak account and local credentials;
the seed output contains no URI, password, token or user email.

For the frontend handoff, set `PORT=5000` in the backend's local `.env` before
starting `npm run dev`, so it matches `baseUrl = http://localhost:5000/api/v1`.
Public catalog checks do not need a token. Protected requests use existing Keycloak
development accounts. Resolve examples use the seeded facility ID, `at=2026-10-10T00:00:00Z`,
and the size/term query inputs from the report. Keep the standalone collection and
environment outside this repository.
