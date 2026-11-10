import { createHash, randomInt } from 'node:crypto';
import mongoose, { ClientSession, Types } from 'mongoose';
import { InvalidSignatureError, PayOS, Webhook } from '@payos/node';
import ContractModel from '../../models/contracts/contract.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { lockManagedDepositHolds, ManagedReservationError } from '../reservations/managed-reservation.service';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { ContractStatus } from '../../types/contract.type';
import { FacilityServiceType } from '../../types/facility.type';
import { PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
import { ReservationStatus } from '../../types/reservation.type';
import { calculateRentalPaymentBreakdown, roundVndAmount } from './payment-accounting';

const PAYOS_INTENT_PREFIX = 'PAYOS-SS-';
const MAX_ORDER_CODE = 9_999_999_999;
const MIN_WDP_ORDER_CODE = 1_000_000_000;
const MAX_PAYOS_QR_PAYLOAD_LENGTH = 4096;
const PAYOS_PAYMENT_LINK_STATUSES = new Set(['PENDING', 'CANCELLED', 'UNDERPAID', 'PAID', 'EXPIRED', 'PROCESSING', 'FAILED']);
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_SDK_ERROR_NAMES = new Set([
  'APIError', 'BadRequestError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError',
  'TooManyRequestError', 'InternalServerError', 'ConnectionError', 'ConnectionTimeoutError',
  'UserAbortError', 'InvalidSignatureError', 'WebhookError', 'PayOSError', 'SyntaxError', 'Error', 'TypeError',
]);
const SAFE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN',
  'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET', 'ABORT_ERR',
]);
const PAYOS_SDK_ERROR_NAMES = new Set([
  'APIError', 'BadRequestError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError',
  'TooManyRequestError', 'InternalServerError', 'ConnectionError', 'ConnectionTimeoutError',
  'UserAbortError', 'InvalidSignatureError', 'WebhookError', 'PayOSError', 'SyntaxError',
]);
const Reservations: any = ReservationModel;
const Payments: any = ReservationPaymentModel;
const Contracts: any = ContractModel;

function paymentReservationFilter(reservation: any, customerId?: unknown) {
  const common: any = { _id: reservation?._id, serviceType: reservation?.serviceType,
    ...(customerId === undefined ? {} : { customerId }) };
  if (reservation?.serviceType === FacilityServiceType.MANAGED_INVENTORY) common.bookingFlowVersion = 3;
  else if (reservation?.serviceType !== FacilityServiceType.SELF_STORAGE) common.serviceType = '__UNSUPPORTED__';
  return common;
}
function managedV3(reservation: any) {
  return reservation?.serviceType === FacilityServiceType.MANAGED_INVENTORY && reservation?.bookingFlowVersion === 3;
}
function serviceSupported(reservation: any) {
  return reservation?.serviceType === FacilityServiceType.SELF_STORAGE || managedV3(reservation);
}
function hasCurrentManagedSignatures(contract: any) {
  const version = contract?.currentContentVersion;
  const content = contract?.contentVersions?.find((entry: any) => entry.version === version);
  if (!version || !content?.contentHash) return false;
  const signers = (contract.signatures ?? []).filter((signature: any) => signature.version === version && signature.contentHash === content.contentHash);
  return signers.some((signature: any) => signature.signerRole === 'CUSTOMER') &&
    signers.some((signature: any) => ['FACILITY_STAFF', 'FACILITY_MANAGER'].includes(signature.signerRole));
}

export class PayosPaymentError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'PayosPaymentError';
  }
}

export interface PayosGateway {
  create(data: { orderCode: number; amount: number; description: string; cancelUrl: string; returnUrl: string }): Promise<{
    orderCode: number; amount: number; currency: string; paymentLinkId: string; checkoutUrl: string; qrCode?: string; status: string;
  }>;
  get(orderCode: number, options?: { requireSignature: true }): Promise<{ id?: string; orderCode: number; amount: number; amountPaid: number; status: string; transactions?: Array<{ reference: string; amount: number }> }>;
  verify(webhook: Webhook): Promise<{
    orderCode: number; amount: number; currency: string; paymentLinkId: string; reference: string; description?: string;
    transactionDateTime: string; code: string; desc: string;
  }>;
}

export interface PayosPaymentServiceOptions {
  gateway?: PayosGateway;
  enabled?: boolean;
  now?: () => Date;
  createSession?: () => Promise<ClientSession>;
}

function enabledByEnvironment(): boolean {
  return process.env.PAYOS_ENABLED?.trim().toLowerCase() === 'true';
}

