export function notificationRows(response) {
  const rows = response?.data?.data;
  if (!Array.isArray(rows) || rows.some(row => !/^[a-f\d]{24}$/i.test(row?._id || '') || typeof row.isRead !== 'boolean')) {
    throw Error('Phản hồi thông báo không hợp lệ. Vui lòng tải lại.');
  }
  return [...rows].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
}
export function filterNotifications(rows, {status = '', search = '', from = '', to = ''} = {}) {
  return rows.filter(row => {
    const date = Date.parse(row.createdAt);
    const day = Number.isFinite(date) ? new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date) : '';
    return (status !== 'UNREAD' || !row.isRead) && (status !== 'READ' || row.isRead)
      && `${row.title || ''} ${row.content || ''}`.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))
      && (!from || day && day >= from) && (!to || day && day <= to);
  });
}
