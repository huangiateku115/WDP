from pathlib import Path
files={}
files['src/lib/authSession.js']=r'''import {useSyncExternalStore} from 'react';
// Reuse the existing access-token/user keys. Business demo stores are independent.
const keys={access:'SelfStorage_token',refresh:'SelfStorage_refreshToken',user:'SelfStorage_user'};
const listeners=new Set();
function read(){let user=null;try{const value=JSON.parse(localStorage.getItem(keys.user));if(value&&typeof value==='object'&&!Array.isArray(value))user=value;}catch{/* Ignore invalid cached identity. */}return {accessToken:localStorage.getItem(keys.access),refreshToken:localStorage.getItem(keys.refresh),user};}
let snapshot=read();
function publish(){snapshot=read();listeners.forEach(fn=>fn());}
window.addEventListener('storage',event=>{if(event.key===null||Object.values(keys).includes(event.key))publish();});
export const getAccessToken=()=>localStorage.getItem(keys.access);
export const getRefreshToken=()=>localStorage.getItem(keys.refresh);
export function saveAuthSession({accessToken,refreshToken,user=null}){if(typeof accessToken!=='string'||!accessToken.trim()||typeof refreshToken!=='string'||!refreshToken.trim())throw Error('The login response did not include the required session tokens.');localStorage.setItem(keys.access,accessToken);localStorage.setItem(keys.refresh,refreshToken);if(user&&typeof user==='object')localStorage.setItem(keys.user,JSON.stringify(user));else localStorage.removeItem(keys.user);publish();}
export function saveSessionUser(user){if(!getAccessToken())return;localStorage.setItem(keys.user,JSON.stringify(user));publish();}
export function clearAuthSession(){Object.values(keys).forEach(key=>localStorage.removeItem(key));publish();}
export function useAuthSession(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>snapshot);}
export function profileFromResponse(response){const user=response?.data?.data??response?.data;if(!user||typeof user!=='object'||Array.isArray(user))throw Error('The backend returned an invalid profile response.');return user;}
'''
files['src/lib/apiError.js']=r'''export function apiErrorMessage(error,fallback='The request could not be completed. Please try again.'){const body=error?.response?.data;const message=typeof body?.message==='string'?body.message:typeof body?.error?.message==='string'?body.error.message:typeof body?.error==='string'?body.error:null;if(message?.trim())return message.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,400);if(error?.response?.status===401)return 'Your session has expired. Please sign in again.';if(error?.isAxiosError&&!error.response)return 'Cannot connect to the backend. Please check that it is running and try again.';if(!error?.isAxiosError&&typeof error?.message==='string')return error.message.slice(0,400);return fallback;}
'''
files['src/api/confirmedContract.js']=r'''// Contract source: backend team's WDP.postman_collection.json.
// This list constrains network integration; it is not an authorization guard.
export function apiBaseURL(value){const base=value.replace(/\/+$/,'');if(base.endsWith('/api/v1'))return base;if(base.endsWith('/api'))return `${base}/v1`;return `${base}/api/v1`;}
export function assertConfirmedRequest(config){const method=(config.method||'get').toUpperCase();const path=String(config.url||'').replace(/^\//,'').replace(/\/$/,'');const confirmed={'POST':['auth/login','auth/logout','users/register','users'],GET:['users/me','users'],PUT:['users/me/profile','users/me/password']};const allowed=confirmed[method]?.includes(path)||(method==='PATCH'&&/^users\/[^/]+\/role$/.test(path))||(method==='DELETE'&&/^users\/[^/]+$/.test(path));if(!allowed)throw Error('This business API is not confirmed by the backend collection. Use the available demo workspace until its API is provided.');}
'''
files['src/api/userApi.js']=r'''import axiosClient from './axiosClient';
const userApi={
 getMe:config=>axiosClient.get('/users/me/',config),
 updateProfile:({displayName,phone})=>axiosClient.put('/users/me/profile',{displayName,phone}),
 changePassword:({oldPassword,newPassword})=>axiosClient.put('/users/me/password',{oldPassword,newPassword}),
};
export default userApi;
'''
files['src/components/common/LogoutButton.jsx']=r'''import {useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {LogOut} from 'lucide-react';
import {Button} from '@/components/ui/button';
import authApi from '@/api/authApi';
import {useAuthSession,getAccessToken,getRefreshToken,clearAuthSession} from '@/lib/authSession';
import {apiErrorMessage} from '@/lib/apiError';
export default function LogoutButton({compact=false}){const session=useAuthSession(),nav=useNavigate(),busy=useRef(false),[pending,setPending]=useState(false),[error,setError]=useState('');if(!session.accessToken)return null;async function logout(){if(busy.current)return;busy.current=true;setPending(true);setError('');const token=getAccessToken();try{const refreshToken=getRefreshToken();if(!refreshToken)throw Error('This session is missing its refresh token. Please sign in again.');await authApi.logout({refreshToken});if(getAccessToken()===token){clearAuthSession();nav('/login',{replace:true});}}catch(err){setError(apiErrorMessage(err,'Unable to sign out. Please try again.'));}finally{busy.current=false;setPending(false);}}return <div className="relative"><Button variant="outline" size={compact?'icon':'default'} onClick={logout} disabled={pending} aria-label={pending?'Signing out':'Sign out'}><LogOut size={16}/>{!compact&&(pending?'Signing out…':'Sign out')}</Button>{error&&<p role="alert" className={compact?'absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border bg-white p-3 text-xs text-red-700 shadow-lg':'mt-3 max-w-sm text-sm text-red-700'}>{error}</p>}</div>;}
'''
for name,content in files.items():
 p=Path(name);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content,encoding='utf-8')
