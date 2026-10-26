export const objectId=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
export const recordId=value=>typeof value==='object'?value?._id||value?.id:value;
export function apiRecord(response){const row=response?.data?.data;if(response?.data?.success!==true||!row||typeof row!=='object'||Array.isArray(row))throw Error('The server returned invalid record details.');return row;}
export function apiRows(response){const rows=response?.data?.data;if(response?.data?.success!==true||!Array.isArray(rows))throw Error('The server returned an invalid list.');return rows;}
export function customerRecord(row){const user=typeof row.userId==='object'&&row.userId?row.userId:{};return {id:recordId(row),userId:recordId(row.userId),name:user.displayName||user.fullName||'Name not provided',email:user.email||'—',phone:user.phone||'—',address:row.address||'—',verification:row.verificationStatus,note:row.note,verifiedAt:row.verifiedAt,verifiedBy:typeof row.verifiedBy==='object'?row.verifiedBy?.displayName||row.verifiedBy?._id:row.verifiedBy,history:row.verificationHistory||[],createdAt:row.createdAt};}
export function reservationRecord(row){return {...row,id:recordId(row),customerName:row.customerId?.displayName||row.customerId?.fullName||recordId(row.customerId),customerUserId:recordId(row.customerId),facility:recordId(row.facilityId),unit:row.storageUnitId?.unitCode||recordId(row.storageUnitId),history:(row.statusHistory||[]).map(e=>({at:e.createdAt,status:e.status,note:e.reason}))};}
export function reviewError(error){
 const status=error?.response?.status;
 const hints={400:'Invalid request data.',401:'Your session has expired. Please sign in again.',403:'Your role or assigned facility does not allow this action.',404:'The record was not found within your permitted scope.',409:'The record has changed or is no longer eligible. Please refresh.',429:'Too many requests. Please wait before trying again.',500:'The server could not complete this request.',503:'The service is temporarily unavailable.'};
 const message=error?.response?.data?.message;
 // Localize service errors only. Customer names, notes and saved business records stay untouched.
 const english=value=>typeof value==='string'&&!/[À-ỹ]/.test(value)?value:null;
 return [hints[status],english(message)].filter(Boolean).join(' ')||english(error?.message)||'The request could not be completed. Check the connection and try again.';
}
