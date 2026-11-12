import {Check,Warehouse,CalendarDays,ClipboardCheck,CircleCheck} from 'lucide-react';

const icons=[Warehouse,CalendarDays,ClipboardCheck,CircleCheck];
const descriptions=['Chọn vị trí và kho','Xác nhận thời hạn','Kiểm tra thông tin','Tiếp theo']
export default function Steps({current=1,labels=['Chọn kho','Thời gian thuê','Kiểm tra đơn','Hoàn tất']}){
 const booking=labels.length===4&&labels[0]==='Chọn kho'&&labels[1]==='Thời gian thuê';
 if(!booking)return <div className="portal-steps">{labels.map((label,i)=><div key={label} className={`portal-step ${i+1<current?'complete':i+1===current?'active':''} text-xs font-bold ${i+1<=current?'text-sky-700':'text-slate-400'}`}><div className={`portal-step-circle ${i+1<=current?'bg-sky-700 text-white':'bg-slate-100'}`}>{i+1<current?'✓':i+1}</div><span className="portal-step-text"><small>STEP {i+1}</small>{label}</span></div>)}</div>;
 return <ol className="portal-steps booking-steps" aria-label="Tiến trình thuê kho">{labels.map((label,i)=>{const Icon=icons[i]||CircleCheck,complete=i+1<current,active=i+1===current;return <li key={label} aria-current={active?'step':undefined} className={`portal-step ${complete?'complete':active?'active':'future'}`}><div className="portal-step-marker" aria-hidden="true">{complete?<Check size={17} strokeWidth={3}/>:<span>{i+1}</span>}</div><span className="portal-step-text"><span className="portal-step-title"><Icon size={15} aria-hidden="true"/><b>{label}</b></span><small>{active?descriptions[i]||'':`BƯỚC ${i+1}`}</small></span></li>})}</ol>;
}