function configuredUrl(name: string): string {
  const raw = process.env[name]?.trim();
  try {
    const parsed = new URL(raw || '');
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password ||
        (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error();
    return parsed.toString();
  } catch {
    throw new PayosPaymentError(503, 'PAYOS_CONFIGURATION_MISSING', `${name} must be configured as a valid public URL`);
  }
}

function configuredCustomerOrigin(): URL {
  const raw = process.env.PAYOS_CUSTOMER_ORIGIN?.trim();
  try {
    if (!raw || !/^https?:\/\/[^/?#]+\/?$/i.test(raw)) throw new Error();
    const parsed = new URL(raw);
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin === 'null' ||
        (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) throw new Error();
    return parsed;
  } catch {
    throw new PayosPaymentError(503, 'PAYOS_CONFIGURATION_MISSING',
      'PAYOS_CUSTOMER_ORIGIN must be configured as a valid Customer origin');
  }
}

function customerPaymentUrls(payment: any, channel: 'WEB' | 'MOBILE' = 'WEB'): { returnUrl: string; cancelUrl: string } {
  const reservationId = id(payment?.reservationId);
  if (!/^[a-f\d]{24}$/i.test(reservationId) || !Types.ObjectId.isValid(reservationId)) {
    throw new PayosPaymentError(503, 'PAYMENT_RESERVATION_ID_INVALID',
      'Payment intent has an invalid Reservation identity');
  }
  const params = new URLSearchParams({ reservationId, paymentId: id(payment?._id), serviceType: payment?.serviceType });
  if (channel === 'MOBILE') {
    if (payment?.serviceType !== FacilityServiceType.SELF_STORAGE) {
      throw new PayosPaymentError(400, 'MOBILE_PAYMENT_UNSUPPORTED', 'Native PayOS return is supported only for Self Storage');
    }
    // Fixed to the registered Expo scheme. Never accept a redirect URL from a client.
    const callback = new URL(`vaultspace-customer://payments/return?${params}`);
    const cancel = new URL(callback);
    cancel.searchParams.set('cancel', 'true');
    return { returnUrl: callback.toString(), cancelUrl: cancel.toString() };
  }
  const origin = configuredCustomerOrigin();
  return {
    returnUrl: new URL(`/portal/payments/return?${params}`, origin).toString(),
    cancelUrl: new URL(`/portal/payments/return?${params}&cancel=true`, origin).toString(),
  };
}

function defaultGateway(): PayosGateway {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
  if (!clientId || !apiKey || !checksumKey) {
    throw new PayosPaymentError(503, 'PAYOS_CONFIGURATION_MISSING', 'PayOS server configuration is unavailable');
  }
  // SDK debug output can include request details; WDP emits its own allowlisted diagnostics.
  const options = { clientId, apiKey, checksumKey, logLevel: 'off' as const };
  const sdk = new PayOS(options);
  return {
    // A create-link timeout is ambiguous. Never let the SDK silently POST the same
    // financial operation again; keep the intent UNKNOWN and reconcile by orderCode.
    create: async data => sdk.paymentRequests.create(data, { maxRetries: 0 }),
    get: async (orderCode, lookupOptions) => {
      if (!lookupOptions?.requireSignature) return sdk.paymentRequests.get(orderCode);
      // The SDK verifies the signature when present. Require it for the new read-only lookup.
      let signaturePresent = false;
      const signedLookupSdk = new PayOS({
        ...options,
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init);
          if (response.ok) {
            const envelope = await response.clone().json().catch(() => null);
            signaturePresent = typeof envelope?.signature === 'string' && /^[a-f0-9]{64}$/.test(envelope.signature);
          }
          return response;
        },
      });
      const link = await signedLookupSdk.paymentRequests.get(orderCode);
      if (!signaturePresent) throw new InvalidSignatureError('PayOS lookup response is missing a valid signature');
      return link;
    },
    verify: async webhook => sdk.webhooks.verify(webhook),
  };
}

function id(value: unknown): string { return String(value ?? ''); }
function version(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function versionFilter(value: unknown): Record<string, unknown> {
  const current = version(value);
  return current === 0 ? { $or: [{ inventoryVersion: 0 }, { inventoryVersion: { $exists: false } }] } : { inventoryVersion: current };
}
function paymentKey(key: string): string { return `${PAYOS_INTENT_PREFIX}${key}`; }
function parseOrderCode(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_ORDER_CODE ? parsed : null;
}
function numericOrderCode(value: unknown): number {
  const parsed = parseOrderCode(value);
  if (parsed === null) {
    throw new PayosPaymentError(503, 'PAYOS_ORDER_CODE_INVALID', 'Payment intent has an invalid provider order code');
  }
  return parsed;
}
function newOrderCode(): number { return randomInt(1_000_000_000, MAX_ORDER_CODE); }
function captureHash(event: { orderCode: number; reference: string; amount: number; currency: string; paymentLinkId: string; transactionDateTime: string }): string {
  return createHash('sha256').update([event.orderCode, event.reference, event.amount, event.currency,
    event.paymentLinkId, event.transactionDateTime].join('|')).digest('hex');
}
function outcomeHash(event: { orderCode: number; reference: string; amount: number; currency: string; paymentLinkId: string; transactionDateTime: string; code: string }): string {
  return createHash('sha256').update([event.orderCode, event.reference, event.amount, event.currency,
    event.paymentLinkId, event.transactionDateTime, event.code].join('|')).digest('hex');
}
function checkoutCorrelationId(payment: any): string {
  return createHash('sha256').update(`PAYOS_CHECKOUT:${id(payment?._id)}`).digest('hex').slice(0, 16);
}
type ProviderCreateErrorCategory = 'PAYOS_PROVIDER_AUTH_ERROR' | 'PAYOS_PROVIDER_VALIDATION_ERROR' |
  'PAYOS_PROVIDER_RATE_LIMITED' | 'PAYOS_PROVIDER_NETWORK_ERROR' | 'PAYOS_PROVIDER_TIMEOUT' |
  'PAYOS_PROVIDER_MALFORMED_RESPONSE' | 'PAYOS_PROVIDER_SDK_ERROR' | 'PAYOS_PROVIDER_BUSINESS_NON_SUCCESS' | 'PAYOS_PROVIDER_UNKNOWN_ERROR';
interface SafeProviderErrorDiagnostic {
  sdkErrorName: string;
  providerHttpStatus: number | null;
  providerErrorCode: string | null;
  networkErrorCode: string | null;
  providerDescription: string;
  category: ProviderCreateErrorCategory;
}
function safeErrorCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' && /^[A-Z0-9_-]{1,32}$/.test(value) ? value : null;
}
function safeNetworkCode(value: unknown): string | null {
  return typeof value === 'string' && SAFE_NETWORK_ERROR_CODES.has(value) ? value : null;
}
// Fixed labels only. Provider descriptions can contain account or request data.
function safeProviderDescription(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'UNAVAILABLE';
  switch (value.trim().toLowerCase()) {
    case 'invalid signature': return 'INVALID_SIGNATURE';
    case 'invalid amount': return 'INVALID_AMOUNT';
    case 'invalid order code': return 'INVALID_ORDER_CODE';
    case 'invalid description': return 'INVALID_DESCRIPTION';
    default: return 'REDACTED';
  }
}
function classifyProviderError(error: unknown): SafeProviderErrorDiagnostic {
  const candidate = error as any;
  const rawName = typeof candidate?.name === 'string' ? candidate.name : '';
  const sdkErrorName = SAFE_SDK_ERROR_NAMES.has(rawName) ? rawName : 'UNKNOWN';
  const rawStatus = candidate?.status;
  const providerHttpStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
  const providerErrorCode = providerHttpStatus === null ? null : safeErrorCode(candidate?.code);
  const networkErrorCode = safeNetworkCode(candidate?.cause?.code) ?? safeNetworkCode(candidate?.code);
  const timeout = providerHttpStatus === 408 || rawName === 'ConnectionTimeoutError' ||
    ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(networkErrorCode || '');
  const successfulHttpError = rawName === 'APIError' && providerHttpStatus !== null &&
    providerHttpStatus >= 200 && providerHttpStatus < 300;
  const businessNonSuccess = successfulHttpError && providerErrorCode !== null && providerErrorCode !== '00';
  const malformedResponse = rawName === 'SyntaxError' || rawName === 'InvalidSignatureError' ||
    (successfulHttpError && !businessNonSuccess);
  const category: ProviderCreateErrorCategory = providerHttpStatus === 401 || providerHttpStatus === 403
    ? 'PAYOS_PROVIDER_AUTH_ERROR'
    : providerHttpStatus === 429
      ? 'PAYOS_PROVIDER_RATE_LIMITED'
      : providerHttpStatus === 400 || providerHttpStatus === 422
        ? 'PAYOS_PROVIDER_VALIDATION_ERROR'
        : timeout
          ? 'PAYOS_PROVIDER_TIMEOUT'
          : networkErrorCode || rawName === 'ConnectionError'
            ? 'PAYOS_PROVIDER_NETWORK_ERROR'
            : malformedResponse
              ? 'PAYOS_PROVIDER_MALFORMED_RESPONSE'
              : providerHttpStatus !== null
                ? businessNonSuccess ? 'PAYOS_PROVIDER_BUSINESS_NON_SUCCESS' : 'PAYOS_PROVIDER_UNKNOWN_ERROR'
                : PAYOS_SDK_ERROR_NAMES.has(rawName)
                  ? 'PAYOS_PROVIDER_SDK_ERROR'
                  : 'PAYOS_PROVIDER_UNKNOWN_ERROR';
  return { sdkErrorName, providerHttpStatus, providerErrorCode, networkErrorCode,
    providerDescription: safeProviderDescription(candidate?.desc ?? candidate?.error?.desc), category };
}
function logCheckoutDiagnostic(payment: any, category: string, stage: string, providerCreateInvoked: boolean | null,
  providerResponseReceived: boolean, persistenceConfirmed: boolean | null,
  providerError?: SafeProviderErrorDiagnostic): void {
  // persistenceConfirmed means the checkout URL/link identity was written and read back successfully.
  // Keep this allowlisted record free of exception/provider payloads, URLs and payment data.
  console.warn('PAYOS_CHECKOUT_DIAGNOSTIC', {
    category, stage, correlationId: checkoutCorrelationId(payment), providerCreateInvoked,
    providerResponseReceived, persistenceConfirmed,
    ...(providerError ? {
      sdkErrorName: providerError.sdkErrorName,
      providerHttpStatus: providerError.providerHttpStatus ?? 'UNKNOWN',
      providerErrorCode: providerError.providerErrorCode ?? 'UNKNOWN',
      networkErrorCode: providerError.networkErrorCode ?? 'UNKNOWN',
      providerDescription: providerError.providerDescription,
    } : {}),
  });
}
function isDocumentedRegistrationProbe(event: {
  orderCode: number; amount: number; currency: string; paymentLinkId: string; reference: string;
  description?: string; transactionDateTime: string; code: string; desc: string;
}): boolean {
  // Exact signed sample from PayOS's webhook/confirm-webhook documentation.
  // WDP-generated order codes are >= MIN_WDP_ORDER_CODE.
  return event.orderCode === 123 && event.orderCode < MIN_WDP_ORDER_CODE && event.amount === 3000 &&
    event.currency === 'VND' && event.paymentLinkId === '124c33293c43417ab7879e14c8d9eb18' &&
    event.reference === 'TF230204212323' && event.description === 'VQRIO123' &&
    event.transactionDateTime === '2023-02-04 18:25:00' && event.code === '00' && event.desc === 'Thành công';
}
function assertKey(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 120 || /[\r\n]/.test(input)) {
    throw new PayosPaymentError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required');
  }
  return input.trim();
}
function assertPurpose(input: unknown): PaymentPurpose {
  if (input !== PaymentPurpose.DEPOSIT && input !== PaymentPurpose.BALANCE) {
    throw new PayosPaymentError(400, 'INVALID_PAYMENT_PURPOSE', 'purpose must be DEPOSIT or BALANCE');
  }
  return input;
}
function assertEnabled(enabled: boolean): void {
  if (!enabled) throw new PayosPaymentError(404, 'PAYOS_CHECKOUT_DISABLED', 'PayOS checkout is disabled');
}
function isValidPayosQrPayload(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= MAX_PAYOS_QR_PAYLOAD_LENGTH &&
    value.trim() === value && value.startsWith('000201') && /^[\x20-\x7E]+$/.test(value);
}
function isSafePayosCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}
function errorHasLabel(error: any, label: string): boolean {
  return error?.hasErrorLabel?.(label) === true || error?.errorLabels?.includes?.(label) === true;
}
function isConflict(error: any): boolean {
  return error?.code === 11000 || error?.code === 112 || error?.codeName === 'WriteConflict' ||
    error?.name === 'VersionError' || errorHasLabel(error, 'TransientTransactionError');
}
function statusDto(payment: any, currentIntentEligible = false, retryAllowed = false) {
  const canPresentCheckout = currentIntentEligible && payment.provider === PaymentProvider.PAYOS &&
    payment.status === PaymentStatus.PENDING && payment.checkoutState === 'READY' &&
    isSafePayosCheckoutUrl(payment.checkoutUrl) && payment.applicationStatus !== PaymentApplicationStatus.MANUAL_REVIEW &&
    payment.providerSettlementStatus !== ProviderSettlementStatus.VERIFIED;
  const orderCode = parseOrderCode(payment.providerReference);
  return {
    ...(canPresentCheckout && orderCode !== null &&
      typeof payment.providerPaymentLinkId === 'string' && payment.providerPaymentLinkId.trim()
      ? { orderCode, paymentLinkId: payment.providerPaymentLinkId } : {}),
    id: id(payment._id), reservationId: id(payment.reservationId), purpose: payment.purpose,
    amount: payment.amount, currency: payment.currency, provider: payment.provider,
    providerSettlementStatus: payment.providerSettlementStatus ?? ProviderSettlementStatus.NOT_VERIFIED,
    status: payment.status, applicationStatus: payment.applicationStatus ?? PaymentApplicationStatus.NOT_APPLIED,
    checkoutStatus: payment.checkoutState ?? 'UNKNOWN',
    checkoutUrl: canPresentCheckout ? payment.checkoutUrl ?? null : null,
    qrCode: canPresentCheckout && isValidPayosQrPayload(payment.qrCode) ? payment.qrCode : null,
    succeededAt: payment.succeededAt ?? null, reconciliationRequired: payment.applicationStatus === PaymentApplicationStatus.MANUAL_REVIEW ||
      payment.status === PaymentStatus.RECONCILIATION_REQUIRED,
    cancelVerifiedAt: payment.cancelVerifiedAt ?? null,
    retryAllowed,
  };
}

const PAYOS_HISTORY_DEFAULT_LIMIT = 10;
const PAYOS_HISTORY_MAX_LIMIT = 25;
const PAYOS_HISTORY_MAX_TIME_MS = 2_000;

function historyLimit(input: unknown): number {
  if (input === undefined) return PAYOS_HISTORY_DEFAULT_LIMIT;
  const value = typeof input === 'number' ? input : typeof input === 'string' && /^\d{1,3}$/.test(input) ? Number(input) : NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > PAYOS_HISTORY_MAX_LIMIT) {
    throw new PayosPaymentError(400, 'INVALID_PAYMENT_HISTORY_LIMIT', `limit must be an integer from 1 to ${PAYOS_HISTORY_MAX_LIMIT}`);
  }
  return value;
}

function encodeHistoryCursor(payment: any): string {
  return Buffer.from(`${new Date(payment.createdAt).toISOString()}|${id(payment._id)}`).toString('base64url');
}

function decodeHistoryCursor(input: unknown): { createdAt: Date; paymentId: Types.ObjectId } | null {
  if (input === undefined) return null;
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input)) {
    throw new PayosPaymentError(400, 'INVALID_PAYMENT_HISTORY_CURSOR', 'cursor is invalid');
  }
  try {
    const decoded = Buffer.from(input, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== input) throw new Error();
    const parts = decoded.split('|');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error();
    const timestamp = parts[0];
    const paymentId = parts[1];
    const createdAt = new Date(timestamp);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== timestamp || !Types.ObjectId.isValid(paymentId)) throw new Error();
    return { createdAt, paymentId: new Types.ObjectId(paymentId) };
  } catch {
    throw new PayosPaymentError(400, 'INVALID_PAYMENT_HISTORY_CURSOR', 'cursor is invalid');
  }
}

