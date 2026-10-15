import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';
let transactionsSupported = false;
export async function connectDatabase(uri = env.MONGODB_URI) {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 10000 });
    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
    }
    catch {
        transactionsSupported = false;
    }
    logger.info({ transactionsSupported }, 'MongoDB connected');
    return mongoose;
}
export async function disconnectDatabase() {
    await mongoose.disconnect();
}
export function supportsTransactions() {
    return transactionsSupported;
}
/**
 * Runs `fn` inside a transaction when the deployment supports it (replica set / sharded),
 * otherwise runs it directly. Callers must pass the session to every write.
 */
export async function withTransaction(fn) {
    if (!transactionsSupported)
        return fn(undefined);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await fn(session);
        });
        return result;
    }
    finally {
        await session.endSession();
    }
}
//# sourceMappingURL=database.js.map