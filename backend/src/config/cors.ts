import { CorsOptions } from 'cors';
import { env } from './env';

// CORS is a browser policy, not an authentication mechanism.
export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    callback(null, !origin || env.corsOrigins.includes(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
};
