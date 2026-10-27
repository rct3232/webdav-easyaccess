'use strict';

/**
 * collectionShareService — the sharing half of the collections platform
 * (docs/spec/server/services/collectionShareService.md). Role matrix and
 * read/role gates, the live publish resolution (`isVisibleToGrantee` +
 * owner-only `publishPendingCount`), the publish route surface, grants CRUD
 * with instant revocation, grantee self-revocation (`DELETE /:id/grants/me`),
 * and the `assertMemberConsumable` pre-check behind the download/preview
 * bridge.
 *
 * `collection_grants`/`collection_visibility` are a SEPARATE table domain:
 * this module is their service-layer reader/writer and it never touches the
 * permission caches (invariant 1 — view by collection, mutate by file).
 * Dependency direction is one way: `service.js` consumes these predicates;
 * this module reads the stores directly and never imports `service.js`.
 * Bare string codes are translated by the collections router `ERROR_MAP`.
 */

const collectionsStore = require('../../store/collectionsStore');
const userStore = require('../../store/userStore');
const aclService = require('../../domains/permissions/services/aclService');
const { isOwnerNode } = require('../../domains/permissions/policy/ownerNodeResolver');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const wire = require('./wire');

const VALID_GRANT_ROLES = ['viewer', 'editor'];
const MAX_NODE_IDS = 200;

function serviceError(code) {
  const error = new Error(code);
  const statuses = {
    notFound: 404,
    forbidden: 403,
    granteeNotFound: 404,
    grantNotFound: 404,
  };
  if (statuses[code]) error.status = statuses[code];
  return error;
}

function toFiniteId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Shared 1–200 nodeIds boundary (same code + shape as the item routes). */
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

/** §4.9b auto-pin on user touch of a system collection (non-journaled). */
async function touchSystemAutoPin(collection) {
  if (collection && collection.origin === 'system') {
    await collectionsStore.setAutoPin(collection.id);
  }
}

// ---------------------------------------------------------------------------
// Roles and read gates (spec §2.2)
// ---------------------------------------------------------------------------

/**
 * Live role read: collection row + grants row. Archived collections resolve
 * normally (display state, not ACL state). `null` = no access — the caller
 * 404-masquerades; existence never leaks.
 */
async function getRole(userId, collectionId) {
  const collection = await collectionsStore.getCollection(collectionId);
  if (!collection) return null;
  if (collection.ownerId === userId) return 'owner';
  const grant = await collectionsStore.getGrant(collectionId, userId);
  return grant ? grant.role : null;
}

/**
 * Read-path gate: `{ collection, grant, role }` or the 404 masquerade —
 * unknown collection, zero access, or the requester's hidden flag set for a
 * grantee (§2.5: the hidden flag is a read-side input; the list SQL applies
 * the same filter).
 */
