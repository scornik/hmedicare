// ADR-016 selects sharp. Only the reviewed unmodified prebuilt libraries on the supported
// Windows x64 development and Linux x64 hosting/CI targets are excepted. Keep package notices.
// Other platforms, versions and licenses require another explicit review of their metadata.
const PREBUILTS = new Map([
  ['@img/sharp-win32-x64', { version: '0.35.5', license: 'Apache-2.0 AND LGPL-3.0-or-later' }],
  ['@img/sharp-libvips-linux-x64', { version: '1.3.4', license: 'LGPL-3.0-or-later' }],
]);

export function allowedImageScannerLicense(license, name, versions) {
  const reviewed = PREBUILTS.get(name);
  return Boolean(
    reviewed &&
    license === reviewed.license &&
    versions.length > 0 &&
    versions.every((version) => version === reviewed.version),
  );
}
