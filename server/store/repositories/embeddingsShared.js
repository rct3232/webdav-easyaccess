'use strict';

/**
 * Shared data types and mapping for EmbeddingsRepository + EmbeddingsChunkRepository
 * dialect twins (docs/spec/server/store/embeddingsStore.md,
 * docs/spec/server/store/embeddingsChunkStore.md).
 */

/**
 * Maps a database row to the domain `EmbeddingsRow` shape.
 *
 * @param {Object} row Raw DB row (snake_case columns).
 * @returns {Object} Domain row (camelCase fields, proper types).
 */
function mapEmbeddingsRow(row) {
  return {
    nodeId: Number(row.node_id),
    modelId: Number(row.model_id),
    dim: Number(row.dim),
    vector: deserializeVector(row.vector),
    source: row.source,
    contentHash: row.content_hash ?? null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/**
 * Serializes a vector array into the string representation required by the
 * database. Vectors are stored as text (comma-separated floats) to keep
 * schema parity between SQLite (TEXT) and Postgres (TEXT).
 *
 * @param {number[]} vector Numeric vector.
 * @returns {string} Serialized vector text (e.g., "1.0,2.5,3.0").
 * @throws {TypeError} If the vector is not a non-empty array of finite numbers.
 */
function serializeVector(vector) {
  // Accepts either a numeric array or a comma-separated string of numbers
  // (conformance tests round-trip both; malformed strings must raise here).
  if (typeof vector === 'string') {
    if (vector.trim().length === 0) {
      throw new TypeError('vector string must not be empty');
    }
    const values = vector.split(',').map(Number);
    if (values.some((v) => !Number.isFinite(v))) {
      throw new TypeError('vector string contains non-numeric segments');
    }
    return vector;
  }
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new TypeError('vector must be a non-empty number array or comma-separated string');
  }
  if (!vector.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new TypeError('vector elements must be finite numbers');
  }
  return vector.join(',');
}

/**
 * Deserializes vector text back into a numeric array.
 *
 * @param {string} vectorText Serialized vector string.
 * @returns {number[]} Numeric vector array.
 */
function deserializeVector(vectorText) {
  if (typeof vectorText !== 'string' || vectorText.length === 0) {
    throw new TypeError('vectorText must be a non-empty string');
  }
  const parts = vectorText.split(',');
  if (parts.some((p) => p.trim() === '' || Number.isNaN(Number(p)))) {
    throw new TypeError('vectorText contains malformed segments');
  }
  return parts.map((p) => Number(p));
}

/**
 * Maps a database row of `embeddings_chunk` to the domain `ChunkEmbeddingRow`
 * shape (docs/spec/server/store/embeddingsChunkStore.md §2.2).
 *
 * @param {Object} row Raw DB row (snake_case columns).
 * @returns {Object} Domain row (camelCase fields, vector as number[]).
 */
function mapChunkRow(row) {
  return {
    nodeId: Number(row.node_id),
    chunkIdx: Number(row.chunk_idx),
    modelId: Number(row.model_id),
    vector: deserializeVector(row.vector),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

module.exports = { mapEmbeddingsRow, mapChunkRow, serializeVector, deserializeVector };
