'use strict';
/** TLS verification is never disabled (ADR-018 §2, BUILD-CONTRACT.md). */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid disabling TLS certificate verification' },
    schema: [],
    messages: {
      reject: 'rejectUnauthorized: false is forbidden.',
      env: 'NODE_TLS_REJECT_UNAUTHORIZED must never be set by code.',
    },
  },
  create(context) {
    return {
      Property(node) {
        let key = null;
        if (node.key.type === 'Identifier') key = node.key.name;
        else if (node.key.type === 'Literal') key = node.key.value;
        if (key === 'rejectUnauthorized' && node.value.type === 'Literal' && node.value.value === false) {
          context.report({ node, messageId: 'reject' });
        }
      },
      MemberExpression(node) {
        if (node.property.type === 'Identifier' && node.property.name === 'NODE_TLS_REJECT_UNAUTHORIZED') {
          context.report({ node, messageId: 'env' });
        }
      },
      Literal(node) {
        if (node.value === 'NODE_TLS_REJECT_UNAUTHORIZED') context.report({ node, messageId: 'env' });
      },
    };
  },
};
