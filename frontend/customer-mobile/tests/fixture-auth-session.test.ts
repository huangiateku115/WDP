import type {WireRequest} from '../src/api/contracts/core';
import type {FixtureTransport} from '../src/api/contracts/fixtureAdapter';
import {createFixtureAuthSession} from '../src/state/createFixtureAuthSession';
import {useCustomerStore} from '../src/state/useCustomerStore';

const idA = 'a'.repeat(24);
const idB = 'b'.repeat(24);
const credentials = {email: 'fixture@example.test', password: 'fixture-password'};
const user = {_id: idA, email: credentials.email, displayName: 'Fixture A', role: 'CUSTOMER', isActive: true};
const ok = (data: unknown) => ({success: true, data});
const loginResponse = (identity: unknown = user) => ok({user: identity, accessToken: 'fixture-access', refreshToken: 'fixture-refresh'});
const unauthorized = {response: {status: 401, data: {message: 'raw-private-error'}}};

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

function fixture(handler: FixtureTransport['request'] = async request =>
  request.path === '/auth/login' ? loginResponse() : ok(user)) {
  const request = jest.fn(handler);
  return {request, session: createFixtureAuthSession({mode: 'FIXTURE_ONLY', request})};
}

test('login verifies exact wire requests and publishes only confirmed Customer identity', async () => {
  const {session, request} = fixture();
  expect(session.getSnapshot().status).toBe('signedOut');
  const pending = session.login({...credentials, email: ' fixture@example.test '});
  expect(session.getSnapshot().status).toBe('authenticating');
  await expect(pending).resolves.toMatchObject({status: 'authenticated', user: {_id: idA, role: 'CUSTOMER'}});
  expect(request.mock.calls.map(([wire]) => wire)).toEqual([
    {method: 'POST', path: '/auth/login', body: credentials},
    {method: 'GET', path: '/users/me', headers: {Authorization: 'Bearer fixture-access'}},
  ]);
  expect(JSON.stringify(session.getSnapshot())).not.toMatch(/fixture-(access|refresh|password)/);
});

