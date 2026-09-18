'use strict';
/**
 * SMS and payment provider credentials must never travel in URLs (ADR-018 §2, T27).
 * Applied to provider adapter packages: forbid `method: 'GET'` in request options and
 * URL strings that embed credential parameters.
 */
const CRED_IN_URL = /[?&](api_key|apikey|signature_key|store_id)=/i;

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid GET requests and credential query parameters in provider adapters' },
    schema: [],
    messages: {
      get: 'Provider calls must use POST with a body; GET would put credentials in URLs (ADR-018 §2).',
      credInUrl: 'Credentials must never be placed in a URL query string (ADR-018 §2, T27).',
    },
  },
  create(context) {
    return {
      Property(node) {
        let key = null;
        if (node.key.type === 'Identifier') key = node.key.name;
        else if (node.key.type === 'Literal') key = node.key.value;
        if (
          key === 'method' &&
          node.value.type === 'Literal' &&
          String(node.value.value).toUpperCase() === 'GET'
        ) {
          context.report({ node, messageId: 'get' });
        }
      },
      Literal(node) {
        if (typeof node.value === 'string' && CRED_IN_URL.test(node.value)) {
          context.report({ node, messageId: 'credInUrl' });
        }
      },
      TemplateElement(node) {
        if (CRED_IN_URL.test(node.value.raw)) context.report({ node, messageId: 'credInUrl' });
      },
    };
  },
};
