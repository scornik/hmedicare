import { describe, expect, it } from 'vitest';
import { sanitize, upsertRow } from './record-results';

describe('host:record-results', () => {
  const doc = '# Hosting\n\n## 5. Stage 4 smoke tests\n\ntext\n\n## 6. Next\n';

  it('creates the §5.1 table before §6 and replaces a same-day row', () => {
    const once = upsertRow(doc, {
      id: 'HOST-001',
      date: '2026-09-20',
      result: 'FAIL',
      by: 'ops',
      evidence: 'v10.5',
    });
    expect(once.indexOf('### 5.1 Results')).toBeLessThan(once.indexOf('## 6. Next'));
    const twice = upsertRow(once, {
      id: 'HOST-001',
      date: '2026-09-20',
      result: 'PASS',
      by: 'ops',
      evidence: 'v10.6.21',
    });
    expect(twice.match(/\| HOST-001 \| 2026-09-20 \|/g)).toHaveLength(1);
    expect(twice).toContain('| HOST-001 | 2026-09-20 | PASS | ops | v10.6.21 |');
    const third = upsertRow(twice, {
      id: 'HOST-003',
      date: '2026-09-21',
      result: 'PASS',
      by: 'ops',
      evidence: 'all checks',
    });
    expect(third.indexOf('HOST-001')).toBeLessThan(third.indexOf('HOST-003'));
  });

  it('never writes tokens, credentials in URLs or phone numbers', () => {
    const s = sanitize(
      'Authorization: Bearer abc.def-123 token=xyz password: hunter22 mariadb://user:pw@db:3306/x call 01700000111 | pipe',
    );
    expect(s).not.toMatch(/abc\.def|xyz|hunter22|user:pw|01700000111/);
    expect(s).not.toContain('|');
  });
});
