import {useCallback,useEffect,useState} from 'react';
import {reviewError} from './facilityReview';
const changeKey='VaultSpace_facility_review_change';
export function announceReviewChange(){try{localStorage.setItem(changeKey,String(Date.now())+'-'+Math.random());}catch{/* A blocked browser store must not turn a successful API write into an error. */}window.dispatchEvent(new Event('facility-review-changed'));}
export default function useFacilityResource(load,enabled=true){
 const [state,setState]=useState({data:null,loading:enabled,error:''}),[version,setVersion]=useState(0);
 const reload=useCallback(()=>setVersion(v=>v+1),[]);
 useEffect(()=>{const storage=e=>{if(e.key===changeKey)reload();};window.addEventListener('storage',storage);window.addEventListener('focus',reload);window.addEventListener('facility-review-changed',reload);return()=>{window.removeEventListener('storage',storage);window.removeEventListener('focus',reload);window.removeEventListener('facility-review-changed',reload);};},[reload]);
 useEffect(()=>{if(!enabled){setState({data:null,loading:false,error:''});return;}const controller=new AbortController();setState({data:null,loading:true,error:''});Promise.resolve().then(()=>load(controller.signal)).then(data=>{if(!controller.signal.aborted)setState({data,loading:false,error:''});}).catch(error=>{if(!controller.signal.aborted)setState({data:null,loading:false,error:reviewError(error)});});return()=>controller.abort();},[load,enabled,version]);
 return {...state,reload};
}
