import {useState} from 'react';
import {useCustomerStore} from '../state/useCustomerStore';
import {AppText,Filter,FixtureNotice,Input,Screen,StateCard,ui} from '../components/ui';
import {CustomerHeader,FacilityCard} from '../components/customer';
import {View} from 'react-native';
import type {Service} from '../domain/models';

export default function ExploreScreen(){
 const facilities=useCustomerStore(s=>s.fixtures.facilities);const [query,setQuery]=useState(''),[service,setService]=useState<Service|'ALL'>('ALL');
 const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll('đ','d');
 const filtered=facilities.filter(f=>(service==='ALL'||f.services.includes(service))&&fold(`${f.name} ${f.district}`).includes(fold(query)));
 return <Screen testID="screen-explore"><CustomerHeader/><AppText variant="title">Tìm không gian của bạn</AppText><AppText style={ui.muted}>Kho tự quản và kho ký gửi tại TP. Hồ Chí Minh.</AppText><FixtureNotice/><Input label="Tìm cơ sở" placeholder="Tên cơ sở hoặc khu vực" value={query} onChangeText={setQuery} returnKeyType="search"/><View style={ui.wrap}>{([['ALL','Tất cả'],['SELF_STORAGE','Kho tự quản'],['MANAGED_INVENTORY','Kho ký gửi']] as const).map(([value,label])=><Filter key={value} label={label} selected={service===value} onPress={()=>setService(value)}/>)}</View><AppText variant="label" style={ui.muted}>{filtered.length} cơ sở mẫu · Giá tham khảo minh họa</AppText>{filtered.length?filtered.map(f=><FacilityCard key={f.id} facility={f}/>):<StateCard title="Chưa tìm thấy cơ sở" description={facilities.length?'Thử từ khóa khác hoặc bỏ bộ lọc.':'Dữ liệu cơ sở mẫu hiện chưa có.'} onRetry={()=>{setQuery('');setService('ALL');}}/>}</Screen>;
}
