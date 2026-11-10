import {useEffect,useRef,useState} from 'react';
import {Button,Message} from '@/components/manager/ManagerUI';
import {managedIntakeApi} from '@/api/managedIntakeApi';
import {receivingUpload} from '@/lib/receivingUpload';

const MAX_IMAGES=10,MAX_BYTES=8*1024*1024;
const key=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
export default function ReceivingEvidencePicker({itemId,disabled=false,onChange,uploadEvidence=managedIntakeApi.uploadReceivingEvidence}){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),controllers=useRef(new Map()),rowsRef=useRef([]);
 rowsRef.current=rows;
 useEffect(()=>{onChange?.(rows.filter(row=>row.status==='ready').map(row=>row.upload.uploadId),rows.every(row=>row.status==='ready'));},[rows,onChange]);
 useEffect(()=>{setRows([]);return()=>{for(const controller of controllers.current.values())controller.abort();controllers.current.clear();for(const row of rowsRef.current)URL.revokeObjectURL(row.preview);};},[itemId]);
 function patchRow(id,change){setRows(current=>current.map(row=>row.id===id?{...row,...change}:row));}
 function choose(event){setError('');const files=Array.from(event.target.files||[]);event.target.value='';if(rows.length+files.length>MAX_IMAGES){setError("Mỗi lần tiếp nhận tối đa 10 ảnh bằng chứng.");return;}const invalid=files.find(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<=0||file.size>MAX_BYTES);if(invalid){setError("Chọn ảnh JPEG, PNG hoặc WebP có dữ liệu, tối đa 8 MiB mỗi ảnh.");return;}setRows(current=>[...current,...files.map(file=>({id:key(),key:key(),file,preview:URL.createObjectURL(file),status:'queued',progress:0}))]);}
 async function upload(row){
  if(disabled||controllers.current.has(row.id)||!rowsRef.current.some(current=>current.id===row.id&&current.status!=='ready'))return;
  const controller=new AbortController();controllers.current.set(row.id,controller);patchRow(row.id,{status:'uploading',progress:0,error:''});
  try{
   const response=await uploadEvidence(itemId,row.file,row.key,{signal:controller.signal,onUploadProgress:event=>patchRow(row.id,{progress:event.total?Math.round(event.loaded/event.total*100):0})});
   if(controller.signal.aborted)return;
   patchRow(row.id,{status:'ready',progress:100,upload:receivingUpload(response)});
  }catch(err){patchRow(row.id,{status:controller.signal.aborted?'cancelled':'error',error:controller.signal.aborted?"Đã hủy tải ảnh. Có thể thử lại.":err.response?.data?.message||err.message});}
  finally{controllers.current.delete(row.id);}
 }
 function remove(row){controllers.current.get(row.id)?.abort();URL.revokeObjectURL(row.preview);setRows(current=>current.filter(entry=>entry.id!==row.id));}
 function move(index,offset){setRows(current=>{const target=index+offset;if(target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next;});}
 return <div className="space-y-3"><label className="block text-sm font-medium">Bằng chứng kiểm tra tiếp nhận (tối đa 10 ảnh)<input aria-label="Ảnh bằng chứng tiếp nhận" className="mt-2 block w-full" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled||rows.length>=MAX_IMAGES} onChange={choose}/></label><Message error={error}/><div className="grid gap-3 sm:grid-cols-2">{rows.map((row,index)=><article key={row.id} className="rounded-xl border p-3"><img src={row.preview} alt={`Xem trước bằng chứng ${row.file.name}`} className="h-36 w-full rounded-lg object-cover"/><p className="mt-2 truncate text-xs">{row.file.name}</p>{row.status==='uploading'&&<div className="mt-2"><progress aria-label={`Tiến độ tải ảnh ${row.file.name}`} max="100" value={row.progress} className="w-full"/><Button type="button" variant="outline" onClick={()=>controllers.current.get(row.id)?.abort()}>Hủy</Button></div>}{row.status==='ready'&&<p role="status" className="text-xs text-emerald-700">Đã tải lên và sẵn sàng đính kèm</p>}{row.error&&<p role="alert" className="text-xs text-red-700">{row.error}</p>}<div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled||row.status==='uploading'||row.status==='ready'} onClick={()=>upload(row)}>{row.status==='error'||row.status==='cancelled'?"Thử lại":"Tải ảnh lên"}</Button><Button type="button" variant="outline" disabled={disabled||index===0} onClick={()=>move(index,-1)}>Chuyển lên</Button><Button type="button" variant="outline" disabled={disabled||index===rows.length-1} onClick={()=>move(index,1)}>Chuyển xuống</Button><Button type="button" variant="outline" disabled={disabled||row.status==='uploading'} onClick={()=>remove(row)}>Gỡ</Button></div></article>)}</div></div>;
}
