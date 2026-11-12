import client from './axiosClient';

const id = value => {
  if (!/^[a-f\d]{24}$/i.test(value || '')) throw Error('Mã định danh không hợp lệ.');
  return encodeURIComponent(value);
};
const resource = kind => {
  if (!['warehouse-zones', 'racks', 'rack-cells'].includes(kind)) throw Error('Loại cấu trúc không hợp lệ.');
  return kind;
};

// Confirmed against local inventory-item, warehouse-map and reservation routes.
export default {
  items: (facilityId, params, config = {}) => client.get('/inventory-items', {
    ...config, params: { ...params, facilityId: id(facilityId) },
  }),
  readiness: (reservationId, config) => client.get(`/reservations/managed/${id(reservationId)}/closure-readiness`, config),
  list: (kind, facilityId, params = {}, config = {}) => client.get(`/${resource(kind)}`, {
    ...config, params: { ...params, facilityId: id(facilityId) },
  }),
  detail: (kind, recordId, config) => client.get(`/${resource(kind)}/${id(recordId)}`, config),
  create: (kind, body) => client.post(`/${resource(kind)}`, body),
  update: (kind, recordId, body) => client.patch(`/${resource(kind)}/${id(recordId)}`, body),
};
