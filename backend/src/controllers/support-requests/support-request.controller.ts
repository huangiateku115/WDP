import { RequestHandler } from 'express';
import { SupportRequestService as service } from '../../services/support-requests/support-request.service';

export const create: RequestHandler = async (req, res, next) => { try { res.status(201).json({ success: true, data: await service.create(req.body, req.user!) }); } catch (e) { next(e); } };
export const list: RequestHandler = async (req, res, next) => { try { res.json({ success: true, ...await service.list(req.query, req.user!) }); } catch (e) { next(e); } };
export const get: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.get(req.params.id, req.user!) }); } catch (e) { next(e); } };
export const update: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.update(req.params.id, req.body, req.user!) }); } catch (e) { next(e); } };
export const assign: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.assign(req.params.id, req.body, req.user!) }); } catch (e) { next(e); } };
export const unassign: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.unassign(req.params.id, req.user!) }); } catch (e) { next(e); } };
export const updateStatus: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.updateStatus(req.params.id, req.body, req.user!) }); } catch (e) { next(e); } };
export const addMessage: RequestHandler = async (req, res, next) => { try { res.status(201).json({ success: true, data: await service.addMessage(req.params.id, req.body, req.user!) }); } catch (e) { next(e); } };
export const listMessages: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.listMessages(req.params.id, req.user!) }); } catch (e) { next(e); } };
export const escalate: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.escalate(req.params.id, req.user!) }); } catch (e) { next(e); } };
export const softDelete: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.softDelete(req.params.id, req.user!) }); } catch (e) { next(e); } };
export const restore: RequestHandler = async (req, res, next) => { try { res.json({ success: true, data: await service.restore(req.params.id, req.user!) }); } catch (e) { next(e); } };
