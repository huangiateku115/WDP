import client from './axiosClient';
const id=value=>encodeURIComponent(value);
// Confirmed Customer contracts from the supplied workflow; no management actions.
export const customerProfileApi={get:config=>client.get('/customers/me/profile',config),save:({identityCard,address,taxCode})=>client.put('/customers/me/profile',{identityCard,address,taxCode})};
export const accessApi={logs:config=>client.get('/access/me',config),unlock:({reservationCode,pinCode})=>client.post('/access/simulate-unlock',{reservationCode,pinCode})};
export const pricingApi={
  list:(params,config={})=>client.get('/pricing-rules',{...config,params}),
  resolve:({facilityId,serviceType,unitSize,termValue,termUnit,at},config={})=>client.get('/pricing-rules/resolve',{...config,params:{facilityId,serviceType,unitSize,termValue,termUnit,at}}),
  policies:params=>client.get('/policies',{params}),
  resolvePolicy:({facilityId,serviceType,type,at},config={})=>client.get('/policies/resolve',{...config,params:{facilityId,serviceType,type,at}}),
};

// Source-confirmed notification ownership; absent from the two collection snapshots.
export const notificationApi={mine:config=>client.get('/notifications/me',config),read:notificationId=>client.patch(`/notifications/${id(notificationId)}/read`)};
