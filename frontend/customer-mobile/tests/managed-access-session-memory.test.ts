const mockValues=new Map<string,string>();
jest.mock('expo-secure-store',()=>({getItemAsync:async(key:string)=>mockValues.get(key)??null,
  setItemAsync:async(key:string,value:string)=>{mockValues.set(key,value);}}));

import {readManagedAccessSession,rememberManagedAccessSession} from '../src/state/managedAccessSessionMemory';

const customerA='1'.repeat(24),customerB='2'.repeat(24),reservationA='3'.repeat(24),reservationB='4'.repeat(24),sessionA='5'.repeat(24);
beforeEach(()=>mockValues.clear());

test('remembered Session identity stays isolated by Customer and Reservation',async()=>{
  await rememberManagedAccessSession(customerA,reservationA,sessionA);
  await expect(readManagedAccessSession(customerA,reservationA)).resolves.toBe(sessionA);
  await expect(readManagedAccessSession(customerB,reservationA)).resolves.toBeNull();
  await expect(readManagedAccessSession(customerA,reservationB)).resolves.toBeNull();
});
