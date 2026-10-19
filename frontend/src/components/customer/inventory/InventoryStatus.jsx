import {Badge} from '@/components/ui/badge';
import {inventoryStatusLabels} from '@/lib/customerOutbound';
export default function InventoryStatus({status}){
  return <Badge variant={status==='IN_STORAGE'?'green':status==='PENDING_OUTBOUND'?'orange':'sky'}>{inventoryStatusLabels[status]||status||'Unknown'}</Badge>;
}
