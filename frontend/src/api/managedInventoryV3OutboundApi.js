import axiosClient from './axiosClient';

const id = value => { if (!/^[a-f\d]{24}$/i.test(value || '')) throw new Error('Mã V3 không hợp lệ.'); return encodeURIComponent(value); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => JSON.stringify(canonical(value));
const slot = (scope, key) => `managed-v3-outbound:${scope}:${key}:pending`;
function readPending(scope, key) { try { const value = sessionStorage.getItem(slot(scope, key)); return value ? JSON.parse(value) : null; } catch { return null; } }
function savePending(scope, key, payload, revision) {
  const saved = readPending(scope, key), current = fingerprint(payload);
  if (saved && saved.fingerprint !== current) { const error = new Error('Yêu cầu trước chưa được đối soát. Hãy khôi phục đúng nội dung trước khi gửi yêu cầu mới.'); error.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH'; throw error; }
  if (saved) return saved;
  const entry = { key: globalThis.crypto?.randomUUID?.() || `mi-v3-outbound-${Date.now()}-${Math.random().toString(16).slice(2)}`, fingerprint: current, payload: canonical(payload), revision };
  try { sessionStorage.setItem(slot(scope, key), JSON.stringify(entry)); } catch { const error = new Error('Không thể lưu khóa đối soát trong trình duyệt. Bật session storage trước khi tiếp tục.'); error.code = 'IDEMPOTENCY_STORAGE_UNAVAILABLE'; throw error; }
  return entry;
}
const removePending = (scope, key) => { try { sessionStorage.removeItem(slot(scope, key)); } catch { /* storage may be unavailable after commit */ } };
const path = (skuId, suffix = '') => `/inventory-items/${id(skuId)}/v3/outbound${suffix}`;
export const managedInventoryV3OutboundApi = {
  context: skuId => axiosClient.get(path(skuId, '/context')),
  requests: (skuId, params = {}) => axiosClient.get(path(skuId, '-requests'), { params }),
  create: async (skuId, payload) => {
    const pending = savePending(skuId, 'create', payload);
    const response = await axiosClient.post(path(skuId, '-requests'), payload, { headers: { 'Idempotency-Key': pending.key } });
    removePending(skuId, 'create'); return response;
  },
  pendingCreate: skuId => readPending(skuId, 'create'),
  get: (skuId, requestId) => axiosClient.get(`${path(skuId, '-requests')}/${id(requestId)}`),
  cancel: async (skuId, requestId, revision) => {
    const payload = { requestId, revision }, pending = savePending(skuId, `cancel:${requestId}`, payload, revision);
    const response = await axiosClient.post(`${path(skuId, '-requests')}/${id(requestId)}/cancel`, {}, { headers: { 'If-Match': `"${pending.revision}"`, 'Idempotency-Key': pending.key } });
    removePending(skuId, `cancel:${requestId}`); return response;
  },
  preview: (skuId, requestId, accessSessionId, sessionRevision) => axiosClient.post(`${path(skuId, '-requests')}/${id(requestId)}/preview`, { accessSessionId, sessionRevision }),
  confirm: async (skuId, requestId, revision, payload) => {
    const pending = savePending(skuId, `confirm:${requestId}`, payload, revision);
    const response = await axiosClient.post(`${path(skuId, '-requests')}/${id(requestId)}/confirm`, payload, { headers: { 'If-Match': `"${pending.revision}"`, 'Idempotency-Key': pending.key } });
    removePending(skuId, `confirm:${requestId}`); return response;
  },
  pendingConfirm: (skuId, requestId) => readPending(skuId, `confirm:${requestId}`),
  operation: (skuId, key) => axiosClient.get(`/inventory-items/${id(skuId)}/v3/outbound/operations`, { params: { key } }),
  facilityRequests: (params = {}) => axiosClient.get('/inventory-items/managed-v3/facility/outbound-requests', { params }),
  facilityRequest: requestId => axiosClient.get(`/inventory-items/managed-v3/facility/outbound-requests/${id(requestId)}`),
};
