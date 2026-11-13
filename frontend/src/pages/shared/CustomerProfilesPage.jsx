import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Screen, Panel, Table, Status, OpenLink, Field, Input, Select, Textarea, Details, Button, Message,
} from "@/components/manager/ManagerUI";
import { AsyncBoundary } from "@/components/bom/LiveBomUI";
import { useAsyncData } from "@/lib/useAsyncData";
import { apiErrorMessage } from "@/lib/apiError";
import customerProfileApi from "@/api/customerProfileApi";

// Shared customer-profile workspace for BOM and Admin (confirmed /customers API).
// `basePath` keeps the internal links inside the current workspace.

const VERIFICATION_STATUSES = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"];
const VERIFY_DECISIONS = ["VERIFIED", "REJECTED"];

const unwrap = (response) => response?.data?.data ?? null;
const unwrapList = (response) => (Array.isArray(response?.data?.data) ? response.data.data : []);

function toRow(profile) {
  const user = profile?.userId;
  const account = user && typeof user === "object" ? user : {};
  return {
    id: profile?._id,
    name: account.fullName || account.displayName || account.email || "Customer",
    email: account.email || "",
    phone: account.phone || "",
    identityCard: profile?.identityCard || "",
    address: profile?.address || "",
    taxCode: profile?.taxCode || "",
    status: profile?.verificationStatus || "UNVERIFIED",
    note: profile?.note || "",
    verifiedAt: profile?.verifiedAt ? String(profile.verifiedAt).slice(0, 10) : "",
  };
}

export default function CustomerProfilesPage({ basePath = "/admin/customers" }) {
  const { id } = useParams();
  if (id) return <CustomerDetail key={id} id={id} basePath={basePath} />;
  return <CustomerList basePath={basePath} />;
}

function CustomerList({ basePath }) {
  const state = useAsyncData(({ signal }) => customerProfileApi.list({ signal }).then(unwrapList), []);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  return (
    <Screen
      title="Customer profiles"
      description="Customer identity and verification details."
    >
      <Panel title="Filters">
        <div className="manager-filters">
          <Field label="Search">
            <Input aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Verification">
            <Select label="Verification filter" value={status} onChange={setStatus}
              options={[["", "All statuses"], ...VERIFICATION_STATUSES]} />
          </Field>
        </div>
      </Panel>
      <AsyncBoundary state={state} render={(profiles) => {
        const rows = profiles.map(toRow).filter((row) =>
          (!status || row.status === status) &&
          (!search || `${row.name} ${row.email} ${row.phone} ${row.identityCard}`.toLowerCase().includes(search.toLowerCase())));
        return (
          <Panel title="Customer profiles" subtitle={`${rows.length} of ${profiles.length} profiles`}>
            <Table
              label="Customer profiles"
              rows={rows}
              columns={[
                { key: "name", label: "Customer", render: (r) => <OpenLink to={`${basePath}/${r.id}`}>{r.name}</OpenLink> },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "identityCard", label: "Identity card" },
                { key: "status", label: "Verification", render: (r) => <Status value={r.status} /> },
                { key: "verifiedAt", label: "Verified at" },
              ]}
              empty="No customer profiles were returned."
            />
          </Panel>
        );
      }} />
    </Screen>
  );
}

function CustomerDetail({ id, basePath }) {
  const state = useAsyncData(({ signal }) => customerProfileApi.get(id, { signal }).then(unwrap), [id]);
  const [decision, setDecision] = useState("VERIFIED");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (!state.loading && state.error && /not found|unavailable|404/i.test(state.error))
    return (
      <Screen title="Customer unavailable">
        <Panel title="Customer unavailable">
          <Link className="manager-link" to={basePath}>Back to customers</Link>
        </Panel>
      </Screen>
    );

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await customerProfileApi.verify(id, { status: decision, note });
      setSuccess("Verification updated.");
      state.reload();
    } catch (err) {
      setError(apiErrorMessage(err, "Unable to verify this profile."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen
      title="Customer profile"
      description="Identity and verification details."
      action={<Button asChild variant="outline"><Link to={basePath}>Back to customers</Link></Button>}
    >
      <AsyncBoundary state={state} render={(profile) => {
        const row = toRow(profile);
        return (
          <>
            <Panel title="Identity">
              <Details values={[
                ["Customer", row.name],
                ["Email", row.email],
                ["Phone", row.phone],
                ["Identity card", row.identityCard || "Not provided"],
                ["Address", row.address],
                ["Tax code", row.taxCode],
                ["Verification", <Status value={row.status} />],
                ["Verified at", row.verifiedAt],
                ["Note", row.note],
              ]} />
            </Panel>
            <Panel title="Verification decision" subtitle="Approve or reject this customer profile.">
              <form className="space-y-5" onSubmit={submit}>
                <Field label="Decision">
                  <Select label="Verification decision" value={decision} onChange={setDecision} options={VERIFY_DECISIONS} />
                </Field>
                <Field label="Note">
                  <Textarea aria-label="Verification note" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Message error={error} success={success} />
                <Button type="submit" variant="orange" disabled={pending}>{pending ? "Saving…" : "Save verification"}</Button>
              </form>
            </Panel>
          </>
        );
      }} />
    </Screen>
  );
}
