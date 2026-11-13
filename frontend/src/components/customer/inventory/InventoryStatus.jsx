import {Badge} from '@/components/ui/badge';
import {inventoryStatusLabels} from '@/lib/customerOutbound';
const customerLabels={REGISTERED:'Đã đăng ký',PENDING_INBOUND:'Đang chờ nhập kho',IN_STORAGE:'Đang lưu kho',PENDING_OUTBOUND:'Đang chờ xuất kho',CHECKED_OUT:'Đã xuất kho'};
export default function InventoryStatus({status}){
  return <Badge variant={status==='IN_STORAGE'?'green':status==='PENDING_OUTBOUND'?'orange':'sky'}>{customerLabels[status]||inventoryStatusLabels[status]||'Chưa xác định'}</Badge>;
}
