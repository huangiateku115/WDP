import { NextFunction, Request, Response } from 'express';
import { StatisticsService, StatisticsServiceError } from '../../services/statistics/statistics.service';
import { StatisticsQueryError } from '../../services/statistics/statistics.validation';

type Handler = (query: Awaited<ReturnType<typeof StatisticsService.resolveScope>>['query'], scope: Awaited<ReturnType<typeof StatisticsService.resolveScope>>['scope']) => Promise<unknown>;

function run(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new StatisticsServiceError(401, 'UNAUTHENTICATED', 'Authentication is required');
      const { query, scope } = await StatisticsService.resolveScope(req.user, req.query as Record<string, unknown>);
      const result = await handler(query, scope);
      res.json(result);
    } catch (error) {
      if (error instanceof StatisticsQueryError || error instanceof StatisticsServiceError) {
        res.status(error.status).json({ success: false, code: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };
}

export const overview = run(StatisticsService.overview.bind(StatisticsService));
export const revenue = run(StatisticsService.revenue.bind(StatisticsService));
export const facilitiesRanking = run(StatisticsService.facilitiesRanking.bind(StatisticsService));
export const customers = run(StatisticsService.customers.bind(StatisticsService));
export const serviceMix = run(StatisticsService.serviceMix.bind(StatisticsService));
export const unitDemand = run(StatisticsService.unitDemand.bind(StatisticsService));
export const rentalTrends = run(StatisticsService.rentalTrends.bind(StatisticsService));
