import { useEffect, useRef, useState } from 'react';
import { inventoryApi } from './InventoryBackendUI';
import { getAccessToken } from '@/lib/authSession';
import { httpImage } from '@/lib/inventoryRegistration';

const MAX_IMAGES = 10;
const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export default function InventoryImagePicker({ reservationId, value = [], disabled = false, onChange, onReady = () => {}, onError }) {
  const [images, setImages] = useState(() => value.filter(httpImage).map((secureUrl, index) => ({ id: `existing-${index}-${secureUrl}`, secureUrl, status: 'uploaded', legacy: true })));
  const [notice, setNotice] = useState('');
  const controllers = useRef(new Map());
  const imagesRef = useRef(images);
  const mounted = useRef(true);
  imagesRef.current = images;

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
    onChange(next.map(image => image.secureUrl).filter(Boolean));
    onReady?.(next.every(image => image.status === 'uploaded'));
  }

  async function upload(image) {
    if (!image.file || !reservationId) return;
    const controller = new AbortController();
    controllers.current.set(image.id, controller);
    const token = getAccessToken();
    const key = image.idempotencyKey || makeId();
    commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'uploading', progress: 0, error: '', idempotencyKey: key } : entry));
    try {
      const response = await inventoryApi.uploadImage(image.file, reservationId, {
        signal: controller.signal,
        idempotencyKey: key,
        onUploadProgress: event => commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, progress: event.total ? Math.round(event.loaded * 100 / event.total) : 0 } : entry)),
      });
      if (getAccessToken() !== token) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Session changed during upload. Confirm the current account, then retry.' } : entry));
        return;
      }
      const uploaded = response?.data?.success === true ? response.data.data : null;
      if (!uploaded || !httpImage(uploaded.secureUrl) || typeof uploaded.uploadId !== 'string' || typeof uploaded.publicId !== 'string') throw Error('Backend returned an invalid image upload result.');
      commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, ...uploaded, status: 'uploaded', progress: 100, error: '' } : entry));
    } catch (error) {
      if (getAccessToken() !== token) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Session changed during upload. Confirm the current account, then retry.' } : entry));
      } else if (controller.signal.aborted) {
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'cancelled', error: 'Upload cancelled. Retry or remove this image.' } : entry));
      } else if (getAccessToken() === token) {
        const message = error?.response?.data?.message || error?.message || 'Image upload failed.';
        commit(imagesRef.current.map(entry => entry.id === image.id ? { ...entry, status: 'failed', error: String(message).slice(0, 250) } : entry));
      }
    } finally { controllers.current.delete(image.id); }
  }

  function choose(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const available = MAX_IMAGES - imagesRef.current.length;
    if (files.length > available) setNotice(`You can add ${Math.max(available, 0)} more image(s); the limit is 10.`);
    const selected = files.slice(0, Math.max(available, 0));
    const next = [...imagesRef.current, ...selected.map(file => ({ id: makeId(), file, previewUrl: URL.createObjectURL(file), status: 'queued', progress: 0, secureUrl: '', idempotencyKey: makeId() }))];
    commit(next);
    for (const entry of next.filter(image => selected.includes(image.file))) void upload(entry);
  }

  async function remove(image) {
    controllers.current.get(image.id)?.abort();
    if (image.uploadId) {
      try { await inventoryApi.removeImageUpload(image.uploadId); }
      catch (error) { setNotice(error?.response?.data?.message || 'Could not remove this unused upload. Retry removal.'); return; }
    }
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    commit(imagesRef.current.filter(entry => entry.id !== image.id));
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= imagesRef.current.length) return;
    const next = [...imagesRef.current]; [next[index], next[target]] = [next[target], next[index]]; commit(next);
  }

  return <section aria-label="Inventory item images" className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <input aria-label="Choose item images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || images.length >= MAX_IMAGES || !reservationId} onChange={choose}/>
      <span className="text-sm text-slate-600">{images.length}/{MAX_IMAGES} images · JPEG, PNG, WebP · max 8 MiB each</span>
    </div>
    {notice && <p role="status" className="text-sm text-amber-700">{notice}</p>}
    {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((image, index) => <article key={image.id} className="rounded-xl border p-2">
        <img src={image.previewUrl || image.secureUrl} alt={`Item image ${index + 1}`} loading="lazy" decoding="async" className="h-32 w-full rounded-lg bg-slate-100 object-contain" onError={event => { event.currentTarget.alt='Image preview unavailable'; event.currentTarget.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%23e2e8f0%22/%3E%3Cpath d=%22M8 30l8-9 6 6 5-5 5 8H8z%22 fill=%22%2394a3b8%22/%3E%3C/svg%3E'; }}/>
        {image.status === 'uploading' && <div className="mt-2" aria-live="polite"><progress className="w-full" max="100" value={image.progress || 0}/><span className="text-xs">Uploading {image.progress || 0}%</span><button type="button" className="ml-2 underline" onClick={() => controllers.current.get(image.id)?.abort()}>Cancel</button></div>}
        {['queued','failed','cancelled'].includes(image.status) && <div className="mt-2"><span className="text-xs">{image.status === 'queued' ? 'Waiting to upload' : image.error}</span><button type="button" className="ml-2 underline" onClick={() => void upload(image)}>Retry upload</button></div>}
        {image.status === 'uploaded' && <p className="mt-2 break-all text-xs text-emerald-700">Uploaded{image.width && image.height ? ` · ${image.width}×${image.height}` : ' · Existing image'}</p>}
        <div className="mt-2 flex justify-between gap-1">
          <button type="button" aria-label={`Move image ${index + 1} earlier`} disabled={disabled || index === 0} onClick={() => move(index,-1)}>↑</button>
          <button type="button" aria-label={`Move image ${index + 1} later`} disabled={disabled || index === images.length - 1} onClick={() => move(index,1)}>↓</button>
          <button type="button" aria-label={`Remove image ${index + 1}`} disabled={disabled} onClick={() => void remove(image)}>Remove</button>
        </div>
      </article>)}
    </div>}
  </section>;
}
