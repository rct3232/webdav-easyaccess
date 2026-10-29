'use strict';

/**
 * resultRefRegistry — the process-local §2.4 execution-material registry
 * behind searchService.md §2.9 replay.
 *
 * It stores QUERY MATERIAL ONLY — never node ids, names, scores or result
 * snapshots. A `$ref` replay re-executes that material under the CURRENT ACL;
 * ACL revocation/purge therefore wins on every rerun.
 *
 * Entries are keyed per requester (`userId ∥ ref`), so two users can emit the
 * same deterministic signature without ever resolving each other's material.
 * Bounded LRU: the least-recently registered/resolved entry is evicted first.
 */

const DEFAULT_MAX_RESULT_REFS = 1000;

function entryKey(userId, ref) {
  return `${String(userId)}\u0000${String(ref)}`;
}

/**
 * @param {{ maxEntries?: number }} [opts]
 */
function createResultRefRegistry({ maxEntries = DEFAULT_MAX_RESULT_REFS } = {}) {
  const cap =
    Number.isFinite(Number(maxEntries)) && Number(maxEntries) > 0
      ? Math.floor(Number(maxEntries))
      : DEFAULT_MAX_RESULT_REFS;
  const entries = new Map();

  function touch(key, material) {
    entries.delete(key);
    entries.set(key, material);
    while (entries.size > cap) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    /**
     * Register/refresh one execution's material. The last write for the same
     * `(userId, ref)` wins (deterministic signatures make it equivalent).
     */
    register(userId, ref, material) {
      if (!ref || !material || typeof material !== 'object') return;
      touch(entryKey(userId, ref), material);
    },

    /** Resolve the material for `(userId, ref)`; a hit refreshes LRU order. */
    resolve(userId, ref) {
      if (!ref) return null;
      const key = entryKey(userId, ref);
      const material = entries.get(key);
      if (!material) return null;
      touch(key, material);
      return material;
    },

    /** Small introspection surface for tests/health (never result content). */
    size() {
      return entries.size;
    },

    clear() {
      entries.clear();
    },
  };
}

const sharedRegistry = createResultRefRegistry();

function getSharedResultRefRegistry() {
  return sharedRegistry;
}

module.exports = {
  DEFAULT_MAX_RESULT_REFS,
  createResultRefRegistry,
  getSharedResultRefRegistry,
};
