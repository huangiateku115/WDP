import {ContractDetailIntegration} from '@/components/customer/RentalLifecycleIntegration';
import Steps from '@/components/common/Steps';
import { useEffect, useState, useRef } from 'react';
import { useReservation } from '@/contexts/ReservationContext';
import contractApi from '@/api/contractApi';
import { formatMoney, formatDate } from '@/lib/booking';
import { useNavigate, useParams } from "react-router-dom";
import PortalHero from "@/components/common/PortalHero";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
function ContractPage() {
  const nav = useNavigate();
  const { reservationId } = useParams();
  const { contracts, confirmContract } = useReservation();
  const booking = contracts.find(item => item.id === reservationId || item.reservationCode === reservationId);
  const [contract, setContract] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const [signing, setSigning] = useState(false);
  const signingRef = useRef(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setAccepted(false); setContract(null); setError('');
    if (booking) contractApi.getByReservation(booking.id).then(({data}) => {
      if (active) { if (!data?.id) setError('Contract is not available yet.'); else setContract(data); }
    }).catch(error => { if (active) setError(error.response?.data?.message || 'Unable to load contract. Please try again.'); });
    return () => { active = false; };
  }, [booking?.id, retry]);
  const sign = async () => {
    if (!accepted || signingRef.current || !contract || booking.contractStatus === 'SIGNED') return;
    signingRef.current = true; setSigning(true); setError('');
    try {
      const {data} = await contractApi.sign(contract.id, {signedBy: booking.tenant.name});
      if (data?.status !== 'SIGNED') throw new Error('Contract confirmation has not completed. Please try again.');
      confirmContract(booking.id, data);
      nav(`/portal/payments/${booking.id}`);
    } catch (error) { setError(error.response?.data?.message || error.message || 'Unable to confirm contract.'); }
    finally { signingRef.current = false; setSigning(false); }
  };
  if (!booking) return <div className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-bold">Contract not found</h1><Button className="mt-5" onClick={() => nav('/portal/contracts')}>Back to contracts</Button></div>;
  return (
    <div className="mx-auto max-w-6xl p-5 md:p-8"><Steps current={1} labels={["Review Contract", "Payment", "Check-in"]} />
      <div className="label mb-3 text-sky-700">
        STEP 1 OF 3: DIGITAL LEASE EXECUTION
      </div>
      <PortalHero
        eyebrow="E-SIGNATURE VERIFICATION"
        title="Review your rental contract"
        desc="Please review and digitally accept your commercial self-storage lease agreement before proceeding to PayOS payment."
        right={
          <>
            <small>Execution Deadline</small>
            <br />
            <b>Today, 23:59 ICT</b>
          </>
        }
      />
      <Card className="mt-6">
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="soft-panel p-4">
              FACILITY LOCATION
              <br />
              <b>{booking.facility.name}</b>
            </div>
            <div className="soft-panel p-4">
              ASSIGNED UNIT
              <br />
              <b>Unit {booking.storage.code} · {booking.storage.size} m²</b>
            </div>
            <div className="soft-panel p-4">
              RENTAL PERIOD
              <br />
              <b>{booking.durationMonths} Months · {formatDate(booking.startDate)}</b>
            </div>
          </div>
          <div className="mt-5 rounded-xl bg-blue-50 p-5 text-right">
            <span className="mr-6">Monthly Rate {formatMoney(booking.pricing.monthlyRate)} VND</span>
            <span>Deposit {formatMoney(booking.pricing.deposit)} VND</span>
            <div className="mt-2 price text-3xl">{formatMoney(booking.pricing.total)} VND</div>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-5">
        <CardContent>
          <div className="border-b pb-3 font-bold">
            Official Document Reader | 10 Clauses, Vietnam Civil Code Compliance
          </div>
          <div className="mx-auto max-w-4xl py-8">
            <div className="text-center">
              <b>
                SOCIALIST REPUBLIC OF VIETNAM • INDEPENDENCE – FREEDOM –
                HAPPINESS
              </b>
              <h2 className="mt-3 text-2xl font-bold">
                SELF-STORAGE RENTAL AGREEMENT
              </h2>
              <p>(HỢP ĐỒNG THUÊ KHO LƯU TRỮ CÁ NHÂN & DOANH NGHIỆP)</p>
            </div>
            {contract?.terms && <ol className="mt-6 space-y-3 text-sm text-slate-600">{contract.terms.map((term,index) => <li key={index}>{index+1}. {term}</li>)}</ol>}
            <div className="soft-panel mt-7 grid gap-5 p-5 md:grid-cols-2">
              <div>
                <b>LESSOR</b>
                <br />
                SelfStorage VIETNAM CO., LTD.
              </div>
              <div>
                <b>LESSEE</b>
                <br />
                {booking.tenant.name}
              </div>
            </div>
            <h3 className="mt-7 font-bold">
              Clause 1: Contracting Parties & Purpose of Storage
            </h3>
            <p className="mt-2 leading-7 text-slate-600">
              Lessor agrees to grant Lessee exclusive non-residential storage
              rights for Unit {booking.storage.code} at {booking.facility.name}.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card className="mt-5">
        <CardContent>
          <label htmlFor="accept-contract" className="flex cursor-pointer gap-3">
            <Checkbox id="accept-contract" checked={accepted} onCheckedChange={value => setAccepted(value === true)} disabled={signing || booking.contractStatus === "SIGNED"} />{" "}
            <b>
              I have read, understood and agree to all terms of the SelfStorage
              Rental Contract and Facility Rules.
            </b>
          </label>
          <Button
            className="mt-6 w-full md:w-auto md:float-right"
            disabled={!accepted || !contract || signing || booking.contractStatus === "SIGNED"} onClick={sign}
          >
            {booking.contractStatus === "SIGNED" ? "CONTRACT CONFIRMED" : signing ? "CONFIRMING…" : "CONFIRM CONTRACT & PROCEED TO PAYMENT →"}
          </Button>
          <div className="clear-both" />
          {!contract && !error && <p className="mt-3 text-sm text-slate-500">Loading contract…</p>}
          {error && <div className="mt-3"><p role="alert" className="text-sm text-red-700">{error}</p>{!contract && <Button variant="outline" className="mt-2" onClick={() => setRetry(value => value+1)}>Retry loading contract</Button>}</div>}
        </CardContent>
      </Card>
    </div>
  );
}


// Core rental route uses backend data; the existing isolated preview implementation is preserved above.
export default ContractDetailIntegration;
