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
      'Property[key.name="rejectUnauthorized"], Property[key.value="rejectUnauthorized"]'(node) {
        let key = null;
        if (node.key.type === 'Identifier') key = node.key.name;
        else if (node.key.type === 'Literal') key = node.key.value;
        if (key === 'rejectUnauthorized' && node.value.type === 'Literal' && node.value.value === false) {
          context.report({ node, messageId: 'reject' });
        }
      },
      // Writing the variable (assignment, delete, or an env object literal that sets it) is forbidden;
      // reading it to refuse startup is the enforcement itself (packages/config).
      MemberExpression(node) {
        const name =
          node.property.type === 'Identifier' && !node.computed
            ? node.property.name
            : node.property.type === 'Literal'
              ? node.property.value
              : null;
        if (name !== 'NODE_TLS_REJECT_UNAUTHORIZED') return;
        const parent = node.parent;
        const written =
          (parent.type === 'AssignmentExpression' && parent.left === node) ||
          (parent.type === 'UnaryExpression' && parent.operator === 'delete');
        if (written) context.report({ node, messageId: 'env' });
      },
      Property(node) {
        const key =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? node.key.value
              : null;
        if (key === 'NODE_TLS_REJECT_UNAUTHORIZED') context.report({ node, messageId: 'env' });
      },
    };
  },
};
