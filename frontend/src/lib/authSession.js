import {useSyncExternalStore} from 'react';
// Reuse the existing access-token/user keys. Business demo stores are independent.
const keys={access:'SelfStorage_token',refresh:'SelfStorage_refreshToken',user:'SelfStorage_user'};
const listeners=new Set();
const identity=user=>Object.fromEntries(['id','displayName','email','phone','role'].filter(key=>typeof user?.[key]==='string').map(key=>[key,user[key]]));
function read(){let user=null;try{const value=JSON.parse(localStorage.getItem(keys.user));if(value&&typeof value==='object'&&!Array.isArray(value))user=value;}catch{/* Ignore invalid cached identity. */}return {accessToken:localStorage.getItem(keys.access),refreshToken:localStorage.getItem(keys.refresh),user};}
let snapshot=read();
function publish(){snapshot=read();listeners.forEach(fn=>fn());}
window.addEventListener('storage',event=>{if(event.key===null||Object.values(keys).includes(event.key))publish();});
export const getAccessToken=()=>localStorage.getItem(keys.access);
export const getRefreshToken=()=>localStorage.getItem(keys.refresh);
export function saveAuthSession({accessToken,refreshToken,user=null}){if(typeof accessToken!=='string'||!accessToken.trim()||typeof refreshToken!=='string'||!refreshToken.trim())throw Error('The login response did not include the required session tokens.');localStorage.setItem(keys.access,accessToken);localStorage.setItem(keys.refresh,refreshToken);if(user&&typeof user==='object')localStorage.setItem(keys.user,JSON.stringify(identity(user)));else localStorage.removeItem(keys.user);publish();}
export function saveSessionUser(user){if(!getAccessToken())return;localStorage.setItem(keys.user,JSON.stringify(identity(user)));publish();}
export function clearAuthSession(){Object.values(keys).forEach(key=>localStorage.removeItem(key));publish();}
export function useAuthSession(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>snapshot);}
export function profileFromResponse(response){const user=response?.data?.data??response?.data;if(!user||typeof user!=='object'||Array.isArray(user))throw Error('The backend returned an invalid profile response.');return user;}
