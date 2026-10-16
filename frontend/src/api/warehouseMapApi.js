import axiosClient from './axiosClient';

function unavailable(error) {
  if (error.response?.status === 409) throw Error('Warehouse map unavailable: the facility or zone is inactive, or the facility does not support Managed Inventory.');
  throw error;
}

const warehouseMapApi = {
  getWarehouseMap: (facilityId, config = {}) => axiosClient.get('/warehouse-map', {...config, params:{...config.params,facilityId}}).catch(unavailable),
  getRackDetailMap: (rackId, config = {}) => axiosClient.get(`/racks/${encodeURIComponent(rackId)}/detail-map`, config).catch(unavailable),
};
export default warehouseMapApi;
