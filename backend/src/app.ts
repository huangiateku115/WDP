import express, { Request, Response, NextFunction } from 'express';
import createError from 'http-errors';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

import indexRouter from './routes/index';

const app = express();

// Security Best Practices
app.set('trust proxy', 1); // For Railway Load Balancer

app.use(helmet()); // Set secure HTTP headers
app.use(cors()); // Enable CORS
app.use(mongoSanitize()); // Prevent NoSQL Injection

// Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau 15 phút.' },
});
app.use('/api/', globalLimiter);
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// API Routes
app.use('/api/v1', indexRouter);

// catch 404 and forward to error handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404));
});

// error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message,
    error: req.app.get('env') === 'development' ? err : {}
  });
});

export default app;
