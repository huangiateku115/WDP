import {Platform} from 'react-native';
import axios, {AxiosError, AxiosHeaders} from 'axios';

export function resolveApiBase(value: string | undefined, development: boolean) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    const local = /^(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(url.hostname);
    if (url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) ||
        !/^\/api\/v1\/?$/.test(url.pathname)) return undefined;
    return url.origin + '/api/v1';
  } catch {
    return undefined;
  }
}

export function configuredApiBase(value: string | undefined, development: boolean, platform: string) {
  const localDefault = development && platform === 'web' ? 'http://localhost:5000/api/v1'
    : development && platform === 'android' ? 'http://10.0.2.2:5000/api/v1' : undefined;
  return resolveApiBase(value ?? localDefault, development);
}

export const apiBase = configuredApiBase(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__, Platform.OS);
let activeToken: string | undefined;
let onExpired: (() => void) | undefined;

export function configureApiSession(token?: string, expire?: () => void) {
  activeToken = token;
  onExpired = expire;
}

export const apiClient = axios.create({baseURL: apiBase, timeout: 15000, maxRedirects: 0});

apiClient.interceptors.request.use(config => {
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(config.url ?? '') || config.baseURL !== apiBase) {
    throw new AxiosError('Đường dẫn API không hợp lệ.', 'API_ORIGIN_REJECTED');
  }
  if (!apiBase) throw new AxiosError('Chưa cấu hình địa chỉ Backend hợp lệ.', 'API_NOT_CONFIGURED');
  return config;
});

apiClient.interceptors.response.use(response => response, (error: unknown) => {
  if (axios.isAxiosError(error) && error.response?.status === 401 && activeToken &&
      error.config && AxiosHeaders.from(error.config.headers).get('Authorization') === 'Bearer ' + activeToken) {
    onExpired?.();
  }
  return Promise.reject(error);
});

export async function wire(method: 'GET'|'POST'|'PATCH'|'PUT', url: string, options: {
  anonymous?: boolean; token?: string; body?: unknown; params?: Record<string, unknown>; key?: string; clientPlatform?: 'MOBILE'; signal?: AbortSignal;
} = {}) {
  const token = options.anonymous ? undefined : options.token ?? activeToken;
  if (!options.anonymous && !token) throw new AxiosError('Vui lòng đăng nhập lại.', 'AUTH_REQUIRED');
  const response = await apiClient.request<unknown>({
    method, url, data: options.body, params: options.params, signal: options.signal,
    headers: {...(token ? {Authorization: 'Bearer ' + token} : {}), ...(options.key ? {'Idempotency-Key': options.key} : {}),
      ...(options.clientPlatform ? {'X-WDP-Payment-Client': options.clientPlatform} : {})},
  });
  if (token && !options.token && token !== activeToken) throw new AxiosError('Phiên đăng nhập đã thay đổi.', 'SESSION_CHANGED');
  return response.data;
}

export class MobileInputError extends Error {}

export function apiIssue(error: unknown) {
  if (!axios.isAxiosError(error)) return error instanceof MobileInputError ? error.message : 'Không thể xác minh dữ liệu máy chủ. Vui lòng kiểm tra lại.';
  const code = error.response?.data?.code;
  if (code === 'PAYOS_CONFIGURATION_MISSING' || code === 'PAYOS_CHECKOUT_DISABLED') return 'Cổng thanh toán chưa sẵn sàng.';
  if (['PAYOS_CHECKOUT_OUTCOME_UNKNOWN','PAYMENT_OUTCOME_UNKNOWN','PAYMENT_ATTEMPT_UNRESOLVED'].includes(code)) return 'Chưa xác định kết quả. Hãy kiểm tra giao dịch hiện có trước khi tiếp tục.';
  if (['API_NOT_CONFIGURED','AUTH_REQUIRED','SESSION_CHANGED'].includes(error.code ?? '')) return error.message;
  if (!error.response) return error.code === 'ECONNABORTED' ? 'Yêu cầu quá thời gian. Vui lòng kiểm tra trạng thái.' : 'Không kết nối được máy chủ.';
  const messages: Record<number,string> = {
    400:'Thông tin không hợp lệ. Vui lòng kiểm tra lại.', 401:'Không thể xác thực. Vui lòng đăng nhập lại.',
    403:'Tài khoản không có quyền thực hiện thao tác này.', 404:'Không tìm thấy dữ liệu hoặc chức năng chưa khả dụng.',
    409:'Dữ liệu đã thay đổi hoặc đang có giao dịch. Hãy tải lại trước khi tiếp tục.',
    429:'Bạn thao tác quá nhanh. Vui lòng đợi rồi thử lại.',
    502:'Máy chủ chưa xác nhận kết quả. Hãy kiểm tra trạng thái.',
    503:'Dịch vụ tạm thời chưa sẵn sàng. Hãy kiểm tra trạng thái.',
  };
  return messages[error.response.status] ?? 'Máy chủ gặp lỗi. Vui lòng thử lại sau.';
}
