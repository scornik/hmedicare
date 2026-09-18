import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StaffRole } from '@hmedic/kernel';
import {
  PLATFORM_PERMISSIONS,
  PolicyEngine,
  ROLE_PERMISSIONS,
  ROLE_PERMISSIONS_VERSION,
  STAFF_ROLES,
  TENANT_PERMISSIONS,
} from '../../src/public/index';
import { MATRIX_COLUMNS, MATRIX_ROWS } from './authorization-matrix.fixture';
import { EXPECTATIONS, ROLE_PERMISSIONS_SNAPSHOT } from './authorization-matrix.expectations';

// ID-005 authorization-matrix test (AUTHORIZATION-MATRIX.md §7).
const DOC = path.resolve(__dirname, '../../../../docs/implementation/AUTHORIZATION-MATRIX.md');

function parseDocMatrix() {
  const md = readFileSync(DOC, 'utf8');
  const section = md.slice(md.indexOf('## 5. Matrix'), md.indexOf('### 5.1'));
  const lines = section.split('\n').filter((l) => l.startsWith('| '));
  const header = lines[0]!
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  const rows = lines
    .slice(1)
    .filter((l) => !l.startsWith('| Resource'))
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    )
    .map(([resource, ...cells]) => ({ resource: resource!, cells }));
  return { header, rows };
}

function roleMapHash(): string {
  const canonical = STAFF_ROLES.map((r) => `${r}:${[...ROLE_PERMISSIONS[r]].sort().join(',')}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

describe('authorization matrix (doc ↔ fixture ↔ engine)', () => {
  it('1. the §5 table in the doc equals the fixture', () => {
    const { header, rows } = parseDocMatrix();
    expect(header).toEqual([
      'Resource',
      'tenant_owner',
      'clinic_admin',
      'doctor',
      'nurse',
      'receptionist',
      'billing_manager',
      'patient context',
    ]);
    expect(MATRIX_COLUMNS).toHaveLength(7);
    expect(rows).toEqual(MATRIX_ROWS);
  });

  it('every matrix row has a permission derivation', () => {
    expect(Object.keys(EXPECTATIONS).sort()).toEqual(MATRIX_ROWS.map((r) => r.resource).sort());
  });

  describe('2. PolicyEngine decisions match every cell', () => {
    for (const row of MATRIX_ROWS) {
      const exp = EXPECTATIONS[row.resource]!;
      it(row.resource, () => {
        for (const [role, perms] of Object.entries(exp.has ?? {})) {
          const eff = PolicyEngine.effectivePermissions(role as StaffRole);
          for (const p of perms) expect({ role, p, allowed: eff.has(p) }).toEqual({ role, p, allowed: true });
        }
        for (const [role, perms] of Object.entries(exp.lacks ?? {})) {
          const eff = PolicyEngine.effectivePermissions(role as StaffRole);
          for (const p of perms)
            expect({ role, p, allowed: eff.has(p) }).toEqual({ role, p, allowed: false });
        }
        for (const [role, perms] of Object.entries(exp.grantable ?? {})) {
          const r = role as StaffRole;
          for (const p of perms) {
            expect(PolicyEngine.effectivePermissions(r).has(p)).toBe(false);
            expect(PolicyEngine.validateOverrides(r, { grants: [p], denials: [] }, 'tenant_owner')).toEqual(
              [],
            );
            expect(PolicyEngine.effectivePermissions(r, { grants: [p], denials: [] }).has(p)).toBe(true);
          }
        }
      });
    }
  });

  it('3. ROLE_PERMISSIONS cannot change without a version bump', () => {
    const hash = roleMapHash();
    if (ROLE_PERMISSIONS_VERSION === ROLE_PERMISSIONS_SNAPSHOT.version) {
      expect(hash).toBe(ROLE_PERMISSIONS_SNAPSHOT.sha256);
    } else {
      throw new Error(
        `ROLE_PERMISSIONS_VERSION is ${ROLE_PERMISSIONS_VERSION}; update ROLE_PERMISSIONS_SNAPSHOT to {version: ${ROLE_PERMISSIONS_VERSION}, sha256: '${hash}'} with an audit row`,
      );
    }
  });
});

describe('PolicyEngine rules', () => {
  it('denials always win over role permissions and grants', () => {
    const eff = PolicyEngine.effectivePermissions('doctor', {
      grants: ['coverage.manage'],
      denials: ['prescription.approve', 'coverage.manage'],
    });
    expect(eff.has('prescription.approve')).toBe(false);
    expect(eff.has('coverage.manage')).toBe(false);
    expect(eff.has('prescription.read')).toBe(true);
  });

  it('role maps use only the tenant catalog; catalogs are disjoint', () => {
    const tenant = new Set<string>(TENANT_PERMISSIONS);
    for (const perms of Object.values(ROLE_PERMISSIONS))
      for (const p of perms) expect(tenant.has(p)).toBe(true);
    for (const p of PLATFORM_PERMISSIONS) expect(tenant.has(p)).toBe(false);
  });

  it('rejects platform permissions, unknown names and forbidden grants on write (T31)', () => {
    expect(
      PolicyEngine.validateOverrides(
        'clinic_admin',
        { grants: ['ops.jobs.replay'], denials: [] },
        'tenant_owner',
      ),
    ).toEqual([{ kind: 'PLATFORM_PERMISSION', permission: 'ops.jobs.replay' }]);
    expect(
      PolicyEngine.validateOverrides('nurse', { grants: ['nope.read'], denials: [] }, 'tenant_owner'),
    ).toEqual([{ kind: 'UNKNOWN_PERMISSION', permission: 'nope.read' }]);
    expect(
      PolicyEngine.validateOverrides('nurse', { grants: ['ai.approve'], denials: [] }, 'tenant_owner'),
    ).toEqual([{ kind: 'NOT_GRANTABLE_TO_ROLE', permission: 'ai.approve' }]);
    expect(
      PolicyEngine.validateOverrides(
        'receptionist',
        { grants: ['tenant.manage'], denials: [] },
        'clinic_admin',
      ),
    ).toEqual([{ kind: 'GRANTOR_CANNOT_GRANT', permission: 'tenant.manage' }]);
    // Platform permissions are ignored by the engine even if stored.
    expect(
      PolicyEngine.effectivePermissions('doctor', { grants: ['ops.jobs.replay'], denials: [] }).has(
        'ops.jobs.replay',
      ),
    ).toBe(false);
  });
});
