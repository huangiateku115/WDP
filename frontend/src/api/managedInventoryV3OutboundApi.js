import axiosClient from './axiosClient';

const id = value => { if (!/^[a-f\d]{24}$/i.test(value || '')) throw new Error('Mã V3 không hợp lệ.'); return encodeURIComponent(value); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => JSON.stringify(canonical(value));
const slot = skuId => `managed-v3-direct-outbound:${skuId}:pending`;
function readPending(skuId) { try { const value = sessionStorage.getItem(slot(skuId)); return value ? JSON.parse(value) : null; } catch { return null; } }
function savePending(skuId, payload) {
  const saved = readPending(skuId), current = fingerprint(payload);
  if (saved && saved.fingerprint !== current) { const error = new Error('Kết quả lần xuất trước chưa được đối soát. Hãy khôi phục đúng nội dung đang chờ trước khi bắt đầu lần khác.'); error.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH'; throw error; }
  if (saved) return saved;
  const entry = { key: globalThis.crypto?.randomUUID?.() || `mi-out-${Date.now()}-${Math.random().toString(16).slice(2)}`, fingerprint: current, payload: canonical(payload) };
  try { sessionStorage.setItem(slot(skuId), JSON.stringify(entry)); } catch { const error = new Error('Không thể lưu khóa đối soát trong trình duyệt. Hãy bật session storage trước khi tiếp tục.'); error.code = 'IDEMPOTENCY_STORAGE_UNAVAILABLE'; throw error; }
  return entry;
}
const removePending = skuId => { try { sessionStorage.removeItem(slot(skuId)); } catch { /* keep the operation recoverable */ } };
const path = (skuId, suffix = '') => `/inventory-items/${id(skuId)}/v3/outbound${suffix}`;

export const managedInventoryV3OutboundApi = {
  context: skuId => axiosClient.get(path(skuId, '/context')),
  preview: (skuId, payload) => axiosClient.post(path(skuId, '/preview'), payload),
  confirm: async (skuId, payload) => {
    const pending = savePending(skuId, payload);
    try {
      const response = await axiosClient.post(path(skuId), payload, { headers: { 'Idempotency-Key': pending.key, 'If-Match': `"${payload.skuRevision}"` } });
      removePending(skuId); return response;
    } catch (error) {
      const responseStatus = error?.response?.status;
      const responseBody = error?.response?.data;
      // This exact SKU path validation runs before Backend reads or writes.
      // Releasing only this deterministic rejection allows a corrected preview safely.
      if ([400, 422].includes(responseStatus) && responseBody?.code === 'INVALID_INPUT' && responseBody?.message === 'skuId không hợp lệ.') {
        removePending(skuId);
        error.code = 'OUTBOUND_REJECTED_NO_WRITE';
      }
      throw error;
    }
  },
  pending: skuId => readPending(skuId),
  clearPending: removePending,
  operation: (skuId, key) => axiosClient.get(path(skuId, '/operations'), { params: { key } }),
  movements: skuId => axiosClient.get(`/inventory-items/${id(skuId)}/v3/movements`),
  cellStock: skuId => axiosClient.get(`/inventory-items/${id(skuId)}/v3/cell-stock`),
};
