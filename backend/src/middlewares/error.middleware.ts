import { ErrorRequestHandler, RequestHandler } from 'express';
import { STATUS_CODES } from 'http';
import { env } from '../config/env';
import { ManagedStockErrorCode } from '../types/managed-stock.type';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const candidate = err?.status || err?.statusCode;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const safeCode = typeof err?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(err.code) ? err.code : undefined;
  const fieldErrors = err?.fieldErrors && typeof err.fieldErrors === 'object' && !Array.isArray(err.fieldErrors)
    ? Object.fromEntries(Object.entries(err.fieldErrors).filter(([key, value]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && typeof value === 'string').slice(0, 32))
    : undefined;
  res.status(status).json({
    success: false,
    message: env.nodeEnv === 'production'
      ? STATUS_CODES[status] || 'Internal Server Error'
      : err?.message || STATUS_CODES[status] || 'Internal Server Error',
    ...(safeCode ? { code: safeCode } : (typeof err?.code === 'string' && Object.values(ManagedStockErrorCode).includes(err.code) ? { code: err.code } : {})),
    ...(fieldErrors && Object.keys(fieldErrors).length ? { fieldErrors } : {}),
    ...(env.nodeEnv === 'development' ? { error: err } : {}),
  });
};
