import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {objectId} from '@/lib/facilityReview';
import FacilityHandoverPanel from '@/components/staff/FacilityHandoverPanel';
import {Screen,Panel,Input,Button,OpenLink} from '@/components/manager/ManagerUI';
export default function HandoverApiView({manager=false}){
 const {id}=useParams(),[value,setValue]=useState(id||''),[selected,setSelected]=useState(objectId(id)?id:'');
 return <Screen title="Contract and unit handover" notice="Load the reservation contract, save signed paper evidence and hand over the unit after payment."><Panel title="Select a Self Storage reservation"><OpenLink to={`/${manager?'manager':'staff'}/reservations`}>Open reservation list</OpenLink><form className="mt-4 flex gap-3" onSubmit={e=>{e.preventDefault();if(objectId(value))setSelected(value);}}><Input aria-label="Handover Reservation ID" value={value} onChange={e=>setValue(e.target.value.trim())}/><Button disabled={!objectId(value)}>Open reservation</Button></form></Panel>{selected&&<FacilityHandoverPanel key={selected} reservationId={selected}/>}</Screen>;
}
