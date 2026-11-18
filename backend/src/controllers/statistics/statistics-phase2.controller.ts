import { NextFunction, Request, Response } from 'express';
import { StatisticsService, StatisticsServiceError } from '../../services/statistics/statistics.service';
import { StatisticsPhase2Service } from '../../services/statistics/statistics-phase2.service';
import { StatisticsQueryError } from '../../services/statistics/statistics.validation';

type ScopeResult = Awaited<ReturnType<typeof StatisticsService.resolveScope>>;
type Handler = (query: ScopeResult['query'], scope: ScopeResult['scope']) => Promise<unknown>;

function run(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new StatisticsServiceError(401, 'UNAUTHENTICATED', 'Authentication is required');
      const { query, scope } = await StatisticsService.resolveScope(req.user, req.query as Record<string, unknown>);
      res.json(await handler(query, scope));
    } catch (error) {
      if (error instanceof StatisticsQueryError || error instanceof StatisticsServiceError) {
        res.status(error.status).json({ success: false, code: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };
}

export const utilization = run(StatisticsPhase2Service.utilization.bind(StatisticsPhase2Service));
export const storageCapacity = run(StatisticsPhase2Service.storageCapacity.bind(StatisticsPhase2Service));
export const managedCapacity = run(StatisticsPhase2Service.managedCapacity.bind(StatisticsPhase2Service));
export const reservations = run(StatisticsPhase2Service.reservations.bind(StatisticsPhase2Service));
export const contractsLifecycle = run(StatisticsPhase2Service.contractsLifecycle.bind(StatisticsPhase2Service));
