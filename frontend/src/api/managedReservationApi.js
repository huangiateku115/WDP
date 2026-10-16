import client from './axiosClient';
import {managedRequest} from '@/lib/customerReservationService';
const id=value=>{if(!/^[a-f\d]{24}$/i.test(value||''))throw Error('Invalid Managed reservation or facility ID.');return encodeURIComponent(value);};
// Verified in BE-REF reservation.routes + managed-reservation.service. Customer actions only.
export default {
  capacity:(facilityId,{startDate,endDate},config={})=>client.get(`/reservations/managed/capacity/${id(facilityId)}`,{...config,params:{startDate,endDate}}),
  quote:(payload,config)=>client.post('/reservations/managed/quote',managedRequest(payload),config),
  create:(payload,config)=>client.post('/reservations/managed',managedRequest(payload),config),
  detail:(reservationId,config)=>client.get(`/reservations/managed/${id(reservationId)}`,config),
  cancel:reservationId=>client.patch(`/reservations/managed/${id(reservationId)}/cancel`),
  mockPay:reservationId=>client.post(`/reservations/managed/${id(reservationId)}/mock-pay`),
  initiateDeposit:(reservationId,{idempotencyKey},config)=>client.post(`/reservations/managed/${id(reservationId)}/deposit`,{idempotencyKey},config),
  confirmMockDeposit:(reservationId,{idempotencyKey},config)=>client.post(`/reservations/managed/${id(reservationId)}/deposit/mock-confirm`,{idempotencyKey},config),
};
