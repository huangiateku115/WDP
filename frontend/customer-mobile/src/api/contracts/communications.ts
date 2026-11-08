import {z} from 'zod';
import {assertOwner,idRef,instant,objectId,readData,refId} from './core';
import type {WireRequest} from './core';
export const notificationDto=z.object({_id:objectId,userId:idRef,type:z.string(),title:z.string(),content:z.string(),isRead:z.boolean(),createdAt:instant}).passthrough();
export function mapNotifications(response:unknown,owner:string){const rows=readData(z.array(notificationDto),response);if(rows.some(r=>refId(r.userId)!==objectId.parse(owner)))throw Error('Notification ownership mismatch');return {items:rows.map(r=>({_id:r._id,type:r.type,title:r.title,content:r.content,isRead:r.isRead,createdAt:r.createdAt,destination:null})),unread:rows.filter(r=>!r.isRead).length,pushSupported:false,bulkReadSupported:false};}
// Contract only: the fixture reader accepts GET, and the native transport remains disabled.
export function markOneReadRequest(id:string):WireRequest{return {method:'PATCH',path:`/notifications/${objectId.parse(id)}/read`};}
export function mapMarkOneRead(response:unknown,id:string,owner:string){const row=readData(notificationDto,response);assertOwner({customerId:row.userId},owner);if(row._id!==objectId.parse(id)||!row.isRead)throw Error('Notification read update not confirmed');return {_id:row._id,isRead:true as const};}
export const supportCategory=z.enum(['RENTAL','ACCESS','PAYMENT','ITEM','LOCATION','OTHER']);
export const supportStatus=z.enum(['OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED']);
// Private relatedEntity remains disabled until server ownership validation is fixed.
export const supportBody=z.object({category:supportCategory,subject:z.string().trim().min(1).max(200),description:z.string().trim().min(1).max(5000)}).strict();
export const supportDto=z.object({_id:objectId,customerId:idRef,category:supportCategory,status:supportStatus,subject:z.string(),description:z.string()}).passthrough();
export function mapSupportTicket(response:unknown,owner:string){const t=readData(supportDto,response);assertOwner(t,owner);return {_id:t._id,category:t.category,status:t.status,subject:t.subject,description:t.description};}
export const messageDto=z.object({_id:objectId,supportRequestId:idRef,message:z.string(),isInternal:z.boolean(),createdAt:instant}).passthrough();
export function mapMessages(response:unknown,ticketId:string){return readData(z.array(messageDto),response).filter(m=>m.isInternal===false).map(m=>{if(refId(m.supportRequestId)!==objectId.parse(ticketId))throw Error('Message parent mismatch');return {_id:m._id,message:m.message,createdAt:m.createdAt};});}
export function supportReply(message:string){return {message:z.string().trim().min(1).max(5000).parse(message),isInternal:false as const};}
export const unsupportedCommunications=Object.freeze({typedNotificationDestinations:false,bulkRead:false,push:false,supportAttachments:false,staffInternalMessages:false,privateSupportLinkage:false});
