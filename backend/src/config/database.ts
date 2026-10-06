import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.mongoUrl, { serverSelectionTimeoutMS: 10000 });
    console.log('MongoDB connected');
  } catch {
    console.error('MongoDB connection failed');
    throw new Error('MongoDB connection failed');
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
