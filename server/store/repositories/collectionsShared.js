'use strict';

const { toIsoString } = require('../../utils/sharedHelpers');
const { parseJsonColumn, toBoolean } = require('./rowMappers');

/**
 * Domain row mappers for the collections platform tables — shared by the
 * sqlite/postgres twins (fileNodeShared precedent). Rows are shaped per
 * docs/spec/server/store/collectionsStore.md §2.2 (repository-contract
 * rule 2): ids as numbers, timestamps as ISO strings, booleans as booleans.
 */
function mapCollectionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    name: row.name,
    nameLocked: toBoolean(row.name_locked),
    origin: row.origin,
    status: row.status,
    definition: parseJsonColumn(row.definition),
    publishMode: row.publish_mode,
    pinned: toBoolean(row.pinned),
    pinnedBy: row.pinned_by ?? null,
    archivedAt: toIsoString(row.archived_at),
    lastMemberChangeAt: toIsoString(row.last_member_change_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapItemRow(row) {
  if (!row) return null;
  return {
    collectionId: Number(row.collection_id),
    nodeId: Number(row.node_id),
    addedBy: Number(row.added_by),
    published: toBoolean(row.published),
    source: row.source ?? 'manual',
    reason: row.reason ?? null,
    createdAt: toIsoString(row.created_at),
  };
}

function mapGrantRow(row) {
  if (!row) return null;
  return {
    collectionId: Number(row.collection_id),
    granteeId: Number(row.grantee_id),
    role: row.role,
    grantedBy: Number(row.granted_by),
    createdAt: toIsoString(row.created_at),
  };
}

function mapSuggestionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    aId: Number(row.a_id),
    bId: Number(row.b_id),
    score: Number(row.score),
    state: row.state,
    dismissCount: Number(row.dismiss_count ?? 0),
    dismissedAt: toIsoString(row.dismissed_at),
    rejectedAt: toIsoString(row.rejected_at),
    arbiterVerdict: row.arbiter_verdict,
    arbiterReason: row.arbiter_reason,
    createdAt: toIsoString(row.created_at),
  };
}

module.exports = {
  parseJsonColumn,
  toBoolean,
  mapCollectionRow,
  mapItemRow,
  mapGrantRow,
  mapSuggestionRow,
};
