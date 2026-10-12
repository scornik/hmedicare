import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROMPT_PURPOSES,
  type PromptPurpose,
  latestVersion,
  loadPromptTemplate,
  promptFileHashes,
  promptsDirectory,
} from '../../src/public/index';

/**
 * Prompt templates and their output schemas (AI-001, AI-IMPLEMENTATION §9).
 *
 * Three things are checked, and each of them protects something different.
 *
 * The lock file protects the past: a draft records the template version that produced it, and a
 * reviewer reading that draft later needs the words the model was actually given. Editing a shipped
 * template silently changes history, so a changed hash fails here and the fix is a new version file.
 *
 * The mirror check protects the chart: the JSON Schema is what the provider is asked to honour, the
 * Zod mirror is what the server enforces, and the two drifting apart means output nobody validated
 * reaching a doctor's screen.
 *
 * The content rules protect the patient: templates must not contain real data, must refuse to treat
 * source blocks as instructions, and must say plainly that this product does no clinical decision
 * support. The last is not decoration — a model asked to be helpful will check interactions unless
 * told not to, and Stage 7 does not do that.
 */
const LOCK = path.join(promptsDirectory(), 'prompts.lock.json');

afterEach(() => {
  // Restored because one case rewrites a template on purpose.
  if (saved) {
    writeFileSync(saved.file, saved.contents);
    saved = null;
  }
});
let saved: { file: string; contents: string } | null = null;

const lockFile = () =>
  JSON.parse(readFileSync(LOCK, 'utf8')) as { version: number; files: Record<string, string> };

describe('prompts.lock.json', () => {
  it('matches every template file on disk', () => {
    expect(promptFileHashes()).toEqual(lockFile().files);
  });

  it('covers both MVP purposes at v1', () => {
    const files = Object.keys(lockFile().files);
    for (const purpose of PROMPT_PURPOSES) {
      expect(files).toContain(`${purpose}/v1.md`);
      expect(files).toContain(`${purpose}/v1.schema.json`);
    }
  });

  it('fails when a locked template is edited', () => {
    const file = path.join(promptsDirectory(), 'note-draft', 'v1.md');
    saved = { file, contents: readFileSync(file, 'utf8') };
    writeFileSync(file, `${saved.contents}\nAn added line.\n`);
    // This is the whole point of the lock: the fix for a wanted change is v2, not an edit to v1.
    expect(promptFileHashes()).not.toEqual(lockFile().files);
  });
});

describe('template loading', () => {
  it.each(PROMPT_PURPOSES)('loads %s at its latest version', (purpose) => {
    const version = latestVersion(purpose);
    const template = loadPromptTemplate(purpose, version);

    expect(template.templateVersion).toBe(`${purpose}/${version}`);
    expect(template.outputSchemaVersion).toBe(`${purpose}/${version}`);
    // json_schema is required by both MVP templates, which is what makes a provider without it
    // ineligible rather than silently returning prose.
    expect(template.requiredCapabilities).toContain('json_schema');
    expect(template.maxInputTokens).toBeGreaterThan(0);
    expect(template.languageHints).toContain('bn');
    // Front matter is stripped: it is metadata for this loader, not instructions for a model.
    expect(template.body).not.toContain('outputSchemaVersion');
  });

  it('refuses a version that does not exist', () => {
    expect(() => loadPromptTemplate('note-draft', 'v99')).toThrow(/no template note-draft\/v99/);
  });

  it('refuses a purpose directory with no versions', () => {
    expect(() => latestVersion('note-draft', path.join(promptsDirectory(), 'missing'))).toThrow();
  });

  it('refuses front matter that describes another template', () => {
    const file = path.join(promptsDirectory(), 'note-draft', 'v1.md');
    saved = { file, contents: readFileSync(file, 'utf8') };
    writeFileSync(file, saved.contents.replace('version: v1', 'version: v2'));
    // Front matter disagreeing with its own filename would make the version recorded on a draft a
    // different template from the one that ran.
    expect(() => loadPromptTemplate('note-draft', 'v1')).toThrow(/front matter does not describe/);
  });
});

