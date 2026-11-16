import { Request, Response, NextFunction } from 'express';
import { ManagedCellStockReadService } from '../../services/inventory-items/managed-cell-stock-read.service';

export const skuStock = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: await ManagedCellStockReadService.skuStock(req.params.id, req.user) }); } catch (error) { next(error); }
};
export const itemSpecificationStock = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: await ManagedCellStockReadService.itemSpecificationStock(req.params.id, req.params.specId, req.user) }); } catch (error) { next(error); }
};
export const cellStock = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: await ManagedCellStockReadService.cellStock(req.params.id, req.user) }); } catch (error) { next(error); }
};
export const facilityDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: await ManagedCellStockReadService.facilityDiagnostics(req.user) }); } catch (error) { next(error); }
};
