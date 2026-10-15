import type { Types } from 'mongoose';
import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { logger } from '../config/logger.js';
import { CategoryModel } from '../models/Category.model.js';
import type { ModuleType } from '../types/enums.js';
import { slugify } from '../utils/slugify.js';

interface SeedNode {
  name: string;
  children?: SeedNode[];
}

/** Initial Test Series hierarchy, exactly as specified by Civil Sansad. */
export const TEST_SERIES_TREE: SeedNode[] = [
  {
    name: 'Defence',
    children: [
      { name: 'CDS', children: [{ name: 'GK' }, { name: 'English' }, { name: 'Maths' }] },
      { name: 'NDA', children: [{ name: 'Maths' }, { name: 'GAT' }] },
      { name: 'CAPF', children: [{ name: 'Paper-I' }, { name: 'Paper-II' }] },
      { name: 'AFCAT' },
    ],
  },
  { name: 'JEE', children: [{ name: 'Mains' }, { name: 'Advance' }] },
  { name: 'NET' },
  { name: 'UPSC', children: [{ name: 'Prelims', children: [{ name: 'Paper-I' }, { name: 'Paper-II' }] }, { name: 'Mains' }] },
  { name: 'UPPCS', children: [{ name: 'Prelims', children: [{ name: 'GS-I' }, { name: 'GS-II' }] }, { name: 'Mains' }] },
  { name: 'Olympiad', children: [{ name: 'IOQM' }, { name: 'NSEP' }, { name: 'NSEC' }] },
  { name: 'Entrance Exam', children: [{ name: 'JNVST' }, { name: 'RIMC' }, { name: 'RMS' }, { name: 'Sainik' }] },
];

/** Initial PYQs hierarchy: exam -> subject. */
export const PYQS_TREE: SeedNode[] = [
  {
    name: 'NDA',
    children: ['Maths', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Polity', 'Economics'].map((name) => ({ name })),
  },
  {
    name: 'CDS',
    children: ['Maths', 'English', 'Biology', 'Chemistry', 'Physics', 'Polity', 'History', 'Economics', 'Computer'].map((name) => ({ name })),
  },
];

interface Counters {
  created: number;
  existing: number;
}

async function upsertNode(
  node: SeedNode,
  moduleType: ModuleType,
  parent: { _id: Types.ObjectId; ancestors: Types.ObjectId[]; depth: number } | null,
  sortOrder: number,
  counters: Counters,
) {
  const slug = slugify(node.name);
  const parentId = parent?._id ?? null;
  // Match on the unique key only, so admin edits to name/description/order are never overwritten.
  const result = await CategoryModel.findOneAndUpdate(
    { moduleType, parentId, slug },
    {
      $setOnInsert: {
        name: node.name,
        slug,
        moduleType,
        parentId,
        ancestors: parent ? [...parent.ancestors, parent._id] : [],
        depth: parent ? parent.depth + 1 : 0,
        sortOrder,
        isActive: true,
        status: 'active',
        description: '',
      },
    },
    { upsert: true, new: true, includeResultMetadata: true },
  );
  const doc = result.value!;
  if (result.lastErrorObject?.updatedExisting) counters.existing += 1;
  else counters.created += 1;

  for (const [i, child] of (node.children ?? []).entries()) {
    await upsertNode(child, moduleType, { _id: doc._id, ancestors: doc.ancestors, depth: doc.depth }, i, counters);
  }
}

export async function seedCategories() {
  const counters: Counters = { created: 0, existing: 0 };
  for (const [i, node] of TEST_SERIES_TREE.entries()) await upsertNode(node, 'TEST_SERIES', null, i, counters);
  for (const [i, node] of PYQS_TREE.entries()) await upsertNode(node, 'PYQS', null, i, counters);
  logger.info(counters, 'Category seed completed');
  return counters;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  connectDatabase()
    .then(seedCategories)
    .then((c) => console.log(`Categories: ${c.created} created, ${c.existing} already present`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(disconnectDatabase);
}
