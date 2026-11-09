import type {ManagedCell} from '../api/managedInventory';

export function managedCellState(cell:ManagedCell,hasPeriod:boolean,rackAvailable:boolean){
  if(cell.operationalStatus==='MAINTENANCE')return {kind:'MAINTENANCE' as const,label:'Bảo trì',selectable:false};
  if(cell.operationalStatus==='BLOCKED')return {kind:'BLOCKED' as const,label:'Đã khóa',selectable:false};
  if(cell.operationalStatus!=='AVAILABLE')return {kind:'UNKNOWN' as const,label:'Chưa xác minh',selectable:false};
  const status=hasPeriod?cell.periodStatus:cell.displayStatus;
  if(status==='OCCUPIED')return {kind:'OCCUPIED' as const,label:'Đang sử dụng',selectable:false};
  if(status==='RESERVED')return {kind:'RESERVED' as const,label:'Đã giữ chỗ',selectable:false};
  if(status==='AVAILABLE'&&cell.isBookable===true&&rackAvailable&&cell.physicalUsageKnown===true&&
    cell.usedWeightKg===0&&cell.usedVolumeM3===0&&cell.maxVolumeM3!=null){
    return {kind:'AVAILABLE' as const,label:hasPeriod?'Khả dụng trong kỳ thuê':'Hiện còn trống',selectable:hasPeriod};
  }
  return {kind:'UNKNOWN' as const,label:'Chưa xác minh khả dụng',selectable:false};
}
