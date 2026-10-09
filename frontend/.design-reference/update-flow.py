from pathlib import Path
root = Path('.')
def edit(path, old, new):
    p = root / path
    text = p.read_text(encoding='utf-8-sig')
    if old not in text: raise Exception('Missing target: '+path+' '+old[:70])
    p.write_text(text.replace(old,new),encoding='utf-8')
edit('src/contexts/ReservationContext.jsx','const [reservation, setReservation]', '''const [contracts, setContracts] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('SelfStorage_pendingContracts')) || []; }
    catch { return []; }
  });
  useEffect(() => { sessionStorage.setItem('SelfStorage_pendingContracts', JSON.stringify(contracts)); }, [contracts]);
  const addContract = (booking) => setContracts(previous => [
    { ...booking, contractStatus: 'AWAITING_SIGNATURE' }, ...previous.filter(item => item.id !== booking.id)
  ]);
  const confirmContract = (id, signed) => setContracts(previous => previous.map(item =>
    item.id === id ? { ...item, contractStatus: 'SIGNED', signedContract: signed } : item
  ));
  const [reservation, setReservation]''')
edit('src/contexts/ReservationContext.jsx','value={{ reservation, updateReservation, clearReservation }}','value={{ reservation, updateReservation, clearReservation, contracts, addContract, confirmContract }}')
edit('src/layouts/CustomerLayout.jsx','<aside className="portal-sidebar', '<aside className="hidden portal-sidebar')
p=Path('src/layouts/CustomerLayout.jsx');text=p.read_text(encoding='utf-8-sig')
a=text.index('<aside');b=text.index('</aside>',a)+len('</aside>')
text=text[:a]+text[b:]
text=text.replace('className="lg:pl-60"','className="w-full"').replace('<b className="text-sm tracking-wide">■ CLIENT MANAGEMENT PORTAL</b>','<Link to="/portal" aria-label="VaultSpace portal"><Brand /></Link>').replace('portal-mobile-nav','portal-navigation')
p.write_text(text,encoding='utf-8')
edit('src/pages/customer/SelectStoragePage.jsx','import referenceImages', "import { useReservation } from '@/contexts/ReservationContext';\nimport { calculatePricing, defaultStorage, defaultFacility } from '@/lib/booking';\nimport referenceImages")
edit('src/pages/customer/SelectStoragePage.jsx','  const nav = useNavigate();','''  const nav = useNavigate();
  const { reservation, updateReservation } = useReservation();
  const selected = reservation.storage || defaultStorage;
  const selectUnit = (index) => {
    const size = [3, 6, 9][index];
    const storage = { id: ['LOCKER-A101','LOCKER-A203','MINI-9'][index], code: ['A-101','A-203','A-309'][index], name: 'Mini Storage', size, monthlyRate: Number(units[index][1].replaceAll(',', '')) };
    updateReservation({ facility: defaultFacility, serviceType: 'LOCKER', storage, pricing: calculatePricing(storage.monthlyRate, reservation.durationMonths) });
    nav('/portal/rent/period');
  };
  const continueBooking = () => {
    updateReservation({ facility: reservation.facility || defaultFacility, serviceType: 'LOCKER', storage: selected, pricing: calculatePricing(selected.monthlyRate, reservation.durationMonths) });
    nav('/portal/rent/period');
  };''')
