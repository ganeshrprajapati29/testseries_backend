// Runs before every test file (before the app modules are imported).
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.LOG_LEVEL = 'silent';
process.env.PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED ?? 'false';

const { afterAll, beforeAll, beforeEach } = await import('vitest');
const mongoose = (await import('mongoose')).default;
const { connectDatabase } = await import('../config/database.js');
const { env } = await import('../config/env.js');

beforeAll(async () => {
  if (!env.MONGODB_TEST_URI.includes('test')) {
    throw new Error('MONGODB_TEST_URI must point to a dedicated test database (its name must contain "test")');
  }
  await connectDatabase(env.MONGODB_TEST_URI);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
});
