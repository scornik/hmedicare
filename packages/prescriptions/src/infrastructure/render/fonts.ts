import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The embedded font set for prescription PDFs (RX-005, ADR-020 §4).
 *
 * Noto Sans Bengali, vendored under `assets/fonts` with its OFL licence and provenance. `pdfmake`
 * bundles Roboto, which has no Bengali glyphs: a Bangla instruction rendered with it comes out as blank
 * boxes. For a Bangladesh product that is not a cosmetic problem — a patient holding a prescription
 * whose directions are empty rectangles cannot take the medicine correctly — so the font is a
 * correctness requirement and its absence is a hard failure rather than a fallback.
 */
export const FONT_FAMILY = 'NotoSansBengali';

export interface FontFiles {
  normal: string;
  bold: string;
}

export class FontSetError extends Error {
  constructor(
    readonly code: 'RX_FONT_MISSING',
    message: string,
  ) {
    super(message);
    this.name = 'FontSetError';
  }
}

/**
 * Resolves the vendored font directory from either the source tree or `dist`.
 *
 * `__dirname` is `src/infrastructure/render` when running through the development condition and
 * `dist/infrastructure/render` after a build, and the assets live beside neither — they sit at the
 * package root, which is three levels up from both. Checked rather than assumed, because a path that
 * silently resolves to nothing would surface as "no Bengali glyphs" much later.
 */
export function fontDirectory(from: string = __dirname): string {
  const candidates = [
    path.resolve(from, '../../../assets/fonts'),
    path.resolve(from, '../../../../assets/fonts'),
  ];
  const found = candidates.find((c) => existsSync(path.join(c, 'NotoSansBengali-Regular.ttf')));
  if (!found) {
    throw new FontSetError(
      'RX_FONT_MISSING',
      `no vendored font directory found from ${from}; looked in ${candidates.join(', ')}`,
    );
  }
  return found;
}

export function fontFiles(dir: string = fontDirectory()): FontFiles {
  const files: FontFiles = {
    normal: path.join(dir, 'NotoSansBengali-Regular.ttf'),
    bold: path.join(dir, 'NotoSansBengali-Bold.ttf'),
  };
  for (const [weight, file] of Object.entries(files)) {
    if (!existsSync(file)) {
      throw new FontSetError('RX_FONT_MISSING', `the ${weight} font is missing at ${file}`);
    }
  }
  return files;
}

/** The `fonts` option `pdfmake` expects, pointing at real files rather than a base64 virtual store. */
export function pdfmakeFonts(dir?: string): Record<string, FontFiles> {
  const files = fontFiles(dir);
  return { [FONT_FAMILY]: files };
}
