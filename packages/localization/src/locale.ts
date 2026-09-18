/**
 * Supported locales (bn-BD default, en-BD). Server-side text (SMS templates, emails) is chosen by the
 * request/user locale; unknown values fall back to bn-BD.
 */
export const SUPPORTED_LOCALES = ['bn-BD', 'en-BD'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'bn-BD';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Resolves an explicit locale or an Accept-Language header (`bn`, `en-US;q=0.8`, …). */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  if (isLocale(input)) return input;
  const ranked = input
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((r) => r.tag && Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag === 'bn' || tag.startsWith('bn-')) return 'bn-BD';
    if (tag === 'en' || tag.startsWith('en-')) return 'en-BD';
  }
  return DEFAULT_LOCALE;
}
