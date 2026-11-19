# Managed V3 Notification Index Readiness

## Runtime gate

Managed V3 full-payment notification persistence and recovery remain disabled until both the explicit runtime flag `MANAGED_V3_FULL_PAYMENT_NOTIFICATIONS_ENABLED=true` is approved and the `notifications` collection reports the unique index below. The flag is off by default. The application declares this index in Mongoose but sets `autoIndex: false`; application startup does not provision it. A missing or mismatched index makes the event producer fail closed. Payment remains committed and acknowledged; the bounded recovery service reports `BLOCKED_DISABLED` or `BLOCKED_INDEX` without scanning Payments.

## Exact index declaration

```javascript
db.notifications.createIndex(
  { userId: 1, eventKey: 1 },
  {
    name: "uniq_notification_user_event_key",
    unique: true,
    partialFilterExpression: { eventKey: { $type: "string" } }
  }
)
```

The partial filter excludes legacy Self Storage notifications that predate `eventKey`. The key is a SHA-256 digest of service type, recipient ID, notification type, and persisted business-event identity. Titles and message bodies are not part of the key. The atomic upsert uses `(userId, eventKey)` and `$setOnInsert`; duplicate-key races are treated as an already-persisted event.

## Read-only preflight

Run against the intended database only after an operator has selected the environment. This is read-only:

```javascript
db.notifications.getIndexes().filter(index => index.name === "uniq_notification_user_event_key")
```

Before provisioning, check for duplicate candidate keys. This pipeline is read-only and bounded to 100 returned duplicate groups:

```javascript
db.notifications.aggregate([
  { $match: { eventKey: { $type: "string" } } },
  { $group: { _id: { userId: "$userId", eventKey: "$eventKey" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
  { $match: { count: { $gt: 1 } } },
  { $limit: 100 }
])
```

If this returns any rows, stop and review them. Do not delete or merge legacy notifications automatically. Records without a string `eventKey` are outside the unique constraint and remain readable.

## Provisioning and rollback plan

Provisioning requires separate operational approval. First record the preflight output and database/collection identity. Then run the exact `createIndex` declaration above during an approved change window and verify its returned name, keys, `unique` flag, and partial filter with `getIndexes()`.

If provisioning fails, leave notification delivery gated and inspect the duplicate groups and index-build error. Do not weaken the index or switch to non-atomic inserts. If rollback is approved, disable Managed V3 notification delivery/recovery first, then run:

```javascript
db.notifications.dropIndex("uniq_notification_user_event_key")
```

Dropping the index removes cross-process deduplication; Managed V3 event delivery must remain disabled afterward.

## Runtime verification and activation

`NotificationService.isIdempotencyReady()` verifies the actual collection index metadata. The bounded recovery service returns `BLOCKED_DISABLED` or `BLOCKED_INDEX` and does not scan payments until both gates pass. The webhook path does not fail or roll back an already committed Payment when notification storage is unavailable; it emits a sanitized deferred-delivery diagnostic. After separate approval of the index and feature flag, select the intended environment and run `npm run notifications:recover-managed-v3 -- --execute --limit=25 --max-batches=4`. The script makes no database connection without `--execute`, processes at most four bounded batches per invocation, and prints a continuation cursor if more records remain. Continue with `--after-id=<printed-cursor>`; after process restart, restart from the first cursor to retry deferred earlier rows. Deterministic event keys make already-delivered rows safe to revisit.

Before enabling any recurring worker, verify the index at runtime, run a bounded offline/staging validation, inspect duplicate-key and deferred-delivery diagnostics, and obtain separate approval to activate the worker. No Managed reminder cron is enabled by this change.

This document does not assert that the index is provisioned in any runtime. Database verification and production activation were not performed for this task.
