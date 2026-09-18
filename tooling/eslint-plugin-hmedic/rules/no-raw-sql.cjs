'use strict';
/**
 * Raw SQL (Prisma $queryRaw/$executeRaw and SQL lock keywords) is allowed only in
 * packages/database/src/{locks,claims,engine,raw}, database scripts/tests and the host probe
 * (DATABASE-IMPLEMENTATION.md §1.4, BUILD-CONTRACT.md).
 */
const RAW_METHODS = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);
const LOCK_SQL = /\b(FOR\s+UPDATE|GET_LOCK|RELEASE_LOCK|SKIP\s+LOCKED)\b/i;
const DEFAULT_ALLOWED = [
  /[\\/]packages[\\/]database[\\/]src[\\/](locks|claims|engine|raw)[\\/]/,
  /[\\/]packages[\\/]database[\\/](scripts|test)[\\/]/,
  /[\\/]apps[\\/]host-probe[\\/]/,
];

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid raw SQL outside packages/database lock/claim/engine helpers' },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      rawCall:
        'Raw SQL ({{name}}) is only allowed in packages/database/src/{locks,claims,engine,raw}. Use a repository or lockRow().',
      lockSql: 'SQL lock keywords are only allowed in packages/database lock/claim helpers.',
    },
  },
  create(context) {
    const filename = context.filename;
    const extra = ((context.options[0] && context.options[0].allow) || []).map((s) => new RegExp(s));
    if ([...DEFAULT_ALLOWED, ...extra].some((re) => re.test(filename))) return {};
    const memberName = (node) =>
      node && node.type === 'MemberExpression' && node.property.type === 'Identifier'
        ? node.property.name
        : null;
    return {
      CallExpression(node) {
        const name = memberName(node.callee);
        if (name && RAW_METHODS.has(name)) context.report({ node, messageId: 'rawCall', data: { name } });
      },
      TaggedTemplateExpression(node) {
        const name = memberName(node.tag);
        if (name && RAW_METHODS.has(name)) context.report({ node, messageId: 'rawCall', data: { name } });
      },
      Literal(node) {
        if (typeof node.value === 'string' && LOCK_SQL.test(node.value))
          context.report({ node, messageId: 'lockSql' });
      },
      TemplateElement(node) {
        if (LOCK_SQL.test(node.value.raw)) context.report({ node, messageId: 'lockSql' });
      },
    };
  },
};
