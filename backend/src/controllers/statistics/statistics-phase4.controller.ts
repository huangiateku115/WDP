import { NextFunction, Request, Response } from 'express';
import { StatisticsService, StatisticsServiceError } from '../../services/statistics/statistics.service';
import { StatisticsPhase4Service } from '../../services/statistics/statistics-phase4.service';
import { StatisticsQueryError } from '../../services/statistics/statistics.validation';

async function execute(req: Request, res: Response, next: NextFunction, handler: () => Promise<unknown>) {
  try {
    if (!req.user) throw new StatisticsServiceError(401, 'UNAUTHENTICATED', 'Authentication is required');
    res.json(await handler());
  } catch (error) {
    if (error instanceof StatisticsQueryError || error instanceof StatisticsServiceError || (error instanceof Error && 'status' in error && 'code' in error)) {
      const typed = error as Error & { status: number; code: string };
      res.status(typed.status).json({ success: false, code: typed.code, message: typed.message });
      return;
    }
    next(error);
  }
}

export const facilitiesKpi = (req: Request, res: Response, next: NextFunction) => execute(req, res, next, async () => {
  const { query, scope } = await StatisticsService.resolveScope(req.user!, req.query as Record<string, unknown>);
  return StatisticsPhase4Service.facilitiesKpi(query, scope);
});

export const filters = (req: Request, res: Response, next: NextFunction) => execute(req, res, next, () =>
  StatisticsPhase4Service.filters(req.user!, req.query as Record<string, unknown>));
