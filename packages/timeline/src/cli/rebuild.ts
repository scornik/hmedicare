import { parseArgs } from 'node:util';
import { createDatabase } from '@hmedic/database';
import { jobsSection } from '@hmedic/config';
import { isUuid } from '@hmedic/kernel';
import { createTimelineProjector } from '../nest/worker-module';

/** Builds a new version and reports parity. Activation is a separate operator decision. */
async function main() {
  const { values } = parseArgs({ options: { tenant: { type: 'string' }, version: { type: 'string' } } });
  const active = jobsSection.TIMELINE_PROJECTION_VERSION.parse(process.env.TIMELINE_PROJECTION_VERSION);
  const target = Number(values.version);
  if (
    !isUuid(values.tenant) ||
    !Number.isInteger(target) ||
    target <= active ||
    target > 32767 ||
    !process.env.DATABASE_URL
  ) {
    process.stderr.write(
      'Require DATABASE_URL, --tenant <UUID>, and --version <integer greater than active version>\n',
    );
    return 1;
  }
  const db = createDatabase({ url: process.env.DATABASE_URL, poolMax: 2 });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const { projector } = createTimelineProjector(db.prisma, active);
    const result = await projector.rebuild(values.tenant, target, controller.signal);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.matches ? 0 : 2;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await db.close();
  }
}
main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write('timeline rebuild failed; active projection unchanged\n');
    process.exitCode = 1;
  },
);
