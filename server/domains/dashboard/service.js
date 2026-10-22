'use strict';

/**
 * dashboard domain service — Storage-dashboard composition for the §4.16 v1
 * blocks (docs/spec/server/services/dashboardService.md). Thin CONSUMER:
 * exact dups come from dupFinderService (hash-first, LLM-free), the trash card
 * from FileNodeRepository.summarizeTrashedSubtree, the accept action from the
 * files-domain trash core. No SQL here, no persistence, no journal writer
 * (P0 writers = collections only — the accept undo rides T3.3).
 */
const { createFileNodesStore } = require('../../store/fileNodesStore');
const dupFinderService = require('../ai/dupFinderService');
const { createNearDupFinderService } = require('../ai/nearDupFinderService');
const { getVectorStoreOrFallback } = require('../ai/vectorStoreRuntime');
const ownerNodeResolver = require('../permissions/policy/ownerNodeResolver');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const { getComposition } = require('../../service/composition');

// Same resolution contract as gcService Tier 3 (`0` = retention off).
const DEFAULT_TRASH_RETENTION_DAYS = 30;
const MAX_ACCEPT_BATCH = 200;

function serviceError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

/**
 * TRASH_RETENTION_DAYS: config resolver → finite ≥0 wins, else the default.
 * @returns {Promise<number>}
 */
async function resolveTrashRetentionDays() {
  const configured = await getSharedResolver().getConfig('TRASH_RETENTION_DAYS');
  const days = Number(configured);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_TRASH_RETENTION_DAYS;
}

/**
 * One-shot dashboard read: dup summary + computed exact-dup suggestions +
 * trash summary (camelCase domain object — the ROUTE serializes snake_case).
 * @param {number|string} userId
 */
async function getDashboardSummary(userId) {
  const store = createFileNodesStore();
  const root = await store.getUserRootNode(Number(userId));

  // One dup pass feeds both cards and the checklist (route §2.4.2 decision);
  // the vector near-dup pass appends `near_dup` rows of the same shape.
  const dups = await dupFinderService.findExactDuplicateGroups(userId);
  const suggestions = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const group of dups.groups) {
    // keep rule: smallest node id survives (deterministic, LLM-free)
    const keepNodeId = group.nodeIds[0];
    group.nodeIds.slice(1).forEach((nodeId, index) => {
      suggestions.push({
        nodeId,
        kind: 'exact_dup',
        path: group.filePaths[index + 1] ?? null,
        sizeBytes: group.sizeBytes,
        reason: { kind: 'exact_dup', keepNodeId },
      });
    });
  }

  // §4.17 vector variant — nearDupFinderService owns hash-first precedence,
  // θ_dup (profile) and the group cap; absence is `available: false` and the
  // whole block is omitted (never an error — §4.12).
  const near = await createNearDupFinderService({
    // C6: near-dup scoring reads the boot-selected vectorStore engine
    // (native when available, JsFallback otherwise — vectorStore.md §2.3).
    engineFactory: (modelId, loadRows) => getVectorStoreOrFallback(modelId, loadRows),
  }).findNearDuplicateGroups(userId);
  if (near.available) {
    // eslint-disable-next-line no-restricted-syntax
    for (const group of near.groups) {
      // keep rule: smallest node id survives (exact-dup precedent)
      const keepNodeId = group.nodeIds[0];
      group.nodeIds.slice(1).forEach((nodeId, index) => {
        suggestions.push({
          nodeId,
          kind: 'near_dup',
          path: group.filePaths[index + 1] ?? null,
          sizeBytes: group.sizeBytes[index + 1],
          reason: { kind: 'near_dup', keepNodeId },
        });
      });
    }
  }

  const trash = root
    ? await store.summarizeTrashedSubtree(root.id)
    : { itemCount: 0, totalBytes: 0, oldestDeletedAt: null };

  return {
    duplicates: {
      groupCount: dups.groupCount,
      duplicateCount: dups.duplicateCount,
      reclaimableBytes: dups.reclaimableBytes,
    },
    ...(near.available
      ? {
          nearDuplicates: {
            groupCount: near.groupCount,
            duplicateCount: near.duplicateCount,
          },
        }
      : {}),
    suggestions,
    trash: { ...trash, retentionDays: await resolveTrashRetentionDays() },
  };
}

/**
 * Accept checked suggestion rows → trash. Owner-gated, per-node isolated,
 * NOT journaled in P0 (routes/dashboard.md §2.4 decision).
 * @param {number|string} userId
 * @param {Object} user — req.user.full (the trash core's ACL subject)
 * @param {Array<number|string>} nodeIds
 */
async function acceptSuggestions(userId, user, nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0 || nodeIds.length > MAX_ACCEPT_BATCH) {
    throw serviceError('emptyNodeIds');
  }

  const { fileService } = getComposition();
  const trashed = [];
  const rejectedNotOwned = [];
  const skipped = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const rawNodeId of nodeIds) {
    const nodeId = Number(rawNodeId);
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      rejectedNotOwned.push(Number.isNaN(nodeId) ? rawNodeId : nodeId);
      // eslint-disable-next-line no-await-in-loop
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const owned = await ownerNodeResolver.isOwnerNode(Number(userId), nodeId);
      if (!owned) {
        rejectedNotOwned.push(nodeId);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await fileService.deleteNode(nodeId, Number(userId), user);
        trashed.push(nodeId);
      }
    } catch (error) {
      // a trashed/foreign node surfaces 404 from the trash core — the same
      // classification the owner gate produces; anything else is a backend
      // failure for THIS node only (the loop never aborts).
      if (error && error.status === 404) {
        rejectedNotOwned.push(nodeId);
      } else {
        skipped.push(nodeId);
      }
    }
  }

  return { trashed, rejectedNotOwned, skipped };
}

module.exports = {
  DEFAULT_TRASH_RETENTION_DAYS,
  MAX_ACCEPT_BATCH,
  resolveTrashRetentionDays,
  getDashboardSummary,
  acceptSuggestions,
};
