'use strict';

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
 * Capability probes read the same LLM_* config the llmAdapter resolves per
 * role (the shared config resolver — the codebase's config source, cf.
 * collectionsService embedRoleConfigured): a role counts as probed on when
 * its base URL AND model are set. The probe is injectable for tests.
 *
 * Error surface (§2.6): public enqueue functions throw nothing to callers —
 * the hook is post-commit fire-and-forget; failures are logged and the next
 * hook/backfill heals (enqueue idempotency makes loss recoverable).
 */

/** Per-role config keys — mirrors infrastructure/adapters/llm ROLE_KEYS
 * (BASE_URL + MODEL decide "remote configured"; vision/asr/chat have no
 * embedded engine, so the pair suffices). */
const ROLE_PROBE_KEYS = {
  chat: ['LLM_CHAT_BASE_URL', 'LLM_CHAT_MODEL'],
  vision: ['LLM_VISION_BASE_URL', 'LLM_VISION_MODEL'],
  asr: ['LLM_ASR_BASE_URL', 'LLM_ASR_MODEL'],
};

/** Default capability probe — the shared config resolver (dbOnly group). */
function defaultCapabilityProbe() {
  return async (role) => {
    const keys = ROLE_PROBE_KEYS[role];
    if (!keys) return false;
    // Lazy require: the resolver is a process-wide singleton; requiring it at
    // module scope would couple every importer to boot order.
    const { getSharedResolver } = require('../../infrastructure/configResolver');
    const resolver = getSharedResolver();
    const [baseUrl, model] = await Promise.all(keys.map((key) => resolver.getConfig(key)));
    return Boolean(String(baseUrl || '').trim()) && Boolean(String(model || '').trim());
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
 *   aiJobsStore.md §2.3: (nodeId, kind, generation, contentHash?) with
 *   ON CONFLICT DO NOTHING dedupe).
 * @param {Object} deps.fileNodesStore - node lookup (getNode: type/name/mimeType).
 * @param {Function} [deps.capabilityProbe] - async (role) => boolean for
 *   'chat' | 'vision' | 'asr'; defaults to the shared config resolver.
 * @param {number} [deps.generation=1] - per-kind generation (§2.2: default 1;
 *   admin model-change/backfill bumps are out of the hook's scope).
 */
function createNodeContentHook({
  aiJobsRepository,
  fileNodesStore,
  capabilityProbe,
  generation = 1,
}) {
  if (!aiJobsRepository || typeof aiJobsRepository.enqueue !== 'function') {
    throw new TypeError('createNodeContentHook requires aiJobsRepository.enqueue');
  }
  if (!fileNodesStore || typeof fileNodesStore.getNode !== 'function') {
    throw new TypeError('createNodeContentHook requires fileNodesStore.getNode');
  }
  const probe = capabilityProbe || defaultCapabilityProbe();

  /** Kinds enqueued for one node per the §2.2 decision table. */
  async function kindsForNode(node) {
    if (!node || node.type === 'directory') return [];

    const classified = classifyNode(node);
    if (classified === 'text') {
      const kinds = ['embed'];
      if (await probe('chat')) kinds.push('features');
      return kinds;
    }
    if (classified === 'visual') {
      return (await probe('vision')) ? ['caption'] : ['embed'];
    }
    if (classified === 'audio') {
      return (await probe('asr')) ? ['asr'] : ['embed'];
    }
    return ['embed'];
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
          await aiJobsRepository.enqueue(nodeId, kind, generation, contentHash ?? null);
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
