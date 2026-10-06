/**
 * Storage keys (ADR-016 §4, FILE-STORAGE-IMPLEMENTATION.md §4).
 *
 * A key is the only thing standing between an object store and a path a caller chose. Keys are built
 * here and nowhere else, and every adapter validates one before it touches a filesystem or a bucket —
 * not because the builder is untrusted, but because the validator is what makes a key arriving from a
 * database row, a job payload or next year's code safe to use.
 *
 * Layout: `t/<tenantId>/<category>/<documentId>/<revision>`. Tenant first so an operator listing a
 * prefix sees one tenant's objects and never a mixture, and revision last so the history of one
 * document is adjacent.
 */
export const DOCUMENT_CATEGORIES = [
  'LAB_REPORT',
  'PRESCRIPTION_PDF',
  'IMAGE',
  'REFERRAL',
  'OTHER',
  'AI_RAW',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * The shape every adapter checks. Deliberately an allow-list of a fixed form rather than a scan for
 * dangerous sequences: there is no legitimate key this rejects, and a blocklist of `..` and friends is
 * a guess about which encodings an attacker will reach for.
 */
export const STORAGE_KEY_RE = /^t\/[0-9a-f-]{36}\/[a-z-]+\/[0-9a-f-]{36}\/[0-9]+$/;

export class StorageKeyError extends Error {
  constructor(
    readonly code: 'STORAGE_KEY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `PRESCRIPTION_PDF` → `prescription-pdf`: lowercase and hyphenated, which is what the pattern allows. */
export function categorySegment(category: DocumentCategory): string {
  return category.toLowerCase().replace(/_/g, '-');
}

export function buildStorageKey(input: {
  tenantId: string;
  category: DocumentCategory;
  documentId: string;
  revision: number;
}): string {
  const { tenantId, documentId, revision } = input;
  // Checked here as well as by the pattern below, so the failure names the field rather than handing
  // back an opaque "key invalid" for a caller that passed a display name where an id belongs.
  if (!UUID_RE.test(tenantId)) {
    throw new StorageKeyError('STORAGE_KEY_INVALID', 'tenantId must be a lowercase uuid');
  }
  if (!UUID_RE.test(documentId)) {
    throw new StorageKeyError('STORAGE_KEY_INVALID', 'documentId must be a lowercase uuid');
  }
  if (!Number.isInteger(revision) || revision < 1) {
    throw new StorageKeyError('STORAGE_KEY_INVALID', 'revision must be a whole number of at least 1');
  }
  const key = `t/${tenantId}/${categorySegment(input.category)}/${documentId}/${revision}`;
  // The builder validates its own output. If these two ever disagree, the pattern is the authority,
  // because the pattern is what every adapter actually enforces.
  assertStorageKey(key);
  return key;
}

export function assertStorageKey(key: string): string {
  if (key.length > 255 || !STORAGE_KEY_RE.test(key)) {
    throw new StorageKeyError('STORAGE_KEY_INVALID', 'that is not a storage key this system generates');
  }
  return key;
}
