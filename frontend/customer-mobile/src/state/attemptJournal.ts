import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {CryptoDigestAlgorithm, digestStringAsync, randomUUID} from 'expo-crypto';
import {z} from 'zod';
import {apiBase} from '../api/client';
import {objectId} from '../api/contracts/core';
import {selfBody} from '../api/contracts/booking';

const attemptSchema = z.object({key:z.string().regex(/^wdp-mobile-[a-f0-9-]{36}$/i),resourceId:objectId.optional(),bookingBody:selfBody.optional()});
type Attempt=z.infer<typeof attemptSchema>;
const claiming=new Set<string>();

export async function journal(scope:'booking'|'deposit'|'balance',owner:string,identity:string) {
  const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,JSON.stringify([apiBase,objectId.parse(owner),scope,identity]));
  const key='wdp.mobile.attempt.'+hash;
  const store={
    async read() {
      const raw=Platform.OS==='web'?globalThis.localStorage.getItem(key):await SecureStore.getItemAsync(key);
      return raw===null?null:attemptSchema.parse(JSON.parse(raw));
    },
    async write(value:Attempt) {
      const raw=JSON.stringify(attemptSchema.parse(value));
      if(Platform.OS==='web') globalThis.localStorage.setItem(key,raw);
      else await SecureStore.setItemAsync(key,raw);
    },
    async clear() {
      if(Platform.OS==='web')globalThis.localStorage.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    },
    async claim(value:Attempt){
      if(claiming.has(key))return false;
      claiming.add(key);
      try{
        if(await store.read())return false;
        await store.write(value);
        return true;
      }finally{claiming.delete(key);}
    },
  };
  return store;
}

export function newAttempt():Attempt {
  return {key:'wdp-mobile-'+randomUUID()};
}
