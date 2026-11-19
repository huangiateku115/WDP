import fs from 'node:fs';
import path from 'node:path';
import {managedSpecifications} from '../src/api/managedSpecifications';
import {wire} from '../src/api/client';

jest.mock('../src/api/client',()=>({wire:jest.fn(),MobileInputError:class MobileInputError extends Error{}}));

const mockWire=wire as jest.MockedFunction<typeof wire>;

beforeEach(()=>mockWire.mockReset());

it('maps the authenticated customer quantity-unit DTO identifiers used by Backend',async()=>{
  mockWire.mockResolvedValue({success:true,data:[{quantityUnitId:'a'.repeat(24),id:'a'.repeat(24),code:'PCS',name:'Cái',description:''}],
    pagination:{page:1,limit:100,total:1,totalPages:1}});
  await expect(managedSpecifications.units()).resolves.toEqual([{_id:'a'.repeat(24),code:'PCS',name:'Cái',isActive:true}]);
  expect(mockWire).toHaveBeenCalledWith('GET','/managed-inventory-catalog/quantity-units/active',expect.objectContaining({params:{page:1,limit:100}}));
});

it('keeps Item Specification list/create contract scoped to the owned active V3 SKU',async()=>{
  const owner='1'.repeat(24),skuId='2'.repeat(24),unitId='a'.repeat(24),specId='b'.repeat(24);
  const item={_id:skuId,customerId:owner,inventorySchemaVersion:3,status:'ACTIVE'} as never;
  const row={_id:specId,itemSpecId:specId,skuId,code:'BOX-DOC',name:'Hộp tài liệu',quantityUnitId:unitId,quantityUnit:'Cái',quantityUnitCode:'PCS',
    dimensionsM:{widthM:0.2,depthM:0.3,heightM:0.1},unitWeightKg:1,unitVolumeM3:0.006,revision:0,status:'ACTIVE'};
  mockWire.mockResolvedValueOnce({success:true,data:[row]}).mockResolvedValueOnce({success:true,data:row});
  await expect(managedSpecifications.list(item,owner)).resolves.toEqual([row]);
  await expect(managedSpecifications.save(item,owner,{code:'box-doc',name:'Hộp tài liệu',quantityUnitId:unitId,
    dimensionsM:{widthM:0.2,depthM:0.3,heightM:0.1},unitWeightKg:1},()=>true)).resolves.toEqual(row);
  expect(mockWire).toHaveBeenNthCalledWith(1,'GET',`/inventory-items/${skuId}/specifications`,expect.any(Object));
  expect(mockWire).toHaveBeenNthCalledWith(2,'POST',`/inventory-items/${skuId}/specifications`,expect.objectContaining({body:expect.objectContaining({code:'BOX-DOC',quantityUnitId:unitId})}));
});

it('does not accept malformed or inactive-looking unit data as an available selection',async()=>{
  mockWire.mockResolvedValue({success:true,data:[{_id:'a'.repeat(24),code:'PCS',name:'Cái'}],pagination:{page:1,limit:100,total:1,totalPages:1}});
  await expect(managedSpecifications.units()).rejects.toThrow();
});

it('uses dedicated create/edit routes and replaces the inline inbound form with a dedicated inbound route',()=>{
  const root=path.resolve(__dirname,'../app/inventory/[id]');
  expect(fs.existsSync(path.join(root,'specifications/new.tsx'))).toBe(true);
  expect(fs.existsSync(path.join(root,'specifications/[specId].tsx'))).toBe(true);
  expect(fs.readFileSync(path.join(root,'inbound.tsx'),'utf8')).toContain('ManagedInboundScreen');
  const detail=fs.readFileSync(path.resolve(__dirname,'../src/components/ManagedSpecifications.tsx'),'utf8');
  expect(detail).toContain("'/inventory/[id]/specifications/new'");
  expect(detail).not.toContain('Loại hàng mới</AppText>');
  const inbound=fs.readFileSync(path.resolve(__dirname,'../src/components/ManagedSkuEditor.tsx'),'utf8');
  expect(inbound).toContain("'/inventory/[id]/inbound'");
  expect(inbound).not.toContain('<ManagedInboundPreviewCard');
});

it('keeps inbound operation guards, renders resolved Cell labels and removes internal API notes from customer UI',()=>{
  const inbound=fs.readFileSync(path.resolve(__dirname,'../src/components/ManagedInboundPreviewCard.tsx'),'utf8');
  const api=fs.readFileSync(path.resolve(__dirname,'../src/api/managedInboundPreview.ts'),'utf8');
  expect(inbound).toContain('Cell đã chọn');
  expect(inbound).not.toContain('HTTP 410 (STOCK_WORKFLOW_NOT_AVAILABLE)');
  expect(inbound).toContain('COMMITTED_AND_READBACK_VERIFIED');
  expect(inbound).toContain('COMMITTED_READBACK_PENDING');
  expect(inbound).toContain('autoRecoveryAttempt.current===saved.key');
  expect(inbound).toContain('void reconcile(true)');
  expect(inbound).toContain('if(!retry){');
  expect(inbound).toContain('Phiếu nhập đang được kiểm tra. Vui lòng không gửi lại để tránh trùng hàng.');
  expect(inbound).not.toContain('khóa idempotency để khôi phục an toàn');
  expect(api).toContain("await wire('POST',path+'inbound/preview'");
  expect(api).toContain("await wire('POST',path+'inbound',{body,key})");
});
