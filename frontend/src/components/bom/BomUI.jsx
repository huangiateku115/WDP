import { Link } from 'react-router-dom';
import { Panel, Card, CardContent } from '@/components/manager/ManagerUI';
import { Building2 } from 'lucide-react';

// Shared building blocks for the BOM/Admin workspaces: unavailability panel, KPI cards and a
// read-only value viewer. Backend role, facility scope and audit permissions stay authoritative.

export function BomUnavailable() {
  return <Panel title="Không xem được bản ghi"><Link className="manager-link" to="/bom/dashboard">Quay lại tổng quan</Link></Panel>;
}

// Technical/optional fields live behind this disclosure so the main form only asks for what an
// operator must decide. Every field inside still carries a plain-language hint, because a folded
// section must never hide the meaning of a value.
export function AdvancedFields({ title = 'Tùy chọn nâng cao', description, children }) {
  return (
    <details className="bom-advanced">
      <summary>{title}</summary>
      {description && <p className="bom-advanced-hint">{description}</p>}
      <div className="bom-advanced-body">{children}</div>
    </details>
  );
}

export function Kpis({ items }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value, hint]) => (
        <Card className="manager-kpi" key={label}>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <span className="kpi-icon"><Building2 size={17} /></span>
            </div>
            <p className="mt-4 text-2xl font-bold">{value}</p>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">{hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ReadOnlyValues({ value }) {
  return value
    ? (
      <dl className="space-y-2 rounded-xl bg-[#f1f6ef] p-4 text-xs">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt className="font-bold">{k}</dt>
            <dd className="mt-1 break-words whitespace-pre-wrap">{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}</dd>
          </div>
        ))}
      </dl>
    )
    : <p className="text-sm text-slate-500">Chưa có giá trị trước đó.</p>;
}
