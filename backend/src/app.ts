import express from 'express';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import { corsOptions } from './config/cors';
import indexRouter from './routes/index';
import { notFound, errorHandler } from './middlewares/error.middleware';

const app = express();

// Security Best Practices
app.set('trust proxy', 1); // For Railway Load Balancer

app.use(helmet()); // Set secure HTTP headers
app.use(cors(corsOptions)); // Enable CORS with custom options
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

app.use('/api/v1', indexRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
