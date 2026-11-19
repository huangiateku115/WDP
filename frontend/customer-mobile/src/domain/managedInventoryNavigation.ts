export function managedReservationInventoryTarget(reservationId:string,facilityId?:string,context?:{sessionId?:string;operation?:string}){
  return {pathname:'/(tabs)/inventory/managed/[reservationId]' as const,
    params:{reservationId,...(facilityId?{facilityId}:{}),...(context?.sessionId?{sessionId:context.sessionId}:{}),...(context?.operation?{operation:context.operation}:{})}};
}

export function managedReservationDetailTarget(reservationId:string,facilityId:string){
  return {pathname:'/managed/[facilityId]/confirmation' as const,params:{facilityId,reservationId}};
}

export function managedRentalListTarget(){return '/(tabs)/rentals' as const;}

export function managedSessionAvailabilityMessage(sessions:Array<{status:string;startedAt:string;expiresAt:string;facilityId:unknown;reservationId:unknown;scopedReservationIds?:unknown[];allowedPurposes:string[]}>,reservationId:string,facilityId:string,purpose:string,now=Date.now()){
  if(!sessions.length)return 'Chưa có phiên truy cập được cấp cho đơn thuê này.';
  const scoped=sessions.filter(session=>String((session.facilityId as {_id?:unknown})?._id??session.facilityId)===facilityId&&
    (String((session.reservationId as {_id?:unknown})?._id??session.reservationId)===reservationId||session.scopedReservationIds?.some(value=>String((value as {_id?:unknown})?._id??value)===reservationId)));
  if(!scoped.length)return 'Phiên hiện có không áp dụng cho đơn thuê hoặc cơ sở này.';
  if(purpose==='RELOCATION'&&scoped.some(session=>session.status==='ACTIVE'&&String((session.reservationId as {_id?:unknown})?._id??session.reservationId)!==reservationId))
    return 'Reservation nguồn của thao tác chuyển vị trí phải là Reservation chính được cấp cho phiên.';
  if(scoped.some(session=>session.status==='REVOKED'))return 'Phiên đã bị thu hồi. Hãy tải lại trạng thái với cơ sở.';
  if(scoped.some(session=>session.status==='ACTIVE'&&Date.parse(session.expiresAt)<=now))return 'Phiên đã hết hạn. Cần một phiên mới được nhân viên xác nhận.';
  if(scoped.some(session=>session.status==='ACTIVE'&&Date.parse(session.startedAt)>now))return 'Phiên chưa bắt đầu. Hãy thử lại trong thời gian có hiệu lực.';
  if(scoped.some(session=>session.status==='ACTIVE'&&!session.allowedPurposes.includes(purpose)))return `Phiên không được cấp quyền ${purpose}.`;
  return 'Chưa đủ thông tin để xác minh phiên và phạm vi vị trí. Tải lại danh sách phiên.';
}
