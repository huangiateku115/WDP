export const durationOptions = [1, 3, 6, 12];
export function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function calculatePricing(baseRate = 1500000, months = 1) {
  const discount = ({1:0,3:.05,6:.1,12:.15})[months] ?? 0;
  const monthlyRate = Math.round(baseRate * (1-discount));
  const subtotal = monthlyRate * months;
  return { baseRate, monthlyRate, subtotal, discount: baseRate * months - subtotal, deposit: baseRate, total: subtotal + baseRate };
}
export const formatMoney = value => new Intl.NumberFormat('en-US').format(value || 0);
export function formatDate(value) {
  if (!value) return 'Not selected';
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
}
export function endDate(value, months) {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth()+months);
  const lastDay = new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
  date.setDate(Math.min(day,lastDay));
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export const defaultStorage = {id:'LOCKER-A101',code:'A-101',name:'Mini Storage',size:3,monthlyRate:1500000};
export const defaultFacility = {id:'FAC001',name:'SelfStorage Central Saigon'};
