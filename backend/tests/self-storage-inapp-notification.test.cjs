const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.GMAIL_USER = process.env.GMAIL_USER || 'vaultspace.noreply@gmail.com';
process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'dummy-app-password';

const { EmailService } = require('../dist/services/email/email.service');
const { NotificationService } = require('../dist/services/notifications/notification.service');
const NotificationModel = require('../dist/models/notifications/notification.model').default;
const { NotificationMethod, NotificationType } = require('../dist/types/notification.type');
const { ReservationStatus } = require('../dist/types/reservation.type');
const { FacilityServiceType } = require('../dist/types/facility.type');

function createFakeReservation(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-261117-INAPP',
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    customerId: {
      _id: new mongoose.Types.ObjectId(),
      email: 'customer.real@gmail.com',
      fullName: 'Nguyễn Hoàng Long',
    },
    facilityId: {
      _id: new mongoose.Types.ObjectId(),
      name: 'Cơ sở Kho Tự Quản Demo HCM',
      address: { line1: '456 Lê Duẩn', district: 'Quận 1', city: 'Hồ Chí Minh' },
    },
    storageUnitId: {
      _id: new mongoose.Types.ObjectId(),
      unitCode: 'SS-105',
    },
    startDate: new Date('2026-11-17T00:00:00.000Z'),
    endDate: new Date('2026-12-17T00:00:00.000Z'),
    signingDeadline: new Date('2026-11-20T00:00:00.000Z'),
    actualCheckoutDate: new Date('2026-12-17T09:00:00.000Z'),
    estimatedRent: 1000000,
    rentalPricingSnapshot: { totalDue: 1000000 },
    accessPinCode: '654321',
    ...overrides,
  };
}

test('NotificationService: safeCreate không bao giờ throw lỗi khi DB fail hoặc userId sai', async (t) => {
  const origCreate = NotificationModel.create;
  NotificationModel.create = async () => {
    throw new Error('MongoNetworkError: connection closed');
  };
  t.after(() => {
    NotificationModel.create = origCreate;
  });

  const badUserRes = await NotificationService.safeCreate({
    userId: 'invalid-id',
    type: NotificationType.PAYMENT_SUCCESS,
    title: 'Test',
    content: 'Test content',
    sentVia: [NotificationMethod.IN_APP],
  });
  assert.equal(badUserRes, false);

  const dbFailRes = await NotificationService.safeCreate({
    userId: new mongoose.Types.ObjectId(),
    type: NotificationType.PAYMENT_SUCCESS,
    title: 'Test',
    content: 'Test content',
    sentVia: [NotificationMethod.IN_APP],
  });
  assert.equal(dbFailRes, false);
});

test('In-App Notification: Đồng bộ cả 13 mốc từ EmailService với đầy đủ summary + detail và sentVia', async (t) => {
  const createdNotifications = [];
  const origCreate = NotificationModel.create;
  NotificationModel.create = async (doc) => {
    createdNotifications.push(doc);
    return { _id: new mongoose.Types.ObjectId(), ...doc };
  };

  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async () => ({ messageId: 'ok' }),
  });

  t.after(() => {
    NotificationModel.create = origCreate;
    EmailService.getTransporter = origGetTransporter;
  });

  const res = createFakeReservation();
  const ext = {
    extensionCode: 'EXT-261117-01',
    durationMonths: 3,
    amount: 2800000,
    newEndDate: new Date('2027-03-17T00:00:00.000Z'),
    signingDeadline: new Date('2026-11-20T00:00:00.000Z'),
  };

  await EmailService.sendReservationCreatedEmail(res); // 0a
  await EmailService.sendExtensionCreatedEmail(res, ext); // 0b
  await EmailService.sendRentalPaidEmail(res); // 1
  await EmailService.sendHandoverPinEmail(res, '654321'); // 2.1
  await EmailService.sendStaffCancelledNoReceiveEmail(res, 'Kho nhỏ hơn dự kiến'); // 2.2
  await EmailService.sendCheckoutCompletedEmail(res, 'GOOD', 'Sạch sẽ'); // 3
  await EmailService.sendExtensionPaidEmail(res, ext); // 4
  await EmailService.sendExtensionConfirmedEmail(res, ext); // 5.1
  await EmailService.sendExtensionRejectedEmail(res, ext, 'Đổi kế hoạch'); // 5.2
  await EmailService.sendSigningSlaExpiredRentalEmail(res); // Cron 1a
  await EmailService.sendSigningSlaExpiredExtensionEmail(res, ext); // Cron 1b
  await EmailService.sendExpiringSoonReminderEmail(res, 7); // Cron 2
  await EmailService.sendOverdueRentalEmail(res); // Cron 3

  assert.equal(createdNotifications.length, 13);
  for (const n of createdNotifications) {
    assert.equal(n.isRead, false);
    assert.deepEqual(n.sentVia, [NotificationMethod.IN_APP, NotificationMethod.EMAIL]);
    assert.ok(n.content.includes('\n\n'), `Notification ${n.title} must contain summary + \\n\\n + detail`);
    assert.equal(n.content.includes('undefined'), false);
  }

  // Kiểm tra các type & nội dung đặc thù
  assert.equal(createdNotifications[0].type, NotificationType.BOOKING_CREATED);
  assert.equal(createdNotifications[3].type, NotificationType.HANDOVER_PIN);
  assert.equal(createdNotifications[3].content.includes('654321'), false);
  assert.match(createdNotifications[3].content, /thông tin chi tiết trong mục dịch vụ/);
  assert.equal(createdNotifications[4].type, NotificationType.BOOKING_CANCELLED);
  assert.match(createdNotifications[4].content, /thông tin chi tiết trong mục dịch vụ/);
  assert.equal(createdNotifications[9].type, NotificationType.SIGNING_SLA_EXPIRED);
  assert.equal(createdNotifications[11].type, NotificationType.EXPIRING_SOON);
  assert.equal(createdNotifications[12].type, NotificationType.OVERDUE_ALERT);
});

test('In-App Notification: Vẫn tạo thông báo trên nền tảng (sentVia: [IN_APP]) khi tài khoản dùng email ảo', async (t) => {
  const createdNotifications = [];
  const origCreate = NotificationModel.create;
  NotificationModel.create = async (doc) => {
    createdNotifications.push(doc);
    return { _id: new mongoose.Types.ObjectId(), ...doc };
  };

  let smtpCalls = 0;
  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async () => {
      smtpCalls++;
    },
  });

  t.after(() => {
    NotificationModel.create = origCreate;
    EmailService.getTransporter = origGetTransporter;
  });

  const fakeTestUserRes = createFakeReservation({
    customerId: {
      _id: new mongoose.Types.ObjectId(),
      email: 'customer.demo@example.com', // email ảo -> skip SMTP
      fullName: 'Khách Demo',
    },
  });

  const emailSent = await EmailService.sendRentalPaidEmail(fakeTestUserRes);
  assert.equal(emailSent, false);
  assert.equal(smtpCalls, 0);
  assert.equal(createdNotifications.length, 1);
  assert.deepEqual(createdNotifications[0].sentVia, [NotificationMethod.IN_APP]);
});
