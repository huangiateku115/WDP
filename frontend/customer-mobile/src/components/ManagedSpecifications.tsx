import {useRef,useState} from 'react';
import {useRouter,type Href} from 'expo-router';
import {apiIssue} from '../api/client';
import {managedSpecifications,type ManagedSpecification} from '../api/managedSpecifications';
import type {mobileRepo} from '../api/mobileRepository';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card,StateCard} from './ui';
import {ResourceState,useResource} from './liveUI';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
export function ManagedSpecifications({item,owner}:{item:Item;owner:string}){
  const router=useRouter();
  const specs=useResource(owner+':'+item._id,()=>managedSpecifications.list(item,owner));
  const units=useResource(owner+':quantity-units',signal=>managedSpecifications.units(signal));
  const [removing,setRemoving]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState('');const lock=useRef(false);
  async function remove(row:ManagedSpecification){if(lock.current)return;lock.current=true;setPending(true);setError('');
    try{await managedSpecifications.remove(item,owner,row);setRemoving('');specs.reload();}catch(cause){setError(apiIssue(cause));}finally{lock.current=false;setPending(false);}}
  return <Card><AppText variant="medium">Thông tin loại hàng</AppText>
    <AppText variant="caption">Thông tin kích thước và khối lượng giúp xác định sức chứa phù hợp.</AppText>
    <ResourceState {...specs} resource="loại hàng"/>{specs.data?.length===0&&<StateCard title="Chưa có loại hàng" description="Thêm loại hàng trước khi đăng ký nhập kho."/>}
    {specs.data?.map(row=><Card key={row._id}><AppText variant="card">{row.name} · {row.code}</AppText>
      <AppText>{row.quantityUnit} · {row.unitWeightKg} kg · {row.dimensionsM.widthM} × {row.dimensionsM.depthM} × {row.dimensionsM.heightM} m</AppText>
      <AppText>{row.status==='ACTIVE'?'Đang hoạt động':'Đã ngừng sử dụng'}</AppText>
      {row.status==='ACTIVE'&&<><Button label="Sửa loại hàng" variant="outline" disabled={pending} onPress={()=>router.push({pathname:'/inventory/[id]/specifications/[specId]',params:{id:item._id,specId:row._id}} as unknown as Href)}/>
        <Button label={removing===row._id?'Xác nhận xóa mềm':'Ngừng sử dụng'} variant="quiet" disabled={pending} onPress={()=>removing===row._id?void remove(row):setRemoving(row._id)}/></>}
    </Card>)}
    <ResourceState {...units} resource="đơn vị tính"/>
    {!units.loading&&!units.error&&units.data?.length===0&&<StateCard title="Chưa có đơn vị tính phù hợp" description="Vui lòng liên hệ cơ sở để được hỗ trợ bổ sung đơn vị tính."/>}
    <Button label="Thêm loại hàng" variant="outline" disabled={units.loading||!!units.error||!units.data?.length||item.status!=='ACTIVE'||item.inventorySchemaVersion!==3}
      onPress={()=>router.push({pathname:'/inventory/[id]/specifications/new',params:{id:item._id}} as unknown as Href)}/>
    {!!error&&<StateCard kind="error" title="Không thể lưu loại hàng" description={error}/>}
  </Card>;
}
