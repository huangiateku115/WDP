import {useEffect,useRef,useState} from 'react';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {View} from 'react-native';
import {apiIssue,MobileInputError} from '../api/client';
import {unitSelection} from '../domain/liveBooking';
import {mobileRepo} from '../api/mobileRepository';
import {AppText,Button,Card,Chip,Filter,Input,StateCard,ui} from '../components/ui';
import {LiveScreen,ResourceState,serviceLabel,useResource} from '../components/liveUI';
import {WarehouseArt} from '../components/WarehouseArt';

function Pages({page,total,onChange}:{page:number;total:number;onChange:(page:number)=>void}){
  return total>1?<View style={ui.between}><Button label="Trang trước" variant="quiet" disabled={page===1} onPress={()=>onChange(page-1)}/><AppText>{page}/{total}</AppText><Button label="Trang sau" variant="quiet" disabled={page>=total} onPress={()=>onChange(page+1)}/></View>:null;
}
export function Explore(){
  const router=useRouter();
  const [page,setPage]=useState(1),[query,setQuery]=useState(''),[filter,setFilter]=useState('ALL');
  const data=useResource('facilities:'+page,signal=>mobileRepo.facilities(page,signal));
  const rows=data.data?.items.filter(f=>(filter==='ALL'||f.serviceTypes.some(service=>service===filter))&&
    (f.name+' '+(f.address.district??'')).toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')));
  return <LiveScreen title="Tìm không gian của bạn" onRefresh={data.reload} refreshing={data.loading}>
    <Input label="Tìm trong trang hiện tại" value={query} onChangeText={setQuery}/>
    <View style={ui.wrap}>{['ALL','SELF_STORAGE','MANAGED_INVENTORY'].map(value=>
      <Filter key={value} label={value==='ALL'?'Tất cả':serviceLabel(value)} selected={value===filter} onPress={()=>setFilter(value)}/>)}</View>
    <ResourceState {...data}/>{rows?.length===0&&<StateCard title="Không tìm thấy cơ sở trên trang này"/>}
    {rows?.map(f=><Card key={f._id}><WarehouseArt height={96}/><AppText variant="card">{f.name}</AppText>
      <AppText>{[f.address.line1??f.address.street,f.address.district,f.address.city].filter(Boolean).join(', ')}</AppText>
      <Button label="Xem cơ sở" onPress={()=>router.push({pathname:'/preview/[kind]/[id]',params:{kind:'facility',id:f._id}})}/></Card>)}
    <Pages page={page} total={data.data?.pagination.totalPages??0} onChange={setPage}/>
  </LiveScreen>;
}

export function FacilityDetail({id}:{id:string}){
  const router=useRouter(),data=useResource('facility:'+id,signal=>mobileRepo.facility(id,signal));
  return <LiveScreen title="Thông tin cơ sở" onRefresh={data.reload} refreshing={data.loading}><ResourceState {...data}/>
    {data.data&&<Card><WarehouseArt height={128}/><AppText variant="card">{data.data.name}</AppText>
      <AppText>{[data.data.address.line1??data.data.address.street,data.data.address.district,data.data.address.city].filter(Boolean).join(', ')}</AppText>
      {data.data.description&&<AppText>{data.data.description}</AppText>}
      <View style={ui.wrap}>{data.data.serviceTypes.map(value=><Chip key={value} label={serviceLabel(value)}/>)}</View>
      {data.data.serviceTypes.includes('SELF_STORAGE')&&<Button label="Chọn kho tự quản" onPress={()=>router.push({pathname:'/booking/[facilityId]/units',params:{facilityId:id}})}/>}
      {data.data.serviceTypes.includes('MANAGED_INVENTORY')&&<AppText>Đặt kho ký gửi hiện chưa hỗ trợ trên ứng dụng.</AppText>}
    </Card>}
  </LiveScreen>;
}

export function Units(){
  const {facilityId}=useLocalSearchParams<{facilityId:string}>();
  return <FacilityUnits key={facilityId} facilityId={facilityId}/>;
}

function FacilityUnits({facilityId}:{facilityId:string}){
  const router=useRouter();
  const [page,setPage]=useState(1),[pending,setPending]=useState(''),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const data=useResource(facilityId+':'+page,signal=>mobileRepo.units(facilityId,page,signal));
  async function select(unitId:string,status:unknown){
    if(request.current||!unitSelection(status).selectable)return;
    const controller=new AbortController();
    request.current=controller;
    setPending(unitId);setError('');
    try{
      const current=await mobileRepo.unit(facilityId,unitId,controller.signal);
      if(controller.signal.aborted)return;
      if(!unitSelection(current.status).selectable)throw new MobileInputError('Kho không còn trống. Vui lòng chọn kho khác.');
      router.push({pathname:'/booking/[facilityId]/review',params:{facilityId,unitId}});
    }catch(cause){
      if(!controller.signal.aborted){setError(apiIssue(cause));data.reload();}
    }finally{
      request.current=null;
      if(!controller.signal.aborted)setPending('');
    }
  }
  return <LiveScreen title="Chọn kho tự quản" onRefresh={data.reload} refreshing={data.loading}>
    <AppText>Hệ thống sẽ kiểm tra kho còn trống trong đúng kỳ thuê trước khi đặt.</AppText>
    <ResourceState {...data}/>{data.data?.items.length===0&&<StateCard title="Chưa tìm thấy kho"/>}
    {error?<StateCard kind="error" title="Không thể chọn kho" description={error} onRetry={data.reload}/>:null}
    {data.data?.items.map(unit=>{
      const status=unitSelection(unit.status);
      return <Card key={unit._id}><AppText variant="card">{unit.unitCode}</AppText>
        <AppText>Kích cỡ {({SMALL:"Nhỏ",MEDIUM:"Vừa",LARGE:"Lớn"})[unit.size]}</AppText>
        <Chip label={status.label} tone={status.selectable?'green':unit.status==='OCCUPIED'?'orange':'neutral'}/>
        <Button label="Chọn kỳ thuê" disabled={!status.selectable||!!pending} loading={pending===unit._id}
          onPress={()=>void select(unit._id,unit.status)}/>
      </Card>;
    })}
    <Pages page={page} total={data.data?.pagination.totalPages??0} onChange={setPage}/>
  </LiveScreen>;
}
