'use strict';

/**
 * keeperScore — the §4.17 near-dup keeper quality composite v1
 * (docs/spec/server/services/dashboardService.md §2.5.1).
 *
 * PURE module: every input (members, activity rows, enrichment probes,
 * nearDupFinder pairScores, clock) is passed in; no IO, no clock reads, no
 * persistence. The dashboard service loads the inputs in ONE batched read per
 * source and calls `computeGroupKeeper` per group.
 *
 * Factors (min-max normalized WITHIN the group; all-equal ⇒ 0.5):
 *   activity   0.45 — node_activity.score (30d half-life) decayed by last-seen
 *                     recency; 30d unopened is a 0.25 PENALTY, never an
 *                     exclusion (last_seen NULL counts as unopened).
 *   quality    0.30 — image/video with an enrichment probe width×height ⇒
 *                     log1p(width*height); media without a probe ⇒
 *                     log1p(size) fallback; documents are neutral 0.5 and
 *                     stay outside the media min-max range. Lossless formats
 *                     add +0.05 after normalization (clamped at 1).
 *   name       0.15 — originality penalty for copy/(1)/edited/export/
 *                     compressed/small/thumb/preview/screenshot/temp/~$
 *                     markers, clamped 0.1..1.
 *   centrality 0.10 — mean cosine to every OTHER group member (nearDupFinder
 *                     pairScores), normalized within the group.
 *
 * Keeper = highest composite; a composite tie falls back to the smallest node
 * id. The additive `reason.keep` block exposes the decision without raw
 * activity counts or timestamps.
 */

const DAY_MS = 86400000;

const WEIGHTS = Object.freeze({
  activity: 0.45,
  quality: 0.3,
  name: 0.15,
  centrality: 0.1,
});

const UNOPENED_DAYS = 30;
const UNOPENED_MULTIPLIER = 0.25;
const ACTIVITY_HALF_LIFE_DAYS = 30;

const NEUTRAL = 0.5;
const LOSSLESS_BONUS = 0.05;
const NAME_PENALTY_PER_MARKER = 0.2;
const NAME_MIN = 0.1;

const MEDIA_MIME = /^(image|video)\//i;
const LOSSLESS_MIME = new Set([
  'image/png',
  'image/tiff',
  'image/bmp',
  'image/x-ms-bmp',
  'audio/flac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
]);

const NAME_MARKERS = Object.freeze([
  /\bcopy\b/i,
  /\(1\)/,
  /\bedited\b/i,
  /\bexport(?:ed)?\b/i,
  /\bcompressed\b/i,
  /\bsmall\b/i,
  /\bthumb(?:nail)?\b/i,
  /\bpreview\b/i,
  /screenshot|screen[ _-]?shot/i,
  /^(?:temp|tmp)[._-]|(?:^|[._\s-])(?:temp|tmp)(?:[._\s-]|$)/i,
  /^~\$/,
]);

const FACTOR_KEYS = Object.freeze(['activity', 'quality', 'name', 'centrality']);
const BASIS_LABELS = Object.freeze(['activity', 'resolution', 'size', 'name', 'centrality']);
const CONFIDENCE_EDGES = Object.freeze({ high: 0.1, medium: 0.03 });
const MIXED_TOLERANCE = 0.005;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function basename(name) {
  const segments = String(name || '')
    .split(/[/\\]/)
    .filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : String(name || '');
}

function lookup(container, nodeId) {
  if (!container) return null;
  if (container instanceof Map) return container.get(Number(nodeId)) ?? null;
  return container[Number(nodeId)] ?? container[String(nodeId)] ?? null;
}

function isMediaMime(mimeType) {
  return MEDIA_MIME.test(String(mimeType || ''));
}

function probePixels(probe) {
  const width = Number(probe?.width);
  const height = Number(probe?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width * height;
}

/** min-max over the provided values; an all-equal set is neutral (0.5). */
function normalizeValues(values) {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!(max > min)) return values.map(() => NEUTRAL);
  return values.map((value) => (value - min) / (max - min));
}

function activityRaw(row, nowMs) {
  const score = Number(row?.score);
  const lastSeenAtMs = Number(row?.lastSeenAtMs);
  const hasLastSeen = Number.isFinite(lastSeenAtMs);
  const ageMs = hasLastSeen ? Math.max(0, nowMs - lastSeenAtMs) : null;
  const unopened = !hasLastSeen || ageMs > UNOPENED_DAYS * DAY_MS;
  const decay = hasLastSeen ? Math.pow(2, -ageMs / DAY_MS / ACTIVITY_HALF_LIFE_DAYS) : 1;
  let raw = (Number.isFinite(score) ? Math.max(0, score) : 0) * decay;
  if (unopened) raw *= UNOPENED_MULTIPLIER;
  return { raw, unopened };
}

