# MI-06B.1B MongoDB Integration Harness

This harness is for a disposable, local, single-node MongoDB replica set. It is not part of the normal backend test suite unless the runner sets both explicit opt-in variables. It never loads `backend/.env` or reads the application's default MongoDB connection.

## Safety boundary

`backend/tests/integration/mi06b-mongo-safety.cjs` validates configuration before connecting. It requires `NODE_ENV=test`, `MI06B_IT_RUN=1`, `MI06B_IT_CONFIRM=LOCAL_DISPOSABLE_ONLY`, the repeated-inbound gate enabled only in the test process, a new database name matching `wdp_mi06b1b_it_<32 lowercase hex>`, and `MI06B_IT_DATA_DIR` naming a unique direct child of the OS temporary directory. The only accepted MongoDB URI is unauthenticated `mongodb://127.0.0.1:27018/<that exact database>?directConnection=true`; SRV, credentials, other hosts, ports, database names, URI parameters, and non-local replica set members fail closed. After connecting, the harness also checks `getCmdLineOpts` for the exact bind address, port, replica-set name, and temporary data path.

The harness disables Mongoose `autoIndex` and `autoCreate` before loading application models. It explicitly calls `createIndexes()` only for the inbound request and event models, then inspects the unresolved-request partial unique index and the two event uniqueness indexes. It never calls `syncIndexes()`. The suite verifies connection host, port, database, replica-set name, writable-primary state, and the one-member host list before index creation or fixture writes. The URI uses `directConnection=true`; the replica-set name is verified from the server's `hello` response. Cleanup rechecks the same identity and drops only the generated test database. A failed or uncertain identity check refuses cleanup.

The harness does not start MongoDB, Docker, or remove the server's data directory. The operator must keep the disposable data directory under the OS temporary directory and remove that exact generated directory only after stopping the dedicated `mongod` process. Never point this suite at a shared developer database.

## One-time disposable server setup (operator action)

Use a locally installed `mongod` and `mongosh`. Substitute a fresh GUID in the temporary path. These commands are documentation only; this preparation task did not run them.

```powershell
$dataDir = Join-Path $env:TEMP ("wdp-mi06b-it-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dataDir | Out-Null
Write-Output $dataDir
mongod --dbpath $dataDir --bind_ip 127.0.0.1 --port 27018 --replSet wdp-mi06b-it --setParameter enableTestCommands=1
```

In another terminal, initialize the one local member once:

```powershell
mongosh "mongodb://127.0.0.1:27018/admin?directConnection=true" --eval 'rs.initiate({_id:"wdp-mi06b-it",members:[{_id:0,host:"127.0.0.1:27018"}]})'
```

Wait for `rs.status()` to show exactly one `PRIMARY` member before running the suite. The failpoint option is needed only for the UnknownTransactionCommitResult case. The service URI used by tests is separately validated and always names the generated test database.

## Authorized integration command

Run from `backend` in a fresh PowerShell process after the server is ready. The random database name is unique for each run. The test process does not call dotenv, and these environment variables override any inherited MongoDB URL.

```powershell
$env:NODE_ENV = 'test'
$env:MI06B_IT_RUN = '1'
$env:MI06B_IT_CONFIRM = 'LOCAL_DISPOSABLE_ONLY'
$env:MI06_REPEATED_INBOUND_ENABLED = 'true'
$env:MI06B_IT_DB_NAME = 'wdp_mi06b1b_it_' + [guid]::NewGuid().ToString('N')
$env:MI06B_IT_DATA_DIR = '<copy the exact unique $dataDir printed/used by the server terminal>'
$env:MONGO_URL = 'mongodb://127.0.0.1:27018/' + $env:MI06B_IT_DB_NAME + '?directConnection=true'
node --test tests/integration/managed-inbound-request.mongo.test.cjs
```

For the commit failpoint case, add `$env:MI06B_IT_UNKNOWN_COMMIT_FAILPOINT = '1'`. Without that separate opt-in it is reported as skipped/UNVERIFIED, not passed. When tests finish, the harness drops only the generated database. Stop the dedicated `mongod` with Ctrl+C. Before removing its directory, confirm the fully resolved path starts with `$env:TEMP\wdp-mi06b-it-` and is the exact path created for this run; do not remove any parent or shared MongoDB data directory.

## Prepared integration matrix

| Case | Real database assertion |
| --- | --- |
| A | Request partial unique unresolved index is installed and rejects a second unresolved request for the same Item. |
| B | Same-key parallel CREATE returns one committed snapshot and exactly one Request/Event. |
| C | Different-key parallel CREATE produces one request and no duplicate persistence. |
| D | CREATE racing `requestOutbound` leaves the Item and unresolved-request state mutually consistent. |
| E | An unresolved request blocks `confirmOutbound` before outbound movement/counter writes. |
| F | An unresolved request blocks relocation before movement/counter writes. |
| G | AMEND racing CANCEL with the same request version commits at most one mutation and matching event. |
| H | Reservation ACTIVE-to-OVERDUE racing CREATE is serialized by the Reservation eligibility token; no request is accepted based on an already committed ineligible state. |
| I | Injected failure after the Event has been written in the transaction rolls back both Request and Event. |
| J | Event `resultingVersion` and immutable result snapshot match the Request versions. |
| K | A one-shot `commitTransaction` UnknownTransactionCommitResult failpoint yields one request/event or a bounded unknown-outcome error, never duplicate success. Requires the separate failpoint opt-in. |
| L | Gate OFF blocks CREATE/AMEND, permits owner GET and safe CANCEL, while operational guards still see unresolved requests. |

The suite uses real service methods, Mongoose transactions, and isolated MongoDB writes. A mock result is not evidence for these concurrency properties. The fixture creates only test Facility, Reservation, Item, Cell, allocation, and legacy inbound movement records in the generated database. No Atlas, production, staging, or application-default database is an allowed target.

## Previously blocked HTTP tests

The last reported nine failures were loopback HTTP tests blocked by sandbox `EACCES`/fetch failure, not passing assertions. Rerun them on a developer machine or CI worker that allows binding ephemeral HTTP ports on `127.0.0.1`; keep the tests and authentication assertions unchanged.

From `backend`, after the usual TypeScript build:

```powershell
node --test tests/cors.test.cjs tests/facility.test.cjs tests/infrastructure.test.cjs tests/inventory-item.test.cjs tests/maintenance-ticket.test.cjs tests/pricing-policy.test.cjs tests/public-catalog.test.cjs tests/storage-unit.test.cjs tests/support-request.test.cjs
```

Report any still-blocked socket tests separately from assertion failures. Do not remove HTTP tests, relax authentication, or count blocked tests as passing.
