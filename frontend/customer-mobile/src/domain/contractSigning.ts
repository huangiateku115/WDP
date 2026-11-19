export type ContractDeadlineState=
  |{kind:'missing'}
  |{kind:'invalid'}
  |{kind:'expired'}
  |{kind:'remaining';label:string;deadlineAt:number};

export function contractDeadlineState(value:string|undefined,now=Date.now()):ContractDeadlineState{
  if(!value)return {kind:'missing'};
  if(!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return {kind:'invalid'};
  const deadlineAt=Date.parse(value);
  if(!Number.isFinite(deadlineAt))return {kind:'invalid'};
  if(deadlineAt<=now)return {kind:'expired'};
  const minutes=Math.max(1,Math.floor((deadlineAt-now)/60_000));
  const days=Math.floor(minutes/(24*60));
  const hours=Math.floor((minutes%(24*60))/60);
  const remainder=minutes%60;
  const label=days>0?`Còn ${days} ngày ${hours} giờ`:hours>0?`Còn ${hours} giờ ${remainder} phút`:`Còn ${remainder} phút`;
  return {kind:'remaining',label,deadlineAt};
}

export function contractDeadlineLabel(deadlineAt:number){
  return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'medium',timeStyle:'short'}).format(new Date(deadlineAt));
}
