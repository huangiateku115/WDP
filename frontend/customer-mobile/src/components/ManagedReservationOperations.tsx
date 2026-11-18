import {useEffect,useState} from 'react';
import {useRouter,type Href} from 'expo-router';
import type {ReservationDto} from '../api/contracts/customer';
import {managedReservationReads} from '../api/managedReservationReads';
import {eligibleInboundCells} from '../api/managedInboundPreview';
import {useLiveSession} from '../state/useLiveSession';
import {AppText,Button,Card} from './ui';
import {useResource} from './liveUI';
import {colors} from '../theme/tokens';

export type ManagedOperationProgress={hasVisit?:boolean;hasInboundSession?:boolean};
const todayHcm=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function ManagedReservationOperations({r,owner,onProgress}:{r:ReservationDto;owner:string;onProgress?:(progress:ManagedOperationProgress)=>void}){
  const router=useRouter();
  const [now,setNow]=useState(Date.now());
  const scope=owner+':'+r._id;
  const visits=useResource(scope,signal=>managedReservationReads.visits(r,owner,signal));
  const sessions=useResource(scope,signal=>managedReservationReads.sessions(r,owner,signal));
  const visitEligibility=useResource(scope+':visit-eligibility:'+todayHcm(),signal=>managedReservationReads.visitEligibility(r,owner,todayHcm(),signal));
  useEffect(()=>{
    if(!sessions.data?.some(session=>session.status==='ACTIVE'))return;
    const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);
  },[sessions.data]);
  useEffect(()=>{
    const progress:ManagedOperationProgress={};
    if(visits.data)progress.hasVisit=visits.data.some(visit=>visit.status!=='CANCELLED');
    if(sessions.data)progress.hasInboundSession=sessions.data.some(session=>eligibleInboundCells(r,session,now).length>0);
    if(Object.keys(progress).length)onProgress?.(progress);
  },[visits.data,sessions.data,r,now,onProgress]);
  return <Card>
    <Button label="Đặt lịch đến kho" disabled={visitEligibility.loading||!!visitEligibility.error||!visitEligibility.data} loading={visitEligibility.loading} onPress={()=>router.push({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId:r._id}})}/>
    {visitEligibility.error&&<>
      <Button label="Thử lại điều kiện đặt lịch" variant="quiet" onPress={visitEligibility.reload}/>
    </>}
    {!!visitEligibility.error&&<AppText accessibilityRole="alert" style={{color:colors.muted}}>{visitEligibility.httpStatus===409?'Đơn thuê hiện chưa đủ điều kiện đặt lịch.':'Chưa thể kiểm tra điều kiện đặt lịch. Hãy thử tải lại.'}</AppText>}
    <Button label="Xem lịch và phiên truy cập" variant="outline" onPress={()=>router.push((`/managed/reservations/${r._id}/visits`) as Href)}/>
  </Card>;
}
