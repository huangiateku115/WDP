import {useEffect,useId,useRef} from 'react';
import {X} from 'lucide-react';
import {Button} from './button';

// Matches existing native dialog pattern; native modality traps focus without another dependency.
export function Dialog({title,description,onClose,busy=false,children,className='',closeLabel='Close reservation dialog'}){
  const ref=useRef(null),titleId=useId(),descriptionId=useId();
  useEffect(()=>{const previous=document.activeElement,dialog=ref.current;dialog.showModal();return()=>{dialog.close();if(previous?.isConnected)previous.focus();};},[]);
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={e=>{e.preventDefault();if(!busy)onClose();}} className={`experience-theme w-[calc(100%-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-auto rounded-2xl border border-green-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/50 ${className}`}><header className="flex items-start justify-between gap-3" style={{flexDirection:'row'}}><div className="min-w-0 flex-1"><h2 id={titleId} className="text-xl font-bold text-brand">{title}</h2><p id={descriptionId} className="mt-2 text-sm text-slate-600">{description}</p></div><Button className="shrink-0" type="button" disabled={busy} size="icon" variant="ghost" aria-label={closeLabel} onClick={onClose}><X size={18}/></Button></header><div className="mt-5 space-y-5">{children}</div></dialog>;
}
