const id=value=>typeof value==='string'?value:value?._id||value?.id;
const validId=value=>typeof value==='string'&&/^[a-f\d]{24}$/i.test(value);
export function canPaySelfStorage(reservation,contract,development=true){return development===true&&reservation?.serviceType==='SELF_STORAGE'&&reservation.status==='CONTRACTED'&&validId(id(reservation))&&validId(id(contract))&&id(contract.reservationId)===id(reservation)&&contract.status==='SIGNED';}
export function confirmedSelfPayment(response,reservationId){const data=response?.data?.success===true?response.data.data:null;if(!data||id(data)!==reservationId||data.serviceType!=='SELF_STORAGE'||data.status!=='PAID')throw Error('Backend did not confirm PAID for this Self Storage reservation. Refresh before retrying.');return data;}
export function selfPaymentAmounts(reservation){
  const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const fields=['estimatedRent','depositAmount','taxAmount','discountAmount'];
  const complete=fields.every(key=>valid(reservation?.[key]));
  const arithmetic=complete?reservation.estimatedRent+reservation.depositAmount+reservation.taxAmount-reservation.discountAmount:null;
  return {fields:fields.map(key=>[key,valid(reservation?.[key])?reservation[key]:null]),arithmetic:typeof arithmetic==='number'&&Number.isFinite(arithmetic)&&arithmetic>=0?arithmetic:null};
}
export function selfPaymentError(error){const status=error?.response?.status,message=error?.response?.data?.message;if(status>=500)return 'The server could not complete the payment request. Refresh the reservation before retrying.';if(status===401)return 'Please sign in to continue.';if(typeof message==='string'&&message.trim()&&message.length<=400&&!/stack|trace|Mongo|password|token| at .*:[0-9]+/i.test(message))return message;return error?.isAxiosError&&!error.response?'Payment result is uncertain after a connection failure. Refreshing the reservation is required.':typeof error?.message==='string'?error.message.slice(0,400):'Payment unavailable. Refresh and review the current state.';}
