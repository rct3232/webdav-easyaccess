'use strict';

const { AI_JOB_KIND } = require('@webdav-easyaccess/shared/constants');
const { getFileType } = require('@webdav-easyaccess/shared/fileTypes');

/**
 * onNodeContentCommitted — the post-commit enrichment hook
 * (docs/spec/server/services/aiJobService.md §2.2).
 *
 * Domain TXs call `onNodeContentCommitted(nodeId, contentHash)` fire-and-
 * forget AFTER the commit at exactly four seams (S3 upload, WebDAV upload
 * success, copy, version restore). There is deliberately NO delete seam.
 *
 * Responsibilities:
 * 1. Look the node up (type/name/mimeType) and apply the enqueue decision
 *    table (§2.2 — kind set per node kind/config state):
 *      text/document (pdf/docx/txt — local extractor applies) → `embed`,
 *        plus `features` when the chat role is probed on;
 *      image / video, vision role probed on → `caption` (the caption
 *        pipeline chains `embed` on completion);
 *      audio, asr role probed on → `asr` (chains `embed` on completion);
 *      media with the capability absent → `embed` immediately (the V0
 *        metadata_only floor);
 *      anything else (unknown type) → `embed` floor;
 *      directory nodes → none.
 * 2. Enqueue each kind with generation 1 and the FRESH content hash the
 *    seam received (the same commit points populate filecache.content_hash;
 *    the (content_hash, modelId) pair is the embed dedupe skip-key).
 *
 * Capability gates read the EFFECTIVE capability set published by the
 * llmAdapter's probe authority (llmAdapter.md §2.4 — `evaluateCapabilityMatrix`
 * output via `probeState`), never raw config presence: a declared role that was
 * never probed or whose probe failed is OFF (media falls back to the embed
 * floor). The probe is injectable for tests.
 *
 * Error surface (§2.6): public enqueue functions throw nothing to callers —
 * the hook is post-commit fire-and-forget; failures are logged and the next
 * hook/backfill heals (enqueue idempotency makes loss recoverable).
 */

/** Default capability probe — the adapter-published effective capability set
 * (declared ≠ probed ⇒ OFF). */
function defaultCapabilityProbe() {
  return async (role) => {
    // Lazy require: probeState is process-wide state written by boot wiring;
    // requiring it at module scope would couple every importer to boot order.
    const { isRoleEnabled } = require('../../infrastructure/adapters/llm/probeState');
    return isRoleEnabled(role);
  };
}

/**
 * Classify a node for the decision table (extension first — the shared
 * file-type util used across the codebase — then the filecache mimeType as
 * fallback for extension-less / registry-missed names).
 *
 * @returns {'text'|'visual'|'audio'|'other'}
 */
function classifyNode(node) {
  const fileType = getFileType(String(node.name || '')); // image|video|audio|pdf|text|unknown
  if (fileType === 'image' || fileType === 'video') return 'visual';
  if (fileType === 'audio') return 'audio';
  if (fileType === 'text' || fileType === 'pdf') return 'text';

  const mime = String(node.mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/')) return 'visual';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('officedocument') ||
    mime.includes('msword')
  ) {
    return 'text';
  }
  return 'other';
}

/**
 * Factory: create the enrichment hook bound to one queue + node store.
 *
 * @param {Object} deps
 * @param {Object} deps.aiJobsRepository - the ai_jobs queue (enqueue contract
 *   aiJobsStore.md §2.3: (nodeId, kind, generation, contentHash?) with the
 *   content-aware conflict rule — identical/absent hash ⇒ `null` dedupe, a
 *   different non-null hash resets the same row to `pending`).
 * @param {Object} deps.fileNodesStore - node lookup (getNode: type/name/mimeType).
 * @param {Function} [deps.capabilityProbe] - async (role) => boolean for
 *   'chat' | 'vision' | 'asr'; defaults to the shared config resolver.
 * @param {number} [deps.generation=1] - fallback per-kind generation (§2.2:
 *   default 1; admin model-change/backfill bumps are out of the hook's scope).
 * @param {(kind: string) => Promise<number>} [deps.generationFor] - async
 *   current-counter resolver (`generationSettings.getGeneration`); a thrown
 *   read falls back to `generation` and never breaks the committed caller.
 */
function createNodeContentHook({
  aiJobsRepository,
  fileNodesStore,
  capabilityProbe,
  generation = 1,
  generationFor,
}) {
  if (!aiJobsRepository || typeof aiJobsRepository.enqueue !== 'function') {
    throw new TypeError('createNodeContentHook requires aiJobsRepository.enqueue');
  }
  if (!fileNodesStore || typeof fileNodesStore.getNode !== 'function') {
    throw new TypeError('createNodeContentHook requires fileNodesStore.getNode');
  }
  const probe = capabilityProbe || defaultCapabilityProbe();

  /** Current per-kind generation; a read failure degrades to the local default. */
  async function resolveGeneration(kind) {
    if (typeof generationFor !== 'function') return generation;
    try {
      const value = Number(await generationFor(kind));
      return Number.isInteger(value) && value >= 1 ? value : generation;
    } catch (error) {
      console.error(
        `[nodeContentHook] generation read failed for ${kind}; using ${generation}:`,
        error && error.message
      );
      return generation;
    }
  }

  /** Kinds enqueued for one node per the §2.2 decision table. */
  async function kindsForNode(node) {
    if (!node || node.type === 'directory') return [];

    const classified = classifyNode(node);
    if (classified === 'text') {
      const kinds = [AI_JOB_KIND.EMBED];
      if (await probe('chat')) kinds.push(AI_JOB_KIND.FEATURES);
      return kinds;
    }
    if (classified === 'visual') {
      return (await probe('vision')) ? [AI_JOB_KIND.CAPTION] : [AI_JOB_KIND.EMBED];
    }
    if (classified === 'audio') {
      return (await probe('asr')) ? [AI_JOB_KIND.ASR] : [AI_JOB_KIND.EMBED];
    }
    return [AI_JOB_KIND.EMBED];
  }

  /**
   * Fire-and-forget enqueue after a content-commit. NEVER throws: a hook
   * failure is logged and healed by the next hook/backfill (§2.6). A
   * per-kind enqueue failure does not block the remaining kinds.
   *
   * @param {number|string} nodeId
   * @param {string|null} contentHash - fresh hash of the committed content
   *   (the same commit points wrote it to filecache.content_hash).
   */
  async function onNodeContentCommitted(nodeId, contentHash) {
    try {
      const node = await fileNodesStore.getNode(nodeId);
      const kinds = await kindsForNode(node);
      for (const kind of kinds) {
        try {
          const jobGeneration = await resolveGeneration(kind);
          await aiJobsRepository.enqueue(nodeId, kind, jobGeneration, contentHash ?? null);
        } catch (error) {
          console.error(
            `[nodeContentHook] failed to enqueue ${kind} job for node ${nodeId}:`,
            error && error.message
          );
        }
      }
    } catch (error) {
      console.error(
        `[nodeContentHook] onNodeContentCommitted failed for node ${nodeId}:`,
        error && error.message
      );
    }
  }

  return { onNodeContentCommitted };
}

module.exports = { createNodeContentHook };
