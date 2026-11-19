import axios from 'axios';
import {inboundReadbackDiagnostic} from '../src/domain/managedInboundReadbackDiagnostics';

test('records only resource, status and backend code for failed readback requests',()=>{
  const error=Object.assign(new Error('private response content'),{isAxiosError:true,response:{status:503,data:{code:'PROJECTION_PENDING'}}});
  expect(inboundReadbackDiagnostic('cell-stock','/v3/cell-stock',{status:'rejected',reason:error})).toEqual({
    resource:'cell-stock',path:'/v3/cell-stock',outcome:'REQUEST_FAILED',httpStatus:503,backendCode:'PROJECTION_PENDING',
  });
});

test('identifies pending reconciliation status without exposing response content',()=>{
  expect(inboundReadbackDiagnostic('stock','/v3/stock',{status:'fulfilled',value:{reconciliationStatus:'CHECKING',verificationMessage:'internal detail'}})).toEqual({
    resource:'stock',path:'/v3/stock',outcome:'RECONCILIATION_PENDING',reconciliationStatus:'CHECKING',
  });
  expect(axios.isAxiosError(new Error('not an HTTP error'))).toBe(false);
});
