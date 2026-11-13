import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from './InventoryBackendUI';
import { getAccessToken } from '@/lib/authSession';
import { httpImage } from '@/lib/inventoryRegistration';
import {INVENTORY_IMAGE_LIMIT,validateInventoryImageFile,validateInventoryImageDimensions,uploadedInventoryImage,inventoryImagesReady} from '@/lib/inventoryImages';
import {Button} from '@/components/ui/button';
import {Upload} from 'lucide-react';
import {CustomerDialog,CustomerImagePreview} from '../CustomerMediaUI';
import {formatInventoryDateTime} from './inventoryUiFormat';

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
      if(controller.signal.aborted||getAccessToken()!==token)throw Error('Đã hủy tải ảnh hoặc phiên đăng nhập đã thay đổi.');
      if(!mounted.current||!imagesRef.current.some(entry=>entry.id===image.id))return;
      const response = await inventoryApi.uploadImage(image.file, reservationId, {
        signal: controller.signal,
        idempotencyKey: key,
        onUploadProgress: event => {if(mounted.current&&!controller.signal.aborted&&getAccessToken()===token)commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, progress: event.total ? Math.round(event.loaded * 100 / event.total) : 0 } : entry));},
      });
      if (getAccessToken() !== token) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Phiên đăng nhập đã đổi khi tải ảnh. Kiểm tra tài khoản hiện tại rồi thử lại.' } : entry));
        return;
      }
      const uploaded = uploadedInventoryImage(response);
      commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, ...uploaded, status: 'uploaded', progress: 100, error: '' } : entry));
    } catch (error) {
      if (getAccessToken() !== token) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Phiên đăng nhập đã đổi khi tải ảnh. Kiểm tra tài khoản hiện tại rồi thử lại.' } : entry));
      } else if (controller.signal.aborted) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Đã hủy tải ảnh. Bạn có thể thử lại hoặc xóa ảnh.' } : entry));
      } else if (getAccessToken() === token) {
        const message = error?.response?.data?.message || (error?.response?.status===429?'Đã đạt giới hạn tải ảnh. Hãy xóa ảnh tải lên chưa dùng hoặc đợi rồi thử lại.':'Không thể tải ảnh lên. Vui lòng thử lại.');
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
    if (files.length > available) setNotice(`Bạn có thể thêm tối đa ${Math.max(available, 0)} ảnh nữa; giới hạn là 10 ảnh.`);
    const fingerprints=new Set(imagesRef.current.filter(image=>image.file).map(image=>JSON.stringify([image.file.name,image.file.size,image.file.lastModified])));
    const selected = files.slice(0, Math.max(available, 0)).filter(file=>{try{validateInventoryImageFile(file);return true;}catch(error){setNotice(error.message);return false;}}).filter(file=>{const key=JSON.stringify([file.name,file.size,file.lastModified]);if(fingerprints.has(key)){setNotice('Ảnh này đã được chọn. Hãy thử tải lại ảnh hiện có.');return false;}fingerprints.add(key);return true;});
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
      try { const response=await inventoryApi.removeImageUpload(image.uploadId);if(response?.data?.success!==true)throw Error('Máy chủ chưa xác nhận xóa ảnh tải lên.'); }
      catch (error) { if(mounted.current&&getAccessToken()===token){commit(imagesRef.current.map(entry=>entry.id===image.id?image:entry));setNotice(error?.response?.data?.message || 'Chưa thể xóa ảnh tải lên chưa sử dụng. Vui lòng thử lại.');} return; }
    }
    if(!mounted.current||getAccessToken()!==token)return;
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setPreview(null);
    commit(imagesRef.current.filter(entry => entry.id !== image.id));
    setNotice(image.legacy?'Ảnh được đánh dấu để gỡ khỏi mặt hàng. Hãy lưu thay đổi để hoàn tất.':'Đã gỡ ảnh chưa sử dụng; hệ thống sẽ xử lý dọn dẹp.');
  }

  function move(index, delta) {
    if(disabled)return;
    const target = index + delta;
    if (target < 0 || target >= imagesRef.current.length) return;
    const next = [...imagesRef.current]; [next[index], next[target]] = [next[target], next[index]]; commit(next);
  }

  return <section aria-label="Inventory item images" className="space-y-3">
    <div aria-label="Khu vực tải ảnh mặt hàng" onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop} className={`rounded-xl border-2 border-dashed p-3 focus-within:ring-2 focus-within:ring-emerald-600 ${dragging?'border-emerald-600 bg-emerald-50':'border-emerald-200 bg-white'}`}>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-800" role="status"><Upload size={18} aria-hidden="true"/>{dragging?'Thả ảnh vào đây để tải lên':'Kéo thả ảnh vào đây'}</p>
      <div className="flex flex-wrap items-center gap-3">
      <input ref={picker} className="max-w-full rounded-lg border border-emerald-200 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-emerald-800" aria-label="Chọn ảnh mặt hàng" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || images.length >= MAX_IMAGES || !reservationId} onChange={choose}/>
      <span className="text-sm text-slate-600">{images.length}/{MAX_IMAGES} ảnh · JPEG, PNG, WebP · tối đa 8 MiB/ảnh</span>
      </div>
    </div>
    <p className="text-sm text-slate-500">Ảnh được tải lên trước, sau đó gắn vào mặt hàng khi bạn lưu. Kích thước tối đa 6.000 px mỗi chiều / 24 MP. Hệ thống kiểm tra định dạng và nội dung ảnh. Ảnh dùng đường dẫn phân phối công khai; chỉ tải ảnh không chứa thông tin nhạy cảm.</p>
    {notice && <p role="status" className="text-sm text-amber-700">{notice}</p>}
    {expired&&<p role="alert" className="text-sm text-amber-700">An unused upload has expired. Remove it and select the file again before saving.</p>}
    {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image, index) => <article key={image.id} className="rounded-xl border p-2">
        <button type="button" className="w-full" aria-label={`Preview item image ${index+1}`} onClick={()=>setPreview(image.previewUrl||image.secureUrl)}><img src={image.previewUrl || image.secureUrl} alt={`Item image ${index + 1}`} loading="lazy" decoding="async" className="h-32 w-full rounded-lg bg-slate-100 object-contain" onError={event => { event.currentTarget.alt='Image preview unavailable'; event.currentTarget.onerror=null; }}/></button>
        {image.file&&<p className="mt-2 break-all text-xs text-slate-600">{image.file.name}</p>}
        {image.status === 'uploading' && <div className="mt-2" aria-live="polite"><progress className="w-full" max="100" value={image.progress || 0}/><span className="text-xs">Đang tải lên {image.progress || 0}%</span><button type="button" className="ml-2 underline" disabled={disabled} onClick={() => controllers.current.get(image.id)?.abort()}>Hủy</button></div>}
        {['queued','failed','cancelled'].includes(image.status) && <div className="mt-2"><span className="text-xs">{image.status === 'queued' ? 'Đang chờ tải lên' : image.error}</span><button type="button" className="ml-2 underline" onClick={() => void upload(image)}>Thử tải lại</button></div>}
        {image.status === 'attached' && <p className="mt-2 text-xs text-emerald-700">Đã gắn vào mặt hàng và lưu thành công</p>}
        {image.status === 'removing' && <p className="mt-2 text-xs text-amber-700">Đang xóa…</p>}
        {image.status === 'uploaded' && <p className="mt-2 break-all text-xs text-amber-700">Đã tải lên · Chưa gắn vào mặt hàng · Hãy lưu để gắn{image.width && image.height ? ` · ${image.width}×${image.height}` : ''}<br/>Hết hạn: {formatInventoryDateTime(image.expiresAt)}</p>}
        <div className="customer-image-actions mt-2 flex justify-between gap-1">
          <button type="button" aria-label={`Move image ${index + 1} earlier`} disabled={disabled || index === 0} onClick={() => move(index,-1)}>↑</button>
          <button type="button" aria-label={`Move image ${index + 1} later`} disabled={disabled || index === images.length - 1} onClick={() => move(index,1)}>↓</button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Xóa ảnh ${index + 1}`} disabled={disabled||['uploading','removing'].includes(image.status)} onClick={() => image.uploadId ? setDiscard(image) : void remove(image)}>Xóa</Button>
        </div>
      </article>)}
    </div>}
    {preview&&<CustomerImagePreview title="Xem ảnh mặt hàng" images={images.map(image=>image.previewUrl||image.secureUrl).filter(Boolean)} selectedUrl={preview} onClose={()=>setPreview(null)}/>}
    {discard&&<CustomerDialog title="Xóa ảnh tải lên chưa dùng?" description="Ảnh chưa sử dụng sẽ được gỡ khỏi biểu mẫu và gửi yêu cầu dọn dẹp. Thao tác này không xóa ảnh đã lưu trên mặt hàng." onClose={()=>setDiscard(null)}><div className="customer-confirm-actions"><Button type="button" variant="outline" onClick={()=>setDiscard(null)}>Giữ ảnh</Button><Button type="button" variant="orange" onClick={confirmDiscard}>Xóa ảnh chưa dùng</Button></div></CustomerDialog>}
  </section>;
}
