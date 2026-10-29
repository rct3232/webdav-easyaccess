'use strict';

/**
 * nlParser — the `parse.nl` leg behind the search service
 * (docs/spec/server/services/searchService.md §2.8; wire contract:
 * docs/spec/server/routes/search.md §2.4).
 *
 * The only request-path CHAT role: the utterance (plus optional session
 * predicate state) is parsed into the CLOSED shared predicate grammar —
 * atom types and validation are IMPORTED from the collections definition
 * engine (`definitionEngine.js`, collectionsService.md §2.3), never forked.
 * Output is schema-forced where the provider supports it and
 * grammar-validated here in every case; anything that does not pass the
 * closed grammar is an unconstrained parse and the leg falls back SILENTLY
 * to the parser-free vector+name search — never an error to the user.
 *
 * The parsed predicate set rides the `query_parses` cache (the
 * `predicates` column, queryParsesStore.md §2.3) alongside the vector
 * envelope: same normalized-query key, one row, two caches, cache hit ⇒
 * ZERO chat calls. The cached value is the parse envelope
 * `{ grammar: 'nl1', atoms, vectorQuery }`; a stateless submit reads and
 * writes it, a state-carrying submit runs live and touches neither (the
 * row key is the query text alone).
 *
 * Input invariant (§2.8): the prompt carries the closed grammar, the
 * utterance and field/value predicate symbols ONLY — never tag
 * vocabularies, result content, node ids or permission data; hallucinated
 * symbol values resolve server-side and match nothing (safe-by-construction).
 */

const { ATOM_TYPES, parseDefinition } = require('../collections/definitionEngine');

/** Parse-envelope shape key (forward-discriminates future delta semantics). */
const PARSE_ENVELOPE_GRAMMAR = 'nl1';
/** Chat-output token budget for the single structured multi-output call. */
const PARSE_MAX_TOKENS = 512;
/** Refined vector-query text cap — the request query cap (searchService.md §2.3 step 1). */
const VECTOR_QUERY_MAX_LENGTH = 200;
/** Closed-grammar cardinalities (field cardinals are fixed in the grammar up-front). */
const MAX_ATOM_COUNTS = { path: 1, tag: 3, like: 1, date: 1, size: 1 };
/** §2.9 delta member vocabulary (closed object; snake_case chat wire + camelCase cache envelope). */
const DELTA_MEMBERS = [
  'add',
  'replace',
  'exclude',
  'exclude_similar',
  'excludeSimilar',
  '$ref',
  'ref',
];

/**
 * Step-1 normalizer (NFKC, ASCII-case fold, whitespace collapse) — the single
 * implementation shared by the query key and the refined vector-query text.
 */
function normalizeQueryText(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function withinCardinalities(atoms) {
  const counts = {};
  for (const atom of atoms) {
    counts[atom.type] = (counts[atom.type] || 0) + 1;
    if (counts[atom.type] > MAX_ATOM_COUNTS[atom.type]) return false;
  }
  return true;
}

/**
 * Canonicalize ONE delta atom list through the shared definition engine.
 * @returns {Array|null} null = grammar/cardinality violation
 */
function canonicalizeDeltaList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  try {
    const parsed = parseDefinition({ kind: 'predicate', all_of: value });
    if (!withinCardinalities(parsed.allOf)) return null;
    return parsed.allOf;
  } catch {
    return null;
  }
}

/**
 * §2.9 delta validation: closed object, canonical atom lists, boolean
 * `exclude_similar`, and `$ref` limited to the literal `"latest"` (the LLM
 * never supplies a real reference). `null` is treated as absent.
 * @returns {{ add: Array, replace: Array, exclude: Array, excludeSimilar: boolean, ref: string|null }|null}
 */
function validateDelta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!DELTA_MEMBERS.includes(key)) return null;
  }
  const add = canonicalizeDeltaList(raw.add);
  const replace = canonicalizeDeltaList(raw.replace);
  const exclude = canonicalizeDeltaList(raw.exclude);
  if (!add || !replace || !exclude) return null;
  const rawExcludeSimilar = Object.prototype.hasOwnProperty.call(raw, 'excludeSimilar')
    ? raw.excludeSimilar
    : raw.exclude_similar;
  let excludeSimilar = false;
  if (rawExcludeSimilar !== undefined) {
    if (typeof rawExcludeSimilar !== 'boolean') return null;
    excludeSimilar = rawExcludeSimilar;
  }
  const rawRef = Object.prototype.hasOwnProperty.call(raw, 'ref') ? raw.ref : raw.$ref;
  let ref = null;
  if (rawRef !== undefined && rawRef !== null) {
    if (rawRef !== 'latest') return null;
    ref = 'latest';
  }
  return { add, replace, exclude, excludeSimilar, ref };
}

