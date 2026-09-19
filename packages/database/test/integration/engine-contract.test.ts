import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { AppError, newId } from '@hmedic/kernel';
import {
  CLAIM_SELECT_SQL,
  DB_ENUMS,
  OUTBOX_CLAIM_SQL,
  type Database,
  acquireNamedLock,
  assertRowVersionMatched,
  dbErrorInfo,
  engineInfo,
  explain,
  lockRow,
  openLockConnection,
  withTransaction,
} from '../../src/index';
import { applyMigrations } from '../../../../tests/support/mariadb-global-setup';
import { openTestDatabase, rawConnection, testDatabaseUrl, truncateAll } from '../../../../tests/support/db';
// @ts-expect-error untyped .mjs helper shared with the migration tooling
import { columnMeta } from '../../scripts/lib/schema-meta.mjs';

// FOUND-004 engine-contract suite (DATABASE-IMPLEMENTATION.md §6). Runs on mariadb:10.6 and 11.4.
let db: Database;
const now = () => new Date();

async function seedTenantWithDoctor(label: string) {
  const tenantId = newId();
  const userId = newId();
  const doctorId = newId();
  const t = now();
  await db.prisma.tenant.create({
    data: {
      id: tenantId,
      name: `DEMO ${label}`,
      slug: `demo-${label}-${tenantId.slice(-6)}`,
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    },
  });
  await db.prisma.user.create({
    data: {
      id: userId,
      phoneE164: `+88017000${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    },
  });
  await db.prisma.doctorProfile.create({
    data: {
      id: doctorId,
      tenantId,
      userId,
      displayName: `Dr. ${label}`,
      specialties: [],
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    },
  });
  return { tenantId, userId, doctorId };
}

beforeAll(() => {
  db = openTestDatabase({ poolMax: 6 });
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await truncateAll();
});

describe('engine facts', () => {
  it('runs on MariaDB with UTC sessions and the documented collation', async () => {
    const info = await engineInfo(db.prisma);
    expect(info.isMariaDb).toBe(true);
    expect(inject('mariadbImage')).toContain(info.majorMinor);
    expect(info.timeZone).toBe('+00:00');
    const conn = await rawConnection();
    try {
      const rows = await conn.query(
        "SELECT TABLE_NAME AS t, TABLE_COLLATION AS c, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'",
      );
      expect(rows.length).toBeGreaterThan(20);
      for (const r of rows as Array<{ t: string; c: string; e: string }>) {
        expect(r.c, r.t).toBe('utf8mb4_unicode_520_ci');
        expect(r.e, r.t).toBe('InnoDB');
      }
    } finally {
      await conn.end();
    }
  });
});

describe('claim queries use the index order (no filesort) — HOSTING-VERIFICATION §3.2', () => {
  it('jobs claim uses ix_jobs_claim without filesort', async () => {
    const rows = await explain(db.prisma, CLAIM_SELECT_SQL, 'notifications', now(), 10);
    const extra = rows.map((r) => String(r.Extra ?? '')).join(' ');
    expect(rows.map((r) => r.key)).toContain('ix_jobs_claim');
    expect(extra).not.toMatch(/filesort/i);
  });

  it('outbox claim uses ix_outbox_claim without filesort', async () => {
    const rows = await explain(db.prisma, OUTBOX_CLAIM_SQL, 10);
    expect(rows.map((r) => r.key)).toContain('ix_outbox_claim');
    expect(rows.map((r) => String(r.Extra ?? '')).join(' ')).not.toMatch(/filesort/i);
  });
});

describe('CHECK lists equal the TypeScript enums (DB_ENUMS)', () => {
  it('every enum key has a CHECK with exactly the same values', async () => {
    const conn = await rawConnection();
    try {
      const rows = (await conn.query(
        'SELECT TABLE_NAME AS t, CHECK_CLAUSE AS c FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()',
      )) as Array<{ t: string; c: string }>;
      for (const [key, values] of Object.entries(DB_ENUMS)) {
        const [table, column] = key.split('.') as [string, string];
        // Word-anchored: `status IN (` must not match `verification_status IN (`. MariaDB stores a
        // one-element list as `col = 'X'`, so that form is accepted too.
        const inRe = new RegExp(`(^|[^a-z0-9_])\`?${column}\`?\\s+in\\s*\\(([^)]*)\\)`, 'i');
        const eqRe = new RegExp(`(^|[^a-z0-9_])\`?${column}\`?\\s*=\\s*'([^']*)'`, 'i');
        const clause = rows.find((r) => r.t === table && (inRe.test(r.c) || eqRe.test(r.c)));
        expect(clause, key).toBeDefined();
        const inList = clause?.c.match(inRe)?.[2];
        const listed =
          inList !== undefined
            ? [...inList.matchAll(/'([^']*)'/g)].map((m) => m[1])
            : [clause?.c.match(eqRe)?.[2] ?? ''];
        expect(new Set(listed), key).toEqual(new Set(values));
      }
    } finally {
      await conn.end();
    }
  });

  it('CHECK violations are enforced (error 4025)', async () => {
    const t = now();
    await expect(
      db.prisma.tenant.create({
        data: {
          id: newId(),
          name: 'DEMO bad',
          slug: `bad-${Date.now()}`,
          status: 'NOPE',
          createdAt: t,
          updatedAt: t,
        },
      }),
    ).rejects.toSatisfy((e: unknown) => dbErrorInfo(e).kind === 'CHECK_VIOLATION');
  });
});

