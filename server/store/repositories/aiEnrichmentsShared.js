'use strict';

/**
 * Shared schema contracts and data mappers for the AI vector/enrichment
 * repository layer (T1.2b): `embeddings`, `embeddings_chunk`, and
 * `ai_enrichments`.
 *
 * Source of truth (DDL): server/store/postgresql/ddl/001_initial_normalized_schema.sql
 *
 * CONSTRAINED (PLAN.md §19 — Tag Layer Dissolution):
 * `ai_enrichments.tags` stores *free descriptive words* ONLY.
 * - No tag hierarchy, vector artifact, or tag alias code paths are
 *   permitted in this layer.
 * - No vocabulary normalization, no hierarchies. Tags are opaque strings.
 */

/**
 * Represents a pooled vector embedding mapped to a specific file node.
 * @typedef {Object} Embedding
 * @property {number} id - The unique identifier for the embedding.
 * @property {number} node_id - Foreign key to file_nodes (ON DELETE CASCADE).
 * @property {number} model_id - The embedding model space key (llm_models).
 * @property {string} vector - Comma-separated vector representation (TEXT).
 * @property {number} dim - Dimension of the vector.
 * @property {string} source - The source of the embedding (e.g., 'fulltext', 'chunk_pool').
 * @property {string|null} content_hash - Content hash for deduplication (nullable).
 * @property {string} updated_at - ISO 8601 timestamp of last update.
 */

/**
 * Represents a per-chunk vector embedding for long documents.
 * @typedef {Object} EmbeddingsChunk
 * @property {number} node_id - Foreign key to file_nodes (part of PK).
 * @property {number} chunk_idx - Index of the chunk (part of PK).
 * @property {number} model_id - The embedding model space key (llm_models).
 * @property {string} vector - Comma-separated vector representation (TEXT).
 * @property {string} updated_at - ISO 8601 timestamp of last update.
 */

/**
 * Represents AI-generated enrichment data for a file node.
 * @typedef {Object} AiEnrichment
 * @property {number} node_id - Foreign key to file_nodes (PK, ON DELETE CASCADE).
 * @property {number|null} features_model_id - The model used for feature extraction.
 * @property {number} schema_version - The schema version of the enrichment data.
 * @property {string[]|null} tags - Free descriptive words ONLY (No vocabulary normalization).
 * @property {string|null} summary - AI generated summary.
 * @property {string|null} caption - AI generated caption (for images).
 * @property {number|null} caption_model_id - The model used for captioning.
 * @property {string|null} transcript - AI generated transcript (for audio/video).
 * @property {number|null} asr_model_id - The model used for ASR.
 * @property {Object|null} probe - Diagnostic probe data.
 * @property {boolean} truncated - Whether the content was truncated.
 * @property {string|null} media_kind - The type of media.
 * @property {string} updated_at - ISO 8601 timestamp of last update.
 */

/**
 * Validates that the provided tags are a list of free descriptive words.
 * Fails if there is any attempt to create a hierarchy or vocabulary.
 * @param {string[]|null} tags
 * @returns {string[]|null}
 */
function normalizeTags(tags) {
  if (tags === null || tags === undefined) return null;
  if (!Array.isArray(tags)) {
    throw new TypeError('tags must be an array of free descriptive words (strings).');
  }
  if (tags.some((tag) => typeof tag !== 'string')) {
    throw new TypeError('tags must be an array of free descriptive words (strings).');
  }
  return tags;
}

/**
 * Maps a database row to the `Embedding` entity.
 * @param {Object} row
 * @returns {Embedding}
 */
function mapEmbedding(row) {
  return {
    id: row.id,
    node_id: row.node_id,
    model_id: row.model_id,
    vector: row.vector,
    dim: row.dim,
    source: row.source,
    content_hash: row.content_hash === undefined ? null : row.content_hash,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Maps a database row to the `EmbeddingsChunk` entity.
 * @param {Object} row
 * @returns {EmbeddingsChunk}
 */
function mapEmbeddingsChunk(row) {
  return {
    node_id: row.node_id,
    chunk_idx: row.chunk_idx,
    model_id: row.model_id,
    vector: row.vector,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Maps a database row to the `AiEnrichment` entity.
 * @param {Object} row
 * @returns {AiEnrichment}
 */
function mapAiEnrichmentRow(row) {
  return {
    nodeId: Number(row.node_id),
    featuresModelId: row.features_model_id === null ? null : Number(row.features_model_id),
    schemaVersion: Number(row.schema_version),
    tags: parseJsonArray(row.tags),
    summary: row.summary === undefined ? null : row.summary,
    caption: row.caption === undefined ? null : row.caption,
    captionModelId: row.caption_model_id === null ? null : Number(row.caption_model_id),
    transcript: row.transcript === undefined ? null : row.transcript,
    asrModelId: row.asr_model_id === null ? null : Number(row.asr_model_id),
    probe: parseJsonObject(row.probe),
    truncated: row.truncated === 1 || row.truncated === true,
    mediaKind: row.media_kind === undefined ? null : row.media_kind,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Safely parses a JSON string or returns the object if already parsed.
 * @param {string|Object|null|undefined} value
 * @returns {string[]|null}
 */
function parseJsonArray(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Safely parses a JSON string or returns the object if already parsed.
 * @param {string|Object|null|undefined} value
 * @returns {Object|null}
 */
function parseJsonObject(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  normalizeTags,
  mapEmbedding,
  mapEmbeddingsChunk,
  mapAiEnrichmentRow,
  parseJsonArray,
  parseJsonObject,
};
