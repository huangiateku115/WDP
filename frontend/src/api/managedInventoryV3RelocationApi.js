import axiosClient from './axiosClient';

const id = value => { if (!/^[a-f\d]{24}$/i.test(value || '')) throw new Error('Mã mặt hàng không hợp lệ.'); return encodeURIComponent(value); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => JSON.stringify(canonical(value));
const slot = skuId => `managed-v3-relocation:${skuId}:pending`;
function pendingFor(skuId) { try { const value = sessionStorage.getItem(slot(skuId)); return value ? JSON.parse(value) : null; } catch { return null; } }
function savePending(skuId, payload) {
  const existing = pendingFor(skuId), current = fingerprint(payload);
  if (existing && existing.fingerprint !== current) { const error = new Error('Phiếu chuyển trước chưa được đối soát. Hãy khôi phục đúng nội dung đang chờ trước khi tạo phiếu khác.'); error.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH'; throw error; }
  if (existing) return existing;
  const entry = { key: globalThis.crypto?.randomUUID?.() || `mi-move-${Date.now()}-${Math.random().toString(16).slice(2)}`, fingerprint: current, payload: canonical(payload) };
  try { sessionStorage.setItem(slot(skuId), JSON.stringify(entry)); } catch { const error = new Error('Không thể lưu mã đối soát trong trình duyệt.'); error.code = 'IDEMPOTENCY_STORAGE_UNAVAILABLE'; throw error; }
  return entry;
}
const clearPending = skuId => { try { sessionStorage.removeItem(slot(skuId)); } catch { /* retain operation recovery state */ } };
const path = (skuId, suffix = '') => `/inventory-items/${id(skuId)}/v3/relocation${suffix}`;

export const managedInventoryV3RelocationApi = {
  context: skuId => axiosClient.get(path(skuId, '/context')),
  preview: (skuId, payload) => axiosClient.post(path(skuId, '/preview'), payload),
  confirm: async (skuId, payload) => {
    const saved = savePending(skuId, payload);
    const response = await axiosClient.post(path(skuId), saved.payload, { headers: { 'Idempotency-Key': saved.key, 'If-Match': `"${payload.skuRevision}"` } });
    clearPending(skuId); return response;
  },
  operation: (skuId, key) => axiosClient.get(path(skuId, '/operations'), { params: { key } }),
  pending: pendingFor,
  clearPending,
};
