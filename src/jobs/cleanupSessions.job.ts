import { logger } from '../config/logger.js';
import { ImportJobModel } from '../models/ImportJob.model.js';
import { SessionModel } from '../models/Session.model.js';
import { DAY, HOUR } from '../utils/dateTime.js';

/**
 * Expired sessions are removed by a TTL index; this job also removes revoked sessions and
 * drops stale, never-committed import payloads.
 */
export async function runCleanup() {
  const [sessions, imports] = await Promise.all([
    SessionModel.deleteMany({ revokedAt: { $ne: null, $lt: new Date(Date.now() - DAY) } }),
    ImportJobModel.updateMany(
      { status: 'validated', createdAt: { $lt: new Date(Date.now() - 2 * DAY) } },
      { $set: { status: 'cancelled', payload: [] } },
    ),
  ]);
  if (sessions.deletedCount || imports.modifiedCount) {
    logger.info({ sessions: sessions.deletedCount, imports: imports.modifiedCount }, 'Cleanup completed');
  }
}

export function scheduleCleanup(intervalMs = 6 * HOUR) {
  const timer = setInterval(() => {
    runCleanup().catch((err) => logger.error({ err }, 'cleanup job failed'));
  }, intervalMs);
  timer.unref();
  return timer;
}
