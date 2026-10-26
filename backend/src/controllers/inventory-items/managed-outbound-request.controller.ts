import { RequestHandler } from 'express';
import { ManagedOutboundRequestService as service, ManagedOutboundRequestError } from '../../services/inventory-items/managed-outbound-request.service';

const run = (operation: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { res.json({ success: true, data: await operation(req) }); }
  catch (error) {
    if (error instanceof ManagedOutboundRequestError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; }
    next(error);
  }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.create(req.params.itemId, req.body, req.get('Idempotency-Key'), req.user!);
    res.status(result.replayed ? 200 : 201).set('ETag', `"${result.data.version}"`).json({ success: true, data: result.data });
  } catch (error) {
    if (error instanceof ManagedOutboundRequestError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; }
    next(error);
  }
};
export const listForItem = run(req => service.listForItem(req.params.itemId, req.query, req.user!));
export const get: RequestHandler = async (req, res, next) => {
  try { const data = await service.get(req.params.requestId, req.user!); res.set('ETag', `"${data.version}"`).json({ success: true, data }); }
  catch (error) { if (error instanceof ManagedOutboundRequestError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
export const cancel: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.cancel(req.params.requestId, req.get('If-Match'), req.get('Idempotency-Key'), req.user!);
    res.status(200).set('ETag', `"${result.data.version}"`).json({ success: true, data: result.data });
  } catch (error) { if (error instanceof ManagedOutboundRequestError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
export const confirm: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.confirm(req.params.requestId, req.body, req.get('Idempotency-Key'), req.get('If-Match'), req.user!);
    res.status(200).set('ETag', `"${result.data.version}"`).json({ success: true, data: result.data });
  } catch (error) { if (error instanceof ManagedOutboundRequestError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
export const staffQueue = run(req => service.staffQueue(req.query, req.user!));
export const staffDetail: RequestHandler = async (req, res, next) => {
  try {
    const data = await service.staffDetail(req.params.requestId, req.user!);
    res.set('ETag', `"${data.request.version}"`).json({ success: true, data });
  } catch (error) {
    if (error instanceof ManagedOutboundRequestError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; }
    next(error);
  }
};
