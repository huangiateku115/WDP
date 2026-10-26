// Read model only: dates and assignees come from persisted backend records.
export const boardTypes = {CHECK_IN:'Check-in', CHECK_OUT:'Checkout', INSPECTION:'Draft inspection', maintenance:'Maintenance', support:'Support'};
export const idOf = value => typeof value === 'object' ? value?._id || value?.id : value;
export function facilityDay(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(value));
}
export function buildFacilityBoard({reservations=[], inspections=[], maintenance=[], support=[]}, user, role) {
  const facility = user.assignedFacilityId;
  const rentals = reservations.filter(r => idOf(r.facilityId) === facility && r.serviceType === 'SELF_STORAGE');
  const byId = new Map(rentals.map(r => [idOf(r), r]));
  const rows = [];
  for (const r of rentals) {
    const type = r.status === 'PAID' ? 'CHECK_IN' : ['ACTIVE','OVERDUE'].includes(r.status) ? 'CHECK_OUT' : null;
    if (!type) continue;
    rows.push({id:`${type}:${idOf(r)}`, title:r.reservationCode || idOf(r), type, status:r.status, date:facilityDay(type === 'CHECK_IN' ? r.startDate : r.endDate), dateLabel:type === 'CHECK_IN' ? 'Rental start date' : 'Rental end date', assignee:'', assignable:false, priority:'', to:`/${role}/reservations/${idOf(r)}`});
  }
  for (const r of inspections) {
    const rental = byId.get(idOf(r.reservationId));
    if (idOf(r.facilityId) !== facility || !rental || r.status !== 'DRAFT') continue;
    rows.push({id:`inspection:${idOf(r)}`, title:`${r.type} · ${rental.reservationCode || idOf(r)}`, type:'INSPECTION', status:r.status, date:facilityDay(r.createdAt), dateLabel:'Inspection creation date', assignee:'', assignable:false, priority:'', to:role === 'manager' ? `/manager/work/${r.type === 'CHECK_OUT' ? 'CHECKOUT' : 'INSPECTION'}/${idOf(r)}` : `/staff/${r.type === 'CHECK_OUT' ? 'checkouts' : 'inspections'}/${idOf(r)}`});
  }
  for (const kind of ['maintenance','support']) {
    for (const r of kind === 'maintenance' ? maintenance : support) {
      const assignee = idOf(r.assignedTo) || '';
      const inScope = idOf(r.facilityId) === facility || kind === 'support' && !r.facilityId && user.role === 'FACILITY_STAFF' && assignee === user.id;
      if (!inScope || user.role === 'FACILITY_STAFF' && assignee !== user.id || r.status === 'CLOSED') continue;
      rows.push({id:`${kind}:${idOf(r)}`, title:r.title || r.subject || idOf(r), type:kind, status:r.status, date:facilityDay(r.createdAt), dateLabel:'Request creation date', assignee, assignable:true, priority:r.priority, to:`/${role}/${kind}/${idOf(r)}`});
    }
  }
  return rows;
}
export function boardDayRows(rows, day, type='', assignee='', search='') {
  return rows.filter(r => (!day || !r.date || r.date <= day) && (!type || r.type === type) && (!assignee || (assignee === 'unassigned' ? r.assignable && !r.assignee : r.assignee === assignee)) && `${r.title} ${r.status}`.toLowerCase().includes(search.toLowerCase()));
}
export function boardAttention(row, day) {
  if (row.assignable && !row.assignee && ['HIGH','URGENT'].includes(row.priority)) return 'High priority, unassigned';
  if (row.type === 'CHECK_OUT' && row.date && row.date < day) return 'Rental end date has passed';
  if (row.type === 'CHECK_IN' && row.date && row.date < day) return 'Rental start date has passed';
  if (row.date && row.date < day) return 'Open from a previous day';
  return '';
}
