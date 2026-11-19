import {buildManagedRelocationRequest,managedRelocationCells,type ManagedRelocationDraft} from '../src/domain/managedV3Relocation';

const [session,sourceReservation,destinationReservation,spec,source,destination,otherCell]=['1'.repeat(24),'2'.repeat(24),'3'.repeat(24),'4'.repeat(24),'5'.repeat(24),'6'.repeat(24),'7'.repeat(24)] as const;
const lot=(overrides:Partial<ManagedRelocationDraft>={}):ManagedRelocationDraft=>({lineId:'line-1',itemSpecId:spec,itemSpecRevision:2,kind:'LOT',sourceReservationId:sourceReservation,destinationReservationId:destinationReservation,
  sourceCellId:source,destinationCellId:destination,quantity:2,availableQuantity:5,...overrides});
const base={accessSessionId:session,sessionRevision:3,skuRevision:9};

it('builds one scoped, multi-line lot request without selecting receipt allocation',()=>{
  const result=buildManagedRelocationRequest({...base,lines:[lot(),lot({lineId:'line-2',itemSpecId:'8'.repeat(24),quantity:1})]});
  expect(result.lines).toHaveLength(2);expect(result.lines[0]).toMatchObject({sourceCellId:source,destinationCellId:destination,quantity:2});
  expect(result.lines[0]).not.toHaveProperty('receiptId');
});

it.each([0,1.5,6,Number.MAX_SAFE_INTEGER+1])('rejects an invalid lot quantity %s',quantity=>{
  expect(()=>buildManagedRelocationRequest({...base,lines:[lot({quantity})]})).toThrow();
});

it('enforces line bounds, IDs, and one source and destination Reservation per operation',()=>{
  expect(()=>buildManagedRelocationRequest({...base,lines:[lot({lineId:'bad line'})]})).toThrow();
  expect(()=>buildManagedRelocationRequest({...base,lines:[lot({sourceReservationId:'invalid'})]})).toThrow();
  expect(()=>buildManagedRelocationRequest({...base,lines:[lot(),lot({lineId:'line-2',sourceReservationId:'8'.repeat(24)})]})).toThrow();
  expect(()=>buildManagedRelocationRequest({...base,lines:Array.from({length:51},(_,index)=>lot({lineId:`line-${index}`}))})).toThrow();
});

it('moves an intact item across multiple destination Cells only when weight and volume are conserved',()=>{
  const draft:ManagedRelocationDraft={lineId:'instance-1',itemSpecId:spec,itemSpecRevision:2,kind:'INSTANCE',sourceReservationId:sourceReservation,destinationReservationId:destinationReservation,
    quantity:1,availableQuantity:1,itemInstanceId:'instance-a',sourceCellIds:[source,otherCell],instanceWeightKg:12.345,instanceVolumeM3:.456789,
    destinationAllocations:[{cellId:'8'.repeat(24),reservationId:destinationReservation,weightKg:5,volumeM3:.2},{cellId:'9'.repeat(24),reservationId:destinationReservation,weightKg:7.345,volumeM3:.256789}]};
  const result=buildManagedRelocationRequest({...base,lines:[draft],confirmed:true});
  expect(result.customerAttestation).toBe('CONFIRMED');expect(result.lines[0]).toMatchObject({itemInstanceId:'instance-a',quantity:1});
  expect(managedRelocationCells([draft])).toEqual(expect.arrayContaining([source,otherCell,'8'.repeat(24),'9'.repeat(24)]));
  const duplicate={...draft,destinationAllocations:[...draft.destinationAllocations!,{...draft.destinationAllocations![0]!,cellId:'8'.repeat(24)}]};
  expect(()=>buildManagedRelocationRequest({...base,lines:[duplicate]})).toThrow();
  expect(()=>buildManagedRelocationRequest({...base,lines:[{...draft,destinationAllocations:[{...draft.destinationAllocations![0]!,weightKg:4}]}]})).toThrow();
});

it('rejects a destination Cell that belongs to the source footprint',()=>{
  const draft:ManagedRelocationDraft={lineId:'instance-1',itemSpecId:spec,itemSpecRevision:2,kind:'INSTANCE',sourceReservationId:sourceReservation,destinationReservationId:destinationReservation,
    quantity:1,itemInstanceId:'instance-a',sourceCellIds:[source],instanceWeightKg:2,instanceVolumeM3:.1,destinationAllocations:[{cellId:source,reservationId:destinationReservation,weightKg:2,volumeM3:.1}]};
  expect(()=>buildManagedRelocationRequest({...base,lines:[draft]})).toThrow();
});
