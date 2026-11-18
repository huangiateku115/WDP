import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import { env } from '../config/env';
import { PAYOS_LIVE_TEST_AMOUNT } from '../config/payos-mock-mode';
import { PayosPaymentError, payosPaymentService } from '../services/payments/payos-payment.service';
import UserModel from '../models/users/user.model';
import ReservationModel from '../models/reservations/reservation.model';
import ContractModel from '../models/contracts/contract.model';
import customerPayosRoutes from '../routes/customer-payos.routes';
import { UserRole } from '../types/user.type';
import { FacilityServiceType } from '../types/facility.type';
import { ReservationStatus } from '../types/reservation.type';
import { ContractStatus } from '../types/contract.type';

export async function createPayosAuthMockApp() {
  const db = mongoose.connection.db;
  if (!env.authMockMode || !db || db.databaseName !== 'wdp_payos_test' ||
      mongoose.connection.host !== '127.0.0.1') {
    throw new Error('Mock auth requires a connection to the local PayOS test database');
  }
  const hello = await db.command({ hello: 1 });
  if (!hello.setName || !hello.isWritablePrimary || !hello.logicalSessionTimeoutMinutes) {
    throw new Error('Mock auth requires a writable MongoDB replica set with transactions');
  }

  const runId = randomUUID();
  const prefix = env.payosLiveTestMode ? 'payos-live-test-' : 'payos-mock-';
  const paymentAttemptKey = prefix + runId;
  const depositAmount = env.payosLiveTestMode ? PAYOS_LIVE_TEST_AMOUNT : 100_000;
  const makeCustomer = (name: string) => new UserModel({
    keycloakSub: paymentAttemptKey + '-' + name,
    email: name + '-' + runId + '@payos-mock.invalid',
    displayName: 'PayOS Test Customer ' + name,
    role: UserRole.CUSTOMER,
    isActive: true,
  });
  const owner = makeCustomer('A');
  const other = makeCustomer('B');
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  // Facility and pricing references are fixture-only. Checkout reads the Reservation snapshot.
  const reservation = new ReservationModel({
    reservationCode: paymentAttemptKey.toUpperCase(),
    customerId: owner._id, facilityId: new Types.ObjectId(), pricingPolicyId: new Types.ObjectId(),
    serviceType: FacilityServiceType.SELF_STORAGE, status: ReservationStatus.CONTRACTED,
    startDate: new Date(now + day), endDate: new Date(now + 31 * day), expiresAt: new Date(now + day),
    estimatedRent: env.payosLiveTestMode ? depositAmount : 300_000, depositAmount,
  });
  const contract = new ContractModel({
    contractCode: paymentAttemptKey.toUpperCase(),
    reservationId: reservation._id, customerId: owner._id, status: ContractStatus.DRAFT,
    customerSnapshot: { displayName: owner.displayName, email: owner.email },
    pricingSnapshot: { estimatedRent: reservation.estimatedRent, depositAmount: reservation.depositAmount },
  });
  await mongoose.connection.transaction(async session => {
    await owner.save({ session });
    await other.save({ session });
    await reservation.save({ session });
    await contract.save({ session });
  });

  const ownerToken = randomBytes(32).toString('base64url');
  const otherToken = randomBytes(32).toString('base64url');
  const customers = new Map([[ownerToken, owner], [otherToken, other]]);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  const routes = express.Router();
  routes.use((req, res, next) => {
    const authorization = req.get('Authorization');
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
    const customer = token && customers.get(token);
    if (!customer) {
      res.status(401).json({ success: false, message: 'Unauthorized: Invalid mock token' });
      return;
    }
    req.user = customer;
    next();
  });
  if (env.payosLiveTestMode) {
    const checkoutPath = '/' + reservation._id + '/payments/payos';
    const preflightPath = checkoutPath + '/live-test/preflight';
    routes.get(preflightPath, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (req.method !== 'GET' || req.user !== owner) { res.sendStatus(404); return; }
      try {
        const data = await payosPaymentService.preflightLiveTest();
        res.json({ success: true, data });
      } catch (error) {
        if (error instanceof PayosPaymentError) {
          res.status(error.status).json({ success: false, code: error.code, message: error.message });
        } else {
          res.status(500).json({ success: false, code: 'PAYOS_LIVE_TEST_PREFLIGHT_FAILED' });
        }
      }
    });
    routes.use((req, res, next) => {
      const orderLookup = req.method === 'GET' &&
        req.path.startsWith(checkoutPath + '/orders/') && /^[1-9][0-9]{0,9}$/.test(req.path.slice((checkoutPath + '/orders/').length));
      if (orderLookup) { next(); return; }
      if (req.method !== 'POST' || req.path !== checkoutPath || req.user !== owner) {
        res.sendStatus(404); return;
      }
      if (req.get('Idempotency-Key') !== paymentAttemptKey) {
        res.status(400).json({ success: false, code: 'PAYOS_LIVE_TEST_KEY_REQUIRED' }); return;
      }
      next();
    });
  }
  routes.use(customerPayosRoutes);
  app.use('/api/v1/reservations', routes);

  return {
    app,
    postman: {
      reservationId: String(reservation._id), reservationCode: reservation.reservationCode,
      customerAId: String(owner._id), customerBId: String(other._id), ownerToken, otherToken,
      paymentAttemptKey,
      ...(env.payosLiveTestMode ? { amount: depositAmount } : {}),
    },
  };
}
