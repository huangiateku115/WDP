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
  const resolved=resolveApiBase(value ?? localDefault, development);
  if(!resolved)return undefined;
  const url=new URL(resolved);
  if(development&&platform==='android'&&url.hostname==='localhost')url.hostname='10.0.2.2';
  return url.origin+url.pathname.replace(/\/$/,'');
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
  if (!apiBase) throw new AxiosError('Chưa cấu hình địa chỉ dịch vụ hợp lệ.', 'API_NOT_CONFIGURED');
  return config;
});

apiClient.interceptors.response.use(response => response, (error: unknown) => {
  if (axios.isAxiosError(error) && error.response?.status === 401 && activeToken &&
      error.config && AxiosHeaders.from(error.config.headers).get('Authorization') === 'Bearer ' + activeToken) {
    onExpired?.();
  }
  return Promise.reject(error);
});

export async function wire(method: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE', url: string, options: {
  anonymous?: boolean; token?: string; body?: unknown; params?: Record<string, unknown>; key?: string; clientPlatform?: 'MOBILE'; ifMatch?: number|string; signal?: AbortSignal;
} = {}) {
  const token = options.anonymous ? undefined : options.token ?? activeToken;
  if (!options.anonymous && !token) throw new AxiosError('Vui lòng đăng nhập lại.', 'AUTH_REQUIRED');
  const response = await apiClient.request<unknown>({
    method, url, data: options.body, params: options.params, signal: options.signal,
    headers: {...(token ? {Authorization: 'Bearer ' + token} : {}), ...(options.key ? {'Idempotency-Key': options.key} : {}),
      ...(options.clientPlatform ? {'X-WDP-Payment-Client': options.clientPlatform} : {}),
      ...(options.ifMatch!==undefined ? {'If-Match': String(options.ifMatch)} : {})},
  });
  if (token && !options.token && token !== activeToken) throw new AxiosError('Phiên đăng nhập đã thay đổi.', 'SESSION_CHANGED');
  return response.data;
}

export class MobileInputError extends Error {}

export function apiIssue(error: unknown) {
  const customerSafe=(message:string)=>!/(\bbackend\b|\bfrontend\b|\bapi\b|\bendpoint\b|\bdto\b|\bschema\b|\bpayload\b|\bresponse\b|\brequest\b|\bledger\b|\bprojection\b|\brevision\b|\bidempotency\b|\bjournal\b|\bruntime\b|\benvironment\b|\bfixture\b|\bmock\b|\bdeveloper\b|\bv[23]\b|\breadback\b|\breconcile\b|\breservation\b|\bsku\b|\bhttp\b|\bmovement\b|\bspecification\b)/i.test(message);
  if (!axios.isAxiosError(error)) return error instanceof MobileInputError
    ? customerSafe(error.message)?error.message:'Thông tin hàng hóa hoặc đơn thuê chưa khớp. Vui lòng tải lại.'
    : 'Chưa thể xác minh thông tin. Vui lòng thử lại.';
  const code = error.response?.data?.code;
  if (code === 'INBOUND_CONFIRM_ENVIRONMENT_BLOCKED') return 'Tính năng xác nhận nhập hàng hiện chưa khả dụng. Vui lòng thử lại sau.';
  if (code === 'STOCK_WORKFLOW_NOT_AVAILABLE') return 'Thao tác tồn kho này hiện chưa khả dụng.';
  if (code === 'LEDGER_REPLAY_UNKNOWN' || code === 'CELL_STOCK_RECONCILIATION_UNKNOWN' ||
      code === 'CELL_ALLOCATION_RECONCILIATION_UNKNOWN' || code === 'CELL_COUNTER_RECONCILIATION_UNKNOWN' ||
      code === 'RESERVATION_COUNTER_RECONCILIATION_UNKNOWN' || code === 'CAPACITY_RECONCILIATION_UNKNOWN' ||
      code === 'LEGACY_STOCK_UNRECONCILED' || code === 'LEGACY_STOCK_SCOPE_UNKNOWN' ||
      code === 'TRANSACTIONS_UNAVAILABLE') return 'Chưa thể xác minh an toàn số tồn kho. Hãy tải lại sau hoặc liên hệ hỗ trợ.';
  if (code === 'OUTCOME_UNKNOWN') return 'Chưa xác định kết quả thao tác. Hãy kiểm tra giao dịch hiện có trước khi thử lại.';
  if (code === 'PAYOS_CONFIGURATION_MISSING' || code === 'PAYOS_CHECKOUT_DISABLED') return 'Cổng thanh toán chưa sẵn sàng.';
  if (['PAYOS_CHECKOUT_OUTCOME_UNKNOWN','PAYMENT_OUTCOME_UNKNOWN','PAYMENT_ATTEMPT_UNRESOLVED'].includes(code)) return 'Chưa xác định kết quả. Hãy kiểm tra giao dịch hiện có trước khi tiếp tục.';
  if (['AUTH_REQUIRED','SESSION_CHANGED'].includes(error.code ?? '')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (error.code==='API_NOT_CONFIGURED')return 'Dịch vụ hiện chưa sẵn sàng. Vui lòng thử lại sau.';
  if (!error.response) return error.code === 'ECONNABORTED' ? 'Kết nối mất nhiều thời gian. Vui lòng kiểm tra mạng và thử lại.' : 'Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.';
  const messages: Record<number,string> = {
    400:'Thông tin không hợp lệ. Vui lòng kiểm tra lại.', 401:'Không thể xác thực. Vui lòng đăng nhập lại.',
    403:'Tài khoản không có quyền thực hiện thao tác này.', 404:'Không tìm thấy dữ liệu hoặc chức năng chưa khả dụng.',
    409:'Dữ liệu đã thay đổi hoặc đang có giao dịch. Hãy tải lại trước khi tiếp tục.',
    410:'Thao tác này hiện chưa khả dụng.',
    412:'Dữ liệu đã thay đổi. Hãy tải lại trước khi tiếp tục.',
    422:'Thông tin hoặc vị trí đã chọn chưa hợp lệ. Vui lòng kiểm tra lại.',
    429:'Bạn thao tác quá nhanh. Vui lòng đợi rồi thử lại.',
    502:'Máy chủ chưa xác nhận kết quả. Hãy kiểm tra trạng thái.',
    503:'Dịch vụ tạm thời chưa sẵn sàng. Hãy kiểm tra trạng thái.',
  };
  return messages[error.response.status] ?? 'Máy chủ gặp lỗi. Vui lòng thử lại sau.';
}

export function apiIssueWithStatus(error:unknown){
  return apiIssue(error);
}
