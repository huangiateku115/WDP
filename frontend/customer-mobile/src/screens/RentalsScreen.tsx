import {useState} from 'react';
import {View} from 'react-native';
import {useCustomerStore} from '../state/useCustomerStore';
import {AppText,Filter,FixtureNotice,Screen,StateCard,ui} from '../components/ui';
import {CustomerHeader,RentalCard} from '../components/customer';
import type {RentalStatus} from '../domain/models';

export default function RentalsScreen(){
 const data=useCustomerStore(s=>s.fixtures);const [filter,setFilter]=useState<RentalStatus|'ALL'>('ALL');
 const rows=data.rentals.filter(r=>filter==='ALL'||r.status===filter);
 return <Screen testID="screen-rentals"><CustomerHeader/><View style={{gap:6}}><AppText variant="caption" style={ui.muted}>QUẢN LÝ KHÔNG GIAN CÁ NHÂN</AppText><AppText variant="title">Kho thuê của tôi</AppText></View><FixtureNotice/><View style={ui.wrap}>{([['ALL','Tất cả'],['ACTIVE','Đang thuê'],['RESERVED','Cần theo dõi'],['CLOSED','Lịch sử']] as const).map(([value,label])=><Filter key={value} label={label} selected={filter===value} onPress={()=>setFilter(value)}/>)}</View>{rows.length?rows.map(r=><RentalCard key={r.id} rental={r} facility={data.facilities.find(f=>f.id===r.facilityId)}/>):<StateCard title="Chưa có kỳ thuê trong nhóm này" description="Các kỳ thuê hiển thị trong bản mẫu không phải đặt chỗ thật." onRetry={()=>setFilter('ALL')}/>}</Screen>;
}
