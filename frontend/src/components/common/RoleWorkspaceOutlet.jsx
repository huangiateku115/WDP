import {Navigate,Outlet,useLocation} from 'react-router-dom';
import {facilityHome,facilityPageVisible} from '@/lib/facilityWorkspace';
import {Panel,OpenLink} from '@/components/manager/ManagerUI';
import {isM4DemoPage,m4DemoHome} from '@/lib/demoScope';
import FacilitySessionGate from './FacilitySessionGate';

export default function RoleWorkspaceOutlet({role}){
 const {pathname}=useLocation(),path=pathname.slice(`/${role}/`.length);
 if(!path||path==='dashboard')return <Navigate to={facilityHome(role)} replace/>;
 if(!facilityPageVisible(role,path))return <div className="manager-screen"><Panel title="Trang tạm ẩn" subtitle="Hiện chỉ hiển thị các nghiệp vụ Staff/Manager đã nối API trong phạm vi demo."><OpenLink to={facilityHome(role)}>Về danh sách đặt chỗ</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK!=='false')return <Panel title="Cần bật dữ liệu backend"><p>Workspace này chỉ dùng API thật. Cấu hình VITE_USE_MOCK=false và khởi động lại frontend.</p></Panel>;
 if(!isM4DemoPage(role,path))return <div className="manager-screen"><Panel title="Tạm ẩn trong bản demo M4" subtitle="Màn hình này nằm ngoài phạm vi Staff / Facility Manager của M4 ở Iteration 1–3. Có thể bật lại sau buổi demo."><OpenLink to={m4DemoHome(role)}>Về màn hình demo</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK==='false')return <FacilitySessionGate role={role}><Outlet/></FacilitySessionGate>;
 return <Outlet/>;
}
