import {AppText, Card, Chip, Icon, ui} from './ui';

// Shared by both service prototypes; never presents a backend-created reservation.
export function PrototypeConfirmationHeader() {
  return <Card style={{alignItems: 'center'}}><Icon name="document-text-outline" size={44}/><Chip label="Chỉ xem trước" tone="orange"/><AppText variant="title" style={{textAlign: 'center'}}>Bản xem trước đặt chỗ — chưa tạo đơn thuê thực tế</AppText><AppText style={ui.muted}>Không có mã đơn, giữ kho, thanh toán hoặc kích hoạt quyền truy cập nào được tạo.</AppText></Card>;
}
