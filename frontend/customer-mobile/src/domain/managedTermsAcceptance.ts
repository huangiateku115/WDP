export function managedTermsAcceptanceKey(scope:string,versionId?:string){
  return scope&&versionId?scope+':'+versionId:'';
}

export function hasManagedTermsAcceptance(accepted:string,scope:string,versionId?:string){
  const current=managedTermsAcceptanceKey(scope,versionId);
  return !!current&&accepted===current;
}
