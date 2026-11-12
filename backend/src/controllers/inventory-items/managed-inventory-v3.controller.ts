import { Request, Response } from 'express';
import { ManagedInventoryV3Error, ManagedInventoryV3Service } from '../../services/inventory-items/managed-inventory-v3.service';
const actor = (req: Request) => req.user!;
async function reply(res: Response, work: () => Promise<unknown>, status = 200) {
  try { return res.status(status).json({ success: true, data: await work() }); }
  catch (error) { if (error instanceof ManagedInventoryV3Error) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    return res.status(500).json({ success: false, code: 'MANAGED_V3_OPERATION_FAILED', message: 'Không thể hoàn tất thao tác Managed Inventory V3.' }); }
}
export const preparePhysicalUnit = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.preparePhysicalUnit(req.params.id, req.body, actor(req)), 201);
export const listPhysicalUnits = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.listPhysicalUnits(req.params.id, actor(req)));
export const previewInbound = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.previewInbound(req.params.id, req.body, actor(req)));
export const confirmInbound = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.confirmInbound(req.params.id, req.body, actor(req), req.header('Idempotency-Key')), 201);
export const stock = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.stock(req.params.id, actor(req)));
export const movements = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.movements(req.params.id, actor(req)));
export const operation = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.operation(req.params.id, req.query.key, actor(req)));
export const facilityOverview = (req: Request, res: Response) => reply(res, () => ManagedInventoryV3Service.facilityOverview(actor(req)));
