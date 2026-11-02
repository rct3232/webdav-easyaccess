'use strict';

/**
 * mergeArbiter — the `merge-arbiter` chat role behind evolution Pass 5
 * (docs/spec/server/services/evolutionService.md §2.8; AI_FEATURE_PLAN §4.19).
 *
 * Adjudicates the 0.55–0.7 Jaccard review band: the chat model decides between
 * "same theme twice" (merge), genuinely separate themes (keep_separate) and
 * theme+subset/sibling families (sibling) — the distinction set math is
 * structurally blind to. It ADVISES, never acts: verdicts are persisted on the
 * suggestion row as the §4.4 card's prefilled recommendation; only the user
 * presses Merge.
 *
 * The prompt INPUT FORMAT is load-bearing (E7 PoC, measured all-merge bias):
 * every side carries its unique-member count/ratio AND samples from its own
 * unique set — feeding only the shared sample + overlap ratio makes every
 * pair look "nearly identical". Aggregates/derived features only, never raw
 * file bytes (§4.19 common invariants).
 *
 * Budget posture: ONE batched structured multi-output chat call per user per
 * nightly run (cap 8 pairs, highest-Jaccard first — the remainder waits for
 * the next night), reasoning OFF. The call rides the llmAdapter `chat` role —
 * its daily caps and circuit breaker are inherited here by construction
 * (llmAdapter.md §2.5); any failure class resolves to zero verdicts and is
 * swallowed: a dark night is a no-op, never a failed pass.
 */

/** Closed contract vocabulary — no new chat vocabulary exists (§4.19). */
const MERGE_ARBITER_VERDICTS = ['merge', 'keep_separate', 'sibling'];
/** One batched call carries at most this many pairs (§2.8 product rule). */
const MERGE_ARBITER_MAX_PAIRS = 8;
/** Chat-output token budget for the single structured multi-output call. */
const MERGE_ARBITER_MAX_TOKENS = 512;
/** The persisted `arbiter_reason` is one capped line (§2.8). */
const MERGE_ARBITER_REASON_MAX_CHARS = 200;

/** Collapse to a single trimmed line; cap at the reason limit. */
function cleanReason(value) {
  if (typeof value !== 'string') return null;
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return null;
  return oneLine.slice(0, MERGE_ARBITER_REASON_MAX_CHARS);
}

/** System prompt: role, the symmetric-difference mandate, the closed shape. */
function buildArbiterSystemPrompt() {
  return [
    'You are the merge arbiter of a personal file collections app (role: merge-arbiter).',
    'For each pair of collections decide whether they are the same theme twice or genuinely distinct.',
    'Reply with JSON only: {"decisions":[{"pair_id":<int>,"verdict":"merge|keep_separate|sibling","reason":"<one short line>"}]}.',
    'Verdict meanings (closed vocabulary — nothing else is valid):',
    '- "merge": same theme duplicated; the collections should become one.',
    '- "keep_separate": near-equal sets but genuinely different themes.',
    '- "sibling": theme + subset or sibling themes (a hierarchy question, not a merge).',
    'One decision per pair_id; judge only from the provided aggregates.',
    'Weigh the SYMMETRIC DIFFERENCE: each side lists its unique-member count/ratio and samples',
    'only that side holds — do not treat a pair as identical from the shared sample alone.',
    'You only advise; a human decides. Never suggest an action beyond the verdict.',
  ].join('\n');
}

/** Serialize one collection side for the prompt (snake_case payload). */
function buildSideBlock(side) {
  return {
    collection_id: Number(side.collectionId),
    name: String(side.name ?? ''),
    size: Number(side.size ?? 0),
    top_tags: Array.isArray(side.topTags) ? side.topTags : [],
    unique_count: Number(side.uniqueCount ?? 0),
    unique_ratio: Number(side.uniqueRatio ?? 0),
    member_summaries: Array.isArray(side.memberSummaries) ? side.memberSummaries : [],
    unique_samples: Array.isArray(side.uniqueSamples) ? side.uniqueSamples : [],
  };
}

/**
 * Build the two-message chat payload: one user message carrying the batched
 * pair inputs (pair_id = index in the submitted array, ordering owned by the
 * caller — highest Jaccard first).
 */
