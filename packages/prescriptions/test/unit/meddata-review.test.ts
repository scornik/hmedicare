import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sampleRecords, scoreSample, splitCsvLine } from '../../src/cli/meddata-review';

/**
 * The two parts of `meddata:review` that a gate record depends on being right.
 *
 * The sample has to be reproducible, because a reviewer who signs off on ten records is asserting
 * which ten; and the error rate has to be the rate over what was actually reviewed, because that
 * number is copied into an append-only attestation that nobody can later correct.
 */
async function datasetWith(records: Array<Record<string, unknown>>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'meddata-review-'));
  const file = path.join(dir, 'medications.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
}

const record = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `rec_${n}`,
  record_key: `key_${n}`,
  brand_name: { value: `Brand ${n}` },
  generic_names: { value: ['Generic A'] },
  dosage_form: { value: 'tablet' },
  manufacturer: { value: 'Labs Ltd' },
  ...extra,
});

describe('meddata:review sampling', () => {
  it('draws the same records for the same seed and different ones for another', async () => {
    const file = await datasetWith(Array.from({ length: 200 }, (_, i) => record(i)));

    const a = await sampleRecords(file, 10, 'seed-one');
    const b = await sampleRecords(file, 10, 'seed-one');
    const c = await sampleRecords(file, 10, 'seed-two');

    expect(a.sample.map((r) => r.id)).toEqual(b.sample.map((r) => r.id));
    expect(a.sample).toHaveLength(10);
    // Not a property of the algorithm, but of this seed pair: two independent draws of 10 from 200
    // sharing every member would mean the seed is not reaching the generator.
    expect(c.sample.map((r) => r.id)).not.toEqual(a.sample.map((r) => r.id));
  });

  it('samples what would be imported, excluding veterinary products', async () => {
    const file = await datasetWith([
      ...Array.from({ length: 5 }, (_, i) => record(i)),
      record(100, { dosage_form: { value: 'bolus_veterinary' } }),
      record(101, { manufacturer: { value: 'Acme (Veterinary)' } }),
    ]);

    const { sample, considered, excluded } = await sampleRecords(file, 10, 'seed');

    // A pharmacist reviewing rows the catalog will never hold has reviewed nothing.
    expect(considered).toBe(5);
    expect(excluded).toBe(2);
    expect(sample.map((r) => r.id).sort()).toEqual(['rec_0', 'rec_1', 'rec_2', 'rec_3', 'rec_4']);
  });

  it('returns every importable record when the sample is larger than the dataset', async () => {
    const file = await datasetWith([record(1), record(2)]);
    const { sample } = await sampleRecords(file, 10, 'seed');
    expect(sample).toHaveLength(2);
  });
});

describe('meddata:review scoring', () => {
  const header =
    'record_id,brand_name,generic_names,strength,dosage_form,route,manufacturer,' +
    'registration_number,dgda_match,monograph_url,verdict,notes';

  it('rates errors over the rows a reviewer actually marked', () => {
    const csv = [
      header,
      'rec_1,A,,,,,,,,,ok,',
      'rec_2,B,,,,,,,,,error,wrong strength',
      'rec_3,C,,,,,,,,,ok,',
      'rec_4,D,,,,,,,,,,', // left unmarked
    ].join('\n');

    const score = scoreSample(csv);

    // Four rows, three reviewed: the sample size is three, because reporting four would overstate
    // what was checked in a record production decisions are made from.
    expect(score.rows).toBe(4);
    expect(score.reviewed).toBe(3);
    expect(score.errors).toBe(1);
    expect(score.unreviewed).toBe(1);
    expect(score.errorRatePercent).toBe(33.3);
  });

  it('reports no rate at all when nothing was marked', () => {
    const score = scoreSample([header, 'rec_1,A,,,,,,,,,,'].join('\n'));
    expect(score.reviewed).toBe(0);
    expect(score.errorRatePercent).toBeNull();
  });

  it('collects verdicts it cannot read rather than counting them as passes', () => {
    const csv = [header, 'rec_1,A,,,,,,,,,maybe,', 'rec_2,B,,,,,,,,,OK,'].join('\n');
    const score = scoreSample(csv);
    expect(score.invalidVerdicts).toEqual(['maybe']);
    expect(score.reviewed).toBe(1); // "OK" is a case difference, not an unreadable verdict
    expect(score.errors).toBe(0);
  });

  it('refuses a file that is not the sample it wrote', () => {
    expect(() => scoreSample('a,b,c\n1,2,3')).toThrow(/verdict/);
  });

  it('reads quoted cells, including commas and escaped quotes', () => {
    expect(splitCsvLine('rec_1,"Brand, Plus","said ""ok""",x')).toEqual([
      'rec_1',
      'Brand, Plus',
      'said "ok"',
      'x',
    ]);
  });
});
