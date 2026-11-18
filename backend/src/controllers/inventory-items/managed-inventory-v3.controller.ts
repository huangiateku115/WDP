import { Request, Response } from 'express';
import { ManagedInventoryV3Error, ManagedInventoryV3Service } from '../../services/inventory-items/managed-inventory-v3.service';
import { ManagedUnifiedInboundError, ManagedUnifiedInboundService } from '../../services/inventory-items/managed-unified-inbound.service';
import { ManagedUnifiedInboundDomainError } from '../../services/inventory-items/managed-unified-inbound.domain';
import { customerSafeStockDto, ManagedCellStockReadService } from '../../services/inventory-items/managed-cell-stock-read.service';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import { Types } from 'mongoose';
const actor = (req: Request) => req.user!;
async function reply(res: Response, work: () => Promise<unknown>, status = 200, operation = 'managed-inventory-v3') {
  try { return res.status(status).json({ success: true, data: await work() }); }
  catch (error) { if (error instanceof ManagedInventoryV3Error || error instanceof ManagedUnifiedInboundError || error instanceof ManagedUnifiedInboundDomainError) return res.status(error.status).json({ success: false, code: error.code, message: error.message, ...(error instanceof ManagedUnifiedInboundError && error.details ? { details: error.details } : {}) });
    const rawCode = (error as any)?.code;
    // Log stack frames only (never the error message, request, headers, or document data)
    // so unexpected runtime failures can be traced without exposing customer or secret data.
    const errorStackFrames = error instanceof Error
      ? error.stack?.split('\n').slice(1).filter((line) => /^\s+at\s/.test(line)).slice(0, 6).map((line) => line.trim().slice(0, 240))
      : undefined;
    console.error('MANAGED_V3_OPERATION_FAILED', { operation, errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode) ? rawCode : Number.isSafeInteger(rawCode) ? rawCode : undefined,
      errorStackFrames });
    return res.status(500).json({ success: false, code: 'MANAGED_V3_OPERATION_FAILED', message: 'Không thể hoàn tất thao tác Managed Inventory V3.' }); }
}
export const preparePhysicalUnit = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.preparePhysicalUnit(req.params.id, req.body, actor(req)), 201);
export const listPhysicalUnits = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.listPhysicalUnits(req.params.id, actor(req)));
export const inboundContext = (req: Request, res: Response) => reply(res, () => ManagedUnifiedInboundService.context(req.params.id, actor(req)));
export const previewInbound = (req: Request, res: Response) => reply(res, () => ManagedUnifiedInboundService.preview(req.params.id, req.body, actor(req)), 200, 'unified-inbound-preview');
export const confirmInbound = (req: Request, res: Response) => reply(res, () => ManagedUnifiedInboundService.confirm(req.params.id, req.body, actor(req), req.header('Idempotency-Key')), 201, 'unified-inbound-confirm');
export const stock = (req: Request, res: Response) => reply(res, async () => {
  const result = await ManagedCellStockReadService.skuStock(req.params.id, actor(req));
  return actor(req).role === 'CUSTOMER' ? customerSafeStockDto(result) : result;
});
export const movements = (req: Request, res: Response) => reply(res, async () => {
  const user = actor(req), skuId = req.params.id;
  if (user.role !== 'CUSTOMER' || !/^[a-f\d]{24}$/i.test(String(skuId))) return ManagedInventoryV3Service.movements(skuId, user);
  const sku = await InventoryItemModel.findOne({ _id: new Types.ObjectId(String(skuId)), customerId: user._id, inventorySchemaVersion: 3, deletedAt: { $exists: false } }).select('_id').lean().exec();
  if (!sku) return ManagedInventoryV3Service.movements(skuId, user);
  return ItemMovementModel.find({ itemId: sku._id, customerId: user._id }).sort({ performedAt: -1, _id: -1 }).limit(200).lean().exec();
});
export const operation = (req: Request, res: Response) => reply(res, async () => {
  if (actor(req).role !== 'CUSTOMER') return ManagedInventoryV3Service.operation(req.params.id, req.query.key, actor(req));
  try { return await ManagedUnifiedInboundService.operation(req.params.id, req.query.key, actor(req)); }
  catch (error: any) { if (error?.code !== 'OPERATION_NOT_FOUND') throw error; return ManagedInventoryV3Service.operation(req.params.id, req.query.key, actor(req)); }
});
export const facilityOverview = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.facilityOverview(actor(req)));
