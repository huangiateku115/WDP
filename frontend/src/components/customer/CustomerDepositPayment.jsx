import { reservationAmount } from "@/lib/customerReservationDisplay";
import { Card, CardContent, Details } from "./RentalBackendUI";

const unsupported = "Thanh toán trực tuyến cho Managed Inventory hiện chưa được hỗ trợ. Vui lòng liên hệ bộ phận hỗ trợ để được hướng dẫn.";

export default function CustomerDepositPayment({ reservation }) {
  const breakdown = reservation?.managedPricingSnapshot?.amountBreakdown;
  const currency = reservation?.managedPricingSnapshot?.pricingRule?.currency;
  const display = (amount) => typeof amount === "number" && Number.isFinite(amount) && currency
    ? reservationAmount(amount, currency)
    : "Not verified";

  return (
    <Card><CardContent className="space-y-4">
      <h2 className="text-xl font-bold">Managed Inventory deposit information</h2>
      <Details values={[
        ["Reservation status", reservation?.status],
        ["Total rent", display(breakdown?.totalDue)],
        ["Deposit credit", display(breakdown?.depositCredit)],
        ["Remaining balance", display(breakdown?.balanceDue)],
      ]} />
      <p role="note" className="text-sm text-amber-800">{unsupported}</p>
    </CardContent></Card>
  );
}