function buildArbiterMessages(pairs) {
  const payload = {
    pairs: (Array.isArray(pairs) ? pairs : []).slice(0, MERGE_ARBITER_MAX_PAIRS).map((p, i) => ({
      pair_id: i,
      jaccard: Number(p.jaccard ?? 0),
      intersection_count: Number(p.intersectionCount ?? 0),
      a: buildSideBlock(p.a),
      b: buildSideBlock(p.b),
    })),
  };
  return [
    { role: 'system', content: buildArbiterSystemPrompt() },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

/** Schema-forced output shape (strict closed decision objects). */
function buildArbiterSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decisions'],
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pair_id', 'verdict', 'reason'],
          properties: {
            pair_id: { type: 'integer' },
            verdict: { type: 'string', enum: MERGE_ARBITER_VERDICTS },
            reason: { type: ['string', 'null'] },
          },
        },
      },
    },
  };
}

/** Normalize the several chat-client return shapes to one JSON object (or null). */
function parseJsonLenient(result) {
  if (result && result.json && typeof result.json === 'object' && !Array.isArray(result.json)) {
    return result.json;
  }
  if (result && typeof result.text === 'string') {
    try {
      const parsed = JSON.parse(result.text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate the batched output against the submitted pairs. Off-contract
 * verdict strings, foreign pair ids and malformed decisions are DROPPED — the
 * closed vocabulary is enforced at the service boundary, never trusted from
 * the provider.
 * @returns {Map<string, {verdict: string, reason: string|null}>} pairKey → verdict
 */
function validateArbiterOutput(json, pairs) {
  const verdicts = new Map();
  if (!json || typeof json !== 'object' || !Array.isArray(json.decisions)) return verdicts;
  const byPairId = new Map(
    (Array.isArray(pairs) ? pairs : [])
      .slice(0, MERGE_ARBITER_MAX_PAIRS)
      .map((p, i) => [i, p.pairKey])
  );
  for (const decision of json.decisions) {
    if (!decision || typeof decision !== 'object') continue;
    const pairKey = byPairId.get(decision.pair_id);
    if (pairKey === undefined) continue;
    if (!MERGE_ARBITER_VERDICTS.includes(decision.verdict)) continue;
    verdicts.set(pairKey, {
      verdict: decision.verdict,
      reason: cleanReason(decision.reason),
    });
  }
  return verdicts;
}

/**
 * Arbiter factory. IO goes through the injected adapter seam ONLY (R3
 * posture): `adapter.chat(messages, opts)` rides the llmAdapter chat role —
 * budgets, breaker, usage accounting all inherited. `arbitrate()` NEVER
 * throws: every failure path (provider error incl. budget/breaker classes,
 * non-JSON output) resolves `{ verdicts: Map(), calls }` with the call count
 * honest (a call attempted and failed still counts).
 *
 * @param {Object} deps
 * @param {Object|null} deps.adapter llmAdapter (chat role)
 * @param {Object} [deps.log]
 */
function createMergeArbiter({ adapter, log } = {}) {
  const logger = log || { warn: console.warn.bind(console) };

  return {
    /**
     * One batched chat call MAX. `pairs` arrive caller-sorted (highest
     * Jaccard first); anything beyond the cap waits for the next nightly run.
     * @returns {Promise<{verdicts: Map, calls: number}>}
     */
    async arbitrate(pairs) {
      const batch = (Array.isArray(pairs) ? pairs : []).slice(0, MERGE_ARBITER_MAX_PAIRS);
      if (batch.length === 0) return { verdicts: new Map(), calls: 0 };
      if (!adapter || typeof adapter.chat !== 'function') return { verdicts: new Map(), calls: 0 };

      let result;
      try {
        result = await adapter.chat(buildArbiterMessages(batch), {
          schema: buildArbiterSchema(),
          maxTokens: MERGE_ARBITER_MAX_TOKENS,
          reasoning: false,
        });
      } catch (err) {
        logger.warn(`[mergeArbiter] chat call failed: ${err?.message ?? err}`);
        return { verdicts: new Map(), calls: 1 };
      }
      const calls = 1;
      return { verdicts: validateArbiterOutput(parseJsonLenient(result), batch), calls };
    },
  };
}

module.exports = {
  MERGE_ARBITER_VERDICTS,
  MERGE_ARBITER_MAX_PAIRS,
  MERGE_ARBITER_MAX_TOKENS,
  MERGE_ARBITER_REASON_MAX_CHARS,
  cleanReason,
  buildArbiterMessages,
  buildArbiterSchema,
  validateArbiterOutput,
  createMergeArbiter,
};
