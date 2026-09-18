// ESLint flat config (TECHNOLOGY-STACK.md §5). Custom rules live in tooling/eslint-plugin-hmedic.
import tseslint from 'typescript-eslint';
import hmedic from 'eslint-plugin-hmedic';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      'docs/**',
      'teardown/**',
      'tools/**',
      'reference-repos/**',
      'hmedic/**',
      'mobile/**',
      'packages/contracts/generated/**',
      'packages/database/src/generated/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      // Deliberate violations used by the architecture fixture tests.
      'tests/architecture/fixtures/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    plugins: { hmedic },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'hmedic/no-raw-sql': 'error',
      'hmedic/no-append-only-mutation': 'error',
      'hmedic/no-secret-logging': 'error',
      'hmedic/no-tls-disable': 'error',
    },
  },
  {
    // Nest decorators need runtime class references: type-only imports would break DI metadata.
    files: [
      'apps/api/**/*.ts',
      'apps/worker/**/*.ts',
      'packages/*/src/nest/**/*.ts',
      'packages/*/src/**/*.controller.ts',
      'packages/*/src/**/*.module.ts',
    ],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['packages/communication-adapters/**/*.ts', 'packages/payment-adapters/**/*.ts'],
    rules: { 'hmedic/no-get-provider-call': 'error' },
  },
  {
    files: [
      'scripts/**/*.{mjs,ts}',
      'packages/*/scripts/**/*.mjs',
      'infrastructure/**/*.mjs',
      'apps/host-probe/**/*.ts',
      'tooling/**/*.{cjs,mjs}',
      '**/*.config.{mjs,ts,cjs}',
    ],
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The rule implementations and their RuleTester cases necessarily contain the forbidden patterns.
    files: ['tooling/eslint-plugin-hmedic/**', 'tests/architecture/eslint-rules.test.ts'],
    rules: {
      'hmedic/no-raw-sql': 'off',
      'hmedic/no-tls-disable': 'off',
      'hmedic/no-secret-logging': 'off',
      'hmedic/no-append-only-mutation': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
);
