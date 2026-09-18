import type { SourceAdapter } from '../types.js';
import { extractLinks, seeds } from './discover.js';
import { parse } from './parse.js';

export const lazzpharma: SourceAdapter = {
  id: 'lazzpharma',
  seeds,
  extractLinks: (doc, kind) => (kind === 'listing' ? extractLinks(doc) : []),
  factKinds: ['listing', 'detail'],
  parse
};
