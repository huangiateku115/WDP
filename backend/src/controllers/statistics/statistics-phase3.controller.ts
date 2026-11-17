import { NextFunction, Request, Response } from 'express';
import { StatisticsService, StatisticsServiceError } from '../../services/statistics/statistics.service';
import { StatisticsPhase3Service } from '../../services/statistics/statistics-phase3.service';
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

export const managedOperations = run(StatisticsPhase3Service.managedOperations.bind(StatisticsPhase3Service));
export const incidents = run(StatisticsPhase3Service.incidents.bind(StatisticsPhase3Service));
export const paymentsAnalysis = run(StatisticsPhase3Service.paymentsAnalysis.bind(StatisticsPhase3Service));
export const financialAnalytics = run(StatisticsPhase3Service.financialAnalytics.bind(StatisticsPhase3Service));
export const productAndOperations = run(StatisticsPhase3Service.productAndOperations.bind(StatisticsPhase3Service));
