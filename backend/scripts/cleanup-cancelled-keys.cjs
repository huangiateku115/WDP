require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  const res = await db.collection('reservations').updateMany(
    { status: 'CANCELLED', bookingIdempotencyKey: { $exists: true } },
    { $unset: { bookingIdempotencyKey: 1 } }
  );
  console.log('Đã giải phóng bookingIdempotencyKey cho các đơn đã CANCELLED:', res.modifiedCount);
  await mongoose.disconnect();
}

main().catch(console.error);
