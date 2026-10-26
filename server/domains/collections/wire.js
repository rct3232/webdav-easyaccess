'use strict';

/**
 * Wire (HTTP) serializers for the collections domain — §6 conventions:
 * request bodies camelCase nodeId-based, responses snake_case. The service
 * speaks domain objects; the routes serialize through these helpers.
 */

function serializeCollection(
  row,
  {
    grantedRole = null,
    itemCount = 0,
    includeDefinition = true,
    previewItems = [],
    lastVisitedAt,
  } = {}
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
  // requester-scoped digest cursor (GET / rows only, ruling 2026-10-01): the
  // sidebar new-dot source — dot ⇔ null (never opened). Attached solely by
  // listCollections; every other surface omits the key entirely.
  if (lastVisitedAt !== undefined) {
    payload.last_visited_at = lastVisitedAt;
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

/**
 * P-5 liked-items row (routes/fileLikes.md §2.4.2): the member `serializeItem`
 * shape minus the membership fields (no stored/derived membership, publish
 * state, reason or shared_exclusion on the Likes surface) — `created_at` is the
 * NODE creation time (no liked-at stamp exists) and drives the client's
 * `lastmod` fallback; revoked rows arrive with name/type already nulled by the
 * service (masquerade parity).
 */
function serializeLikedItem(item) {
  return {
    node_id: item.nodeId,
    name: item.name ?? null,
    type: item.type ?? null,
    mime: item.mimeType ?? null,
    state: item.state,
    liked: true,
    created_at: item.createdAt ?? null,
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
    dismiss_count: Number(row.dismissCount ?? 0),
    created_at: row.createdAt ?? null,
    recommendation: names.recommendation ?? null,
  };
}

module.exports = {
  serializeCollection,
  serializeItem,
  serializeLikedItem,
  serializeGrant,
  serializeSuggestion,
};