describe('the Zod mirror agrees with the JSON Schema', () => {
  /** Walks a JSON Schema object/union and reports the property names it allows. */
  const propertiesOf = (schema: Record<string, unknown>): Set<string> => {
    const out = new Set<string>();
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.properties && typeof obj.properties === 'object') {
        for (const key of Object.keys(obj.properties)) out.add(key);
      }
      for (const key of ['oneOf', 'anyOf', 'allOf', 'items', '$defs', 'properties']) {
        const child = obj[key];
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') Object.values(child).forEach(visit);
      }
    };
    visit(schema);
    return out;
  };

  it.each(PROMPT_PURPOSES)('%s accepts what its schema describes and nothing more', (purpose) => {
    const template = loadPromptTemplate(purpose, latestVersion(purpose));
    const sample = SAMPLES[purpose];

    // Accepts the documented shape.
    expect(template.outputSchema.safeParse(sample.valid).success).toBe(true);
    // And refuses each documented violation. These are the cases a provider actually produces.
    for (const [label, invalid] of Object.entries(sample.invalid)) {
      const result = template.outputSchema.safeParse(invalid);
      expect(result.success, `${purpose} should refuse ${label}`).toBe(false);
    }
  });

  it.each(PROMPT_PURPOSES)('%s declares every property its mirror parses', (purpose) => {
    const template = loadPromptTemplate(purpose, latestVersion(purpose));
    const declared = propertiesOf(template.jsonSchema);
    // The mirror is strict, so a property it accepts and the schema never mentions would be a
    // property the provider was never asked for.
    for (const key of Object.keys(SAMPLES[purpose].valid as Record<string, unknown>)) {
      expect(declared).toContain(key);
    }
    expect(declared).toContain('sourceIds');
    expect(declared).toContain('confidence');
  });

  it('requires at least one citation in both schemas', () => {
    for (const purpose of PROMPT_PURPOSES) {
      const template = loadPromptTemplate(purpose, latestVersion(purpose));
      // The database enforces this too. A suggestion citing nothing is a claim nobody can check.
      const sourceIds: Array<{ minItems?: number }> = [];
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (key === 'sourceIds' && value && typeof value === 'object') {
            sourceIds.push(value as { minItems?: number });
          }
          walk(value);
        }
      };
      walk(template.jsonSchema);
      expect(sourceIds.length).toBeGreaterThan(0);
      for (const node of sourceIds) {
        // Either the array itself declares the floor, or it points at the definition that does.
        const ref = (node as { $ref?: string }).$ref;
        if (ref) {
          const name = ref.replace('#/$defs/', '');
          const defs = (template.jsonSchema.$defs ?? {}) as Record<string, { minItems?: number }>;
          expect(defs[name]?.minItems).toBe(1);
        } else {
          expect(node.minItems).toBe(1);
        }
      }
      expect(template.outputSchema.safeParse(SAMPLES[purpose].invalid.noCitations).success).toBe(false);
    }
  });
});

