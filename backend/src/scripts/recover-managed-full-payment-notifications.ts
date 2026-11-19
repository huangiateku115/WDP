import { connectDatabase, disconnectDatabase } from '../config/database';
import { ManagedFullPaymentNotificationRecoveryService } from '../services/notifications/managed-full-payment-notification-recovery.service';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(value => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--execute')) {
    console.log('No database connection made. Repeat with --execute only after approved environment selection.');
    return;
  }
  const limit = Number(option('limit') ?? 25);
  const maxBatches = Number(option('max-batches') ?? 4);
  let afterId = option('after-id');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 20) {
    throw new TypeError('limit must be 1..100 and max-batches must be 1..20');
  }
  await connectDatabase();
  try {
    for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber++) {
      const result = await ManagedFullPaymentNotificationRecoveryService.recoverBatch({ ...(afterId ? { afterId } : {}), limit });
      console.log(JSON.stringify({ batchNumber, ...result }));
      if (result.state !== 'READY') { process.exitCode = 2; return; }
      if (!result.hasMore || !result.nextAfterId) return;
      afterId = result.nextAfterId;
    }
    console.log(JSON.stringify({ continuationRequired: true, afterId }));
  } finally {
    await disconnectDatabase();
  }
}

void main().catch(() => {
  console.error('Managed payment notification recovery failed; review sanitized database diagnostics and retry after resolving the cause.');
  process.exitCode = 1;
});
