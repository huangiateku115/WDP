import LoadState from './CustomerResourceState';
import {Bell} from 'lucide-react';
import {reservationVietnamTime} from '@/lib/customerReservationDisplay';
import {PortalEmptyState} from './CustomerPortalUI';
import {useState} from 'react';
import {notificationApi} from '@/api/customerRentalApi';
import {getAccessToken} from '@/lib/authSession';
import {BackendScreen,useBackend,rows,record,recordId,validId,Card,CardContent,Button,ConfirmAction} from './RentalBackendUI';
export default function CustomerNotificationsIntegration(){
 const [unread,setUnread]=useState(false),resource=useBackend(config=>notificationApi.mine(config).then(rows));
 const visible=resource.data?.filter(n=>!unread||n.isRead===false)||[];
 return <BackendScreen title="Notifications" description="Stay informed about your reservations, inventory and account." notice="Updates from your account. Unread messages stay highlighted until marked as read."><Button variant="outline" aria-pressed={unread} onClick={()=>setUnread(v=>!v)}>{unread?'Show all':'Show unread'}</Button><LoadState resource={resource}/>{visible.map(n=><Card key={recordId(n)} className="portal-notification" data-read={n.isRead===true?'true':'false'}><CardContent><div className="portal-notification-heading"><Bell size={20} aria-hidden="true"/><h2 className="text-xl font-bold break-words">{n.title}</h2><span className="portal-notification-state">{n.isRead?'Read':'Unread'}</span></div><p className="mt-3 whitespace-pre-wrap break-words">{n.content}</p><p className="mt-3 text-sm">{n.type} · {n.isRead?'Read':'Unread'} · {reservationVietnamTime(n.createdAt)}</p>{n.isRead===false&&validId(recordId(n))&&<ConfirmAction label="Mark as read" onAction={async()=>{const token=getAccessToken();const result=record(await notificationApi.read(recordId(n)));if(getAccessToken()!==token)return;if(result.isRead!==true)throw Error('Backend did not confirm read status.');resource.retry();}}/>}</CardContent></Card>)}{!resource.loading&&!resource.error&&!visible.length&&<PortalEmptyState title="No notifications match this filter." description="You are up to date. New updates will appear here."/>}</BackendScreen>;
}
