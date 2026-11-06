import type {InventoryDetail, InventoryMovement, InventoryRental, Measurements, StockBatch} from '../domain/inventory';

const ownerId = 'demo-customer';
const measures = (widthM: number, depthM: number, heightM: number, weightKg: number): Measurements => ({widthM, depthM, heightM, weightKg});
const batch = (reference: string, quantity: number, unit: string, cell: string, measurements: Measurements): StockBatch => ({reference, quantity, unit, cell, measurements, receipt: 'BB-MAU-' + reference});
// Explicit form contexts, not new My Rentals records or verified backend states.
export const inventoryRentals: InventoryRental[] = [
  {id: 'inventory-deposit', ownerId, code: 'MIR-NHAP-MAU', name: 'Kho Đông Sài Gòn · nhận hàng lần đầu', stage: 'DEPOSIT_PAID', canRegister: true, reason: 'Mẫu đã xác nhận tiền thuê trả trước, chưa kích hoạt; cho chuẩn bị danh mục.', preferredCells: ['B04-L2-C01', 'B04-L2-C02']},
  {id: 'inventory-active', ownerId, code: 'MIR-HANG-MAU', name: 'Kho Đông Sài Gòn · kỳ thuê đang hoạt động', stage: 'ACTIVE', canRegister: true, reason: 'Mẫu ACTIVE được phép chuẩn bị danh mục bổ sung.', preferredCells: ['B04-L2-C01', 'B04-L2-C02']},
  {id: 'inventory-pending', ownerId, code: 'MIR-CHO-MAU', name: 'Kho Đông Sài Gòn · chưa xác nhận cọc', stage: 'AWAITING_DEPOSIT', canRegister: false, reason: 'Chưa xác nhận tiền thuê trả trước trong fixture.', preferredCells: []},
  {id: 'inventory-closed', ownerId, code: 'MIR-DONG-MAU', name: 'Kho Đông Sài Gòn · đã kết thúc', stage: 'CLOSED', canRegister: false, reason: 'Kỳ thuê mẫu đã kết thúc.', preferredCells: []},
];
export const inventoryDetails: InventoryDetail[] = [
  {itemId: 'coffee', ownerId, description: 'Cà phê đóng túi; số lượng và số đo dưới đây chỉ là dữ liệu minh họa.', rentalId: 'inventory-active', images: ['box', 'label'], preferredCell: null, declaredMeasurements: measures(0.1, 0.08, 0.2, 1), stockState: 'KNOWN', stockUnit: 'túi', batches: [batch('CF-A', 100, 'túi', 'B04-L2-C01', measures(0.1, 0.08, 0.2, 1)), batch('CF-B', 140, 'túi', 'B04-L2-C01', measures(0.11, 0.08, 0.22, 1.02))], editable: false, editReason: 'Hàng mẫu đang lưu kho: không sửa thông số khai báo có thể ảnh hưởng nghiệp vụ. Không có thao tác nhân viên tại đây.'},
  {itemId: 'packaging', ownerId, description: 'Hộp giấy đóng kiện. Số lượng đăng ký khác tồn thực tế; không tự suy ra tồn từ danh mục.', rentalId: 'inventory-active', images: ['stack'], preferredCell: null, declaredMeasurements: measures(0.4, 0.3, 0.2, 2), stockState: 'KNOWN', stockUnit: 'kiện', batches: [batch('PK-A', 60, 'kiện', 'B04-L2-C02', measures(0.4, 0.3, 0.2, 2))], editable: false, editReason: 'Hàng mẫu đang lưu kho; chỉnh sửa bị khóa trong prototype.'},
  {itemId: 'samples', ownerId, description: 'Bộ sản phẩm mới chỉ khai báo, chưa xác nhận tiếp nhận hoặc phân vị trí thực tế.', rentalId: 'inventory-deposit', images: [], preferredCell: 'B04-L2-C02', declaredMeasurements: measures(0.4, 0.3, 0.25, 2), stockState: 'MISSING', stockUnit: null, batches: [], editable: true, editReason: 'Fixture cho phép sửa bản khai báo chưa nhập kho; chỉ lưu nháp trong phiên.'},
];
// A history is evidence presentation only, never a stock-ledger calculation.
export const inventoryMovements: InventoryMovement[] = [
  {id: 'movement-in-coffee', itemId: 'coffee', ownerId, type: 'INBOUND', occurredAt: '2026-10-12T07:30:00Z', quantity: 240, unit: 'túi', sourceCell: null, destinationCell: 'B04-L1-C01', schemaVersion: 2, arithmeticPolicy: 'SUM_BATCH_QUANTITIES', batchLines: [batch('CF-A', 100, 'túi', 'B04-L1-C01', measures(0.1, 0.08, 0.2, 1)), batch('CF-B', 140, 'túi', 'B04-L1-C01', measures(0.11, 0.08, 0.22, 1.02))], evidence: 'BB-NHAP-MAU-01', staffProcessed: true, note: 'Hai lô có số đo đơn vị khác nhau; không dùng số đo lô đầu cho cả sự kiện.'},
  {id: 'movement-move-coffee', itemId: 'coffee', ownerId, type: 'RELOCATION', occurredAt: '2026-10-14T09:00:00Z', quantity: 240, unit: 'túi', sourceCell: 'B04-L1-C01', destinationCell: 'B04-L2-C01', schemaVersion: 2, batchLines: null, evidence: 'BB-CHUYEN-MAU-01', staffProcessed: true, note: 'Nhân viên xử lý trong dữ liệu mẫu; khách hàng chỉ xem.'},
  {id: 'movement-old-pack', itemId: 'packaging', ownerId, type: 'INBOUND', occurredAt: '2026-10-02T02:00:00Z', quantity: 80, unit: 'kiện', sourceCell: null, destinationCell: 'B04-L2-C02', note: 'Bản ghi cũ không có batch lines hoặc số đo đơn vị.'},
  {id: 'movement-out-pack', itemId: 'packaging', ownerId, type: 'OUTBOUND', occurredAt: '2026-10-18T03:15:00Z', quantity: 20, unit: 'kiện', sourceCell: 'B04-L2-C02', destinationCell: null, schemaVersion: 2, arithmeticPolicy: 'SUM_BATCH_QUANTITIES', batchLines: [{...batch('PK-A', 20, 'kiện', 'B04-L2-C02', measures(0.4, 0.3, 0.2, 2)), receipt: 'BB-XUAT-MAU-01'}], staffProcessed: true},
];
