import axiosClient from "./axiosClient";
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const inventoryItemId = (value) => {
  if (!/^[a-f\d]{24}$/i.test(value || ""))
    throw Error("Invalid inventory item ID.");
  return encodeURIComponent(value);
};
export const inventoryApi = {
  createRepeatedInbound: (itemId, payload, idempotencyKey, config = {}) =>
    axiosClient.post(`/inventory-items/${inventoryItemId(itemId)}/inbound-requests`, payload, { ...config, headers: { ...config.headers, 'Idempotency-Key': idempotencyKey } }),
  repeatedInboundHistory: (itemId, params = {}, config = {}) =>
    axiosClient.get(`/inventory-items/${inventoryItemId(itemId)}/inbound-requests`, { ...config, params }),
  repeatedInboundDetail: (requestId, config = {}) => axiosClient.get(`/inbound-requests/${inventoryItemId(requestId)}`, config),
  createCanonicalOutbound: (itemId, payload, idempotencyKey, config = {}) => axiosClient.post(`/inventory-items/${inventoryItemId(itemId)}/outbound-requests`, payload, { ...config, headers: { ...config.headers, 'Idempotency-Key': idempotencyKey } }),
  canonicalOutboundHistory: (itemId, params = {}, config = {}) => axiosClient.get(`/inventory-items/${inventoryItemId(itemId)}/outbound-requests`, { ...config, params }),
  canonicalOutboundDetail: (requestId, config = {}) => axiosClient.get(`/outbound-requests/${inventoryItemId(requestId)}`, config),
  cancelCanonicalOutbound: (requestId, version, idempotencyKey, config = {}) => axiosClient.post(`/outbound-requests/${inventoryItemId(requestId)}/cancel`, {}, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } }),
  canonicalOutboundStaffQueue: (params = {}, config = {}) => axiosClient.get('/outbound-requests/staff-queue', { ...config, params }),
  canonicalOutboundStaffDetail: (requestId, config = {}) => axiosClient.get(`/outbound-requests/${inventoryItemId(requestId)}/staff-detail`, config),
  confirmCanonicalOutbound: (requestId, payload, version, idempotencyKey, config = {}) => axiosClient.post(`/outbound-requests/${inventoryItemId(requestId)}/confirm`, payload, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } }),
  canonicalRelocationContext: (itemId, config = {}) => axiosClient.get(`/inventory-items/${inventoryItemId(itemId)}/relocate-canonical/context`, config),
  relocateCanonical: (itemId, payload, idempotencyKey, config = {}) => axiosClient.post(`/inventory-items/${inventoryItemId(itemId)}/relocate-canonical`, payload, { ...config, headers: { ...config.headers, 'Idempotency-Key': idempotencyKey } }),
  amendRepeatedInbound: (requestId, payload, version, idempotencyKey, config = {}) =>
    axiosClient.patch(`/inbound-requests/${inventoryItemId(requestId)}`, payload, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } }),
  cancelRepeatedInbound: (requestId, version, idempotencyKey, config = {}) =>
    axiosClient.post(`/inbound-requests/${inventoryItemId(requestId)}/cancel`, {}, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } }),
  repeatedInboundQueue: (params = {}, config = {}) => axiosClient.get('/inbound-requests/receiving-queue', { ...config, params }),
  stockBalance: (itemId, config = {}) => axiosClient.get(`/inventory-items/${inventoryItemId(itemId)}/stock-balance`, config),
  repeatedInboundReceivingDetail: (requestId, config = {}) => axiosClient.get(`/inbound-requests/${inventoryItemId(requestId)}/receiving`, config),
  uploadRepeatedInboundEvidence: (requestId, file, idempotencyKey, config = {}) => {
    const body = new FormData(); body.append('file', file);
    return axiosClient.post(`/inbound-requests/${inventoryItemId(requestId)}/evidence-uploads`, body, { ...config, headers: { ...config.headers, 'Content-Type': undefined, 'Idempotency-Key': idempotencyKey } });
  },
  inspectRepeatedInbound: (requestId, payload, version, config = {}) =>
    axiosClient.post(`/inbound-requests/${inventoryItemId(requestId)}/inspection`, payload, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"` } }),
  completeRepeatedInboundReturn: (requestId, returnNote, version, idempotencyKey, config = {}) =>
    axiosClient.post(`/inbound-requests/${inventoryItemId(requestId)}/return-completed`, { returnNote }, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } }),
  confirmRepeatedInbound: (requestId, payload, version, config = {}) =>
    axiosClient.post(`/inbound-requests/${inventoryItemId(requestId)}/confirm`, payload, { ...config, headers: { ...config.headers, 'If-Match': `"${version}"` } }),
  uploadImage: (file, reservationId, {idempotencyKey, ...config} = {}) => {
    inventoryItemId(reservationId);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(idempotencyKey || '')) throw Error('Invalid image upload idempotency key.');
    const body = new FormData();
    body.append('file', file);
    body.append('managedReservationId', reservationId);
    return axiosClient.post('/inventory-items/image-uploads', body, {...config, headers: {'Content-Type': undefined, 'Idempotency-Key': idempotencyKey}});
  },
  removeImageUpload: (uploadId, config) => axiosClient.delete(`/inventory-items/image-uploads/${inventoryItemId(uploadId)}`, config),
  getMine: ({ page = 1, limit = 20 } = {}, config = {}) =>
    axiosClient.get("/inventory-items/me", {
      ...config,
      params: { page, limit },
    }),
  get: (id, config) =>
    axiosClient.get(`/inventory-items/${inventoryItemId(id)}`, config),
  movements: (id, config) =>
    axiosClient.get(
      `/inventory-items/${inventoryItemId(id)}/movements`,
      config,
    ),
  create: (payload) => axiosClient.post("/inventory-items", payload),
  requestOutbound: (id, config) =>
    axiosClient.post(
      `/inventory-items/${inventoryItemId(id)}/outbound-request`,
      {},
      config,
    ),
  requestInbound: (id) =>
    axiosClient.post(
      `/inventory-items/${inventoryItemId(id)}/inbound-request`,
      {},
    ),
  update: (id, payload) =>
    axiosClient.patch(`/inventory-items/${inventoryItemId(id)}`, payload),
  preview: (id, cellId, config = {}) =>
    axiosClient.get(
      `/inventory-items/${inventoryItemId(id)}/placement-preview`,
      { ...config, params: cellId ? { cellId } : {} },
    ),
};
export default inventoryApi;
