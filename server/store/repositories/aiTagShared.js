'use strict';

/**
 * Shared row/vector shaping for the AiTagRepository dialect twins
 * (docs/spec/server/store/aiTagStore.md). The `vector` TEXT column uses the
 * pooled-embeddings canonical codec — comma-separated floats — parsed at the
 * repository boundary with `dim` read back from the float count (§2.3).
 */

const { toIsoString } = require('../../utils/sharedHelpers');

/** number[] | comma-string → TEXT (comma-separated floats). */
function serializeVector(vector) {
  let values;
  if (Array.isArray(vector)) values = vector;
  else if (typeof vector === 'string') {
    const trimmed = vector.trim();
    if (!trimmed) throw new TypeError('vector must not be empty');
    values = trimmed.split(',').map((part) => Number(part));
  } else {
    throw new TypeError('vector must be number[] or a comma-separated string');
  }
  if (values.length === 0) throw new TypeError('vector must have at least one float');
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('vector contains non-finite floats');
  }
  return values.map((value) => Number(value)).join(',');
}

/** TEXT → number[] (invalid payloads raise, never silently degrade). */
function parseVector(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new TypeError(`malformed tag vector TEXT: ${String(raw).slice(0, 32)}`);
  }
  const values = raw.split(',').map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('tag vector TEXT contains non-numeric floats');
  }
  return values;
}

function mapEmbeddingRow(row) {
  const vector = parseVector(row.vector);
  return {
    tag: String(row.tag),
    modelId: Number(row.model_id),
    dim: vector.length,
    vector,
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapParentRow(row) {
  return {
    child: String(row.child),
    parent: String(row.parent),
    source: String(row.source),
    createdAt: toIsoString(row.created_at),
  };
}

/** Dedup + drop empty/non-string entries; deterministic order. */
function normalizeTagSet(tags) {
  const set = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag !== 'string') continue;
    const trimmed = tag.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort();
}

module.exports = { serializeVector, parseVector, mapEmbeddingRow, mapParentRow, normalizeTagSet };
