import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {objectId} from '@/lib/facilityReview';
import FacilityHandoverPanel from '@/components/staff/FacilityHandoverPanel';
import {Screen,Panel,Input,Button,OpenLink} from '@/components/manager/ManagerUI';
export default function HandoverApiView({manager=false}){
 const {id}=useParams(),[value,setValue]=useState(id||''),[selected,setSelected]=useState(objectId(id)?id:'');
 return <Screen title="Hợp đồng và bàn giao kho" notice="Xem hợp đồng của đơn, lưu bản ký giấy và bàn giao kho sau thanh toán."><Panel title="Chọn đơn thuê kho riêng"><OpenLink to={`/${manager?'manager':'staff'}/reservations`}>Mở danh sách đơn thuê</OpenLink><form className="mt-4 flex gap-3" onSubmit={e=>{e.preventDefault();if(objectId(value))setSelected(value);}}><Input aria-label="Mã định danh đơn bàn giao" value={value} onChange={e=>setValue(e.target.value.trim())}/><Button disabled={!objectId(value)}>Mở đơn thuê</Button></form></Panel>{selected&&<FacilityHandoverPanel key={selected} reservationId={selected}/>}</Screen>;
}
