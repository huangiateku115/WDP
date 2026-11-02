import {useCareSessionStore} from './useCareSessionStore';
import {useRequestDraftStore} from './useRequestDraftStore';
import {useInventoryDraftStore} from './useInventoryDraftStore';
import {useManagedBookingStore} from './useManagedBookingStore';
import {useBookingStore} from './useBookingStore';
import {create} from 'zustand';
import type {Fixtures} from '../domain/models';
import {customerFixtures} from '../fixtures/customer';

interface CustomerState {
  demoSession:boolean;fixtures:Fixtures;compactCards:boolean;
  enterDemo:()=>void;leaveDemo:()=>void;toggleCompactCards:()=>void;
  resetFixtures:()=>void;
}
// Memory only: this is not authentication, token storage or a backend session.
export const useCustomerStore=create<CustomerState>(set=>({
  demoSession:false,fixtures:customerFixtures,compactCards:false,
  enterDemo:()=>set({demoSession:true}),leaveDemo:()=>{useCareSessionStore.getState().clear();useRequestDraftStore.getState().clear();useInventoryDraftStore.getState().clear();useBookingStore.getState().clear();useManagedBookingStore.getState().clear();set({demoSession:false,compactCards:false});},
  toggleCompactCards:()=>set(s=>({compactCards:!s.compactCards})),
  resetFixtures:()=>set({fixtures:customerFixtures}),
}));
