import crypto from 'node:crypto';

interface OptionLike {
  key: string;
  text?: string | null;
  imageUrl?: string | null;
}

interface TranslationLike {
  language: string;
  questionText: string;
  options?: { key: string; text?: string | null }[] | null;
  explanation?: string | null;
}

export interface QuestionLike {
  _id: unknown;
  questionText: string;
  options: OptionLike[];
  correctOption?: string;
  explanation?: string | null;
  imageUrl?: string | null;
  language?: string | null;
  translations?: TranslationLike[] | null;
  subject?: string | null;
  topic?: string | null;
  difficulty?: string | null;
}

/** Content used by the candidate while the exam is running. Never contains answers. */
export interface SafeQuestion {
  id: string;
  questionText: string;
  imageUrl: string;
  options: { key: string; text: string; imageUrl: string }[];
  translations: { language: string; questionText: string; options: { key: string; text: string }[] }[];
  subject: string;
  topic: string;
}

function orderOptions<T extends { key: string }>(options: T[], order?: string[] | null): T[] {
  if (!order?.length) return options;
  const byKey = new Map(options.map((o) => [o.key, o]));
  const ordered = order.map((k) => byKey.get(k)).filter((o): o is T => !!o);
  // Include any option not present in the stored order (defensive).
  for (const o of options) if (!order.includes(o.key)) ordered.push(o);
  return ordered;
}

export function toSafeQuestion(q: QuestionLike, optionOrder?: string[] | null): SafeQuestion {
  return {
    id: String(q._id),
    questionText: q.questionText,
    imageUrl: q.imageUrl ?? '',
    options: orderOptions(q.options, optionOrder).map((o) => ({ key: o.key, text: o.text ?? '', imageUrl: o.imageUrl ?? '' })),
    translations: (q.translations ?? []).map((t) => ({
      language: t.language,
      questionText: t.questionText,
      options: orderOptions(t.options ?? [], optionOrder).map((o) => ({ key: o.key, text: o.text ?? '' })),
    })),
    subject: q.subject ?? '',
    topic: q.topic ?? '',
  };
}

/** Full question including answer and explanation - only for solutions after evaluation. */
export function toSolutionQuestion(q: QuestionLike, optionOrder?: string[] | null) {
  return {
    ...toSafeQuestion(q, optionOrder),
    explanation: q.explanation ?? '',
    translations: (q.translations ?? []).map((t) => ({
      language: t.language,
      questionText: t.questionText,
      options: orderOptions(t.options ?? [], optionOrder).map((o) => ({ key: o.key, text: o.text ?? '' })),
      explanation: t.explanation ?? '',
    })),
    difficulty: q.difficulty ?? 'medium',
  };
}

export function questionContentHash(q: { questionText: string; options: { key: string; text?: string | null }[] }): string {
  const normalized = [q.questionText, ...q.options.map((o) => `${o.key}:${o.text ?? ''}`)]
    .map((s) => s.toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/** Fisher-Yates shuffle using a cryptographically secure RNG. */
export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
