'use strict';

/**
 * tagVocabulary — the §4.18 step-1 orthographic fold (AI_FEATURE_PLAN.md
 * §4.18 / docs/spec/server/store/aiTagStore.md): a read-time PURE function,
 * zero tables. NFKC normalize, trim, collapse whitespace runs, lowercase
 * (asymmetric case fold — accents survive by design). The stores normalize
 * NOTHING (aiTagStore §2.2 decision): every ai_tag_raw / tag_embeddings
 * writer and the tag-predicate evaluator folds through here first.
 *
 * Idempotent: foldTag(foldTag(x)) === foldTag(x). Invalid or empty input ⇒
 * null (callers drop nulls — never an empty-string tag).
 */
function foldTag(value) {
  if (typeof value !== 'string') return null;
  const folded = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return folded.length > 0 ? folded : null;
}

module.exports = { foldTag };
