import { describe, expect, it } from 'vitest';
import { E164_RE, confirmationToken } from '../../src/cli/create-operator-user';

/**
 * The two checks that decide whether `ops:create-operator-user` can create the wrong account.
 *
 * The token is what makes the command a two-step one, so it has to be stable within a window, bound to
 * the email, and useless for a different one. The phone pattern is what the OTP step-up depends on: an
 * operator account whose number cannot receive a code is an account nobody can finish logging in to.
 */
describe('create-operator-user confirmation token', () => {
  const at = new Date('2026-10-05T14:03:00Z');

  it('is stable within the quarter-hour window', () => {
    expect(confirmationToken('ops@example.com', at)).toBe(
      confirmationToken('ops@example.com', new Date('2026-10-05T14:14:59Z')),
    );
  });

  it('changes at the window boundary', () => {
    expect(confirmationToken('ops@example.com', at)).not.toBe(
      confirmationToken('ops@example.com', new Date('2026-10-05T14:15:00Z')),
    );
  });

  it('is bound to the email, so a token cannot create a different account', () => {
    expect(confirmationToken('ops@example.com', at)).not.toBe(confirmationToken('other@example.com', at));
  });

  it('carries its own purpose, so a token from a neighbouring command does not confirm this one', () => {
    // `ops:reset-owner-password` derives from `<email>:<window>`; this one prefixes the operation.
    const neighbour = Buffer.from(`ops@example.com:${Math.floor(at.getTime() / 900_000)}`)
      .toString('base64url')
      .slice(0, 12);
    expect(confirmationToken('ops@example.com', at)).not.toBe(neighbour);
  });
});

describe('create-operator-user phone validation', () => {
  it('accepts E.164 numbers', () => {
    for (const phone of ['+8801700000123', '+447911123456', '+12025550123']) {
      expect(E164_RE.test(phone)).toBe(true);
    }
  });

  it('refuses what the OTP sender cannot use', () => {
    for (const phone of [
      '01700000123', // national form, no country code
      '+0801700000123', // country code starting with zero
      '8801700000123', // missing +
      '+880 1700 000123', // spaces
      '+88017', // too short to be a real E.164 number
      '',
    ]) {
      expect(E164_RE.test(phone)).toBe(false);
    }
  });
});
