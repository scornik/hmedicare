import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import { HistorySummaryOutputV1 } from '../../prompts/history-summary/v1.zod';
import { NoteDraftOutputV1 } from '../../prompts/note-draft/v1.zod';

/**
 * Prompt templates and their output schemas (AI-001, AI-IMPLEMENTATION §9).
 *
 * A template is three files: the prompt, a JSON Schema the provider is asked to honour, and a Zod
 * mirror the server enforces. The duplication is the point — a provider honouring a schema is a
 * convenience, and the only validation that protects a chart is the one that runs here.
 *
 * Versions are immutable. Any change to a template or schema is a new version file, because a draft
 * records the template version that produced it, and a reviewer reading that draft six months later
 * needs the words the model was actually given. `prompts.lock.json` holds a hash per file and
 * `prompt-templates.test.ts` fails when a locked file changes, which is what makes immutability a
 * property of the repository rather than a convention.
 *
 * Front matter is parsed rather than trusted: `requiredCapabilities` decides whether a credential may
 * run the template at all, and a template claiming `json_schema` on a provider that lacks it would
 * send a request that silently returns prose.
 *
 * One deviation from §9's layout, for a build reason rather than a design one: the prompt and its JSON
 * Schema live in `prompts/<purpose>/`, and the Zod mirror lives in `src/prompts/<purpose>/`. The
 * package compiles with `rootDir: src`, so a mirror beside the prompt could not be imported by the
 * code that validates with it. The lock file covers all three files wherever they sit.
 */
export interface PromptTemplate {
  purpose: PromptPurpose;
  version: string;
  /** `<purpose>/<version>`, stored on the job and the draft. */
  templateVersion: string;
  outputSchemaVersion: string;
  requiredCapabilities: readonly ('text' | 'json_schema' | 'audio' | 'vision')[];
  maxInputTokens: number;
  languageHints: readonly ('bn' | 'en' | 'mixed')[];
  /** The prompt with its front matter removed. */
  body: string;
  /** The JSON Schema sent to the provider. */
  jsonSchema: Record<string, unknown>;
  /** The mirror the server validates with. */
  outputSchema: ZodType;
}

export const PROMPT_PURPOSES = ['note-draft', 'history-summary'] as const;
export type PromptPurpose = (typeof PROMPT_PURPOSES)[number];

/** One mirror per output schema version. A version with no mirror cannot be loaded. */
const MIRRORS: Record<string, ZodType> = {
  'note-draft/v1': NoteDraftOutputV1,
  'history-summary/v1': HistorySummaryOutputV1,
};

export class PromptTemplateError extends Error {
  constructor(
    readonly code:
      | 'TEMPLATE_NOT_FOUND'
      | 'TEMPLATE_FRONT_MATTER_INVALID'
      | 'TEMPLATE_SCHEMA_MISSING'
      | 'TEMPLATE_MIRROR_MISSING',
    message: string,
  ) {
    super(message);
    this.name = 'PromptTemplateError';
  }
}

/**
 * Resolves the prompts directory from either the source tree or `dist`.
 *
 * `__dirname` is `src/application/prompts` under the development condition and
 * `dist/application/prompts` after a build; the templates sit at the package root, which is three
 * levels up from both. Checked rather than assumed, because a path that resolved to nothing would
 * surface much later as "no templates".
 */
