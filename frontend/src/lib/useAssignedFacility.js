import {useEffect,useState} from 'react';
import facilityApi from '@/api/facilityApi';

export default function useAssignedFacility(facilityId,enabled=true){
 const [state,setState]=useState({id:null,facility:null,loading:false});
 useEffect(()=>{
  if(!enabled||!/^[a-f\d]{24}$/i.test(facilityId||''))return;
  const controller=new AbortController();
  setState({id:facilityId,facility:null,loading:true});
  facilityApi.publicDetail(facilityId,{signal:controller.signal}).then(response=>{
   const row=response?.data?.data;
   if(!controller.signal.aborted)setState({id:facilityId,facility:String(row?._id||row?.id)===facilityId?row:null,loading:false});
  }).catch(()=>{if(!controller.signal.aborted)setState({id:facilityId,facility:null,loading:false});});
  return()=>controller.abort();
 },[facilityId,enabled]);
 return enabled&&state.id===facilityId?state:{facility:null,loading:enabled&&!!facilityId};
}
