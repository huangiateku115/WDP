import {ManagedInboundPreviewCard} from './ManagedInboundPreviewCard';
import {useEffect,useRef,useState} from 'react';
import axios from 'axios';
import {ZodError} from 'zod';
import {apiIssue} from '../api/client';
import type {ReservationDto} from '../api/contracts/customer';
import {managedInventory} from '../api/managedInventory';
import {managedSkuEligible,saveManagedSku} from '../api/managedSkuV3';
import {refId} from '../api/contracts/core';
import type {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,Input} from './ui';
import {ResourceState,useResource} from './liveUI';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
export function ManagedSkuEditor({r,item,owner,onSaved}:{r:ReservationDto;item?:Item;owner:string;onSaved:(row:Item)=>void}){
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false);
  const [error,setError]=useState('');
  const [values,setValues]=useState({name:item?.name??'',category:item?.category??'',description:typeof item?.description==='string'?item.description:'',
    code:'',quantity:'',unit:'',weight:'',width:'',depth:'',height:''});
  const busy=useRef(false),mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  if(!managedSkuEligible(r)||(item&&(item.inventorySchemaVersion!==3||item.status!=='REGISTERED'||item.currentCellId!=null)))return null;

  const field=(key:keyof typeof values,label:string,numeric=false)=><Input label={label} value={values[key]} editable={!pending&&!uncertain}
    keyboardType={numeric?'decimal-pad':'default'} onChangeText={value=>setValues(previous=>({...previous,[key]:value}))}/>;
  async function save(){
    if(busy.current||uncertain)return;
    const current=()=>mounted.current&&useLiveSession.getState().user?._id===owner;
    if(!current())return;
    busy.current=true;setPending(true);setError('');
    const metadata={name:values.name,category:values.category,description:values.description};
    const number=(value:string)=>Number(value.replace(',','.'));
    try{
      const row=await saveManagedSku(r,owner,item?metadata:{...metadata,managedReservationId:r._id,itemCode:values.code,
        quantity:number(values.quantity),quantityUnit:values.unit,unitWeightKg:number(values.weight),
        unitDimensionsM:{widthM:number(values.width),depthM:number(values.depth),heightM:number(values.height)}},current,item);
      if(current()){setOpen(false);onSaved(row);}
    }catch(cause){
      if(current()){
        const ambiguous=axios.isAxiosError(cause)&&(!cause.response||cause.response.status>=500);
        if(ambiguous)setUncertain(true);
        setError(ambiguous?'Chưa rõ kết quả lưu. Tải lại danh sách hàng hóa và kiểm tra mã SKU trước khi thử lại.':
          cause instanceof ZodError?'Kiểm tra mã SKU, tên, danh mục và các số đo bắt buộc.':apiIssue(cause));
      }
    }finally{busy.current=false;if(current())setPending(false);}
  }
  return <Card>
    <Button label={open?'Đóng biểu mẫu':item?'Sửa thông tin SKU':'Khai báo SKU'} variant="outline" disabled={pending}
      onPress={()=>setOpen(!open)}/>
    {open&&<>
      <AppText>Thông tin khai báo SKU. Tồn kho chỉ được ghi nhận sau thao tác nhập hàng đã xác nhận.</AppText>
      {!item&&field('code','Mã SKU')}
      {field('name','Tên hàng')}{field('category','Danh mục')}{field('description','Mô tả')}
      {!item&&<>{field('quantity','Số lượng khai báo',true)}{field('unit','Đơn vị tính')}
        {field('weight','Khối lượng một đơn vị (kg)',true)}{field('width','Rộng (m)',true)}
        {field('depth','Sâu (m)',true)}{field('height','Cao (m)',true)}</>}
      <Button label="Lưu thông tin SKU" loading={pending} disabled={uncertain} onPress={()=>void save()}/>
      {!!error&&<AppText accessibilityRole="alert">{error}</AppText>}
    </>}
  </Card>;
}

export function ManagedSkuEdit({item,owner,onSaved,accessSessionId}:{item:Item;owner:string;onSaved:(row:Item)=>void;accessSessionId?:string}){
  const r=useResource(owner+':'+item._id,signal=>managedInventory.rental(refId(item.managedReservationId),owner,refId(item.facilityId),signal));
  return <><ResourceState {...r}/>{r.data&&<><ManagedSkuEditor r={r.data} item={item} owner={owner} onSaved={onSaved}/><ManagedInboundPreviewCard item={item} r={r.data} owner={owner} onCommitted={()=>onSaved(item)} initialSessionId={accessSessionId}/></>}</>;
}
