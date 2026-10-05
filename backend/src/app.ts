import express from 'express';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import cors from 'cors';
import { corsOptions } from './config/cors';
import indexRouter from './routes/index';
import { notFound, errorHandler } from './middlewares/error.middleware';

const app = express();

app.use(cors(corsOptions));
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/api/v1', indexRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
