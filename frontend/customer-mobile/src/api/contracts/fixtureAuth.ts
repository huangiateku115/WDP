import {z} from 'zod';
import {buildRegistration, loginBody, logoutBody, mapCurrentUser, mapLogin} from './customer';
import {assertOwner, normalizeApiFailure, type WireRequest} from './core';
import type {FixtureTransport} from './fixtureAdapter';

const messages = {
  INVALID_INPUT: 'Thông tin tài khoản không hợp lệ.',
  INVALID_CREDENTIALS: 'Không thể đăng nhập với thông tin đã cung cấp.',
  INVALID_IDENTITY: 'Không xác minh được danh tính khách hàng đang hoạt động.',
  INVALID_RESPONSE: 'Phản hồi xác thực không hợp lệ.',
  SESSION_EXPIRED: 'Phiên đã hết hạn. Vui lòng đăng nhập lại.',
  NOT_AUTHENTICATED: 'Vui lòng đăng nhập.',
  SESSION_REPLACED: 'Thao tác đã bị hủy do phiên thay đổi.',
  SESSION_BUSY: 'Chỉ có thể đăng ký khi đã đăng xuất.',
  REJECTED: 'Yêu cầu xác thực bị từ chối.',
  UNAVAILABLE: 'Chưa xác nhận được kết quả. Vui lòng kiểm tra trước khi thử lại.',
} as const;

export class FixtureAuthError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = 'FixtureAuthError';
  }
}

export type CustomerCredentials = Readonly<Pick<ReturnType<typeof mapLogin>, 'accessToken' | 'refreshToken'>>;
export type CustomerIdentity = Readonly<Pick<ReturnType<typeof mapCurrentUser>, '_id' | 'role' | 'displayName' | 'email' | 'phone'>>;
export type RegistrationFields = Parameters<typeof buildRegistration>[0];

const logoutResponse = z.object({success: z.literal(true)});
const bearer = (accessToken: string) => ({Authorization: `Bearer ${accessToken}`});

function identity(user: ReturnType<typeof mapCurrentUser>): CustomerIdentity {
  if (user.isActive !== true) throw new FixtureAuthError('INVALID_IDENTITY');
  return Object.freeze({
    _id: user._id,
    role: user.role,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
  });
}

function verifiedIdentity(response: unknown, owner?: string) {
  try {
    const user = identity(mapCurrentUser(response));
    if (owner !== undefined) assertOwner({customerId: user._id}, owner);
    return user;
  } catch {
    throw new FixtureAuthError('INVALID_IDENTITY');
  }
}

function input<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new FixtureAuthError('INVALID_INPUT');
  }
}

export function createFixtureAuthAdapter(transport: FixtureTransport) {
  if (transport.mode !== 'FIXTURE_ONLY') throw new FixtureAuthError('REJECTED');

  async function request(wire: WireRequest, operation: 'login' | 'register' | 'me' | 'logout', signal?: AbortSignal) {
    if (signal?.aborted) throw new FixtureAuthError('SESSION_REPLACED');
    let cancel: (() => void) | undefined;
    try {
      // Race cancellation even when a fixture ignores the signal. Promise.race
      // also observes a late rejection so it cannot become unhandled.
      const pending = Promise.resolve().then(() => {
        if (signal?.aborted) throw new FixtureAuthError('SESSION_REPLACED');
        return transport.request(wire, signal);
      });
      if (!signal) return await pending;
      const cancelled = new Promise<never>((_, reject) => {
        cancel = () => reject(new FixtureAuthError('SESSION_REPLACED'));
        signal.addEventListener('abort', cancel, {once: true});
      });
      return await Promise.race([pending, cancelled]);
    } catch (error) {
      if (signal?.aborted) throw new FixtureAuthError('SESSION_REPLACED');
      const {status} = normalizeApiFailure(error);
      if (status === 401) {
        throw new FixtureAuthError(operation === 'login' ? 'INVALID_CREDENTIALS' : operation === 'register' ? 'REJECTED' : 'SESSION_EXPIRED');
      }
      if (status === 403 && operation === 'me') throw new FixtureAuthError('INVALID_IDENTITY');
      throw new FixtureAuthError(status === null || status >= 500 ? 'UNAVAILABLE' : 'REJECTED');
    } finally {
      if (cancel) signal?.removeEventListener('abort', cancel);
    }
  }

  return {
    async login(values: unknown, signal?: AbortSignal) {
      const body = input(() => loginBody.parse(values));
      const response = await request({method: 'POST', path: '/auth/login', body}, 'login', signal);
      try {
        const {accessToken, refreshToken, user} = mapLogin(response);
        if (/\s/.test(accessToken) || /\s/.test(refreshToken)) throw new FixtureAuthError('INVALID_RESPONSE');
        return {credentials: {accessToken, refreshToken}, user: identity(user)};
      } catch (error) {
        if (error instanceof FixtureAuthError) throw error;
        throw new FixtureAuthError('INVALID_RESPONSE');
      }
    },
    async register(values: RegistrationFields, signal?: AbortSignal) {
      const body = input(() => buildRegistration(values));
      const response = await request({method: 'POST', path: '/users/register', body}, 'register', signal);
      const user = verifiedIdentity(response);
      if (user.email.toLowerCase() !== body.email.toLowerCase()) throw new FixtureAuthError('INVALID_IDENTITY');
      return user;
    },
    async currentUser(accessToken: string, owner: string, signal?: AbortSignal) {
      const response = await request({method: 'GET', path: '/users/me', headers: bearer(accessToken)}, 'me', signal);
      return verifiedIdentity(response, owner);
    },
    async logout(credentials: CustomerCredentials) {
      const body = input(() => logoutBody.parse({refreshToken: credentials.refreshToken}));
      const response = await request({method: 'POST', path: '/auth/logout', body, headers: bearer(credentials.accessToken)}, 'logout');
      if (!logoutResponse.safeParse(response).success) throw new FixtureAuthError('INVALID_RESPONSE');
    },
  };
}