test.each([
  {success: false},
  ok({accessToken: 'fixture-access', user}),
  loginResponse(null),
  loginResponse({...user, _id: undefined}),
  loginResponse({...user, role: 'ADMIN'}),
  loginResponse({...user, isActive: false}),
  loginResponse({...user, isActive: undefined}),
])('malformed or ineligible login envelope cannot establish a session %#', async response => {
  const {session, request} = fixture(async () => response);
  await expect(session.login(credentials)).rejects.toMatchObject({name: 'FixtureAuthError'});
  expect(session.getSnapshot().status).toBe('signedOut');
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([
  null,
  {...user, _id: idB},
  {...user, role: 'FACILITY_STAFF'},
  {...user, isActive: false},
])('a valid login response alone is insufficient when current identity is invalid %#', async identity => {
  const {session} = fixture(async wire => wire.path === '/auth/login' ? loginResponse() : ok(identity));
  await expect(session.login(credentials)).rejects.toMatchObject({code: 'INVALID_IDENTITY'});
  expect(session.getSnapshot().status).toBe('signedOut');
});

test('validation and bad credentials produce safe, distinct errors', async () => {
  const {session, request} = fixture(async () => { throw unauthorized; });
  await expect(session.login({...credentials, role: 'CUSTOMER'})).rejects.toMatchObject({code: 'INVALID_INPUT'});
  expect(request).not.toHaveBeenCalled();
  const rejected = await session.login(credentials).catch(error => error);
  expect(rejected).toMatchObject({code: 'INVALID_CREDENTIALS'});
  expect(String(rejected)).not.toContain('raw-private-error');
  expect(request).toHaveBeenCalledTimes(1);
});

test('registration sends the allowlist and waits for a confirmed receipt without creating a session', async () => {
  const result = deferred();
  const {session, request} = fixture(() => result.promise);
  const fields = {name: ' Fixture A ', ...credentials, phone: ' ', confirmation: 'ignored', consent: true, role: 'ADMIN'};
  const pending = session.register(fields);
  expect(session.getSnapshot().status).toBe('registering');
  result.resolve(ok({...user, keycloakSub: 'private', accessToken: 'unexpected-token'}));
  await expect(pending).resolves.toEqual({_id: idA, email: user.email, role: 'CUSTOMER', displayName: user.displayName, phone: undefined});
  expect(request.mock.calls.map(([wire]) => wire)).toEqual([
    {method: 'POST', path: '/users/register', body: {...credentials, displayName: 'Fixture A'}},
  ]);
  expect(session.getSnapshot().status).toBe('signedOut');
  await expect(session.currentUser()).rejects.toMatchObject({code: 'NOT_AUTHENTICATED'});
});

test('registration failure returns no success receipt or authenticated state', async () => {
  const {session} = fixture(async () => ({success: false}));
  await expect(session.register({name: 'Fixture A', ...credentials})).rejects.toMatchObject({code: 'INVALID_IDENTITY'});
  expect(session.getSnapshot().status).toBe('signedOut');
});

test('401 expires only the current session and does not retry or refresh', async () => {
  let meCalls = 0;
  const {session, request} = fixture(async wire => {
    if (wire.path === '/auth/login') return loginResponse();
    if (++meCalls > 1) throw unauthorized;
    return ok(user);
  });
  await session.login(credentials);
  await expect(session.currentUser()).rejects.toMatchObject({code: 'SESSION_EXPIRED'});
  expect(session.getSnapshot()).toMatchObject({status: 'expired', reason: 'SESSION_EXPIRED'});
  expect(session.getSnapshot()).not.toHaveProperty('user');
  await expect(session.currentUser()).rejects.toMatchObject({code: 'SESSION_EXPIRED'});
  await session.logout();
  expect(request.mock.calls.map(([wire]) => wire.path)).toEqual(['/auth/login', '/users/me', '/users/me']);
});

test('logout immediately clears identity, cancels pending reads and sends one exact fixture logout', async () => {
  const late = deferred();
  const logout = deferred();
  let meCalls = 0;
  const {session, request} = fixture(async wire => {
    if (wire.path === '/auth/login') return loginResponse();
    if (wire.path === '/auth/logout') return logout.promise;
    return ++meCalls === 1 ? ok(user) : late.promise;
  });
  await session.login(credentials);
  const read = session.currentUser();
  await Promise.resolve();
  const pendingLogout = session.logout();
  expect(session.getSnapshot().status).toBe('signedOut');
  await expect(read).rejects.toMatchObject({code: 'SESSION_REPLACED'});
  expect(request.mock.calls[2]?.[1]?.aborted).toBe(true);
  late.resolve(ok(user));
  expect(request.mock.calls[3]?.[0]).toEqual({
    method: 'POST', path: '/auth/logout', body: {refreshToken: 'fixture-refresh'},
    headers: {Authorization: 'Bearer fixture-access'},
  });
  logout.reject({response: {status: 503}});
  await expect(pendingLogout).rejects.toMatchObject({code: 'UNAVAILABLE'});
  expect(session.getSnapshot().status).toBe('signedOut');
  await session.logout();
  expect(request).toHaveBeenCalledTimes(4);
});

test('logout during pending login prevents bootstrap and rejects late login response', async () => {
  const late = deferred();
  const {session, request} = fixture(() => late.promise);
  const pending = session.login(credentials);
  await Promise.resolve();
  await session.logout();
  await expect(pending).rejects.toMatchObject({code: 'SESSION_REPLACED'});
  late.resolve(loginResponse());
  expect(request).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().status).toBe('signedOut');
});

test.each(['success', '401'])('replacing account A with B discards late A %s', async outcome => {
  const late = deferred();
  const userB = {...user, _id: idB, displayName: 'Fixture B', email: 'b@example.test'};
  let readsA = 0;
  const {session} = fixture(async (wire: WireRequest) => {
    if (wire.path === '/auth/login') {
      return (wire.body as typeof credentials).email === userB.email
        ? ok({user: userB, accessToken: 'access-b', refreshToken: 'refresh-b'})
        : loginResponse();
    }
    if (wire.headers?.Authorization === 'Bearer access-b') return ok(userB);
    return ++readsA === 1 ? ok(user) : late.promise;
  });
  await session.login(credentials);
  const readA = session.currentUser();
  const cancellation = expect(readA).rejects.toMatchObject({code: 'SESSION_REPLACED'});
  await Promise.resolve();
  const loginB = session.login({...credentials, email: userB.email});
  expect(session.getSnapshot()).not.toHaveProperty('user');
  await loginB;
  await cancellation;
  if (outcome === '401') late.reject(unauthorized); else late.resolve(ok(user));
  await Promise.resolve();
  expect(session.getSnapshot()).toMatchObject({status: 'authenticated', user: {_id: idB, displayName: 'Fixture B'}});
  await expect(session.currentUser()).resolves.toMatchObject({_id: idB});
});

test('fixture auth and demo state remain isolated, with no ambient transport or storage calls', async () => {
  const demo = useCustomerStore.getState();
  const ambientFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw Error('Unexpected fetch'); });
  const keys = ['localStorage', 'sessionStorage'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const storage = jest.fn(() => { throw Error('Unexpected storage access'); });
  for (const key of keys) Object.defineProperty(globalThis, key, {configurable: true, get: storage});
  try {
    const {session} = fixture();
    demo.enterDemo();
    expect(session.getSnapshot().status).toBe('signedOut');
    await session.login(credentials);
    demo.leaveDemo();
    expect(session.getSnapshot().status).toBe('authenticated');
    await session.logout();
    expect(useCustomerStore.getState().demoSession).toBe(false);
    expect(storage).not.toHaveBeenCalled();
    expect(ambientFetch).not.toHaveBeenCalled();
    const request = jest.fn();
    expect(() => createFixtureAuthSession({mode: 'LIVE', request} as unknown as FixtureTransport)).toThrow();
    expect(request).not.toHaveBeenCalled();
  } finally {
    demo.leaveDemo();
    ambientFetch.mockRestore();
    keys.forEach((key, i) => {
      const previous = descriptors[i];
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
