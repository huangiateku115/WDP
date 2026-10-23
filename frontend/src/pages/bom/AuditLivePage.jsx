import { Link } from "react-router-dom";
import { BomScreen } from "@/components/bom/BomUI";
import { Panel, Details, Button } from "@/components/manager/ManagerUI";

// The backend only exposes per-user audit reads:
//   GET /audit/bom/login-history/:userId
//   GET /audit/bom/audit-logs/:userId
// BOM cannot call GET /users, and there is no subject list or global audit collection.
// The page therefore renders an explicit limitation instead of asking for an ObjectId or
// fabricating demo events. One backend endpoint is enough to turn this page live.
export default function AuditLivePage() {
  return (
    <BomScreen
      title="Audit review"
      description="Sign-in events and audit actions for accounts below the BOM level."
    >
      <Panel title="Audit review is not available yet" subtitle="Blocked by a missing backend list endpoint.">
        <p className="text-sm text-slate-600">
          The BOM audit APIs require a backend user id, but BOM cannot list accounts:
          <code> GET /users</code> is ADMIN-only. The frontend deliberately does not ask for an
          ObjectId and does not call one detail endpoint per account, because either choice makes
          the page unusable or overloads the backend.
        </p>
        <div className="mt-5">
          <Details
            values={[
              ["Available now", "GET /audit/bom/login-history/:userId and GET /audit/bom/audit-logs/:userId (one account at a time)."],
              ["Missing", "GET /audit/bom/subjects — a bounded, paginated list of accounts BOM may review (ADMIN/BOM excluded)."],
              ["Optional", "A global audit/login-history collection with server-side filters and export."],
              ["Frontend behaviour", "No audit request is sent from this page until the subject list exists."],
            ]}
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link to="/bom/dashboard">Back to dashboard</Link></Button>
          <Button asChild variant="outline"><Link to="/bom/contracts">Open contracts</Link></Button>
        </div>
      </Panel>
    </BomScreen>
  );
}
