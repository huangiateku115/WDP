export class PayosMockConfigurationError extends Error {}

export class AuthMockConfigurationError extends Error {}

function isLocalPayosTestDatabase(mongoUrl: string | undefined): boolean {
  // A single loopback replica set prevents discovery of remote MongoDB members.
  const uri = /^mongodb:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/wdp_payos_test\?([^\s#]+)$/.exec(
    mongoUrl?.trim() ?? '',
  );
  const options = new URLSearchParams(uri?.[2]);
  return Boolean(uri && Number(uri[1]) <= 65535 && [...options].length === 2 &&
    /^[a-zA-Z0-9_-]+$/.test(options.get('replicaSet') ?? '') && options.get('directConnection') === 'true');
}

export function resolvePayosMockMode(environment: NodeJS.ProcessEnv): boolean {
  if (environment.PAYOS_MOCK_MODE?.trim().toLowerCase() !== 'true') return false;
  if (environment.NODE_ENV !== 'development' ||
      environment.PAYOS_ENABLED?.trim().toLowerCase() !== 'false') {
    throw new PayosMockConfigurationError('PAYOS_MOCK_MODE requires NODE_ENV=development and PAYOS_ENABLED=false');
  }

  if (!isLocalPayosTestDatabase(environment.MONGO_URL)) {
    throw new PayosMockConfigurationError(
      'PAYOS_MOCK_MODE requires the local wdp_payos_test replica set with directConnection=true in MONGO_URL',
    );
  }
  return true;
}

export function resolveAuthMockMode(environment: NodeJS.ProcessEnv): boolean {
  if (environment.AUTH_MOCK_MODE?.trim().toLowerCase() !== 'true') return false;
  const paymentMockEnabled = environment.PAYOS_MOCK_MODE?.trim().toLowerCase() === 'true';
  const liveTestEnabled = environment.PAYOS_LIVE_TEST_MODE?.trim().toLowerCase() === 'true';
  if (environment.NODE_ENV !== 'development' || environment.PAYOS_ENABLED?.trim().toLowerCase() !== 'false' ||
      (!paymentMockEnabled && !liveTestEnabled) || !isLocalPayosTestDatabase(environment.MONGO_URL)) {
    throw new AuthMockConfigurationError(
      'AUTH_MOCK_MODE requires development, disabled PayOS checkout, a local wdp_payos_test replica set and a mock or live-test mode',
    );
  }
  return true;
}

export class PayosLiveTestConfigurationError extends Error {}

export const PAYOS_LIVE_TEST_AMOUNT = 2_000;

export function resolvePayosLiveTestMode(environment: NodeJS.ProcessEnv) {
  if (environment.PAYOS_LIVE_TEST_MODE?.trim().toLowerCase() !== 'true') return null;
  if (environment.NODE_ENV !== 'development' ||
      environment.AUTH_MOCK_MODE?.trim().toLowerCase() !== 'true' ||
      environment.PAYOS_ENABLED?.trim().toLowerCase() !== 'false' ||
      environment.PAYOS_MOCK_MODE?.trim().toLowerCase() !== 'false' ||
      !isLocalPayosTestDatabase(environment.MONGO_URL)) {
    throw new PayosLiveTestConfigurationError(
      'PAYOS_LIVE_TEST_MODE requires development, AUTH_MOCK_MODE=true, PAYOS_ENABLED=false, PAYOS_MOCK_MODE=false and local wdp_payos_test',
    );
  }

  const clientId = environment.PAYOS_LIVE_TEST_CLIENT_ID?.trim();
  const apiKey = environment.PAYOS_LIVE_TEST_API_KEY?.trim();
  const checksumKey = environment.PAYOS_LIVE_TEST_CHECKSUM_KEY?.trim();
 const probe = environment.PAYOS_LIVE_TEST_PROBE_ORDER_CODE?.trim() ?? '';
const probeOrderCode = Number(probe);

if (
  !clientId ||
  !apiKey ||
  !checksumKey ||
  !/^[1-9][0-9]*$/.test(probe) ||
  !Number.isSafeInteger(probeOrderCode)
) {
  throw new PayosLiveTestConfigurationError(
    'PAYOS_LIVE_TEST_MODE requires dedicated PAYOS_LIVE_TEST credentials and PAYOS_LIVE_TEST_PROBE_ORDER_CODE',
  );
}

  if (environment.PAYOS_CUSTOMER_ORIGIN !== 'http://127.0.0.1:' + (environment.PORT || '3000')) {
    throw new PayosLiveTestConfigurationError('PAYOS_LIVE_TEST_MODE requires PAYOS_CUSTOMER_ORIGIN to match the local server origin');
  }
return { clientId, apiKey, checksumKey, probeOrderCode };
}
