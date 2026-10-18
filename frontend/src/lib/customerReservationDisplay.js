// Presentation only: never adjust the amount, UTC instant, or Backend lifecycle.
const vndNumber=new Intl.NumberFormat('vi-VN',{maximumSignificantDigits:21});
export function reservationAmount(value,currency){
  return currency==='VND'&&typeof value==='number'&&Number.isFinite(value)?`${vndNumber.format(value)} VND`:`${value} ${currency}`;
}
export function reservationVietnamTime(value){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return value;
  const date=new Date(value);
  return `${new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',...(date.getUTCMilliseconds()?{fractionalSecondDigits:3}:{})}).format(date)} (UTC+07:00)`;
}
