import {useState} from 'react';
import {notificationApi} from '@/api/customerRentalApi';
import {getAccessToken} from '@/lib/authSession';
import {BackendScreen,LoadState,useBackend,rows,record,recordId,validId,Card,CardContent,Button,ConfirmAction} from './RentalBackendUI';
export default function CustomerNotificationsIntegration(){
 const [unread,setUnread]=useState(false),resource=useBackend(config=>notificationApi.mine(config).then(rows));
 const visible=resource.data?.filter(n=>!unread||n.isRead===false)||[];
 return <BackendScreen title="Notifications" description="Notifications returned for your authenticated account."><Button variant="outline" aria-pressed={unread} onClick={()=>setUnread(v=>!v)}>{unread?'Show all':'Show unread'}</Button><LoadState resource={resource}/>{visible.map(n=><Card key={recordId(n)}><CardContent><h2 className="text-xl font-bold break-words">{n.title}</h2><p className="mt-3 whitespace-pre-wrap break-words">{n.content}</p><p className="mt-3 text-sm">{n.type} · {n.isRead?'Read':'Unread'} · {n.createdAt}</p>{n.isRead===false&&validId(recordId(n))&&<ConfirmAction label="Mark as read" onAction={async()=>{const token=getAccessToken();const result=record(await notificationApi.read(recordId(n)));if(getAccessToken()!==token)return;if(result.isRead!==true)throw Error('Backend did not confirm read status.');resource.retry();}}/>}</CardContent></Card>)}{!resource.loading&&!resource.error&&!visible.length&&<p>No notifications match this filter.</p>}</BackendScreen>;
}
