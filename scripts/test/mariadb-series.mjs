// The MariaDB series every database gate runs against, read from config/mariadb-series.json.
//
// This is its own module on purpose. `run-integration.mjs` runs the suites as a side effect of being
// loaded, so importing the helper from there would start a real test run.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/mariadb-series.json');

/** Image tags, floor first. Throws rather than guessing if the config is missing or malformed. */
export function supportedSeries() {
  const parsed = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const tags = parsed.series?.map((s) => s.tag).filter((t) => typeof t === 'string' && t.length > 0);
  if (!tags?.length) throw new Error(`${CONFIG}: no series defined`);
  return tags;
}

/** `MARIADB_IMAGES` when set (a deliberate one-off override), otherwise the configured series. */
export function seriesFromEnvOrConfig(env = process.env) {
  const override = env.MARIADB_IMAGES?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return override?.length ? override : supportedSeries();
}
