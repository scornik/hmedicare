import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { VOCAB_DIR } from '../config.js';

export const UNMAPPED = 'unmapped';

interface FormVocab {
  forms: Record<string, string[]>;
  patterns: Array<{ match: string; form: string }>;
  explicit_routes: Array<{ match: string; route: string }>;
}

export interface FormMapper {
  map(raw?: string): { form: string; rule: 'alias' | 'pattern' | 'unmapped' };
  explicitRoute(raw?: string): string | undefined;
  forms: string[];
}

export function normalizeFormText(raw: string): string {
  return raw.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function loadFormMapper(file = path.join(VOCAB_DIR, 'dosage_forms.yaml')): FormMapper {
  const vocab = YAML.parse(fs.readFileSync(file, 'utf8')) as FormVocab;
  const aliasIndex = new Map<string, string>();
  for (const [form, aliases] of Object.entries(vocab.forms)) {
    for (const alias of [form.replace(/_/g, ' '), ...aliases]) {
      const key = normalizeFormText(alias);
      const existing = aliasIndex.get(key);
      if (existing && existing !== form) throw new Error(`dosage_forms.yaml: alias "${alias}" maps to both ${existing} and ${form}`);
      aliasIndex.set(key, form);
    }
  }
  const patterns = vocab.patterns.map(p => {
    if (!vocab.forms[p.form]) throw new Error(`dosage_forms.yaml: pattern targets unknown form ${p.form}`);
    return { re: new RegExp(p.match, 'i'), form: p.form };
  });
  const routes = vocab.explicit_routes.map(r => ({ re: new RegExp(r.match, 'i'), route: r.route }));
  return {
    forms: Object.keys(vocab.forms),
    map(raw) {
      if (!raw) return { form: UNMAPPED, rule: 'unmapped' };
      const text = normalizeFormText(raw);
      const alias = aliasIndex.get(text);
      if (alias) return { form: alias, rule: 'alias' };
      const pattern = patterns.find(p => p.re.test(text));
      if (pattern) return { form: pattern.form, rule: 'pattern' };
      return { form: UNMAPPED, rule: 'unmapped' };
    },
    explicitRoute(raw) {
      if (!raw) return undefined;
      const text = normalizeFormText(raw.replace(/\//g, ' / ')).replace(/ \/ /g, '/');
      return routes.find(r => r.re.test(text))?.route;
    }
  };
}