/**
 * Validate one chat-parse output against the closed shared grammar.
 * @returns {{ atoms: Array, vectorQuery: string|null, delta?: Object } | null} null = unconstrained
 */
function validateParseOutput(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (!Array.isArray(json.predicates)) return null;
  let parsed;
  try {
    // Shared grammar validation: the definition engine's normalized output IS
    // the canonical atom list; a throw is a grammar violation.
    parsed = parseDefinition({ kind: 'predicate', all_of: json.predicates });
  } catch {
    return null;
  }
  const atoms = parsed.allOf;
  if (!withinCardinalities(atoms)) return null;
  let vectorQuery = null;
  if (typeof json.vector_query === 'string') {
    const text = normalizeQueryText(json.vector_query);
    if (text.length > 0 && text.length <= VECTOR_QUERY_MAX_LENGTH) vectorQuery = text;
  }
  let delta;
  if (json.delta !== undefined && json.delta !== null) {
    delta = validateDelta(json.delta);
    if (!delta) return null;
  }
  return { atoms, vectorQuery, ...(delta ? { delta } : {}) };
}

/**
 * Canonicalize the request-side session predicate state (§2.2). Malformed or
 * grammar-violating state is DISCARDED as a whole (never a 4xx, never partial)
 * and the parse runs stateless.
 */
function validateSessionState(value) {
  if (!Array.isArray(value)) return [];
  const validated = validateParseOutput({ predicates: value });
  return validated ? validated.atoms : [];
}

/** System prompt: the CLOSED grammar — enumerated fields + operator params + cardinalities. */
function buildGrammarPrompt() {
  return [
    'You are the NL query parser of a personal file search (role: parse.nl).',
    'Convert the search sentence into the CLOSED predicate grammar below and reply with JSON only.',
    'Allowed atom types (everything else is invalid; atoms are ANDed together):',
    '- {"type":"path","value":"<folder path prefix>"} - at most 1',
    '- {"type":"tag","value":"<descriptive word>"} - at most 3; tags are the user\'s local derived facets, invent no vocabulary',
    '- {"type":"like"} - at most 1 (liked files)',
    '- {"type":"date","withinDays":<int>} or {"type":"date","after":"<ISO date>","before":"<ISO date>"} - at most 1',
    '- {"type":"size","min":<bytes>,"max":<bytes>} - at most 1',
    'Conversational delta (optional, for follow-ups on an existing result set):',
    '- "delta":{"add":[<atom>]} appends a new field constraint;',
    '- "delta":{"replace":[<atom>]} corrects an existing same-field slot;',
    '- "delta":{"exclude":[<atom>]} subtracts matching rows (exclusion is a separate subtraction list, never a new atom type);',
    '- "delta":{"exclude_similar":true} asks to drop near-duplicate results;',
    '- "delta":{"$ref":"latest"} means "of those / those photos / this one"; $ref may ONLY be the literal "latest" - never a real reference string.',
    'Reply shape: {"predicates":[<atoms>],"vector_query":"<optional refined semantic text or null>","delta":<optional delta object>}.',
    'Never include file names, ids, scores or permission data; predicate values are matched server-side.',
  ].join('\n');
}

/**
 * Build the two-message chat payload: grammar + utterance (+ field/value
 * session symbols when present).
 */
function buildParseMessages({ normalizedQuery, sessionAtoms = [] } = {}) {
  let content = String(normalizedQuery ?? '');
  if (Array.isArray(sessionAtoms) && sessionAtoms.length > 0) {
    content += `\nSession predicate state (existing field/value symbols to refine): ${JSON.stringify(
      sessionAtoms
    )}`;
  }
  return [
    { role: 'system', content: buildGrammarPrompt() },
    { role: 'user', content },
  ];
}

/** One closed shared-grammar atom schema (reused by predicates + delta lists). */
function buildAtomSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'value', 'withinDays', 'after', 'before', 'min', 'max'],
    properties: {
      type: { type: 'string', enum: ATOM_TYPES },
      value: { type: ['string', 'null'] },
      withinDays: { type: ['integer', 'null'] },
      after: { type: ['string', 'null'] },
      before: { type: ['string', 'null'] },
      min: { type: ['number', 'null'] },
      max: { type: ['number', 'null'] },
    },
  };
}

