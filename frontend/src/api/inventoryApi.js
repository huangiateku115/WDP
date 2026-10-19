import axiosClient from "./axiosClient";
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const inventoryItemId=value=>{if(!/^[a-f\d]{24}$/i.test(value||''))throw Error('Invalid inventory item ID.');return encodeURIComponent(value);};
const inventoryApi = {
  getMine: ({page=1,limit=20}={},config={})=>axiosClient.get('/inventory-items/me',{...config,params:{page,limit}}),
  get: (id,config)=>axiosClient.get(`/inventory-items/${inventoryItemId(id)}`,config),
  create: payload=>axiosClient.post('/inventory-items',payload),
  uploadImage: (file,managedReservationId,{signal,onUploadProgress,idempotencyKey}={})=>{const body=new FormData();body.append('file',file);body.append('managedReservationId',managedReservationId);return axiosClient.post('/inventory-items/image-uploads',body,{signal,onUploadProgress,headers:{'Content-Type':'multipart/form-data','Idempotency-Key':idempotencyKey}});},
  removeImageUpload: uploadId=>axiosClient.delete(`/inventory-items/image-uploads/${encodeURIComponent(uploadId)}`),
  requestInbound: id=>axiosClient.post(`/inventory-items/${inventoryItemId(id)}/inbound-request`,{}),
  update: (id,payload)=>axiosClient.patch(`/inventory-items/${inventoryItemId(id)}`,payload),
  preview: (id,cellId,config={})=>axiosClient.get(`/inventory-items/${inventoryItemId(id)}/placement-preview`,{...config,params:cellId?{cellId}:{} }),
};
export default inventoryApi;
