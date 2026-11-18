import { useEffect, useState } from "react";
import { Button, Input } from "@/components/manager/ManagerUI";
import { capability } from "@/lib/backendCapabilities";

// Facility / storage-unit / managed-zone photography is stored by the backend as a list of
// absolute HTTP(S) URLs (see backend/src/utils/image-url.ts). The console therefore edits
// that list: preview, ordering (= "cover" is always the first URL), removal. File upload is
// gated by BACKEND_CAPABILITIES because no upload endpoint exists yet; once it does, only
// this dialog gains a file picker and the saved value is still the same URL list.
const MAX_IMAGES = 10;

export const isHttpImage = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

const trimmed = (list) => (Array.isArray(list) ? list.map((url) => String(url ?? "").trim()) : []);

export function ImageEditor({ label, images = [], onChange, hint, target }) {
  const list = trimmed(images);
  const upload = target ? capability(target === "storage-unit" ? "storageUnitImageUpload" : "facilityImageUpload") : null;
  const update = (next) => onChange?.(next);
  const setAt = (index, value) => update(list.map((url, i) => (i === index ? value : url)));
  const move = (index, delta) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    const next = [...list];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    update(next);
  };
  const remove = (index) => update(list.filter((_, i) => i !== index));

  return (
    <div className="manager-field">
      <span>{label}</span>
      <small>{hint || `Không bắt buộc. Tối đa ${MAX_IMAGES} ảnh; ảnh đầu tiên là ảnh bìa.`}</small>
      <div className="mt-3 space-y-2">
        {list.map((url, index) => {
          const invalid = Boolean(url) && !isHttpImage(url);
          return (
            <div key={index} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <ImagePreview src={url} index={index} />
                <div className="min-w-[240px] flex-1">
                  <Input
                    aria-label={`URL ảnh ${index + 1}`}
                    placeholder="https://res.cloudinary.com/..."
                    value={url}
                    onChange={(event) => setAt(index, event.target.value)}
                  />
                  {invalid && <small role="alert" className="mt-1 block text-xs text-red-700">URL phải bắt đầu bằng http:// hoặc https://.</small>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {index > 0 && <Button type="button" size="sm" variant="outline" onClick={() => move(index, -1)} aria-label={`Đưa ảnh ${index + 1} lên`}>Lên</Button>}
                  {index < list.length - 1 && <Button type="button" size="sm" variant="outline" onClick={() => move(index, 1)} aria-label={`Đưa ảnh ${index + 1} xuống`}>Xuống</Button>}
                  {index > 0 && <Button type="button" size="sm" variant="outline" onClick={() => move(index, -index)}>Đặt làm ảnh bìa</Button>}
                  <Button type="button" size="sm" variant="outline" onClick={() => remove(index)}>Gỡ</Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">{index === 0 ? "Ảnh bìa" : `Ảnh ${index + 1}`}</p>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3">
          {list.length < MAX_IMAGES && (
            <Button type="button" variant="outline" onClick={() => update([...list, ""])}>Thêm URL ảnh</Button>
          )}
          {upload && (
            <Button type="button" variant="outline" disabled={!upload.ready} title={upload.reason || undefined}>
              Tải ảnh từ máy
            </Button>
          )}
          {list.length >= MAX_IMAGES && <small>Đã đạt tối đa {MAX_IMAGES} ảnh.</small>}
        </div>
        {upload && !upload.ready && <small>{upload.reason}</small>}
      </div>
    </div>
  );
}

function ImagePreview({ src, index }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!isHttpImage(src) || failed) {
    return <span className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">Chưa có ảnh</span>;
  }
  return <img src={src} alt={`Ảnh ${index + 1}`} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-16 w-24 rounded-lg border border-slate-200 object-cover" />;
}

export { MAX_IMAGES };
