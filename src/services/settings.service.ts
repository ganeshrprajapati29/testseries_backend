import type { Types } from 'mongoose';
import { z } from 'zod';
import { SiteSettingModel } from '../models/SiteSetting.model.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Every editable setting is declared here with its validation and visibility.
 * Default values are the details published on https://civilsansad.com.
 */
export const SETTINGS_REGISTRY = {
  siteName: { schema: z.string().trim().min(2).max(80), isPublic: true, default: 'Civil Sansad', description: 'Brand name' },
  tagline: { schema: z.string().trim().max(160), isPublic: true, default: 'Achieving Excellence Together', description: 'Tagline shown with the logo' },
  heroTitle: {
    schema: z.string().trim().max(160),
    isPublic: true,
    default: 'Test Series & PYQs for UPSC, UPPCS, Defence, JEE & More',
    description: 'Home page headline',
  },
  heroSubtitle: {
    schema: z.string().trim().max(400),
    isPublic: true,
    default: 'Practise with exam-pattern mock tests and previous year papers, get instant results with detailed solutions, and track your progress from home.',
    description: 'Home page sub-headline',
  },
  logoUrl: { schema: z.string().trim().max(500), isPublic: true, default: 'https://civilsansad.com/frontend/images/logo.webp', description: 'Logo image URL' },
  mainWebsiteUrl: { schema: z.string().trim().url().max(200), isPublic: true, default: 'https://civilsansad.com', description: 'Main website' },
  contactPhone: { schema: z.string().trim().max(30), isPublic: true, default: '+91 90581 65827', description: 'Contact phone' },
  whatsappNumber: { schema: z.string().trim().regex(/^\d{10,15}$/, 'Digits only, with country code').or(z.literal('')), isPublic: true, default: '919058165827', description: 'WhatsApp number (digits with country code)' },
  contactEmail: { schema: z.string().trim().email().or(z.literal('')), isPublic: true, default: 'info@civilsansad.com', description: 'Contact email' },
  address: { schema: z.string().trim().max(300), isPublic: true, default: 'Dwarka Sector-7, Delhi', description: 'Office address' },
  facebookUrl: { schema: z.string().trim().url().or(z.literal('')), isPublic: true, default: 'https://www.facebook.com/profile.php?id=61590374702578', description: 'Facebook page' },
  instagramUrl: { schema: z.string().trim().url().or(z.literal('')), isPublic: true, default: 'https://www.instagram.com/civilsansaddelhi', description: 'Instagram profile' },
  youtubeUrl: { schema: z.string().trim().url().or(z.literal('')), isPublic: true, default: 'https://www.youtube.com/@civilsansad', description: 'YouTube channel' },
  announcement: { schema: z.string().trim().max(300), isPublic: true, default: '', description: 'Optional banner announcement on the student site' },
  defaultExamInstructions: {
    schema: z.string().trim().max(5000),
    isPublic: true,
    default: [
      'The clock is set on the server. The countdown timer at the top of the screen shows the time remaining.',
      'When the timer reaches zero, the test is submitted automatically.',
      'Click an option to select it. Click "Clear Response" to deselect.',
      'Use "Mark for Review" to revisit a question later. Marked questions that are answered are evaluated.',
      'Your answers are saved automatically. You can resume an unfinished test before the time runs out.',
      'Do not refresh repeatedly or open the test in multiple tabs.',
    ].join('\n'),
    description: 'General instructions shown before every test',
  },
  registrationOpen: { schema: z.boolean(), isPublic: true, default: true, description: 'Allow new student registrations' },
} as const;

export type SettingKey = keyof typeof SETTINGS_REGISTRY;

export async function getSettings(publicOnly: boolean) {
  const stored = await SiteSettingModel.find().lean();
  const byKey = new Map(stored.map((s) => [s.key, s.value]));
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
    if (publicOnly && !def.isPublic) continue;
    out[key] = byKey.has(key) ? byKey.get(key) : def.default;
  }
  return out;
}

export async function getSetting<K extends SettingKey>(key: K) {
  const doc = await SiteSettingModel.findOne({ key }).lean();
  return (doc ? doc.value : SETTINGS_REGISTRY[key].default) as (typeof SETTINGS_REGISTRY)[K]['default'];
}

export function settingsDescriptors() {
  return Object.entries(SETTINGS_REGISTRY).map(([key, def]) => ({
    key,
    description: def.description,
    isPublic: def.isPublic,
    type: typeof def.default,
  }));
}

export async function updateSettings(values: Record<string, unknown>, userId: Types.ObjectId) {
  const errors: { path: string; message: string }[] = [];
  const updates: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(values)) {
    const def = SETTINGS_REGISTRY[key as SettingKey];
    if (!def) {
      errors.push({ path: `body.${key}`, message: 'Unknown setting' });
      continue;
    }
    const parsed = (def.schema as z.ZodType).safeParse(value);
    if (!parsed.success) {
      errors.push({ path: `body.${key}`, message: parsed.error.issues[0]?.message ?? 'Invalid value' });
      continue;
    }
    updates.push({ key, value: parsed.data });
  }
  if (errors.length) throw ApiError.validation(errors);
  await SiteSettingModel.bulkWrite(
    updates.map((u) => ({
      updateOne: {
        filter: { key: u.key },
        update: { $set: { value: u.value, isPublic: SETTINGS_REGISTRY[u.key as SettingKey].isPublic, updatedBy: userId } },
        upsert: true,
      },
    })),
  );
  return getSettings(false);
}
