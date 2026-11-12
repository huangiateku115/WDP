import { Router } from 'express';
import { ruleController } from '../controllers/pricing-policy/rule.controller';
import { pricingService, policyService } from '../services/pricing-policy/rule.service';
import { requireAuth } from '../middlewares/auth/requireAuth';
import { requireRole } from '../middlewares/auth/requireRole';
import { UserRole } from '../types/user.type';

const router = Router();
for (const [path, service] of [['/pricing-rules', pricingService], ['/policies', policyService]] as const) {
  const resource = Router();
  const controller = ruleController(service);
  const manage = requireRole([UserRole.BOM, UserRole.ADMIN]);
  resource.use(requireAuth);
  resource.get('/resolve', controller.resolve);
  resource.get('/', controller.list);
  resource.get('/:id', controller.get);
  if (service === pricingService) {
    resource.post('/', manage, controller.create);
    resource.patch('/:id', manage, controller.update);
    resource.patch('/:id/status', manage, controller.status);
  }
  router.use(path, resource);
}
export default router;
