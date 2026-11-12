import {Link} from 'react-router-dom';
import {Button,Card,CardContent} from '../RentalBackendUI';

export default function ManagedInboundRequest({id}){
  return <section className="space-y-5" aria-label="Managed V3 inbound unavailable">
    <Card><CardContent>
      <h2 className="text-xl font-bold">Tự nhập hàng — chưa khả dụng</h2>
      <p className="mt-3 text-sm">Mặt hàng đã đăng ký chưa phải là hàng tồn kho. Tự nhập V3 chỉ mở sau khi backend xác minh quyền truy cập, bàn giao, Cell allocation và ghi sổ ADD nguyên tử.</p>
      <p className="mt-3 text-sm">Không có yêu cầu inbound nào được gửi và không có tồn kho hoặc sức chứa nào thay đổi.</p>
      <Button asChild variant="outline" className="mt-4"><Link to={`/portal/inventory/${id}`}>Quay lại chi tiết mặt hàng</Link></Button>
    </CardContent></Card>
  </section>;
}
