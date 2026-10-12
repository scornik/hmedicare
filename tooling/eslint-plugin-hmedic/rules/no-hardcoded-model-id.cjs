'use strict';
/**
 * Model ids come from the catalog, never from a literal (ADAPT-002, ADR-017 §5).
 *
 * The reason is operational. A vendor retires a model with weeks of notice; a model id compiled into
 * a prompt template, a default or a fallback means the next deploy is the earliest anything can
 * change, and deploys are not scheduled around a vendor's deprecation calendar. A catalog row can be
 * deprecated the moment a refresh stops seeing it.
 *
 * The rule looks for the shapes vendors actually use, which is narrow on purpose: a rule that flagged
 * every hyphenated string would be turned off within a week. Adapters are exempt, since translating
 * for one vendor is their whole job, and so are tests and fixtures, where a fixed id is what makes an
 * assertion mean anything.
 */
const VENDOR_MODEL_ID =
  /^(?:gemini|gpt|text-embedding|claude|llama|mistral|mixtral|qwen|deepseek|grok|o[134])[-.][a-z0-9][a-z0-9.-]*$/i;

/** Paths where a vendor model id is legitimate. */
const EXEMPT = [
  /packages[\\/]ai-adapters[\\/]/,
  /[\\/]test[\\/]/,
  /[\\/]tests[\\/]/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /[\\/]fixtures?[\\/]/,
  /[\\/]seed[\\/]/,
];

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid hard-coded provider model identifiers outside adapters' },
    schema: [],
    messages: {
      literal:
        'Model id "{{value}}" must come from ai_model_catalog, not a literal. Adapters and tests are exempt.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (EXEMPT.some((re) => re.test(filename))) return {};
    const check = (node, value) => {
      if (typeof value !== 'string' || value.length > 64) return;
      if (VENDOR_MODEL_ID.test(value)) context.report({ node, messageId: 'literal', data: { value } });
    };
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        // A template whose static head already names the model is the same literal with extra steps.
        check(node, node.value?.cooked);
      },
    };
  },
};
