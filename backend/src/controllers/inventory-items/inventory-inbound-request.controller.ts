import { RequestHandler } from 'express';
import { ManagedInboundRequestService as service } from '../../services/inventory-items/managed-inbound-request.service';
import { RepeatedInboundOperationsService as staffService, RepeatedInboundError } from '../../services/inventory-items/repeated-inbound-operations.service';

const staffRun = (operation: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { res.json({ success: true, data: await operation(req) }); }
  catch (error) { if (error instanceof RepeatedInboundError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.create(req.params.itemId, req.body, req.get('Idempotency-Key'), req.user!);
    res.status(result.replayed ? 200 : 201).set('ETag', `"${result.data.version}"`).json({ success: true, data: result.data });
  } catch (error) { next(error); }
};

export const listForItem: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, ...await service.listForItem(req.params.itemId, req.query, req.user!) }); }
  catch (error) { next(error); }
};

export const get: RequestHandler = async (req, res, next) => {
  try {
    const data = await service.get(req.params.requestId, req.user!);
    res.set('ETag', `"${data.version}"`).json({ success: true, data });
  } catch (error) { next(error); }
};

export const amend: RequestHandler = async (req, res, next) => {
  try {
    const data = await service.amend(req.params.requestId, req.body, req.get('If-Match'), req.get('Idempotency-Key'), req.user!);
    res.set('ETag', `"${data.version}"`).json({ success: true, data });
  } catch (error) { next(error); }
};

export const cancel: RequestHandler = async (req, res, next) => {
  try {
    const data = await service.cancel(req.params.requestId, req.get('If-Match'), req.get('Idempotency-Key'), req.user!);
    res.set('ETag', `"${data.version}"`).json({ success: true, data });
  } catch (error) { next(error); }
};

export const receivingQueue = staffRun(req => staffService.queue(req.user!, req.query));
export const receivingDetail = staffRun(req => staffService.detail(req.params.requestId, req.user!));
export const stockBalance = staffRun(req => staffService.stockBalance(req.params.itemId, req.user!));
export const inspectRepeatedReceipt: RequestHandler = async (req, res, next) => {
  try {
    const data = await staffService.inspect(req.params.requestId, req.body, req.get('If-Match'), req.user!);
    res.json({ success: true, data });
  } catch (error) { if (error instanceof RepeatedInboundError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
export const confirmRepeatedReceipt: RequestHandler = async (req, res, next) => {
  try {
    const data = await staffService.confirm(req.params.requestId, req.body, req.get('If-Match'), req.user!);
    res.json({ success: true, data });
  } catch (error) { if (error instanceof RepeatedInboundError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
export const uploadRepeatedEvidence: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await staffService.uploadEvidence(req.params.requestId, req.file, req.get('Idempotency-Key'), req.user!) }); }
  catch (error) { if (error instanceof RepeatedInboundError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
export const completeRepeatedReturn: RequestHandler = async (req, res, next) => {
  try { res.json({ success: true, data: await staffService.completeReturn(req.params.requestId, req.body, req.get('If-Match'), req.get('Idempotency-Key'), req.user!) }); }
  catch (error) { if (error instanceof RepeatedInboundError) { res.status(error.status).json({ success: false, message: error.message, code: error.code }); return; } next(error); }
};
