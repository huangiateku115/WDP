import {useState} from 'react';
import {Input,Message} from '@/components/manager/ManagerUI';
export default function InspectionPhotos({photos,onChange}){
 const [error,setError]=useState('');
 async function upload(event){
  setError('');const files=Array.from(event.target.files);
  if(files.length>3||files.reduce((sum,f)=>sum+f.size,0)>2*1024*1024||files.some(f=>!f.type.startsWith('image/')||f.size>2*1024*1024)){setError('Choose up to 3 images, under 2 MB combined.');return;}
  try{const results=await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error("Không thể đọc ảnh."));reader.onload=()=>resolve({name:file.name,type:file.type,size:file.size,url:reader.result});reader.readAsDataURL(file);})));onChange(results);}catch(e){setError(e.message);}
 }
 return <div className="space-y-3">{onChange&&<Input aria-label="Ảnh kiểm tra" type="file" accept="image/*" multiple onChange={upload}/>}<Message error={error}/><div className="grid grid-cols-3 gap-3">{photos.map((photo,i)=><figure key={i}>{photo.url&&<img src={photo.url} alt={photo.name} className="h-24 w-full rounded-lg object-cover"/>}<figcaption className="break-words text-xs">{photo.name}</figcaption></figure>)}</div></div>;
}
