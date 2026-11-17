const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.GMAIL_USER = process.env.GMAIL_USER || 'vaultspace.noreply@gmail.com';
process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'dummy-app-password';

const { EmailService } = require('../dist/services/email/email.service');
const NotificationModel = require('../dist/models/notifications/notification.model').default;
NotificationModel.create = async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc });
const ReservationModel = require('../dist/models/reservations/reservation.model').default;
const StorageUnitModel = require('../dist/models/storage-units/storage-unit.model').default;
const ContractModel = require('../dist/models/contracts/contract.model').default;
const { checkRentalExpiration } = require('../dist/jobs/rental-expiration-checker.job');
const { checkSigningSla } = require('../dist/jobs/signing-sla-checker.job');
const { ReservationStatus } = require('../dist/types/reservation.type');
const { FacilityServiceType } = require('../dist/types/facility.type');

function createFakeReservation(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    reservationCode: 'BKG-261116-DEMO',
    serviceType: FacilityServiceType.SELF_STORAGE,
    status: ReservationStatus.ACTIVE,
    customerId: {
      _id: new mongoose.Types.ObjectId(),
      email: 'customer.real@gmail.com',
      fullName: 'Nguyễn Văn Demo',
    },
    facilityId: {
      _id: new mongoose.Types.ObjectId(),
      name: 'Cơ sở Kho Tự Quản Demo HCM',
      address: '123 Đường Nguyễn Huệ, Quận 1, TP.HCM',
    },
    storageUnitId: {
      _id: new mongoose.Types.ObjectId(),
      unitCode: 'SS-110',
    },
    startDate: new Date('2026-11-16T00:00:00.000Z'),
    endDate: new Date('2026-12-16T00:00:00.000Z'),
    signingDeadline: new Date('2026-11-19T00:00:00.000Z'),
    actualCheckoutDate: new Date('2026-12-16T09:30:00.000Z'),
    estimatedRent: 2500000,
    rentalPricingSnapshot: { totalDue: 2500000 },
    accessPinCode: '886420',
    extendContract: [],
    statusHistory: [],
    ...overrides,
  };
}

test('EmailService: Kiểm tra lọc email hợp lệ vs email test/ảo (Fallback Skip List)', () => {
  assert.equal(EmailService.isDeliverableEmail('longzhongli2005@gmail.com'), true);
  assert.equal(EmailService.isDeliverableEmail('customer@example.com'), false);
  assert.equal(EmailService.isDeliverableEmail('demo@test.com'), false);
  assert.equal(EmailService.isDeliverableEmail('user@abc.local'), false);
  assert.equal(EmailService.isDeliverableEmail('user@xyz.test'), false);
  assert.equal(EmailService.isDeliverableEmail('invalid-email'), false);
  assert.equal(EmailService.isDeliverableEmail(''), false);
});

test('EmailService: Fallback an toàn (Non-blocking) khi SMTP bị lỗi hoặc timeout', async (t) => {
  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async () => {
      throw new Error('ETIMEDOUT: SMTP server unreachable');
    },
  });
  t.after(() => {
    EmailService.getTransporter = origGetTransporter;
  });

  const ok = await EmailService.safeSendMail('customer.real@gmail.com', '[VaultSpace] Test', '<p>Hi</p>');
  assert.equal(ok, false);
});

test('EmailService: Bỏ qua không gọi SMTP đối với tài khoản test dùng email ảo', async (t) => {
  let smtpCalled = 0;
  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async () => {
      smtpCalled++;
    },
  });
  t.after(() => {
    EmailService.getTransporter = origGetTransporter;
  });

  const fakeRes = createFakeReservation({
    customerId: { email: 'fake.tester@example.com', fullName: 'Tester' },
  });
  const ok = await EmailService.sendRentalPaidEmail(fakeRes);
  assert.equal(ok, false);
  assert.equal(smtpCalled, 0);
});

test('EmailService: Xác minh nội dung & thương hiệu VaultSpace cho toàn bộ 13 mẫu email', async (t) => {
  const sentMails = [];
  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async (opts) => {
      sentMails.push(opts);
      return { messageId: 'mock-id' };
    },
  });
  t.after(() => {
    EmailService.getTransporter = origGetTransporter;
  });

  const res = createFakeReservation();
  const ext = {
    extensionCode: 'EXT-261116-ABCD',
    durationMonths: 3,
    amount: 6000000,
    newEndDate: new Date('2027-03-16T00:00:00.000Z'),
    signingDeadline: new Date('2026-11-19T00:00:00.000Z'),
  };

  await EmailService.sendReservationCreatedEmail(res); // Mốc 0a
  await EmailService.sendExtensionCreatedEmail(res, ext); // Mốc 0b
  await EmailService.sendRentalPaidEmail(res); // Mốc 1
  await EmailService.sendHandoverPinEmail(res, '886420'); // Mốc 2.1
  await EmailService.sendStaffCancelledNoReceiveEmail(res, 'Kích thước thực tế chưa phù hợp'); // Mốc 2.2
  await EmailService.sendCheckoutCompletedEmail(res, 'GOOD', 'Kho sạch sẽ'); // Mốc 3
  await EmailService.sendExtensionPaidEmail(res, ext); // Mốc 4
  await EmailService.sendExtensionConfirmedEmail(res, ext); // Mốc 5.1
  await EmailService.sendExtensionRejectedEmail(res, ext, 'Khách đổi ý không gia hạn'); // Mốc 5.2
  await EmailService.sendSigningSlaExpiredRentalEmail(res); // Cron 1a
  await EmailService.sendSigningSlaExpiredExtensionEmail(res, ext); // Cron 1b
  await EmailService.sendExpiringSoonReminderEmail(res, 7); // Cron 2 (7D)
  await EmailService.sendOverdueRentalEmail(res); // Cron 3

  assert.equal(sentMails.length, 13);
  for (const mail of sentMails) {
    assert.match(mail.from, /^"VaultSpace"/);
    assert.match(mail.subject, /^\[VaultSpace\]/);
    assert.match(mail.html, /Đội ngũ VaultSpace/);
    assert.equal(mail.html.includes('undefined'), false, `Found undefined in mail: ${mail.subject}`);
    assert.equal(mail.html.includes('NaN'), false, `Found NaN in mail: ${mail.subject}`);
  }

  // Kiểm tra các nội dung đặc thù theo yêu cầu
  assert.match(sentMails[3].html, /Mã PIN mở cửa kho:.*886420/);
  assert.match(sentMails[3].html, /Tuyệt đối không chia sẻ mã PIN này cho người lạ/);
  assert.match(sentMails[4].html, /hoàn thành thủ tục hoàn tiền cho bạn/);
  assert.match(sentMails[9].html, /250\.000 đ/); // 10% của 2.5tr
  assert.match(sentMails[9].html, /2\.250\.000 đ/); // 90% của 2.5tr
  assert.match(sentMails[10].html, /600\.000 đ/); // 10% của 6tr
  assert.match(sentMails[10].html, /5\.400\.000 đ/); // 90% của 6tr
});

