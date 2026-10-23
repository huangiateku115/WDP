import axiosClient from "./axiosClient";
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

const supportApi = {
  createReal: ({category,subject,description})=>axiosClient.post('/support-requests',{category,subject,description}),
  replyReal: (id,message)=>axiosClient.post(`/support-requests/${encodeURIComponent(id)}/messages`,{message,isInternal:false}),
  listReal: config=>axiosClient.get('/support-requests',config),
  detailReal: (id,config)=>axiosClient.get(`/support-requests/${encodeURIComponent(id)}`,config),
  messagesReal: (id,config)=>axiosClient.get(`/support-requests/${encodeURIComponent(id)}/messages`,config),
  assign: (id,staffId)=>axiosClient.post(`/support-requests/${encodeURIComponent(id)}/assign`,{staffId}),
  unassign: id=>axiosClient.post(`/support-requests/${encodeURIComponent(id)}/unassign`),
  setStatus: (id,payload)=>axiosClient.patch(`/support-requests/${encodeURIComponent(id)}/status`,payload),
  escalate: id=>axiosClient.post(`/support-requests/${encodeURIComponent(id)}/escalate`),
  getMine: async () => USE_MOCK ? { data: [] } : axiosClient.get("/support/me"),
  create: async (payload) => USE_MOCK
    ? { data: { id: `SUP-${Date.now()}`, status: "OPEN", ...payload } }
    : axiosClient.post("/support", payload),
};
export default supportApi;
