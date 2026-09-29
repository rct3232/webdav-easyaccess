'use strict';

/**
 * collectionsService — business logic behind /api/collections
 * (docs/spec/server/services/collectionsService.md). Functions take the
 * requester userId first, throw bare string codes (translated by the
 * router-level ERROR_MAP), and return domain objects the route serializes
 * snake_case. Every user-visible mutation reaches the DB through the
 * collectionsStore journaled mutators (actionJournalStore.commitChange is the
 * only write path); results carry `undo: { actionId }` pointers (§4.11).
 * DB-backed only — zero CacheAdapter/operationProgress imports (invariant 8).
 */

const collectionsStore = require('../../store/collectionsStore');
const fileLikesStore = require('../../store/fileLikesStore');
const actionJournalStore = require('../../store/actionJournalStore');
const userStore = require('../../store/userStore');
const permissionStore = require('../../domains/permissions/stores/permissionStore');
const aclService = require('../../domains/permissions/services/aclService');
const { isOwnerNode } = require('../../domains/permissions/policy/ownerNodeResolver');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { validateFileName } = require('@webdav-easyaccess/shared/validation');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const aiTagStore = require('../../store/aiTagStore');
const { foldTag } = require('../ai/tagVocabulary');
const definitionEngine = require('./definitionEngine');
const wire = require('./wire');

// Constants with later-task owners (§3.1/§3.4): SIMILAR_MODEL_ID is a
// placeholder until the T1.1 model registry supplies the active embed model;
// item activity scores arrive with the T0.6 node_activity rollup store.
const VALID_SORTS = ['activity', 'name', 'created', 'updated', 'similar'];
const STORE_SORTS = new Set(['activity', 'name', 'created', 'updated']);
const VALID_INCLUDE_TOKENS = ['mine', 'shared', 'archived'];
const VALID_PUBLISH_MODES = ['ask', 'off', 'auto'];
const VALID_GRANT_ROLES = ['viewer', 'editor'];
const DEFAULT_ITEM_LIMIT = 50;
const MAX_ITEM_LIMIT = 200;
const MAX_NODE_IDS = 200;
const PREVIEW_SAMPLE_CAP = 12;
const SIMILAR_MODEL_ID = 0;
const SIMILAR_CLUSTER_COSINE = 0.7;

const REMOVAL_JOURNAL_ACTIONS = new Set(['remove-item', 'remove-items', 'exclude']);

function serviceError(code) {
  const error = new Error(code);
  const statuses = {
    notFound: 404,
    forbidden: 403,
    alreadyArchived: 409,
    notArchived: 409,
    aiNotConfigured: 409,
    granteeNotFound: 404,
    grantNotFound: 404,
    suggestionNotFound: 404,
  };
  if (statuses[code]) error.status = statuses[code];
  return error;
}

function toFiniteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveCollectionName(ownerId, baseName) {
  let candidate = baseName;
  for (let i = 2; await collectionsStore.existsActiveName(ownerId, candidate); i += 1) {
    candidate = `${baseName} (${i})`;
  }
  return candidate;
}

/**
 * Embed-role presence gate: resolves the LLM_EMBED_* config keys (dbOnly
 * registry group from T0.7b) per call — hot per §6. Swapped in place for
 * `infrastructure/adapters/llm` roleConfigured('embed') at T1.1.
 */
async function embedRoleConfigured() {
  const { getSharedResolver } = require('../../infrastructure/configResolver');
  const resolver = getSharedResolver();
  const baseUrl = await resolver.getConfig('LLM_EMBED_BASE_URL');
  const model = await resolver.getConfig('LLM_EMBED_MODEL');
  return Boolean(String(baseUrl || '').trim()) && Boolean(String(model || '').trim());
}

// ---------------------------------------------------------------------------
// Requester-visible candidate set (predicate evaluation + previews).
// Own-root subtree (readable by ownership) + granted nodes/subtrees —
// listing parity with fileService; per-node point checks in the engine
// (services spec §2.3 as-built Decision).
// ---------------------------------------------------------------------------

async function loadVisibleCandidates(userId) {
  const fileNodesStore = createFileNodesStore();
  const nodesById = new Map();

  const root = await fileNodesStore.getUserRootNode(userId);
  if (root) {
    nodesById.set(Number(root.id), root);
    for (const row of await fileNodesStore.getDescendants(root.id)) {
      nodesById.set(Number(row.id), row);
    }
  }

  const grants = await permissionStore.getUserPermissions(userId);
  for (const grant of grants || []) {
    const nodeId = Number(grant.file_node_id);
    if (!nodeId) continue;
    if (grant.type === 'path') {
      const folder = await fileNodesStore.getNode(nodeId);
      if (!folder) continue;
      nodesById.set(Number(folder.id), folder);
      for (const row of await fileNodesStore.getDescendants(folder.id)) {
        nodesById.set(Number(row.id), row);
      }
    } else {
      const node = await fileNodesStore.getNode(nodeId);
      if (node) nodesById.set(Number(node.id), node);
    }
  }
  return nodesById;
}

function createCandidatesProvider(userId) {
  let cache = null;
  return async () => {
    if (!cache) cache = await loadVisibleCandidates(userId);
    return cache;
  };
}