async function getCollectionForRead(userId, collectionId) {
  const collection = await collectionsStore.getCollection(collectionId);
  if (!collection) throw serviceError('notFound');
  if (collection.ownerId === userId) return { collection, grant: null, role: 'owner' };
  const grant = await collectionsStore.getGrant(collectionId, userId);
  if (!grant || (await collectionsStore.isHiddenFor(userId, collectionId))) {
    // 404 masquerade — existence never leaks (routes spec §2.4.2)
    throw serviceError('notFound');
  }
  return { collection, grant, role: grant.role };
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

// ---------------------------------------------------------------------------
// Live publish resolution (spec §2.3)
// ---------------------------------------------------------------------------

/**
 * The read-time gate for members entering a LIVE-SHARED view (spec §2.3): a
 * materialized row is gated by its own `published` flag; the auto-mode arm
 * applies only to a VIRTUAL viewRow (a derived member without a stored row,
 * `virtual:true` + `published:false`). Auto publishes ON ADD and never
 * republishes parked history — grantees only ever see `published:true`
 * materialized rows (routes/collections.md §2.4).
 */
function isVisibleToGrantee(collection, viewRow) {
  if (viewRow && viewRow.published) return true;
  return Boolean(viewRow && viewRow.virtual) && collection.publishMode === 'auto';
}

/**
 * Owner-only count of `published=false` rows in the requester-resolved view.
 * The items route passes the SAME rows it just resolved (in-memory count,
 * zero extra reads); the owner gate lives here — a non-owner caller throws
 * `forbidden`, and the route omits the key for grantees.
 */
async function publishPendingCount(userId, collectionId, rows) {
  const collection = await collectionsStore.getCollection(collectionId);
  if (!collection) throw serviceError('notFound');
  await requireOwner(userId, collection);
  return rows.reduce((count, row) => (row.published ? count : count + 1), 0);
}

/**
 * Publish/unpublish members (route surface `PUT /:id/items/publish`). Owner or
 * editor (viewer → `forbidden`). Classification runs against the RAW
 * materialized membership (`collection_items`) — never a grantee-filtered
 * view — so editors can flip stored rows invisible to their own listing.
 * Rows flip through the journaled `setItemPublished` (inverse/undo live);
 * ids outside the materialized membership are `ignored[]` — publish never
 * ADDS membership (anti-injection; the read path never derives membership
 * either, so this function cannot graft a node in). Publishing on a `system`
 * collection is a user touch → auto-pin.
 */
async function publish(userId, collectionId, nodeIds, published) {
  const parsed = parseNodeIds(nodeIds);
  if (published !== true && published !== false) throw serviceError('invalidPublishMode');
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwnerOrRole(userId, collection, 'editor');

  const stored = await collectionsStore.listStoredItems(collectionId);
  const memberIds = new Set(stored.map((row) => Number(row.nodeId)));
  const flipIds = [];
  const ignored = [];
  for (const nodeId of parsed) {
    if (memberIds.has(nodeId)) {
      flipIds.push(nodeId);
    } else {
      ignored.push(nodeId);
    }
  }

  let actionId = null;
  if (flipIds.length > 0) {
    const flip = await collectionsStore.setItemPublished(collectionId, flipIds, published, {
      actor: userId,
    });
    actionId = flip.actionId;
    await touchSystemAutoPin(collection);
  }
  return {
    published: flipIds,
    ignored,
    undo: actionId == null ? null : { actionId },
  };
}

// ---------------------------------------------------------------------------
// Grants CRUD + revocation (spec §2.4)
// ---------------------------------------------------------------------------

async function listGrants(userId, collectionId) {
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  const grants = await collectionsStore.listGrants(collectionId);
  const rows = [];
  for (const grant of grants) {
    // eslint-disable-next-line no-await-in-loop
    const grantee = await userStore.findById(grant.granteeId);
    rows.push(wire.serializeGrant(grant, grantee ? grantee.username : null));
  }
  return { grants: rows };
}

/**
 * Grant `viewer|editor` (owner-only). `role ∉ viewer|editor` → `invalidRole`
 * (checked BEFORE any read); unknown grantee → `granteeNotFound`; granting
 * one's own collection → `forbidden` (a grant is an exposure act aimed at
 * another user); admin-as-grantee → `forbidden` (operator rule: collections
 * never reference admins). UPSERT on the PK pair — a re-grant replaces the
 * role in one journaled command whose inverse restores the PREVIOUS role
 * (collectionsStore.grantAccess). Side effect: (re-)granting clears the
 * grantee's hidden flag (the sole recovery path — spec §2.5).
 */
async function grant(userId, collectionId, { granteeId, role } = {}) {
  if (!VALID_GRANT_ROLES.includes(role)) throw serviceError('invalidRole');
  const { collection } = await getCollectionForRead(userId, collectionId);
  await requireOwner(userId, collection);
  const granteeNumber = Number(granteeId);
  const grantee =
    Number.isInteger(granteeNumber) && granteeNumber > 0
      ? await userStore.findById(granteeNumber)
      : null;
  if (!grantee) throw serviceError('granteeNotFound');
  if (grantee.id === userId) throw serviceError('forbidden');
  // Operator rule: admin-as-grantee is banned at grant creation — collections
  // never reference admins (routes spec §2.3).
  if (grantee.is_admin) throw serviceError('forbidden');
  const result = await collectionsStore.grantAccess(collectionId, grantee.id, role, userId, {
    actor: userId,
  });
  const updated = await collectionsStore.getGrant(collectionId, grantee.id);
  await collectionsStore.setVisible(grantee.id, collectionId, false);
  return { grant: updated, username: grantee.username, undo: { actionId: result.actionId } };
}

/**
 * Owner-side revoke; INSTANT (§4.7) — the next read resolves role=null and
 * every member view 404-masquerades. No such row → `grantNotFound`. The
 * journaled `revokeAccess` TX also deletes the grantee's digest cursor
 * (re-grant re-dots; spec §2.8 of the collectionsService spec).
 */
async function revoke(userId, collectionId, granteeId) {
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
 * Grantee self-revocation (Path 1, routes DELETE /:id/grants/me — replaces
 * the recipient-local `Leave` hide). Removal + journaling ride the SAME
 * `collectionsStore.revokeAccess` path as the owner side (action `revoke`,
 * inverse `grant-access`, actor = grantee, cursor deleted in the same TX).
 * Zero-access/unknown id masquerades 404 `notFound` via the read gate; a
 * readable collection with no grant row for the caller (i.e. the owner)
 * throws `grantNotFound`. Instant (§4.7).
 */
async function revokeOwnGrant(userId, collectionId) {
  const { collection, grant: own } = await getCollectionForRead(userId, collectionId);
  if (collection.ownerId === userId || !own) throw serviceError('grantNotFound');
  const result = await collectionsStore.revokeAccess(collectionId, userId, { actor: userId });
  return { grantee_id: userId, revoked: true, undo: { actionId: result.actionId } };
}

// ---------------------------------------------------------------------------
// Member-consumption pre-check (spec §2.6 download/preview bridge)
// ---------------------------------------------------------------------------

async function canReadNode(viewerId, nodeId) {
  if (await isOwnerNode(viewerId, nodeId)) return true;
  return aclService.checkFilePermission(viewerId, nodeId, PERMISSIONS.READ);
}

/**
 * Route-level pre-check for grant-initiated preview/download of a member —
 * executed OUTSIDE the ACL subsystem (never caches into permission stores).
 * Contract (spec §2.6): the read gate first (unknown collection / zero
 * access / hidden flag → `notFound` masquerade), then the materialized
 * membership and node liveness (absent or trashed/vanished member →
 * `notFound` — nothing consumable exists behind this collection). A grantee
 * (viewer|editor) additionally requires `isVisibleToGrantee` on the row and
 * the node to be the collection OWNER's own — foreign-owned members are
 * never consumable through a shared view (cross-leak parity with the item
 * view). An owner requester skips the visibility gate and is checked
 * against the node's OWN file ACL (ownership or granted READ): collection
 * sharing stays additive to file ACL, never a bypass.
 */
async function assertMemberConsumable(viewerId, collectionId, nodeId) {
  const parsedNodeId = toFiniteId(nodeId);
  if (!parsedNodeId) throw serviceError('notFound');
  const { collection, role } = await getCollectionForRead(viewerId, collectionId);
  const stored = await collectionsStore.getStoredItem(collectionId, parsedNodeId);
  if (!stored) throw serviceError('notFound');
  const node = await createFileNodesStore().getNode(parsedNodeId);
  if (!node) throw serviceError('notFound');
  if (role !== 'owner') {
    if (!isVisibleToGrantee(collection, stored)) throw serviceError('forbidden');
    if (!(await isOwnerNode(collection.ownerId, parsedNodeId))) throw serviceError('forbidden');
    return;
  }
  if (!(await canReadNode(viewerId, parsedNodeId))) throw serviceError('forbidden');
}

module.exports = {
  getRole,
  getCollectionForRead,
  requireOwner,
  requireOwnerOrRole,
  isVisibleToGrantee,
  publishPendingCount,
  publish,
  listGrants,
  grant,
  revoke,
  revokeOwnGrant,
  assertMemberConsumable,
};