function nameRaw(name) {
  const base = basename(name);
  let markers = 0;
  for (const pattern of NAME_MARKERS) {
    if (pattern.test(base)) markers += 1;
  }
  return clamp(1 - NAME_PENALTY_PER_MARKER * markers, NAME_MIN, 1);
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function centralityRaw(nodeId, memberIds, pairScoreMap) {
  if (memberIds.length < 2) return 0;
  let total = 0;
  for (const other of memberIds) {
    if (other === nodeId) continue;
    total += pairScoreMap.get(pairKey(nodeId, other)) || 0;
  }
  return total / (memberIds.length - 1);
}

function normalizePairScores(pairScores) {
  const map = new Map();
  for (const pair of Array.isArray(pairScores) ? pairScores : []) {
    const nodeA = Number(pair?.nodeA ?? pair?.a);
    const nodeB = Number(pair?.nodeB ?? pair?.b);
    const score = Number(pair?.score);
    if (!Number.isInteger(nodeA) || !Number.isInteger(nodeB) || !Number.isFinite(score)) continue;
    if (nodeA === nodeB) continue;
    map.set(pairKey(nodeA, nodeB), score);
  }
  return map;
}

/**
 * Pick the keeper of ONE near-dup group.
 *
 * @param {Object} input
 * @param {Array<{ nodeId:number, name:string, sizeBytes:number|null, mimeType:string|null }>} input.members
 * @param {Map<number,{score:number,lastSeenAtMs:number|null}>|Object} [input.activityByNode]
 * @param {Map<number,{width:number,height:number}>|Object} [input.probeByNode]
 * @param {Array<{nodeA:number,nodeB:number,score:number}>} [input.pairScores]
 * @param {number} [input.nowMs]
 * @returns {{ keeperNodeId:number, keep:Object }}
 */
function computeGroupKeeper({
  members = [],
  activityByNode = null,
  probeByNode = null,
  pairScores = [],
  nowMs = Date.now(),
} = {}) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new TypeError('computeGroupKeeper requires at least one member');
  }
  const clock = Number(nowMs);
  const ids = members.map((member) => Number(member.nodeId));
  const pairScoreMap = normalizePairScores(pairScores);

  const activityEntries = members.map((member) =>
    activityRaw(lookup(activityByNode, member.nodeId), clock)
  );
  const activityNorm = normalizeValues(activityEntries.map((entry) => entry.raw));

  const media = members.map((member) => isMediaMime(member.mimeType));
  const qualitySources = members.map((member, index) => {
    if (!media[index]) return null;
    const pixels = probePixels(lookup(probeByNode, member.nodeId));
    if (pixels !== null) return { raw: Math.log1p(pixels), basis: 'resolution' };
    const size = Number(member.sizeBytes);
    return { raw: Math.log1p(Number.isFinite(size) && size > 0 ? size : 0), basis: 'size' };
  });
  const mediaIndexes = qualitySources
    .map((source, index) => (source ? index : -1))
    .filter((i) => i >= 0);
  const mediaNorm = normalizeValues(mediaIndexes.map((index) => qualitySources[index].raw));
  const qualityNorm = members.map(() => NEUTRAL);
  mediaIndexes.forEach((memberIndex, position) => {
    const lossless = LOSSLESS_MIME.has(String(members[memberIndex].mimeType || '').toLowerCase());
    qualityNorm[memberIndex] = clamp(mediaNorm[position] + (lossless ? LOSSLESS_BONUS : 0), 0, 1);
  });

  const nameNorm = normalizeValues(members.map((member) => nameRaw(member.name)));
  const centralityNorm = normalizeValues(
    members.map((member) => centralityRaw(Number(member.nodeId), ids, pairScoreMap))
  );

  const factorByNode = {
    activity: activityNorm,
    quality: qualityNorm,
    name: nameNorm,
    centrality: centralityNorm,
  };

  const composites = members.map(
    (_member, index) =>
      WEIGHTS.activity * factorByNode.activity[index] +
      WEIGHTS.quality * factorByNode.quality[index] +
      WEIGHTS.name * factorByNode.name[index] +
      WEIGHTS.centrality * factorByNode.centrality[index]
  );

  const order = members
    .map((_member, index) => index)
    .sort((left, right) => composites[right] - composites[left] || ids[left] - ids[right]);
  const keeperIndex = order[0];
  const runnerUpComposite = order.length > 1 ? composites[order[1]] : 0;
  const keeperComposite = composites[keeperIndex];
  const keeperNodeId = ids[keeperIndex];
  const keeperMember = members[keeperIndex];

  const factors = {};
  for (const key of FACTOR_KEYS) {
    factors[key] = round3(factorByNode[key][keeperIndex]);
  }

  const meanByFactor = {};
  for (const key of FACTOR_KEYS) {
    meanByFactor[key] =
      factorByNode[key].reduce((total, value) => total + value, 0) / factorByNode[key].length;
  }

  const edges = [];
  for (const key of ['activity', 'name', 'centrality']) {
    const edge = WEIGHTS[key] * (factorByNode[key][keeperIndex] - meanByFactor[key]);
    if (edge > 1e-9) edges.push({ factor: key, edge });
  }
  const qualitySource = qualitySources[keeperIndex];
  if (qualitySource) {
    const edge = WEIGHTS.quality * (factorByNode.quality[keeperIndex] - meanByFactor.quality);
    if (edge > 1e-9) edges.push({ factor: qualitySource.basis, edge });
  }
  edges.sort((left, right) => right.edge - left.edge);

  let basis = 'none';
  if (edges.length > 0) {
    basis =
      edges.length > 1 && edges[0].edge - edges[1].edge <= MIXED_TOLERANCE
        ? 'mixed'
        : edges[0].factor;
  }
  if (!BASIS_LABELS.includes(basis) && basis !== 'mixed' && basis !== 'none') basis = 'none';

  const margin = keeperComposite - runnerUpComposite;
  let confidence = 'low';
  if (basis !== 'none') {
    if (margin >= CONFIDENCE_EDGES.high) confidence = 'high';
    else if (margin >= CONFIDENCE_EDGES.medium) confidence = 'medium';
  }

  return {
    keeperNodeId,
    keep: {
      name: basename(keeperMember.name),
      relative_score: round3(keeperComposite),
      confidence,
      basis,
      factors,
      unopened_30d: Boolean(activityEntries[keeperIndex].unopened),
      score_version: 'v1',
    },
  };
}

module.exports = {
  WEIGHTS,
  UNOPENED_DAYS,
  UNOPENED_MULTIPLIER,
  NEUTRAL,
  LOSSLESS_BONUS,
  NAME_PENALTY_PER_MARKER,
  NAME_MIN,
  computeGroupKeeper,
};