async function buildProviders(userId) {
  const fileNodesStore = createFileNodesStore();
  const likedNodeIds = new Set(await fileLikesStore.listLikedNodeIds(userId));
  return {
    likedNodeIds,
    getSize: async (nodeId) => {
      const cache = await fileNodesStore.getCache(nodeId);
      return cache && cache.size != null ? Number(cache.size) : null;
    },
    // T0.9 tag atoms (§2.3 None-column cosine-free path): the engine hands the
    // atom value over; the fold is the CALLER's pure function (§4.18) and the
    // store lookup stays string-equality. The P1 vector variant swaps this
    // resolver behind the same seam — engine and grammar unchanged.
    listNodesByTag: async (value) => {
      const folded = foldTag(value);
      if (!folded) return [];
      return aiTagStore.listNodeIdsByRawTag(folded);
    },
  };
}

// ---------------------------------------------------------------------------
// Access guards
// ---------------------------------------------------------------------------

async function getCollectionForRead(userId, collectionId) {
  const collection = await collectionsStore.getCollection(collectionId);
  if (!collection) throw serviceError('notFound');
  if (collection.ownerId !== userId) {
    const grant = await collectionsStore.getGrant(collectionId, userId);
    if (!grant || (await collectionsStore.isHiddenFor(userId, collectionId))) {
      // 404 masquerade — existence never leaks (routes spec §2.4.2)
      throw serviceError('notFound');
    }
    return { collection, grant };
  }
  return { collection, grant: null };
}

async function requireOwner(userId, collection) {
  if (collection.ownerId !== userId) throw serviceError('forbidden');
}

/**
 * Returns the requester's role for the collection ('owner' | 'viewer' |
 * 'editor'); masquerades 404 for zero-access and 403s when the role is below
 * the required one.
 */
async function requireOwnerOrRole(userId, collection, minimumRole) {
  if (collection.ownerId === userId) return 'owner';
  const grant = await collectionsStore.getGrant(collection.id, userId);
  if (!grant || (await collectionsStore.isHiddenFor(userId, collection.id))) {
    throw serviceError('notFound');
  }
  if (minimumRole === 'editor' && grant.role !== 'editor') {
    throw serviceError('forbidden');
  }
  return grant.role;
}

/** §4.9b auto-pin on user touch of a system collection (non-journaled). */
async function touchSystemAutoPin(collection) {
  if (collection && collection.origin === 'system') {
    await collectionsStore.setAutoPin(collection.id);
  }
}

async function canReadNode(userId, nodeId) {
  if (await isOwnerNode(userId, nodeId)) return true;
  return aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ);
}

// ---------------------------------------------------------------------------
// Member view composition (stored ∪ derived − exclusions, §2.3/§2.4)
// ---------------------------------------------------------------------------

/**
 * Compose the raw member pairs for a collection: stored rows (which ignore
 * exclusions) plus derived admissions minus exclusions; a node present in
 * both renders as stored (stored wins the dedup).
 */
async function composeMemberRows(userId, collection, getCandidates) {
  const resolveCandidates = getCandidates || loadVisibleCandidates;
  const stored = await collectionsStore.listStoredItems(collection.id);
  const exclusions = new Set(
    (await collectionsStore.listExclusions(collection.id)).map((nodeId) => Number(nodeId))
  );

  const storedByNodeId = new Map();
  for (const item of stored) storedByNodeId.set(item.nodeId, item);

  const derived = new Map();
  if (definitionEngine.hasPredicates(collection.definition)) {
    const candidates = await resolveCandidates(userId);
    const providers = await buildProviders(userId);
    const admitted = await definitionEngine.evaluateDefinition({
      definition: collection.definition,
      candidateNodes: [...candidates.values()],
      nodesById: candidates,
      providers,
    });
    for (const [nodeId, reason] of admitted) {
      if (exclusions.has(nodeId)) continue;
      if (storedByNodeId.has(nodeId)) continue;
      const node = candidates.get(nodeId);
      derived.set(nodeId, { reason, nodeCreatedAt: node ? node.createdAt : null });
    }
  }
  return { storedByNodeId, derived };
}

/**
 * Render member rows with the join-time enrichment table (§2.4):
 * normal | revoked (null name/type) | trashed hidden | cross-leak omitted.
 * Grantees additionally pass the publish gate.
 */
async function resolveMemberRows(userId, collection, getCandidates) {
  const fileNodesStore = createFileNodesStore();
  const { storedByNodeId, derived } = await composeMemberRows(userId, collection, getCandidates);

  const nodeIds = [...new Set([...storedByNodeId.keys(), ...derived.keys()])];
  const likedSet = new Set(await fileLikesStore.filterLiked(userId, nodeIds));
  const isRequesterOwner = collection.ownerId === userId;

  const rows = [];
  for (const nodeId of nodeIds) {
    const stored = storedByNodeId.get(nodeId);
    const node = await fileNodesStore.getNode(nodeId);
    if (!node) continue; // trashed → hidden (row kept); purged rows cascade away

    const foreign = !(await isOwnerNode(collection.ownerId, nodeId));
    if (!isRequesterOwner && foreign) continue; // cross-leak rule (§3.2/§4.7)

    const published = stored ? Boolean(stored.published) : false;
    if (!isRequesterOwner && !published) continue; // grantees see published rows only

    const readable = await canReadNode(userId, nodeId);
    rows.push({
      nodeId,
      membership: stored ? 'stored' : 'derived',
      published,
      addedBy: stored ? stored.addedBy : null,
      createdAt: stored ? stored.createdAt : (derived.get(nodeId)?.nodeCreatedAt ?? null),
      state: readable ? 'normal' : 'revoked',
      name: readable ? node.name : null,
      type: readable ? node.type : null,
      mimeType: readable ? (node.mimeType ?? null) : null,
      reason: stored ? null : (derived.get(nodeId)?.reason ?? null),
      sharedExcluded: foreign,
      liked: likedSet.has(nodeId),
    });
  }
  return rows;
}

