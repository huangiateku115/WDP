import {useSyncExternalStore} from 'react';
// Reuse the existing access-token/user keys. Business demo stores are independent.
const keys={access:'SelfStorage_token',refresh:'SelfStorage_refreshToken',user:'SelfStorage_user'};
const rememberKey='SelfStorage_remember',logoutKey='SelfStorage_logout';
const logoutNoticeKey='SelfStorage_logoutWarning';
const listeners=new Set();
const identity=user=>{const value={...user,id:user?.id||user?._id,assignedFacilityId:typeof user?.assignedFacilityId==='object'?user.assignedFacilityId?._id:user?.assignedFacilityId};return Object.fromEntries(['id','displayName','email','phone','role','assignedFacilityId'].filter(key=>typeof value?.[key]==='string').map(key=>[key,value[key]]));};
const stored=(storage,key)=>{try{return storage.getItem(key);}catch{return null;}};
const validToken=value=>typeof value==='string'&&!!value.trim()&&!['null','undefined'].includes(value);
function remove(storage){for(const key of Object.values(keys)){try{storage.removeItem(key);}catch{/* Storage can be unavailable. */}}}
// Existing pre-Remember-Me sessions remain usable in this tab, without opting into persistence.
if(stored(localStorage,keys.access)&&stored(localStorage,rememberKey)!=='true'){
  try{for(const key of Object.values(keys)){const value=stored(localStorage,key);if(value&&!stored(sessionStorage,key))sessionStorage.setItem(key,value);}}catch{/* No insecure fallback if storage is unavailable. */}
  remove(localStorage);
}
function read(){
  const persistent=stored(localStorage,rememberKey)==='true'&&validToken(stored(localStorage,keys.access));
  const storage=persistent?localStorage:sessionStorage;
  const access=stored(storage,keys.access),refresh=stored(storage,keys.refresh);
  let user=null;try{const value=JSON.parse(stored(storage,keys.user));if(value&&typeof value==='object'&&!Array.isArray(value))user=identity(value);}catch{/* Ignore invalid cached identity; GET /users/me remains authoritative. */}
  return {accessToken:validToken(access)?access:null,refreshToken:validToken(refresh)?refresh:null,user,remembered:!!persistent};
}
let snapshot=read();
function publish(){snapshot=read();listeners.forEach(fn=>fn());}
window.addEventListener('storage',event=>{
  if(event.key===logoutKey||event.key===null)remove(sessionStorage);
  if(event.key===null||event.key===logoutKey||event.key===rememberKey||Object.values(keys).includes(event.key))publish();
});
export const getAccessToken=()=>read().accessToken;
export const getRefreshToken=()=>read().refreshToken;
export function saveAuthSession({accessToken,refreshToken,user=null,remember=false}){
  if(!validToken(accessToken)||!validToken(refreshToken))throw Error('The login response did not include the required session tokens.');
  remove(localStorage);remove(sessionStorage);localStorage.removeItem(rememberKey);
  try{
    const storage=remember?localStorage:sessionStorage;
    storage.setItem(keys.access,accessToken);storage.setItem(keys.refresh,refreshToken);
    if(user&&typeof user==='object')storage.setItem(keys.user,JSON.stringify(identity(user)));
    if(remember)localStorage.setItem(rememberKey,'true');
  }catch{remove(localStorage);remove(sessionStorage);publish();throw Error('Your browser could not store the session. Please allow site storage and sign in again.');}
  publish();
}
export function saveSessionUser(user){const session=read();if(!session.accessToken)return;try{(session.remembered?localStorage:sessionStorage).setItem(keys.user,JSON.stringify(identity(user)));}catch{/* A cached display profile is optional. */}publish();}
export function clearAuthSession({logoutWarning=false}={}){remove(localStorage);remove(sessionStorage);try{localStorage.removeItem(rememberKey);localStorage.setItem(logoutKey,`${Date.now()}:${Math.random()}`);if(logoutWarning)sessionStorage.setItem(logoutNoticeKey,'true');}catch{/* Still clear the current tab. */}publish();}
export function consumeLogoutWarning(clear=false){const value=stored(sessionStorage,logoutNoticeKey)==='true';try{if(clear)sessionStorage.removeItem(logoutNoticeKey);}catch{/* Non-sensitive optional notice. */}return value;}
export function useAuthSession(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>snapshot);}
export function profileFromResponse(response){const user=response?.data?.data??response?.data;if(!user||typeof user!=='object'||Array.isArray(user))throw Error('The backend returned an invalid profile response.');return user;}
