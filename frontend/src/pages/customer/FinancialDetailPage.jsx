import { Link, useParams } from 'react-router-dom';
import { useCustomerData, timestampLabel } from '@/lib/customerDemoStore';
import { formatMoney, formatDate } from '@/lib/booking';
import { CustomerScreen, EmptyState, Details, StatusBadge } from '@/components/common/CustomerScreen';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export default function FinancialDetailPage({kind}){
 const {id}=useParams();const data=useCustomerData();const refund=kind==='refund';const record=(refund?data.refunds:data.charges).find(item=>item.id===id);
 return <CustomerScreen notice="Demo financial detail: browser/sample records only. This page does not confirm a real refund, charge or transfer." title={refund?'Refund details':'Additional charge'} description={refund?'Track your adjustment and refund status.':'Review extra or damage charges related to your rental.'} action={<Button asChild variant="outline"><Link to="/portal/payments">Payment history</Link></Button>}>
  {!record?<EmptyState title={refund?'Refund not found':'Charge not found'} description="The requested financial record is not available in this workspace." to="/portal/payments" label="Back to payments"/>:<><Card><CardContent><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{record.reference}</h2><StatusBadge status={record.status}/></div><div className="mt-6"><Details values={[["Record ID",record.id],["Related rental",record.rentalId],["Related payment",record.paymentId||'Not provided'],["Type",refund?'Refund':record.type],["Amount",`${formatMoney(record.amount)} VND`],["Date",timestampLabel(record.date)],...(record.dueDate?[["Due date",formatDate(record.dueDate)]]:[]),["Reason",record.reason]]}/></div></CardContent></Card>{!refund&&record.status==='PAYMENT_REQUIRED'&&<Card><CardContent><h2 className="text-xl font-bold">Payment required</h2><p className="mt-3 text-sm text-slate-600">Review this charge with the facility team. Charge checkout is awaiting an API integration.</p><div className="mt-5 flex flex-wrap gap-3"><Button variant="orange" disabled>Charge checkout unavailable</Button><Button asChild variant="outline"><Link to="/portal/support">Ask about this charge</Link></Button></div></CardContent></Card>}</>}
 </CustomerScreen>;
}
