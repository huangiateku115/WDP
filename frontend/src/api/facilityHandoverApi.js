import client from './axiosClient';
export default {
 contract: (reservationId, config) => client.get(`/contracts/reservation/${encodeURIComponent(reservationId)}`, config),
 print: (contractId, config) => client.get(`/contracts/${encodeURIComponent(contractId)}/print`, config),
 confirmPaper: (contractId, file, number) => {
  const body = new FormData(); body.append('proofFile', file);
  if (number.trim()) body.append('paperContractNumber', number.trim());
  return client.post(`/contracts/${encodeURIComponent(contractId)}/confirm-signed-paper`, body, {headers:{'Content-Type':'multipart/form-data'}});
 },
 handover: reservationId => client.post(`/reservations/${encodeURIComponent(reservationId)}/handover`, {}),
};