export class PayosPaymentService {
  private readonly enabled: boolean;
  private readonly now: () => Date;
  private readonly createSession: () => Promise<ClientSession>;
  private gatewayValue: PayosGateway | undefined;

  constructor(private readonly options: PayosPaymentServiceOptions = {}) {
    this.enabled = options.enabled ?? enabledByEnvironment();
    this.now = options.now ?? (() => new Date());
    this.createSession = options.createSession ?? (() => mongoose.startSession());
    this.gatewayValue = options.gateway;
  }

  private get gateway(): PayosGateway {
    this.gatewayValue ??= defaultGateway();
    return this.gatewayValue;
  }

  private assertConfiguration(channel: 'WEB' | 'MOBILE' = 'WEB'): void {
    void this.gateway;
    if (channel === 'WEB') configuredCustomerOrigin();
    configuredUrl('PAYOS_WEBHOOK_URL');
  }

  private async customerStatusDto(payment: any) {
    if (payment.status !== PaymentStatus.PENDING || payment.checkoutState !== 'READY' ||
        payment.applicationStatus === PaymentApplicationStatus.MANUAL_REVIEW ||
        payment.providerSettlementStatus === ProviderSettlementStatus.VERIFIED) return statusDto(payment);
    const reservation = await Reservations.findOne({ _id: payment.reservationId, customerId: payment.customerId,
      serviceType: payment.serviceType, ...(payment.serviceType === FacilityServiceType.MANAGED_INVENTORY ? { bookingFlowVersion: 3 } : {}) }).exec();
    return statusDto(payment, await this.currentIntentIssue(payment, reservation) === null);
  }

  async createCheckout(reservationIdInput: unknown, purposeInput: unknown, keyInput: unknown, customerId: unknown, channelInput: unknown = 'WEB') {
    assertEnabled(this.enabled);
    if (channelInput !== 'WEB' && channelInput !== 'MOBILE') {
      throw new PayosPaymentError(400, 'INVALID_PAYMENT_RETURN_CHANNEL', 'Payment return channel is invalid');
    }
    const channel = channelInput;
    const purpose = assertPurpose(purposeInput);
    const key = paymentKey(assertKey(keyInput));
    const reservationId = id(reservationIdInput);
    if (!Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');

    if (purpose === PaymentPurpose.BALANCE) {
      const zero = await this.settleManagedZeroBalance(reservationId, customerId, key);
      if (zero) return { ...zero, outcome: 'SETTLED', httpStatus: 200 };
    }
    this.assertConfiguration(channel);

    const prior = await Payments.findOne({ idempotencyKey: key }).exec();
    if (prior) return this.replayExisting(prior, reservationId, purpose, customerId, channel);

    let intent: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        intent = await this.createIntentTransaction(reservationId, purpose, key, customerId, newOrderCode());
        break;
      } catch (error: any) {
        if (error instanceof PayosPaymentError) throw error;
        if (error?.code === 11000) {
          const winner = await Payments.findOne({ idempotencyKey: key }).exec();
          if (winner) return this.replayExisting(winner, reservationId, purpose, customerId, channel);
          if (attempt < 2) continue;
          throw new PayosPaymentError(409, 'PAYMENT_INTENT_CONFLICT', 'A conflicting payment intent already exists');
        }
        if (errorHasLabel(error, 'UnknownTransactionCommitResult')) {
          const committed = await Payments.findOne({ idempotencyKey: key }).exec().catch(() => null);
          if (committed) return this.replayExisting(committed, reservationId, purpose, customerId, channel);
          throw new PayosPaymentError(503, 'PAYMENT_INTENT_OUTCOME_UNKNOWN', 'Payment intent outcome is uncertain; retry with the same key');
        }
        if (isConflict(error)) throw new PayosPaymentError(409, 'RESERVATION_CHANGED', 'Reservation changed concurrently; refresh and retry');
        throw error;
      }
    }
    if (!intent) throw new PayosPaymentError(503, 'PAYMENT_INTENT_OUTCOME_UNKNOWN', 'Payment intent outcome is uncertain; retry with the same key');
    if (intent.replayed) return this.replayExisting(intent.payment, reservationId, purpose, customerId, channel);

