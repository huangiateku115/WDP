import { RequestHandler } from 'express';
import { RuleService } from '../../services/pricing-policy/rule.service';
import { AuditService } from '../../services/audit/audit.service';
import { ActionType } from '../../types/audit.type';

export function ruleController(service: RuleService) {
  const create: RequestHandler = async (req, res, next) => {
    try { 
      const result = await service.create(req.body, req.user);
      const actor = req.user as any;
      AuditService.logAction({
        actorId: actor._id.toString(),
        actorRole: actor.role,
        action: ActionType.CREATE_PRICING_RULE,
        entityType: 'PricingRule',
        entityId: (result as any)._id.toString(),
        after: result
      });
      res.status(201).json({ success: true, data: result }); 
    } catch (e) { next(e); }
  };
  const list: RequestHandler = async (req, res, next) => {
    try { res.json({ success: true, ...await service.list(req.query, req.user) }); } catch (e) { next(e); }
  };
  const get: RequestHandler = async (req, res, next) => {
    try { res.json({ success: true, data: await service.get(req.params.id, req.user) }); } catch (e) { next(e); }
  };
  const resolve: RequestHandler = async (req, res, next) => {
    try { res.json({ success: true, data: await service.resolve(req.query, req.user) }); } catch (e) { next(e); }
  };
  const update: RequestHandler = async (req, res, next) => {
    try { 
      const result = await service.update(req.params.id, req.body, req.user);
      const actor = req.user as any;
      AuditService.logAction({
        actorId: actor._id.toString(),
        actorRole: actor.role,
        action: ActionType.UPDATE_PRICING_RULE,
        entityType: 'PricingRule',
        entityId: req.params.id as string,
        after: req.body
      });
      res.json({ success: true, data: result }); 
    } catch (e) { next(e); }
  };
  const status: RequestHandler = async (req, res, next) => {
    try { 
      const result = await service.update(req.params.id, req.body, req.user, true);
      const actor = req.user as any;
      AuditService.logAction({
        actorId: actor._id.toString(),
        actorRole: actor.role,
        action: ActionType.UPDATE_PRICING_RULE_STATUS,
        entityType: 'PricingRule',
        entityId: req.params.id as string,
        after: { isActive: req.body.isActive }
      });
      res.json({ success: true, data: result }); 
    } catch (e) { next(e); }
  };
  return { create, list, get, resolve, update, status };
}
