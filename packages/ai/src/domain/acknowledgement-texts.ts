import { createHash } from 'node:crypto';

/**
 * Data-use acknowledgement texts (AIPOL-002, ADR-017 §3).
 *
 * What a doctor is shown and agrees to before any AI credential of theirs can be used. Versioned and
 * hashed, because the acknowledgement row records *which words* were agreed: a text edited afterwards
 * must not quietly become what somebody consented to. A new version invalidates the old
 * acknowledgements and sends the affected credentials back to `PENDING_VALIDATION`.
 *
 * Kept as source constants in this context's domain, the way `sms-templates.ts` holds its versioned
 * bodies, so the Hostinger build needs no asset copy step and the text ships with the code that hashes
 * it.
 *
 * The two tiers say different things on purpose. A free tier means the provider may read and train on
 * what is sent; a paid tier with a contractual no-training term means it should not. Neither claims
 * more than ADR-017 §3 permits, and neither is a legal opinion — the free-tier text says plainly that
 * the doctor is choosing to send patient information to a company that may keep it.
 */
export type AcknowledgementTier = 'FREE' | 'PAID';
export type AcknowledgementLocale = 'bn-BD' | 'en-BD';

export interface AcknowledgementText {
  version: string;
  tier: AcknowledgementTier;
  locale: AcknowledgementLocale;
  body: string;
}

/** The version a new acknowledgement must carry. Older rows stay readable but no longer count. */
export const CURRENT_ACK_TEXT_VERSION = 'ai-terms-v1';

export const ACKNOWLEDGEMENT_TEXTS: readonly AcknowledgementText[] = [
  {
    version: 'ai-terms-v1',
    tier: 'FREE',
    locale: 'en-BD',
    body:
      'I am enabling an AI provider on its free tier. I understand that the provider may read, retain ' +
      'and use what is sent to it to improve its own products, including for training, and that this ' +
      'cannot be undone once sent. I will only use it where my patient has consented to AI assistance. ' +
      'I confirm the tier I have declared is correct; it is my responsibility, not the system’s. I ' +
      'remain responsible for every clinical decision, and I will read any AI output before acting on ' +
      'it.',
  },
  {
    version: 'ai-terms-v1',
    tier: 'FREE',
    locale: 'bn-BD',
    body:
      'আমি একটি এআই সরবরাহকারীর ফ্রি স্তর চালু করছি। আমি বুঝছি যে পাঠানো তথ্য সরবরাহকারী পড়তে, রেখে দিতে ' +
      'এবং নিজের পণ্য উন্নত করতে — প্রশিক্ষণসহ — ব্যবহার করতে পারে, এবং একবার পাঠানো হলে তা ফেরানো যায় না। ' +
      'রোগী এআই সহায়তায় সম্মতি দিলেই আমি এটি ব্যবহার করব। আমি নিশ্চিত করছি যে ঘোষিত স্তর সঠিক; এর দায় ' +
      'আমার, সিস্টেমের নয়। প্রতিটি চিকিৎসা সিদ্ধান্তের দায় আমার থাকে, এবং এআই-এর লেখা আমি পড়ে তারপর কাজ করব।',
  },
  {
    version: 'ai-terms-v1',
    tier: 'PAID',
    locale: 'en-BD',
    body:
      'I am enabling an AI provider on a paid tier whose terms state that it does not train on what is ' +
      'sent. I understand this is the provider’s contractual statement, not a guarantee this ' +
      'system can verify. I will only use it where my patient has consented to AI assistance. I confirm ' +
      'the tier I have declared is correct; it is my responsibility, not the system’s. I remain ' +
      'responsible for every clinical decision, and I will read any AI output before acting on it.',
  },
  {
    version: 'ai-terms-v1',
    tier: 'PAID',
    locale: 'bn-BD',
    body:
      'আমি একটি এআই সরবরাহকারীর পেইড স্তর চালু করছি, যার শর্তে বলা আছে পাঠানো তথ্য দিয়ে তারা প্রশিক্ষণ দেয় না। ' +
      'আমি বুঝছি এটি সরবরাহকারীর চুক্তিভিত্তিক বক্তব্য, এই সিস্টেম যা যাচাই করতে পারে এমন নিশ্চয়তা নয়। ' +
      'রোগী এআই সহায়তায় সম্মতি দিলেই আমি এটি ব্যবহার করব। আমি নিশ্চিত করছি যে ঘোষিত স্তর সঠিক; এর দায় ' +
      'আমার, সিস্টেমের নয়। প্রতিটি চিকিৎসা সিদ্ধান্তের দায় আমার থাকে, এবং এআই-এর লেখা আমি পড়ে তারপর কাজ করব।',
  },
];

export class AcknowledgementTextError extends Error {
  constructor(readonly code: 'ACK_TEXT_NOT_FOUND' | 'ACK_TEXT_SUPERSEDED') {
    super(code);
    this.name = 'AcknowledgementTextError';
  }
}

export function findAcknowledgementText(
  version: string,
  tier: AcknowledgementTier,
  locale: AcknowledgementLocale,
): AcknowledgementText {
  const text = ACKNOWLEDGEMENT_TEXTS.find(
    (t) => t.version === version && t.tier === tier && t.locale === locale,
  );
  if (!text) throw new AcknowledgementTextError('ACK_TEXT_NOT_FOUND');
  return text;
}

/**
 * The hash recorded with an acknowledgement.
 *
 * Over the body alone, so the same words in both locales hash differently and the row says which one
 * the doctor actually read. Recomputed on every read of the registry rather than stored as a literal,
 * so editing a shipped text changes the hash and the mismatch is discoverable instead of silent.
 */
export function acknowledgementTextSha256(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Every text in force now, for a screen that has to render one. */
export function currentAcknowledgementTexts(): readonly AcknowledgementText[] {
  return ACKNOWLEDGEMENT_TEXTS.filter((t) => t.version === CURRENT_ACK_TEXT_VERSION);
}
