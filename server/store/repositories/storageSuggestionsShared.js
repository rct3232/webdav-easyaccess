'use strict';

// Row-shaping helpers shared by the StorageSuggestionsRepository dialect twins
// (docs/spec/server/store/storageSuggestionsStore.md §2.2). jsonb (PG) round-trips
// as an object; sqlite TEXT carries the JSON string — parseJsonColumn folds
// both into the domain shape.

const { toIsoString } = require('../../utils/sharedHelpers');
const { parseJsonColumn } = require('./rowMappers');

function mapSuggestionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    nodeId: Number(row.node_id),
    kind: row.kind,
    reason: parseJsonColumn(row.reason),
    state: row.state,
    createdAt: toIsoString(row.created_at),
    expiresAt: toIsoString(row.expires_at),
  };
}

/** Placeholder filler for an IN(...) list (guard: callers pass non-empty ids). */
function inPlaceholders(count, startAt = 1) {
  return Array.from({ length: count }, (_, index) => `$${startAt + index}`).join(', ');
}

module.exports = { mapSuggestionRow, inPlaceholders };
