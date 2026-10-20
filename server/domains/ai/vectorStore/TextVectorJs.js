'use strict';

// TextVectorJs — the JsFallback engine of the vectorStore seam
// (vectorStore.md §2.3) and the exact-computation oracle for the
// conformance gate (§2.6; vectorMath.md §3).
//
// Persistence is INJECTED: the engine holds no store imports, so it is
// unit-testable against in-memory doubles and the seam factory wires the
// real embeddingsStore/embeddingsChunkStore/fileNodesStore paths later.
// No resident state across calls: every neighbors/allVectors call re-loads
// canonical TEXT rows through the loader.

const { parseVector, serializeVector, cosineSimilarity } = require('./vectorMath');

function createTextVectorJs({ modelId, loadRows, upsertPooled, replaceChunks, transaction }) {
  if (!modelId) throw new Error('TextVectorJs requires a bound modelId (space key)');
  if (typeof loadRows !== 'function') throw new Error('TextVectorJs requires loadRows');

  /**
   * Parsed pooled + chunk rows for the bound model. `userScope: null` =
   * provider-global; ACL scoping rides the loader (vectorStore.md §2.2).
   */
  async function allVectors(userScope) {
    const rows = await loadRows(modelId, userScope ?? null);
    return rows.map((row) => ({
      nodeId: row.nodeId,
      chunkIdx: row.chunkIdx,
      dim: row.dim,
      vector: parseVector(row.vector, row.dim),
    }));
  }

  function isVisible(nodeId, candidates) {
    if (!candidates) return true;
    if (candidates instanceof Set) return candidates.has(nodeId);
    return Boolean(candidates(nodeId));
  }

  /**
   * Per-node max-over-chunks cosine; node ids deduped BEFORE k is cut;
   * order score desc, then node_id asc; rows of a mismatched dim never score.
   */
  async function neighbors(queryVec, k, candidates) {
    const rows = await loadRows(modelId, null);
    const byNode = new Map();
    for (const row of rows) {
      if (!isVisible(row.nodeId, candidates)) continue;
      if (row.dim !== queryVec.length) continue; // space-key discipline
      const c = cosineSimilarity(queryVec, parseVector(row.vector, row.dim));
      const cur = byNode.get(row.nodeId);
      if (cur === undefined || c > cur) byNode.set(row.nodeId, c);
    }
    const scored = [...byNode].map(([nodeId, score]) => ({ nodeId, score }));
    scored.sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    return scored.slice(0, k);
  }

  /**
   * Pooled half = vecs[0], chunk half = vecs.slice(1) (chunkIdx dense from
   * 0), both inside ONE injected transaction (vectorStore.md §2.2). A
   * pooled-only call deletes prior chunk rows via replace-with-empty.
   */
  async function upsert(nodeId, vecs, dim) {
    if (!Array.isArray(vecs) || vecs.length === 0) {
      throw new Error('upsert requires at least the pooled vector');
    }
    const [pooled, ...chunks] = vecs;
    await transaction(async () => {
      await upsertPooled({ nodeId, modelId, dim, vector: serializeVector(pooled) });
      await replaceChunks(
        nodeId,
        chunks.map((v) => serializeVector(v))
      );
    });
  }

  // The JsFallback has no derived artifact (vectorStore.md §2.4); present so
  // the seam contract is uniform across engines.
  async function rebuildShadow() {}

  return { allVectors, neighbors, upsert, rebuildShadow };
}

module.exports = { createTextVectorJs };
