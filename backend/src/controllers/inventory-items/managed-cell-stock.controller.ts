import { Request, Response, NextFunction } from 'express';
import { customerSafeStockDto, ManagedCellStockReadService } from '../../services/inventory-items/managed-cell-stock-read.service';

const stockResponse = (data: any, user: any) => user?.role === 'CUSTOMER' ? customerSafeStockDto(data) : data;

export const skuStock = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: stockResponse(await ManagedCellStockReadService.skuStock(req.params.id, req.user), req.user) }); } catch (error) { next(error); }
};
export const itemSpecificationStock = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: stockResponse(await ManagedCellStockReadService.itemSpecificationStock(req.params.id, req.params.specId, req.user), req.user) }); } catch (error) { next(error); }
};
export const cellStock = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: await ManagedCellStockReadService.cellStock(req.params.id, req.user) }); } catch (error) { next(error); }
};
export const facilityDiagnostics = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json({ success: true, data: await ManagedCellStockReadService.facilityDiagnostics(req.user) }); } catch (error) { next(error); }
};
