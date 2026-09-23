'use strict';

/**
 * derivedTags — local derived tags, v1 set (AI_FEATURE_PLAN.md §4.10,
 * docs/spec/server/services/derivedTagsService.md). LLM-free computation of
 * `mime` / `ext` / `month` / `path` from node metadata, persisted FOLDED
 * (§4.18 step 1) through the aiTagStore `ai_tag_raw` surface (§2.4.5).
 * EXIF is REJECTED for v1 (§4.10) — not a tag source.
 *
 * v1 values are KIND-PREFIXED (`ext:jpg`, `mime:image`, `month:2026-09`,
 * `path:photos`) so derived tags can never collide with LLM tags
 * materialized into the same table later, and predicate atoms are
 * self-describing. Tags are computed today via the backfill seam below;
 * the §4.1 commit-point wiring (upload/copy/restore) is P1 (register (b)).
 */

const aiTagStore = require('../../store/aiTagStore');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const { foldTag } = require('./tagVocabulary');

const PATH_SEGMENT_LIMIT = 2;
const EXT_PATTERN = /^[a-z0-9]+$/;

function addTag(tags, rawValue) {
  const folded = foldTag(rawValue);
  if (folded) tags.add(folded);
}

/** Extension half of `name` (after the LAST dot, none for leading-dot or empty). */
function extractExtension(name) {
  if (typeof name !== 'string') return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_PATTERN.test(ext) ? ext : null;
}

function primaryMimeType(mimeType) {
  if (typeof mimeType !== 'string') return null;
  const primary = mimeType.split('/')[0].trim().toLowerCase();
  return primary.length > 0 ? primary : null;
}

function monthOf(createdAt) {
  if (createdAt === undefined || createdAt === null || createdAt === '') return null;
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

/**
 * Pure v1 derived-tag computation (§2.3). Deterministic: same input ⇒ same
 * folded, deduped, sorted output. Never throws on odd metadata.
 * @param {{ name?: string, createdAt?: string|Date, mimeType?: string|null, pathSegments?: string[] }} input
 * @returns {string[]}
 */
function computeDerivedTags(input = {}) {
  const { name, createdAt, mimeType, pathSegments } = input;
  const tags = new Set();

  const ext = extractExtension(name);
  if (ext) addTag(tags, `ext:${ext}`);

  const mime = primaryMimeType(mimeType);
  if (mime) addTag(tags, `mime:${mime}`);

  const month = monthOf(createdAt);
  if (month) addTag(tags, `month:${month}`);

  const segments = Array.isArray(pathSegments) ? pathSegments : [];
  for (const segment of segments.slice(0, PATH_SEGMENT_LIMIT)) {
    const folded = foldTag(segment);
    if (folded) addTag(tags, `path:${folded}`);
  }

  return [...tags].sort();
}

/** Per-node write seam — the call shape the §4.1 commit points will use (P1). */
async function syncNodeDerivedTags(input = {}) {
  const { nodeId, ...metadata } = input;
  const tags = computeDerivedTags(metadata);
  return aiTagStore.replaceRawTags(nodeId, tags);
}

/** Ancestor folder names below the user's root, top-down (root name excluded). */
function pathSegmentsBelowRoot(node, byId, rootId) {
  const segments = [];
  const seen = new Set([Number(node.nodeId)]);
  let current = byId.get(Number(node.parentId));
  while (current && !seen.has(Number(current.nodeId))) {
    seen.add(Number(current.nodeId));
    if (Number(current.nodeId) === Number(rootId)) break;
    segments.unshift(String(current.name));
    current = byId.get(Number(current.parentId));
  }
  return segments;
}

/**
 * Idempotent derived-tag pass over the user's OWN live subtree (§2.4).
 * Directories and other users' nodes are skipped; each file's derived set is
 * REPLACED (the whole ai_tag_raw row set for that node — v1 writer
 * ownership, aiTagStore §2.4.5).
 */
async function backfillDerivedTagsForUser(userId) {
  const store = createFileNodesStore();
  const root = await store.getUserRootNode(userId);
  if (!root) return { nodes: 0, tagsWritten: 0 };

  const rows = await store.listSubtreeCacheRows(root.id);
  const byId = new Map(rows.map((row) => [Number(row.nodeId), row]));

  let nodes = 0;
  let tagsWritten = 0;
  for (const row of rows) {
    if (row.type !== 'file') continue;
    const tags = computeDerivedTags({
      name: row.name,
      createdAt: row.createdAt,
      mimeType: row.mimeType,
      pathSegments: pathSegmentsBelowRoot(row, byId, root.id),
    });
    const { inserted } = await aiTagStore.replaceRawTags(row.nodeId, tags);
    nodes += 1;
    tagsWritten += inserted;
  }
  return { nodes, tagsWritten };
}

module.exports = {
  foldTag,
  computeDerivedTags,
  syncNodeDerivedTags,
  backfillDerivedTagsForUser,
};
