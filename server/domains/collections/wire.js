'use strict';

/**
 * Wire (HTTP) serializers for the collections domain — §6 conventions:
 * request bodies camelCase nodeId-based, responses snake_case. The service
 * speaks domain objects; the routes serialize through these helpers.
 */

function serializeCollection(
  row,
  { grantedRole = null, itemCount = 0, includeDefinition = true, previewItems = [] } = {}
) {
  const payload = {
    collection_id: row.id,
    owner_id: row.ownerId,
    name: row.name,
    origin: row.origin,
    status: row.status,
    publish_mode: row.publishMode,
    pinned: Boolean(row.pinned),
    pinned_by: row.pinnedBy ?? null,
    name_locked: Boolean(row.nameLocked),
    granted_role: grantedRole ?? null,
    item_count: itemCount,
    // P-3 card preview: ≤4 newest-added members from the already-resolved member
    // view; revoked/shared-excluded rows are filtered by the service BEFORE this
    // point (their name/mime must never reach the wire — routes spec §collection row).
    preview_items: (previewItems ?? []).map((item) => ({
      node_id: item.nodeId,
      name: item.name ?? null,
      type: item.type ?? null,
      mime: item.mimeType ?? null,
    })),
    archived_at: row.archivedAt ?? null,
    last_member_change_at: row.lastMemberChangeAt ?? null,
    created_at: row.createdAt ?? null,
    updated_at: row.updatedAt ?? null,
  };
  if (includeDefinition) {
    payload.definition = row.definition ?? null;
  }
  // similar-sort grouping header key (camelCase internal → snake wire); other
  // sorts omit it entirely
  if (row.clusterIndex !== undefined) {
    payload.cluster_index = row.clusterIndex;
  }
  return payload;
}

function serializeItem(item) {
  return {
    node_id: item.nodeId,
    name: item.name ?? null,
    type: item.type ?? null,
    mime: item.mimeType ?? null,
    membership: item.membership,
    published: Boolean(item.published),
    added_by: item.addedBy ?? null,
    created_at: item.createdAt ?? null,
    state: item.state,
    liked: Boolean(item.liked),
    reason: item.reason ?? null,
    shared_excluded: Boolean(item.sharedExcluded),
  };
}

function serializeGrant(grant, username) {
  return {
    grantee_id: grant.granteeId,
    username,
    role: grant.role,
    granted_by: grant.grantedBy,
    created_at: grant.createdAt ?? null,
  };
}

function serializeSuggestion(row, names) {
  return {
    suggestion_id: row.id,
    a_id: row.aId,
    a_name: names.aName,
    b_id: row.bId,
    b_name: names.bName,
    overlap_count: names.overlapCount,
    merged_count: names.mergedCount,
    score: row.score,
    created_at: row.createdAt ?? null,
    recommendation: names.recommendation ?? null,
  };
}

// -- opaque item cursor: base64url JSON `{ s: score, n: nodeId }` ------------

function encodeCursor({ score, nodeId }) {
  return Buffer.from(JSON.stringify({ s: score, n: nodeId }), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || !Number.isFinite(Number(parsed.n))) {
      return null;
    }
    return { score: Number(parsed.s) || 0, nodeId: Number(parsed.n) };
  } catch {
    return null;
  }
}

module.exports = {
  serializeCollection,
  serializeItem,
  serializeGrant,
  serializeSuggestion,
  encodeCursor,
  decodeCursor,
};
