import {Navigate,Outlet,useLocation} from 'react-router-dom';
import {facilityHome,facilityPageVisible} from '@/lib/facilityWorkspace';
import {Panel,OpenLink} from '@/components/manager/ManagerUI';
import {isM4DemoPage,m4DemoHome} from '@/lib/demoScope';
import FacilitySessionGate from './FacilitySessionGate';

export default function RoleWorkspaceOutlet({role}){
 const {pathname}=useLocation(),path=pathname.slice(`/${role}/`.length);
 if(!path||path==='dashboard')return <Navigate to={facilityHome(role)} replace/>;
 if(!facilityPageVisible(role,path))return <div className="manager-screen"><Panel title="Page temporarily hidden" subtitle="Only connected Staff and Manager workflows are currently available."><OpenLink to={facilityHome(role)}>Back to reservations</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK!=='false')return <Panel title="Live data configuration required"><p>This workspace requires live data. Set VITE_USE_MOCK=false and restart the frontend.</p></Panel>;
 if(!isM4DemoPage(role,path))return <div className="manager-screen"><Panel title="Hidden in this demo" subtitle="This screen is outside the current Staff and Facility Manager demo scope."><OpenLink to={m4DemoHome(role)}>Back to demo</OpenLink></Panel></div>;
 if(import.meta.env.VITE_USE_MOCK==='false')return <FacilitySessionGate role={role}><Outlet/></FacilitySessionGate>;
 return <Outlet/>;
}
