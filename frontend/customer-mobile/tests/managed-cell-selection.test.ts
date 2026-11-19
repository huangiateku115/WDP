import {toggleManagedCellChoice,type ManagedCellChoice} from '../src/domain/managedCellSelection';

const choice=(id:string,zoneName='Zone',rackCode='R1',levelNumber=1):ManagedCellChoice=>({
  id,code:'Cell '+id,maxVolumeM3:1,zoneName,rackCode,levelNumber,
});

test('Managed booking selection retains Cells from different racks, levels and zones',()=>{
  const first=choice('1'.repeat(24),'Zone A','R1',1);
  const second=choice('2'.repeat(24),'Zone A','R2',2);
  const third=choice('3'.repeat(24),'Zone B','R3',1);
  const selected=toggleManagedCellChoice(toggleManagedCellChoice(toggleManagedCellChoice([],first),second),third);
  expect(selected).toEqual([first,second,third]);
  expect(selected.reduce((sum,row)=>sum+row.maxVolumeM3,0)).toBe(3);
});

test('Managed booking selection removes one Cell and enforces the Backend limit of 100',()=>{
  const first=choice('1'.repeat(24)),second=choice('2'.repeat(24));
  expect(toggleManagedCellChoice([first,second],first)).toEqual([second]);
  const hundred=Array.from({length:100},(_,index)=>choice(index.toString(16).padStart(24,'0')));
  expect(toggleManagedCellChoice(hundred,choice('f'.repeat(24)))).toHaveLength(100);
});
