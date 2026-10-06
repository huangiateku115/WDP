import { RequestHandler } from 'express';
import { RuleService } from '../../services/pricing-policy/rule.service';

export function ruleController(service: RuleService) {
  const create: RequestHandler = async (req, res, next) => {
    try { res.status(201).json({ success: true, data: await service.create(req.body, req.user) }); } catch (e) { next(e); }
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
    try { res.json({ success: true, data: await service.update(req.params.id, req.body, req.user) }); } catch (e) { next(e); }
  };
  const status: RequestHandler = async (req, res, next) => {
    try { res.json({ success: true, data: await service.update(req.params.id, req.body, req.user, true) }); } catch (e) { next(e); }
  };
  return { create, list, get, resolve, update, status };
}
