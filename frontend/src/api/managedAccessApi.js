import client from './axiosClient';
const id = value => encodeURIComponent(value);
const fallbackKeys = new Map();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = payload => JSON.stringify(canonical(payload));
const readPending = slot => {
  let raw = fallbackKeys.get(slot);
  try { raw = globalThis.sessionStorage?.getItem(slot) ?? raw; } catch { /* sessionStorage can be unavailable */ }
  if (!raw) return null;
  try { const parsed = JSON.parse(raw); if (parsed?.key) return parsed; } catch { /* accept a legacy key as unresolved */ }
  return { key: raw, fingerprint: null, payload: null };
};
const savePending = (slot, entry) => {
  const serialized = JSON.stringify(entry);
  try { if (globalThis.sessionStorage) { globalThis.sessionStorage.setItem(slot, serialized); fallbackKeys.delete(slot); return; } } catch { /* keep an in-memory fallback for this page */ }
  fallbackKeys.set(slot, serialized);
};
const keyFor = (slot, payload) => {
  const requestFingerprint = fingerprint(payload), pending = readPending(slot);
  if (pending) {
    if (pending.fingerprint !== requestFingerprint) {
      const error = new Error('Đang có yêu cầu trước chưa được đối soát. Hãy khôi phục đúng nội dung yêu cầu đó trước khi tạo thao tác khác.');
      error.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH'; throw error;
    }
    return pending.key;
  }
  const value = globalThis.crypto?.randomUUID?.() || `mi-access-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  savePending(slot, { key: value, fingerprint: requestFingerprint, payload: canonical(payload) });
  return value;
};
const clearKey = slot => { try { globalThis.sessionStorage?.removeItem(slot); } catch { /* no-op */ } fallbackKeys.delete(slot); };
const createSlot = 'managed-access:create-visit:pending';
const checkInSlot = (visitId, actorId) => actorId ? `managed-access:check-in:${actorId}:${visitId}:pending` : `managed-access:check-in:${visitId}:pending`;
const amendSlot = visitId => `managed-access:amend-visit:${visitId}:pending`;
export const managedAccessApi = {
  createVisit: async payload => { const response = await client.post('/access/managed-v3/visits', payload, { headers: { 'Idempotency-Key': keyFor(createSlot, payload) } }); clearKey(createSlot); return response; },
  visitAvailability: (reservationId, date, config = {}) => client.get('/access/managed-v3/visits/availability', { ...config, params: { reservationId, date } }),
  pendingCreateKey: () => readPending(createSlot)?.key ?? null,
  pendingCreate: () => readPending(createSlot),
  pendingCreateMatches: payload => readPending(createSlot)?.fingerprint === fingerprint(payload),
  clearPendingCreateKey: () => clearKey(createSlot),
  myVisits: () => client.get('/access/managed-v3/visits/me'),
  visit: visitId => client.get(`/access/managed-v3/visits/${id(visitId)}`),
  amendVisit: async (visitId, payload, revision) => {
    const slot = amendSlot(visitId);
    const requestFingerprint = fingerprint(payload);
    let pending = readPending(slot);
    if (pending && pending.fingerprint !== requestFingerprint) {
      const error = new Error('Đang có yêu cầu sửa lịch chưa được đối soát. Hãy khôi phục đúng nội dung trước khi gửi thay đổi khác.');
      error.code = 'IDEMPOTENCY_PAYLOAD_MISMATCH'; throw error;
    }
    if (!pending) {
      const key = globalThis.crypto?.randomUUID?.() || `mi-access-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      pending = { key, fingerprint: requestFingerprint, payload: canonical(payload), expectedRevision: Number(revision) };
      savePending(slot, pending);
    }
    const originalRevision = Number.isSafeInteger(pending.expectedRevision) ? pending.expectedRevision : Number(revision);
    if (!Number.isSafeInteger(originalRevision) || originalRevision < 0) {
      const error = new Error('Không có revision gốc đáng tin cậy cho yêu cầu sửa lịch. Hãy hủy yêu cầu đang treo và tải lại lịch.');
      error.code = 'AMEND_REVISION_UNAVAILABLE'; throw error;
    }
    try {
      const response = await client.patch(`/access/managed-v3/visits/${id(visitId)}`, payload, { headers: { 'If-Match': String(originalRevision), 'Idempotency-Key': pending.key } });
      clearKey(slot); return response;
    } catch (error) {
      throw error;
    }
  },
  pendingAmend: visitId => readPending(amendSlot(visitId)),
  pendingAmendKey: visitId => readPending(amendSlot(visitId))?.key ?? null,
  clearPendingAmend: visitId => clearKey(amendSlot(visitId)),
  cancelVisit: (visitId, revision) => client.post(`/access/managed-v3/visits/${id(visitId)}/cancel`, {}, { headers: { 'If-Match': String(revision) } }),
  mySessions: () => client.get('/access/managed-v3/sessions/me'),
  session: sessionId => client.get(`/access/managed-v3/sessions/${id(sessionId)}`),
  facilityVisits: () => client.get('/access/managed-v3/visits/facility'),
  staff: () => client.get('/access/managed-v3/visits/facility/staff'),
  assign: (visitId, staffId, reason, revision) => client.put(`/access/managed-v3/visits/${id(visitId)}/assignment`, { staffId, reason }, { headers: { 'If-Match': String(revision) } }),
  checkIn: async (visitId, attestation, actorId) => { const slot = checkInSlot(visitId, actorId); const response = await client.post(`/access/managed-v3/visits/${id(visitId)}/check-in`, attestation, { headers: { 'Idempotency-Key': keyFor(slot, attestation) } }); clearKey(slot); return response; },
  pendingCheckInKey: (visitId, actorId) => readPending(checkInSlot(visitId, actorId))?.key ?? null,
  pendingCheckIn: (visitId, actorId) => readPending(checkInSlot(visitId, actorId)),
  clearPendingCheckInKey: (visitId, actorId) => clearKey(checkInSlot(visitId, actorId)),
  facilitySessions: () => client.get('/access/managed-v3/sessions/facility'),
  checkOut: (sessionId, revision) => client.post(`/access/managed-v3/sessions/${id(sessionId)}/check-out`, {}, { headers: { 'If-Match': String(revision) } }),
  revoke: (sessionId, revision, reason) => client.post(`/access/managed-v3/sessions/${id(sessionId)}/revoke`, { reason }, { headers: { 'If-Match': String(revision) } }),
};
