import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';
import { GATE_CODES, type GateCode, GateDecisionRecorder } from '../gate-decisions';

/**
 * `pnpm ops:record-risk-decision --gate GATE-SMS-HTTP --environment production --decision ACCEPTED
 *   --owner "<accountable owner>" --evidence "<ticket/doc ref>" --expires 2026-12-31 [--notes "..."]`
 *
 * Records an owner risk decision (ADR-018 §2). There is deliberately no HTTP route: only someone with
 * database access can accept a risk. `--decision REVOKED` re-opens the gate immediately (readers cache
 * for ≤ 60 s).
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      gate: { type: 'string' },
      environment: { type: 'string' },
      decision: { type: 'string', default: 'ACCEPTED' },
      owner: { type: 'string' },
      evidence: { type: 'string' },
      expires: { type: 'string' },
      notes: { type: 'string' },
    },
  });
  const url = process.env.DATABASE_URL;
  const gate = values.gate as GateCode | undefined;
  const env = values.environment;
  const decision = values.decision;
  if (
    !url ||
    !gate ||
    !(GATE_CODES as readonly string[]).includes(gate) ||
    (env !== 'staging' && env !== 'production') ||
    (decision !== 'ACCEPTED' && decision !== 'REVOKED') ||
    !values.owner ||
    !values.evidence ||
    (decision === 'ACCEPTED' && !/^\d{4}-\d{2}-\d{2}$/.test(values.expires ?? ''))
  ) {
    process.stderr.write(
      `usage: record-risk-decision --gate ${GATE_CODES.join('|')} --environment staging|production ` +
        '--decision ACCEPTED|REVOKED --owner <name> --evidence <ref> --expires YYYY-MM-DD [--notes <text>]\n' +
        'DATABASE_URL is required. ACCEPTED decisions need a future expiry date.\n',
    );
    return 2;
  }
  const db = createDatabase({ url, poolMax: 2 });
  try {
    const r = await new GateDecisionRecorder(db.prisma).record({
      gateCode: gate,
      environment: env,
      decision,
      ownerName: values.owner,
      evidenceRef: values.evidence,
      notes: values.notes ?? null,
      decidedBy: `cli:${userInfo().username}`,
      expiresAt: values.expires ? new Date(`${values.expires}T23:59:59.999+06:00`) : null,
    });
    process.stdout.write(
      `${JSON.stringify({ event: 'GATE_DECISION_RECORDED', gate, environment: env, decision, seq: r.seq.toString() })}\n`,
    );
    return 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'error');
    process.stderr.write(`record-risk-decision failed: ${code}\n`);
    process.exitCode = 1;
  },
);
