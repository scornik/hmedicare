import fs from 'node:fs';
import path from 'node:path';

export type Verdict = 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED' | 'UNCLEAR' | 'BLOCKED';
export type SourceId = 'mendeley_bd_meds' | 'medex' | 'arogga' | 'medeasy_en' | 'medeasy_bn' | 'osudpotro' | 'lazzpharma' | 'dims_app' | 'dgda';
export type SourceType = 'index' | 'pharmacy' | 'app' | 'regulator' | 'open_dataset';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const STATE_DIR = path.join(ROOT, '.state');
export const RAW_DIR = path.join(ROOT, '.raw');
export const DIST_DIR = path.join(ROOT, 'dist');
export const RUNS_DIR = path.join(ROOT, 'runs');
export const COMPLIANCE_DIR = path.join(ROOT, 'compliance');
export const VOCAB_DIR = path.join(ROOT, 'vocab');

export const BOT_NAME = 'HakeemifyMedicineIndexBot';
export const MIN_DELAY_MS = 3000;
export const MAX_DELAY_MS = 6000;
export const RAW_RETENTION_DAYS = 30;
export const DEFAULT_CAPS: Record<'ALLOWED' | 'RESTRICTED' | 'UNCLEAR', number> = { ALLOWED: 5000, RESTRICTED: 5000, UNCLEAR: 1500 };

export interface SourceConfig {
  id: SourceId;
  name: string;
  type: SourceType;
  origin: string;
  /** Terms / policy pages reviewed in the compliance gate. */
  termsUrls: string[];
  /** Precedence rank for canonical field selection (lower wins). */
  precedence: number;
  /** Extra seeds when robots.txt lists no sitemap. */
  seedUrls: string[];
  /** Whether the source may ever contribute records by crawling. */
  crawlable: boolean;
}

export const SOURCES: SourceConfig[] = [
  { id: 'dgda', name: 'DGDA Allopathic Medicine Information (official registry)', type: 'regulator', origin: 'http://180.211.137.202:9310', termsUrls: ['https://dgda.gov.bd/'], precedence: 0, seedUrls: [], crawlable: true },
  { id: 'medex', name: 'MedEx', type: 'index', origin: 'https://medex.com.bd', termsUrls: ['https://medex.com.bd/terms-of-use'], precedence: 1, seedUrls: [], crawlable: true },
  { id: 'mendeley_bd_meds', name: 'Medicinal Products in Bangladesh (Mendeley Data, CC BY 4.0)', type: 'open_dataset', origin: 'https://data.mendeley.com', termsUrls: ['https://data.mendeley.com/datasets/zhtvkny53n/1'], precedence: 2, seedUrls: [], crawlable: true },
  { id: 'arogga', name: 'Arogga', type: 'pharmacy', origin: 'https://www.arogga.com', termsUrls: ['https://www.arogga.com/page/tos'], precedence: 3, seedUrls: [], crawlable: true },
  { id: 'medeasy_en', name: 'MedEasy (English)', type: 'pharmacy', origin: 'https://medeasy.health', termsUrls: ['https://medeasy.health/terms-and-conditions'], precedence: 3, seedUrls: [], crawlable: true },
  { id: 'medeasy_bn', name: 'MedEasy (Bangla)', type: 'pharmacy', origin: 'https://medeasy.health', termsUrls: ['https://medeasy.health/bn/terms-and-conditions'], precedence: 3, seedUrls: [], crawlable: true },
  { id: 'osudpotro', name: 'Osudpotro', type: 'pharmacy', origin: 'https://osudpotro.com', termsUrls: ['https://osudpotro.com/terms-and-conditions', 'https://osudpotro.com/disclaimer'], precedence: 3, seedUrls: [], crawlable: true },
  { id: 'lazzpharma', name: 'Lazz Pharma', type: 'pharmacy', origin: 'https://lazzpharma.com', termsUrls: ['https://lazzpharma.com/termsCondition'], precedence: 3, seedUrls: ['https://lazzpharma.com/'], crawlable: true },
  { id: 'dims_app', name: 'Play Store app listing (com.twgbd.drugindex; DIMS is com.twgbd.dims)', type: 'app', origin: 'https://play.google.com', termsUrls: [], precedence: 9, seedUrls: [], crawlable: false }
];

export function getSource(id: string): SourceConfig {
  const source = SOURCES.find(candidate => candidate.id === id);
  if (!source) throw new Error(`Unknown source "${id}". Known: ${SOURCES.map(s => s.id).join(', ')}`);
  return source;
}

const PLACEHOLDER_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$/i;

/** Reads CONTACT_EMAIL at call time; refuses to continue without a real address. */
export function requireContactEmail(env: NodeJS.ProcessEnv = process.env): string {
  const email = env.CONTACT_EMAIL?.trim() ?? '';
  if (!email) throw new Error('CONTACT_EMAIL is required. Set it to a monitored address before running any network command.');
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email);
  if (!match) throw new Error(`CONTACT_EMAIL "${email}" is not a valid email address.`);
  if (PLACEHOLDER_DOMAIN.test(match[1])) throw new Error(`CONTACT_EMAIL uses a placeholder domain (${match[1]}); a monitored address is required.`);
  return email;
}

export function userAgent(email: string): string {
  return `${BOT_NAME}/1.0 (+contact: ${email})`;
}

/**
 * Optional local overrides in medicine-data.config.json (gitignored). Delays and
 * caps are clamped so they can only make crawling slower / smaller than defaults.
 */
export interface Overrides { minDelayMs?: number; maxDelayMs?: number; caps?: Partial<Record<SourceId, number>>; }

export function loadOverrides(file = path.join(ROOT, 'medicine-data.config.json')): Overrides {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Overrides;
}

export function effectiveDelays(overrides: Overrides): { minMs: number; maxMs: number } {
  const minMs = Math.max(MIN_DELAY_MS, overrides.minDelayMs ?? MIN_DELAY_MS);
  const maxMs = Math.max(MAX_DELAY_MS, minMs, overrides.maxDelayMs ?? MAX_DELAY_MS);
  return { minMs, maxMs };
}

export function effectiveCap(sourceId: SourceId, verdict: Verdict, overrides: Overrides): number {
  if (verdict === 'PROHIBITED' || verdict === 'BLOCKED') return 0;
  const base = DEFAULT_CAPS[verdict];
  const requested = overrides.caps?.[sourceId];
  // Caps may be lowered freely; UNCLEAR sources may never exceed their conservative default.
  if (requested === undefined) return base;
  return verdict === 'UNCLEAR' ? Math.min(base, requested) : Math.max(0, requested);
}
