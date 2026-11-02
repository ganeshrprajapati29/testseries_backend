import type { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { QuestionModel } from '../models/Question.model.js';
import { translateTexts } from './translate.service.js';

export interface QuestionLike {
  questionText?: string;
  options?: { key: string; text?: string }[];
  explanation?: string;
  language?: string;
  translations?: { language: string; questionText?: string; options?: { key: string; text?: string }[]; explanation?: string }[];
}

export interface HindiTranslation {
  language: 'hi';
  questionText: string;
  options: { key: string; text: string }[];
  explanation: string;
}

/** True when a question already has Hindi text (written in Hindi, or with a Hindi translation). */
export function hasHindi(q: QuestionLike) {
  return q.language === 'hi' || (q.translations ?? []).some((t) => t.language === 'hi' && !!t.questionText?.trim());
}

/** Machine-translates the English question, options and explanation into one Hindi translation entry. */
export async function hindiFor(q: QuestionLike): Promise<HindiTranslation> {
  const options = q.options ?? [];
  const texts = [q.questionText ?? '', q.explanation ?? '', ...options.map((o) => o.text ?? '')];
  const [questionText, explanation, ...optionTexts] = await translateTexts(texts, 'en', 'hi');
  return {
    language: 'hi',
    questionText: questionText || (q.questionText ?? ''),
    explanation: explanation ?? '',
    options: options.map((o, i) => ({ key: o.key, text: optionTexts[i] ?? '' })),
  };
}

const replaceHindi = (list: QuestionLike['translations'], hi: HindiTranslation) => [...(list ?? []).filter((t) => t.language !== 'hi'), hi];

/**
 * Used when an admin saves a question with "auto-translate" on: fills the Hindi version only when it is
 * missing. Translation problems never block saving - the question is saved in English and a warning returned.
 */
export async function withAutoHindi<T extends QuestionLike>(input: T): Promise<{ data: T; warning?: string }> {
  if ((input.language ?? 'en') !== 'en' || hasHindi(input) || !input.questionText?.trim()) return { data: input };
  try {
    return { data: { ...input, translations: replaceHindi(input.translations, await hindiFor(input)) } };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Auto translation skipped');
    return { data: input, warning: 'Saved in English only - Hindi auto translation is unavailable right now.' };
  }
}

/** Bulk "Translate to Hindi" for selected questions. */
export async function translateQuestions(ids: (string | Types.ObjectId)[], overwrite = false) {
  const questions = await QuestionModel.find({ _id: { $in: ids } });
  let translated = 0;
  let skipped = 0;
  let failed = 0;
  for (const q of questions) {
    const plain = q.toObject() as QuestionLike;
    if (plain.language === 'hi' || (!overwrite && hasHindi(plain))) {
      skipped++;
      continue;
    }
    try {
      q.set('translations', replaceHindi(plain.translations, await hindiFor(plain)));
      await q.save();
      translated++;
    } catch (err) {
      failed++;
      logger.warn({ err: (err as Error).message, questionId: String(q._id) }, 'Question translation failed');
      // The provider is down or rate limiting - stop instead of failing every remaining question.
      if (failed >= 3 && translated === 0) break;
    }
  }
  return { translated, skipped, failed, notProcessed: questions.length - translated - skipped - failed };
}

/** Fire-and-forget translation after a bulk import, so committing a large file stays fast. */
export function translateQuestionsInBackground(ids: (string | Types.ObjectId)[]) {
  if (!ids.length) return;
  translateQuestions(ids)
    .then((r) => logger.info(r, 'Background Hindi translation finished'))
    .catch((err) => logger.warn({ err: (err as Error).message }, 'Background Hindi translation failed'));
}
