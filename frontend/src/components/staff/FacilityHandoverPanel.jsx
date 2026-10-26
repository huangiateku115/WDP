import {useCallback,useRef,useState} from 'react';
import api from '@/api/facilityHandoverApi';
import {facilityReservationApi} from '@/api/facilityReviewApi';
import storageApi from '@/api/storageApi';
import {useAuthSession} from '@/lib/authSession';
import useFacilityResource,{announceReviewChange} from '@/lib/useFacilityResource';
import {apiRecord,recordId,objectId,reviewError} from '@/lib/facilityReview';
import {Panel,Details,Status,Button,Field,Input,Message,Dialog,money} from '@/components/manager/ManagerUI';

export default function FacilityHandoverPanel({reservationId}) {
 const {user}=useAuthSession(),facilityId=user?.assignedFacilityId;
 const permitted=['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)&&objectId(facilityId)&&objectId(reservationId);
 const [file,setFile]=useState(null),[number,setNumber]=useState(''),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[action,setAction]=useState(null),[feedback,setFeedback]=useState({}),[printData,setPrintData]=useState(null),busy=useRef(false);
 const load=useCallback(async signal=>{
  const reservation=apiRecord(await facilityReservationApi.detail(reservationId,false,{signal}));
  if(recordId(reservation)!==reservationId||recordId(reservation.facilityId)!==facilityId||reservation.serviceType!=='SELF_STORAGE')throw Error('This is not a Self Storage reservation in your assigned facility.');
  const contract=apiRecord(await api.contract(reservationId,{signal}));
  if(!objectId(recordId(contract))||recordId(contract.reservationId)!==reservationId||recordId(contract.customerId)!==recordId(reservation.customerId))throw Error('The contract does not match the reservation or customer.');
  return {reservation,contract};
 },[reservationId,facilityId]);
 const resource=useFacilityResource(load,permitted),data=resource.data;
 const paperEligible=d=>['CONTRACTED','DEPOSIT_PAID'].includes(d.reservation.status)&&!d.contract.signedProofUrl;
 const handoverEligible=d=>d.reservation.status==='PAID'&&d.contract.status==='SIGNED'&&!!d.contract.signedProofUrl;
 async function run(event){event?.preventDefault();if(busy.current||!data)return;busy.current=true;setSaving(true);setFeedback({});try{
  const fresh=await load();
  if(action==='paper'){
   if(!paperEligible(fresh)||!confirmed)throw Error('The reservation is not eligible or already has signed evidence. Please refresh.');
   if(!file||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)||file.size===0||file.size>10*1024*1024)throw Error('Choose a JPEG, PNG, WEBP or PDF file up to 10 MB.');
   await api.confirmPaper(recordId(fresh.contract),file,number);
   const updated=await load();
   if(updated.contract.status!=='SIGNED'||!updated.contract.signedProofUrl||updated.reservation.status!=='CHECKIN_READY')throw Error('The contract is not confirmed as SIGNED with a CHECKIN_READY reservation. Refresh before continuing.');
   setFile(null);setConfirmed(false);setFeedback({success:'Evidence saved. The customer can pay the remaining balance.'});
  }else if(action==='handover'){
   if(!handoverEligible(fresh)||!confirmed)throw Error('A PAID reservation and signed paper contract evidence are required.');
   const unitId=recordId(fresh.reservation.storageUnitId),unit=apiRecord(await storageApi.unitDetail(unitId));
   if(recordId(unit.facilityId)!==facilityId||!['AVAILABLE','HELD'].includes(unit.status))throw Error('The unit is outside your facility or not ready for handover.');
   const response=apiRecord(await api.handover(reservationId));
   if(recordId(response.reservation)!==reservationId||response.reservation.status!=='ACTIVE')throw Error('Handover was not confirmed for this reservation.');
   const updated=await load(),updatedUnit=apiRecord(await storageApi.unitDetail(unitId));
   if(updated.reservation.status!=='ACTIVE'||recordId(updatedUnit)!==unitId||updatedUnit.status!=='OCCUPIED')throw Error('Reservation and unit states do not match. Refresh to check them; do not submit handover again.');
   setConfirmed(false);setFeedback({success:'Confirmed: reservation ACTIVE and unit OCCUPIED.'});
  }else{
   const printed=apiRecord(await api.print(recordId(fresh.contract)));
   if(recordId(printed)!==recordId(fresh.contract)||recordId(printed.reservationId)!==reservationId)throw Error('Print data does not match the contract.');
   setPrintData(printed);setAction(null);return;
  }
  setAction(null);announceReviewChange();
 }catch(error){const message=reviewError(error);setFeedback({error:/cloud_name is disabled/i.test(message)?'Contract file storage is disabled (Cloudinary). Evidence was not saved. Contact the backend team to restore the image service.':message});resource.reload();}finally{busy.current=false;setSaving(false);}}
 if(!permitted)return <Panel title="Contract and handover"><p>An assigned Staff or Manager account is required.</p></Panel>;
 return <Panel title="Paper contract and handover"><Message {...feedback}/><Message error={resource.error}/>{resource.loading&&<p role="status">Loading reservation contract…</p>}<Button variant="outline" disabled={saving} onClick={resource.reload}>Refresh contract</Button>
 {data&&<div className="mt-4 space-y-4"><Details values={ [['Contract ID',recordId(data.contract)],['Contract',data.contract.contractCode],['Contract status',<Status value={data.contract.status}/>],['Reservation status',<Status value={data.reservation.status}/>],['Evidence',data.contract.signedProofUrl?'Saved':'Not available']]}/>
 <Button variant="outline" disabled={saving} onClick={()=>setAction('print')}>View contract print data</Button>
 {paperEligible(data)&&<><Field label="Signed paper contract image or PDF"><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={e=>setFile(e.target.files?.[0]||null)}/></Field><Field label="Paper contract number (optional)"><Input maxLength={100} value={number} disabled={saving} onChange={e=>setNumber(e.target.value)}/></Field></>}
 {(paperEligible(data)||handoverEligible(data))&&<label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e=>setConfirmed(e.target.checked)}/>I have checked the customer, contract and handover condition.</label>}
 {paperEligible(data)&&<Button disabled={saving||!file||!confirmed} onClick={()=>setAction('paper')}>Confirm paper contract</Button>}
 {handoverEligible(data)&&<Button disabled={saving||!confirmed} onClick={()=>setAction('handover')}>Complete handover</Button>}
 {data.reservation.status==='CHECKIN_READY'&&<p>Waiting for the customer to pay the remaining balance. Refresh after payment.</p>}
 {data.reservation.status==='ACTIVE'&&<p>Handover complete. Do not repeat this action.</p>}
 </div>}
 {action&&<Dialog title={action==='paper'?'Save signed paper evidence':action==='handover'?'Confirm handover':'Load print data'} onClose={()=>{if(!busy.current)setAction(null);}}><form onSubmit={run}><p className="mb-4">Review and confirm this action for the current reservation.</p><Message {...feedback}/><Button disabled={saving}>{saving?'Processing…':'Confirm'}</Button></form></Dialog>}
 {printData&&<Dialog title="Contract data" onClose={()=>setPrintData(null)}><Details values={ [['Contract',printData.contractCode],['Customer',printData.customerSnapshot?.fullName||printData.customerId?.email||'—'],['Reservation',printData.reservationId?.reservationCode||reservationId],['Rent',money(printData.pricingSnapshot?.estimatedRent||0)],['Deposit',money(printData.pricingSnapshot?.depositAmount||0)],['Status',printData.status]]}/><p className="mt-4">This is contract data from the server, not a finalized legal PDF.</p><Button variant="outline" onClick={()=>window.print()}>Print this page</Button></Dialog>}
 </Panel>;
}
