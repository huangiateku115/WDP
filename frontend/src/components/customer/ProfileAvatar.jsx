import {useEffect, useRef, useState} from 'react';
import {Camera, LoaderCircle, UserRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {getAccessToken} from '@/lib/authSession';
import {cloudinaryConfig, isApprovedAvatarUrl, uploadAvatar, validateAvatarFile} from '@/lib/cloudinary';

// No URL field is mapped until the Backend exposes a confirmed avatar contract.
export default function ProfileAvatar({enabled, sessionToken, savedUrl = ''}) {
  const input = useRef(null), request = useRef(null), busy = useRef(false), mounted = useRef(true);
  const [file, setFile] = useState(null), [preview, setPreview] = useState(''), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [uploaded, setUploaded] = useState(null), [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; request.current?.abort();};}, []);
  useEffect(() => {
    if (!file) {setPreview(''); return;}
    const url = URL.createObjectURL(file); setPreview(url); setImageFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {setImageFailed(false);}, [savedUrl]);
  const current = () => mounted.current && getAccessToken() === sessionToken;
  function select(event) {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected || busy.current || !enabled) return;
    setError('');
    try {validateAvatarFile(selected); setFile(selected); setUploaded(null);} catch (err) {setError(err.message);}
  }
  function cancel() {
    request.current?.abort(); setFile(null); setUploaded(null); setError(''); setImageFailed(false);
  }
  async function upload() {
    if (!file || busy.current || !enabled || !current()) return;
    busy.current = true; setPending(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await uploadAvatar(file, {signal:controller.signal});
      if (current() && !controller.signal.aborted) setUploaded(result);
    } catch (err) {if (current() && !controller.signal.aborted) setError(err.message);}
    finally {busy.current = false; if (current()) setPending(false);}
  }
  let configured = true;
  try {cloudinaryConfig();} catch {configured = false;}
  const source = preview || (isApprovedAvatarUrl(savedUrl) ? savedUrl : '');
  return <div className="space-y-3">
    <div className="relative mx-auto w-24">
      <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-[#EAF5EE] text-[#176B3A]">
        {source && !imageFailed ? <img src={source} alt={preview ? 'Selected avatar preview' : 'Profile avatar'} className="h-full w-full object-cover" onError={() => setImageFailed(true)}/> : <UserRound size={40}/>}
      </div>
      <Button type="button" size="icon" variant="orange" className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full border-2 border-white" aria-label="Choose avatar image" disabled={!enabled || pending} onClick={() => input.current?.click()}><Camera size={15}/></Button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="Avatar image file" className="sr-only" tabIndex={-1} disabled={!enabled || pending} onChange={select}/>
    </div>
    <p className="text-xs text-slate-500">JPG, PNG or WebP · up to 2 MB</p>
    {file && <div className="space-y-3 rounded-xl border border-green-100 bg-[#F3F8F4] p-3 text-left">
      <p className="text-xs text-slate-600">Avatar saving is not available yet. Uploading stores an image on Cloudinary only; it will not update your account.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="orange" disabled={!enabled || pending || !!uploaded || !configured} onClick={upload}>{pending ? <><LoaderCircle size={14} className="animate-spin"/>Uploading…</> : 'Upload image'}</Button>
        <Button type="button" size="sm" variant="outline" onClick={cancel}>{pending ? 'Cancel upload' : 'Cancel'}</Button>
        <Button type="button" size="sm" disabled title="Backend avatar persistence is not supported yet">Save avatar</Button>
      </div>
      {!configured && <p role="alert" className="text-xs text-red-700">Avatar upload is not configured. Please contact support.</p>}
      {uploaded && <p role="status" className="text-xs text-[#176B3A]">Image uploaded to Cloudinary. Your profile avatar has not been saved. Cancel restores your previous avatar.</p>}
    </div>}
    {pending && <p role="status" className="text-xs text-slate-600">Uploading image to Cloudinary…</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
