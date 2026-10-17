import { expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper shared with the dependency gate.
import { allowedImageScannerLicense } from './lib/image-scanner-license.mjs';

it.each([
  ['Apache-2.0 AND LGPL-3.0-or-later', '@img/sharp-win32-x64', ['0.35.5'], true],
  ['LGPL-3.0-or-later', '@img/sharp-libvips-linux-x64', ['1.3.4'], true],
  ['GPL-3.0-or-later', '@img/sharp-win32-x64', ['0.35.5'], false],
  ['LGPL-3.0-or-later', 'unreviewed-library', ['1.3.4'], false],
  ['LGPL-3.0-or-later', '@img/sharp-libvips-linux-arm64', ['1.3.4'], false],
  ['LGPL-3.0-or-later', '@img/sharp-libvips-linux-x64', ['1.3.5'], false],
  ['LGPL-3.0-or-later', '@img/sharp-libvips-linux-x64', ['1.3.4', '1.3.5'], false],
  ['LGPL-3.0-or-later', '@img/sharp-libvips-linux-x64', [], false],
] as const)(
  'keeps image-library license exceptions scoped (%s, %s, %j)',
  (license, name, versions, accepted) => {
    expect(allowedImageScannerLicense(license, name, versions)).toBe(accepted);
  },
);
