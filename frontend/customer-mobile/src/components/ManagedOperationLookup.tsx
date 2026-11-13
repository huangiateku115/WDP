import {useState} from 'react';
import {mobileRepo} from '../api/mobileRepository';
import {AppText,Button,Card,Input} from './ui';
import {dateLabel,ResourceState,useResource} from './liveUI';

export function ManagedOperationLookup({item,owner}:{item:Awaited<ReturnType<typeof mobileRepo.item>>;owner:string}){
  const [value,setValue]=useState(''),[request,setRequest]=useState('');
  const key=value.trim();
  const data=useResource(owner+':'+item._id+':'+request,signal=>request?mobileRepo.inventoryOperation(item,owner,request,signal):Promise.resolve(null));
  return <Card>
    <AppText variant="medium">Kiểm tra thao tác đã gửi</AppText>
    <Input label="Khóa idempotency của thao tác" value={value} maxLength={128} autoCapitalize="none"
      onChangeText={text=>{setValue(text);setRequest('');}}/>
    <Button label="Tra cứu thao tác" variant="outline" disabled={!/^[A-Za-z0-9_.:\/-]{8,128}$/.test(key)}
      loading={!!request&&data.loading} onPress={()=>{setRequest(key);data.reload();}}/>
    {!!request&&<ResourceState {...data}/>}
    {data.data&&<AppText>Máy chủ đã ghi nhận {data.data.operationId} · {dateLabel(data.data.performedAt)}</AppText>}
  </Card>;
}
