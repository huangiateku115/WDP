import { Link } from "react-router-dom";
import { CustomerScreen } from "@/components/common/CustomerScreen";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function FinancialDetailPage({ kind }) {
  const refund = kind === "refund";
  return (
    <CustomerScreen
      title={refund ? "Refund information" : "Additional charge information"}
      description={refund ? "Customer-owned refund records are not currently available." : "Customer-owned charge records are not currently available."}
      notice="No confirmed Customer refund or adjustment API is connected. Demo records are not shown as account transactions."
      action={<Button asChild variant="outline"><Link to="/portal/payments">Payment history</Link></Button>}
    >
      <Card><CardContent>
        <p role="status" className="text-sm text-slate-700">
          {refund ? "Refund status cannot be verified in this account." : "Additional charge details cannot be verified in this account."}
        </p>
      </CardContent></Card>
    </CustomerScreen>
  );
}
