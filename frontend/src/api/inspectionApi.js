import client from './axiosClient';
const id=value=>encodeURIComponent(value);
export default {
 list:(params={},config={})=>client.get('/inspections',{...config,params}),
 create:body=>client.post('/inspections',body),
 complete:inspectionId=>client.patch(`/inspections/${id(inspectionId)}/complete`),
 contractByReservation:(reservationId,config)=>client.get(`/contracts/reservation/${id(reservationId)}`,config),
 contract:(contractId,config)=>client.get(`/contracts/${id(contractId)}`,config),
};
