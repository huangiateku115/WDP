import axios from 'axios';

export type InboundReadbackDiagnostic={
  resource:string;
  path:string;
  outcome:string;
  httpStatus?:number;
  backendCode?:string;
  reconciliationStatus?:string;
};

export function inboundReadbackDiagnostic(resource:string,path:string,result:PromiseSettledResult<unknown>):InboundReadbackDiagnostic{
  if(result.status==='rejected'){
    const error=result.reason;
    return {resource,path,outcome:'REQUEST_FAILED',
      ...(axios.isAxiosError(error)&&typeof error.response?.status==='number'?{httpStatus:error.response.status}:{}),
      ...(axios.isAxiosError(error)&&typeof error.response?.data?.code==='string'?{backendCode:error.response.data.code}:{})};
  }
  const status=(result.value as {reconciliationStatus?:unknown}|null)?.reconciliationStatus;
  return {resource,path,outcome:typeof status==='string'&&status!=='VERIFIED'&&status!=='NO_ACTIVITY'?'RECONCILIATION_PENDING':'READ',
    ...(typeof status==='string'?{reconciliationStatus:status}:{})};
}