edit('src/pages/customer/SelectStoragePage.jsx','onClick={() => nav("/portal/rent/period")}','onClick={() => selectUnit(i)}')
# The summary button is outside the map.
edit('src/pages/customer/SelectStoragePage.jsx','className="mt-5 w-full"\n              onClick={() => selectUnit(i)}','className="mt-5 w-full"\n              onClick={continueBooking}')
edit('src/pages/customer/SelectStoragePage.jsx','className={i === 0 ? "border-l-4 border-l-sky-700" : ""}','className={selected.size === [3,6,9][i] ? "border-l-4 border-l-sky-700" : ""}')
edit('src/pages/customer/SelectStoragePage.jsx','{i === 0 ? "Selected" : "Select Unit"}','{selected.size === [3,6,9][i] ? "Selected" : "Select Unit"}')
edit('src/pages/customer/SelectStoragePage.jsx','Selected Unit Size: <b>3 m²</b>','Selected Unit Size: <b>{selected.size} m²</b>')
edit('src/pages/customer/SelectStoragePage.jsx','1,500,000 <small>VND</small>','{selected.monthlyRate.toLocaleString("en-US")} <small>VND</small>')
edit('src/pages/customer/RentalPeriodPage.jsx','import { useNavigate }','''import { useReservation } from '@/contexts/ReservationContext';
import { Input } from '@/components/ui/input';
import { calculatePricing, durationOptions, localToday, formatMoney, defaultStorage, defaultFacility } from '@/lib/booking';
import { useNavigate }''')
edit('src/pages/customer/RentalPeriodPage.jsx','  const nav = useNavigate();','''  const nav = useNavigate();
  const { reservation, updateReservation } = useReservation();
  const storage = reservation.storage || defaultStorage;
  const months = reservation.durationMonths || 1;
  const pricing = calculatePricing(storage.monthlyRate, months);
  const validDate = /^\\d{4}-\\d{2}-\\d{2}$/.test(reservation.startDate) && reservation.startDate >= localToday();
  const continueBooking = () => {
    if (!validDate) return;
    updateReservation({ storage, facility: reservation.facility || defaultFacility, serviceType: reservation.serviceType || 'LOCKER', pricing });
    nav('/portal/rent/review');
  };''')
edit('src/pages/customer/RentalPeriodPage.jsx','Mini Storage 3 m² (7.5 m³)','{storage.name} {storage.size} m²')
edit('src/pages/customer/RentalPeriodPage.jsx','''<div className="mt-4 rounded-xl bg-blue-50 p-4 font-bold">
                05/15/2025
              </div>''','''<label htmlFor="move-in-date" className="field-label mt-4">Choose your move-in date</label>
              <Input id="move-in-date" type="date" min={localToday()} value={reservation.startDate} onChange={event => updateReservation({startDate: event.target.value})} />
              <p className="mt-2 text-xs text-slate-500">Select today or a future date to continue.</p>''')
edit('src/pages/customer/RentalPeriodPage.jsx','<Card key={p[0]} className={i === 2 ? "ring-2 ring-sky-700" : ""}>','''<Card key={p[0]} className={months === durationOptions[i] ? "ring-2 ring-sky-700" : ""}>
                <button type="button" className="duration-choice w-full text-left" aria-pressed={months === durationOptions[i]} onClick={() => updateReservation({durationMonths:durationOptions[i]})}>''')
edit('src/pages/customer/RentalPeriodPage.jsx','''                </CardContent>
              </Card>''','''                </CardContent>
                </button>
              </Card>''')
edit('src/pages/customer/RentalPeriodPage.jsx','{p[1]} <small>VND / mo</small>','{formatMoney(calculatePricing(storage.monthlyRate, durationOptions[i]).monthlyRate)} <small>VND / mo</small>')
edit('src/pages/customer/RentalPeriodPage.jsx','9,600,000 VND','{formatMoney(pricing.total)} VND')
edit('src/pages/customer/RentalPeriodPage.jsx','<b className="float-right">1,500,000</b>','<b className="float-right">{formatMoney(pricing.baseRate)}</b>')
edit('src/pages/customer/RentalPeriodPage.jsx','<b className="float-right">9,000,000</b>','<b className="float-right">{formatMoney(pricing.baseRate * months)}</b>')
edit('src/pages/customer/RentalPeriodPage.jsx','<b className="float-right">-900,000</b>','<b className="float-right">-{formatMoney(pricing.discount)}</b>')
# Deposit equals undiscounted base rate, same replacement above.
edit('src/pages/customer/RentalPeriodPage.jsx','onClick={() => nav("/portal/rent/review")}','disabled={!validDate} onClick={continueBooking}')