/**
 * Card preview rows (P-3, owner ruling): the ≤4 newest-added members of an
 * already-resolved member view — revoked and shared-excluded rows NEVER surface
 * (name/thumbnail after revocation is a leak; foreign rows are not shareable
 * content). Ordering is createdAt desc (added time), deterministic tie-break
 * nodeId desc; pure in-memory over rows resolveMemberRows already returned —
 * building previews adds ZERO queries.
 */
const PREVIEW_ITEM_CAP = 4;

function buildPreviewItems(rows) {
  return rows
    .filter((row) => row.state !== 'revoked' && !row.sharedExcluded)
    .slice()
    .sort((a, b) => {
      const at = String(a.createdAt ?? '');
      const bt = String(b.createdAt ?? '');
      if (at !== bt) return at < bt ? 1 : -1;
      return b.nodeId - a.nodeId;
    })
    .slice(0, PREVIEW_ITEM_CAP);
}

/**
 * Item ordering: activity score desc, then node_id asc (stable cursor).
 * Scores arrive with the T0.6 node_activity rollup; until then every score is
 * absent → node_id asc (routes spec §2.4.2 as-built Decision).
 */
function sortItemRows(rows) {
  return rows
    .map((row) => ({ ...row, score: 0 }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.nodeId - b.nodeId));
}

function countPublishPending(rows) {
  return rows.reduce((count, row) => (row.published ? count : count + 1), 0);
}

// ---------------------------------------------------------------------------
// List (§3.1)
// ---------------------------------------------------------------------------

function parseInclude(raw) {
  const value = raw ?? 'mine,shared';
  if (typeof value !== 'string') return null;
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const set = new Set();
  for (const token of tokens) {
    if (!VALID_INCLUDE_TOKENS.includes(token)) return null;
    set.add(token);
  }
  return set;
}

/**
 * `similar` (§3.1): greedy nearest-neighbor over centroid vectors in JS
 * (≤~20 rows); centroid-less rows are singleton clusters. cluster order =
 * first appearance over the activity-ordered input (stable).
 */
async function groupBySimilarity(rows) {
  const centroids = await collectionsStore.getCentroids(
    rows.map((row) => row.id),
    SIMILAR_MODEL_ID
  );
  const vectorById = new Map();
  for (const entry of centroids) {
    const vector = parseCentroid(entry.centroid);
    if (vector) vectorById.set(Number(entry.collectionId), vector);
  }

  const clusters = [];
  for (const row of rows) {
    const vector = vectorById.get(row.id);
    let home = null;
    if (vector) {
      for (const cluster of clusters) {
        if (cluster.vector && cosineSimilarity(vector, cluster.vector) >= SIMILAR_CLUSTER_COSINE) {
          home = cluster;
          break;
        }
      }
    }
    if (!home) {
      home = { rows: [], vector: vector || null };
      clusters.push(home);
    }
    home.rows.push(row);
  }

  return clusters.flatMap((cluster, index) =>
    cluster.rows.map((row) => ({ ...row, clusterIndex: index }))
  );
}

