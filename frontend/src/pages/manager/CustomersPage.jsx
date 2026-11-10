import CustomerApiView from './CustomerApiView';
import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  useManagerData,
  verifyCustomer,
  money,
  managerDemoEnabled,
  unitCode,
  paymentNet,
} from "@/lib/managerDemoStore";
import { managerPermissions } from "@/mocks/managerData";
import {
  Screen,
  Panel,
  Details,
  Status,
  Table,
  OpenLink,
  Field,
  Input,
  Select,
  Textarea,
  Button,
  NotFound,
  Message,
  useAction,
  Timeline,
} from "@/components/manager/ManagerUI";
export default function CustomersPage(props) {
  const { id } = useParams();
  if (!managerDemoEnabled) return <CustomerApiView key={id || "directory"} workspace={props.workspace || "manager"} />;
  return (
    <CustomerView
      key={(id || "directory") + props.workspace + props.actor?.id}
      {...props}
    />
  );
}
function CustomerView({ workspace = "manager", actor }) {
  const base = "/" + workspace;
  const data = useManagerData(),
    { id } = useParams(),
    [search, setSearch] = useState(""),
    [verification, setVerification] = useState("VERIFIED"),
    [note, setNote] = useState(""),
    action = useAction();
  if (!id)
    return (
      <Screen
        title="Khách hàng"
        code="P010 / P011"
        description="Hồ sơ và hoạt động thuê của khách tại cơ sở được phân công."
      >
        <Panel title="Danh bạ khách hàng">
          <Field label="Tìm khách hàng">
            <Input
              aria-label="Tìm khách hàng"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên, email, số điện thoại hoặc mã khách"
            />
          </Field>
          <div className="mt-5">
            <Table
              rows={data.customers.filter((r) =>
                [r.name, r.email, r.phone, r.id].some((v) =>
                  String(v || "")
                    .replaceAll(" ", "")
                    .toLowerCase()
                    .includes(search.replaceAll(" ", "").toLowerCase()),
                ),
              )}
              columns={[
                {
                  key: "name",
                  label: "Khách hàng",
                  render: (r) => (
                    <OpenLink to={`${base}/customers/${r.id}`}>
                      {r.name}
                    </OpenLink>
                  ),
                },
                { key: "id", label: "ID" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                {
                  key: "verification",
                  label: "Xác minh",
                  render: (r) => <Status value={r.verification} />,
                },
                {
                  key: "rentals",
                  label: "Đơn thuê đang sử dụng",
                  render: (r) =>
                    data.rentals.filter(
                      (x) => x.customerId === r.id && x.status === "ACTIVE",
                    ).length,
                },
              ]}
            />
          </div>
        </Panel>
      </Screen>
    );
  const row = data.customers.find((r) => r.id === id);
  if (!row)
    return (
      <Screen title="Khách hàng" code="P010 / P011">
        <NotFound to={base + "/customers"} />
      </Screen>
    );
  const rentals = data.rentals.filter((r) => r.customerId === id),
    payments = data.payments.filter((r) => r.customerId === id),
    tickets = data.support.filter((r) => r.customerId === id);
  const cols = [
    { key: "id", label: "Đơn thuê" },
    {
      key: "service",
      label: "Dịch vụ",
      render: (r) => r.service.replaceAll("_", " "),
    },
    {
      key: "resource",
      label: "Kho / dung lượng",
      render: (r) =>
        r.service === "SELF_STORAGE"
          ? unitCode(data, r.unitId)
          : `${r.allocated_capacity_m3} m³`,
    },
    { key: "period", label: "Period", render: (r) => `${r.start} → ${r.end}` },
    {
      key: "status",
      label: "Trạng thái",
      render: (r) => <Status value={r.status} />,
    },
  ];
  return (
    <Screen
      title={row.name}
      code="P010 / P011"
      description={row.id}
      action={<OpenLink to={base + "/customers"}>Tất cả khách hàng</OpenLink>}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Hồ sơ khách hàng">
          <Details
            values={[
              ["Họ và tên", row.name],
              ["Email", row.email],
              ["Phone", row.phone],
              ["Địa chỉ", row.address],
              ["Xác minh", <Status value={row.verification} />],
              ["Ngày tạo khách", row.created],
              ["Ghi chú kiểm tra", row.verificationNote || "Chưa xem xét"],
            ]}
          />
        </Panel>
        <Panel
          title="Kiểm tra xác minh"
          subtitle="Xem trạng thái mô phỏng. Giấy tờ định danh không được lưu tại đây."
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              action.run(() => verifyCustomer(id, verification, note, actor));
            }}
          >
            <Field label="Quyết định xác minh">
              <Select
                label="Quyết định xác minh"
                value={verification}
                onChange={setVerification}
                options={["VERIFIED", "REJECTED"]}
              />
            </Field>
            <Field label="Ghi chú kiểm tra">
              <Textarea
                aria-label="Ghi chú kiểm tra xác minh"
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <Message {...action} />
            <Button
              disabled={
                !managerDemoEnabled ||
                !managerPermissions.verifyCustomers ||
                !note.trim()
              }
            >
              Lưu xác minh
            </Button>
          </form>
        </Panel>
      </div>
      <Panel title="Lịch sử xác minh">
        <Timeline entries={row.verificationHistory} />
      </Panel>
      <Panel title="Đơn thuê đang sử dụng">
        <Table
          rows={rentals.filter((r) => r.status === "ACTIVE")}
          columns={cols}
        />
      </Panel>
      <Panel title="Lịch sử thuê">
        <Table rows={rentals} columns={cols} />
      </Panel>
      <Panel
        title="Tổng hợp thanh toán"
        subtitle={`Net collected: ${money(payments.reduce((sum, p) => sum + paymentNet(p), 0))} · Outstanding: ${money(payments.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0))}`}
      >
        <Table
          rows={payments}
          columns={[
            { key: "id", label: "Thanh toán" },
            { key: "description", label: "Mô tả" },
            { key: "date", label: "Ngày" },
            { key: "amount", label: "Amount", render: (r) => money(r.amount) },
            {
              key: "status",
              label: "Trạng thái",
              render: (r) => <Status value={r.status} />,
            },
          ]}
        />
      </Panel>
      <Panel title="Lịch sử hỗ trợ">
        <Table
          rows={tickets}
          columns={[
            {
              key: "id",
              label: "Ticket",
              render: (r) =>
                workspace === "manager" ? (
                  <OpenLink to={`/manager/support/${r.id}`}>{r.id}</OpenLink>
                ) : (
                  r.id
                ),
            },
            { key: "subject", label: "Subject" },
            { key: "category", label: "Nhóm yêu cầu" },
            {
              key: "status",
              label: "Trạng thái",
              render: (r) => <Status value={r.status} />,
            },
          ]}
        />
      </Panel>
    </Screen>
  );
}
