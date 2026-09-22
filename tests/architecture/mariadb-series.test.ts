import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The MariaDB series are pinned in one file and read by every database gate. CI additionally pins a
 * digest per series, which a JSON file cannot supply to a workflow matrix without restructuring the
 * workflow — so this asserts the two agree instead.
 *
 * It exists because the drift already happened: HOST-001 found the deployed plan on 11.8 and the CI
 * matrix was re-pinned, but `checkpoint-verify.mjs` kept running 11.4 until Stage 6. The gate that
 * decides whether a checkpoint may be tagged was testing a series nothing runs.
 */
const root = path.resolve(__dirname, '../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/mariadb-series.json'), 'utf8')) as {
  series: Array<{ tag: string; role: string; ciDigest: string }>;
};
const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

describe('MariaDB series are pinned in one place', () => {
  it('names a floor and the deployed series', () => {
    expect(config.series.map((s) => s.role)).toEqual(['floor', 'deployed']);
  });

  it('the CI integration matrix matches config/mariadb-series.json exactly', () => {
    const matrix = [...workflow.matchAll(/^\s+- (mariadb:[\d.]+)@(sha256:[0-9a-f]{64})$/gm)].map(
      (m) => `${m[1]}@${m[2]}`,
    );
    expect(matrix).toEqual(config.series.map((s) => `${s.tag}@${s.ciDigest}`));
  });

  it('no gate hard-codes a series the config does not list', () => {
    const tags = new Set(config.series.map((s) => s.tag));
    for (const file of ['scripts/checkpoint-verify.mjs', 'scripts/test/run-integration.mjs']) {
      const source = readFileSync(path.join(root, file), 'utf8');
      // A tag in a comment is fine; a quoted one is a hard-coded pin.
      for (const [, tag] of source.matchAll(/['"](mariadb:[\d.]+)['"]/g)) {
        expect(tags, `${file} pins ${tag} directly`).toContain(tag);
      }
    }
  });
});
