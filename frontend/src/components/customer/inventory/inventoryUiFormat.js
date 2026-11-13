export function formatInventoryDateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(timestamp)
    : 'Chưa có thông tin';
}
