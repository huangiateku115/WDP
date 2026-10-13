import {Link} from 'react-router-dom';
export default function WarehouseBreadcrumbs({facilityId,facilityName,rackCode}) {
  return <nav aria-label="Warehouse breadcrumbs" className="flex flex-wrap items-center gap-2 break-all text-sm text-[#176B3A]">
    <Link to="/portal" className="rounded underline focus-visible:outline">Customer Portal</Link><span aria-hidden="true">/</span>
    {facilityId ? <><Link to="/portal/warehouse-map" className="rounded underline focus-visible:outline">Warehouse Map</Link><span aria-hidden="true">/</span>{rackCode ? <><Link to={`/portal/warehouse-map/${facilityId}`} className="rounded underline focus-visible:outline">{facilityName||facilityId}</Link><span aria-hidden="true">/</span><span aria-current="page">{rackCode}</span></> : <span aria-current="page">{facilityName||facilityId}</span>}</> : <span aria-current="page">Warehouse Map</span>}
  </nav>;
}
