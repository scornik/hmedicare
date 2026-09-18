import { describe, expect, it } from 'vitest';
import {
  SMS_TEMPLATES,
  estimateSegments,
  lintTemplate,
  renderTemplate,
  smsEncoding,
  worstCaseSegments,
} from '../../src/public/index';

// ADR-018 §3/§5, COMMUNICATION §6.3/§6.5.
describe('SMS encoding and segment estimates', () => {
  it('chooses text for GSM-7 and unicode for Bangla or emoji', () => {
    expect(smsEncoding('Your code is 123456 @ £ € {}')).toBe('text');
    expect(smsEncoding('কোড ১২৩৪৫৬')).toBe('unicode');
    expect(smsEncoding('ok 👍')).toBe('unicode');
  });

  it('respects the GSM-7 boundaries (160/161, 153 per part) and extension characters', () => {
    expect(estimateSegments('a'.repeat(160)).segments).toBe(1);
    expect(estimateSegments('a'.repeat(161)).segments).toBe(2);
    expect(estimateSegments('a'.repeat(306)).segments).toBe(2);
    expect(estimateSegments('a'.repeat(307)).segments).toBe(3);
    expect(estimateSegments('{'.repeat(80)).units).toBe(160);
    expect(estimateSegments('{'.repeat(81)).segments).toBe(2);
  });

  it('respects the UCS-2 boundaries (70/71, 67 per part)', () => {
    expect(estimateSegments('ক'.repeat(70)).segments).toBe(1);
    expect(estimateSegments('ক'.repeat(71)).segments).toBe(2);
    expect(estimateSegments('ক'.repeat(134)).segments).toBe(2);
    expect(estimateSegments('ক'.repeat(135)).segments).toBe(3);
  });
});

describe('SMS templates (lint in CI)', () => {
  it('every template uses only allowed placeholders and no clinical words', () => {
    for (const t of SMS_TEMPLATES) expect(lintTemplate(t)).toEqual([]);
  });

  it('OTP templates fit one segment in the worst case in both locales', () => {
    for (const t of SMS_TEMPLATES.filter((x) => x.key.startsWith('otp_'))) {
      expect(
        worstCaseSegments(t, { appName: 'Hakeemify', otpCode: '999999', otpMinutes: '5' }),
      ).toBeLessThanOrEqual(t.maxSegments);
    }
  });

  it('rejects unknown placeholders, forbidden words and missing values', () => {
    expect(
      lintTemplate({ key: 'x', locale: 'en-BD', version: 1, maxSegments: 1, body: 'Hi {patientName}' }),
    ).toHaveLength(1);
    expect(
      lintTemplate({
        key: 'x',
        locale: 'en-BD',
        version: 1,
        maxSegments: 1,
        body: 'Your prescription is ready',
      }),
    ).toHaveLength(1);
    expect(() => renderTemplate('otp_login', 'en-BD', { appName: 'X' })).toThrow(/missing template value/);
    expect(
      renderTemplate('otp_login', 'bn-BD', { appName: 'HMedic', otpCode: '123456', otpMinutes: '3' }),
    ).toContain('123456');
  });
});
