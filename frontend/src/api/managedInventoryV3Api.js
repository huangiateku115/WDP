import axiosClient from './axiosClient';

const id = value => { if (!/^[a-f\d]{24}$/i.test(value || '')) throw new Error('Mã SKU không hợp lệ.'); return encodeURIComponent(value); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => JSON.stringify(canonical(value));
const slot = skuId => `managed-v3-inbound:${skuId}`;
function pending(skuId) { try { const value = sessionStorage.getItem(slot(skuId)); return value ? JSON.parse(value) : null; } catch { return null; } }
function savePending(skuId, value) { try { sessionStorage.setItem(slot(skuId), JSON.stringify(value)); } catch { const error = new Error('Không thể lưu khóa đối soát trong phiên trình duyệt. Hãy bật session storage trước khi xác nhận nhập hàng.'); error.code = 'IDEMPOTENCY_STORAGE_UNAVAILABLE'; throw error; } }
function removePending(skuId) { try { sessionStorage.removeItem(slot(skuId)); } catch { /* Storage can become unavailable after a completed request. */ } }
function keyFor(skuId, payload) {
  const saved = pending(skuId), requestFingerprint = fingerprint(payload);
  if (saved) {
    if (saved.fingerprint !== requestFingerprint) { const error = new Error('Đang có lần nhập chưa được đối soát. Hãy khôi phục đúng yêu cầu ban đầu trước khi sửa số liệu.'); error.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH'; throw error; }
    return saved.key;
  }
  const key = globalThis.crypto?.randomUUID?.() || `mi-v3-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  savePending(skuId, { key, fingerprint: requestFingerprint, payload: canonical(payload) });
  return key;
}
export const managedInventoryV3Api = {
  preparePhysicalUnit: (skuId, payload) => axiosClient.post(`/inventory-items/${id(skuId)}/v3/physical-units`, payload),
  physicalUnits: skuId => axiosClient.get(`/inventory-items/${id(skuId)}/v3/physical-units`),
  previewInbound: (skuId, payload) => axiosClient.post(`/inventory-items/${id(skuId)}/v3/inbound/preview`, payload),
  confirmInbound: async (skuId, payload) => {
    const key = keyFor(skuId, payload);
    const response = await axiosClient.post(`/inventory-items/${id(skuId)}/v3/inbound`, payload, { headers: { 'Idempotency-Key': key } });
    removePending(skuId); return response;
  },
  operation: (skuId, key) => axiosClient.get(`/inventory-items/${id(skuId)}/v3/operations`, { params: { key } }),
  stock: skuId => axiosClient.get(`/inventory-items/${id(skuId)}/v3/stock`),
  movements: skuId => axiosClient.get(`/inventory-items/${id(skuId)}/v3/movements`),
  facilityOverview: () => axiosClient.get('/inventory-items/managed-v3/facility/overview'),
  pending: skuId => pending(skuId),
  clearPending: removePending,
};
