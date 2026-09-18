import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cruise } from 'dependency-cruiser';

// FOUND-001: every dependency rule in .dependency-cruiser.cjs must fire on a deliberate violation.
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../..');
const fixtures = path.join(__dirname, 'fixtures');
const config = require(path.join(repoRoot, '.dependency-cruiser.cjs')) as {
  forbidden: Array<{ name: string }>;
};

async function violations(): Promise<Set<string>> {
  const cwd = process.cwd();
  process.chdir(fixtures);
  try {
    const result = await cruise(['apps', 'packages'], {
      validate: true,
      ruleSet: { forbidden: config.forbidden } as never,
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
      enhancedResolveOptions: {
        extensions: ['.ts', '.js', '.json'],
        conditionNames: ['development', 'import', 'require', 'node', 'default'],
      },
    });
    const output = result.output as { summary: { violations: Array<{ rule: { name: string } }> } };
    return new Set(output.summary.violations.map((v) => v.rule.name));
  } finally {
    process.chdir(cwd);
  }
}

describe('dependency-cruiser rules (REPOSITORY-STRUCTURE.md §4)', () => {
  const expected = [
    'domain-no-frameworks', // domain importing infrastructure
    'application-no-infrastructure', // application importing an ORM
    'vendor-sdks-only-in-adapters', // vendor SDK outside adapters
    'cross-context-via-public-only',
    'kernel-is-leaf',
    'worker-only-worker-modules', // worker importing a non-*WorkerModule module
    'web-only-contracts-and-ui', // client importing server packages
    'payments-no-clinical',
    'no-circular',
  ];

  it.each(expected)('rule %s fires on its fixture', async (rule) => {
    const found = await violations();
    expect(found, `rules that fired: ${[...found].join(', ')}`).toContain(rule);
  });

  it('every rule named in the test exists in the config', () => {
    const names = new Set(config.forbidden.map((r) => r.name));
    for (const rule of expected) expect(names).toContain(rule);
  });
});
