import {Navigate,Outlet,useLocation} from 'react-router-dom';
import {facilityHome,facilityPageVisible} from '@/lib/facilityWorkspace';
import {Panel,OpenLink} from '@/components/manager/ManagerUI';
import {isM4DemoPage,m4DemoHome} from '@/lib/demoScope';
import FacilitySessionGate from './FacilitySessionGate';

export default function RoleWorkspaceOutlet({role}){
 const {pathname}=useLocation(),path=pathname.slice(`/${role}/`.length);
 if(!path||path==='dashboard')return <Navigate to={facilityHome(role)} replace/>;
 if(!facilityPageVisible(role,path))return <div className="manager-screen"><Panel title="Page temporarily hidden" subtitle="Only connected Staff and Manager workflows are currently available."><OpenLink to={facilityHome(role)}>Về danh sách đơn thuê</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK!=='false')return <Panel title="Live data configuration required"><p>Không gian này cần dữ liệu trực tiếp. Đặt VITE_USE_MOCK=false và khởi động lại giao diện.</p></Panel>;
 if(!isM4DemoPage(role,path))return <div className="manager-screen"><Panel title="Đang ẩn trong bản trình diễn" subtitle="Trang này ngoài phạm vi trình diễn nhân viên và quản lý hiện tại."><OpenLink to={m4DemoHome(role)}>Về trang trình diễn</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK==='false')return <FacilitySessionGate role={role}><Outlet/></FacilitySessionGate>;
 return <Outlet/>;
}
