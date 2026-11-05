import QRCode from "qrcode";
import { canShowPayosQr } from "../api/payosPaymentClient.js";

export async function createPayosQrDataUrl(payment) {
  if (!canShowPayosQr(payment)) return null;
  return QRCode.toDataURL(payment.qrCode, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
  });
}
