import { Link, useParams } from 'react-router-dom';
import { useCustomerData, locationLabel, timestampLabel } from '@/lib/customerDemoStore';
import { CustomerScreen, EmptyState } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
export default function InventoryHistoryPage(){
 const {id}=useParams();const data=useCustomerData();const item=data.items.find(item=>item.id===id);const movements=data.movements.filter(movement=>movement.itemId===id).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
 return <CustomerScreen title="Movement history" description={item?`${item.code} · ${item.name}. Completed movements are read-only; pending requests are not movement records.`:'Immutable inventory movements.'} action={<Button asChild variant="outline"><Link to={item?`/portal/inventory/${id}`:'/portal/inventory'}>{item?'Item details':'My Inventory'}</Link></Button>}>
  {!item?<EmptyState title="Item not found" description="Select an item from your inventory." to="/portal/inventory" label="My Inventory"/>:movements.length?<Card><div className="customer-table-scroll"><table className="customer-table"><caption className="sr-only">Immutable item movements</caption><thead><tr>{['Movement','From','To','Performer','Timestamp','Notes'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{movements.map(movement=><tr key={movement.id}><td><Badge variant={movement.type==='OUTBOUND'?'orange':'green'}>{movement.type}</Badge><p className="mt-2 text-xs text-slate-500">{movement.id}</p></td><td>{locationLabel(movement.from)}</td><td>{locationLabel(movement.to)}</td><td>{movement.performer}</td><td><time dateTime={movement.timestamp}>{timestampLabel(movement.timestamp)}</time></td><td>{movement.notes||'—'}</td></tr>)}</tbody></table></div></Card>:<EmptyState title="No completed movements" description="Registered items have no Shelf assignment. A movement appears only when Staff completes an inbound, relocation or outbound."/>}
  <Card><CardContent><h2 className="text-lg font-bold">Movement types</h2><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><b>INBOUND</b><p className="mt-2 text-sm text-slate-500">Outside → Shelf</p></div><div><b>RELOCATION</b><p className="mt-2 text-sm text-slate-500">Shelf A → Shelf B</p></div><div><b>OUTBOUND</b><p className="mt-2 text-sm text-slate-500">Shelf → Outside</p></div></div></CardContent></Card>
 </CustomerScreen>;
}
