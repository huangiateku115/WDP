import {useCallback, useRef, useState, type PropsWithChildren} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {ScreenHeading} from './livePresentation';
import {Screen,StateCard} from './ui';
import {apiIssue} from '../api/client';

export function useResource<T>(key:string, load:(signal:AbortSignal)=>Promise<T>) {
  const loader=useRef(load);
  loader.current=load;
  const [version,setVersion]=useState(0);
  const [result,setResult]=useState<{key:string;data?:T;error?:string}>();
  const reload=useCallback(()=>setVersion(value=>value+1),[]);
  useFocusEffect(useCallback(()=>{
    let request:AbortController|undefined;
    function refresh(){
      request?.abort();
      const abort=new AbortController();
      request=abort;
      setResult(undefined);
      void loader.current(abort.signal).then(data=>{
        if(!abort.signal.aborted)setResult({key,data});
      },error=>{
        if(!abort.signal.aborted)setResult({key,error:apiIssue(error)});
      });
    }
    refresh();
    const listener=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
    return ()=>{request?.abort();listener.remove();};
  },[key,version]));
  const current=result?.key===key?result:undefined;
  return {data:current?.data,error:current?.error,loading:!current,reload};
}

export function LiveScreen({title,eyebrow,subtitle,children,onRefresh,refreshing}:PropsWithChildren<{title:string;eyebrow?:string;subtitle?:string;onRefresh?:()=>void;refreshing?:boolean}>) {
  return <Screen onRefresh={onRefresh} refreshing={refreshing}><ScreenHeading title={title} eyebrow={eyebrow} subtitle={subtitle}/>{children}</Screen>;
}
export function ResourceState({loading,error,reload}:ReturnType<typeof useResource<unknown>>) {
  if(loading)return <StateCard kind="loading" title="Đang tải dữ liệu"/>;
  if(error)return <StateCard kind="error" title="Không tải được dữ liệu" description={error} onRetry={reload}/>;
  return null;
}
export const money=(value:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(value);
export const dateLabel=(value:string)=>new Intl.DateTimeFormat('vi-VN',{dateStyle:'medium',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(value));
export const serviceLabel=(value:string)=>value==='SELF_STORAGE'?'Kho tự quản':'Kho ký gửi';
export function UnavailableScreen(){
  return <LiveScreen title="Chức năng chưa khả dụng"><StateCard title="Thao tác này chưa được hỗ trợ trên ứng dụng" description="Bạn có thể tiếp tục theo dõi dữ liệu đã được xác nhận trong các màn hình của mình."/></LiveScreen>;
}
