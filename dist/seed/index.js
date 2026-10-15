/** Production-safe seed: creates the initial category hierarchy and syncs indexes. Idempotent. */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { seedCategories } from './seedCategories.js';
import '../models/AuditLog.model.js';
import '../models/Enrollment.model.js';
import '../models/ImportJob.model.js';
import '../models/Order.model.js';
import '../models/PasswordReset.model.js';
import '../models/Payment.model.js';
import '../models/Question.model.js';
import '../models/Result.model.js';
import '../models/Session.model.js';
import '../models/SiteSetting.model.js';
import '../models/Test.model.js';
import '../models/TestAttempt.model.js';
import '../models/TestSeries.model.js';
import '../models/User.model.js';
async function main() {
    await connectDatabase();
    for (const model of Object.values(mongoose.models)) {
        await model.syncIndexes();
    }
    console.log('Indexes synchronised');
    const counters = await seedCategories();
    console.log(`Categories: ${counters.created} created, ${counters.existing} already present`);
}
main()
    .catch((err) => {
    console.error(err);
    process.exitCode = 1;
})
    .finally(disconnectDatabase);
//# sourceMappingURL=index.js.map