function parseCentroid(raw) {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function listCollections(userId, { sort, include } = {}) {
  const effectiveSort = sort ?? 'activity';
  if (!VALID_SORTS.includes(effectiveSort)) throw serviceError('invalidSort');
  const includeSet = parseInclude(include);
  if (!includeSet) throw serviceError('invalidInclude');

  const storeSort = STORE_SORTS.has(effectiveSort) ? effectiveSort : 'activity';
  // Include-token semantics (routes.md §2.4 Decision, RCA 2026-09-23):
  //   `mine,shared` → own ACTIVE + granted  (the __collections__ list view)
  //   `mine,archived` → own ARCHIVED only   (the __archive__ surface + badge:
  //                    CollectionsSection §2.3 "exactly the status=archived" rows)
  //   any include carrying `shared` alongside `archived` → the full
  //                    active ∪ archived ∪ granted set (dashboard status counts).
  // listForUser defaults to `status='active'` (store contract), so archived rows
  // can only ever arrive through listArchived — never duplicated.
  let rows = [];
  if (includeSet.has('archived') && !includeSet.has('shared')) {
    rows = await collectionsStore.listArchived(userId);
  } else {
    rows = await collectionsStore.listForUser(userId, { sort: storeSort });
    if (includeSet.has('archived')) {
      rows = rows.concat(await collectionsStore.listArchived(userId));
    }
  }
  if (!includeSet.has('shared')) {
    rows = rows.filter((row) => row.ownerId === userId);
  }

  if (effectiveSort === 'similar') {
    rows = await groupBySimilarity(rows);
  }

  const getCandidates = createCandidatesProvider(userId);
  const collections = [];
  for (const row of rows) {
    const isOwner = row.ownerId === userId;
    let grantedRole = null;
    if (!isOwner) {
      const grant = await collectionsStore.getGrant(row.id, userId);
      if (!grant) continue;
      grantedRole = grant.role;
    }
    const view = await resolveMemberRows(userId, row, getCandidates);
    collections.push(
      wire.serializeCollection(row, {
        grantedRole,
        itemCount: view.length,
        includeDefinition: isOwner,
        previewItems: buildPreviewItems(view),
      })
    );
  }
  return { collections };
}

/**
 * Single collection read (routes spec §2.4.2 404-masquerade Decision; the
 * §2.2 table gains the row in this PR). Owner sees the definition; grantees
 * get `granted_role` and no definition; ungranted reads 404.
 */
async function getCollection(userId, collectionId) {
  const { collection, grant } = await getCollectionForRead(userId, collectionId);
  const isOwner = collection.ownerId === userId;
  const view = await resolveMemberRows(userId, collection);
  return {
    collection: wire.serializeCollection(collection, {
      grantedRole: grant ? grant.role : null,
      itemCount: view.length,
      includeDefinition: isOwner,
      previewItems: buildPreviewItems(view),
    }),
  };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

async function createCollection(userId, { name } = {}) {
  if (typeof name !== 'string' || name.trim().length === 0) throw serviceError('nameRequired');
  if (validateFileName(name)) throw serviceError('invalidName');
  const finalName = await resolveCollectionName(userId, name.trim());
  const created = await collectionsStore.createCollection(
    { ownerId: userId, name: finalName, origin: 'user' },
    { actor: userId }
  );
  return { collection: created, undo: { actionId: created.actionId } };
}

/**
 * Seed creation requires the embed role (§2.7). At T0.3 the embed role is
 * resolved from config; vector candidate evaluation attaches with the T1.4
 * vectorStore seam and the T1.6 seed-confirm flow (§2.2.1 as-built note).
 */
async function createSeedCollection(userId, { name, seedNodeId } = {}) {
  if (typeof name !== 'string' || name.trim().length === 0) throw serviceError('nameRequired');
  if (validateFileName(name)) throw serviceError('invalidName');
  if (!toFiniteId(seedNodeId)) throw serviceError('previewTargetRequired');
  if (!(await embedRoleConfigured())) throw serviceError('aiNotConfigured');
  // Embed configured but no vector seam yet (T1.4): a seed collection has no
  // membership basis — refuse with the capability conflict, not a partial row.
  throw serviceError('aiNotConfigured');
}

// ---------------------------------------------------------------------------
// Update / lifecycle
// ---------------------------------------------------------------------------

async function updateCollection(userId, collectionId, patch = {}) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);

  let firstActionId = null;
  let row = collection;

  if (patch.name !== undefined && patch.name !== null) {
    const { name } = patch;
    if (typeof name !== 'string' || name.trim().length === 0) throw serviceError('nameRequired');
    if (validateFileName(name)) throw serviceError('invalidName');
    const finalName = await resolveCollectionName(userId, name.trim());
    const renamed = await collectionsStore.renameCollection(
      collectionId,
      finalName,
      { lockName: true },
      { actor: userId }
    );
    firstActionId = renamed.actionId;
    row = await collectionsStore.getCollection(collectionId);
  }

  if (patch.pinned !== undefined && patch.pinned !== null) {
    if (typeof patch.pinned !== 'boolean') throw serviceError('invalidPublishMode');
    const updated = await collectionsStore.setPinned(collectionId, patch.pinned, { actor: userId });
    firstActionId = firstActionId ?? updated.actionId;
    row = await collectionsStore.getCollection(collectionId);
  }

  if (patch.publishMode !== undefined && patch.publishMode !== null) {
    if (!VALID_PUBLISH_MODES.includes(patch.publishMode)) throw serviceError('invalidPublishMode');
    const updated = await collectionsStore.setPublishMode(collectionId, patch.publishMode, {
      actor: userId,
    });
    firstActionId = firstActionId ?? updated.actionId;
    row = await collectionsStore.getCollection(collectionId);
  }

  await touchSystemAutoPin(row);
  return { collection: row, undo: { actionId: firstActionId } };
}

async function archiveCollection(userId, collectionId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  const result = await collectionsStore.archiveCollection(collectionId, { actor: userId });
  if (result.changes === 0) throw serviceError('alreadyArchived');
  await touchSystemAutoPin(await collectionsStore.getCollection(collectionId));
  const refreshed = await collectionsStore.getCollection(collectionId);
  return { collection: refreshed, undo: { actionId: result.actionId } };
}

async function restoreCollection(userId, collectionId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  if (collection.status !== 'archived') throw serviceError('notArchived');
  // The partial unique fires when the row turns active, so a collision is
  // resolved with a silent suffix rename BEFORE the restore (§2.5 as-built).
  if (await collectionsStore.existsActiveName(collection.ownerId, collection.name)) {
    const finalName = await resolveCollectionName(collection.ownerId, collection.name);
    await collectionsStore.renameCollection(
      collectionId,
      finalName,
      { lockName: false },
      { actor: userId }
    );
  }
  const result = await collectionsStore.restoreCollection(collectionId, { actor: userId });
  if (result.changes === 0) throw serviceError('notArchived');
  await touchSystemAutoPin(await collectionsStore.getCollection(collectionId));
  const refreshed = await collectionsStore.getCollection(collectionId);
  return { collection: refreshed, undo: { actionId: result.actionId } };
}

async function deleteCollectionPermanent(userId, collectionId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  if (collection.status !== 'archived') throw serviceError('notArchived');
  const defFingerprint =
    collection.origin === 'system' && collection.definition
      ? definitionEngine.fingerprintDefinition(collection.definition)
      : undefined;
  await collectionsStore.deleteCollectionPermanent(collectionId, { defFingerprint });
}

// ---------------------------------------------------------------------------
// Member view (GET /:id/items)
// ---------------------------------------------------------------------------

function clampLimit(raw) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ITEM_LIMIT;
  return Math.min(Math.floor(parsed), MAX_ITEM_LIMIT);
}

