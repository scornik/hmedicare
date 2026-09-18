'use strict';
/** In-repo ESLint plugin: rules encode BUILD-CONTRACT.md and ADR-014/015/018 constraints. */
module.exports = {
  meta: { name: 'eslint-plugin-hmedic', version: '0.0.0' },
  rules: {
    'no-raw-sql': require('./rules/no-raw-sql.cjs'),
    'no-append-only-mutation': require('./rules/no-append-only-mutation.cjs'),
    'no-secret-logging': require('./rules/no-secret-logging.cjs'),
    'no-get-provider-call': require('./rules/no-get-provider-call.cjs'),
    'no-tls-disable': require('./rules/no-tls-disable.cjs'),
  },
};
