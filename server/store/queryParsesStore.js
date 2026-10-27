'use strict';

/**
 * queryParsesStore facade — the query-embed cache
 * (docs/spec/server/services/searchService.md §2.3 step 4, §2.5). Thin
 * dialect dispatch over QueryParsesRepository (no SQL here, PLAN §6).
 * Get-or-embed keyed by the normalized query text; the search leg owns the
 * envelope validation and the provider-call decision.
 */
const storage = require('./storage');
const createQueryParsesRepository = require('./repositories/QueryParsesRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createQueryParsesRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

async function get(normalizedQuery) {
  return getRepository().get(normalizedQuery);
}

async function recordEmbedding(opts) {
  return getRepository().recordEmbedding(opts);
}

async function recordPredicates(opts) {
  return getRepository().recordPredicates(opts);
}

async function incrementHitCount(normalizedQuery) {
  return getRepository().incrementHitCount(normalizedQuery);
}

module.exports = { get, recordEmbedding, recordPredicates, incrementHitCount };