async function getItems(userId, collectionId, { cursor, limit, since } = {}) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  const isRequesterOwner = collection.ownerId === userId;

  const rows = sortItemRows(await resolveMemberRows(userId, collection));

  const parsedCursor = wire.decodeCursor(cursor);
  const filtered = parsedCursor
    ? rows.filter(
        (row) =>
          row.score > parsedCursor.score ||
          (row.score === parsedCursor.score && row.nodeId > parsedCursor.nodeId)
      )
    : rows;

  const parsedLimit = clampLimit(limit);
  const page = filtered.slice(0, parsedLimit);
  const nextRow = filtered[parsedLimit];

  const payload = {
    items: page,
    nextCursor: nextRow
      ? wire.encodeCursor({ score: nextRow.score, nodeId: nextRow.nodeId })
      : null,
  };

  if (isRequesterOwner) {
    payload.publishPendingCount = countPublishPending(rows);
  }

  if (since !== undefined && since !== null && since !== '') {
    payload.digest = await computeDigest(collection, rows, since);
  }

  // the read IS the visit (§4.8) — no separate reset endpoint exists
  await collectionsStore.upsertDigestCursor(userId, collectionId, new Date().toISOString());
  return payload;
}

async function computeDigest(collection, rows, since) {
  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) {
    return { added_since: 0, removed_since: 0 };
  }
  const sinceTime = sinceDate.getTime();

  // zero-change fast path (§2.8): no membership change since `since`
  const lastMemberChange = collection.lastMemberChangeAt
    ? new Date(collection.lastMemberChangeAt).getTime()
    : null;
  const storedSince = await collectionsStore.listStoredItems(collection.id, {
    since: new Date(sinceTime).toISOString(),
  });
  if (lastMemberChange !== null && lastMemberChange <= sinceTime && storedSince.length === 0) {
    return { added_since: 0, removed_since: 0 };
  }

  let added = storedSince.length;
  for (const row of rows) {
    if (row.membership !== 'derived') continue;
    if (row.createdAt && new Date(row.createdAt).getTime() > sinceTime) added += 1;
  }

  let removed = 0;
  const journalRows = await actionJournalStore.listBySubject(
    'collection',
    `collection:${collection.id}`
  );
  for (const row of journalRows) {
    if (!REMOVAL_JOURNAL_ACTIONS.has(row.action)) continue;
    if (row.createdAt && new Date(row.createdAt).getTime() > sinceTime) removed += 1;
  }
  return { added_since: added, removed_since: removed };
}

// ---------------------------------------------------------------------------
// Membership mutations
// ---------------------------------------------------------------------------

function parseNodeIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_NODE_IDS) {
    throw serviceError('emptyNodeIds');
  }
  const ids = [];
  for (const value of raw) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw serviceError('emptyNodeIds');
    ids.push(parsed);
  }
  return ids;
}

async function addItems(userId, collectionId, nodeIds) {
  const parsed = parseNodeIds(nodeIds);
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwnerOrRole(userId, collection, 'editor');

  const addable = [];
  const rejectedNotReadable = [];
  for (const nodeId of parsed) {
    if (await canReadNode(userId, nodeId)) {
      addable.push(nodeId);
    } else {
      rejectedNotReadable.push(nodeId);
    }
  }

  // §4.7: stored rows start published=false unless publish_mode='auto'
  const published = collection.publishMode === 'auto';
  const result = await collectionsStore.addItems(
    collectionId,
    addable,
    userId,
    { published },
    { actor: userId }
  );
  await touchSystemAutoPin(collection);
  return {
    added: result.added,
    already_members: result.alreadyMembers,
    rejected_not_readable: rejectedNotReadable,
    undo: { actionId: result.actionId },
  };
}

async function removeItems(userId, collectionId, nodeIds) {
  const parsed = parseNodeIds(nodeIds);
  const { collection } = await getCollectionForRead(userId, collectionId);
  const role = await requireOwnerOrRole(userId, collection, 'editor');
  const isOwner = role === 'owner';

  const storedDeletes = [];
  const excludeInserts = [];
  const ignored = [];
  for (const nodeId of parsed) {
    const stored = await collectionsStore.getStoredItem(collectionId, nodeId);
    if (stored) {
      // editors may remove only what they added (§4.7)
      if (!isOwner && stored.addedBy !== userId) throw serviceError('forbidden');
      storedDeletes.push(nodeId);
      continue;
    }
    if (!isOwner) throw serviceError('forbidden');
    if (collection.origin === 'user') {
      // an exclusion on a user-origin collection is meaningless
      ignored.push(nodeId);
    } else {
      excludeInserts.push(nodeId);
    }
  }

  const result = await collectionsStore.removeItems(
    collectionId,
    { storedNodeIds: storedDeletes, excludeNodeIds: excludeInserts },
    { actor: userId }
  );
  return {
    removed: result.removed,
    excluded: result.excluded,
    ignored,
    undo: { actionId: result.actionId },
  };
}

/**
 * P-4 member publish (PUT /:id/items/publish, routes spec). Owner or editor.
 * Classification runs against the RAW membership (stored ∪ derived −
 * exclusions, `composeMemberRows`) — never the grantee-filtered view — so
 * editors can flip stored rows invisible to their own listing. Stored rows
 * flip through the journaled `setItemPublished` (inverse/undo pre-existing);
 * publishing a DERIVED member MATERIALIZES a stored `published=true` marker
 * (journaled `addItems` — membership truth stays derived, the view dedups by
 * node); an unpublish of a derived-only row is already-virtual-false →
 * `ignored`, and non-member ids are `ignored` (this function can never graft
 * a node into membership). `undo.actionId` prefers the flip command, falls
 * back to the materialize command, `null` when nothing mutated.
 */
