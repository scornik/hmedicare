import type { SourceAdapter } from '../types.js';
import { MENDELEY_FILE_SHA256, MENDELEY_FILE_URL, seeds } from './discover.js';
import { parse } from './parse.js';

export const mendeleyBdMeds: SourceAdapter = {
  id: 'mendeley_bd_meds',
  seeds,
  factKinds: ['detail'],
  parse: doc => parse(doc),
  accept: 'text/csv,*/*;q=0.5',
  expectedSha256: { [MENDELEY_FILE_URL]: MENDELEY_FILE_SHA256 },
  // Mendeley serves public files from its object storage.
  redirectHosts: ['amazonaws.com', 'mendeley.com', 'elsevier.com', 'cloudfront.net']
};
