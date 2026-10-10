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
  ...[
    [
      'serial_called',
      '{clinicSmsName}: Serial {serialNumber} has been called. {shortLink}',
      '{clinicSmsName}: সিরিয়াল {serialNumber} ডাক দেওয়া হয়েছে। {shortLink}',
    ],
    [
      'serial_near',
      '{clinicSmsName}: Serial {serialNumber} will be called soon. {shortLink}',
      '{clinicSmsName}: সিরিয়াল {serialNumber} শিগগিরই ডাকা হবে। {shortLink}',
    ],
    [
      'appointment_reminder',
      '{clinicSmsName}: Booking reminder for {localDate} at {localTime}. {shortLink}',
      '{clinicSmsName}: {localDate} {localTime}-এ আপনার বুকিং মনে রাখুন। {shortLink}',
    ],
    [
      'appointment_confirmed',
      '{clinicSmsName}: Booking confirmed for {localDate} at {localTime}. {shortLink}',
      '{clinicSmsName}: {localDate} {localTime}-এ আপনার বুকিং নিশ্চিত হয়েছে। {shortLink}',
    ],
    [
      'appointment_cancelled',
      '{clinicSmsName}: Your booking has been cancelled. {shortLink}',
      '{clinicSmsName}: আপনার বুকিং বাতিল হয়েছে। {shortLink}',
    ],
    [
      'payment_received',
      '{appName}: Payment received. Log in for details. {shortLink}',
      '{appName}: পেমেন্ট পাওয়া গেছে। বিস্তারিত দেখতে লগইন করুন। {shortLink}',
    ],
    [
      'payment_link',
      '{appName}: Log in to complete your payment. {shortLink}',
      '{appName}: পেমেন্ট করতে লগইন করুন। {shortLink}',
    ],
    [
      'follow_up_reminder',
      '{appName}: You have a follow-up reminder. Log in for details. {shortLink}',
      '{appName}: আপনার ফলো-আপের অনুস্মারক আছে। বিস্তারিত দেখতে লগইন করুন। {shortLink}',
    ],
  ].flatMap(([key, en, bn]) => [
    { key: key!, locale: 'en-BD' as const, version: 1, maxSegments: 3, body: en! },
    { key: key!, locale: 'bn-BD' as const, version: 1, maxSegments: 3, body: bn! },
  ]),
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

export function findTemplate(key: string, locale: SmsLocale, version?: number): SmsTemplate {
  const candidates = SMS_TEMPLATES.filter(
    (t) => t.key === key && t.locale === locale && (version === undefined || t.version === version),
  ).sort((a, b) => b.version - a.version);
  const t = candidates[0];
  if (!t) throw new Error(`unknown SMS template ${key}.${locale}`);
  return t;
}

/** Renders a template; refuses unknown placeholders or missing values at runtime (lint re-check). */
export function renderTemplate(
  key: string,
  locale: SmsLocale,
  vars: Partial<Record<Placeholder, string>>,
  version?: number,
): string {
  const t = findTemplate(key, locale, version);
  const problems = lintTemplate(t);
  if (problems.length) throw new Error(`template lint failed: ${problems.join('; ')}`);
  const rendered = t.body.replace(PLACEHOLDER_RE, (_, name: string) => {
    const v = vars[name as Placeholder];
    if (v === undefined) throw new Error(`missing template value {${name}}`);
    return v;
  });
  if (FORBIDDEN_TEMPLATE_WORDS.some((pattern) => pattern.test(rendered)))
    throw new Error('rendered SMS contains forbidden content');
  if (estimateSegments(rendered).segments > t.maxSegments)
    throw new Error('rendered SMS exceeds the segment limit');
  return rendered;
}

/** Longest rendering check used by CI (`maxSegments`, OTP = 1). */
export function worstCaseSegments(t: SmsTemplate, worst: Partial<Record<Placeholder, string>>): number {
  return estimateSegments(renderTemplate(t.key, t.locale, worst)).segments;
}