/** Schema-forced output shape (strict: closed objects, nullable optional fields). */
function buildParseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['predicates', 'vector_query'],
    properties: {
      predicates: {
        type: 'array',
        items: buildAtomSchema(),
      },
      vector_query: { type: ['string', 'null'] },
      delta: {
        type: 'object',
        additionalProperties: false,
        properties: {
          add: { type: 'array', items: buildAtomSchema() },
          replace: { type: 'array', items: buildAtomSchema() },
          exclude: { type: 'array', items: buildAtomSchema() },
          exclude_similar: { type: 'boolean' },
          $ref: { type: 'string', enum: ['latest'] },
        },
      },
    },
  };
}

/** The cache value written to `query_parses.predicates` (queryParsesStore.md §2.3). */
function buildParseEnvelope(atoms, vectorQuery = null, delta = null) {
  return {
    grammar: PARSE_ENVELOPE_GRAMMAR,
    atoms: Array.isArray(atoms) ? atoms : [],
    vectorQuery: vectorQuery || null,
    ...(delta ? { delta } : {}),
  };
}

/**
 * Read a stored `predicates` value: a valid nl1 envelope re-validated through
 * the shared grammar on read. Anything else — the `[]` embed-row default, a
 * foreign grammar, a tampered envelope — is a cache MISS (null).
 */
function readParseEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.grammar !== PARSE_ENVELOPE_GRAMMAR) return null;
  if (!Array.isArray(value.atoms)) return null;
  const validated = validateParseOutput({
    predicates: value.atoms,
    vector_query: typeof value.vectorQuery === 'string' ? value.vectorQuery : null,
    ...(value.delta !== undefined ? { delta: value.delta } : {}),
  });
  if (!validated) return null;
  return {
    atoms: validated.atoms,
    vectorQuery: validated.vectorQuery || null,
    ...(validated.delta ? { delta: validated.delta } : {}),
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
 * Parser factory. IO goes through the injected seams only — `adapter`
 * (llmAdapter: `chat`) and `cache` (queryParsesStore: `get`/`recordPredicates`).
 * `parse()` NEVER throws: every failure path (provider error incl. budget/
 * breaker classes, non-JSON, schema/grammar violation) resolves null —
 * the caller's silent vector+name fallback.
 *
 * @param {Object} deps
 * @param {Object|null} deps.adapter
 * @param {Object|null} deps.cache
 * @param {Object} [deps.log]
 */
function createNlParser({ adapter, cache, log } = {}) {
  const logger = log || { warn: console.warn.bind(console) };

  async function readCache(normalizedQuery) {
    if (!cache || typeof cache.get !== 'function') return null;
    try {
      const row = await cache.get(normalizedQuery);
      return row ? readParseEnvelope(row.predicates) : null;
    } catch {
      // A failed cache READ is a MISS (§2.3 step 4 posture) — the parse proceeds live.
      return null;
    }
  }

  async function writeCache(normalizedQuery, validated) {
    if (!cache || typeof cache.recordPredicates !== 'function') return;
    try {
      await cache.recordPredicates({
        normalizedQuery,
        predicates: buildParseEnvelope(validated.atoms, validated.vectorQuery, validated.delta),
      });
    } catch {
      /* cache write is best-effort — never a correctness dependency */
    }
  }

  return {
    /**
     * One parse per submit, MAX. Returns `{ atoms, vectorQuery }` or null.
     * Session-state carries field/value symbols only (no vectors in state) —
     * a stateful submit neither reads nor writes the query-text-keyed cache.
     */
    async parse(normalizedQuery, { sessionAtoms = [] } = {}) {
      const stateful = Array.isArray(sessionAtoms) && sessionAtoms.length > 0;
      if (!stateful) {
        const cached = await readCache(normalizedQuery);
        if (cached) return cached;
      }
      if (!adapter || typeof adapter.chat !== 'function') return null;

      let result;
      try {
        result = await adapter.chat(buildParseMessages({ normalizedQuery, sessionAtoms }), {
          schema: buildParseSchema(),
          maxTokens: PARSE_MAX_TOKENS,
        });
      } catch (err) {
        logger.warn(`[nlParser] chat call failed: ${err?.message ?? err}`);
        return null;
      }

      const validated = validateParseOutput(parseJsonLenient(result));
      if (!validated) {
        // Unconstrained output: silent fallback, no cache write.
        return null;
      }
      if (!stateful) await writeCache(normalizedQuery, validated);
      return validated;
    },
  };
}

module.exports = {
  ATOM_TYPES,
  PARSE_ENVELOPE_GRAMMAR,
  PARSE_MAX_TOKENS,
  MAX_ATOM_COUNTS,
  DELTA_MEMBERS,
  normalizeQueryText,
  buildParseSchema,
  buildParseMessages,
  buildGrammarPrompt,
  validateDelta,
  validateParseOutput,
  validateSessionState,
  buildParseEnvelope,
  readParseEnvelope,
  createNlParser,
};
