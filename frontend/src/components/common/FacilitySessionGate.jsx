import {useEffect,useState} from 'react';
import {Navigate,useLocation} from 'react-router-dom';
import userApi from '@/api/userApi';
import {saveSessionUser,useAuthSession,profileFromResponse} from '@/lib/authSession';
import {reviewError as apiErrorMessage} from '@/lib/facilityReview';
import {Button,Panel,Message} from '@/components/manager/ManagerUI';

export default function FacilitySessionGate({role,children}){
 const {accessToken}=useAuthSession(),location=useLocation(),[result,setResult]=useState(null),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!accessToken)return;const controller=new AbortController();setResult(null);userApi.getMe({signal:controller.signal}).then(response=>{if(controller.signal.aborted)return;const user=profileFromResponse(response);saveSessionUser(user);setResult({token:accessToken,user});}).catch(error=>{if(!controller.signal.aborted)setResult({token:accessToken,error:apiErrorMessage(error,"Không thể xác minh phiên đăng nhập.")});});return()=>controller.abort();},[accessToken,attempt]);
 if(!accessToken)return <Navigate to="/login" replace state={{from:location.pathname}}/>;
 if(result?.token!==accessToken)return <p role="status" className="p-8">Đang xác minh phiên đăng nhập…</p>;
 if(result.error)return <Panel title="Không thể xác minh phiên đăng nhập"><Message error={result.error}/><Button onClick={()=>setAttempt(v=>v+1)}>Thử lại</Button></Panel>;
 const expected=role==='staff'?'FACILITY_STAFF':'FACILITY_MANAGER';
 if(result.user.role!==expected)return <Panel title="Không có quyền truy cập"><p role="alert">Trang này yêu cầu vai trò {expected}. Máy chủ kiểm soát quyền truy cập.</p></Panel>;
 return children;
}
