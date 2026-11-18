export type ToastMessage={id:number;message:string;kind:'success'|'error'};
let sequence=0;
let current:ToastMessage|null=null;
const listeners=new Set<()=>void>();
function emit(){for(const listener of listeners)listener();}
export function showToast(message:string,kind:ToastMessage['kind']='success'){
  current={id:++sequence,message,kind};emit();
}
export function dismissToast(id:number){if(current?.id===id){current=null;emit();}}
export function subscribeToast(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function getToast(){return current;}