describe('template content rules', () => {
  const bodies = PROMPT_PURPOSES.map((purpose) => ({
    purpose,
    // Whitespace collapsed: these rules are about what the template says, and a line wrap in the
    // middle of a phrase is not a difference in meaning.
    body: loadPromptTemplate(purpose, latestVersion(purpose)).body.replace(/\s+/gu, ' '),
  }));

  it.each(bodies)('$purpose refuses clinical decision support', ({ body }) => {
    // Stage 7 does no interaction, allergy or dose checking and no substitution advice. A model asked
    // to be helpful will do all four unless the prompt forbids them.
    const lowered = body.toLowerCase();
    expect(lowered).toContain('interaction');
    expect(lowered).toContain('allergi');
    expect(lowered).toContain('dose');
    expect(lowered).toContain('substitut');
  });

  it.each(bodies)('$purpose tells the model to ignore instructions inside sources', ({ body }) => {
    // Source blocks carry a patient's record, and a record can contain text that reads like an
    // instruction. This is the prompt-injection boundary.
    expect(body).toContain('<source');
    expect(body.toLowerCase()).toContain('ignore');
  });

  it.each(bodies)('$purpose requires citations and forbids invention', ({ body }) => {
    const lowered = body.toLowerCase();
    expect(lowered).toContain('cite');
    expect(lowered).toMatch(/not in the sources|not in the record/u);
  });

  it.each(bodies)('$purpose tells the model to pass placeholders through', ({ body }) => {
    // A model that replaced `⟦PATIENT⟧` with an invented name would undo minimization in the output.
    expect(body).toContain('⟦PATIENT⟧');
    expect(body).toContain('⟦DAY');
  });

  it.each(bodies)('$purpose marks its examples synthetic', ({ body }) => {
    // Templates never contain real patient data, and an example that did not say so could be mistaken
    // for one.
    expect(body.toLowerCase()).toContain('synthetic');
  });

  it.each(bodies)('$purpose keeps clinical terms as authored', ({ body }) => {
    // Bangla and Banglish input is expected, and translating a medicine name is how a prescription
    // becomes wrong.
    expect(body.toLowerCase()).toContain('medicine name');
  });
});

/** Synthetic provider outputs: one valid, and the violations a provider actually produces. */
const SAMPLES: Record<PromptPurpose, { valid: unknown; invalid: Record<string, unknown> }> = {
  'note-draft': {
    valid: {
      suggestions: [
        {
          suggestionType: 'NOTE_SECTION',
          targetSection: 'history',
          text: 'Dry cough for five days as of ⟦DAY−30⟧.',
          confidence: 'MEDIUM',
          sourceIds: ['s1'],
        },
        {
          suggestionType: 'DIAGNOSIS',
          display: 'Acute bronchitis',
          codeSystem: 'ICD10',
          code: 'J20.9',
          certainty: 'PROVISIONAL',
          confidence: 'LOW',
          sourceIds: ['s1', 's2'],
        },
      ],
    },
    invalid: {
      noCitations: {
        suggestions: [
          {
            suggestionType: 'NOTE_SECTION',
            targetSection: 'history',
            text: 'Something.',
            confidence: 'HIGH',
            sourceIds: [],
          },
        ],
      },
      unknownSection: {
        suggestions: [
          {
            suggestionType: 'NOTE_SECTION',
            targetSection: 'prescription',
            text: 'Something.',
            confidence: 'HIGH',
            sourceIds: ['s1'],
          },
        ],
      },
      extraField: {
        suggestions: [
          {
            suggestionType: 'NOTE_SECTION',
            targetSection: 'history',
            text: 'Something.',
            confidence: 'HIGH',
            sourceIds: ['s1'],
            dosage: '500 mg',
          },
        ],
      },
      codeWithoutSystem: {
        suggestions: [
          {
            suggestionType: 'DIAGNOSIS',
            display: 'Acute bronchitis',
            code: 'J20.9',
            certainty: 'CONFIRMED',
            confidence: 'HIGH',
            sourceIds: ['s1'],
          },
        ],
      },
      unknownType: {
        suggestions: [
          {
            suggestionType: 'PRESCRIPTION_ITEM',
            text: 'Metformin 500 mg',
            confidence: 'HIGH',
            sourceIds: ['s1'],
          },
        ],
      },
    },
  },
  'history-summary': {
    valid: {
      items: [
        {
          category: 'condition',
          text: 'Type 2 diabetes mellitus confirmed ⟦DAY−400⟧.',
          confidence: 'HIGH',
          sourceIds: ['s1'],
        },
      ],
    },
    invalid: {
      noCitations: {
        items: [{ category: 'condition', text: 'Something.', confidence: 'HIGH', sourceIds: [] }],
      },
      unknownCategory: {
        items: [{ category: 'prognosis', text: 'Something.', confidence: 'HIGH', sourceIds: ['s1'] }],
      },
      extraField: {
        items: [
          {
            category: 'condition',
            text: 'Something.',
            confidence: 'HIGH',
            sourceIds: ['s1'],
            severity: 'moderate',
          },
        ],
      },
    },
  },
};
