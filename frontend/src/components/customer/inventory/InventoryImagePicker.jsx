import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from './InventoryBackendUI';
import { getAccessToken } from '@/lib/authSession';
import { httpImage } from '@/lib/inventoryRegistration';
import {INVENTORY_IMAGE_LIMIT,validateInventoryImageFile,validateInventoryImageDimensions,uploadedInventoryImage,inventoryImagesReady} from '@/lib/inventoryImages';
import {Button} from '@/components/ui/button';
import {Upload} from 'lucide-react';
import {CustomerDialog,CustomerImagePreview} from '../CustomerMediaUI';

const MAX_IMAGES = INVENTORY_IMAGE_LIMIT;
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function InventoryImagePicker({ reservationId, value = [], disabled = false, onChange, onReady = () => {}, onError }) {
  const [images, setImages] = useState(() => value.filter(httpImage).map((secureUrl, index) => ({ id: `existing-${index}-${secureUrl}`, secureUrl, status: 'attached', legacy: true })));
  const [preview,setPreview]=useState(null),[discard,setDiscard]=useState(null);
  const discardBusy=useRef(false),picker=useRef(null);
  async function confirmDiscard(){if(discardBusy.current||!discard)return;discardBusy.current=true;const image=discard;setDiscard(null);try{await remove(image);}finally{discardBusy.current=false;requestAnimationFrame(()=>{if(mounted.current&&!disabled)picker.current?.focus();});}}
  const [expired,setExpired]=useState(false);
  const [notice, setNotice] = useState('');
  const [dragging,setDragging]=useState(false);
  const dragDepth=useRef(0);
  const canAdd=!disabled&&!!reservationId&&images.length<MAX_IMAGES;
  useEffect(()=>{if(!canAdd){dragDepth.current=0;setDragging(false);}},[canAdd]);
  const hasImageFiles=event=>Array.from(event.dataTransfer.items||[]).some(item=>item.kind==='file'&&['image/jpeg','image/png','image/webp'].includes(item.type));
  function dragEnter(event){event.preventDefault();event.stopPropagation();dragDepth.current++;if(canAdd&&hasImageFiles(event))setDragging(true);}
  function dragOver(event){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=canAdd?'copy':'none';}
  function dragLeave(event){event.preventDefault();event.stopPropagation();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}
  function drop(event){event.preventDefault();event.stopPropagation();dragDepth.current=0;setDragging(false);if(!disabled&&reservationId)handleFilesSelected(event.dataTransfer.files);}
  const controllers = useRef(new Map());
  const imagesRef = useRef(images);
  const mounted = useRef(true);
  imagesRef.current = images;
  useEffect(()=>{const timer=setInterval(()=>{onReady?.(inventoryImagesReady(imagesRef.current));setExpired(imagesRef.current.some(image=>image.status==='uploaded'&&Date.parse(image.expiresAt)<=Date.now()));},1000);return()=>clearInterval(timer);},[onReady]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controllers.current.forEach(controller => controller.abort());
      for (const image of imagesRef.current) if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    };
  }, []);

  function commit(next) {
    if (!mounted.current) return;
    setImages(next);
    imagesRef.current = next;
    onChange(next.filter(image=>['attached','uploaded'].includes(image.status)).map(image => image.secureUrl).filter(Boolean));
    onReady?.(inventoryImagesReady(next));
  }

  async function upload(image) {
    if (disabled || !image.file || !reservationId || !mounted.current || controllers.current.has(image.id) || !getAccessToken()) return;
    const controller = new AbortController();
    controllers.current.set(image.id, controller);
    const token = getAccessToken();
    const key = image.idempotencyKey || makeId();
    commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'uploading', progress: 0, error: '', idempotencyKey: key } : entry));
    try {
      validateInventoryImageFile(image.file);
      const bitmap=await createImageBitmap(image.file);
      try{validateInventoryImageDimensions(bitmap.width,bitmap.height);}finally{bitmap.close();}
      if(controller.signal.aborted||getAccessToken()!==token)throw Error('Upload cancelled or session changed.');
      if(!mounted.current||!imagesRef.current.some(entry=>entry.id===image.id))return;
      const response = await inventoryApi.uploadImage(image.file, reservationId, {
        signal: controller.signal,
        idempotencyKey: key,
        onUploadProgress: event => {if(mounted.current&&!controller.signal.aborted&&getAccessToken()===token)commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, progress: event.total ? Math.round(event.loaded * 100 / event.total) : 0 } : entry));},
      });
      if (getAccessToken() !== token) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Session changed during upload. Confirm the current account, then retry.' } : entry));
        return;
      }
      const uploaded = uploadedInventoryImage(response);
      commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, ...uploaded, status: 'uploaded', progress: 100, error: '' } : entry));
    } catch (error) {
      if (getAccessToken() !== token) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Session changed during upload. Confirm the current account, then retry.' } : entry));
      } else if (controller.signal.aborted) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Upload cancelled. Retry or remove this image.' } : entry));
      } else if (getAccessToken() === token) {
        const message = error?.response?.data?.message || (error?.response?.status===429?'Upload quota or request limit reached. Remove unused uploads or wait before retrying.':error?.message) || 'Image upload failed.';
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'failed', error: String(message).slice(0, 250) } : entry));
      }
    } finally { controllers.current.delete(image.id); }
  }

  function choose(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    handleFilesSelected(files);
  }

  function handleFilesSelected(fileList) {
    if(disabled||!reservationId)return;
    setNotice('');
    const files=Array.from(fileList||[]);
    const available = MAX_IMAGES - imagesRef.current.length;
    if (files.length > available) setNotice(`You can add ${Math.max(available, 0)} more image(s); the limit is 10.`);
    const fingerprints=new Set(imagesRef.current.filter(image=>image.file).map(image=>JSON.stringify([image.file.name,image.file.size,image.file.lastModified])));
    const selected = files.slice(0, Math.max(available, 0)).filter(file=>{try{validateInventoryImageFile(file);return true;}catch(error){setNotice(error.message);return false;}}).filter(file=>{const key=JSON.stringify([file.name,file.size,file.lastModified]);if(fingerprints.has(key)){setNotice('This file is already selected. Retry its existing upload instead.');return false;}fingerprints.add(key);return true;});
    const next = [...imagesRef.current, ...selected.map(file => ({ id: makeId(), file, previewUrl: URL.createObjectURL(file), status: 'queued', progress: 0, secureUrl: '', idempotencyKey: makeId() }))];
    commit(next);
    for (const entry of next.filter(image => selected.includes(image.file))) void upload(entry);
  }

  async function remove(image) {
    if(disabled||controllers.current.has(image.id)||image.status==='removing')return;
    const token=getAccessToken();
    if(!token)return;
    commit(imagesRef.current.map(entry=>entry.id===image.id?{...entry,status:'removing'}:entry));
    controllers.current.get(image.id)?.abort();
    if (image.uploadId) {
      try { const response=await inventoryApi.removeImageUpload(image.uploadId);if(response?.data?.success!==true)throw Error('Discard was not confirmed.'); }
      catch (error) { if(mounted.current&&getAccessToken()===token){commit(imagesRef.current.map(entry=>entry.id===image.id?image:entry));setNotice(error?.response?.data?.message || 'Could not discard this unused upload. Retry removal.');} return; }
    }
    if(!mounted.current||getAccessToken()!==token)return;
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setPreview(null);
    commit(imagesRef.current.filter(entry => entry.id !== image.id));
    setNotice(image.legacy?'Image marked for removal from this Item. Save changes to persist.':'Unused image removed; Backend handles deferred cleanup.');
  }

  function move(index, delta) {
    if(disabled)return;
    const target = index + delta;
    if (target < 0 || target >= imagesRef.current.length) return;
    const next = [...imagesRef.current]; [next[index], next[target]] = [next[target], next[index]]; commit(next);
  }

  return <section aria-label="Inventory item images" className="space-y-3">
    <div aria-label="Image upload drop zone" onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop} className={`rounded-xl border-2 border-dashed p-3 focus-within:ring-2 focus-within:ring-emerald-600 ${dragging?'border-emerald-600 bg-emerald-50':'border-emerald-200 bg-white'}`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-800" role="status"><Upload size={18} aria-hidden="true"/>{dragging?'Drop images to upload':'Drag & drop images here'}</p>
      <div className="flex flex-wrap items-center gap-3">
      <input ref={picker} className="max-w-full rounded-lg border border-emerald-200 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-emerald-800" aria-label="Choose item images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || images.length >= MAX_IMAGES || !reservationId} onChange={choose}/>
      <span className="text-sm text-slate-600">{images.length}/{MAX_IMAGES} images · JPEG, PNG, WebP · max 8 MiB each</span>
      </div>
    </div>
    <p className="text-sm text-slate-500">Upload first, then save the Item to attach images. Maximum 6000 px per side / 24 MP. Backend validates image contents and single-frame format. Uploaded photos use public delivery URLs; use non-sensitive development photos only.</p>
    {notice && <p role="status" className="text-sm text-amber-700">{notice}</p>}
    {expired&&<p role="alert" className="text-sm text-amber-700">An unused upload has expired. Remove it and select the file again before saving.</p>}
    {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image, index) => <article key={image.id} className="rounded-xl border p-2">
        <button type="button" className="w-full" aria-label={`Preview item image ${index+1}`} onClick={()=>setPreview(image.previewUrl||image.secureUrl)}><img src={image.previewUrl || image.secureUrl} alt={`Item image ${index + 1}`} loading="lazy" decoding="async" className="h-32 w-full rounded-lg bg-slate-100 object-contain" onError={event => { event.currentTarget.alt='Image preview unavailable'; event.currentTarget.onerror=null; }}/></button>
        {image.file&&<p className="mt-2 break-all text-xs text-slate-600">{image.file.name}</p>}
        {image.status === 'uploading' && <div className="mt-2" aria-live="polite"><progress className="w-full" max="100" value={image.progress || 0}/><span className="text-xs">Uploading {image.progress || 0}%</span><button type="button" className="ml-2 underline" disabled={disabled} onClick={() => controllers.current.get(image.id)?.abort()}>Cancel</button></div>}
        {['queued','failed','cancelled'].includes(image.status) && <div className="mt-2"><span className="text-xs">{image.status === 'queued' ? 'Waiting to upload' : image.error}</span><button type="button" className="ml-2 underline" onClick={() => void upload(image)}>Retry upload</button></div>}
        {image.status === 'attached' && <p className="mt-2 text-xs text-emerald-700">Attached · persisted on Item</p>}
        {image.status === 'removing' && <p className="mt-2 text-xs text-amber-700">Removing…</p>}
        {image.status === 'uploaded' && <p className="mt-2 break-all text-xs text-amber-700">Uploaded · UNATTACHED · Save Item to attach{image.width && image.height ? ` · ${image.width}×${image.height}` : ''}<br/>Expires: {new Date(image.expiresAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p>}
        <div className="customer-image-actions mt-2 flex justify-between gap-1">
          <button type="button" aria-label={`Move image ${index + 1} earlier`} disabled={disabled || index === 0} onClick={() => move(index,-1)}>↑</button>
          <button type="button" aria-label={`Move image ${index + 1} later`} disabled={disabled || index === images.length - 1} onClick={() => move(index,1)}>↓</button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Remove image ${index + 1}`} disabled={disabled||['uploading','removing'].includes(image.status)} onClick={() => image.uploadId ? setDiscard(image) : void remove(image)}>Remove</Button>
        </div>
      </article>)}
    </div>}
    {preview&&<CustomerImagePreview title="Item image preview" images={images.map(image=>image.previewUrl||image.secureUrl).filter(Boolean)} selectedUrl={preview} onClose={()=>setPreview(null)}/>}
    {discard&&<CustomerDialog title="Discard unused upload?" description="This removes the unused upload from this form and asks the server to discard it. Saved Item images are not deleted through this action." onClose={()=>setDiscard(null)}><div className="customer-confirm-actions"><Button type="button" variant="outline" onClick={()=>setDiscard(null)}>Keep image</Button><Button type="button" variant="orange" onClick={confirmDiscard}>Discard unused upload</Button></div></CustomerDialog>}
  </section>;
}
