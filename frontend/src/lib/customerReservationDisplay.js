// Presentation only: never adjust the amount, UTC instant, or Backend lifecycle.
const vndNumber=new Intl.NumberFormat('vi-VN',{maximumSignificantDigits:21});
export function reservationAmount(value,currency){
  if(typeof value!=='number'||!Number.isFinite(value))return `${value} ${currency}`;
  if(currency==='VND')return `${vndNumber.format(value)} ₫`;
  try{return new Intl.NumberFormat('vi-VN',{style:'currency',currency}).format(value)}catch{return `${value} ${currency}`}
}
export function reservationVietnamTime(value){
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return value;
  const date=new Date(value);
  return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
export function reservationDateOnly(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const [year,month,day]=value.split('-');
  return `${day}/${month}/${year}`;
}
export function reservationVnd(value){
  return typeof value==='number'&&Number.isFinite(value)?`${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(value)} ₫`:'Chưa có thông tin';
}