describe('generated-column unique keys (DATABASE-IMPLEMENTATION.md §4.1)', () => {
  it('otp_challenges: one PENDING challenge per purpose and destination', async () => {
    const t = now();
    const base = {
      purpose: 'LOGIN',
      destinationHash: 'a'.repeat(64),
      channel: 'MOCK',
      codeHash: 'b'.repeat(64),
      status: 'PENDING',
      createdAt: t,
      expiresAt: t,
    };
    await db.prisma.otpChallenge.create({ data: { id: newId(), ...base } });
    const err = await db.prisma.otpChallenge
      .create({ data: { id: newId(), ...base } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({ kind: 'UNIQUE_VIOLATION', constraint: 'uq_otp_pending' });
    // A superseded challenge frees the key.
    await db.prisma.otpChallenge.updateMany({
      where: { destinationHash: base.destinationHash },
      data: { status: 'SUPERSEDED' },
    });
    await expect(db.prisma.otpChallenge.create({ data: { id: newId(), ...base } })).resolves.toBeDefined();
  });

  it('clinics: active clinic names are unique per tenant; inactive/deleted ones are not', async () => {
    const { tenantId } = await seedTenantWithDoctor('clinic');
    const t = now();
    const c = {
      tenantId,
      name: 'DEMO Clinic',
      nameNormalizedHash: 'c'.repeat(64),
      status: 'ACTIVE',
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.clinic.create({ data: { id: newId(), ...c } });
    const err = await db.prisma.clinic.create({ data: { id: newId(), ...c } }).catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({
      kind: 'UNIQUE_VIOLATION',
      constraint: 'uq_clinics_active_name',
    });
    await db.prisma.clinic.create({ data: { id: newId(), ...c, status: 'INACTIVE' } });
  });

  it('idempotency_records: tenant_scope folds NULL tenants into one "platform" scope', async () => {
    const t = now();
    const r = {
      scope: 'POST /auth/otp/request',
      idemKey: 'key-1',
      requestHash: 'd'.repeat(64),
      status: 'IN_PROGRESS',
      createdAt: t,
      expiresAt: t,
    };
    await db.prisma.idempotencyRecord.create({ data: { id: newId(), ...r } });
    const err = await db.prisma.idempotencyRecord
      .create({ data: { id: newId(), ...r } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({ kind: 'UNIQUE_VIOLATION', constraint: 'uq_idem' });
  });

  it('push_devices: one active registration per token', async () => {
    const { userId } = await seedTenantWithDoctor('push');
    const t = now();
    const p = {
      userId,
      platform: 'ANDROID',
      app: 'PATIENT_APP',
      tokenHash: 'e'.repeat(64),
      tokenEncrypted: 'x',
      createdAt: t,
      lastSeenAt: t,
    };
    await db.prisma.pushDevice.create({ data: { id: newId(), ...p } });
    const err = await db.prisma.pushDevice.create({ data: { id: newId(), ...p } }).catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({ kind: 'UNIQUE_VIOLATION', constraint: 'uq_push_active_token' });
    await db.prisma.pushDevice.create({ data: { id: newId(), ...p, revokedAt: t } });
  });

  // 0004 patient_identity (Stage 5): every generated unique of DATABASE §4.1 inserts a duplicate → 1062.
  async function seedPatient(tenantId: string, label: string) {
    const t = now();
    const id = newId();
    await db.prisma.patient.create({
      data: {
        id,
        tenantId,
        medicalRecordNumber: `DEMO-${label}-${id.slice(-6)}`,
        legalName: `DEMO ${label}`,
        displayName: `DEMO ${label}`,
        status: 'ACTIVE',
        createdAt: t,
        updatedAt: t,
      },
    });
    return id;
  }

  it('patient_contacts: one ACTIVE contact per patient, type and value hash', async () => {
    const { tenantId } = await seedTenantWithDoctor('contact');
    const patientId = await seedPatient(tenantId, 'contact');
    const t = now();
    const c = {
      tenantId,
      patientId,
      type: 'PHONE',
      normalizedValue: '+8801700000123',
      normalizedValueHash: 'f'.repeat(64),
      displayValue: '01700000123',
      verificationStatus: 'UNVERIFIED',
      status: 'ACTIVE',
      relationship: 'SELF',
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.patientContact.create({ data: { id: newId(), ...c } });
    const err = await db.prisma.patientContact
      .create({ data: { id: newId(), ...c } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({
      kind: 'UNIQUE_VIOLATION',
      constraint: 'uq_patient_contacts_active',
    });
    await db.prisma.patientContact.create({ data: { id: newId(), ...c, status: 'INACTIVE' } });
  });

  it('patient_identifiers: one VERIFIED identifier value per type and tenant', async () => {
    const { tenantId } = await seedTenantWithDoctor('ident');
    const p1 = await seedPatient(tenantId, 'ident-1');
    const p2 = await seedPatient(tenantId, 'ident-2');
    const t = now();
    const i = {
      tenantId,
      identifierType: 'NID',
      identifierValueEncrypted: 'enc',
      identifierValueHash: '0'.repeat(64),
      source: 'STAFF',
      verificationStatus: 'VERIFIED',
      verifiedAt: t,
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.patientIdentifier.create({ data: { id: newId(), patientId: p1, ...i } });
    const err = await db.prisma.patientIdentifier
      .create({ data: { id: newId(), patientId: p2, ...i } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({
      kind: 'UNIQUE_VIOLATION',
      constraint: 'uq_patient_identifiers_verified',
    });
    await db.prisma.patientIdentifier.create({
      data: { id: newId(), patientId: p2, ...i, verificationStatus: 'UNVERIFIED', verifiedAt: null },
    });
  });

  it('patient_merge_cases: one OPEN/IN_REVIEW case per source patient; the source may not be the target', async () => {
    const { tenantId } = await seedTenantWithDoctor('merge');
    const src = await seedPatient(tenantId, 'merge-src');
    const tgt = await seedPatient(tenantId, 'merge-tgt');
    const t = now();
    const m = {
      tenantId,
      sourcePatientId: src,
      targetPatientId: tgt,
      reason: 'duplicate',
      status: 'OPEN',
      requestedByUserId: newId(),
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.patientMergeCase.create({ data: { id: newId(), ...m } });
    const dup = await db.prisma.patientMergeCase
      .create({ data: { id: newId(), ...m, status: 'IN_REVIEW' } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(dup)).toMatchObject({ kind: 'UNIQUE_VIOLATION', constraint: 'uq_merge_open_source' });
    const self = await db.prisma.patientMergeCase
      .create({ data: { id: newId(), ...m, targetPatientId: src, status: 'REJECTED' } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(self).kind).toBe('CHECK_VIOLATION');
  });

  it('patient_accounts and patient_guardianships: one live row per (user, patient)', async () => {
    const { tenantId, userId } = await seedTenantWithDoctor('acct');
    const patientId = await seedPatient(tenantId, 'acct');
    const t = now();
    const a = {
      tenantId,
      userId,
      patientId,
      relationship: 'SELF',
      verificationMethod: 'OTP_PHONE_MATCH',
      status: 'PENDING',
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.patientAccount.create({ data: { id: newId(), ...a } });
    const dupA = await db.prisma.patientAccount
      .create({ data: { id: newId(), ...a, status: 'ACTIVE' } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(dupA)).toMatchObject({
      kind: 'UNIQUE_VIOLATION',
      constraint: 'uq_patient_accounts_live',
    });
    await db.prisma.patientAccount.create({ data: { id: newId(), ...a, status: 'REVOKED' } });

    const g = {
      tenantId,
      guardianUserId: userId,
      dependentPatientId: patientId,
      relationship: 'PARENT',
      authorityScope: ['VIEW_RECORDS'],
      status: 'PENDING',
      startsOn: new Date('2026-09-01T00:00:00.000Z'),
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.patientGuardianship.create({ data: { id: newId(), ...g } });
    const dupG = await db.prisma.patientGuardianship
      .create({ data: { id: newId(), ...g, status: 'ACTIVE' } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(dupG)).toMatchObject({
      kind: 'UNIQUE_VIOLATION',
      constraint: 'uq_guardianships_live',
    });
    const badWindow = await db.prisma.patientGuardianship
      .create({ data: { id: newId(), ...g, status: 'ENDED', endsOn: new Date('2026-08-01T00:00:00.000Z') } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(badWindow).kind).toBe('CHECK_VIOLATION');
  });

  it('care_team_members: one open membership per (patient, member, role)', async () => {
    const { tenantId, userId } = await seedTenantWithDoctor('care');
    const patientId = await seedPatient(tenantId, 'care');
    const t = now();
    const c = {
      tenantId,
      patientId,
      memberUserId: userId,
      role: 'NURSE',
      startsAt: t,
      addedByUserId: userId,
      createdAt: t,
      updatedAt: t,
    };
    await db.prisma.careTeamMember.create({ data: { id: newId(), ...c } });
    const err = await db.prisma.careTeamMember
      .create({ data: { id: newId(), ...c } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err)).toMatchObject({ kind: 'UNIQUE_VIOLATION', constraint: 'uq_care_team_open' });
    await db.prisma.careTeamMember.create({
      data: { id: newId(), ...c, endsAt: new Date(t.getTime() + 60_000) },
    });
  });

  it('patients: Bangla legal_name_bn round-trips byte-equal; MERGED requires the merged_into pointer', async () => {
    const { tenantId } = await seedTenantWithDoctor('bn');
    const id = await seedPatient(tenantId, 'bn');
    const bn = 'মোছাঃ রহিমা খাতুন'.normalize('NFC');
    await db.prisma.patient.update({ where: { id }, data: { legalNameBn: bn } });
    const read = await db.prisma.patient.findUniqueOrThrow({ where: { id } });
    expect(Buffer.from(read.legalNameBn ?? '', 'utf8').equals(Buffer.from(bn, 'utf8'))).toBe(true);
    const err = await db.prisma.patient
      .update({ where: { id }, data: { status: 'MERGED' } })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err).kind).toBe('CHECK_VIOLATION');
  });
});

describe('composite tenant foreign keys (DATABASE-IMPLEMENTATION.md §4.2)', () => {
  it('every FK between two tenant-owned tables includes tenant_id', async () => {
    const conn = await rawConnection();
    try {
      const tenantTables = new Set(
        (
          (await conn.query(
            "SELECT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'tenant_id'",
          )) as Array<{ t: string }>
        ).map((r) => r.t),
      );
      const fks = (await conn.query(
        `SELECT CONSTRAINT_NAME AS n, TABLE_NAME AS t, REFERENCED_TABLE_NAME AS rt, GROUP_CONCAT(COLUMN_NAME) AS cols
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
          GROUP BY CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME`,
      )) as Array<{ n: string; t: string; rt: string; cols: string }>;
      expect(fks.length).toBeGreaterThan(10);
      for (const fk of fks) {
        if (fk.t === 'tenants' || fk.rt === 'tenants') continue;
        if (tenantTables.has(fk.t) && tenantTables.has(fk.rt))
          expect(fk.cols.split(','), fk.n).toContain('tenant_id');
      }
    } finally {
      await conn.end();
    }
  });

  it('rejects a child that references a parent in another tenant (error 1452)', async () => {
    const a = await seedTenantWithDoctor('fk-a');
    const b = await seedTenantWithDoctor('fk-b');
    const t = now();
    const err = await db.prisma.doctorCoverage
      .create({
        data: {
          id: newId(),
          tenantId: a.tenantId,
          coveredDoctorProfileId: a.doctorId,
          coveringDoctorProfileId: b.doctorId, // doctor of tenant B
          startsAt: t,
          endsAt: new Date(t.getTime() + 86_400_000),
          reason: 'cover',
          status: 'ACTIVE',
          grantedByUserId: a.userId,
          createdAt: t,
          updatedAt: t,
        },
      })
      .catch((e: unknown) => e);
    expect(dbErrorInfo(err).kind).toBe('REFERENCE_VIOLATION');
  });
});

describe('locks and concurrency', () => {
  it('maps lock-wait timeouts (1205) to CONCURRENCY_RETRY_EXHAUSTED after retries', async () => {
    const { tenantId } = await seedTenantWithDoctor('lockwait');
    const holder = await rawConnection();
    const short = openTestDatabase({ poolMax: 2, lockWaitTimeoutSeconds: 1 });
    try {
      await holder.beginTransaction();
      await holder.query('SELECT id FROM tenants WHERE id = ? FOR UPDATE', [tenantId]);
      const err = await withTransaction(short.prisma, (tx) => lockRow(tx, 'tenants', tenantId), {
        retries: 1,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('CONCURRENCY_RETRY_EXHAUSTED');
      const queueErr = await withTransaction(short.prisma, (tx) => lockRow(tx, 'tenants', tenantId), {
        retries: 0,
        exhaustedCode: 'QUEUE_BUSY',
      }).catch((e: unknown) => e);
      expect((queueErr as AppError).code).toBe('QUEUE_BUSY');
    } finally {
      await holder.rollback();
      await holder.end();
      await short.close();
    }
  });

  it('retries a deadlock victim (1213) so both transactions complete', async () => {
    const a = await seedTenantWithDoctor('dl-a');
    const b = await seedTenantWithDoctor('dl-b');
    let retries = 0;
    const lockBoth = (first: string, second: string) =>
      withTransaction(
        db.prisma,
        async (tx) => {
          await lockRow(tx, 'tenants', first);
          await new Promise((r) => setTimeout(r, 150));
          await lockRow(tx, 'tenants', second);
          return true;
        },
        { retries: 3, onRetry: () => retries++ },
      );
    const results = await Promise.all([lockBoth(a.tenantId, b.tenantId), lockBoth(b.tenantId, a.tenantId)]);
    expect(results).toEqual([true, true]);
    expect(retries).toBeGreaterThanOrEqual(1);
  });

  it('GET_LOCK is exclusive across connections and released on demand', async () => {
    const c1 = await openLockConnection(testDatabaseUrl());
    const c2 = await openLockConnection(testDatabaseUrl());
    try {
      const l1 = await acquireNamedLock(c1, 'hmedic:test:singleton', 0);
      expect(l1).not.toBeNull();
      expect(await l1?.isHeld()).toBe(true);
      expect(await acquireNamedLock(c2, 'hmedic:test:singleton', 0)).toBeNull();
      await l1?.release();
      const l2 = await acquireNamedLock(c2, 'hmedic:test:singleton', 0);
      expect(l2).not.toBeNull();
      await l2?.release();
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it('optimistic row_version: two updates with the same expected version → exactly one wins', async () => {
    const { tenantId } = await seedTenantWithDoctor('rowversion');
    const update = () =>
      db.prisma.tenant.updateMany({
        where: { id: tenantId, rowVersion: 1 },
        data: { name: `DEMO renamed ${Math.random()}`, rowVersion: { increment: 1 } },
      });
    const [r1, r2] = await Promise.all([update(), update()]);
    expect(r1.count + r2.count).toBe(1);
    expect(() => assertRowVersionMatched(0)).toThrowError(expect.objectContaining({ code: 'STALE_VERSION' }));
  });
});

describe('text and time', () => {
  it('round-trips Bangla (NFC) and Banglish text byte-equal; Latin matching is case-insensitive', async () => {
    const t = now();
    const bangla = 'রহিম উদ্দিন ১২৩'.normalize('NFC');
    const id = newId();
    await db.prisma.user.create({
      data: {
        id,
        displayName: bangla,
        phoneE164: '+8801700000999',
        status: 'ACTIVE',
        createdAt: t,
        updatedAt: t,
      },
    });
    const read = await db.prisma.user.findUnique({ where: { id } });
    expect(Buffer.from(read?.displayName ?? '', 'utf8').equals(Buffer.from(bangla, 'utf8'))).toBe(true);
    await db.prisma.user.update({ where: { id }, data: { displayName: 'Karim Uddin' } });
    const ci = await db.prisma.user.findMany({ where: { displayName: 'KARIM UDDIN' } });
    expect(ci.map((u) => u.id)).toContain(id);
  });

  it('stores DATETIME(3) as UTC instants and keeps the Asia/Dhaka local-day boundary exact', async () => {
    const instants = ['2026-09-16T18:00:00.000Z', '2026-09-17T17:59:59.999Z', '2026-09-17T18:00:00.000Z'];
    const ids: string[] = [];
    for (const iso of instants) {
      const id = newId();
      ids.push(id);
      await db.prisma.rateLimitCounter.create({
        data: {
          scope: `tz-${id}`,
          subjectHash: 'f'.repeat(64),
          windowStart: new Date(iso),
          windowSeconds: 60,
          count: 1,
          expiresAt: new Date(iso),
        },
      });
    }
    const dhakaDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(d);
    const read = await Promise.all(
      ids.map((id) => db.prisma.rateLimitCounter.findFirst({ where: { scope: `tz-${id}` } })),
    );
    expect(read.map((r) => r?.windowStart.toISOString())).toEqual(instants);
    expect(read.map((r) => dhakaDate(r!.windowStart))).toEqual(['2026-09-17', '2026-09-17', '2026-09-18']);
    const conn = await rawConnection();
    try {
      const rows = await conn.query(
        'SELECT DATE_FORMAT(window_start, "%Y-%m-%d %H:%i:%s.%f") AS s FROM rate_limit_counters WHERE scope = ?',
        [`tz-${ids[0]}`],
      );
      expect((rows as Array<{ s: string }>)[0]?.s).toBe('2026-09-16 18:00:00.000000');
    } finally {
      await conn.end();
    }
  });
});

describe('migrations', () => {
  it('re-running migrate deploy on an up-to-date database is a no-op', () => {
    expect(() => applyMigrations(testDatabaseUrl())).not.toThrow();
  });

  it('every Prisma model field exists as a database column (schema drift check)', async () => {
    const schema = readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const { all } = columnMeta(schema) as { all: Map<string, Set<string>> };
    const conn = await rawConnection();
    try {
      const rows = (await conn.query(
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()',
      )) as Array<{ t: string; c: string }>;
      const actual = new Map<string, Set<string>>();
      for (const r of rows) actual.set(r.t, (actual.get(r.t) ?? new Set()).add(r.c));
      for (const [table, cols] of all) {
        for (const col of cols) expect(actual.get(table)?.has(col), `${table}.${col}`).toBe(true);
      }
    } finally {
      await conn.end();
    }
  });
});
