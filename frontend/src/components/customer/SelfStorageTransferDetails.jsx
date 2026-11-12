import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createPayosQrDataUrl } from "@/lib/selfStoragePayosQr";

export default function SelfStorageTransferDetails({ payment, expiresAt }) {
  const [qr, setQr] = useState(null);
  const [feedback, setFeedback] = useState("");
  const { id, qrCode, transferDetails, amount } = payment;

  useEffect(() => {
    let active = true;
    createPayosQrDataUrl(payment).then(url => {
      if (active && url) setQr({ id, payload: qrCode, url });
    }).catch(() => {
      if (active) setQr(null);
    });
    return () => { active = false; };
  }, [payment, id, qrCode]);

  async function copy(label, value) {
    try {
      await navigator.clipboard.writeText(String(value));
      setFeedback("Đã sao chép " + label.toLowerCase() + ".");
    } catch {
      setFeedback("Không thể sao chép tự động. Bạn có thể chọn và sao chép giá trị trên màn hình.");
    }
  }

  const image = qr?.id === id && qr.payload === qrCode ? qr.url : null;
  const fields = transferDetails ? [
    ["Mã ngân hàng (BIN)", transferDetails.bin],
    ["Chủ tài khoản", transferDetails.accountName],
    ["Số tài khoản", transferDetails.accountNumber, true],
    ["Số tiền (VND)", amount, true],
    ["Nội dung chuyển khoản", transferDetails.description, true],
  ] : [];

  return <section aria-label="Chuyển khoản qua VietQR" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
    <div className="grid gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      {image ? <img className="mx-auto w-full max-w-52 rounded-lg bg-white" src={image} alt="Mã VietQR do PayOS cung cấp" />
        : <p className="text-sm text-slate-700">{qrCode ? "Mã QR chưa hiển thị. Bạn có thể mở trang PayOS." : "Giao dịch chưa có mã QR. Bạn có thể mở trang PayOS."}</p>}
      <div className="min-w-0">
        <h2 className="font-semibold text-emerald-950">Chuyển khoản qua ứng dụng ngân hàng</h2>
        {fields.length > 0 ? <dl className="mt-3 space-y-3">{fields.map(([label, value, copyable]) =>
          <div key={label} className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0"><dt className="text-sm text-slate-600">{label}</dt><dd className="break-all font-medium">{value}</dd></div>
            {copyable && <Button variant="outline" size="sm" onClick={() => void copy(label, value)}>Sao chép {label.toLowerCase()}</Button>}
          </div>)}</dl> : <p className="mt-2 text-sm text-slate-700">PayOS chưa cung cấp chi tiết chuyển khoản cho giao dịch này.</p>}
        {Number.isFinite(expiresAt) && <p className="mt-3 text-sm text-slate-700">Hạn thanh toán {new Date(expiresAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}
        {feedback && <p role="status" className="mt-2 text-sm text-emerald-900">{feedback}</p>}
      </div>
    </div>
  </section>;
}
