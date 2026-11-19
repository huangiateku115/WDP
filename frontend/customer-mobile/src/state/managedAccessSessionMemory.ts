import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {objectId} from '../api/contracts/core';

function key(owner:string,reservationId:string){return `wdp.access.${objectId.parse(owner)}.${objectId.parse(reservationId)}`;}
export async function rememberManagedAccessSession(owner:string,reservationId:string,sessionId:string){
  const storageKey=key(owner,reservationId),value=objectId.parse(sessionId);
  if(Platform.OS==='web')globalThis.localStorage.setItem(storageKey,value);
  else await SecureStore.setItemAsync(storageKey,value);
}
export async function readManagedAccessSession(owner:string,reservationId:string){
  const storageKey=key(owner,reservationId),value=Platform.OS==='web'?globalThis.localStorage.getItem(storageKey):await SecureStore.getItemAsync(storageKey);
  const parsed=objectId.safeParse(value);
  return parsed.success?parsed.data:null;
}
