import {createCustomerEpoch} from '../api/contracts/core';
import {createFixtureAuthAdapter, FixtureAuthError} from '../api/contracts/fixtureAuth';
import type {CustomerCredentials, CustomerIdentity, RegistrationFields} from '../api/contracts/fixtureAuth';
import type {FixtureTransport} from '../api/contracts/fixtureAdapter';

type ExpirationReason = 'SESSION_EXPIRED' | 'INVALID_IDENTITY';
export type FixtureSessionState = Readonly<
  | {status: 'signedOut' | 'registering' | 'authenticating'; epoch: number}
  | {status: 'authenticated'; epoch: number; user: CustomerIdentity}
  | {status: 'expired'; epoch: number; reason: ExpirationReason}
>;

export function createFixtureAuthSession(transport: FixtureTransport) {
  const adapter = createFixtureAuthAdapter(transport);
  const epoch = createCustomerEpoch();
  let state: FixtureSessionState = Object.freeze({status: 'signedOut', epoch: 0});
  let credentials: CustomerCredentials | undefined;
  let controller = new AbortController();

  function reset(status: 'signedOut' | 'registering' | 'authenticating', reason?: ExpirationReason) {
    const previous = controller;
    controller = new AbortController();
    epoch.expire();
    credentials = undefined;
    const next = epoch.capture().epoch;
    state = reason
      ? Object.freeze({status: 'expired', epoch: next, reason})
      : Object.freeze({status, epoch: next});
    previous.abort();
    return {epoch: next, signal: controller.signal};
  }

  function assertCurrent(expected: number) {
    if (epoch.capture().epoch !== expected) throw new FixtureAuthError('SESSION_REPLACED');
  }

  return {
    getSnapshot: (): FixtureSessionState => state,
    async login(values: unknown) {
      const attempt = reset('authenticating');
      try {
        const result = await adapter.login(values, attempt.signal);
        assertCurrent(attempt.epoch);
        const user = await adapter.currentUser(result.credentials.accessToken, result.user._id, attempt.signal);
        assertCurrent(attempt.epoch);
        credentials = result.credentials;
        state = Object.freeze({status: 'authenticated', epoch: epoch.begin(user._id), user});
        return state;
      } catch (error) {
        assertCurrent(attempt.epoch);
        if (error instanceof FixtureAuthError && error.code === 'SESSION_EXPIRED') {
          reset('signedOut', error.code);
        } else {
          reset('signedOut');
        }
        throw error;
      }
    },
    async register(values: RegistrationFields) {
      if (state.status !== 'signedOut' && state.status !== 'expired') throw new FixtureAuthError('SESSION_BUSY');
      const attempt = reset('registering');
      try {
        const user = await adapter.register(values, attempt.signal);
        assertCurrent(attempt.epoch);
        return user;
      } finally {
        assertCurrent(attempt.epoch);
        reset('signedOut');
      }
    },
    async currentUser() {
      if (state.status === 'expired') throw new FixtureAuthError(state.reason);
      if (state.status !== 'authenticated' || !credentials) throw new FixtureAuthError('NOT_AUTHENTICATED');
      const ticket = epoch.capture();
      try {
        const user = await adapter.currentUser(credentials.accessToken, state.user._id, controller.signal);
        if (!epoch.accepts(ticket)) throw new FixtureAuthError('SESSION_REPLACED');
        state = Object.freeze({status: 'authenticated', epoch: ticket.epoch, user});
        return user;
      } catch (error) {
        if (!epoch.accepts(ticket)) throw new FixtureAuthError('SESSION_REPLACED');
        if (error instanceof FixtureAuthError && (error.code === 'SESSION_EXPIRED' || error.code === 'INVALID_IDENTITY')) {
          reset('signedOut', error.code);
        }
        throw error;
      }
    },
    async logout() {
      const previous = credentials;
      reset('signedOut');
      if (previous) await adapter.logout(previous);
    },
  };
}
