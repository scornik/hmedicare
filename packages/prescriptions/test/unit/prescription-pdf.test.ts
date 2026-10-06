import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, fontDirectory, fontFiles } from '../../src/infrastructure/render/fonts';
import {
  RX_TEMPLATE_VERSION,
  type RenderInput,
  type RenderItem,
  documentDefinition,
  renderPrescriptionPdf,
} from '../../src/infrastructure/render/prescription-pdf';

/**
 * The prescription PDF (RX-005).
 *
 * Three things are worth asserting, and the layout is not among them. The font must actually contain
 * Bengali glyphs, or a Bangla instruction prints as blank boxes and a patient cannot take the medicine
 * correctly. Two renders of one prescription must produce identical bytes, or `last_render_sha256` is
 * decoration. And nothing on the page may come from anywhere except the approved snapshot.
 */
const item = (over: Partial<RenderItem> = {}): RenderItem => ({
  sequence: 1,
  name: 'DEMO-Synthacillin',
  isFreeText: false,
  strength: '500 mg',
  dosageForm: 'tablet',
  route: null,
  dose: '1 tablet',
  frequency: 'twice daily',
  duration: '5 days',
  quantity: null,
  timing: 'after food',
  instructions: null,
  instructionsBn: null,
  substitutionAllowed: true,
  ...over,
});

const input = (over: Partial<RenderInput> = {}): RenderInput => ({
  prescriptionId: '01a10c11-adb4-7b44-a49c-39463dae884f',
  revision: 1,
  clinicalStatus: 'APPROVED',
  approvedAt: new Date('2026-10-05T09:30:00.000Z'),
  approvedSnapshotSha256: 'a'.repeat(64),
  clinicName: 'DEMO Clinic',
  doctorName: 'Dr. DEMO A1',
  doctorRegistration: 'BMDC-00000',
  patientName: 'DEMO Patient 101',
  patientCode: 'P-000101',
  items: [item()],
  ...over,
});

/**
 * Glyph id for a code point, read from the font's `cmap` (formats 4 and 12).
 *
 * Written out rather than pulled from a font library: `fontkit` reaches this workspace only as a
 * transitive dependency of `pdfkit`, and a test that asserts "the font has Bengali glyphs" should not
 * be able to break because a dependency tree moved.
 */
function glyphFor(font: Buffer, codePoint: number): number {
  const tableCount = font.readUInt16BE(4);
  let cmap = 0;
  for (let i = 0; i < tableCount; i += 1) {
    const entry = 12 + i * 16;
    if (font.toString('ascii', entry, entry + 4) === 'cmap') cmap = font.readUInt32BE(entry + 8);
  }
  if (cmap === 0) throw new Error('the font has no cmap table');

  const encodings = font.readUInt16BE(cmap + 2);
  let best = 0;
  let bestFormat = -1;
  for (let i = 0; i < encodings; i += 1) {
    const record = cmap + 4 + i * 8;
    const subtable = cmap + font.readUInt32BE(record + 4);
    const format = font.readUInt16BE(subtable);
    // Prefer format 12 when present: it covers code points above the BMP, which format 4 cannot.
    if ((format === 12 || format === 4) && format > bestFormat) {
      best = subtable;
      bestFormat = format;
    }
  }
  if (bestFormat === 12) {
    const groups = font.readUInt32BE(best + 12);
    for (let i = 0; i < groups; i += 1) {
      const g = best + 16 + i * 12;
      const start = font.readUInt32BE(g);
      const end = font.readUInt32BE(g + 4);
      if (codePoint >= start && codePoint <= end) {
        return font.readUInt32BE(g + 8) + (codePoint - start);
      }
    }
    return 0;
  }
  if (bestFormat !== 4) throw new Error('the font has no cmap format this test understands');
  if (codePoint > 0xffff) return 0;

  const segCount = font.readUInt16BE(best + 6) / 2;
  const ends = best + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  for (let seg = 0; seg < segCount; seg += 1) {
    if (codePoint > font.readUInt16BE(ends + seg * 2)) continue;
    if (codePoint < font.readUInt16BE(starts + seg * 2)) return 0;
    const rangeOffset = font.readUInt16BE(rangeOffsets + seg * 2);
    if (rangeOffset === 0) {
      return (codePoint + font.readInt16BE(deltas + seg * 2)) & 0xffff;
    }
    const at = rangeOffsets + seg * 2 + rangeOffset + (codePoint - font.readUInt16BE(starts + seg * 2)) * 2;
    const glyph = font.readUInt16BE(at);
    return glyph === 0 ? 0 : (glyph + font.readInt16BE(deltas + seg * 2)) & 0xffff;
  }
  return 0;
}

