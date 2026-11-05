import { Link } from "react-router-dom";
import { eligiblePayosPurpose } from "@/lib/selfStoragePayos";
import { Button, recordId } from "./RentalBackendUI";

export function SelfPaymentNavigation({ contract, reservation }) {
  if (reservation?.serviceType !== "SELF_STORAGE") return null;
  const purpose = eligiblePayosPurpose(reservation, contract);

  if (purpose) {
    return (
      <Button asChild className="mt-4">
        <Link to={`/portal/payments/${recordId(reservation)}`}>
          {purpose === "BALANCE" ? "Pay remaining rent with PayOS" : "Pay advance rent with PayOS"}
        </Link>
      </Button>
    );
  }

  if (reservation.status === "PAID") {
    return <p className="mt-4 text-sm font-semibold text-brand">Payment recorded by the Backend. Facility handover remains separate.</p>;
  }

  if (reservation.status === "DEPOSIT_PAID") {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-sm text-slate-600">Advance rent is recorded. Continue with the existing contract step.</p>
        <Button asChild variant="outline"><Link to={`/portal/contracts/${recordId(reservation)}`}>Review contract next steps</Link></Button>
      </div>
    );
  }

  return null;
}
