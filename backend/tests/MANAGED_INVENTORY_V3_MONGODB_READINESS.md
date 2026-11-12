# Managed Inventory V3 MongoDB readiness

This opt-in probe checks replica-set transactions, unique idempotency indexes, compare-and-set revisions, rollback, concurrent revision writes, revoked-session fencing, Cell-counter reconciliation, and persistence after reconnect. It uses only randomly named scratch collections and removes those collections at exit.

It tests MongoDB primitives only. It does **not** invoke `ManagedInventoryV3Service`, validate application schemas/index deployment, or replace a service-level integration suite.

Use a disposable, non-production MongoDB replica-set database whose database name contains `test` or `ci`. Do not use a production URI. From `backend`, set the URI in the current shell without printing it and run:

```powershell
$env:MI_V3_TEST_MONGODB_URI = '<disposable replica-set test URI>'
$env:MI_V3_ALLOW_TEST_DB_WRITES = 'YES'
node tests/managed-inventory-v3-mongodb-readiness.cjs
Remove-Item Env:MI_V3_TEST_MONGODB_URI
Remove-Item Env:MI_V3_ALLOW_TEST_DB_WRITES
```

The script refuses to run without both explicit environment variables, a test/CI database name, and replica-set `hello.setName` evidence. A failed probe should be treated as unverified until a suitable isolated test database is available.
