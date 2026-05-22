import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import connectDB from './config/db';
import { connectRabbitMQ, closeRabbitMQ } from './utils/rabbitmq';
import { startAnalyticsConsumers } from './consumers/analyticsConsumer';
import analyticsRoutes from './routes/analyticsRoutes';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3009', 10);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Request logging with correlation ID
app.use((req: Request, _res: Response, next: NextFunction) => {
  const correlationId = req.headers['x-correlation-id'] ?? 'none';
  console.log(`[AnalyticsService] ${req.method} ${req.path} [corr: ${correlationId}]`);
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    service: 'analytics-service',
    status: 'healthy',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api/analytics', analyticsRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[AnalyticsService] Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const start = async (): Promise<void> => {
  try {
    await connectDB();
    await connectRabbitMQ();
    await startAnalyticsConsumers();

    app.listen(PORT, () => {
      console.log(`[AnalyticsService] Server running on port ${PORT}`);
      console.log(`[AnalyticsService] Health: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('[AnalyticsService] Failed to start:', error);
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[AnalyticsService] Received ${signal}. Shutting down gracefully...`);
  await closeRabbitMQ();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void start();

export default app;
