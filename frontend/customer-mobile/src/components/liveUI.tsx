import {useCallback, useEffect, useRef, useState, type PropsWithChildren} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {ScreenHeading} from './livePresentation';
import {CustomerBackButton} from './CustomerBackButton';
import {Screen,StateCard} from './ui';
import {apiIssue} from '../api/client';
import axios from 'axios';

export function useResource<T>(key:string, load:(signal:AbortSignal)=>Promise<T>) {
  const loader=useRef(load);
  loader.current=load;
  const [version,setVersion]=useState(0);
  const [result,setResult]=useState<{key:string;data?:T;hasValue:boolean;loading:boolean;error?:string;httpStatus?:number;errorCode?:string}>();
  const resultRef=useRef(result);
  resultRef.current=result;
  const reload=useCallback(()=>setVersion(value=>value+1),[]);
  useFocusEffect(useCallback(()=>{
    let request:AbortController|undefined;
    function refresh(){
      request?.abort();
      const abort=new AbortController();
      request=abort;
      const previous=resultRef.current?.key===key?resultRef.current:undefined;
      const pending={...previous,key,hasValue:previous?.hasValue??false,loading:true,error:undefined,httpStatus:undefined,errorCode:undefined};
      resultRef.current=pending;
      setResult(pending);
      void loader.current(abort.signal).then(data=>{
        if(!abort.signal.aborted){const next={key,data,hasValue:true,loading:false};resultRef.current=next;setResult(next);}
      },error=>{
        if(!abort.signal.aborted){const next={...previous,key,hasValue:previous?.hasValue??false,loading:false,error:apiIssue(error),httpStatus:axios.isAxiosError(error)?error.response?.status:undefined,
          errorCode:axios.isAxiosError(error)&&typeof error.response?.data?.code==='string'?error.response.data.code:undefined};resultRef.current=next;setResult(next);}
      });
    }
    refresh();
    let appState=AppState.currentState;
    const listener=AppState.addEventListener('change',state=>{
      const resumed=state==='active'&&appState!=='active';
      appState=state;
      if(resumed)refresh();
    });
    return ()=>{request?.abort();listener.remove();};
  },[key,version]));
  const current=result?.key===key?result:undefined;
  return {data:current?.data,error:current?.error,httpStatus:current?.httpStatus,errorCode:current?.errorCode,
    loading:!current||current.loading&&!current.hasValue,refreshing:!!current?.loading&&current.hasValue,reload};
}

export function useScreenActive(){
  const [focused,setFocused]=useState(false);
  const [foreground,setForeground]=useState(AppState.currentState==='active'||AppState.currentState==null);
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));
  useEffect(()=>{
    let appState=AppState.currentState;
    const subscription=AppState.addEventListener('change',state=>{
      const resumed=state==='active'&&appState!=='active';
      appState=state;
      if(resumed||state!=='active')setForeground(state==='active');
    });
    return ()=>subscription.remove();
  },[]);
  return focused&&foreground;
}

export function LiveScreen({title,eyebrow,subtitle,children,onRefresh,refreshing,backButton}:PropsWithChildren<{title:string;eyebrow?:string;subtitle?:string;onRefresh?:()=>void;refreshing?:boolean;backButton?:{onPress:()=>void;disabled?:boolean}}>) {
  return <Screen onRefresh={onRefresh} refreshing={refreshing}><ScreenHeading title={title} eyebrow={eyebrow} subtitle={subtitle}
    leading={backButton?<CustomerBackButton onPress={backButton.onPress} disabled={backButton.disabled}/>:undefined}/>{children}</Screen>;
}
export function ResourceState({loading,error,reload,resource}:ReturnType<typeof useResource<unknown>> & {resource?:string}) {
  if(loading)return <StateCard kind="loading" title="Đang tải dữ liệu"/>;
  if(error)return <StateCard kind="error" title={resource==='đơn thuê'?'Chưa thể xác định đơn thuê liên quan':resource==='số lượng tồn kho'?'Chưa thể tải số lượng tồn kho':resource?`Chưa thể tải ${resource}`:'Chưa thể tải dữ liệu'}
    description="Vui lòng kiểm tra kết nối rồi thử lại." onRetry={reload}/>;
  return null;
}
export const money=(value:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(value);
export const dateLabel=(value:string)=>new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(value));
export const serviceLabel=(value:string)=>value==='SELF_STORAGE'?'Kho tự quản':'Kho ký gửi';
export function UnavailableScreen(){
  return <LiveScreen title="Chức năng chưa khả dụng"><StateCard title="Thao tác này chưa được hỗ trợ trên ứng dụng" description="Bạn có thể tiếp tục theo dõi dữ liệu đã được xác nhận trong các màn hình của mình."/></LiveScreen>;
}
