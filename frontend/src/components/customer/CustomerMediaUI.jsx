import {useEffect,useId,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';

// Native modality supplies focus containment and Escape without changing shared role dialogs.
export function CustomerDialog({title,description,onClose,onKeyDown,children}){
  const ref=useRef(null),heading=useId(),descriptionId=useId();
  useEffect(()=>{const previous=document.activeElement,node=ref.current;node.showModal();return()=>{node.close();if(previous?.isConnected)previous.focus();};},[]);
  function keys(event){
    if(event.key==='Tab'){
      const controls=[...ref.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(node=>node.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    onKeyDown?.(event);
  }
  return <dialog ref={ref} className="customer-ux-dialog" aria-labelledby={heading} aria-describedby={description?descriptionId:undefined} onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={keys}>
    <header><h2 id={heading}>{title}</h2><Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button></header>
    {description&&<p id={descriptionId} className="customer-dialog-description">{description}</p>}
    {children}
  </dialog>;
}

export function CustomerImagePreview({images,selectedUrl,title='Full size item image',onClose}){
  const [index,setIndex]=useState(()=>Math.max(0,images.indexOf(selectedUrl))),[failed,setFailed]=useState(false);
  const move=delta=>{setIndex(current=>Math.max(0,Math.min(images.length-1,current+delta)));setFailed(false);};
  const keys=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}};
  return <CustomerDialog title={title} description="Use the arrow keys or Previous / Next to browse. Press Escape to close." onClose={onClose} onKeyDown={keys}>
    <div className="customer-image-stage">{failed?<p role="status">Image unavailable. Try another image or close the preview.</p>:<img key={images[index]} src={images[index]} alt={`Item image ${index+1} of ${images.length}`} decoding="async" onError={()=>setFailed(true)}/>}</div>
    <footer className="customer-image-controls"><Button type="button" variant="outline" disabled={index===0} onClick={()=>move(-1)} aria-label="Previous image"><ChevronLeft size={16}/>Previous</Button><span aria-live="polite">Image {index+1} of {images.length}</span><Button type="button" variant="outline" disabled={index===images.length-1} onClick={()=>move(1)} aria-label="Next image">Next<ChevronRight size={16}/></Button></footer>
  </CustomerDialog>;
}
