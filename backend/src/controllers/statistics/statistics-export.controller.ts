import { NextFunction, Request, Response } from 'express';
import { StatisticsServiceError } from '../../services/statistics/statistics.service';
import { StatisticsQueryError } from '../../services/statistics/statistics.validation';
import { StatisticsExportService, StatisticsExportError } from '../../services/statistics/statistics-export.service';
import { StatisticsExportFormat } from '../../services/statistics/statistics-export.validation';

function exportHandler(format: StatisticsExportFormat) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new StatisticsServiceError(401, 'UNAUTHENTICATED', 'Authentication is required');
      const output = await StatisticsExportService.export(req.user, req.query as Record<string, unknown>, format);
      res.status(200);
      res.setHeader('Content-Type', output.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${output.filename}"`);
      res.setHeader('Content-Length', String(output.buffer.length));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(output.buffer);
    } catch (error) {
      if (error instanceof StatisticsQueryError || error instanceof StatisticsServiceError || error instanceof StatisticsExportError) {
        res.status(error.status).json({ success: false, code: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };
}

export const csv = exportHandler('csv');
export const xlsx = exportHandler('xlsx');
export const pdf = exportHandler('pdf');
