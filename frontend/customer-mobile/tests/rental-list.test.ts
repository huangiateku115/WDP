import {emptyRentalFilters,filterAndSortRentals,normalizeRentalSearch,type RentalListFilters} from '../src/domain/rentalList';
import type {ReservationDto} from '../src/api/contracts/customer';

const owner='aaaaaaaaaaaaaaaaaaaaaaaa',facility='bbbbbbbbbbbbbbbbbbbbbbbb';
const make=(id:string,overrides:Record<string,unknown>={})=>({
  _id:id.repeat(24).slice(0,24),reservationCode:`BKG-${id}`,customerId:owner,facilityId:{_id:facility,name:'Cơ sở Hồ Chí Minh'},
  storageUnitId:{_id:'cccccccccccccccccccccccc',unitCode:'HCM3-U01'},serviceType:'SELF_STORAGE',status:'ACTIVE',
  startDate:'2026-01-01T00:00:00.000Z',endDate:'2027-06-01T00:00:00.000Z',createdAt:'2026-01-01T00:00:00.000Z',...overrides,
}) as unknown as ReservationDto;
const defaults=():RentalListFilters=>({...emptyRentalFilters,statuses:[]});

test('search matches reservation code, facility, and customer-facing unit code',()=>{
 const rows=[make('1'),make('2',{reservationCode:'BKG-SECOND'}),make('3',{storageUnitId:{_id:'dddddddddddddddddddddddd',unitCode:'RACK-9'}})];
 expect(filterAndSortRentals(rows,' bkg-second ',defaults()).map(r=>r.reservationCode)).toEqual(['BKG-SECOND']);
 expect(filterAndSortRentals(rows,'ho chi minh',defaults())).toHaveLength(3);
 expect(filterAndSortRentals(rows,'rack-9',defaults()).map(r=>r.reservationCode)).toEqual(['BKG-3']);
});
test('search is case and accent insensitive for Vietnamese',()=>{
 expect(normalizeRentalSearch('  CƠ SỞ Hồ Chí Minh ')).toBe('co so ho chi minh');
 expect(filterAndSortRentals([make('1')],'co so ho chi minh',defaults())).toHaveLength(1);
});
test('service, facility, status and rental-term filters combine',()=>{
 const rows=[make('1'),make('2',{serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'PAID'}),make('3',{status:'CANCELLED'})];
 const f={...defaults(),service:'SELF_STORAGE' as const,facilityId:facility,statuses:['ACTIVE' as const]};
 expect(filterAndSortRentals(rows,'',f,Date.parse('2026-12-01T00:00:00Z')).map(r=>r.reservationCode)).toEqual(['BKG-1']);
 expect(filterAndSortRentals(rows,'',{...defaults(),statuses:['CONTRACT' as const]}).map(r=>r.reservationCode)).toEqual(['BKG-2']);
 expect(filterAndSortRentals([make('4',{endDate:'2026-12-15T00:00:00Z'})],'',{...defaults(),time:'ENDING_30_DAYS'},Date.parse('2026-12-01T00:00:00Z'))).toHaveLength(1);
 expect(filterAndSortRentals([make('5',{endDate:'2026-11-30T00:00:00Z'})],'',{...defaults(),time:'ENDED_TERM'},Date.parse('2026-12-01T00:00:00Z'))).toHaveLength(1);
});
test('newest/oldest use createdAt and end sorting uses rental endDate',()=>{
 const rows=[make('1',{createdAt:'2026-01-01T00:00:00Z',endDate:'2027-02-01T00:00:00Z'}),make('2',{createdAt:'2026-03-01T00:00:00Z',endDate:'2027-01-01T00:00:00Z'})];
 expect(filterAndSortRentals(rows,'',{...defaults(),sort:'NEWEST'}).map(r=>r.reservationCode)).toEqual(['BKG-2','BKG-1']);
 expect(filterAndSortRentals(rows,'',{...defaults(),sort:'OLDEST'}).map(r=>r.reservationCode)).toEqual(['BKG-1','BKG-2']);
 expect(filterAndSortRentals(rows,'',{...defaults(),sort:'END_ASC'}).map(r=>r.reservationCode)).toEqual(['BKG-2','BKG-1']);
});
test('cancelled and ended statuses do not get conflated',()=>{
 const rows=[make('1',{status:'CLOSED'}),make('2',{status:'CANCELLED'})];
 expect(filterAndSortRentals(rows,'',{...defaults(),statuses:['ENDED']}).map(r=>r.reservationCode)).toEqual(['BKG-1']);
 expect(filterAndSortRentals(rows,'',{...defaults(),statuses:['CANCELLED']}).map(r=>r.reservationCode)).toEqual(['BKG-2']);
});