async function publishItems(userId, collectionId, nodeIds, published) {
  const parsed = parseNodeIds(nodeIds);
  if (published !== true && published !== false) throw serviceError('invalidPublishMode');
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwnerOrRole(userId, collection, 'editor');

  const { storedByNodeId, derived } = await composeMemberRows(userId, collection);
  const flipIds = [];
  const materializeIds = [];
  const ignored = [];
  for (const nodeId of parsed) {
    if (storedByNodeId.has(nodeId)) {
      flipIds.push(nodeId);
    } else if (published && derived.has(nodeId)) {
      materializeIds.push(nodeId);
    } else {
      ignored.push(nodeId);
    }
  }

  let actionId = null;
  const publishedIds = [];
  if (materializeIds.length > 0) {
    const add = await collectionsStore.addItems(
      collectionId,
      materializeIds,
      userId,
      { published: true },
      { actor: userId }
    );
    publishedIds.push(...add.added);
    ignored.push(...add.alreadyMembers);
    actionId = add.actionId;
    await touchSystemAutoPin(collection);
  }
  if (flipIds.length > 0) {
    const flip = await collectionsStore.setItemPublished(collectionId, flipIds, published, {
      actor: userId,
    });
    publishedIds.push(...flipIds);
    actionId = flip.actionId;
  }
  return {
    published: publishedIds,
    ignored,
    undo: actionId == null ? null : { actionId },
  };
}

// ---------------------------------------------------------------------------
// Upload-hook rule-check SEAM (§2.3-bis, T0.9) — callable only; invocation
// at the §4.1 commit points rides the P1 wiring (register (b)).
// ---------------------------------------------------------------------------

/**
 * Point-evaluate the requester's ACTIVE predicate collections against ONE
 * freshly committed node (no corpus scan — §2.6 mechanism). Each collection
 * that newly admits the node gets `touchMemberChange` (the only coupling per
 * aiJobService §2.2); exclusions and existing stored rows short-circuit.
 * @returns {Promise<{ nodeId: number, admittedCollectionIds: number[] }>}
 */
async function checkUploadAdmissions(userId, nodeId) {
  const parsedNodeId = toFiniteId(nodeId);
  if (!parsedNodeId) throw serviceError('emptyNodeIds');

  const fileNodesStore = createFileNodesStore();
  const node = await fileNodesStore.getNode(parsedNodeId);
  if (!node) return { nodeId: parsedNodeId, admittedCollectionIds: [] };

  const nodesById = new Map();
  let current = node;
  while (current) {
    nodesById.set(Number(current.id), current);
    if (current.parentId == null) break;
    current = await fileNodesStore.getNode(current.parentId);
  }

  const providers = await buildProviders(userId);
  const collections = (await collectionsStore.listForUser(userId, { status: 'active' })).filter(
    (row) => row.ownerId === userId && definitionEngine.hasPredicates(row.definition)
  );

  const admittedCollectionIds = [];
  for (const collection of collections) {
    const exclusions = new Set(
      (await collectionsStore.listExclusions(collection.id)).map((excludedId) => Number(excludedId))
    );
    if (exclusions.has(parsedNodeId)) continue;
    if (await collectionsStore.getStoredItem(collection.id, parsedNodeId)) continue;
    const admitted = await definitionEngine.evaluateDefinition({
      definition: collection.definition,
      candidateNodes: [node],
      nodesById,
      providers,
    });
    if (admitted.has(parsedNodeId)) {
      await collectionsStore.touchMemberChange(collection.id);
      admittedCollectionIds.push(collection.id);
    }
  }
  return { nodeId: parsedNodeId, admittedCollectionIds };
}

// ---------------------------------------------------------------------------
// Preview (§2.7)
// ---------------------------------------------------------------------------

const EMPTY_PREVIEW = { count: 0, sample: [], sample_truncated: false };

async function preview(userId, target = {}) {
  const hasSeed = target.seedNodeId !== undefined && target.seedNodeId !== null;
  const hasDefinition = target.definition !== undefined && target.definition !== null;
  if (hasSeed === hasDefinition) throw serviceError('previewTargetRequired');

  if (hasSeed) {
    const seedNodeId = Number(target.seedNodeId);
    if (!Number.isInteger(seedNodeId) || seedNodeId <= 0) {
      throw serviceError('previewTargetRequired');
    }
    if (!(await embedRoleConfigured())) throw serviceError('aiNotConfigured');
    // Missing pooled embedding: the preview never blocks on enrichment (§2.7).
    // The embeddingsStore read is wired at T1.2; until then the seed vector is
    // missing and the dialog degrades to an empty result.
    return { ...EMPTY_PREVIEW, degraded: true };
  }

  const parsed = definitionEngine.parseDefinition(target.definition);
  return runDefinitionPreview(userId, parsed);
}

async function previewCollection(userId, collectionId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  if (!definitionEngine.hasPredicates(collection.definition)) {
    return { ...EMPTY_PREVIEW };
  }
  return runDefinitionPreview(userId, collection.definition);
}

