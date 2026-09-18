'use strict';
/**
 * Never pass secret-looking identifiers to loggers or console (OBSERVABILITY.md §3, T1).
 * Runtime redaction still applies; this rule stops the obvious mistakes at review time.
 */
const LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace', 'fatal']);
const SECRET_NAME =
  /^(password|passwd|pwd|otp|otpCode|secret|apiKey|api_key|token|accessToken|refreshToken|csrfToken|signatureKey|signature_key|privateKey|pepper|kek)$/i;

function secretIdentifier(node) {
  if (!node) return null;
  if (node.type === 'Identifier' && SECRET_NAME.test(node.name)) return node.name;
  if (
    node.type === 'MemberExpression' &&
    node.property.type === 'Identifier' &&
    SECRET_NAME.test(node.property.name)
  ) {
    return node.property.name;
  }
  if (node.type === 'ObjectExpression') {
    for (const p of node.properties) {
      if (p.type !== 'Property') continue;
      let key = null;
      if (p.key.type === 'Identifier') key = p.key.name;
      else if (p.key.type === 'Literal') key = String(p.key.value);
      if (key && SECRET_NAME.test(key)) return key;
      const inner = secretIdentifier(p.value);
      if (inner) return inner;
    }
  }
  if (node.type === 'TemplateLiteral') {
    for (const e of node.expressions) {
      const inner = secretIdentifier(e);
      if (inner) return inner;
    }
  }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid logging secret-looking values' },
    schema: [],
    messages: { secret: 'Do not log "{{name}}" (secrets/OTP/tokens must never reach logs).' },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        if (!LOG_METHODS.has(callee.property.name)) return;
        let objName = '';
        if (callee.object.type === 'Identifier') objName = callee.object.name;
        else if (callee.object.type === 'MemberExpression' && callee.object.property.type === 'Identifier') {
          objName = callee.object.property.name;
        }
        if (!/^(console|log)$/i.test(objName) && !/logger$/i.test(objName)) return;
        for (const arg of node.arguments) {
          const name = secretIdentifier(arg);
          if (name) {
            context.report({ node: arg, messageId: 'secret', data: { name } });
            return;
          }
        }
      },
    };
  },
};
