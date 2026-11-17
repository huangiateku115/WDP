import {Panel,Details,Table,Message} from '@/components/manager/ManagerUI';
import {recordId} from '@/lib/facilityReview';
export default function CanonicalFacilityStock({stock}){
 const verified=stock.stockVerified;
 return <Panel title="Tồn kho theo ô và quy cách hàng">
  {!verified&&<Message error="Sổ tồn chưa được xác minh. Số liệu thiếu không được coi là tồn bằng không."/>}
  <Details values={ [['Tổng số lượng',verified?stock.totalQuantity:'Chưa xác minh'],['Khối lượng (kg)',verified?stock.totalWeightKg:'Chưa xác minh'],['Thể tích (m³)',verified?stock.totalVolumeM3:'Chưa xác minh'],['Đối chiếu sổ tồn',stock.ledgerStatus==='REPLAYED'?'Đã đối chiếu':stock.ledgerStatus==='NOT_REQUIRED'?'Chưa phát sinh nhập hàng':'Cần kiểm tra']]}/>
  <p className="my-4 text-sm">Kết quả sổ tồn của mặt hàng không thay thế đối soát dung lượng toàn cơ sở.</p>
  {verified&&<div className="space-y-5">
   <Table label="Tồn theo quy cách" rows={stock.itemSpecifications.map(row=>({...row,id:recordId(row.itemSpecId)}))} columns={[{key:'code',label:'Mã quy cách'},{key:'name',label:'Tên quy cách'},{key:'quantityOnHand',label:'Đang lưu'},{key:'quantityHeld',label:'Đang giữ'},{key:'quantityAvailable',label:'Khả dụng'},{key:'quantityUnit',label:'Đơn vị'}]}/>
   <Table label="Tồn theo ô" rows={stock.byCell.map(row=>({...row,id:recordId(row.cellId)}))} columns={[{key:'cellId',label:'Ô lưu trữ',render:r=>recordId(r.cellId)},{key:'quantityOnHand',label:'Đang lưu'},{key:'quantityHeld',label:'Đang giữ'},{key:'quantityAvailable',label:'Khả dụng'},{key:'weightKg',label:'Khối lượng (kg)'},{key:'volumeM3',label:'Thể tích (m³)'}]}/>
   <Table label="Tồn theo đơn thuê" rows={stock.byReservation.map(row=>({...row,id:recordId(row.reservationId)}))} columns={[{key:'reservationCode',label:'Đơn thuê',render:r=>r.reservationCode||recordId(r.reservationId)},{key:'quantityOnHand',label:'Đang lưu'},{key:'totalWeightKg',label:'Khối lượng (kg)'},{key:'totalVolumeM3',label:'Thể tích (m³)'}]}/>
  </div>}
 </Panel>;
}
