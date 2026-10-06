import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { customerDemoEnabled } from '@/lib/customerDemoStore';
export function CustomerScreen({title,description,eyebrow='CUSTOMER PORTAL',action,notice,children}) {
  return <div className="customer-screen mx-auto max-w-6xl p-5 md:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="label text-sky-700">{eyebrow}</p><h1 className="mt-2 text-3xl font-bold md:text-4xl">{title}</h1><p className="mt-3 max-w-3xl text-sm text-slate-500">{description}</p></div>{action}</div><p className="demo-notice mt-5 rounded-xl border px-4 py-3 text-xs">{notice??(customerDemoEnabled?'Demo workspace · Changes are saved in this browser. Requests are simulated and do not perform staff operations or real payments.':'Customer API integration pending · Preview actions are unavailable in live mode.')}</p><div className="mt-6 space-y-6">{children}</div></div>;
}
export function StatusBadge({status}) {
  const green=['ACTIVE','PAID','COMPLETED','InStorage','APPROVED','SIGNED'].includes(status);
  const red=['FAILED','REJECTED','SUSPENDED','OVERDUE'].includes(status);
  return <Badge variant={green?'green':red?'dark':'orange'} className={red?'bg-red-50 text-red-700':''}>{String(status||'Unknown').replaceAll('_',' ')}</Badge>;
}
export function Field({label,id,children,hint}) {return <div><label htmlFor={id} className="field-label">{label}</label>{children}{hint&&<p className="mt-2 text-xs text-slate-500">{hint}</p>}</div>;}
export function Details({values}) {return <dl className="grid gap-5 sm:grid-cols-2">{values.map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold">{value ?? '—'}</dd></div>)}</dl>;}
export function EmptyState({title,description,to,label='Back to portal'}) {return <Card><CardContent className="py-12 text-center"><h2 className="text-xl font-bold">{title}</h2><p className="mx-auto mt-3 max-w-lg text-sm text-slate-500">{description}</p>{to&&<Button asChild variant="orange" className="mt-5"><Link to={to}>{label}</Link></Button>}</CardContent></Card>;}
export function Message({error,success}) {return error?<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>:success?<p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>:null;}
export function Select({id,label,value,onChange,options,disabled=false}) {return <select id={id} aria-label={label} className="customer-select" value={value} onChange={onChange} disabled={disabled}>{options.map(option=>{const [value,label]=Array.isArray(option)?option:[option,option];return <option key={value} value={value}>{label}</option>;})}</select>;}
export function CapacitySummary({rental,projected,pending=0}) {
  const used=rental.used_capacity_m3,allocated=rental.allocated_capacity_m3;
  return <div className="soft-panel p-5"><div className="flex flex-wrap justify-between gap-2 text-sm"><b>Managed storage capacity</b><span>{used.toFixed(3)} / {allocated.toFixed(3)} m³ used</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-label="Used capacity" aria-valuemin={0} aria-valuemax={allocated} aria-valuenow={used}><div className="h-full rounded-full bg-[#176B3A]" style={{width:`${Math.min(100,used/allocated*100)}%`}}/></div>{pending>0&&<p className="mt-3 text-xs text-slate-500">Pending inbound volume: {pending.toFixed(3)} m³</p>}{projected!=null&&<p className={`mt-3 text-sm ${projected>allocated?'text-red-700':'text-sky-700'}`}>Projected after inbound: <b>{projected.toFixed(3)} m³</b></p>}</div>;
}
