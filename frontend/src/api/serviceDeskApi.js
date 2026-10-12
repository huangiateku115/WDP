import client from './axiosClient';
const id=value=>encodeURIComponent(value);
const endpoint=kind=>{if(!['maintenance','support'].includes(kind))throw Error('Unsupported desk kind');return kind==='maintenance'?'/maintenance-tickets':'/support-requests';};
export default {
 list:(kind,params,config={})=>client.get(endpoint(kind),{...config,params}),
 detail:(kind,ticketId,config)=>client.get(`${endpoint(kind)}/${id(ticketId)}`,config),
 create:(kind,body)=>client.post(endpoint(kind),body),
 update:(kind,ticketId,body)=>client.patch(`${endpoint(kind)}/${id(ticketId)}`,body),
 assign:(kind,ticketId,staffId)=>client.post(`${endpoint(kind)}/${id(ticketId)}/assign`,kind==='maintenance'?{assignedTo:staffId}:{staffId}),
 unassign:(kind,ticketId)=>client.post(`${endpoint(kind)}/${id(ticketId)}/unassign`),
 status:(kind,ticketId,status,resolutionNote)=>client.patch(`${endpoint(kind)}/${id(ticketId)}/status`,{status,...(status==='RESOLVED'?{resolutionNote}: {})}),
 messages:(ticketId,config)=>client.get(`/support-requests/${id(ticketId)}/messages`,config),
 message:(ticketId,message,isInternal)=>client.post(`/support-requests/${id(ticketId)}/messages`,{message,isInternal}),
};
