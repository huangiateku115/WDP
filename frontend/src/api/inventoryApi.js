import axiosClient from "./axiosClient";
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const inventoryItemId=value=>{if(!/^[a-f\d]{24}$/i.test(value||''))throw Error('Invalid inventory item ID.');return encodeURIComponent(value);};
const inventoryApi = {
  getMine: ({page=1,limit=20}={},config={})=>axiosClient.get('/inventory-items/me',{...config,params:{page,limit}}),
  get: (id,config)=>axiosClient.get(`/inventory-items/${inventoryItemId(id)}`,config),
  movements: (id,config)=>axiosClient.get(`/inventory-items/${inventoryItemId(id)}/movements`,config),
  create: payload=>axiosClient.post('/inventory-items',payload),
  requestOutbound: (id,config)=>axiosClient.post(`/inventory-items/${inventoryItemId(id)}/outbound-request`,{},config),
  requestInbound: id=>axiosClient.post(`/inventory-items/${inventoryItemId(id)}/inbound-request`,{}),
  update: (id,payload)=>axiosClient.patch(`/inventory-items/${inventoryItemId(id)}`,payload),
  preview: (id,cellId,config={})=>axiosClient.get(`/inventory-items/${inventoryItemId(id)}/placement-preview`,{...config,params:cellId?{cellId}:{} }),
};
export default inventoryApi;
