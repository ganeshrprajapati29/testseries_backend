/**
 * Builds / refreshes the automatic practice sets for every category, so Question Bank questions that are
 * not in any published test reach the website. Safe to run any number of times:
 *   node dist/seed/syncPracticeSets.js   (then clear the public catalog cache)
 */
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { syncAllPracticeSets } from '../services/practiceSet.service.js';

async function main() {
  await connectDatabase();
  const published = await syncAllPracticeSets();
  console.log(`Practice sets in sync: ${published} published.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