async function runDefinitionPreview(userId, definition) {
  const candidates = await loadVisibleCandidates(userId);
  const providers = await buildProviders(userId);
  const admitted = await definitionEngine.evaluateDefinition({
    definition,
    candidateNodes: [...candidates.values()],
    nodesById: candidates,
    providers,
  });
  const ordered = [...admitted.keys()].sort((a, b) => a - b);
  const sample = ordered.slice(0, PREVIEW_SAMPLE_CAP).map((nodeId) => {
    const node = candidates.get(nodeId);
    return { nodeId, name: node ? node.name : null };
  });
  return {
    count: ordered.length,
    sample,
    sample_truncated: ordered.length > PREVIEW_SAMPLE_CAP,
  };
}

// ---------------------------------------------------------------------------
// Merge (§2.9)
// ---------------------------------------------------------------------------

async function listMergeSuggestions(userId) {
  const ownedIds = new Set(
    (await collectionsStore.listForUser(userId, { status: 'all' }))
      .filter((row) => row.ownerId === userId)
      .map((row) => row.id)
  );
  const pending = (await collectionsStore.listMergeSuggestions()).filter(
    (row) => ownedIds.has(row.aId) && ownedIds.has(row.bId)
  );
  pending.sort((a, b) => b.score - a.score);

  const suggestions = [];
  for (const row of pending) {
    const [aCollection, bCollection] = await Promise.all([
      collectionsStore.getCollection(row.aId),
      collectionsStore.getCollection(row.bId),
    ]);
    if (!aCollection || !bCollection) continue;
    const [aMembers, bMembers] = await Promise.all([
      memberNodeIdSet(userId, aCollection),
      memberNodeIdSet(userId, bCollection),
    ]);
    const overlapCount = countOverlap(aMembers, bMembers);
    const recommendation =
      row.arbiterVerdict != null
        ? { verdict: row.arbiterVerdict, reason: row.arbiterReason ?? null }
        : null;
    suggestions.push(
      wire.serializeSuggestion(row, {
        aName: aCollection.name,
        bName: bCollection.name,
        overlapCount,
        mergedCount: aMembers.size + bMembers.size - overlapCount,
        recommendation,
      })
    );
  }
  return { suggestions };
}

async function memberNodeIdSet(userId, collection) {
  const rows = await resolveMemberRows(userId, collection);
  return new Set(rows.map((row) => row.nodeId));
}

function countOverlap(a, b) {
  let count = 0;
  for (const id of a) if (b.has(id)) count += 1;
  return count;
}

async function mergeCollections(userId, collectionId, otherId) {
  const survivorId = Number(collectionId);
  const otherNumber = Number(otherId);
  if (!Number.isInteger(survivorId) || survivorId <= 0) throw serviceError('notFound');
  if (!Number.isInteger(otherNumber) || otherNumber <= 0) throw serviceError('notFound');
  if (survivorId === otherNumber) throw serviceError('mergeSameCollection');

  const [{ collection: survivor }, { collection: other }] = await Promise.all([
    getCollectionForRead(userId, survivorId),
    getCollectionForRead(userId, otherNumber),
  ]);
  await requireOwner(userId, survivor);
  await requireOwner(userId, other);
  if (survivor.status !== 'active' || other.status !== 'active') {
    throw serviceError('notArchived');
  }

  const result = await collectionsStore.mergeCollections(survivorId, otherNumber, {
    actor: userId,
  });
  const refreshed = await collectionsStore.getCollection(survivorId);
  const rows = await resolveMemberRows(userId, refreshed);
  return {
    survivor: { id: refreshed.id, name: refreshed.name, itemCount: rows.length },
    absorbedId: otherNumber,
    undo: { actionId: result.actionId },
  };
}

async function dismissMerge(userId, collectionId, otherId) {
  const { survivorNumber, otherNumber } = await resolveOwnedPairOrThrow(
    userId,
    collectionId,
    otherId,
    'suggestionNotFound'
  );
  const suggestion = await pendingSuggestionForPair(survivorNumber, otherNumber);
  if (!suggestion) throw serviceError('suggestionNotFound');
  const result = await collectionsStore.setSuggestionState(suggestion.id, 'dismissed');
  if (result.changes === 0) throw serviceError('suggestionNotFound');
  return {
    suggestion_id: suggestion.id,
    state: 'dismissed',
    dismissed_at: new Date().toISOString(),
  };
}

async function rejectMerge(userId, collectionId, otherId) {
  const { survivorNumber, otherNumber } = await resolveOwnedPairOrThrow(
    userId,
    collectionId,
    otherId,
    'suggestionNotFound'
  );
  const suggestion = await pendingSuggestionForPair(survivorNumber, otherNumber);
  if (!suggestion) throw serviceError('suggestionNotFound');
  const result = await collectionsStore.setSuggestionState(suggestion.id, 'rejected');
  if (result.changes === 0) throw serviceError('suggestionNotFound');
  return {
    suggestion_id: suggestion.id,
    state: 'rejected',
    rejected_at: new Date().toISOString(),
  };
}

async function resolveOwnedPairOrThrow(userId, collectionId, otherId, missingCode) {
  const survivorNumber = Number(collectionId);
  const otherNumber = Number(otherId);
  if (!Number.isInteger(survivorNumber) || survivorNumber <= 0) throw serviceError(missingCode);
  if (!Number.isInteger(otherNumber) || otherNumber <= 0) throw serviceError(missingCode);
  const [survivor, other] = await Promise.all([
    collectionsStore.getCollection(survivorNumber),
    collectionsStore.getCollection(otherNumber),
  ]);
  if (!survivor || !other || survivor.ownerId !== userId || other.ownerId !== userId) {
    throw serviceError(missingCode);
  }
  return { survivorNumber, otherNumber };
}