describe('prescription PDF fonts', () => {
  it('finds the vendored font files', () => {
    const files = fontFiles(fontDirectory());
    for (const file of Object.values(files)) {
      // Real TrueType, checked by the version tag rather than the extension.
      expect(readFileSync(file).subarray(0, 4)).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x00]));
    }
  });

  it('covers the Bengali block, so Bangla directions are not blank boxes', () => {
    const font = readFileSync(fontFiles().normal);
    // ক খ গ, the Bengali digit ৫, and the virama that joins conjuncts — a font missing the virama
    // renders "ন্যাপা" as three disconnected consonants. Asked of the font's own cmap rather than of a
    // library, so the test depends on nothing pdfmake might swap out.
    for (const cp of [0x0995, 0x0996, 0x0997, 0x09eb, 0x09cd]) {
      expect(glyphFor(font, cp)).toBeGreaterThan(0);
    }
    // A code point no Bengali or Latin face carries, to prove the lookup can answer "no".
    expect(glyphFor(font, 0x4e2d)).toBe(0);
  });

  it('refuses a font directory that holds no font', () => {
    expect(() => fontFiles(path.join(path.sep, 'nowhere', 'fonts'))).toThrow(/missing/);
  });
});

describe('prescription PDF document definition', () => {
  it('uses the embedded family and pins the creation date to the approval time', () => {
    const def = documentDefinition(input()) as {
      defaultStyle: { font: string };
      info: { creationDate: Date; producer: string };
    };
    expect(def.defaultStyle.font).toBe(FONT_FAMILY);
    // Not `new Date()`: a PDF whose bytes move on every render cannot be compared with the hash
    // recorded for the last one.
    expect(def.info.creationDate.toISOString()).toBe('2026-10-05T09:30:00.000Z');
    expect(def.info.producer).toBe(RX_TEMPLATE_VERSION);
  });

  it('marks a free-text line on the page, not only in the database', () => {
    const def = JSON.stringify(documentDefinition(input({ items: [item({ isFreeText: true })] })));
    // A pharmacist has to be able to see that a name was typed rather than chosen from the catalog.
    expect(def).toContain('Free text (not from the medication catalog)');
  });

  it('prints the substitution rule either way', () => {
    const allowed = JSON.stringify(documentDefinition(input()));
    const refused = JSON.stringify(
      documentDefinition(input({ items: [item({ substitutionAllowed: false })] })),
    );
    expect(allowed).toContain('Substitution allowed');
    // Silence must not read as permission.
    expect(refused).toContain('Do not substitute');
  });

  it('watermarks a void revision', () => {
    const def = documentDefinition(input({ clinicalStatus: 'VOID' })) as {
      watermark?: { text: string };
    };
    expect(def.watermark?.text).toBe('VOID');
    expect((documentDefinition(input()) as { watermark?: unknown }).watermark).toBeUndefined();
  });

  it('prints only what the doctor wrote, leaving empty fields empty', () => {
    const def = JSON.stringify(
      documentDefinition(input({ items: [item({ timing: null, quantity: null })] })),
    );
    expect(def).toContain('1 tablet · twice daily · 5 days');
    // No separator left dangling where the empty fields were, and nothing invented to fill them.
    expect(def).not.toContain('5 days · ·');
    expect(def).not.toContain('null');
  });
});

describe('prescription PDF rendering', () => {
  it('renders a PDF and reports its checksum', async () => {
    const out = await renderPrescriptionPdf(input());
    expect(out.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.templateVersion).toBe(RX_TEMPLATE_VERSION);
    expect(out.bytes.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders the same bytes twice for the same prescription', async () => {
    const [first, second] = await Promise.all([
      renderPrescriptionPdf(input()),
      renderPrescriptionPdf(input()),
    ]);
    // The whole point of `last_render_sha256`: a re-render can be compared rather than merely repeated.
    expect(second.sha256).toBe(first.sha256);
  }, 30_000);

  it('renders different bytes when an item changes', async () => {
    const a = await renderPrescriptionPdf(input());
    const b = await renderPrescriptionPdf(input({ items: [item({ dose: '2 tablets' })] }));
    expect(b.sha256).not.toBe(a.sha256);
  }, 30_000);

  it('embeds Bangla instructions as text rather than dropping them', async () => {
    const bn = 'খাবারের পরে একটি ট্যাবলেট';
    const out = await renderPrescriptionPdf(input({ items: [item({ instructionsBn: bn })] }));
    const plain = await renderPrescriptionPdf(input());
    // A font without the glyphs still produces a PDF — it just produces one with blanks where the
    // directions should be. Comparing against the same prescription without the Bangla line is what
    // catches that: real glyph data makes the document bigger.
    expect(out.bytes.length).toBeGreaterThan(plain.bytes.length);
  }, 30_000);
});
