import axiosClient from './axiosClient';
import {canonicalRange} from '@/lib/managedCellBooking';

function unavailable(error) {
  if (error.response?.status === 409) throw Error('Warehouse map unavailable: the facility or zone is inactive, or the facility does not support Managed Inventory.');
  throw error;
}

const warehouseMapApi = {
  getWarehouseMap: (facilityId, config = {}, range=null) => axiosClient.get('/warehouse-map', {...config, params:{facilityId,...canonicalRange(range)}}).catch(unavailable),
  getRackDetailMap: (rackId, config = {}, range=null) => axiosClient.get(`/racks/${encodeURIComponent(rackId)}/detail-map`, {...config,params:canonicalRange(range)}).catch(unavailable),
};
export default warehouseMapApi;