p=Path('src/api/axiosClient.js');s=p.read_text(encoding='utf-8-sig');s=s.replace('import axios from "axios";', 'import axios from "axios";\nimport {apiBaseURL, assertConfirmedRequest} from "./confirmedContract";\nimport {getAccessToken, clearAuthSession} from "@/lib/authSession";');s=s.replace('import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"','apiBaseURL(import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1")');s=s.replace('  const token = localStorage.getItem("SelfStorage_token");\n  if (token) config.headers.Authorization = `Bearer ${token}`;', '  assertConfirmedRequest(config);\n  const token = getAccessToken();\n  if (token && !config.skipAuth) config.headers.Authorization = `Bearer ${token}`;');s=s.replace('    if (error.response?.status === 401) {\n      localStorage.removeItem("SelfStorage_token");\n      localStorage.removeItem("SelfStorage_user");\n    }','    const token = getAccessToken();\n    if (error.response?.status === 401 && token && !error.config?.skipAuth && error.config?.headers?.Authorization === `Bearer ${token}`) {\n      clearAuthSession();\n    }');p.write_text(s,encoding='utf-8')
p=Path('src/api/authApi.js');s=p.read_text(encoding='utf-8-sig');start=s.index('const USE_MOCK');end=s.index('const authApi');s=s[:start]+s[end:];start=s.index('    if (USE_MOCK)',s.index('login:'));end=s.index('    return axiosClient.post("/auth/login"',start);s=s[:start]+s[end:];s=s.replace('axiosClient.post("/auth/login", { email, password })','axiosClient.post("/auth/login", { email, password }, {skipAuth:true})');start=s.index('    if (USE_MOCK)',s.index('register:'));end=s.index('    return axiosClient.post',start);s=s[:start]+s[end:];s=s.replace('register: async (payload)', 'register: async ({email, password, displayName, phone})');s=s.replace('axiosClient.post("/auth/register", payload)', 'axiosClient.post("/users/register", {email, password, displayName, phone}, {skipAuth:true})');start=s.index('    if (USE_MOCK)',s.index('me:'));end=s.index('    return axiosClient.get',start);s=s[:start]+s[end:];s=s.replace('axiosClient.get("/auth/me")','axiosClient.get("/users/me/")');s=s.replace('  me: async () =>', '  logout: async ({refreshToken}) => axiosClient.post("/auth/logout", {refreshToken}),\n\n  me: async () =>');p.write_text(s,encoding='utf-8')
