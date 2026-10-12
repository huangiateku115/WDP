// Contract source: backend team's WDP.postman_collection.json.
// Password recovery additionally confirmed by the supplied Auth controller contract.
// Customer read/write additions follow WDP Postman V2 and docs_rental_workflow.
// Contract signing is deliberately excluded while POST/PATCH contracts disagree.
// BOM facility/pricing/policy writes and Admin account/reactivate/audit reads are re-added on top of the customer contract.
// This list constrains network integration; it is not an authorization guard.
export function apiBaseURL(value){const base=value.replace(/\/+$/,'');if(base.endsWith('/api/v1'))return base;if(base.endsWith('/api'))return `${base}/v1`;return `${base}/api/v1`;}
export function assertConfirmedRequest(config){
  const method=(config.method||'get').toUpperCase();
  const path=String(config.url||'').replace(/^\//,'').replace(/\/$/,'');
  const confirmed={'POST':['auth/login','auth/forgot-password','auth/reset-password','auth/logout','users/register','users'],GET:['users/me','users'],PUT:['users/me/profile','users/me/password']};
  const customerAllowed=(method==='GET'&&(/^(public\/facilities(\/[^/]+(\/(storage-options|pricing))?)?|facilities\/[^/]+\/storage-units|storage-units\/[^/]+|pricing-rules(\/resolve)?|policies(\/resolve)?|reservations\/(me|[^/]+)|contracts\/me|support-requests(\/[^/]+(\/messages)?)?)$/.test(path)))||(method==='PUT'&&path==='customers/me/profile')||(method==='POST'&&(path==='reservations'||path==='access/simulate-unlock'||/^reservations\/[^/]+\/mock-pay$/.test(path)));
  // BOM business resources: facilities, pricing rules, policies and storage units.
  const bomResource=(method==='GET'&&(/^facilities(\/[^/]+)?$/.test(path)||/^pricing-rules(\/[^/]+)?$/.test(path)||/^policies(\/[^/]+)?$/.test(path)||/^facilities\/[^/]+\/storage-units$/.test(path)||/^storage-units\/[^/]+$/.test(path)||/^reservations\/facility\/[^/]+$/.test(path)))||(method==='POST'&&(/^facilities$/.test(path)||/^facilities\/[^/]+\/restore$/.test(path)||/^pricing-rules$/.test(path)||/^policies$/.test(path)||/^facilities\/[^/]+\/storage-units$/.test(path)||/^storage-units\/[^/]+\/restore$/.test(path)))||(method==='PATCH'&&(/^facilities\/[^/]+$/.test(path)||/^facilities\/[^/]+\/status$/.test(path)||/^pricing-rules\/[^/]+$/.test(path)||/^pricing-rules\/[^/]+\/status$/.test(path)||/^policies\/[^/]+$/.test(path)||/^policies\/[^/]+\/status$/.test(path)||/^storage-units\/[^/]+$/.test(path)||/^storage-units\/[^/]+\/status$/.test(path)))||(method==='DELETE'&&(/^facilities\/[^/]+$/.test(path)||/^storage-units\/[^/]+$/.test(path)));
  // Admin account administration and admin audit reads.
  const adminResource=(method==='PATCH'&&/^users\/[^/]+\/reactivate$/.test(path))||(method==='PUT'&&/^users\/(?!me$)[^/]+$/.test(path))||(method==='GET'&&/^audit\/admin\/(login-history|audit-logs)\/[^/]+$/.test(path));
  // Customer-profile management for BOM/Admin (list, detail, verification decision).
  const customerProfileResource=(method==='GET'&&(/^customers$/.test(path)||/^customers\/(?!me$)[^/]+$/.test(path)))||(method==='PATCH'&&/^customers\/[^/]+\/verify$/.test(path));
  // Admin support / maintenance read console.
  const adminServiceResource=(method==='GET'&&(/^maintenance-tickets$/.test(path)||/^maintenance-tickets\/[^/]+$/.test(path)||/^support-requests$/.test(path)||/^support-requests\/[^/]+$/.test(path)||/^support-requests\/[^/]+\/messages$/.test(path)));
  const allowed=customerAllowed||bomResource||adminResource||customerProfileResource||adminServiceResource||confirmed[method]?.includes(path)||(method==='PATCH'&&/^users\/[^/]+\/role$/.test(path))||(method==='DELETE'&&/^users\/[^/]+$/.test(path));
  if(!allowed)throw Error('This business API is not confirmed by the backend collection. Use the available demo workspace until its API is provided.');
}