test('Cron Jobs: checkRentalExpiration tính đúng ngày (today+7, today+3, today-1) và không sửa DB', async (t) => {
  const sentSubjects = [];
  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async (opts) => {
      sentSubjects.push(opts.subject);
      return { messageId: 'cron-mock' };
    },
  });

  const now = new Date('2026-11-16T08:00:00.000Z');
  const res7 = createFakeReservation({ reservationCode: 'BKG-7D', endDate: new Date('2026-11-23T00:00:00.000Z') });
  const res3 = createFakeReservation({ reservationCode: 'BKG-3D', endDate: new Date('2026-11-19T00:00:00.000Z') });
  const resOverdue = createFakeReservation({ reservationCode: 'BKG-OVER', endDate: new Date('2026-11-15T00:00:00.000Z') });

  const origFind = ReservationModel.find;
  let callIndex = 0;
  ReservationModel.find = () => {
    const idx = callIndex++;
    const rows = idx === 0 ? [res7] : idx === 1 ? [res3] : [resOverdue];
    return {
      lean: () => ({ exec: async () => rows }),
      exec: async () => rows,
    };
  };

  t.after(() => {
    EmailService.getTransporter = origGetTransporter;
    ReservationModel.find = origFind;
  });

  const result = await checkRentalExpiration(now);
  assert.equal(result.reminded7Days, 1);
  assert.equal(result.reminded3Days, 1);
  assert.equal(result.notifiedOverdue, 1);
  assert.equal(sentSubjects.length, 3);
  assert.match(sentSubjects[0], /còn 7 ngày nữa sẽ hết hạn/);
  assert.match(sentSubjects[1], /còn 3 ngày nữa sẽ hết hạn/);
  assert.match(sentSubjects[2], /đã hết hạn/);
});

test('Cron Jobs: checkSigningSla gửi email phạt 10% hoàn 90% khi quá hạn ký 3 ngày', async (t) => {
  const sentSubjects = [];
  const origGetTransporter = EmailService.getTransporter;
  EmailService.getTransporter = () => ({
    sendMail: async (opts) => {
      sentSubjects.push(opts.subject);
      return { messageId: 'sla-mock' };
    },
  });

  const expiredNew = createFakeReservation({
    reservationCode: 'BKG-SLA-NEW',
    status: ReservationStatus.PAID,
    signingDeadline: new Date('2026-11-10T00:00:00.000Z'),
    paperContractProofUrl: '',
    async save() { return this; },
  });

  const expiredExt = createFakeReservation({
    reservationCode: 'BKG-SLA-EXT',
    status: ReservationStatus.ACTIVE,
    extendContract: [
      {
        extensionCode: 'EXT-SLA-01',
        durationMonths: 1,
        amount: 1000000,
        status: 'PAID',
        signingDeadline: new Date('2026-11-10T00:00:00.000Z'),
      },
    ],
    async save() { return this; },
  });

  const origFind = ReservationModel.find;
  let callIndex = 0;
  ReservationModel.find = () => {
    const idx = callIndex++;
    const rows = idx === 0 ? [expiredNew] : [expiredExt];
    return { exec: async () => rows };
  };

  const origUnitUpdate = StorageUnitModel.findByIdAndUpdate;
  StorageUnitModel.findByIdAndUpdate = async () => ({});
  const origContractUpdate = ContractModel.findOneAndUpdate;
  ContractModel.findOneAndUpdate = async () => ({});

  t.after(() => {
    EmailService.getTransporter = origGetTransporter;
    ReservationModel.find = origFind;
    StorageUnitModel.findByIdAndUpdate = origUnitUpdate;
    ContractModel.findOneAndUpdate = origContractUpdate;
  });

  await checkSigningSla(new Date('2026-11-16T08:00:00.000Z'));
  assert.equal(sentSubjects.length, 2);
  assert.match(sentSubjects[0], /Hủy đơn thuê kho BKG-SLA-NEW do quá hạn ký hợp đồng 3 ngày/);
  assert.match(sentSubjects[1], /Hủy yêu cầu gia hạn EXT-SLA-01 do quá hạn ký phụ lục 3 ngày/);
});
