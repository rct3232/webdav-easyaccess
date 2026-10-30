'use strict';

/**
 * enrichmentService — read-only AI Info projection for one file node
 * (docs/spec/server/services/enrichmentService.md, routes/aiEnrichments.md).
 *
 * ACL/state gate → single `aiEnrichmentsStore.get` → safe wire shape →
 * model-name provenance. The raw probe object, model ids, keys, base URLs and
 * vectors never leave this module: the response whitelist is the contract.
 */

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const defaultAiEnrichmentsStore = require('../../store/aiEnrichmentsStore');
const defaultLlmModelsStore = require('../../store/llmModelsStore');
const { createFileNodesStore } = require('../../store/fileNodesStore');
const defaultAclService = require('../permissions/services/aclService');

function serviceError(code) {
  const error = new Error(code);
  if (code === 'notFound') error.status = 404;
  return error;
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function projectTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => typeof tag === 'string' && tag.length > 0);
}

/**
 * Safe media facts only: duration/dimensions plus distinct codec names.
 * Raw `probe.tags` (container metadata) and `probe.streams` are never exposed.
 */
function projectMedia(probe) {
  if (!probe || typeof probe !== 'object') return null;
  const duration = optionalPositiveNumber(probe.durationSec);
  const width = optionalPositiveNumber(probe.width);
  const height = optionalPositiveNumber(probe.height);
  const codecs = [];
  if (Array.isArray(probe.streams)) {
    for (const stream of probe.streams) {
      const codec = optionalString(stream?.codecName);
      if (codec && !codecs.includes(codec)) codecs.push(codec);
    }
  }
  if (duration == null && width == null && height == null && codecs.length === 0) {
    return null;
  }
  return { duration_sec: duration, width, height, codecs };
}

async function resolveModelName(llmModelsStore, modelId) {
  if (modelId == null) return null;
  try {
    const model = await llmModelsStore.getModel(modelId);
    const modelName = optionalString(model?.modelName);
    return modelName ? { model_name: modelName } : null;
  } catch {
    // Provenance is display sugar — a lookup failure never fails the read.
    return null;
  }
}

function createEnrichmentService({
  aiEnrichmentsStore = defaultAiEnrichmentsStore,
  llmModelsStore = defaultLlmModelsStore,
  fileNodesStore = createFileNodesStore(),
  aclService = defaultAclService,
} = {}) {
  /**
   * @param {number} userId - authenticated viewer id
   * @param {number} nodeId - target node
   * @returns {Promise<{ nodeId: number, enrichment: object|null }>}
   *   Unknown/trashed/unreadable → `notFound` (404 masquerade); readable
   *   without a row → `enrichment: null`.
   */
  async function getNodeEnrichment(userId, nodeId) {
    const node = await fileNodesStore.getNode(nodeId);
    if (!node) throw serviceError('notFound');

    const readable = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ);
    if (!readable) throw serviceError('notFound');

    const row = await aiEnrichmentsStore.get(nodeId);
    if (!row) return { nodeId, enrichment: null };

    const [features, caption, asr] = await Promise.all([
      resolveModelName(llmModelsStore, row.featuresModelId),
      resolveModelName(llmModelsStore, row.captionModelId),
      resolveModelName(llmModelsStore, row.asrModelId),
    ]);

    return {
      nodeId,
      enrichment: {
        tags: projectTags(row.tags),
        summary: optionalString(row.summary),
        caption: optionalString(row.caption),
        transcript: optionalString(row.transcript),
        media_kind: optionalString(row.mediaKind),
        media: projectMedia(row.probe),
        truncated: row.truncated === true,
        schema_version: Number.isInteger(row.schemaVersion) ? row.schemaVersion : null,
        updated_at: optionalString(row.updatedAt),
        provenance: { features, caption, asr },
      },
    };
  }

  return { getNodeEnrichment };
}

module.exports = { createEnrichmentService, projectMedia, projectTags };
