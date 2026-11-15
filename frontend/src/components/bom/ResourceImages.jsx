import { useEffect, useState } from "react";

// Facility / storage-unit photography is stored by the backend as a list of absolute
// HTTP(S) URLs (facility.model.ts images, storage-unit.model.ts images). The console only
// ever renders those URLs: anything else is treated as "no image" so a malformed value can
// never reach an <img src> or break a table row.
const httpImage = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

export function ResourceThumb({ src, alt, size = "h-10 w-10" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!httpImage(src) || failed) return <span className="text-xs text-slate-400">—</span>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${size} rounded-lg border border-slate-200 object-cover`}
    />
  );
}

export function ResourceGallery({ images = [], alt = "Resource image" }) {
  const list = Array.isArray(images) ? images.filter(httpImage) : [];
  if (!list.length) return <p className="text-sm text-slate-500">Chưa lưu ảnh nào cho bản ghi này.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {list.map((url, index) => (
        <figure key={url} className="min-w-0">
          <a href={url} target="_blank" rel="noreferrer" className="block">
            <img
              src={url}
              alt={`${alt} ${index + 1}`}
              loading="lazy"
              decoding="async"
              className="h-32 w-full rounded-lg border border-slate-200 object-cover"
            />
          </a>
          <figcaption className="mt-1 truncate text-xs text-slate-500">
            {index === 0 ? "Ảnh bìa" : `Ảnh ${index + 1}`}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
