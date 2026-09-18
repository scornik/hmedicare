import { estimateSegments } from './sms-encoding';

/**
 * SMS templates (ADR-018 §5, COMMUNICATION §6.3). Versioned keys `<key>.<locale>.v<n>`; placeholders are an
 * allow-list; no clinical content, no patient names. Stage 4 ships the OTP templates; the other MVP keys
 * arrive with their features. Kept as source constants (not asset files) so the Hostinger build needs no
 * asset copy step.
 */
export const ALLOWED_PLACEHOLDERS = [
  'appName',
  'otpCode',
  'otpMinutes',
  'serialNumber',
  'localTime',
  'localDate',
  'clinicSmsName',
  'shortLink',
] as const;
export type Placeholder = (typeof ALLOWED_PLACEHOLDERS)[number];
export type SmsLocale = 'bn-BD' | 'en-BD';

export interface SmsTemplate {
  key: string;
  locale: SmsLocale;
  version: number;
  maxSegments: number;
  body: string;
}

export const SMS_TEMPLATES: readonly SmsTemplate[] = [
  {
    key: 'otp_login',
    locale: 'en-BD',
    version: 1,
    maxSegments: 1,
    body: '{appName} login code: {otpCode}. Valid for {otpMinutes} minutes. Do not share this code.',
  },
  {
    key: 'otp_login',
    locale: 'bn-BD',
    version: 1,
    maxSegments: 1,
    body: '{appName} লগইন কোড: {otpCode}। {otpMinutes} মিনিট বৈধ। কাউকে জানাবেন না।',
  },
  {
    key: 'otp_phone_verify',
    locale: 'en-BD',
    version: 1,
    maxSegments: 1,
    body: '{appName} verification code: {otpCode}. Valid for {otpMinutes} minutes. Do not share this code.',
  },
  {
    key: 'otp_phone_verify',
    locale: 'bn-BD',
    version: 1,
    maxSegments: 1,
    body: '{appName} যাচাই কোড: {otpCode}। {otpMinutes} মিনিট বৈধ। কাউকে জানাবেন না।',
  },
];

/** Words that must never appear in SMS templates (COMMUNICATION §6.3 CI check). */
export const FORBIDDEN_TEMPLATE_WORDS = [
  /diagnos/i,
  /prescri/i,
  /medicine|medication|tablet|capsule/i,
  /\blab\b|test result/i,
  /রোগ|ওষুধ|প্রেসক্রিপশন|রিপোর্ট|পরীক্ষার ফল/,
];

const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g;

export function placeholdersOf(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
}

export function lintTemplate(t: SmsTemplate): string[] {
  const problems: string[] = [];
  for (const p of placeholdersOf(t.body)) {
    if (!(ALLOWED_PLACEHOLDERS as readonly string[]).includes(p))
      problems.push(`${t.key}.${t.locale}: placeholder {${p}}`);
  }
  for (const re of FORBIDDEN_TEMPLATE_WORDS)
    if (re.test(t.body)) problems.push(`${t.key}.${t.locale}: forbidden word ${re}`);
  return problems;
}

export function findTemplate(key: string, locale: SmsLocale): SmsTemplate {
  const candidates = SMS_TEMPLATES.filter((t) => t.key === key && t.locale === locale).sort(
    (a, b) => b.version - a.version,
  );
  const t = candidates[0];
  if (!t) throw new Error(`unknown SMS template ${key}.${locale}`);
  return t;
}

/** Renders a template; refuses unknown placeholders or missing values at runtime (lint re-check). */
export function renderTemplate(
  key: string,
  locale: SmsLocale,
  vars: Partial<Record<Placeholder, string>>,
): string {
  const t = findTemplate(key, locale);
  const problems = lintTemplate(t);
  if (problems.length) throw new Error(`template lint failed: ${problems.join('; ')}`);
  return t.body.replace(PLACEHOLDER_RE, (_, name: string) => {
    const v = vars[name as Placeholder];
    if (v === undefined) throw new Error(`missing template value {${name}}`);
    return v;
  });
}

/** Longest rendering check used by CI (`maxSegments`, OTP = 1). */
export function worstCaseSegments(t: SmsTemplate, worst: Partial<Record<Placeholder, string>>): number {
  return estimateSegments(renderTemplate(t.key, t.locale, worst)).segments;
}
