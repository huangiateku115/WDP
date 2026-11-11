require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  const res = await db.collection('storageunits').updateOne(
    { unitCode: 'SS-108' },
    { $set: { status: 'MAINTENANCE', description: 'Tủ kho đang bảo trì hệ thống khóa thông minh' } }
  );
  console.log('Đã cập nhật SS-108 sang MAINTENANCE:', res.modifiedCount);
  await mongoose.disconnect();
}

main().catch(console.error);
