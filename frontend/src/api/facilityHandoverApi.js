import client from './axiosClient';
export default {
 contract: (reservationId, config) => client.get(`/contracts/reservation/${encodeURIComponent(reservationId)}`, config),
 print: (contractId, config) => client.get(`/contracts/${encodeURIComponent(contractId)}/print`, config),
 confirmPaper: (contractId, file, number, evidence) => {
  const body = new FormData(); body.append('proofFile', file);
  if (number.trim()) body.append('paperContractNumber', number.trim());
  if (evidence) for (const key of ['documentVersion','documentHash','customerSignedAt','facilitySignedAt','customerIdentityVerified']) body.append(key, String(evidence[key]));
  return client.post(`/contracts/${encodeURIComponent(contractId)}/confirm-signed-paper`, body, {headers:{'Content-Type':'multipart/form-data'}});
 },
 handover: (reservationId, evidence = {}) => client.post(`/reservations/${encodeURIComponent(reservationId)}/handover`, evidence),
 reject: (reservationId, reason) => client.patch(`/reservations/${encodeURIComponent(reservationId)}/cancel`, { reason }),
 completeCheckout: (reservationId, condition = 'GOOD', note = '') => client.post(`/reservations/${encodeURIComponent(reservationId)}/complete-checkout`, { condition, note }),
 rejectCheckout: (reservationId, reason) => client.post(`/reservations/${encodeURIComponent(reservationId)}/reject-checkout`, { reason }),
};
