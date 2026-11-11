require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  console.log('--- BẮT ĐẦU TẠO TÀI KHOẢN CUSTOMER2 ---');

  // 1. Lấy Keycloak Admin Token
  console.log('1. Lấy token Admin từ Keycloak...');
  const KC_BASE = process.env.KEYCLOAK_BASE_URL || 'https://keycloak-production-50e2.up.railway.app';
  const REALM = process.env.KEYCLOAK_REALM || 'wdp-realm';
  const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin';
  const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD || '123456';

  const tokenParams = new URLSearchParams({
    client_id: 'admin-cli',
    username: ADMIN_USER,
    password: ADMIN_PASS,
    grant_type: 'password'
  });

  const tokenRes = await fetch(`${KC_BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString()
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Không thể lấy Keycloak admin token: ${errText}`);
  }

  const { access_token } = await tokenRes.json();
  console.log('=> Lấy Admin Token thành công.');

  // 2. Tìm hoặc tạo user trên Keycloak
  const email = 'customer2@wdp.vn';
  const password = '123456';
  console.log(`2. Kiểm tra tài khoản ${email} trên Keycloak...`);

  const searchRes = await fetch(`${KC_BASE}/admin/realms/${REALM}/users?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  const existingKeycloakUsers = await searchRes.json();

  let keycloakSub;

  if (existingKeycloakUsers && existingKeycloakUsers.length > 0) {
    keycloakSub = existingKeycloakUsers[0].id;
    console.log(`=> Đã tìm thấy user trên Keycloak. ID: ${keycloakSub}`);

    // Reset password về 123456
    const resetRes = await fetch(`${KC_BASE}/admin/realms/${REALM}/users/${keycloakSub}/reset-password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`
      },
      body: JSON.stringify({
        type: 'password',
        value: password,
        temporary: false
      })
    });
    if (resetRes.ok) console.log('=> Đã cập nhật mật khẩu về 123456.');
  } else {
    console.log(`=> Tạo mới user ${email} trên Keycloak...`);
    const createRes = await fetch(`${KC_BASE}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`
      },
      body: JSON.stringify({
        username: email,
        email: email,
        firstName: 'Nguyễn Khách Hàng',
        lastName: 'Customer 2',
        enabled: true,
        emailVerified: true,
        credentials: [
          {
            type: 'password',
            value: password,
            temporary: false
          }
        ]
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Tạo user trên Keycloak thất bại: ${errText}`);
    }

    // Lấy lại user vừa tạo để lấy ID
    const refetchRes = await fetch(`${KC_BASE}/admin/realms/${REALM}/users?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const createdList = await refetchRes.json();
    keycloakSub = createdList[0].id;
    console.log(`=> Tạo thành công user trên Keycloak. ID: ${keycloakSub}`);
  }

  // 3. Kết nối MongoDB Atlas và đồng bộ vào DB
  console.log('3. Kết nối MongoDB Atlas...');
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;

  const now = new Date();

  // Tìm hoặc tạo trong users collection
  let user = await db.collection('users').findOne({ email });
  if (!user) {
    console.log('=> Thêm user vào collection users...');
    const insertRes = await db.collection('users').insertOne({
      keycloakSub,
      email,
      displayName: 'customer2',
      phone: '0909888999',
      role: 'CUSTOMER',
      isActive: true,
      assignedFacilityId: null,
      createdAt: now,
      updatedAt: now
    });
    user = { _id: insertRes.insertedId, email, role: 'CUSTOMER', displayName: 'customer2' };
    console.log(`=> Đã tạo user trong DB. _id: ${user._id}`);
  } else {
    console.log(`=> User đã tồn tại trong DB. _id: ${user._id}. Đang cập nhật keycloakSub...`);
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { keycloakSub, isActive: true, updatedAt: now } }
    );
  }

  // 4. Tạo hoặc cập nhật CustomerProfile sang VERIFIED
  console.log('4. Cập nhật hồ sơ khách hàng (CustomerProfile) sang VERIFIED...');
  await db.collection('customerprofiles').updateOne(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        identityCard: '079201008888',
        address: '789 Đường Thảo Điền, Quận 2, TP.HCM',
        taxCode: '840998877',
        verificationStatus: 'VERIFIED',
        verifiedAt: now,
        note: 'Tài khoản customer2 đã được xác minh hồ sơ để test',
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );
  console.log('=> Cập nhật hồ sơ VERIFIED thành công.');

  // 5. Test đăng nhập để kiểm tra xác thực trọn vẹn
  console.log('5. Thử nghiệm đăng nhập qua AuthService...');
  const { AuthService } = require('../dist/services/auth/auth.service');
  const loginResult = await AuthService.login(email, password);
  console.log('=> ĐĂNG NHẬP THÀNH CÔNG!');
  console.log(`   Email: ${loginResult.user.email}`);
  console.log(`   Tên hiển thị: ${loginResult.user.displayName}`);
  console.log(`   Vai trò: ${loginResult.user.role}`);
  console.log(`   Có Access Token: ${!!loginResult.accessToken}`);

  await mongoose.disconnect();
  console.log('--- HOÀN TẤT TẠO TÀI KHOẢN CUSTOMER2 ---');
}

main().catch(err => {
  console.error('LỖI:', err);
  process.exit(1);
});
