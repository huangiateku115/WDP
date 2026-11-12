/**
 * CLI Helper: Local Mock 100% Payment Simulator
 * Usage:
 *   node scripts/local-mock-pay.cjs <reservationCodeOrId>
 * Example:
 *   node scripts/local-mock-pay.cjs BKG-261013-KSYM
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/local-mock-pay.cjs <reservationCodeOrId>');
    process.exit(1);
  }

  const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URL or MONGODB_URI not found in backend/.env');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const query = mongoose.Types.ObjectId.isValid(target)
    ? { _id: new mongoose.Types.ObjectId(target) }
    : { reservationCode: target.trim() };

  const reservation = await db.collection('reservations').findOne(query);
  if (!reservation) {
    console.error(`Reservation not found with query: ${JSON.stringify(query)}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found reservation: ${reservation.reservationCode} (Current Status: ${reservation.status})`);

  const now = new Date();
  const signingDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days SLA

  // Create mock payment record
  const paymentResult = await db.collection('reservationpayments').insertOne({
    reservationId: reservation._id,
    customerId: reservation.customerId,
    facilityId: reservation.facilityId,
    serviceType: reservation.serviceType,
    purpose: 'FULL_RENT',
    amount: reservation.estimatedRent || 0,
    currency: 'VND',
    idempotencyKey: `local-cli-mock-${reservation._id}-${Date.now()}`,
    provider: 'MOCK',
    providerReference: `LOCAL-CLI-PAYOS-FULL-${reservation.reservationCode}`,
    status: 'SUCCEEDED',
    succeededAt: now,
    checkoutState: 'READY',
    createdAt: now,
    updatedAt: now
  });

  // Update reservation to PAID with signingDeadline
  const updateResult = await db.collection('reservations').findOneAndUpdate(
    { _id: reservation._id },
    {
      $set: {
        status: 'PAID',
        signingDeadline,
        fullPaymentId: paymentResult.insertedId,
        updatedAt: now
      },
      $unset: { expiresAt: 1 },
      $push: {
        statusHistory: {
          status: 'PAID',
          reason: '100% full rent settled via local CLI mock payment simulator',
          createdAt: now
        }
      }
    },
    { returnDocument: 'after' }
  );

  console.log('========================================================');
  console.log('✅ PAYMENT SUCCESSFUL (MOCK 100% SETTLED)');
  console.log(`Reservation Code : ${reservation.reservationCode}`);
  console.log(`New Status       : PAID ("Đã thanh toán — Chờ ký hợp đồng tại cơ sở")`);
  console.log(`Signing Deadline : ${signingDeadline.toISOString()} (3 days SLA)`);
  console.log(`Payment Record ID: ${paymentResult.insertedId}`);
  console.log('========================================================');

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
