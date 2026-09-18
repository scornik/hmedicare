import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';
import { VerifyAppendOnlyChains } from '../infrastructure/verify-chains';

/**
 * `pnpm verify-audit-chain [--full] [--chain <checkpoint key>]`
 * Verifies the hash chains on demand. Prints one JSON line per chain (keys, counts and break position only,
 * never row contents). Exit 0 when every chain verifies, 2 when a chain is broken, 1 on error.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { full: { type: 'boolean', default: false }, chain: { type: 'string' } },
  });
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    return 1;
  }
  const db = createDatabase({ url, poolMax: 2 });
  try {
    const results = await new VerifyAppendOnlyChains(db.prisma).run({
      full: values.full,
      ...(values.chain ? { checkpointKey: values.chain } : {}),
    });
    for (const r of results) {
      process.stdout.write(
        `${JSON.stringify({
          chain: r.checkpointKey,
          ok: r.ok,
          from: r.verifiedFrom.toString(),
          through: r.verifiedThrough.toString(),
          rows: r.rows,
          ...(r.break ? { brokenAtSeq: r.break.seq.toString(), reason: r.break.reason } : {}),
        })}\n`,
      );
    }
    const broken = results.filter((r) => !r.ok).length;
    process.stdout.write(`${JSON.stringify({ chains: results.length, broken })}\n`);
    return broken ? 2 : 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`verify-audit-chain failed: ${error instanceof Error ? error.name : 'error'}\n`);
    process.exitCode = 1;
  },
);
