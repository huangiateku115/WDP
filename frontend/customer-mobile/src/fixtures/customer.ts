import type {Fixtures} from '../domain/models';

// Local demonstration records. No backend IDs, real addresses for a booking,
// access credentials, payment receipts or production availability are implied.
export const customerFixtures:Fixtures={
  customer:{id:'demo-customer',name:'Nguyễn Thùy Linh',initials:'TL',email:'linh.demo@vaultspace.vn',phone:'0900 000 123'},
  facilities:[
    {id:'saigon-south',name:'VaultSpace Nam Sài Gòn',district:'Quận 7',address:'Khu Nam Sài Gòn, TP. Hồ Chí Minh',services:['SELF_STORAGE','MANAGED_INVENTORY'],priceFrom:1200000,illustration:'south',description:'Không gian lưu trữ cho đồ dùng cá nhân và hàng hóa doanh nghiệp. Thông tin minh họa, chưa xác nhận cơ sở hoặc chỗ trống thực tế.'},
    {id:'east-metro',name:'VaultSpace Đông Sài Gòn',district:'Thủ Đức',address:'Khu vực Thủ Đức, TP. Hồ Chí Minh',services:['MANAGED_INVENTORY'],priceFrom:960000,illustration:'east',description:'Minh họa kho ký gửi với vị trí lưu trữ theo ô kệ. Nhân viên thực hiện kiểm tra và nhập/xuất hàng; khách hàng không tự di chuyển hàng trên hệ thống.'},
    {id:'airport',name:'VaultSpace Tân Bình',district:'Tân Bình',address:'Khu vực Tân Bình, TP. Hồ Chí Minh',services:['SELF_STORAGE'],priceFrom:850000,illustration:'airport',description:'Minh họa lựa chọn kho tự quản nhỏ gọn. Giá mẫu không phải báo giá hoặc cam kết dịch vụ.'},
  ],
  rentals:[
    {id:'rental-south',code:'VS-MAU-001',facilityId:'saigon-south',service:'SELF_STORAGE',unit:'B-204',status:'ACTIVE',start:'2026-10-01T00:00:00+07:00',end:'2027-01-01T00:00:00+07:00',monthlyPrice:1850000,capacityLabel:'12 m³',note:'Dữ liệu mẫu thể hiện một kỳ thuê đang hoạt động. Ứng dụng không cung cấp mã mở cửa hoặc quyền truy cập thực tế.'},
    {id:'rental-east',code:'MIR-MAU-002',facilityId:'east-metro',service:'MANAGED_INVENTORY',unit:'B04 · L2 · C01–C02',status:'RESERVED',start:'2026-11-01T00:00:00+07:00',end:'2027-02-01T00:00:00+07:00',monthlyPrice:960000,capacityLabel:'0,24 m³',note:'Bản mẫu đang ở bước giữ chỗ. Chưa xác nhận đặt cọc, ký hợp đồng hay nhập hàng; Phase 1 không thực hiện các thao tác này.'},
    {id:'rental-history',code:'VS-MAU-003',facilityId:'airport',service:'SELF_STORAGE',unit:'S-12',status:'CLOSED',start:'2026-06-01T00:00:00+07:00',end:'2026-09-01T00:00:00+07:00',monthlyPrice:850000,capacityLabel:'6 m³',note:'Kỳ thuê mẫu đã kết thúc. Không thể hiện giao dịch hoàn cọc hoặc thanh toán thực tế.'},
  ],
  items:[
    {id:'coffee',code:'CF-VN-0891',name:'Cà phê Arabica Đà Lạt',category:'Thực phẩm đóng gói',unit:'túi',registeredQuantity:240,status:'IN_STORAGE',cell:'B04-L2-C01',stock:{onHand:240,held:20,available:220}},
    {id:'packaging',code:'PKG-0102',name:'Hộp giấy Kraft cỡ lớn',category:'Bao bì',unit:'kiện',registeredQuantity:99,status:'IN_STORAGE',cell:'B04-L2-C02',stock:{onHand:60,held:15,available:45}},
    {id:'samples',code:'SP-MAU-003',name:'Bộ sản phẩm trưng bày',category:'Hàng tiêu dùng',unit:'thùng',registeredQuantity:8,status:'REGISTERED',cell:null,stock:null},
  ],
};
