import { beforeEach, describe, expect, it } from 'vitest';
import type { AppError } from '@hmedic/kernel';
import { type DownloadTokenClaims, DownloadTokenService } from '../../src/infrastructure/download-tokens';

/**
 * Download tokens (FILE-STORAGE-IMPLEMENTATION.md §2.5).
 *
 * Every assertion here is a leak that would exist without it: a link that works for whoever it was
 * pasted to, a link that keeps working tomorrow, a link reused to pull a newer revision, or an error
 * message that tells an attacker which part of their guess was wrong.
 */
const CLAIMS: DownloadTokenClaims = {
  tenantId: '01a0c8e8-821f-78b5-ba9e-50c644b3a5ca',
  actorUserId: '01a10c11-adb4-7b44-a49c-39463dae884f',
  documentId: '01a10c60-3f72-7490-827b-e29a38359f92',
  revision: 1,
};

/** The rate-limit counters, in memory: one row per subject, as the database table behaves. */
function fakeLimiter() {
  const used = new Map<string, number>();
  return {
    used,
    consume: async (rule: { limit: number }, subject: string) => {
      const count = (used.get(subject) ?? 0) + 1;
      used.set(subject, count);
      return { allowed: count <= rule.limit, estimate: count, retryAfterSeconds: 0 };
    },
  };
}

let now = new Date('2026-10-07T10:00:00.000Z');
let limiter: ReturnType<typeof fakeLimiter>;

/**
 * `null` means "no secret configured". Not `undefined`: a default parameter treats an explicit
 * `undefined` as absent and substitutes the default, so the unconfigured case silently became the
 * configured one — which is how the first version of this test passed while asserting nothing.
 */
function service(secret: string | null = 's'.repeat(32), ttlSeconds = 60) {
  return new DownloadTokenService({
    prisma: {} as never,
    rateLimiter: limiter as never,
    secret: secret ?? undefined,
    ttlSeconds,
    clock: { now: () => now },
  });
}

beforeEach(() => {
  now = new Date('2026-10-07T10:00:00.000Z');
  limiter = fakeLimiter();
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return (e as AppError).code;
  }
};

describe('download tokens', () => {
  it('issues a token that redeems once', async () => {
    const svc = service();
    const { token, expiresAt } = svc.issue(CLAIMS);

    expect(expiresAt.toISOString()).toBe('2026-10-07T10:01:00.000Z');
    await expect(svc.redeem(token, CLAIMS)).resolves.toBeUndefined();
    // Single use: a saved link is spent the moment it is followed.
    expect(await code(svc.redeem(token, CLAIMS))).toBe('UNAUTHENTICATED');
  });

  it('refuses a token presented by a different actor', async () => {
    const svc = service();
    const { token } = svc.issue(CLAIMS);
    // A link pasted into a chat is useless to whoever reads it.
    expect(
      await code(svc.redeem(token, { ...CLAIMS, actorUserId: '00000000-0000-0000-0000-000000000000' })),
    ).toBe('UNAUTHENTICATED');
  });

  it('refuses a token for another revision of the same document', async () => {
    const svc = service();
    const { token } = svc.issue(CLAIMS);
    // A document that gains a revision must not expose the new one through an old link.
    expect(await code(svc.redeem(token, { ...CLAIMS, revision: 2 }))).toBe('UNAUTHENTICATED');
  });

  it('refuses a token for another document or another tenant', async () => {
    const svc = service();
    const { token } = svc.issue(CLAIMS);
    expect(
      await code(svc.redeem(token, { ...CLAIMS, documentId: '00000000-0000-0000-0000-000000000001' })),
    ).toBe('UNAUTHENTICATED');
    expect(
      await code(svc.redeem(token, { ...CLAIMS, tenantId: '00000000-0000-0000-0000-000000000002' })),
    ).toBe('UNAUTHENTICATED');
  });

  it('refuses an expired token', async () => {
    const svc = service();
    const { token } = svc.issue(CLAIMS);
    now = new Date('2026-10-07T10:01:01.000Z');
    expect(await code(svc.redeem(token, CLAIMS))).toBe('UNAUTHENTICATED');
  });

  it('refuses a token signed with a different secret', async () => {
    const { token } = service('a'.repeat(32)).issue(CLAIMS);
    expect(await code(service('b'.repeat(32)).redeem(token, CLAIMS))).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['empty', ''],
    ['no signature', '9999999999'],
    ['not hex', '9999999999.zzzz'],
    ['truncated signature', `9999999999.${'a'.repeat(63)}`],
    ['no expiry', `.${'a'.repeat(64)}`],
  ])('refuses a malformed token (%s)', async (_label, token) => {
    expect(await code(service().redeem(token, CLAIMS))).toBe('UNAUTHENTICATED');
  });

  it('does not spend a real token when a forged one is presented', async () => {
    const svc = service();
    const { token } = svc.issue(CLAIMS);
    const forged = `${token.split('.')[0]}.${'0'.repeat(64)}`;

    expect(await code(svc.redeem(forged, CLAIMS))).toBe('UNAUTHENTICATED');

    // Spending happens only after the signature checks out, so guessing cannot burn someone else's
    // single use — which would otherwise be a denial of service with no credentials at all.
    await expect(svc.redeem(token, CLAIMS)).resolves.toBeUndefined();
  });

  it('reports every failure identically, so a caller cannot probe', async () => {
    const svc = service();
    const { token } = svc.issue(CLAIMS);
    const expired = (() => {
      const t = svc.issue(CLAIMS).token;
      return t;
    })();
    now = new Date('2026-10-07T10:02:00.000Z');

    const reasons = [
      await code(svc.redeem(expired, CLAIMS)),
      await code(svc.redeem('nonsense', CLAIMS)),
      await code(svc.redeem(token, { ...CLAIMS, revision: 9 })),
    ];
    // Expired, malformed and wrong-revision are indistinguishable from outside.
    expect(new Set(reasons)).toEqual(new Set(['UNAUTHENTICATED']));
  });

  it('refuses to issue when no signing secret is configured', () => {
    // A predictable signing key is the same as no signature, so an unconfigured deployment serves
    // nothing rather than serving everything.
    expect(() => service(null).issue(CLAIMS)).toThrow(expect.objectContaining({ code: 'FEATURE_DISABLED' }));
  });
});
