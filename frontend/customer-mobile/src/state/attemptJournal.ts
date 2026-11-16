import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {CryptoDigestAlgorithm, digestStringAsync, randomUUID} from 'expo-crypto';
import {z} from 'zod';
import {apiBase} from '../api/client';
import {objectId} from '../api/contracts/core';
import {managedCreateBody,selfBody,utc} from '../api/contracts/booking';
const visitBody=z.object({reservationId:objectId,purpose:z.enum(['INBOUND','OUTBOUND','RELOCATION','INSPECTION']),
  startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),note:z.string().max(500).optional()}).strict();

const attemptSchema = z.object({key:z.string().regex(/^wdp-mobile-[a-f0-9-]{36}$/i),resourceId:objectId.optional(),visitRevision:z.number().int().nonnegative().optional(),inboundBody:z.record(z.string(),z.unknown()).optional(),bookingBody:selfBody.optional(),visitBody:visitBody.optional(),priceReview:z.object({quotedAmount:z.number().finite().nonnegative(),authoritativeAmount:z.number().finite().nonnegative(),accepted:z.boolean()}).optional(),managedBooking: z.object({body:managedCreateBody,endDate:utc,quotedAmount:z.number().finite().nonnegative().optional()}).optional()});
type Attempt=z.infer<typeof attemptSchema>;
const claiming=new Set<string>();

export async function journal(scope:'managed-v3-inbound'|'managed-v3-full-rent'|'managed-v3-booking'|'managed-v3-visit-create'|'managed-v3-visit-amend'|'managed-v3-price-consent'|'booking'|'deposit'|'balance'|'full-rent',owner:string,identity:string) {
  const hash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,JSON.stringify([apiBase,objectId.parse(owner),scope,identity]));
  const key='wdp.mobile.attempt.'+hash;
  const store={
    async read() {
      const raw=Platform.OS==='web'?globalThis.localStorage.getItem(key):await SecureStore.getItemAsync(key);
      return raw==null?null:attemptSchema.parse(JSON.parse(raw));
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
    async claim(value:Attempt, replaceKey?: string){
      if(claiming.has(key))return false;
      claiming.add(key);
      try{
        const previous = await store.read();
        if (previous?.key !== replaceKey) return false;
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
