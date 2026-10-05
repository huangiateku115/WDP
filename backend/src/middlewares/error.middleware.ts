import { ErrorRequestHandler, RequestHandler } from 'express';
import { STATUS_CODES } from 'http';
import { env } from '../config/env';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const candidate = err?.status || err?.statusCode;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  res.status(status).json({
    success: false,
    message: env.nodeEnv === 'production'
      ? STATUS_CODES[status] || 'Internal Server Error'
      : err?.message || STATUS_CODES[status] || 'Internal Server Error',
    ...(env.nodeEnv === 'development' ? { error: err } : {}),
  });
};
