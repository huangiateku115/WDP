import useAssignedFacility from '@/lib/useAssignedFacility';
import { facilityHome, facilityPageVisible } from '@/lib/facilityWorkspace';
import { managerDemoEnabled } from '@/lib/managerDemoStore';
import RoleWorkspaceOutlet from '@/components/common/RoleWorkspaceOutlet';
import { isM4DemoMenu, m4DemoHome } from '@/lib/demoScope';
import { useAuthSession } from '@/lib/authSession';
import LogoutButton from '@/components/common/LogoutButton';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, CalendarCheck, Users, Warehouse, Layers, ClipboardList, UserCheck, CalendarPlus, Wrench, LifeBuoy, RotateCcw, Receipt, ChartNoAxesCombined, Building2 } from 'lucide-react';
import Brand from '@/components/common/Brand';
import { assignedFacility } from '@/mocks/managerData';
import './experience.css';
import './manager.css';
const links = [
  ["dashboard", LayoutDashboard, "Tổng quan", "Đơn và khách hàng"],
  ["reservations", CalendarCheck, "Đơn đặt thuê", "Đơn và khách hàng"],
  ["customers", Users, "Khách hàng", "Đơn và khách hàng"],
  ["work/CHECK_IN", ClipboardList, "Tiếp nhận khách", "Nhận và trả kho riêng"],
  ["work/HANDOVER", ClipboardList, "Bàn giao kho", "Nhận và trả kho riêng"],
  ["access", ClipboardList, "Mô phỏng mở cửa", "Nhận và trả kho riêng"],
  ["work/INSPECTION", ClipboardList, "Kiểm tra kho", "Nhận và trả kho riêng"],
  ["work/CHECKOUT", ClipboardList, "Trả kho", "Nhận và trả kho riêng"],
  ["extensions", CalendarPlus, "Gia hạn", "Nhận và trả kho riêng"],
  ["managed-access", ClipboardList, "Lịch đến kho và phiên truy cập", "Lưu trữ hàng hóa"],
  ["managed", ClipboardList, "Hàng hóa và tồn kho", "Lưu trữ hàng hóa"],
  ["warehouse-map", Building2, "Bản đồ kho", "Lưu trữ hàng hóa"],
  ["storage-units", Warehouse, "Kho riêng", "Quản trị và báo cáo"],
  ["storage-locations", Layers, "Vị trí lưu trữ", "Quản trị và báo cáo"],
  ["warehouse-settings", Layers, "Cấu hình không gian", "Quản trị và báo cáo"],
  ["reports", ChartNoAxesCombined, "Thống kê và báo cáo", "Quản trị và báo cáo"],
  ["operations", ClipboardList, "Công việc hằng ngày", "Hỗ trợ và bảo trì"],
  ["tasks", UserCheck, "Phân công hỗ trợ và bảo trì", "Hỗ trợ và bảo trì"],
  ["support", LifeBuoy, "Hỗ trợ", "Hỗ trợ và bảo trì"],
  ["maintenance", Wrench, "Bảo trì", "Hỗ trợ và bảo trì"],
  ["notifications", ClipboardList, "Thông báo", "Hỗ trợ và bảo trì"],
  ["refunds", RotateCcw, "Hoàn tiền", "Hỗ trợ và bảo trì"],
  ["charges", Receipt, "Phụ phí", "Hỗ trợ và bảo trì"]
];
export default function ManagerLayout() { const { user } = useAuthSession(); const facilityState = useAssignedFacility(user?.assignedFacilityId, !managerDemoEnabled); const facility = managerDemoEnabled ? assignedFacility : facilityState.facility; const facilityName = facility?.name || (facilityState.loading ? 'Đang tải cơ sở…' : user?.assignedFacilityId ? 'Chưa tải được tên cơ sở' : 'Chưa được phân công cơ sở'); return <div className="experience-theme manager-shell"><header className="manager-topbar"><Link to={facilityHome('manager')} aria-label="VaultSpace dành cho quản lý"><Brand /></Link><div className="manager-facility"><Building2 size={17} /><span><b>{facilityName}</b><small>Cơ sở được phân công · {facility?.code || "Cơ sở được phân công"}</small></span></div><div className="manager-identity"><span className="manager-avatar">ML</span><span><b>{user?.displayName || (managerDemoEnabled ? assignedFacility.manager : "Không gian quản lý")}</b><small>Quản lý cơ sở</small></span><LogoutButton compact /></div></header><div className="manager-workspace"><aside className="manager-sidebar"><div className="manager-nav-brand"><span className="manager-nav-brand-icon"><Building2 size={20} aria-hidden="true" /></span><div><p>Quản lý cơ sở</p></div></div><nav aria-label="Điều hướng quản lý">{links.filter(([path]) => !managerDemoEnabled || !path.startsWith('work/')).filter(([path]) => facilityPageVisible('manager', path)).map(([path, Icon, label, group], index, visible) => <div key={path} className="facility-nav-item">{(index === 0 || visible[index - 1][3] !== group) && <p className="facility-nav-heading">{group}</p>}<NavLink to={`/manager/${path}`}><Icon size={17} />{label}</NavLink></div>)}</nav><div className="manager-scope"><Building2 size={18} /><p>Cơ sở đang quản lý<br /><b>{facilityName}</b></p>{facility?.code && <span>Mã cơ sở: {facility.code}</span>}</div></aside><main className="manager-main"><RoleWorkspaceOutlet role="manager" /></main></div></div>; }
