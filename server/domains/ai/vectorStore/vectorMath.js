'use strict';

// vectorMath — pure shared vector operations and the canonical TEXT codec
// for `embeddings.vector` / `embeddings_chunk.vector`
// (docs/spec/server/infrastructure/vectorMath.md §2).
//
// Every function is pure and deterministic: same inputs ⇒ identical outputs,
// no side effects, no I/O, no Date.now()/Math.random(). Accumulation order is
// fixed (left-to-right) so engines graded by the exact≡oracle conformance
// harness reproduce bit-identical scores.

function codeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function dimMismatch() {
  return codeError('dimMismatch', 'vector dimension mismatch');
}

/**
 * Canonical TEXT form: elements joined by `,` via JS number stringification
 * (shortest exact round-trip for doubles; embeddingsStore.md §2.2).
 */
function serializeVector(vec) {
  return vec.join(',');
}

/**
 * Parse canonical TEXT back to floats. Throws `dimMismatch` when the element
 * count ≠ dim and `invalidVector` on any non-finite element.
 */
function parseVector(text, dim) {
  const parts = String(text).split(',');
  if (parts.length !== dim) throw dimMismatch();
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    const v = Number(parts[i]);
    if (!Number.isFinite(v)) throw codeError('invalidVector', 'non-finite vector element');
    out[i] = v;
  }
  return out;
}

/**
 * Dot product, accumulated left-to-right (bit-parity anchor).
 */
function dotProduct(a, b) {
  if (a.length !== b.length) throw dimMismatch();
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Euclidean norm sqrt(Σ vᵢ²); empty vector ⇒ 0. */
function l2Norm(vec) {
  return Math.sqrt(dotProduct(vec, vec));
}

/**
 * Cosine similarity; a zero-norm operand yields 0 (no direction).
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw dimMismatch();
  const na = l2Norm(a);
  const nb = l2Norm(b);
  if (na === 0 || nb === 0) return 0;
  return dotProduct(a, b) / (na * nb);
}

/**
 * Scale to unit L2 norm. A zero-norm vector returns the zero vector unchanged
 * (no division by zero).
 */
function unitNormalize(vec) {
  const n = l2Norm(vec);
  if (n === 0) return vec.slice();
  return vec.map((v) => v / n);
}

/**
 * Element-wise mean of the rows, then unit normalization — the pooled-row
 * rule (mean + renormalize, collections-platform.md §4.3). Throws
 * `emptyVectors` on an empty set.
 */
function meanPool(vecs) {
  if (vecs.length === 0) throw codeError('emptyVectors', 'no vectors to pool');
  const dim = vecs[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vecs) {
    if (v.length !== dim) throw dimMismatch();
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= vecs.length;
  return unitNormalize(mean);
}

/**
 * MRL truncation: slice to the first `dim` elements, then re-normalize —
 * slicing breaks unit length, so renormalization is mandatory
 * (vectorStore.md §2.6). Throws `dimMismatch` when `dim` ≥ the source length.
 */
function truncateAndRenormalize(vec, dim) {
  if (dim >= vec.length) throw dimMismatch();
  return unitNormalize(vec.slice(0, dim));
}

module.exports = {
  serializeVector,
  parseVector,
  dotProduct,
  l2Norm,
  cosineSimilarity,
  unitNormalize,
  meanPool,
  truncateAndRenormalize,
};
