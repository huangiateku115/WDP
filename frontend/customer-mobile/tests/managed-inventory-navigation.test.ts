import {managedRentalListTarget,managedReservationDetailTarget,managedReservationInventoryTarget,managedSessionAvailabilityMessage} from '../src/domain/managedInventoryNavigation';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const reservationId='3'.repeat(24),facilityId='2'.repeat(24);

it('navigates to a dedicated Reservation inventory route with explicit scope',()=>{
  expect(managedReservationInventoryTarget(reservationId,facilityId)).toEqual({
    pathname:'/(tabs)/inventory/managed/[reservationId]',params:{reservationId,facilityId},
  });
});

it('can open a Reservation inventory route without requiring a facility query parameter',()=>{
  expect(managedReservationInventoryTarget(reservationId)).toEqual({
    pathname:'/(tabs)/inventory/managed/[reservationId]',params:{reservationId},
  });
});

it('preserves the checked-in Session and operation when entering Reservation inventory from Session activity',()=>{
  const sessionId='5'.repeat(24);
  expect(managedReservationInventoryTarget(reservationId,facilityId,{sessionId,operation:'OUTBOUND'})).toEqual({
    pathname:'/(tabs)/inventory/managed/[reservationId]',params:{reservationId,facilityId,sessionId,operation:'OUTBOUND'},
  });
});

it('preserves Session ID from activity through selected SKU to the operation route and refetches detail',()=>{
  const dashboard=readFileSync(resolve(process.cwd(),'src','screens','ManagedDashboard.tsx'),'utf8');
  const detail=readFileSync(resolve(process.cwd(),'src','screens','LiveAccount.tsx'),'utf8');
  const operation=readFileSync(resolve(process.cwd(),'src','screens','ManagedStockOperations.tsx'),'utf8');
  expect(dashboard).toContain('accessSessionId:sessionId');
  expect(detail).toContain("params:{id,...(accessSessionId?{sessionId:accessSessionId}:{})}");
  expect(operation).toContain('managedReservationReads.session(rental.data,owner,body.accessSessionId)');
  expect(operation).toContain('requestedSessionDetail.data');
});

it('returns directly to the selected Reservation detail route',()=>{
  expect(managedReservationDetailTarget(reservationId,facilityId)).toEqual({
    pathname:'/managed/[facilityId]/confirmation',params:{facilityId,reservationId},
  });
});

it('returns Managed Rental Detail to the Kho thuê tab without relying on stack history',()=>{
  expect(managedRentalListTarget()).toBe('/(tabs)/rentals');
  expect(existsSync(resolve(process.cwd(),'app','(tabs)','rentals.tsx'))).toBe(true);
  const source=readFileSync(resolve(process.cwd(),'src','screens','ManagedCatalog.tsx'),'utf8');
  expect(source).toContain('backButton={{onPress:()=>router.replace(managedRentalListTarget())}}');
  expect(source).not.toMatch(/router\.back\(\)/);
});

it('removes manual Customer Operation Lookup UI while retaining the API lookup for journal recovery',()=>{
  const uiPath=resolve(process.cwd(),'src','components','ManagedOperationLookup.tsx');
  const detail=readFileSync(resolve(process.cwd(),'src','screens','LiveAccount.tsx'),'utf8');
  const api=readFileSync(resolve(process.cwd(),'src','api','mobileRepository.ts'),'utf8');
  expect(existsSync(uiPath)).toBe(false);
  expect(detail).not.toContain('ManagedOperationLookup');
  expect(detail).not.toContain('Kiểm tra thao tác đã gửi');
  expect(api).toContain('async inventoryOperation(');
});

it('distinguishes missing, expired, revoked, wrong scope, and wrong purpose sessions',()=>{
  const base={status:'ACTIVE',startedAt:'2026-11-19T09:00:00.000Z',expiresAt:'2026-11-19T11:00:00.000Z',facilityId,reservationId,
    scopedReservationIds:[reservationId],allowedPurposes:['INBOUND','OUTBOUND','RELOCATION']};
  const now=Date.parse('2026-11-19T10:00:00.000Z');
  expect(managedSessionAvailabilityMessage([],reservationId,facilityId,'OUTBOUND',now)).toContain('Chưa có phiên');
  expect(managedSessionAvailabilityMessage([{...base,expiresAt:'2026-11-19T09:30:00.000Z'}],reservationId,facilityId,'OUTBOUND',now)).toContain('hết hạn');
  expect(managedSessionAvailabilityMessage([{...base,status:'REVOKED'}],reservationId,facilityId,'OUTBOUND',now)).toContain('thu hồi');
  expect(managedSessionAvailabilityMessage([{...base,reservationId:'9'.repeat(24),scopedReservationIds:[]}],reservationId,facilityId,'OUTBOUND',now)).toContain('không áp dụng');
  expect(managedSessionAvailabilityMessage([{...base,allowedPurposes:['INBOUND']}],reservationId,facilityId,'OUTBOUND',now)).toContain('không được cấp quyền');
  expect(managedSessionAvailabilityMessage([{...base,reservationId:'9'.repeat(24),scopedReservationIds:[reservationId]}],reservationId,facilityId,'RELOCATION',now)).toContain('Reservation nguồn');
});

it('registers the overview and Reservation detail as routes in the Inventory Stack',()=>{
  const app=resolve(process.cwd(),'app');
  const overview=resolve(app,'(tabs)','inventory','index.tsx');
  const detail=resolve(app,'(tabs)','inventory','managed','[reservationId].tsx');
  const stack=resolve(app,'(tabs)','inventory','_layout.tsx');
  const tabs=readFileSync(resolve(app,'(tabs)','_layout.tsx'),'utf8');
  expect(existsSync(overview)).toBe(true);
  expect(existsSync(detail)).toBe(true);
  expect(readFileSync(overview,'utf8')).toContain('Inventory');
  expect(readFileSync(detail,'utf8')).toContain('ReservationInventoryDetail');
  expect(readFileSync(stack,'utf8')).toContain('<Stack');
  expect(tabs).toContain('name="inventory"');
  expect(tabs).toContain("navigation.navigate('inventory' as never,{screen:'index'} as never)");
  expect(tabs).toContain('popToTopOnBlur:true');
  expect(existsSync(resolve(app,'(tabs)','inventory.tsx'))).toBe(false);
});
