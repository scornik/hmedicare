import type { SourceAdapter } from '../types.js';
import { extractLinks, fallbackSeeds, seeds } from './discover.js';
import { parse } from './parse.js';

export const dgda: SourceAdapter = {
  id: 'dgda',
  seeds,
  fallbackSeeds,
  extractLinks: (doc, kind) => (kind === 'json' ? extractLinks(doc.body, doc.url) : []),
  factKinds: ['detail', 'json'],
  parse: doc => parse(doc),
  accept: 'text/csv,application/json;q=0.9,*/*;q=0.5'
};
