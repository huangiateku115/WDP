import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { termsApi } from '@/api/termsApi';

const SERVICE_LABELS = { SELF_STORAGE: 'Self Storage', MANAGED_INVENTORY: 'Managed Inventory V3' };

function formatEffectiveDate(value) {
  if (!value) return 'Chưa xác định';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Chưa xác định' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export default function TermsModal({ open, onClose, serviceType = 'SELF_STORAGE', initialTerms = null, version = null }) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setError('');
    setLoading(Boolean(version || !initialTerms?.versionId));
    const load = async () => {
      if (!version && initialTerms?.versionId) {
        setDocument(initialTerms);
        return;
      }
      setLoading(true);
      try {
        const response = version
          ? await termsApi.version(serviceType, version)
          : await termsApi.current(serviceType);
        if (response.data?.success !== true || !response.data?.data?.versionId) throw new Error('Terms response is unavailable');
        if (active) setDocument(response.data.data);
      } catch {
        if (active) { setDocument(null); setError('Không thể tải điều khoản từ hệ thống. Vui lòng thử lại.'); }
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [open, serviceType, initialTerms?.versionId, version, retryKey]);

  if (!open) return null;
  const groups = Array.isArray(document?.groups) ? document.groups.filter(group => group?.appliesTo?.includes(serviceType) && Array.isArray(group?.sections?.[serviceType])) : [];
  return <Dialog title="Điều khoản & Chính sách" description={`Nội dung áp dụng cho ${SERVICE_LABELS[serviceType] || serviceType}. Việc xem không ghi nhận chấp nhận điều khoản.`} onClose={onClose} closeLabel="Đóng điều khoản" className="max-w-4xl p-4 sm:p-6">
    <div className="flex min-h-0 flex-col">
      {loading && <p role="status" className="py-8 text-center text-sm">Đang tải điều khoản…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><Button className="mt-3" type="button" variant="outline" onClick={() => setRetryKey(value => value + 1)}><RefreshCw size={16}/>Thử lại</Button></div>}
      {document && !loading && <>
        <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm">
          <p><strong>Mã tài liệu:</strong> {document.documentCode} <span aria-hidden="true">·</span> <strong>Phiên bản:</strong> {document.version}</p>
          <p className="mt-1"><strong>Dịch vụ:</strong> {SERVICE_LABELS[serviceType] || serviceType} <span aria-hidden="true">·</span> <strong>Hiệu lực từ:</strong> {formatEffectiveDate(document.effectiveFrom)}</p>
          {document.legalReviewStatus !== 'REVIEWED' && <p className="mt-2 text-xs text-amber-800">Tình trạng rà soát pháp lý: chưa được xác nhận.</p>}
        </div>
        <div className="max-h-[min(65dvh,42rem)] space-y-2 overflow-y-auto overscroll-contain pr-1" aria-label="Danh sách điều khoản P01 đến P18">
          {groups.map(group => <details key={group.id} className="group rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
              <span>{group.id} — {group.title}</span><ChevronDown aria-hidden="true" size={18} className="shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <ol className="list-decimal space-y-2 px-4 pb-4 pl-10 text-sm leading-6 text-slate-700">
              {group.sections[serviceType].map((clause, index) => <li key={`${group.id}-${index}`}>{clause}</li>)}
            </ol>
          </details>)}
          {!groups.length && <p role="alert" className="py-6 text-sm text-red-700">Dữ liệu điều khoản không đầy đủ cho dịch vụ này.</p>}
        </div>
      </>}
    </div>
  </Dialog>;
}
