const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const requireNonAdmin = require('../../middleware/requireNonAdmin');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const collectionsService = require('./service');
const wire = require('./wire');

const ERROR_MAP = {
  nameRequired: SERVER_ERROR_CODES.collections.nameRequired,
  invalidName: SERVER_ERROR_CODES.collections.invalidName,
  invalidSort: SERVER_ERROR_CODES.collections.invalidSort,
  invalidInclude: SERVER_ERROR_CODES.collections.invalidInclude,
  invalidPublishMode: SERVER_ERROR_CODES.collections.invalidPublishMode,
  invalidDefinition: SERVER_ERROR_CODES.collections.invalidDefinition,
  emptyNodeIds: SERVER_ERROR_CODES.collections.emptyNodeIds,
  previewTargetRequired: SERVER_ERROR_CODES.collections.previewTargetRequired,
  mergeSameCollection: SERVER_ERROR_CODES.collections.mergeSameCollection,
  notFound: SERVER_ERROR_CODES.collections.notFound,
  forbidden: SERVER_ERROR_CODES.collections.forbidden,
  alreadyArchived: SERVER_ERROR_CODES.collections.alreadyArchived,
  notArchived: SERVER_ERROR_CODES.collections.notArchived,
  aiNotConfigured: SERVER_ERROR_CODES.ai.notConfigured,
  invalidRole: SERVER_ERROR_CODES.collections.invalidRole,
  granteeNotFound: SERVER_ERROR_CODES.collections.granteeNotFound,
  grantNotFound: SERVER_ERROR_CODES.collections.grantNotFound,
  suggestionNotFound: SERVER_ERROR_CODES.collections.suggestionNotFound,
};

function handleServiceError(error) {
  return mapServiceError(error, ERROR_MAP);
}

// Literal paths MUST be registered before the /:id parameterized routes.

function serializePreview(result) {
  return {
    count: result.count,
    sample: result.sample.map((row) => ({ node_id: row.nodeId, name: row.name })),
    sample_truncated: result.sample_truncated,
    ...(result.degraded !== undefined && { degraded: result.degraded }),
  };
}

