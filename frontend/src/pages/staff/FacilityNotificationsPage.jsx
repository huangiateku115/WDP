import {useRef, useState} from 'react';
import {notificationApi} from '@/api/notificationApi';
import {useAuthSession} from '@/lib/authSession';
import {useAsyncData} from '@/lib/useAsyncData';
import {apiErrorMessage} from '@/lib/apiError';
import {notificationRows, filterNotifications} from '@/lib/facilityNotifications';
import {Screen, Panel, Field, Input, Select, Button, Message} from '@/components/manager/ManagerUI';

export default function FacilityNotificationsPage() {
  const {user} = useAuthSession();
  return <Inbox key={user?.id || user?._id || ''} />;
}
function Inbox() {
  const {user} = useAuthSession();
  const state = useAsyncData(({signal}) => notificationApi.list({signal}).then(notificationRows), [user?.id, user?._id]);
  const [filters, setFilters] = useState({status: '', search: '', from: '', to: ''});
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const invalidDates = filters.from && filters.to && filters.from > filters.to;
  const rows = state.data || [];
  const visible = invalidDates ? [] : filterNotifications(rows, filters);
  function change(key, value) {setFilters(previous => ({...previous, [key]: value}));}
  async function markRead(row) {
    if (lock.current || row.isRead) return;
    lock.current = true; setBusy(row._id); setError(''); setNotice('');
    try {
      const response = await notificationApi.markRead(row._id);
      if (response?.data?.success !== true || response.data.data?._id !== row._id || response.data.data?.isRead !== true) throw Error('Máy chủ chưa xác nhận đã đọc thông báo.');
      setNotice('Đã đánh dấu thông báo là đã đọc.'); state.reload();
    } catch (err) {setError(apiErrorMessage(err));}
    finally {lock.current = false; setBusy('');}
  }
  return <Screen title="Thông báo" description="Các thông báo được gửi đến tài khoản của bạn." action={<Button variant="outline" disabled={state.loading || !!busy} onClick={state.reload}>Tải lại</Button>}>
    <Message error={state.error || error || (invalidDates ? 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' : '')} success={notice}/>
    <Panel title="Hộp thư">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Tìm nội dung"><Input value={filters.search} onChange={event => change('search', event.target.value)}/></Field>
        <Field label="Trạng thái"><Select label="Trạng thái thông báo" value={filters.status} onChange={value => change('status', value)} options={ [['', 'Tất cả'], ['UNREAD', 'Chưa đọc'], ['READ', 'Đã đọc']]}/></Field>
        <Field label="Từ ngày"><Input type="date" value={filters.from} onChange={event => change('from', event.target.value)}/></Field>
        <Field label="Đến ngày"><Input type="date" min={filters.from || undefined} value={filters.to} onChange={event => change('to', event.target.value)}/></Field>
      </div>
      {state.loading ? <p role="status" className="mt-5">Đang tải thông báo…</p> : !state.error && <>
        <p className="my-5">{rows.filter(row => !row.isRead).length} chưa đọc · {visible.length} thông báo phù hợp</p>
        {!visible.length && !invalidDates && <p>Chưa có thông báo phù hợp.</p>}
        <ul className="space-y-4">{visible.map(row => <li key={row._id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="min-w-0 break-words font-semibold">{row.title || 'Thông báo'}</h2>
            <span>{row.isRead ? 'Đã đọc' : 'Chưa đọc'}</span>
          </div>
          <p className="my-3 whitespace-pre-wrap break-words">{row.content}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <small>{Number.isFinite(Date.parse(row.createdAt)) ? new Date(row.createdAt).toLocaleString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'}) : 'Chưa có thời gian'}</small>
            {!row.isRead && <Button variant="outline" disabled={!!busy} onClick={() => markRead(row)}>{busy === row._id ? 'Đang lưu…' : 'Đánh dấu đã đọc'}</Button>}
          </div>
        </li>)}</ul>
      </>}
    </Panel>
  </Screen>;
}
