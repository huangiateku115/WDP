import {buildManagedOutboundLine,managedOutboundPreviewSourceCells} from '../src/domain/managedV3Outbound';

const spec={itemSpecId:'a'.repeat(24),revision:7,quantityAvailable:10,stockKind:'RECEIPT_LOT'};

it('builds partial and full outbound quantities without a client-selected receipt or Cell',()=>{
  expect(buildManagedOutboundLine(spec,3)).toEqual({lineId:'line-1',itemSpecId:spec.itemSpecId,itemSpecRevision:7,quantity:3});
  expect(buildManagedOutboundLine(spec,10)).toEqual({lineId:'line-1',itemSpecId:spec.itemSpecId,itemSpecRevision:7,quantity:10});
  expect(buildManagedOutboundLine(spec,3)).not.toHaveProperty('cellAllocations');
});

it.each(['',0,-1,1.5,11,'not-a-number'] as const)('rejects an invalid or unavailable quantity: %s',quantity=>{
  expect(()=>buildManagedOutboundLine(spec,quantity)).toThrow();
});

it('rejects no-stock and mixed stock specifications before preview',()=>{
  expect(()=>buildManagedOutboundLine({...spec,quantityAvailable:0},1)).toThrow();
  expect(()=>buildManagedOutboundLine({...spec,stockKind:'MIXED_UNSUPPORTED'},1)).toThrow();
});

it('uses Backend preview sources for FIFO across multiple receipts and Cells',()=>{
  expect(managedOutboundPreviewSourceCells([
    {sources:[{cellId:'b'.repeat(24)},{cellId:'c'.repeat(24)}]},
    {sources:[{cellId:'b'.repeat(24)}]},
  ],['b'.repeat(24),'c'.repeat(24)])).toEqual(['b'.repeat(24),'c'.repeat(24)]);
  expect(()=>managedOutboundPreviewSourceCells([{sources:[{cellId:'d'.repeat(24)}]}],['b'.repeat(24)])).toThrow();
  expect(()=>managedOutboundPreviewSourceCells([{sources:[]}],['b'.repeat(24)])).toThrow();
});