router.post(
  '/preview',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(
        serializePreview(await collectionsService.preview(req.user.full.id, req.body || {}))
      );
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.get(
  '/merge-suggestions',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(await collectionsService.listMergeSuggestions(req.user.full.id));
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/for-nodes',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.getForNodes(req.user.full.id, req.body.nodeIds);
      res.json({
        memberships: result.memberships.map((row) => ({
          node_id: row.nodeId,
          collection_ids: row.collectionIds,
        })),
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.get(
  '/',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await collectionsService.listCollections(req.user.full.id, {
          sort: req.query.sort,
          include: req.query.include,
        })
      );
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.get(
  '/:id',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.getCollection(
        req.user.full.id,
        Number(req.params.id)
      );
      res.json(result.collection);
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      let result;
      if (body.seedNodeId !== undefined && body.seedNodeId !== null) {
        result = await collectionsService.createSeedCollection(req.user.full.id, body);
      } else if (body.semantic !== undefined && body.semantic !== null) {
        // Search save leg (collectionsService.md §2.2.1): the `{ name,
        // semantic }` dispatch arm — the response adds `rejected_not_readable`.
        result = await collectionsService.createSearchCollection(req.user.full.id, body);
      } else {
        result = await collectionsService.createCollection(req.user.full.id, body);
      }
      res.status(201).json({
        collection: wire.serializeCollection(result.collection, { includeDefinition: true }),
        undo: { action_id: result.undo.actionId },
        ...(Array.isArray(result.rejected_not_readable) && {
          rejected_not_readable: result.rejected_not_readable,
        }),
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.put(
  '/:id',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.updateCollection(
        req.user.full.id,
        Number(req.params.id),
        {
          name: req.body.name,
          pinned: req.body.pinned,
          publishMode: req.body.publishMode,
        }
      );
      res.json({
        collection: wire.serializeCollection(result.collection, { includeDefinition: true }),
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/archive',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.archiveCollection(
        req.user.full.id,
        Number(req.params.id)
      );
      res.json({
        collection: wire.serializeCollection(result.collection, { includeDefinition: true }),
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/restore',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.restoreCollection(
        req.user.full.id,
        Number(req.params.id)
      );
      res.json({
        collection: wire.serializeCollection(result.collection, { includeDefinition: true }),
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.delete(
  '/:id',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      await collectionsService.deleteCollectionPermanent(req.user.full.id, Number(req.params.id));
      res.status(204).end();
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.get(
  '/:id/items',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      // Decision B (2026-09-29): the retired `cursor`/`limit` query params are
      // NOT read (ignored, never an error); `since` (digest) stays.
      const result = await collectionsService.getItems(req.user.full.id, Number(req.params.id), {
        since: req.query.since,
      });
      res.json({
        items: result.items.map(wire.serializeItem),
        // Decision B (2026-09-29): full fetch — no next_cursor on the wire.
        ...(result.publishPendingCount !== undefined && {
          publish_pending_count: result.publishPendingCount,
        }),
        ...(result.digest !== undefined && { digest: result.digest }),
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/items',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.addItems(
        req.user.full.id,
        Number(req.params.id),
        (req.body || {}).nodeIds
      );
      res.json({
        added: result.added,
        already_members: result.already_members,
        rejected_not_readable: result.rejected_not_readable,
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.delete(
  '/:id/items',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.removeItems(
        req.user.full.id,
        Number(req.params.id),
        (req.body || {}).nodeIds
      );
      res.json({
        removed: result.removed,
        excluded: result.excluded,
        ignored: result.ignored,
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

// P-4 member publish — flips stored rows and materializes derived publishes.
router.put(
  '/:id/items/publish',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const result = await collectionsService.publishItems(
        req.user.full.id,
        Number(req.params.id),
        body.nodeIds,
        body.published
      );
      res.json({
        published: result.published,
        ignored: result.ignored,
        undo: result.undo ? { action_id: result.undo.actionId } : null,
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/preview',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(
        serializePreview(
          await collectionsService.previewCollection(req.user.full.id, Number(req.params.id))
        )
      );
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/merge/:other',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.mergeCollections(
        req.user.full.id,
        req.params.id,
        req.params.other
      );
      res.json({
        survivor: {
          collection_id: result.survivor.id,
          name: result.survivor.name,
          item_count: result.survivor.itemCount,
        },
        absorbed_id: result.absorbedId,
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/merge-dismiss',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await collectionsService.dismissMerge(
          req.user.full.id,
          req.params.id,
          (req.body || {}).otherId
        )
      );
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/merge-reject',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(
        await collectionsService.rejectMerge(
          req.user.full.id,
          req.params.id,
          (req.body || {}).otherId
        )
      );
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.get(
  '/:id/grants',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      res.json(await collectionsService.listGrants(req.user.full.id, Number(req.params.id)));
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.post(
  '/:id/grants',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.grantCollectionAccess(
        req.user.full.id,
        Number(req.params.id),
        (req.body || {}).userId,
        (req.body || {}).role
      );
      res.status(201).json({
        grant: wire.serializeGrant(result.grant, result.username),
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

// Grantee self-revocation (Path 1). The literal `me` tail is a different segment
// count from `/:id/grants` (no Express shadowing) — registered BEFORE the owner
// DELETE as defensive convention (routes spec §2.2).
router.delete(
  '/:id/grants/me',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.revokeOwnGrant(
        req.user.full.id,
        Number(req.params.id)
      );
      res.json({
        grantee_id: result.grantee_id,
        revoked: result.revoked,
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

router.delete(
  '/:id/grants',
  authenticateToken,
  requireUser,
  requireNonAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await collectionsService.revokeCollectionAccess(
        req.user.full.id,
        Number(req.params.id),
        req.query.userId
      );
      res.json({
        grantee_id: result.grantee_id,
        revoked: result.revoked,
        undo: { action_id: result.undo.actionId },
      });
    } catch (e) {
      throw handleServiceError(e);
    }
  })
);

module.exports = router;
