import { logger } from '../config/logger.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { expireOverdueAttempts } from '../services/examination.service.js';
import { MINUTE } from '../utils/dateTime.js';
/**
 * Submits attempts whose deadline passed while the student was offline, and releases
 * submission locks left behind by a crashed process.
 */
export async function runExpireAttempts() {
    await TestAttemptModel.updateMany({ status: 'IN_PROGRESS', lockedForSubmit: true, updatedAt: { $lt: new Date(Date.now() - 5 * MINUTE) } }, { $set: { lockedForSubmit: false } });
    const finalized = await expireOverdueAttempts();
    if (finalized)
        logger.info({ finalized }, 'Auto-submitted expired attempts');
    return finalized;
}
export function scheduleExpireAttempts(intervalMs = MINUTE) {
    let running = false;
    const timer = setInterval(async () => {
        if (running)
            return;
        running = true;
        try {
            await runExpireAttempts();
        }
        catch (err) {
            logger.error({ err }, 'expireAttempts job failed');
        }
        finally {
            running = false;
        }
    }, intervalMs);
    timer.unref();
    return timer;
}
//# sourceMappingURL=expireAttempts.job.js.map