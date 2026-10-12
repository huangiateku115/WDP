import {Outlet,useLocation} from 'react-router-dom';
import {Panel,OpenLink} from '@/components/manager/ManagerUI';
import {isM4DemoPage,m4DemoHome} from '@/lib/demoScope';
import FacilitySessionGate from './FacilitySessionGate';

export default function RoleWorkspaceOutlet({role}){
 const {pathname}=useLocation(),path=pathname.slice(`/${role}/`.length);
 if(!isM4DemoPage(role,path))return <div className="manager-screen"><Panel title="Tạm ẩn trong bản demo M4" subtitle="Màn hình này nằm ngoài phạm vi Staff / Facility Manager của M4 ở Iteration 1–3. Có thể bật lại sau buổi demo."><OpenLink to={m4DemoHome(role)}>Về màn hình demo</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK==='false')return <FacilitySessionGate role={role}><Outlet/></FacilitySessionGate>;
 return <Outlet/>;
}
