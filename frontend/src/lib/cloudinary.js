const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function validateAvatarFile(file) {
  if (!file || !allowedTypes.has(file.type)) throw Error('Choose a JPG, JPEG, PNG or WebP image.');
  if (!file.size || file.size > MAX_AVATAR_BYTES) throw Error('Choose an image smaller than or equal to 2 MB.');
}

export function cloudinaryConfig() {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET?.trim();
  if (!cloudName || !/^[a-zA-Z0-9_-]+$/.test(cloudName) || !uploadPreset) {
    throw Error('Avatar upload is not configured. Please contact support.');
  }
  return {cloudName, uploadPreset};
}

export function isApprovedAvatarUrl(value, cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME?.trim()) {
  try {
    const url = new URL(value);
    return !!cloudName && url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && !url.port && !url.username && !url.password && url.pathname.startsWith(`/${cloudName}/image/upload/`);
  } catch { return false; }
}

// Intentionally independent of the authenticated Backend client: never send its token to Cloudinary.
export async function uploadAvatar(file, {signal} = {}) {
  validateAvatarFile(file);
  const {cloudName, uploadPreset} = cloudinaryConfig();
  const body = new FormData();
  body.append('file', file);
  body.append('upload_preset', uploadPreset);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => {timedOut = true; controller.abort();}, 60000);
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {method:'POST', body, signal:controller.signal, credentials:'omit'});
    const result = await response.json().catch(() => null);
    if (!response.ok) throw Error(response.status === 429 ? 'Too many upload attempts. Please try again later.' : 'Cloudinary could not upload this image. Check the image and unsigned upload configuration, then try again.');
    if (!isApprovedAvatarUrl(result?.secure_url, cloudName) || typeof result?.public_id !== 'string' || !result.public_id.trim()) throw Error('Cloudinary returned an invalid image response. No avatar was saved.');
    return {secure_url:result.secure_url, public_id:result.public_id};
  } catch (error) {
    if (timedOut) throw Error('Image upload timed out. Please try again.');
    if (error.name === 'TypeError') throw Error('Cannot connect to Cloudinary. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
