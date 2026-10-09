import {ContractsIntegration} from '@/components/customer/RentalLifecycleIntegration';
import { Link } from 'react-router-dom';
import { FileSignature, ArrowRight, CircleCheck } from 'lucide-react';
import { useReservation } from '@/contexts/ReservationContext';
import { formatMoney, formatDate } from '@/lib/booking';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
function ContractsPage() {
  const { contracts } = useReservation();
  const pending = contracts.filter(item => item.contractStatus !== 'SIGNED');
  return <div className="mx-auto max-w-6xl p-5 md:p-8">
    <div className="label text-sky-700">YOUR RENTAL DOCUMENTS</div>
    <h1 className="mt-2 text-4xl font-bold">Contracts &amp; Sign</h1>
    <p className="mt-3 text-slate-500">Review your rental details and confirm your contract. Pending contracts remain here until confirmation is complete.</p>
    <div className="mt-7 flex items-center justify-between"><h2 className="text-xl font-bold">Awaiting confirmation</h2><Badge variant="orange">{pending.length} pending</Badge></div>
    <div className="mt-5 space-y-4">{pending.map(booking => <SpotlightCard key={booking.id} className="rounded-2xl"><Card><CardContent>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-50 text-sky-700"><FileSignature/></span><div><h2 className="text-xl font-bold">Storage rental contract</h2><p className="mt-1 text-sm text-slate-500">Reservation {booking.reservationCode || booking.id}</p></div></div><Badge variant="orange">AWAITING CONFIRMATION</Badge></div>
      <div className="soft-panel mt-5 grid gap-4 p-5 sm:grid-cols-3"><div className="text-sm">Facility / Unit<br/><b>{booking.facility.name} · {booking.storage.code}</b></div><div className="text-sm">Move-in / Duration<br/><b>{formatDate(booking.startDate)} · {booking.durationMonths} months</b></div><div className="text-sm">Rental total &amp; deposit<br/><b>{formatMoney(booking.pricing.total)} VND</b></div></div>
      <div className="mt-5 flex justify-end"><Button asChild><Link to={`/portal/contracts/${booking.id}`}>Review &amp; confirm contract <ArrowRight size={16}/></Link></Button></div>
    </CardContent></Card></SpotlightCard>)}</div>
    {!pending.length && <Card className="mt-5"><CardContent className="py-14 text-center"><CircleCheck className="mx-auto text-sky-700" size={44}/><h2 className="mt-5 text-xl font-bold">No contracts awaiting confirmation</h2><p className="mt-2 text-sm text-slate-500">New contracts appear here after you submit a reservation.</p><Button asChild className="mt-6"><Link to="/portal/rent">Book storage</Link></Button></CardContent></Card>}
  </div>;
}

// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default ContractsIntegration;
