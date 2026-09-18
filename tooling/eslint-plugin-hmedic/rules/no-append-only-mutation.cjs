'use strict';
/**
 * Append-only tables (DATABASE-IMPLEMENTATION.md §4.3) must never be updated or deleted
 * through Prisma delegates. Enforcement layer 2 of 4 (no triggers on Hostinger, ADR-014).
 * TTL deletion of sms_balance_snapshots is done by the maintenance job through the
 * database package's retention helper, not through a delegate call.
 */
const APPEND_ONLY_DELEGATES = new Set([
  'auditLog',
  'platformGateDecision',
  'smsBalanceSnapshot',
  'queueEvent',
  'timelineEvent',
  'encounterNoteVersion',
  'aiApproval',
  'tenantAiPolicyEvent',
  'aiUsageLedger',
  'providerWebhookEvent',
  'ledgerEntry',
  'paymentVerification',
  'medicationDatasetGateAttestation',
]);
const MUTATIONS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'updateManyAndReturn']);

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid update/delete on append-only table delegates' },
    schema: [],
    messages: { mutation: '{{delegate}} is append-only: {{method}} is forbidden (use insert/read only).' },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
        const method = callee.property.name;
        if (!MUTATIONS.has(method)) return;
        const obj = callee.object;
        let delegate = null;
        if (obj.type === 'MemberExpression' && obj.property.type === 'Identifier')
          delegate = obj.property.name;
        else if (obj.type === 'Identifier') delegate = obj.name;
        if (delegate && APPEND_ONLY_DELEGATES.has(delegate)) {
          context.report({ node, messageId: 'mutation', data: { delegate, method } });
        }
      },
    };
  },
};
