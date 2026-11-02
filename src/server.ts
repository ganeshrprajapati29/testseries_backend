import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis, getRedis } from './config/redis.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { scheduleCleanup } from './jobs/cleanupSessions.job.js';
import { scheduleExpireAttempts } from './jobs/expireAttempts.job.js';

async function main() {
  await connectDatabase();
  getRedis();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`Civil Sansad API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const timers = [scheduleExpireAttempts(), scheduleCleanup()];

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    timers.forEach((t) => clearInterval(t));
    server.close(async () => {
      await disconnectDatabase();
      await disconnectRedis();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
