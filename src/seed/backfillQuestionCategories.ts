/**
 * Links every existing question to the categories of the tests it is used in.
 * Safe to run any number of times:  node dist/seed/backfillQuestionCategories.js
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { QuestionModel } from '../models/Question.model.js';
import { backfillFromTests, recomputeQuestionPaths } from '../services/questionCategory.service.js';

async function main() {
  await connectDatabase();
  const tests = await backfillFromTests();
  await recomputeQuestionPaths({ 'categoryIds.0': { $exists: true } });
  const linked = await QuestionModel.countDocuments({ 'categoryIds.0': { $exists: true } });
  const total = await QuestionModel.countDocuments();
  console.log(`Processed ${tests} tests. ${linked} of ${total} questions are now linked to categories.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