async function pendingSuggestionForPair(collectionId, otherId) {
  const low = Math.min(collectionId, otherId);
  const high = Math.max(collectionId, otherId);
  const rows = await collectionsStore.listMergeSuggestions([collectionId, otherId]);
  return rows.find((row) => row.aId === low && row.bId === high) || null;
}

// ---------------------------------------------------------------------------
// for-nodes chips (DEF-25 — listing contracts frozen)
// ---------------------------------------------------------------------------

async function getForNodes(userId, nodeIds) {
  const parsed = parseNodeIds(nodeIds);
  const fileNodesStore = createFileNodesStore();

  // point-check candidates: the requested rows plus their live ancestors so
  // path atoms can resolve display paths without a corpus scan
  const nodeRows = new Map();
  for (const nodeId of parsed) {
    let node = await fileNodesStore.getNode(nodeId);
    while (node) {
      nodeRows.set(Number(node.id), node);
      if (node.parentId == null) break;
      node = await fileNodesStore.getNode(node.parentId);
    }
  }

  const byNode = new Map(parsed.map((nodeId) => [nodeId, new Set()]));
  for (const pair of await collectionsStore.listForNodes(userId, parsed)) {
    if (byNode.has(pair.nodeId)) byNode.get(pair.nodeId).add(pair.collectionId);
  }

  const visibleCollections = await collectionsStore.listForUser(userId, { status: 'active' });
  for (const collection of visibleCollections) {
    if (!definitionEngine.hasPredicates(collection.definition)) continue;
    const exclusions = new Set(
      (await collectionsStore.listExclusions(collection.id)).map((nodeId) => Number(nodeId))
    );
    const providers = await buildProviders(userId);
    const admitted = await definitionEngine.evaluateDefinition({
      definition: collection.definition,
      candidateNodes: [...nodeRows.values()],
      nodesById: nodeRows,
      providers,
    });
    for (const [nodeId] of admitted) {
      if (exclusions.has(nodeId)) continue;
      if (byNode.has(nodeId)) byNode.get(nodeId).add(collection.id);
    }
  }

  return {
    memberships: parsed.map((nodeId) => ({
      nodeId,
      collectionIds: [...(byNode.get(nodeId) || [])].sort((a, b) => a - b),
    })),
  };
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

async function listGrants(userId, collectionId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  const grants = await collectionsStore.listGrants(collectionId);
  const rows = [];
  for (const grant of grants) {
    const grantee = await userStore.findById(grant.granteeId);
    rows.push(wire.serializeGrant(grant, grantee ? grantee.username : null));
  }
  return { grants: rows };
}

async function grantCollectionAccess(userId, collectionId, granteeId, role) {
  if (!VALID_GRANT_ROLES.includes(role)) throw serviceError('invalidRole');
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  const granteeNumber = Number(granteeId);
  const grantee =
    Number.isInteger(granteeNumber) && granteeNumber > 0
      ? await userStore.findById(granteeNumber)
      : null;
  if (!grantee) throw serviceError('granteeNotFound');
  const result = await collectionsStore.grantAccess(collectionId, grantee.id, role, userId, {
    actor: userId,
  });
  const grant = await collectionsStore.getGrant(collectionId, grantee.id);
  return { grant, username: grantee.username, undo: { actionId: result.actionId } };
}

async function revokeCollectionAccess(userId, collectionId, granteeId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  const granteeNumber = Number(granteeId);
  const existing =
    Number.isInteger(granteeNumber) && granteeNumber > 0
      ? await collectionsStore.getGrant(collectionId, granteeNumber)
      : null;
  if (!existing) throw serviceError('grantNotFound');
  const result = await collectionsStore.revokeAccess(collectionId, granteeNumber, {
    actor: userId,
  });
  return { grantee_id: granteeNumber, revoked: true, undo: { actionId: result.actionId } };
}

/**
 * Grantee self-revocation (Path 1, routes spec DELETE /:id/grants/me — replaces
 * the retired recipient-local `Leave` hide). Removal + journaling ride the SAME
 * `collectionsStore.revokeAccess` path as the owner side (action `revoke`,
 * inverse `grant-access`, actor = grantee). Zero-access/unknown id masquerades
 * 404 `notFound` via getCollectionForRead; a readable collection with no grant
 * row for the caller (i.e. the owner) throws `grantNotFound`. Instant (§4.7).
 */
async function revokeOwnGrant(userId, collectionId) {
  const { collection, grant } = await getCollectionForRead(userId, collectionId);
  if (collection.ownerId === userId || !grant) throw serviceError('grantNotFound');
  const result = await collectionsStore.revokeAccess(collectionId, userId, { actor: userId });
  return { grantee_id: userId, revoked: true, undo: { actionId: result.actionId } };
}

module.exports = {
  getCollection,
  listCollections,
  createCollection,
  createSeedCollection,
  updateCollection,
  archiveCollection,
  restoreCollection,
  deleteCollectionPermanent,
  getItems,
  addItems,
  removeItems,
  publishItems,
  preview,
  previewCollection,
  listMergeSuggestions,
  mergeCollections,
  dismissMerge,
  rejectMerge,
  getForNodes,
  checkUploadAdmissions,
  listGrants,
  grantCollectionAccess,
  revokeCollectionAccess,
  revokeOwnGrant,
  fingerprintDefinition: definitionEngine.fingerprintDefinition,
};
