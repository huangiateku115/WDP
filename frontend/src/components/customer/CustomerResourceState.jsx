import {Button} from '@/components/ui/button';

// Presentation of the existing resource contract; retry and requests remain owned by the caller.
export default function CustomerResourceState({resource}){
  return <>{resource.loading&&<div className="customer-resource-loading" role="status" aria-live="polite"><span>Loading account data…</span><div className="customer-skeleton-lines" aria-hidden="true"><i/><i/><i/></div></div>}{resource.error&&<div className="customer-resource-error" role="alert"><p>{resource.error}</p><Button type="button" variant="outline" disabled={resource.loading} onClick={resource.retry}>Retry</Button></div>}</>;
}