    return this.createProviderLink(intent.payment, channel);
  }

  private async settleManagedZeroBalance(reservationId: string, customerId: unknown, idempotencyKey: string) {
    const session = await this.createSession();
    try {
      let result: any = null;
      await session.withTransaction(async () => {
        const reservation = await Reservations.findOne({ _id: reservationId, customerId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3,
          status: { $in: [ReservationStatus.DEPOSIT_PAID, ReservationStatus.PAID] } }).session(session).exec();
        if (!reservation) return;
        const contract = await Contracts.findOne({ reservationId, customerId }).session(session).exec();
        if (!contract || contract.status !== ContractStatus.SIGNED || !hasCurrentManagedSignatures(contract)) throw new PayosPaymentError(409, 'BALANCE_NOT_ELIGIBLE', 'Managed V3 Balance requires both current contract signatures');
        const deposit = reservation.depositPaymentId ? await Payments.findOne({ _id: reservation.depositPaymentId, reservationId,
          customerId, facilityId: reservation.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
          purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
          providerSettlementStatus: ProviderSettlementStatus.VERIFIED, applicationStatus: PaymentApplicationStatus.APPLIED }).session(session).exec() : null;
        if (!deposit || deposit.amount !== roundVndAmount(Number(reservation.depositAmount))) throw new PayosPaymentError(409, 'VERIFIED_DEPOSIT_REQUIRED', 'A verified applied Managed V3 Deposit is required before Balance');
        const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
          depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
        if (roundVndAmount(breakdown.totalDue) !== deposit.amount) return;
        if (reservation.status === ReservationStatus.PAID && reservation.balanceSettledAt) {
          if (reservation.balanceSettlementKey !== idempotencyKey) throw new PayosPaymentError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Zero-balance settlement must be retried with its original Idempotency-Key');
          result = { zeroBalance: true, reservation: { _id: reservation._id, serviceType: reservation.serviceType,
            bookingFlowVersion: reservation.bookingFlowVersion, status: reservation.status, balanceSettledAt: reservation.balanceSettledAt } };
          return;
        }
        const time = this.now();
        const updated = await Reservations.findOneAndUpdate({ _id: reservation._id, customerId, facilityId: reservation.facilityId,
          serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3, status: ReservationStatus.DEPOSIT_PAID,
          $and: [versionFilter(reservation.inventoryVersion)] }, {
          $inc: { inventoryVersion: 1 }, $set: { status: ReservationStatus.PAID, balanceSettledAt: time, balanceSettledBy: customerId, balanceSettlementKey: idempotencyKey },
          $push: { statusHistory: { status: ReservationStatus.PAID, actorId: customerId, reason: 'Managed V3 has zero remaining balance after verified Deposit and current contract signatures', createdAt: time } },
        }, { new: true, session, runValidators: true }).exec();
        if (!updated) throw new PayosPaymentError(409, 'RESERVATION_CHANGED', 'Reservation changed while settling zero balance');
        result = { zeroBalance: true, reservation: { _id: updated._id, serviceType: updated.serviceType,
          bookingFlowVersion: updated.bookingFlowVersion, status: updated.status, balanceSettledAt: updated.balanceSettledAt } };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      return result;
    } finally { await session.endSession(); }
  }

  private async replayExisting(payment: any, reservationId: string, purpose: PaymentPurpose, customerId: unknown, channel: 'WEB' | 'MOBILE' = 'WEB') {
    if (id(payment.reservationId) !== reservationId || id(payment.customerId) !== id(customerId) ||
        ![FacilityServiceType.SELF_STORAGE, FacilityServiceType.MANAGED_INVENTORY].includes(payment.serviceType) || payment.provider !== PaymentProvider.PAYOS ||
        payment.purpose !== purpose) {
      throw new PayosPaymentError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key belongs to a different payment identity');
    }
    const reservation = await Reservations.findOne({ _id: reservationId, customerId,
      serviceType: payment.serviceType, ...(payment.serviceType === FacilityServiceType.MANAGED_INVENTORY ? { bookingFlowVersion: 3 } : {}) }).exec();
    if (!reservation) {
      throw new PayosPaymentError(409, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE', 'Original payment status remains available, but its Reservation is no longer eligible for checkout');
    }
    if (id(reservation.facilityId) !== id(payment.facilityId)) {
      throw new PayosPaymentError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Reservation Facility no longer matches the original payment intent');
    }

    // A completed/reconciliation intent remains queryable, but its old checkout URL
    // must not be presented as a newly eligible payment attempt.
    if (payment.status !== PaymentStatus.PENDING) {
      return { ...statusDto(payment), checkoutUrl: null, outcome: 'REPLAYED', httpStatus: 200 };
    }

    const now = this.now();
    const contract = await Contracts.findOne({ reservationId: reservation._id, customerId: reservation.customerId }).exec();
    if (!serviceSupported(reservation) || reservation.serviceType !== payment.serviceType) throw new PayosPaymentError(409, 'PAYMENT_SERVICE_UNSUPPORTED', 'Payment service type does not match the reservation');
    let expectedAmount: number;
    if (purpose === PaymentPurpose.DEPOSIT) {
      if (managedV3(reservation)) {
        if (reservation.status !== ReservationStatus.RESERVED || !reservation.expiresAt || reservation.expiresAt <= now) throw new PayosPaymentError(409, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE', 'Managed V3 Deposit requires an unexpired RESERVED reservation');
        expectedAmount = roundVndAmount(Number(reservation.depositAmount));
      } else {
        if (reservation.status !== ReservationStatus.CONTRACTED || !reservation.expiresAt || reservation.expiresAt <= now ||
            !contract || contract.status !== ContractStatus.DRAFT) throw new PayosPaymentError(409, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE', 'Original Deposit intent is not currently eligible; query its status separately');
        const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
          depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
        expectedAmount = roundVndAmount(breakdown.depositCredit);
      }
    } else {
      if (managedV3(reservation)) {
        if (reservation.status !== ReservationStatus.DEPOSIT_PAID || !contract || contract.status !== ContractStatus.SIGNED || !hasCurrentManagedSignatures(contract)) throw new PayosPaymentError(409, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE', 'Managed V3 Balance requires both signatures on the current contract version');
      } else if (reservation.status !== ReservationStatus.CHECKIN_READY || !contract || contract.status !== ContractStatus.SIGNED ||
          !contract.signedProofPublicId || !contract.signedProofUrl || !contract.verifiedAt) {
        throw new PayosPaymentError(409, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE', 'Original Balance intent is not currently eligible; query its payment status separately');
      }
      const deposit = reservation.depositPaymentId
        ? await Payments.findOne({ _id: reservation.depositPaymentId, reservationId: reservation._id,
          customerId: reservation.customerId, facilityId: reservation.facilityId, serviceType: reservation.serviceType,
          purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
          applicationStatus: PaymentApplicationStatus.APPLIED }).exec()
        : null;
      if (!deposit || deposit.amount !== roundVndAmount(Number(reservation.depositAmount))) {
        throw new PayosPaymentError(409, 'PAYMENT_INTENT_NO_LONGER_ELIGIBLE', 'A verified applied Deposit is required; query the original payment status separately');
      }
      const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
        depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
      expectedAmount = roundVndAmount(breakdown.totalDue) - deposit.amount;
    }
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || payment.currency !== 'VND' ||
        payment.amount !== expectedAmount) {
      throw new PayosPaymentError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Current payment amount or currency differs from the immutable original intent; query its status separately');
    }
    if (payment.checkoutState === 'NOT_CREATED') return this.createProviderLink(payment, channel);
    if (payment.checkoutState === 'CREATING') {
      const claimAge = payment.updatedAt instanceof Date ? this.now().getTime() - payment.updatedAt.getTime() : 0;
      if (claimAge < 60_000) throw new PayosPaymentError(503, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN', 'Checkout creation is already in progress; retry the same key shortly');
      await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING, checkoutState: 'CREATING', updatedAt: payment.updatedAt }, {
        $set: { checkoutState: 'UNKNOWN', reconciliationReason: 'Checkout creation worker stopped before persisting its outcome' },
      }).exec();
      const stale = await Payments.findById(payment._id).exec();
      if (stale?.checkoutState === 'UNKNOWN') {
        await this.reconcileCheckoutState(stale).catch(() => undefined);
        const reconciled = await Payments.findById(payment._id).exec();
        if (reconciled?.checkoutState === 'READY' && reconciled.checkoutUrl) {
          return { ...await this.customerStatusDto(reconciled), outcome: 'REPLAYED', httpStatus: 200 };
        }
      }
      throw new PayosPaymentError(503, 'PAYMENT_OUTCOME_UNKNOWN', 'Payment outcome is uncertain; do not create another payment attempt');
    }
    if (payment.checkoutState === 'UNKNOWN') {
      await this.reconcileCheckoutState(payment).catch(() => undefined);
      const refreshed = await Payments.findById(payment._id).exec();
      if (refreshed?.checkoutState === 'READY' && refreshed.checkoutUrl) {
        return { ...await this.customerStatusDto(refreshed), outcome: 'REPLAYED', httpStatus: 200 };
      }
      throw new PayosPaymentError(503, 'PAYMENT_OUTCOME_UNKNOWN', 'Payment link outcome is uncertain; do not create another payment');
    }
    if (payment.checkoutState === 'RECONCILIATION_REQUIRED') return { ...statusDto(payment), outcome: 'REPLAYED', httpStatus: 200 };
    return { ...statusDto(payment, payment.status === PaymentStatus.PENDING && payment.checkoutState === 'READY'),
      outcome: 'REPLAYED', httpStatus: 200 };
  }

  private async currentIntentIssue(payment: any, reservation: any): Promise<'FACILITY_CHANGED' | 'ECONOMIC_IDENTITY_CHANGED' | 'NOT_ELIGIBLE' | null> {
    if (!reservation || id(reservation.facilityId) !== id(payment.facilityId)) return 'FACILITY_CHANGED';
    const contract = await Contracts.findOne({ reservationId: reservation._id, customerId: reservation.customerId }).exec();
    if (!serviceSupported(reservation) || reservation.serviceType !== payment.serviceType) return 'NOT_ELIGIBLE';
    let expectedAmount: number;
    if (payment.purpose === PaymentPurpose.DEPOSIT) {
      if (managedV3(reservation)) {
        if (reservation.status !== ReservationStatus.RESERVED || !reservation.expiresAt || reservation.expiresAt <= this.now()) return 'NOT_ELIGIBLE';
        expectedAmount = roundVndAmount(Number(reservation.depositAmount));
      } else {
        if (reservation.status !== ReservationStatus.CONTRACTED || !reservation.expiresAt || reservation.expiresAt <= this.now() ||
            !contract || contract.status !== ContractStatus.DRAFT) return 'NOT_ELIGIBLE';
        const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
          depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
        expectedAmount = roundVndAmount(breakdown.depositCredit);
      }
    } else if (payment.purpose === PaymentPurpose.BALANCE) {
      if (managedV3(reservation)) {
        if (reservation.status !== ReservationStatus.DEPOSIT_PAID || !contract || contract.status !== ContractStatus.SIGNED || !hasCurrentManagedSignatures(contract)) return 'NOT_ELIGIBLE';
      } else if (reservation.status !== ReservationStatus.CHECKIN_READY || !contract || contract.status !== ContractStatus.SIGNED ||
          !contract.signedProofPublicId || !contract.signedProofUrl || !contract.verifiedAt) return 'NOT_ELIGIBLE';
      const deposit = reservation.depositPaymentId
        ? await Payments.findOne({ _id: reservation.depositPaymentId, reservationId: reservation._id,
          customerId: reservation.customerId, facilityId: reservation.facilityId, serviceType: reservation.serviceType,
          purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
          applicationStatus: PaymentApplicationStatus.APPLIED }).exec()
        : null;
      if (!deposit || deposit.amount !== roundVndAmount(Number(reservation.depositAmount))) return 'NOT_ELIGIBLE';
      const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
        depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
      expectedAmount = roundVndAmount(breakdown.totalDue) - deposit.amount;
    } else return 'NOT_ELIGIBLE';
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || payment.currency !== 'VND' || payment.amount !== expectedAmount) {
      return 'ECONOMIC_IDENTITY_CHANGED';
    }
    return null;
  }

  private async createIntentTransaction(reservationId: string, purpose: PaymentPurpose, idempotencyKey: string,
    customerId: unknown, orderCode: number) {
    const session = await this.createSession();
    let outcome: any;
    try {
      await session.withTransaction(async () => {
        const prior = await Payments.findOne({ idempotencyKey }).session(session).exec();
        if (prior) {
          if (id(prior.reservationId) !== reservationId || id(prior.customerId) !== id(customerId) ||
              prior.purpose !== purpose || prior.provider !== PaymentProvider.PAYOS ||
              ![FacilityServiceType.SELF_STORAGE, FacilityServiceType.MANAGED_INVENTORY].includes(prior.serviceType)) {
            throw new PayosPaymentError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Idempotency-Key belongs to a different payment identity');
          }
          outcome = { payment: prior, replayed: true };
          return;
        }

        const now = this.now();
        const reservation = await Reservations.findOne({ _id: reservationId, customerId,
          $or: [{ serviceType: FacilityServiceType.SELF_STORAGE }, { serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }] }).session(session).exec();
        if (!reservation) throw new PayosPaymentError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
        if (!serviceSupported(reservation)) throw new PayosPaymentError(409, 'PAYMENT_SERVICE_UNSUPPORTED', 'PayOS supports Self Storage and Managed V3 reservations only');
        const contract = await Contracts.findOne({ reservationId: reservation._id, customerId: reservation.customerId }).session(session).exec();
        if (!managedV3(reservation) && !contract) throw new PayosPaymentError(409, 'CONTRACT_REQUIRED', 'The existing Reservation contract is required');

        let amount: number;
        if (purpose === PaymentPurpose.DEPOSIT) {
          if (managedV3(reservation)) {
            if (reservation.status !== ReservationStatus.RESERVED || !reservation.expiresAt || reservation.expiresAt <= now) throw new PayosPaymentError(409, 'DEPOSIT_NOT_ELIGIBLE', 'Managed V3 Deposit requires an unexpired RESERVED reservation');
            amount = roundVndAmount(Number(reservation.depositAmount));
          } else {
            if (reservation.status !== ReservationStatus.CONTRACTED || !reservation.expiresAt || reservation.expiresAt <= now) throw new PayosPaymentError(409, 'DEPOSIT_NOT_ELIGIBLE', 'Deposit requires an unexpired CONTRACTED Self-Storage Reservation');
            if (contract!.status !== ContractStatus.DRAFT) throw new PayosPaymentError(409, 'CONTRACT_STATE_INVALID', 'Deposit requires the existing DRAFT Contract');
            const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
              depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
            amount = roundVndAmount(breakdown.depositCredit);
          }
        } else {
          if (managedV3(reservation)) {
            if (reservation.status !== ReservationStatus.DEPOSIT_PAID || !contract || contract.status !== ContractStatus.SIGNED || !hasCurrentManagedSignatures(contract)) throw new PayosPaymentError(409, 'BALANCE_NOT_ELIGIBLE', 'Managed V3 Balance requires a deposited reservation and both current contract signatures');
          } else {
            if (reservation.status !== ReservationStatus.CHECKIN_READY) throw new PayosPaymentError(409, 'BALANCE_NOT_ELIGIBLE', 'Balance requires CHECKIN_READY Self-Storage Reservation');
            if (contract!.status !== ContractStatus.SIGNED || !contract!.signedProofPublicId || !contract!.signedProofUrl || !contract!.verifiedAt) throw new PayosPaymentError(409, 'SIGNED_PROOF_REQUIRED', 'A verified signed-paper Contract is required before Balance');
          }
          const deposit = reservation.depositPaymentId
            ? await Payments.findOne({ _id: reservation.depositPaymentId, reservationId: reservation._id,
              customerId: reservation.customerId, facilityId: reservation.facilityId, serviceType: reservation.serviceType,
              purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED,
              applicationStatus: PaymentApplicationStatus.APPLIED }).session(session).exec()
            : null;
          if (!deposit || deposit.amount !== roundVndAmount(Number(reservation.depositAmount))) {
            throw new PayosPaymentError(409, 'VERIFIED_DEPOSIT_REQUIRED', 'A verified PayOS Deposit is required before Balance');
          }
          const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
            depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
          amount = roundVndAmount(breakdown.totalDue) - deposit.amount;
          if (amount <= 0) throw new PayosPaymentError(409, 'ZERO_BALANCE_REQUIRES_REVIEW', 'No positive Balance checkout is available; contact support');
        }
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new PayosPaymentError(409, 'INVALID_PAYMENT_AMOUNT', 'PayOS requires a positive whole-VND amount');

        const unresolved = await Payments.findOne({ reservationId: reservation._id, purpose,
          provider: PaymentProvider.PAYOS, $or: [
            { status: { $in: [PaymentStatus.PENDING, PaymentStatus.RECONCILIATION_REQUIRED] } },
            { status: PaymentStatus.CANCELLED, $or: [
              { providerCaptures: { $elemMatch: {} } },
              { providerOutcomeEvents: { $elemMatch: {} } },
              { providerSettlementStatus: ProviderSettlementStatus.VERIFIED },
              { applicationStatus: { $ne: PaymentApplicationStatus.NOT_APPLIED } },
          { cancelVerifiedAt: { $exists: false } },
            ] },
          ] }).session(session).exec();
        if (unresolved) throw new PayosPaymentError(409, 'PAYMENT_ATTEMPT_UNRESOLVED', 'An earlier payment attempt must be authoritatively reconciled first');
        const priorSuccess = await Payments.findOne({ reservationId: reservation._id, purpose,
          provider: PaymentProvider.PAYOS, status: PaymentStatus.SUCCEEDED }).session(session).exec();
        if (priorSuccess) throw new PayosPaymentError(409, 'PAYMENT_ALREADY_SETTLED', 'This payment purpose already has a verified settlement');

        // Same-reservation requests serialize on the existing lifecycle token. No stock, contract or payment state is changed here.
        const serviceFilter = { serviceType: reservation.serviceType, ...(managedV3(reservation) ? { bookingFlowVersion: 3 } : {}) };
        const locked = await Reservations.findOneAndUpdate({ _id: reservation._id, customerId: reservation.customerId,
          ...serviceFilter, status: reservation.status,
          ...(purpose === PaymentPurpose.DEPOSIT ? { expiresAt: { $gt: now } } : {}),
          $and: [versionFilter(reservation.inventoryVersion)] }, { $inc: { inventoryVersion: 1 } },
        { new: true, session }).exec();
        if (!locked) throw new PayosPaymentError(409, 'RESERVATION_CHANGED', 'Reservation changed concurrently; refresh and retry');

        // Revalidate after the CAS, using the same transaction snapshot.
        const current = await Reservations.findOne({ _id: reservation._id, customerId: reservation.customerId,
          facilityId: reservation.facilityId, ...serviceFilter,
          status: reservation.status, ...(purpose === PaymentPurpose.DEPOSIT ? { expiresAt: { $gt: now } } : {}) }).session(session).exec();
        if (!current) throw new PayosPaymentError(409, 'RESERVATION_CHANGED', 'Reservation eligibility changed; refresh and retry');
        const payment = new ReservationPaymentModel({ reservationId: reservation._id, customerId: reservation.customerId,
          facilityId: reservation.facilityId, serviceType: reservation.serviceType, purpose, amount, currency: 'VND',
          idempotencyKey, provider: PaymentProvider.PAYOS, providerReference: String(orderCode), status: PaymentStatus.PENDING,
          checkoutState: 'NOT_CREATED', applicationStatus: PaymentApplicationStatus.NOT_APPLIED, providerCaptures: [] });
        await payment.save({ session });
        outcome = { payment, replayed: false };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      if (!outcome) throw new PayosPaymentError(503, 'PAYMENT_INTENT_OUTCOME_UNKNOWN', 'Payment intent outcome is uncertain');
      return outcome;
    } finally { await session.endSession(); }
  }

  private async createProviderLink(payment: any, channel: 'WEB' | 'MOBILE' = 'WEB') {
    const orderCode = numericOrderCode(payment.providerReference);
    const amount = payment.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0 || payment.currency !== 'VND') {
      throw new PayosPaymentError(409, 'INVALID_PAYMENT_AMOUNT', 'PayOS requires a positive whole-VND amount');
    }
    const { returnUrl, cancelUrl } = customerPaymentUrls(payment, channel);
    const purpose = assertPurpose(payment.purpose);
    const description = 'WDP' + (purpose === PaymentPurpose.DEPOSIT ? 'D' : 'B') + id(payment.reservationId).slice(-5);
    if (!/^WDP[DB][a-f0-9]{5}$/i.test(description)) {
      throw new PayosPaymentError(503, 'PAYOS_DESCRIPTION_INVALID', 'Payment intent has an invalid checkout description');
    }
    const claim = await Payments.findOneAndUpdate({ _id: payment._id, provider: PaymentProvider.PAYOS,
      status: PaymentStatus.PENDING, checkoutState: 'NOT_CREATED' }, {
      $set: { checkoutState: 'CREATING' },
    }, { new: true }).exec();
    if (!claim) {
      const current = await Payments.findById(payment._id).exec();
      if (current?.checkoutState === 'READY' && current.checkoutUrl) {
        return { ...await this.customerStatusDto(current), outcome: 'REPLAYED', httpStatus: 200 };
      }
      logCheckoutDiagnostic(payment, 'CREATE_CLAIM_UNAVAILABLE', 'CLAIM', false, false, false);
      throw new PayosPaymentError(503, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN', 'Checkout creation is already in progress or uncertain; do not create another payment');
    }
    let stage = 'PROVIDER_CREATE';
    let providerCreateInvoked = false;
    let providerResponseReceived = false;
    let persistenceConfirmed = false;
    try {
      providerCreateInvoked = true;
      const response = await this.gateway.create({ orderCode, amount,
        // Some PayOS channels backed by a bank account not linked through PayOS
        // accept at most 9 description characters. Keep a compact ASCII identity
        // across supported channel configurations.
        description,
        cancelUrl, returnUrl });
      providerResponseReceived = true;
      stage = 'PROVIDER_RESPONSE_VALIDATION';
      const malformed = !response || typeof response !== 'object' || !Number.isSafeInteger(response.orderCode) ||
        !Number.isSafeInteger(response.amount) || typeof response.currency !== 'string' || typeof response.status !== 'string' ||
        typeof response.paymentLinkId !== 'string' || !response.paymentLinkId.trim() || response.paymentLinkId.length > 200 ||
        !isSafePayosCheckoutUrl(response.checkoutUrl);
      if (malformed || response.orderCode !== orderCode || response.amount !== amount || response.currency !== 'VND' ||
          response.status !== 'PENDING') {
        stage = 'PERSIST_RESPONSE_MISMATCH';
        await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING, checkoutState: 'CREATING' }, {
          $set: { checkoutState: 'RECONCILIATION_REQUIRED', reconciliationReason: 'PayOS create response identity mismatch' },
        }).exec();
        logCheckoutDiagnostic(payment, malformed ? 'PAYOS_PROVIDER_MALFORMED_RESPONSE' : 'PROVIDER_RESPONSE_MISMATCH',
          'PROVIDER_RESPONSE_VALIDATION', true, true, false);
        throw new PayosPaymentError(503, 'PAYOS_RESPONSE_MISMATCH', 'PayOS checkout response requires reconciliation');
      }
      const identityFilter = { _id: payment._id, reservationId: payment.reservationId, customerId: payment.customerId,
        facilityId: payment.facilityId, serviceType: payment.serviceType, purpose: payment.purpose,
        amount, currency: 'VND', provider: PaymentProvider.PAYOS, providerReference: String(orderCode),
        status: PaymentStatus.PENDING, checkoutState: 'CREATING',
        $and: [
          { $or: [{ providerPaymentLinkId: { $exists: false } }, { providerPaymentLinkId: null },
            { providerPaymentLinkId: response.paymentLinkId }] },
          { $or: [{ qrCode: { $exists: false } }, { qrCode: null },
            ...(isValidPayosQrPayload(response.qrCode) ? [{ qrCode: response.qrCode }] : [])] },
        ] };
      const checkoutFields: Record<string, unknown> = { checkoutState: 'READY', checkoutUrl: response.checkoutUrl,
        providerPaymentLinkId: response.paymentLinkId, providerCurrency: response.currency };
      if (isValidPayosQrPayload(response.qrCode)) checkoutFields.qrCode = response.qrCode;
      stage = 'PERSIST_CHECKOUT_LINK';
      const persisted = await Payments.updateOne(identityFilter, {
        $set: checkoutFields,
      }).exec();
      if (persisted.matchedCount !== 1) throw new Error('PayOS checkout result was not attached to the payment intent');
      stage = 'VERIFY_CHECKOUT_PERSISTENCE';
      const refreshed = await Payments.findById(payment._id).exec();
      if (refreshed?.checkoutState !== 'READY' || refreshed.checkoutUrl !== response.checkoutUrl ||
          refreshed.providerPaymentLinkId !== response.paymentLinkId ||
          (isValidPayosQrPayload(response.qrCode) && refreshed.qrCode !== response.qrCode)) {
        throw new Error('Persisted PayOS checkout identity could not be verified');
      }
      persistenceConfirmed = true;
      return { ...await this.customerStatusDto(refreshed), outcome: 'CREATED', httpStatus: 201 };
    } catch (error: any) {
      if (error instanceof PayosPaymentError) throw error;
      try {
        await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING, checkoutState: 'CREATING' }, {
          $set: { checkoutState: 'UNKNOWN', reconciliationReason: 'PayOS create outcome is unknown; query by the same orderCode before retrying' },
        }).exec();
      } catch { /* Do not include the database error or its payload in logs. */ }
      const providerError = stage === 'PROVIDER_CREATE' ? classifyProviderError(error) : undefined;
      if ((providerError?.providerHttpStatus !== null && providerError?.providerHttpStatus !== undefined) ||
          providerError?.sdkErrorName === 'SyntaxError' || providerError?.sdkErrorName === 'InvalidSignatureError') {
        providerResponseReceived = true;
      }
      const category = providerError?.category ?? (!providerCreateInvoked ? 'CREATE_NOT_INVOKED'
        : !providerResponseReceived ? 'PROVIDER_CREATE_FAILED'
          : stage === 'VERIFY_CHECKOUT_PERSISTENCE' ? 'CHECKOUT_READBACK_FAILED' : 'CHECKOUT_PERSISTENCE_FAILED');
      logCheckoutDiagnostic(payment, category, stage, providerCreateInvoked, providerResponseReceived, persistenceConfirmed, providerError);
      throw new PayosPaymentError(503, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN', 'Checkout result is uncertain; do not create a new payment attempt');
    }
  }

  private async reconcileCheckoutState(payment: any) {
    const orderCode = numericOrderCode(payment.providerReference);
    let link: Awaited<ReturnType<PayosGateway['get']>>;
    try {
      link = await this.gateway.get(orderCode);
    } catch {
      logCheckoutDiagnostic(payment, 'PROVIDER_LOOKUP_FAILED', 'LOOKUP_BY_ORIGINAL_ORDER_CODE', null, false, null);
      throw new Error('PayOS lookup failed for the original payment order code');
    }
    if (!link || link.orderCode !== orderCode || link.amount !== payment.amount ||
        !Number.isSafeInteger(link.amountPaid) || link.amountPaid < 0 || !PAYOS_PAYMENT_LINK_STATUSES.has(link.status) ||
        typeof link.id !== 'string' || !link.id.trim() ||
        (payment.providerPaymentLinkId && link.id !== payment.providerPaymentLinkId)) {
      await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING }, {
        $set: { checkoutState: 'RECONCILIATION_REQUIRED', reconciliationReason: 'PayOS lookup identity mismatch' },
      }).exec();
      logCheckoutDiagnostic(payment, 'PROVIDER_LOOKUP_IDENTITY_MISMATCH', 'VALIDATE_LOOKUP_RESPONSE', null, true, false);
      return;
    }
    if (link.status === 'PENDING' && payment.checkoutUrl) {
      await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING }, { $set: { checkoutState: 'READY' } }).exec();
      return;
    }
    if (link.status === 'PENDING') {
      await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING }, {
        $set: { checkoutState: 'RECONCILIATION_REQUIRED', reconciliationReason: 'PayOS link is pending but the original checkout URL was not persisted' },
      }).exec();
      return;
    }
    if (link.status === 'CANCELLED' && link.amountPaid === 0 &&
        (link.transactions ?? []).length === 0 && (payment.providerCaptures ?? []).length === 0 &&
        (payment.providerOutcomeEvents ?? []).length === 0 &&
        payment.providerSettlementStatus !== ProviderSettlementStatus.VERIFIED &&
        payment.applicationStatus === PaymentApplicationStatus.NOT_APPLIED) {
      const session = await this.createSession();
      try {
        await session.withTransaction(async () => {
          const updated = await Payments.findOneAndUpdate({ _id: payment._id, reservationId: payment.reservationId,
            customerId: payment.customerId, facilityId: payment.facilityId, serviceType: payment.serviceType,
            provider: PaymentProvider.PAYOS, purpose: payment.purpose, providerReference: String(orderCode),
            status: { $in: [PaymentStatus.PENDING, PaymentStatus.RECONCILIATION_REQUIRED] },
            providerSettlementStatus: { $ne: ProviderSettlementStatus.VERIFIED },
            applicationStatus: PaymentApplicationStatus.NOT_APPLIED,
            providerCaptures: { $size: 0 }, providerOutcomeEvents: { $size: 0 } }, {
            $set: { status: PaymentStatus.CANCELLED, failedAt: this.now(), cancelVerifiedAt: this.now(), checkoutState: 'CANCELLED',
              reconciliationReason: 'PayOS authoritatively confirmed cancellation with no funds received' },
          }, { new: true, session }).exec();
          if (updated) await new ManagedReservationAuditModel({ facilityId: payment.facilityId,
            reservationId: payment.reservationId, actorId: payment.customerId,
            action: ManagedReservationAction.PAYMENT_CANCELLED, fromStatus: payment.status, toStatus: PaymentStatus.CANCELLED,
            details: { paymentId: payment._id, purpose: payment.purpose, amount: payment.amount,
              providerReference: String(orderCode), providerStatus: link.status, amountPaid: link.amountPaid },
          }).save({ session });
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      } finally { await session.endSession(); }
      return;
    }
    if (link.status === 'FAILED' && link.amountPaid === 0 && (link.transactions ?? []).length === 0) {
      await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING }, {
        $set: { status: PaymentStatus.FAILED, failedAt: this.now(), checkoutState: 'FAILED', reconciliationReason: 'PayOS authoritatively reports terminal failure with no funds received' },
      }).exec();
      return;
    }
    // Expiry, partial payment, transactions or other outcomes are not cancellation proof.
    await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING }, {
      $set: { checkoutState: 'RECONCILIATION_REQUIRED', reconciliationReason: `PayOS link status ${link.status}; settlement must be reconciled` },
    }).exec();
  }

  async lookupCustomerPayosOrder(reservationIdInput: unknown, orderCodeInput: unknown, customerId: unknown) {
    const reservationId = id(reservationIdInput);
    const orderCode = parseOrderCode(orderCodeInput);
    if (orderCode === null) throw new PayosPaymentError(400, 'INVALID_ORDER_CODE', 'A valid decimal orderCode is required');
    if (!Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const reservation = await Reservations.findOne({ _id: reservationId, customerId,
      serviceType: FacilityServiceType.SELF_STORAGE }).exec();
    if (!reservation) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const payment = await Payments.findOne({ reservationId, customerId, serviceType: FacilityServiceType.SELF_STORAGE,
      provider: PaymentProvider.PAYOS, providerReference: String(orderCode) }).exec();
    if (!payment) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    assertEnabled(this.enabled);
    const gateway = this.gateway;
    let link: Awaited<ReturnType<PayosGateway['get']>>;
    try {
      link = await gateway.get(orderCode, { requireSignature: true });
    } catch (error) {
      const diagnostic = classifyProviderError(error);
      logCheckoutDiagnostic(payment, 'PROVIDER_LOOKUP_FAILED', 'CUSTOMER_LOOKUP_BY_ORDER_CODE', false,
        diagnostic.providerHttpStatus !== null, null, diagnostic);
      if (diagnostic.providerHttpStatus === 404) {
        throw new PayosPaymentError(404, 'PAYOS_LINK_NOT_FOUND', 'PayOS did not find the original payment link');
      }
      if (diagnostic.category === 'PAYOS_PROVIDER_AUTH_ERROR') {
        throw new PayosPaymentError(502, 'PAYOS_LOOKUP_AUTH_FAILED', 'PayOS authentication failed for the lookup');
      }
      if (diagnostic.category === 'PAYOS_PROVIDER_TIMEOUT' || diagnostic.category === 'PAYOS_PROVIDER_NETWORK_ERROR' ||
          diagnostic.category === 'PAYOS_PROVIDER_RATE_LIMITED') {
        throw new PayosPaymentError(503, 'PAYOS_LOOKUP_UNAVAILABLE', 'PayOS lookup is temporarily unavailable');
      }
      throw new PayosPaymentError(502, 'PAYOS_LOOKUP_REJECTED', 'PayOS did not confirm the original payment link');
    }
    if (!link || link.orderCode !== orderCode || link.amount !== payment.amount ||
        !Number.isSafeInteger(link.amountPaid) || link.amountPaid < 0 || !PAYOS_PAYMENT_LINK_STATUSES.has(link.status) ||
        typeof link.id !== 'string' || !link.id.trim() || link.id.length > 200 ||
        (payment.providerPaymentLinkId && link.id !== payment.providerPaymentLinkId)) {
      throw new PayosPaymentError(502, 'PAYOS_LOOKUP_MISMATCH', 'PayOS lookup did not match the stored payment identity');
    }
    return { id: id(payment._id), orderCode, paymentLinkId: link.id, amount: payment.amount, currency: payment.currency,
      amountPaid: link.amountPaid, provider: payment.provider, providerStatus: link.status,
      status: payment.status, checkoutStatus: payment.checkoutState ?? 'UNKNOWN',
      providerSettlementStatus: payment.providerSettlementStatus ?? ProviderSettlementStatus.NOT_VERIFIED,
      applicationStatus: payment.applicationStatus ?? PaymentApplicationStatus.NOT_APPLIED };
  }

  async getCustomerStatus(paymentIdInput: unknown, reservationIdInput: unknown, customerId: unknown) {
    const paymentId = id(paymentIdInput); const reservationId = id(reservationIdInput);
    if (!Types.ObjectId.isValid(paymentId) || !Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const payment = await Payments.findOne({ _id: paymentId, reservationId, customerId,
      serviceType: { $in: [FacilityServiceType.SELF_STORAGE, FacilityServiceType.MANAGED_INVENTORY] }, provider: PaymentProvider.PAYOS }).exec();
    if (!payment) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const reservation = await Reservations.findOne({ _id: reservationId, customerId,
      serviceType: payment.serviceType, ...(payment.serviceType === FacilityServiceType.MANAGED_INVENTORY ? { bookingFlowVersion: 3 } : {}) }).exec();
    // Payment history remains visible to its owner if Reservation Facility metadata
    // later changes; the immutable payment Facility is not an authorization key.
    if (!reservation) {
      throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    }
    if (payment.status === PaymentStatus.PENDING && payment.checkoutState === 'CREATING') {
      const claimAge = payment.updatedAt instanceof Date ? this.now().getTime() - payment.updatedAt.getTime() : 0;
      if (claimAge >= 60_000) {
        await Payments.updateOne({ _id: payment._id, status: PaymentStatus.PENDING, checkoutState: 'CREATING', updatedAt: payment.updatedAt }, {
          $set: { checkoutState: 'UNKNOWN', reconciliationReason: 'Checkout creation worker stopped before persisting its outcome' },
        }).exec().catch(() => undefined);
      }
    }
    const current = await Payments.findById(payment._id).exec() ?? payment;
    if (current.status === PaymentStatus.PENDING && current.checkoutState === 'UNKNOWN') await this.reconcileCheckoutState(current).catch(() => undefined);
    const fresh = await Payments.findById(payment._id).exec() ?? current;
    let canPresentCheckoutUrl = fresh.status === PaymentStatus.PENDING && fresh.checkoutState === 'READY' &&
      fresh.applicationStatus !== PaymentApplicationStatus.MANUAL_REVIEW &&
      fresh.providerSettlementStatus !== ProviderSettlementStatus.VERIFIED &&
      typeof fresh.checkoutUrl === 'string' && fresh.checkoutUrl.length > 0;
    const retryTerminal = (fresh.status === PaymentStatus.CANCELLED && !!fresh.cancelVerifiedAt && fresh.checkoutState === 'CANCELLED' ||
      fresh.status === PaymentStatus.FAILED && fresh.checkoutState === 'FAILED') &&
      fresh.providerSettlementStatus !== ProviderSettlementStatus.VERIFIED && fresh.applicationStatus === PaymentApplicationStatus.NOT_APPLIED &&
      (fresh.providerCaptures ?? []).length === 0 && (fresh.providerOutcomeEvents ?? []).length === 0;
    let retryAllowed = false;
    if (canPresentCheckoutUrl || retryTerminal) {
      const latestReservation = await Reservations.findOne({ _id: reservationId, customerId,
        serviceType: fresh.serviceType, ...(fresh.serviceType === FacilityServiceType.MANAGED_INVENTORY ? { bookingFlowVersion: 3 } : {}) }).exec();
      const issue = await this.currentIntentIssue(fresh, latestReservation);
      canPresentCheckoutUrl = canPresentCheckoutUrl && !issue;
      retryAllowed = retryTerminal && !issue;
    }
    return statusDto(fresh, canPresentCheckoutUrl, retryAllowed);
  }

  async reconcileCustomerPayment(paymentIdInput: unknown, reservationIdInput: unknown, customerId: unknown) {
    const paymentId = id(paymentIdInput), reservationId = id(reservationIdInput);
    if (!Types.ObjectId.isValid(paymentId) || !Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const payment = await Payments.findOne({ _id: paymentId, reservationId, customerId,
      provider: PaymentProvider.PAYOS, serviceType: { $in: [FacilityServiceType.SELF_STORAGE, FacilityServiceType.MANAGED_INVENTORY] } }).exec();
    if (!payment) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    const reservation = await Reservations.findOne({ _id: reservationId, customerId, serviceType: payment.serviceType,
      ...(payment.serviceType === FacilityServiceType.MANAGED_INVENTORY ? { bookingFlowVersion: 3 } : {}) }).exec();
    if (!reservation) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.status === PaymentStatus.SUCCEEDED || payment.providerSettlementStatus === ProviderSettlementStatus.VERIFIED ||
        payment.applicationStatus === PaymentApplicationStatus.APPLIED) return this.getCustomerStatus(paymentId, reservationId, customerId);
    if (payment.status === PaymentStatus.CANCELLED && payment.cancelVerifiedAt) return this.getCustomerStatus(paymentId, reservationId, customerId);
    try { await this.reconcileCheckoutState(payment); }
    catch {
      throw new PayosPaymentError(503, 'PAYMENT_RECONCILIATION_PENDING', 'Payment status is still being verified; retry shortly');
    }
    return this.getCustomerStatus(paymentId, reservationId, customerId);
  }

  async listCustomerPayments(reservationIdInput: unknown, customerId: unknown, options: { limit?: unknown; cursor?: unknown } = {}) {
    const reservationId = id(reservationIdInput);
    if (!Types.ObjectId.isValid(reservationId)) throw new PayosPaymentError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    const reservation = await Reservations.findOne({ _id: reservationId, customerId,
      $or: [{ serviceType: FacilityServiceType.SELF_STORAGE }, { serviceType: FacilityServiceType.MANAGED_INVENTORY, bookingFlowVersion: 3 }] }).exec();
    if (!reservation) throw new PayosPaymentError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');

    const limit = historyLimit(options.limit);
    const cursor = decodeHistoryCursor(options.cursor);
    const filter: any = { reservationId, customerId, serviceType: reservation.serviceType,
      provider: PaymentProvider.PAYOS };
    if (cursor) filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.paymentId } },
    ];
    const rows = await Payments.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
      .maxTimeMS(PAYOS_HISTORY_MAX_TIME_MS).lean().exec();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = [];
    for (const payment of page) {
      let checkoutUrl: string | null = null;
      const retryTerminal = (payment.status === PaymentStatus.CANCELLED && !!payment.cancelVerifiedAt && payment.checkoutState === 'CANCELLED' ||
        payment.status === PaymentStatus.FAILED && payment.checkoutState === 'FAILED') &&
        payment.providerSettlementStatus !== ProviderSettlementStatus.VERIFIED && payment.applicationStatus === PaymentApplicationStatus.NOT_APPLIED &&
        (payment.providerCaptures ?? []).length === 0 && (payment.providerOutcomeEvents ?? []).length === 0;
      const pendingReady = payment.status === PaymentStatus.PENDING && payment.checkoutState === 'READY' &&
        payment.providerSettlementStatus !== ProviderSettlementStatus.VERIFIED && payment.applicationStatus !== PaymentApplicationStatus.MANUAL_REVIEW;
      const intentEligible = pendingReady || retryTerminal ? await this.currentIntentIssue(payment, reservation) === null : false;
      const retryAllowed = retryTerminal && intentEligible;
      if (pendingReady && intentEligible) {
        checkoutUrl = payment.checkoutUrl ?? null;
      }
      items.push({ ...statusDto(payment, checkoutUrl !== null, retryAllowed), createdAt: payment.createdAt });
    }
    return { items, nextCursor: hasMore ? encodeHistoryCursor(page[page.length - 1]) : null };
  }

  async handleWebhook(input: unknown) {
    let verified: Awaited<ReturnType<PayosGateway['verify']>>;
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid webhook shape');
      verified = await this.gateway.verify(input as Webhook);
    } catch {
      throw new PayosPaymentError(400, 'PAYOS_WEBHOOK_SIGNATURE_INVALID', 'PayOS webhook signature is invalid');
    }
    if (!verified || !Number.isSafeInteger(verified.orderCode) || !verified.reference ||
        !Number.isSafeInteger(verified.amount) || typeof verified.currency !== 'string' ||
        typeof verified.paymentLinkId !== 'string' || typeof verified.transactionDateTime !== 'string' ||
        typeof verified.code !== 'string' || typeof verified.desc !== 'string') {
      throw new PayosPaymentError(400, 'PAYOS_WEBHOOK_INVALID', 'PayOS webhook payload is incomplete');
    }
    const payment = await Payments.findOne({ provider: PaymentProvider.PAYOS,
      providerReference: String(verified.orderCode) }).exec();
    if (!payment) {
      if (isDocumentedRegistrationProbe(verified)) {
        // PayOS confirms webhook URLs by sending this signed sample transaction.
        // Acknowledge delivery only; this is deliberately not a WDP settlement.
        return { registrationProbe: true, applied: false };
      }
      throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment intent not found');
    }
    if (verified.code !== '00') {
      return this.recordNonSuccessOutcome(payment._id, verified);
    }
    const event = { ...verified, eventHash: captureHash(verified) };
    const session = await this.createSession();
    let result: any;
    try {
      await session.withTransaction(async () => {
        result = undefined;
        const currentPayment = await Payments.findOne({ _id: payment._id, provider: PaymentProvider.PAYOS,
          providerReference: String(verified.orderCode) }).session(session).exec();
        if (!currentPayment) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment intent not found');
        if ((currentPayment.providerCaptures ?? []).some((entry: any) => entry.eventHash === event.eventHash)) {
          result = { duplicate: true, paymentId: currentPayment._id };
          return;
        }

        const reservation = await Reservations.findOne({ _id: currentPayment.reservationId,
          customerId: currentPayment.customerId, serviceType: currentPayment.serviceType,
          ...(currentPayment.serviceType === FacilityServiceType.MANAGED_INVENTORY ? { bookingFlowVersion: 3 } : {}) }).session(session).exec();

        const exactPayment = verified.amount === currentPayment.amount && verified.currency === currentPayment.currency &&
          currentPayment.currency === 'VND' && (!currentPayment.providerPaymentLinkId || currentPayment.providerPaymentLinkId === verified.paymentLinkId);
        const previouslyCaptured = (currentPayment.providerCaptures ?? []).length > 0;
        const priorNonSuccessOutcome = (currentPayment.providerOutcomeEvents ?? []).length > 0;
        const previousStatus = currentPayment.status;
        // The legacy unique index allows only one SUCCEEDED payment per Reservation/purpose.
        // Preserve verified evidence from late/duplicate captures without colliding with an
        // already-applied or otherwise successful attempt.
        const competingSuccess = await Payments.findOne({ _id: { $ne: currentPayment._id },
          reservationId: currentPayment.reservationId, purpose: currentPayment.purpose,
          status: PaymentStatus.SUCCEEDED }).session(session).exec();
        const now = this.now();
        currentPayment.providerCaptures = [...(currentPayment.providerCaptures ?? []), {
          eventHash: event.eventHash, reference: verified.reference, amount: verified.amount,
          currency: verified.currency, transactionDateTime: verified.transactionDateTime, receivedAt: now,
        }] as any;
        currentPayment.providerPaymentLinkId ??= verified.paymentLinkId;
        currentPayment.providerCurrency = verified.currency;
        currentPayment.providerSettlementStatus = ProviderSettlementStatus.VERIFIED;
        currentPayment.status = competingSuccess ? PaymentStatus.RECONCILIATION_REQUIRED : PaymentStatus.SUCCEEDED;
        currentPayment.succeededAt ??= now;

        if (competingSuccess || !exactPayment || previouslyCaptured || priorNonSuccessOutcome ||
            previousStatus === PaymentStatus.FAILED || previousStatus === PaymentStatus.CANCELLED || previousStatus === PaymentStatus.SUCCEEDED) {
          currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
          currentPayment.reconciliationReason = !exactPayment
            ? 'Verified PayOS receipt does not match expected amount, currency or payment link'
            : competingSuccess
              ? 'Another successful payment exists for this Reservation and purpose; verified funds require manual reconciliation'
            : priorNonSuccessOutcome
              ? 'Conflicting signed PayOS outcomes were received for this intent; verified funds require manual reconciliation'
            : previousStatus === PaymentStatus.FAILED || previousStatus === PaymentStatus.CANCELLED
              ? 'Verified funds arrived after this attempt had already been reconciled as unsuccessful; manual review required'
              : 'Multiple distinct PayOS captures were received for one payment intent';
          await currentPayment.save({ session });
          result = { reconciled: true, paymentId: currentPayment._id };
          return;
        }

        if (!reservation || id(reservation.facilityId) !== id(currentPayment.facilityId)) {
          currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
          currentPayment.reconciliationReason = 'Verified PayOS funds cannot be applied because the Reservation Facility no longer matches the immutable payment intent';
          await currentPayment.save({ session });
          result = { reconciled: true, paymentId: currentPayment._id };
          return;
        }

        const time = now;
        if (currentPayment.purpose === PaymentPurpose.DEPOSIT) {
          const managed = managedV3(reservation);
          if (managed ? reservation.status !== ReservationStatus.RESERVED || !reservation.expiresAt || reservation.expiresAt <= time :
              reservation.status !== ReservationStatus.CONTRACTED || !reservation.expiresAt || reservation.expiresAt <= time) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Verified Deposit arrived after Reservation eligibility expired or changed';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          const breakdown = managed ? null : calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
            depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
          const expectedDeposit = managed ? roundVndAmount(Number(reservation.depositAmount)) : roundVndAmount(breakdown!.depositCredit);
          if (currentPayment.amount !== expectedDeposit || currentPayment.currency !== 'VND' || verified.amount !== expectedDeposit) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Verified Deposit no longer matches the Reservation pricing; funds require manual reconciliation';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          const contract = managed ? null : await Contracts.findOne({ reservationId: reservation._id, customerId: reservation.customerId }).session(session).exec();
          if (!managed && (!contract || contract.status !== ContractStatus.DRAFT)) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Verified Deposit cannot be applied because the existing Contract state changed';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          let holdFilter: Awaited<ReturnType<typeof lockManagedDepositHolds>> | undefined;
          if (managed) {
            try {
              holdFilter = await lockManagedDepositHolds(reservation, time, session);
            } catch (error) {
              if (!(error instanceof ManagedReservationError) || error.status !== 409) throw error;
              currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
              currentPayment.reconciliationReason = 'Verified Managed V3 Deposit cannot be applied because the reserved Cell holds are no longer valid';
              await currentPayment.save({ session });
              result = { reconciled: true, paymentId: currentPayment._id };
              return;
            }
          }
          const eligibleStatus = managed ? ReservationStatus.RESERVED : ReservationStatus.CONTRACTED;
          const locked = await Reservations.findOneAndUpdate({ _id: reservation._id, customerId: reservation.customerId,
            facilityId: reservation.facilityId, serviceType: reservation.serviceType,
            ...(managed ? { bookingFlowVersion: 3 } : {}), expiresAt: { $gt: time },
            status: eligibleStatus, $and: [versionFilter(reservation.inventoryVersion)] }, {
            $inc: { inventoryVersion: 1 }, $set: { status: ReservationStatus.DEPOSIT_PAID, depositPaymentId: currentPayment._id },
            ...(managed ? { $unset: { expiresAt: 1 } } : {}),
            $push: { statusHistory: { status: ReservationStatus.DEPOSIT_PAID, reason: 'PayOS verified advance-rent Deposit applied', createdAt: time } },
          }, { new: true, session, runValidators: true }).exec();
          if (!locked) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Reservation changed while applying verified Deposit';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          if (holdFilter) {
            const transition = await CellAllocationModel.updateMany(holdFilter,
              { $set: { status: CellAllocationStatus.RESERVED }, $unset: { holdExpiresAt: 1 } }, { session }).exec();
            if (transition.matchedCount !== reservation.allocatedCellIds.length) {
              // Abort even if some rows matched. The provider may replay this signed event.
              throw new PayosPaymentError(503, 'WEBHOOK_CONCURRENT_RETRY', 'Managed V3 Cell holds changed during settlement; provider should retry');
            }
          }
        } else {
          const managed = managedV3(reservation);
          if ((managed ? reservation.status !== ReservationStatus.DEPOSIT_PAID : reservation.status !== ReservationStatus.CHECKIN_READY) || currentPayment.customerId == null) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Verified Balance arrived after Reservation eligibility changed';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          const contract = await Contracts.findOne({ reservationId: reservation._id, customerId: reservation.customerId }).session(session).exec();
          const deposit = reservation.depositPaymentId ? await Payments.findOne({ _id: reservation.depositPaymentId,
            reservationId: reservation._id, customerId: reservation.customerId, facilityId: reservation.facilityId,
            serviceType: reservation.serviceType, purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.PAYOS,
            status: PaymentStatus.SUCCEEDED, applicationStatus: PaymentApplicationStatus.APPLIED }).session(session).exec() : null;
          if (!contract || contract.status !== ContractStatus.SIGNED ||
              (managed ? !hasCurrentManagedSignatures(contract) : !contract.signedProofPublicId || !contract.signedProofUrl || !contract.verifiedAt) || !deposit) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Verified Balance cannot be applied without current signed proof and an applied PayOS Deposit';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent,
            depositAmount: reservation.depositAmount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
          const expectedBalance = roundVndAmount(breakdown.totalDue) - deposit.amount;
          if (currentPayment.amount !== expectedBalance || expectedBalance <= 0) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Verified Balance no longer matches the Reservation total and applied Deposit';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
          const locked = await Reservations.findOneAndUpdate({ _id: reservation._id, customerId: reservation.customerId,
            facilityId: reservation.facilityId, serviceType: reservation.serviceType,
            ...(managed ? { bookingFlowVersion: 3 } : {}),
            status: managed ? ReservationStatus.DEPOSIT_PAID : ReservationStatus.CHECKIN_READY, $and: [versionFilter(reservation.inventoryVersion)] }, {
            $inc: { inventoryVersion: 1 }, $set: { status: ReservationStatus.PAID, balancePaymentId: currentPayment._id,
              balanceSettledAt: time },
            $push: { statusHistory: { status: ReservationStatus.PAID, reason: 'PayOS verified remaining rent Balance applied', createdAt: time } },
          }, { new: true, session, runValidators: true }).exec();
          if (!locked) {
            currentPayment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
            currentPayment.reconciliationReason = 'Reservation changed while applying verified Balance';
            await currentPayment.save({ session }); result = { reconciled: true, paymentId: currentPayment._id }; return;
          }
        }
        currentPayment.applicationStatus = PaymentApplicationStatus.APPLIED;
        delete currentPayment.reconciliationReason;
        await currentPayment.save({ session });
        result = { applied: true, paymentId: currentPayment._id };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      if (!result) throw new PayosPaymentError(503, 'WEBHOOK_OUTCOME_UNKNOWN', 'Webhook processing outcome is uncertain');
      return { success: true, duplicate: result.duplicate === true, reconciled: result.reconciled === true };
    } catch (error: any) {
      if (error instanceof PayosPaymentError) throw error;
      if (errorHasLabel(error, 'UnknownTransactionCommitResult')) {
        const durable = await Payments.findById(payment._id).exec().catch(() => null);
        if (durable?.providerCaptures?.some((entry: any) => entry.eventHash === event.eventHash)) return { success: true, duplicate: true, reconciled: durable.applicationStatus === PaymentApplicationStatus.MANUAL_REVIEW };
        throw new PayosPaymentError(503, 'WEBHOOK_OUTCOME_UNKNOWN', 'Webhook processing outcome is uncertain; provider may retry');
      }
      if (isConflict(error)) throw new PayosPaymentError(503, 'WEBHOOK_CONCURRENT_RETRY', 'Concurrent payment update; provider should retry');
      throw error;
    } finally { await session.endSession(); }
  }

  private async recordNonSuccessOutcome(paymentId: unknown, verified: Awaited<ReturnType<PayosGateway['verify']>>) {
    const eventHash = outcomeHash(verified);
    const session = await this.createSession();
    let duplicate = false;
    try {
      await session.withTransaction(async () => {
        duplicate = false;
        const payment = await Payments.findOne({ _id: paymentId, provider: PaymentProvider.PAYOS }).session(session).exec();
        if (!payment) throw new PayosPaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment intent not found');
        if ((payment.providerOutcomeEvents ?? []).some((event: any) => event.eventHash === eventHash)) { duplicate = true; return; }
        payment.providerOutcomeEvents = [...(payment.providerOutcomeEvents ?? []), {
          eventHash, code: verified.code, description: verified.desc, reference: verified.reference,
          amount: verified.amount, currency: verified.currency, paymentLinkId: verified.paymentLinkId,
          transactionDateTime: verified.transactionDateTime, receivedAt: this.now(),
        }] as any;
        if (payment.status === PaymentStatus.SUCCEEDED || payment.providerSettlementStatus === ProviderSettlementStatus.VERIFIED) {
          payment.applicationStatus = PaymentApplicationStatus.MANUAL_REVIEW;
          payment.reconciliationReason = 'A signed non-success PayOS outcome conflicts with verified funds; manual reconciliation is required';
        } else if (payment.status === PaymentStatus.PENDING || payment.status === PaymentStatus.RECONCILIATION_REQUIRED) {
          payment.status = PaymentStatus.RECONCILIATION_REQUIRED;
          payment.checkoutState = 'RECONCILIATION_REQUIRED';
          payment.reconciliationReason = 'Signed PayOS callback was not a successful transaction; provider status must be reconciled';
        }
        await payment.save({ session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      return { success: true, duplicate, reconciled: true };
    } catch (error: any) {
      if (error instanceof PayosPaymentError) throw error;
      if (errorHasLabel(error, 'UnknownTransactionCommitResult')) {
        const durable = await Payments.findById(paymentId).exec().catch(() => null);
        if (durable?.providerOutcomeEvents?.some((event: any) => event.eventHash === eventHash)) {
          return { success: true, duplicate: true, reconciled: true };
        }
        throw new PayosPaymentError(503, 'WEBHOOK_OUTCOME_UNKNOWN', 'Webhook outcome is uncertain; provider should retry');
      }
      if (isConflict(error)) throw new PayosPaymentError(503, 'WEBHOOK_CONCURRENT_RETRY', 'Concurrent payment update; provider should retry');
      throw error;
    } finally { await session.endSession(); }
  }
}

export const payosPaymentService = new PayosPaymentService();
