import {useMemo, useRef, useState} from 'react';
import {Linking, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import {toQR} from 'toqr';
import {AppText, Button} from './ui';
import {money} from './liveUI';
import {checkoutLink, fullRentReady} from '../domain/livePayment';
import type {paymentDto} from '../api/contracts/documents';
import type {z} from 'zod';

export function FullRentCheckout({payment, url}: {payment: z.infer<typeof paymentDto>; url: string | null}) {
  const busy = useRef(false);
  const [error, setError] = useState('');
  const safeUrl = checkoutLink(payment,payment.reservationId,'FULL_RENT') === url ? url : null;
  const qr = useMemo(() => {
    if (!payment.qrCode || payment.qrCode.length > 4096 || !/^000201[\x20-\x7E]{10,}$/.test(payment.qrCode)) return null;
    try {
      const data = toQR(payment.qrCode);
      const size = Math.sqrt(data.length);
      const path = Array.from(data, (dark, index) => dark
        ? 'M'+(index%size+4)+' '+(Math.floor(index/size)+4)+'h1v1h-1z' : '').join('');
      return {size:size+8, path};
    } catch { return null; }
  }, [payment.qrCode]);
  async function open() {
    if (busy.current || !url || !fullRentReady(payment,payment.reservationId) ||
      checkoutLink(payment,payment.reservationId,'FULL_RENT') !== url) return;
    busy.current = true;
    setError('');
    try { await Linking.openURL(url); }
    catch { setError('Không thể mở PayOS. Hãy kiểm tra lại giao dịch.'); }
    finally { busy.current = false; }
  }
  if (!fullRentReady(payment,payment.reservationId)) return null;
  return <>
    <AppText variant="label">Thanh toán {money(payment.amount)}</AppText>
    {qr && <View accessible accessibilityRole="image" accessibilityLabel="Mã VietQR do PayOS cung cấp"
      style={{width:'100%', maxWidth:260, alignSelf:'center', aspectRatio:1}}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${qr.size} ${qr.size}`}>
        <Rect width={qr.size} height={qr.size} fill="white"/><Path d={qr.path} fill="black"/>
      </Svg>
    </View>}
    {qr && payment.transferDetails && <>
      <AppText selectable>Chủ tài khoản: {payment.transferDetails.accountName}</AppText>
      <AppText selectable>Số tài khoản: {payment.transferDetails.accountNumber}</AppText>
      <AppText selectable>Nội dung: {payment.transferDetails.description}</AppText>
    </>}
    {safeUrl && <Button label="Mở trang PayOS" onPress={() => void open()}/>}
    {error && <AppText accessibilityRole="alert">{error}</AppText>}
  </>;
}
