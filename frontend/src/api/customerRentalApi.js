import client from './axiosClient';
const id=value=>encodeURIComponent(value);
// Confirmed Customer contracts from the supplied workflow; no management actions.
export const customerProfileApi={save:({identityCard,address,taxCode})=>client.put('/customers/me/profile',{identityCard,address,taxCode})};
export const accessApi={unlock:({reservationCode,pinCode})=>client.post('/access/simulate-unlock',{reservationCode,pinCode})};
export const pricingApi={
  list:params=>client.get('/pricing-rules',{params}),
  resolve:({facilityId,serviceType,unitSize,termValue,termUnit,at},config={})=>client.get('/pricing-rules/resolve',{...config,params:{facilityId,serviceType,unitSize,termValue,termUnit,at}}),
  policies:params=>client.get('/policies',{params}),
  resolvePolicy:({facilityId,serviceType,type,at},config={})=>client.get('/policies/resolve',{...config,params:{facilityId,serviceType,type,at}}),
};
