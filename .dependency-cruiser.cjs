/** @type {import('dependency-cruiser').IConfiguration} */
// Dependency rules (REPOSITORY-STRUCTURE.md §4). Every rule has a deliberate-violation fixture in
// tests/architecture/fixtures proving it fires (tests/architecture/depcruise.test.ts).
const CONTEXTS =
  'identity-access|tenant-org|patient|scheduling|queue|clinical|prescriptions|laboratory-documents|timeline|follow-up|communication|telemedicine|ai|audit|payments|provider-credentials';

const forbidden = [
  { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },

  // kernel stays pure
  {
    name: 'kernel-is-leaf',
    severity: 'error',
    from: { path: '^packages/kernel/' },
    to: {
      pathNot: ['^packages/kernel/', 'node_modules/(uuidv7|zod)/', '^node:', '^(fs|path|crypto)$'],
      dependencyTypesNot: ['core'],
    },
  },

  // domain layers are framework-free
  {
    name: 'domain-no-frameworks',
    severity: 'error',
    from: { path: `^packages/(${CONTEXTS})/src/domain/` },
    to: {
      path: [
        'node_modules/(@nestjs|@prisma|prisma|fastify|react|@tanstack|pino|@aws-sdk|sharp|argon2|jose|mariadb)/',
        `^packages/(${CONTEXTS})/src/(application|infrastructure|nest)/`,
        '^packages/(database|config|observability|jobs|contracts)/',
        '^packages/[a-z-]+-adapters/',
      ],
    },
  },

  // application depends on its own domain, kernel and other contexts' public surfaces only
  {
    name: 'application-no-infrastructure',
    severity: 'error',
    from: { path: `^packages/(${CONTEXTS})/src/application/` },
    to: {
      path: [
        'node_modules/(@nestjs|@prisma|prisma|fastify|mariadb|@aws-sdk)/',
        `^packages/(${CONTEXTS})/src/(infrastructure|nest)/`,
        '^packages/database/',
        '^packages/[a-z-]+-adapters/',
      ],
    },
  },

  // cross-context imports only via public/
  {
    name: 'cross-context-via-public-only',
    severity: 'error',
    from: { path: `^packages/(${CONTEXTS})/` },
    to: { path: `^packages/(${CONTEXTS})/src/(?!public/)`, pathNot: '^packages/$1/' },
  },

  // AI never reaches clinical write commands
  {
    name: 'ai-no-clinical-writes',
    severity: 'error',
    from: { path: '^packages/(ai|ai-adapters)/' },
    to: {
      path: [
        '^packages/(clinical|prescriptions|follow-up)/src/application/commands/',
        '^packages/(clinical|prescriptions|follow-up)/src/nest/.*Write',
        '^packages/(clinical|prescriptions|follow-up)/src/public/commands',
      ],
    },
  },

  // payments never reach clinical data (ADR-019)
  {
    name: 'payments-no-clinical',
    severity: 'error',
    from: { path: '^packages/(payments|payment-adapters)/' },
    to: { path: '^packages/(clinical|prescriptions|laboratory-documents|timeline|ai|ai-adapters)/' },
  },

  // secrets bundle decryption only through the vault / AI credential service
  {
    name: 'secrets-restricted',
    severity: 'error',
    from: {
      pathNot: ['^packages/(secrets|provider-credentials|ai)/', '^apps/(api|worker)/src/composition/'],
    },
    to: { path: '^packages/secrets/src/(envelope|kek)' },
  },

  // domain/application never call provider adapter packages directly
  {
    name: 'provider-adapters-not-in-contexts',
    severity: 'error',
    from: { path: `^packages/(${CONTEXTS})/src/(domain|application)/` },
    to: { path: '^packages/(communication-adapters|payment-adapters)/' },
  },

  // worker composition imports only *WorkerModule Nest modules (job handlers); never Write/Read API modules
  {
    name: 'worker-only-worker-modules',
    severity: 'error',
    from: { path: '^apps/worker/' },
    to: {
      path: [`^packages/(${CONTEXTS})/src/(nest/(?!worker-module)|application/|domain/|infrastructure/)`],
    },
  },

  // worker modules never import write modules
  {
    name: 'worker-modules-no-write-modules',
    severity: 'error',
    from: { path: `^packages/(${CONTEXTS})/src/nest/worker-module` },
    to: { path: `^packages/(${CONTEXTS})/src/nest/.*write-module` },
  },

  // vendor SDKs only in adapter packages
  {
    name: 'vendor-sdks-only-in-adapters',
    severity: 'error',
    from: { pathNot: ['^packages/[a-z-]+-adapters/', '^packages/database/'] },
    to: {
      path: 'node_modules/(@aws-sdk|@google|@google-ai|openai|groq-sdk|@mistralai|@anthropic-ai|twilio|firebase-admin|agora|@sendgrid|nodemailer)/',
    },
  },

  // Prisma only in database + context infrastructure
  {
    name: 'prisma-only-in-infrastructure',
    severity: 'error',
    from: {
      pathNot: [
        '^packages/database/',
        `^packages/(${CONTEXTS})/src/infrastructure/`,
        '^packages/(jobs|audit|secrets)/src/infrastructure/',
        '^apps/host-probe/',
        '^tooling/seed/',
      ],
    },
    to: { path: ['node_modules/(@prisma|prisma)/', '^packages/database/src/(client|generated)/'] },
  },

  // lock/raw SQL helpers only from infrastructure/jobs
  {
    name: 'locks-only-from-infrastructure',
    severity: 'error',
    from: {
      pathNot: [`^packages/(${CONTEXTS})/src/infrastructure/`, '^packages/(jobs|database|audit|secrets)/'],
    },
    to: { path: '^packages/database/src/(locks|claims|engine)/' },
  },

  // clients never touch server packages
  {
    name: 'web-only-contracts-and-ui',
    severity: 'error',
    from: { path: '^apps/web/' },
    to: { path: '^packages/', pathNot: ['^packages/(contracts|web-ui|kernel)/'] },
  },

  // tools are never imported
  { name: 'no-tools-imports', severity: 'error', from: { pathNot: '^tools/' }, to: { path: '^tools/' } },

  // contracts are leaf-ish (no domain implementations)
  {
    name: 'contracts-no-implementations',
    severity: 'error',
    from: { path: '^packages/contracts/' },
    to: {
      path: [
        `^packages/(${CONTEXTS})/src/(domain|application|infrastructure)/`,
        '^packages/(database|jobs)/',
      ],
    },
  },
];

module.exports = {
  forbidden,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)dist/', '(^|/)generated/', '\\.d\\.ts$', 'tests/architecture/fixtures/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['development', 'import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json'],
    },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
