import useAssignedFacility from '@/lib/useAssignedFacility';
import { facilityLabel } from '@/lib/facilityLabels';
import { facilityHome, facilityPageVisible } from '@/lib/facilityWorkspace';
import RoleWorkspaceOutlet from '@/components/common/RoleWorkspaceOutlet';
import { isM4DemoMenu, m4DemoHome } from '@/lib/demoScope';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, ClipboardList, LogIn, LogOut, ClipboardCheck, KeyRound, PackagePlus, PackageCheck, Move, History, LifeBuoy, Wrench, Wallet, Building2, Users, CalendarCheck } from 'lucide-react';
import Brand from '@/components/common/Brand';
import LogoutButton from '@/components/common/LogoutButton';
import { Select } from '@/components/manager/ManagerUI';
import { useAuthSession } from '@/lib/authSession';
import { useStaffData, selectDemoOperator, staffDemoEnabled, operator } from '@/lib/staffDemoStore';
import { staffFacility, staffOperators } from '@/mocks/staffData';
import './experience.css'; import './manager.css'; import './staff.css';
const links = [
  ["dashboard", LayoutDashboard, "Tổng quan", "Đơn và khách hàng"],
  ["reservations", CalendarCheck, "Đơn đặt thuê", "Đơn và khách hàng"],
  ["customers", Users, "Khách hàng", "Đơn và khách hàng"],
  ["check-ins", LogIn, "Tiếp nhận khách", "Nhận và trả kho riêng"],
  ["handovers", KeyRound, "Bàn giao kho", "Nhận và trả kho riêng"],
  ["access", KeyRound, "Mô phỏng mở cửa", "Nhận và trả kho riêng"],
  ["inspections", ClipboardCheck, "Kiểm tra kho", "Nhận và trả kho riêng"],
  ["checkouts", LogOut, "Trả kho", "Nhận và trả kho riêng"],
  ["managed-access", ClipboardList, "Lịch đến kho và phiên truy cập", "Lưu trữ hàng hóa"],
  ["managed", ClipboardList, "Hàng hóa và tồn kho", "Lưu trữ hàng hóa"],
  ["warehouse-map", Building2, "Bản đồ kho", "Lưu trữ hàng hóa"],
  ["tasks", ClipboardList, "Công việc hằng ngày", "Hỗ trợ và bảo trì"],
  ["support", LifeBuoy, "Hỗ trợ", "Hỗ trợ và bảo trì"],
  ["maintenance", Wrench, "Bảo trì", "Hỗ trợ và bảo trì"],
  ["notifications", ClipboardList, "Thông báo", "Hỗ trợ và bảo trì"],
  ["refunds", Wallet, "Xử lý hoàn tiền", "Hỗ trợ và bảo trì"]
];
export default function StaffLayout() { const data = useStaffData(), { user } = useAuthSession(), staff = operator(data); const facilityState = useAssignedFacility(user?.assignedFacilityId, !staffDemoEnabled); const facility = staffDemoEnabled ? staffFacility : facilityState.facility; const facilityName = facility?.name || (facilityState.loading ? 'Đang tải cơ sở…' : user?.assignedFacilityId ? 'Chưa tải được tên cơ sở' : 'Chưa được phân công cơ sở'); return <div className={`experience-theme manager-shell staff-shell${staffDemoEnabled ? "" : " staff-live"}`}><header className="manager-topbar"><Link to={facilityHome('staff')} aria-label="VaultSpace dành cho nhân viên"><Brand /></Link>{staffDemoEnabled && <div className="staff-operator"><span className="text-[10px] font-bold uppercase tracking-wider text-[#6b7e70]">Nhân viên trình diễn</span><Select label="Nhân viên trình diễn" value={data.operatorId || ''} onChange={selectDemoOperator} options={staffDemoEnabled ? staffOperators.map(row => [row.id, `${row.name} · ${row.role}`]) : [["", "Dịch vụ vận hành chưa sẵn sàng"]]} disabled={!staffDemoEnabled} /></div>}<div className="manager-identity"><span className="manager-avatar">ST</span><span><b>{user?.displayName || staff?.name || "Không gian nhân viên"}</b><small>Nhân viên cơ sở</small></span><LogoutButton compact /></div></header><div className="manager-workspace"><aside className="manager-sidebar"><div className="manager-nav-brand"><span className="manager-nav-brand-icon"><ClipboardList size={20} aria-hidden="true" /></span><div><p>Nhân viên cơ sở</p></div></div><nav aria-label="Điều hướng nhân viên">{links.filter(([path]) => facilityPageVisible('staff', path)).map(([path, Icon, label, group], index, visible) => <div key={path} className="facility-nav-item">{(index === 0 || visible[index - 1][3] !== group) && <p className="facility-nav-heading">{group}</p>}<NavLink to={`/staff/${path}`}><Icon size={17} />{label}</NavLink></div>)}</nav><div className="manager-scope"><Building2 size={18} /><p>Cơ sở được phân công<br /><b>{facilityName}</b></p>{facility?.code && <span>Mã cơ sở: {facility.code}</span>}</div></aside><main className="manager-main"><RoleWorkspaceOutlet role="staff" /></main></div></div>; }