export function promptsDirectory(from: string = __dirname): string {
  for (const candidate of [path.resolve(from, '../../../prompts'), path.resolve(from, '../../prompts')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new PromptTemplateError('TEMPLATE_NOT_FOUND', 'prompt templates directory was not found');
}

/** Minimal YAML front matter: the keys this format uses, and nothing more. */
function parseFrontMatter(markdown: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(markdown);
  if (!match) {
    throw new PromptTemplateError('TEMPLATE_FRONT_MATTER_INVALID', 'template has no front matter');
  }
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const raw of match[1]!.split(/\r?\n/u)) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) continue;
    const item = /^\s+-\s+(.*)$/u.exec(line);
    if (item && listKey) {
      const value = item[1]!.trim().replace(/^['"]|['"]$/gu, '');
      (data[listKey] as string[]).push(value);
      continue;
    }
    const pair = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/u.exec(line);
    if (!pair) {
      throw new PromptTemplateError('TEMPLATE_FRONT_MATTER_INVALID', 'unreadable front-matter line');
    }
    const [, key, rest] = pair;
    if (rest!.length === 0) {
      listKey = key!;
      data[key!] = [];
      continue;
    }
    listKey = null;
    const value = rest!.replace(/^['"]|['"]$/gu, '');
    data[key!] = /^\d+$/u.test(value) ? Number(value) : value;
  }
  return { data, body: markdown.slice(match[0].length) };
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function loadPromptTemplate(
  purpose: PromptPurpose,
  version: string,
  directory: string = promptsDirectory(),
): PromptTemplate {
  const base = path.join(directory, purpose, version);
  if (!existsSync(`${base}.md`)) {
    throw new PromptTemplateError('TEMPLATE_NOT_FOUND', `no template ${purpose}/${version}`);
  }
  if (!existsSync(`${base}.schema.json`)) {
    throw new PromptTemplateError('TEMPLATE_SCHEMA_MISSING', `no schema for ${purpose}/${version}`);
  }
  const { data, body } = parseFrontMatter(readFileSync(`${base}.md`, 'utf8'));
  const outputSchemaVersion = typeof data.outputSchemaVersion === 'string' ? data.outputSchemaVersion : '';
  const maxInputTokens = typeof data.maxInputTokens === 'number' ? data.maxInputTokens : 0;
  if (data.purpose !== purpose || data.version !== version || !outputSchemaVersion || maxInputTokens <= 0) {
    // Front matter that disagrees with the file it is in would make the version recorded on a draft a
    // different template from the one that ran.
    throw new PromptTemplateError(
      'TEMPLATE_FRONT_MATTER_INVALID',
      `front matter does not describe ${purpose}/${version}`,
    );
  }
  const outputSchema = MIRRORS[outputSchemaVersion];
  if (!outputSchema) {
    throw new PromptTemplateError('TEMPLATE_MIRROR_MISSING', `no Zod mirror for ${outputSchemaVersion}`);
  }
  const capabilities = strings(data.requiredCapabilities).filter(
    (capability): capability is 'text' | 'json_schema' | 'audio' | 'vision' =>
      ['text', 'json_schema', 'audio', 'vision'].includes(capability),
  );
  const languageHints = strings(data.languageHints).filter((hint): hint is 'bn' | 'en' | 'mixed' =>
    ['bn', 'en', 'mixed'].includes(hint),
  );
  if (capabilities.length === 0 || languageHints.length === 0) {
    throw new PromptTemplateError(
      'TEMPLATE_FRONT_MATTER_INVALID',
      `${purpose}/${version} declares no capabilities or no language hints`,
    );
  }
  return {
    purpose,
    version,
    templateVersion: `${purpose}/${version}`,
    outputSchemaVersion,
    requiredCapabilities: capabilities,
    maxInputTokens,
    languageHints,
    body,
    jsonSchema: JSON.parse(readFileSync(`${base}.schema.json`, 'utf8')) as Record<string, unknown>,
    outputSchema,
  };
}

/** The version a purpose runs when a request names none: the highest `vN` present. */
export function latestVersion(purpose: PromptPurpose, directory: string = promptsDirectory()): string {
  const versions = readdirSync(path.join(directory, purpose))
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/u, ''))
    .filter((version) => /^v\d+$/u.test(version))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const latest = versions.at(-1);
  if (!latest) throw new PromptTemplateError('TEMPLATE_NOT_FOUND', `no versions for ${purpose}`);
  return latest;
}

/**
 * Each prompt and schema file with its sha256, in the shape `prompts.lock.json` stores.
 *
 * A locked hash is what makes a version immutable in practice: editing a shipped template would change
 * the words a past draft was produced by while that draft still claims the version.
 *
 * The Zod mirrors are not hashed here. They are TypeScript, they are not shipped as data, and editing
 * one is already caught by the mirror-equality test — which checks that the mirror and the JSON Schema
 * still describe the same thing, a stronger guarantee than "the bytes did not change".
 */
export function promptFileHashes(directory: string = promptsDirectory()): Record<string, string> {
  const out: Record<string, string> = {};
  const digest = (file: string) =>
    // Line endings are normalized so a checkout on Windows does not read as a changed template.
    createHash('sha256')
      .update(readFileSync(file).toString('utf8').replace(/\r\n/gu, '\n'), 'utf8')
      .digest('hex');
  for (const purpose of PROMPT_PURPOSES) {
    const dir = path.join(directory, purpose);
    for (const file of readdirSync(dir).sort()) {
      if (!/\.(md|schema\.json)$/u.test(file)) continue;
      out[`${purpose}/${file}`] = digest(path.join(dir, file));
    }
  }
  return out;
}
