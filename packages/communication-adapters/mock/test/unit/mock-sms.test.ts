import { describe, expect, it } from 'vitest';
import type { SmsCredentialHandle } from '@hmedic/communication';
import { MockSmsAdapter } from '../../src/index';

// SMS-003 in-process mock: every outcome scenario; nothing sent; no full phone or text stored.
const credential: SmsCredentialHandle = {
  scope: 'PLATFORM',
  credentialId: null,
  tenantId: null,
  senderId: 'DEMO',
  withKey: (fn) => fn('zit_fake_mock'),
};
const send = (m: MockSmsAdapter, text = 'code 123456') =>
  m.send({ credential, destination: '+8801700000071', text, purpose: 'OTP' });

describe('MockSmsAdapter', () => {
  it('reproduces success, 1001–1007, unavailable and unknown outcomes', async () => {
    const m = new MockSmsAdapter().enqueue('e1001', 'e1006', 'provider_unavailable', 'unknown_outcome');
    expect(await send(m)).toMatchObject({ outcome: 'REJECTED', errorClass: 'INVALID_CREDENTIAL' });
    expect(await send(m)).toMatchObject({ outcome: 'REJECTED', errorClass: 'INSUFFICIENT_BALANCE' });
    expect((await send(m)).outcome).toBe('PROVIDER_UNAVAILABLE');
    expect((await send(m)).outcome).toBe('UNKNOWN_OUTCOME');
    expect(await send(m)).toMatchObject({ outcome: 'ACCEPTED', segmentsEstimated: 1, encoding: 'text' });
    expect(JSON.stringify(m.sent)).not.toContain('8801700000071');
    expect(JSON.stringify(m.sent)).not.toContain('123456');
  });

  it('reports balances including low and unparsed', async () => {
    const m = new MockSmsAdapter().enqueue('low_balance', 'unparsed_balance', 'e1001');
    expect(await m.checkBalance()).toMatchObject({ balance: '12.50' });
    expect(await m.checkBalance()).toMatchObject({ parseStatus: 'UNPARSED' });
    expect(await m.checkBalance()).toMatchObject({ outcome: 'REJECTED', errorClass: 'INVALID_CREDENTIAL' });
  });
});
