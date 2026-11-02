'use strict';

/**
 * Shared tag-set shaping for the AiTagRepository dialect twins
 * (docs/spec/server/store/aiTagStore.md): deterministic dedup/sort of the
 * caller's ALREADY-FOLDED set before the `replaceRawTags` insert loop
 * (§2.3). The store applies no orthographic normalization of its own.
 */

/** Dedup + drop empty/non-string entries; deterministic order. */
function normalizeTagSet(tags) {
  const set = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort();
}

module.exports = { normalizeTagSet };
