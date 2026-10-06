from pathlib import Path
import re
def update(path, fn):
 p=Path(path);p.write_text(fn(p.read_text(encoding='utf-8-sig')),encoding='utf-8')
update('src/pages/customer/SelectStoragePage.jsx',lambda t:t.replace('Snowflake, ShieldCheck','ShieldCheck').replace('            <Button variant="outline">Climate-Controlled</Button>\n','').replace('              <div className="storage-feature"><Snowflake size={20}/><div><b>Climate Guard</b><p>Climate-controlled storage environment.</p></div></div>\n','').replace('md:grid-cols-3','md:grid-cols-2'))
update('src/pages/customer/RentalPeriodPage.jsx',lambda t:t.replace(' • Climate Controlled',''))
update('src/pages/customer/ReservationStatusPage.jsx',lambda t:t.replace('              <br />✓ Dehumidified Clean Air\n',''))
update('src/pages/auth/LoginPage.jsx',lambda t:re.sub(r'<Card className="mt-5 p-5">\s*<b>UNIT CLIMATE TELEMETRY</b>.*?</Card>','',t,flags=re.S).replace('Climate-controlled storage corridor','Storage facility corridor'))
update('src/mocks/storageUnits.js',lambda t:t.replace(', "Climate Controlled"',''))
update('src/layouts/PublicLayout.jsx',lambda t:t.replace('["Climate-controlled","/facilities"],',''))
update('src/pages/public/SupportPublicPage.jsx',lambda t:t.replace('CCTV, climate protection, renter responsibilities','CCTV, renter responsibilities'))
update('src/pages/public/FacilitiesPage.jsx',lambda t:re.sub(r'\s*<Feature\s+icon=\{Snowflake\}\s+title="22°–24°C"\s+text="Climate zones"\s*/>','',t).replace('  Snowflake,\n','').replace(', "Climate-Controlled"','').replace('                "Climate-Controlled",\n','').replace('secure, climate-controlled storage','secure storage').replace('mt-7 grid gap-3 sm:grid-cols-3','mt-7 grid gap-3 sm:grid-cols-2'))
update('src/pages/public/PricingPage.jsx',lambda t:re.sub(r'  \{\s*icon: Snowflake,.*?\n  \},\n','',t,flags=re.S).replace('  Snowflake,\n','').replace('                <Included icon={Snowflake} text="Climate-controlled storage" />\n','').replace('mt-11 grid gap-5 lg:grid-cols-3','mt-11 grid gap-5 lg:grid-cols-2'))
update('src/components/home/WhyVaultSpaceSection.jsx',lambda t:t.replace(', Snowflake','').replace('[Snowflake,"Climate control","Protected options for sensitive belongings."],','').replace('lg:grid-cols-4','lg:grid-cols-3'))
update('src/components/home/SecuritySection.jsx',lambda t:re.sub(r'  \{\s*icon: Snowflake,.*?\n  \},\n','',t,flags=re.S).replace(', Snowflake','').replace('lg:grid-cols-4','lg:grid-cols-3'))
update('src/components/home/StorageSolutionsSection.jsx',lambda t:t.replace('  Snowflake,\n','').replace('personal rooms, climate-controlled storage or flexible','personal rooms or flexible'))
update('src/components/home/TestimonialsSection.jsx',lambda t:t.replace('The climate control and security are exactly what we needed.','The security is exactly what we needed.'))
# Consistent green-orange theme across the auth and customer screens.
colors={'#006591':'#176b3a','#003e68':'#0e4f2b','#004c6e':'#125830','#09263e':'#173d28','#f8f9ff':'#fafaf7','#f2f3ff':'#f1f7f1','#eaedff':'#eaf5ee','#eef2ff':'#eaf5ee','#f1f5fb':'#f1f6ef','#e5ebf4':'#e1e8e2','#e4e8f1':'#e1e8e2','#e2e7f3':'#dce7de','#e2edfb':'#dcebdd','#eaf0fc':'#eaf5ee','#f6faff':'#f4faf4','#39b8fd35':'#f28c2835'}
def theme(t):
 for old,new in colors.items():t=t.replace(old,new)
 t=t.replace('225 230 240','225 232 226').replace('248 249 255','250 250 247').replace('19 27 46','31 42 34').replace('0 101 145','23 107 58').replace('27 79 210','14 79 43').replace('220 225 255','220 235 221').replace('57 184 253','242 140 40').replace('201 230 255','255 232 207').replace('242 243 255','241 247 241').replace('234 237 255','234 245 238').replace('226 231 255','220 235 221')
 t=re.sub(r'\.portal-sidebar[^\n]*\n','',t)
 return t
update('src/layouts/experience.css',theme)
for path in ['src/pages/auth/LoginPage.jsx','src/pages/customer/SelectStoragePage.jsx','src/pages/customer/MyStoragePage.jsx']:
 update(path,lambda t:t.replace('#003e68','#0e4f2b').replace('#09263e','#173d28').replace('#eef2ff','#eaf5ee'))
# Carry the real reservation identity and amount into the existing next step.
update('src/pages/customer/PaymentPage.jsx',lambda t:t.replace('import { useNavigate }','import { useReservation } from "@/contexts/ReservationContext";\nimport { formatMoney } from "@/lib/booking";\nimport { useNavigate, useParams }').replace('  const nav = useNavigate();','''  const nav = useNavigate();
  const { reservationId } = useParams();
  const { contracts } = useReservation();
  const booking = contracts.find(item => item.id === reservationId);
  const total = booking?.pricing.total ?? 5600000;
  const monthlyRate = booking?.pricing.monthlyRate ?? 2800000;
  const deposit = booking?.pricing.deposit ?? 2800000;''').replace('5,600,000 VND','{formatMoney(total)} VND').replace('First Month Rent <b className="float-right">2,800,000 VND</b>','Rental Subtotal <b className="float-right">{formatMoney(booking?.pricing.subtotal ?? monthlyRate)} VND</b>').replace('<b className="float-right">2,800,000 VND</b>','<b className="float-right">{formatMoney(deposit)} VND</b>').replace('<b>Unit A-203</b>','<b>Unit {booking?.storage.code || "A-203"}</b>').replace('<b>SelfStorage Central Saigon</b>','<b>{booking?.facility.name || "SelfStorage Central Saigon"}</b>').replace('VS202600124','{booking?.reservationCode || reservationId}').replace('nav("/portal/handover/VS-2025-0849")','nav(`/portal/handover/${reservationId}`)'))
update('src/pages/customer/HandoverPage.jsx',lambda t:t.replace("import Steps", "import { useParams } from 'react-router-dom';\nimport { useReservation } from '@/contexts/ReservationContext';\nimport Steps",1).replace('export default function HandoverPage() {','''export default function HandoverPage() {
  const { reservationId } = useParams();
  const { contracts } = useReservation();
  const booking = contracts.find(item => item.id === reservationId);''').replace('>Unit A-203</b>','>Unit {booking?.storage.code || "A-203"}</b>').replace('>Nguyen Van An</b>','>{booking?.tenant.name || "Nguyen Van An"}</b>').replace('>R2026-00124</div>','>{booking?.reservationCode || reservationId}</div>'))
