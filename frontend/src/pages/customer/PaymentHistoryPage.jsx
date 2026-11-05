import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import reservationApi from "@/api/reservationApi";
import paymentApi from "@/api/paymentApi";
import { useAuthSession, getAccessToken } from "@/lib/authSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/booking";
import { SELF_STORAGE, serviceType } from "@/lib/customerReservationService";
import { BackendScreen, LoadState, Message, recordId, rows, useBackend } from "@/components/customer/RentalBackendUI";

function ReservationHistory({ reservationId }) {
  const session = useAuthSession();
  const resource = useBackend(
    () => paymentApi.listPayosPaymentsForReservation(reservationId),
    [reservationId],
  );
  const [page, setPage] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(null);
    setError("");
  }, [reservationId, session.accessToken]);

  useEffect(() => {
    if (!resource.data) return;
    setPage(resource.data);
  }, [resource.data]);

  async function loadOlder() {
    if (!page?.nextCursor || loadingMore) return;
    const token = getAccessToken();
    setLoadingMore(true);
    setError("");
    try {
      const next = await paymentApi.listPayosPaymentsForReservation(reservationId, { cursor: page.nextCursor });
      if (getAccessToken() !== token) return;
      const ids = new Set(page.items.map((payment) => payment.id));
      setPage({ items: [...page.items, ...next.items.filter((payment) => !ids.has(payment.id))], nextCursor: next.nextCursor });
    } catch {
      if (getAccessToken() === token) setError("Could not load older Backend payment records. Please retry.");
    } finally {
      if (getAccessToken() === token) setLoadingMore(false);
    }
  }

  const payments = page?.items || [];
  return (
    <Card><CardContent>
      <h2 className="text-xl font-bold">Backend PayOS history</h2>
      <p className="mt-2 text-sm text-slate-600">These are payment records returned by the Backend, not bank receipts. Refund and adjustment history is unavailable here.</p>
      <LoadState resource={resource} />
      {error && <Message error={error} />}
      {payments.length > 0 && <div className="mt-5 overflow-x-auto"><table className="customer-table w-full">
        <caption className="sr-only">Backend PayOS payment history</caption>
        <thead><tr><th>Payment ID</th><th>Purpose</th><th>Amount</th><th>Provider settlement</th><th>Reservation application</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>{payments.map((payment) => <tr key={payment.id}>
          <td className="font-mono text-xs">{payment.id}</td>
          <td>{payment.purpose}</td>
          <td>{formatMoney(payment.amount)} {payment.currency}</td>
          <td>{payment.providerSettlementStatus}</td>
          <td>{payment.applicationStatus}</td>
          <td>{new Date(payment.createdAt).toLocaleString()}</td>
          <td><Link className="text-brand underline" to={`/portal/payments/${reservationId}`}>View status</Link></td>
        </tr>)}</tbody>
      </table></div>}
      {!resource.loading && !resource.error && !payments.length && <p className="mt-5 text-sm text-slate-600">No PayOS payment records were returned for this Reservation.</p>}
      {page?.nextCursor && <Button className="mt-5" variant="outline" disabled={loadingMore} onClick={loadOlder}>{loadingMore ? "Loading…" : "Load older records"}</Button>}
    </CardContent></Card>
  );
}

export default function PaymentHistoryPage() {
  const session = useAuthSession();
  const reservations = useBackend((config) => reservationApi.mineReal(config).then(rows));
  const [selectedId, setSelectedId] = useState("");
  const ownedSelfStorage = (reservations.data || []).filter((reservation) => serviceType(reservation) === SELF_STORAGE && recordId(reservation));

  useEffect(() => { setSelectedId(""); }, [session.accessToken]);

  return (
    <BackendScreen title="Payment history" description="View PayOS payment records associated with a Reservation owned by your account." notice="Payment results are read from the Backend. Browser redirects and local storage are not settlement evidence.">
      <LoadState resource={reservations} />
      {!reservations.loading && !reservations.error && <label className="block max-w-xl text-sm font-medium">
        Select a Self-Storage Reservation
        <select className="customer-select mt-2 w-full" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Choose a Reservation</option>
          {ownedSelfStorage.map((reservation) => <option key={recordId(reservation)} value={recordId(reservation)}>{reservation.reservationCode || recordId(reservation)} · {reservation.status}</option>)}
        </select>
      </label>}
      {!reservations.loading && !reservations.error && !ownedSelfStorage.length && <p className="text-sm text-slate-600">No Self-Storage Reservations were returned for your account.</p>}
      {selectedId && ownedSelfStorage.some((reservation) => recordId(reservation) === selectedId) && <ReservationHistory key={`${session.accessToken}:${selectedId}`} reservationId={selectedId} />}
      <Card><CardContent><h2 className="text-lg font-semibold">Refunds and adjustments</h2><p className="mt-2 text-sm text-slate-600">Refund and adjustment records are unavailable because no confirmed Customer-owned API is connected to this page.</p></CardContent></Card>
    </BackendScreen>
  );
}
