import type {ManagedCell} from '../api/managedInventory';

export type ManagedCellChoice={id:string;code:string;maxVolumeM3:number;zoneName:string;rackCode:string;levelNumber:number};

export function toggleManagedCellChoice(current:ManagedCellChoice[],choice:ManagedCellChoice,limit=100){
  if(current.some(row=>row.id===choice.id))return current.filter(row=>row.id!==choice.id);
  return current.length>=limit?current:[...current,choice];
}

export function managedCellVolume(cell:ManagedCell){
  const {widthM,depthM,usableHeightM}=cell.dimensions;
  if(typeof widthM!=='number'||!Number.isFinite(widthM)||widthM<=0||typeof depthM!=='number'||!Number.isFinite(depthM)||depthM<=0||
    typeof usableHeightM!=='number'||!Number.isFinite(usableHeightM)||usableHeightM<=0)return null;
  const volume=widthM*depthM*usableHeightM;
  return Number.isFinite(volume)&&volume>0?volume:null;
}

export function managedCellState(cell:ManagedCell,hasPeriod:boolean,rackAvailable:boolean){
  if(cell.operationalStatus==='MAINTENANCE')return {kind:'MAINTENANCE' as const,label:'Bảo trì',selectable:false};
  if(cell.operationalStatus==='BLOCKED'||cell.operationalStatus==='LOCKED')return {kind:'BLOCKED' as const,label:'Tạm thời chưa thể đặt ô này',selectable:false};
  if(cell.operationalStatus!=='AVAILABLE')return {kind:'UNKNOWN' as const,label:'Chưa xác minh',selectable:false};
  const status=hasPeriod?cell.periodStatus:cell.displayStatus;
  if(status==='OCCUPIED')return {kind:'OCCUPIED' as const,label:'Đang sử dụng',selectable:false};
  if(status==='RESERVED')return {kind:'RESERVED' as const,label:'Đã giữ chỗ',selectable:false};
  if(status==='AVAILABLE'&&cell.isBookable===true){
    return {kind:'AVAILABLE' as const,label:hasPeriod?'Còn chỗ trong kỳ thuê':'Còn chỗ',
      selectable:hasPeriod&&rackAvailable&&managedCellVolume(cell)!==null};
  }
  return {kind:'UNKNOWN' as const,label:'Chưa có thông tin',selectable:false};
}
