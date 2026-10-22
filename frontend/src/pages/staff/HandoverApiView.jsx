import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {objectId} from '@/lib/facilityReview';
import FacilityHandoverPanel from '@/components/staff/FacilityHandoverPanel';
import {Screen,Panel,Input,Button,OpenLink} from '@/components/manager/ManagerUI';
export default function HandoverApiView({manager=false}){
 const {id}=useParams(),[value,setValue]=useState(id||''),[selected,setSelected]=useState(objectId(id)?id:'');
 return <Screen title="Hợp đồng và bàn giao kho" notice="Đọc hợp đồng theo đơn, lưu bằng chứng ký giấy và bàn giao sau khi thanh toán."><Panel title="Chọn đơn Self Storage"><OpenLink to={`/${manager?'manager':'staff'}/reservations`}>Mở danh sách đặt chỗ</OpenLink><form className="mt-4 flex gap-3" onSubmit={e=>{e.preventDefault();if(objectId(value))setSelected(value);}}><Input aria-label="Reservation ID bàn giao" value={value} onChange={e=>setValue(e.target.value.trim())}/><Button disabled={!objectId(value)}>Mở đơn</Button></form></Panel>{selected&&<FacilityHandoverPanel key={selected} reservationId={selected}/>}</Screen>;
}
