import {Navigate,useLocation} from 'react-router-dom';
import {useAuthSession} from '@/lib/authSession';
export default function CustomerGate({children}){const session=useAuthSession(),location=useLocation();if(!session.accessToken)return <Navigate to="/login" replace state={{from:location.pathname+location.search}}/>;if(session.user?.role&&session.user.role!=='CUSTOMER')return <div className="p-8" role="alert">Customer account required. Backend authorization remains authoritative.</div>;return children;}
