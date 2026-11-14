import {Navigate,Outlet,useLocation} from 'react-router-dom';
import {facilityHome,facilityPageVisible} from '@/lib/facilityWorkspace';
import {Panel,OpenLink} from '@/components/manager/ManagerUI';
import {isM4DemoPage,m4DemoHome} from '@/lib/demoScope';
import FacilitySessionGate from './FacilitySessionGate';

export default function RoleWorkspaceOutlet({role}){
 const {pathname}=useLocation(),path=pathname.slice(`/${role}/`.length);
 if(role==='staff'&&/^inventory\/(inbound|outbound|relocation)(\/|$)/.test(path))return <Navigate to="/staff/managed" replace/>;
 if(!path||path==='dashboard')return <Navigate to={facilityHome(role)} replace/>;
 if(!facilityPageVisible(role,path))return <div className="manager-screen"><Panel title="Trang chưa khả dụng" subtitle="Vui lòng chọn một nghiệp vụ trong menu."><OpenLink to={facilityHome(role)}>Về danh sách đơn thuê</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK==='true'&&!isM4DemoPage(role,path))return <div className="manager-screen"><Panel title="Đang ẩn trong bản trình diễn" subtitle="Trang này ngoài phạm vi trình diễn nhân viên và quản lý hiện tại."><OpenLink to={m4DemoHome(role)}>Về trang trình diễn</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK!=='true')return <FacilitySessionGate role={role}><Outlet/></FacilitySessionGate>;
 return <Outlet/>;
}
