// Frontend-only facility gallery uploads.
//
// Cloudinary unsigned upload is deliberately called with `fetch` instead of the shared
// `axiosClient`: the Backend access token must never be sent to a third-party origin, and the
// Backend contract only accepts HTTP(S) image URLs on the facility document.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const FACILITY_IMAGE_LIMIT = 10;
export const FACILITY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export function validateFacilityImageFile(file) {
  if (!file) throw Error("Choose an image file.");
  if (!ALLOWED_TYPES.has(file.type)) throw Error(`${file.name || "This file"} must be a JPG, PNG or WebP image.`);
  if (!file.size) throw Error(`${file.name || "This file"} is empty.`);
  if (file.size > FACILITY_IMAGE_MAX_BYTES) throw Error(`${file.name || "This file"} is larger than 8 MB.`);
}

export function cloudinaryFacilityConfig(env = import.meta.env) {
  const cloudName = String(env?.VITE_CLOUDINARY_CLOUD_NAME || "").trim();
  const uploadPreset = String(env?.VITE_CLOUDINARY_UPLOAD_PRESET || "").trim();
  if (!cloudName || !/^[a-zA-Z0-9_-]+$/.test(cloudName) || !uploadPreset) {
    throw Error("Image upload is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.");
  }
  return { cloudName, uploadPreset };
}

export function isApprovedFacilityImageUrl(value, cloudName = import.meta.env?.VITE_CLOUDINARY_CLOUD_NAME?.trim()) {
  try {
    const url = new URL(value);
    return Boolean(cloudName) &&
      url.protocol === "https:" &&
      url.hostname === "res.cloudinary.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/${cloudName}/image/upload/`);
  } catch {
    return false;
  }
}

/** Splits a FileList/array into uploadable files and human-readable validation errors. */
export function planFacilityImageUploads(fileList, existingCount = 0) {
  const accepted = [];
  const errors = [];
  for (const file of Array.from(fileList || [])) {
    if (existingCount + accepted.length >= FACILITY_IMAGE_LIMIT) {
      errors.push(`At most ${FACILITY_IMAGE_LIMIT} facility images are allowed.`);
      break;
    }
    try {
      validateFacilityImageFile(file);
      accepted.push(file);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { accepted, errors };
}

export async function uploadFacilityImage(file, { signal, onProgress } = {}) {
  validateFacilityImageFile(file);
  const { cloudName, uploadPreset } = cloudinaryFacilityConfig();
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", uploadPreset);
  if (signal?.aborted) throw Error("Image upload was cancelled.");
  return new Promise((resolve, reject) => {
    // XMLHttpRequest instead of fetch: only XHR reports upload progress percentages.
    const request = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      request.upload.onprogress = null;
      request.onload = null;
      request.onerror = null;
      request.ontimeout = null;
      request.onabort = null;
    };
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle(value);
    };
    const abort = () => request.abort();
    request.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, true);
    request.withCredentials = false;
    request.timeout = 60000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(100, Math.round((event.loaded * 100) / event.total)));
    };
    request.onload = () => {
      let result = null;
      try { result = JSON.parse(request.responseText); } catch { result = null; }
      if (request.status < 200 || request.status >= 300) {
        return finish(reject, Error(request.status === 429
          ? "Too many upload attempts. Please wait a moment and try again."
          : "Cloudinary could not upload this image. Check the image and the unsigned upload preset, then try again."));
      }
      if (!isApprovedFacilityImageUrl(result?.secure_url, cloudName) || typeof result?.public_id !== "string" || !result.public_id.trim()) {
        return finish(reject, Error("Cloudinary returned an invalid image response. No facility image was added."));
      }
      onProgress?.(100);
      finish(resolve, { secureUrl: result.secure_url, publicId: result.public_id });
    };
    request.onerror = () => finish(reject, Error("Cannot connect to Cloudinary. Check your connection and try again."));
    request.ontimeout = () => finish(reject, Error("Image upload timed out. Please try again."));
    request.onabort = () => finish(reject, Error("Image upload was cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    request.send(body);
  });
}

/* ----------------------- Reload-safe unsaved uploads ----------------------- */

// Uploaded-but-unsaved facility images live in sessionStorage so a page reload (or an
// accidental navigation back to the form) does not silently drop them. Only URLs are stored.
export const FACILITY_IMAGE_DRAFT_PREFIX = "wdp.facility-images.";

const storageOrNull = (storage) => {
  if (storage !== undefined) return storage;
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
};

export function facilityDraftKey(facilityId) {
  return `${FACILITY_IMAGE_DRAFT_PREFIX}${facilityId || "new"}`;
}

export function readFacilityImageDraft(key, storage) {
  try {
    const raw = storageOrNull(storage)?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value) => typeof value === "string" && value.trim() && value.length <= 2048).map((value) => value.trim())
      : [];
  } catch { return []; }
}

export function writeFacilityImageDraft(key, urls, storage) {
  try {
    const target = storageOrNull(storage);
    if (!target) return;
    const clean = Array.from(new Set((urls || []).filter((value) => typeof value === "string" && value.trim())));
    if (!clean.length) target.removeItem(key);
    else target.setItem(key, JSON.stringify(clean));
  } catch { /* private mode or full quota: the form still works, it just will not survive a reload */ }
}

export function mergeFacilityImages(serverImages = [], draftUrls = []) {
  const merged = [];
  for (const value of [...serverImages, ...draftUrls]) {
    const url = typeof value === "string" ? value.trim() : "";
    if (url && !merged.includes(url)) merged.push(url);
  }
  return merged.slice(0, FACILITY_IMAGE_LIMIT);
}
