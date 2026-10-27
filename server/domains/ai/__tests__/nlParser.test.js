'use strict';

/**
 * nlParser unit tests — the parse.nl leg contract (docs/spec/server/services/
 * searchService.md §2.8). Pure module: prompt builder, closed schema,
 * shared-grammar validation, parse-envelope cache-value rules. The chat call
 * itself rides the injected adapter seam (fake adapter — no provider, no E2E;
 * the parser E2E case rides the fake-LLM harness).
 */
const {
  ATOM_TYPES,
  PARSE_ENVELOPE_GRAMMAR,
  PARSE_MAX_TOKENS,
  buildParseSchema,
  buildParseMessages,
  validateParseOutput,
  validateSessionState,
  buildParseEnvelope,
  readParseEnvelope,
} = require('../nlParser');

describe('nlParser — shared grammar (imported, never forked)', () => {
  it('exposes the collections definition-engine ATOM_TYPES verbatim', () => {
    const { ATOM_TYPES: ENGINE_TYPES } = require('../../collections/definitionEngine');
    expect(ATOM_TYPES).toBe(ENGINE_TYPES);
    expect([...ATOM_TYPES].sort()).toEqual(['date', 'like', 'path', 'size', 'tag']);
  });

  it('normalizes atoms through the definition engine (path gains the canonical prefix)', () => {
    const result = validateParseOutput({
      predicates: [{ type: 'path', value: 'photos/2026' }, { type: 'like' }],
      vector_query: null,
    });
    expect(result).not.toBeNull();
    expect(result.atoms[0]).toMatchObject({
      type: 'path',
      value: 'photos/2026',
      prefix: '/photos/2026',
    });
    expect(result.atoms[1]).toEqual({ type: 'like' });
  });
});

describe('nlParser — closed grammar validation', () => {
  it('accepts each grammar type with its engine-canonical params', () => {
    const result = validateParseOutput({
      predicates: [
        { type: 'path', value: '/docs' },
        { type: 'tag', value: 'sunset' },
        { type: 'tag', value: 'beach' },
        { type: 'tag', value: 'summer' },
        { type: 'like' },
        { type: 'date', withinDays: 30 },
        { type: 'size', min: 1048576 },
      ],
      vector_query: 'sunset photos',
    });
    expect(result).not.toBeNull();
    expect(result.atoms).toHaveLength(7);
    expect(result.vectorQuery).toBe('sunset photos');
  });

  it('rejects unknown atom types (grammar violation ⇒ unconstrained)', () => {
    expect(validateParseOutput({ predicates: [{ type: 'mime', value: 'pdf' }] })).toBeNull();
  });

  it('rejects non-object output, missing/non-array predicates, and atom arrays holding scalars', () => {
    expect(validateParseOutput(null)).toBeNull();
    expect(validateParseOutput('not json')).toBeNull();
    expect(validateParseOutput({})).toBeNull();
    expect(validateParseOutput({ predicates: 'path=/x' })).toBeNull();
    expect(validateParseOutput({ predicates: ['pdf'] })).toBeNull();
  });

  it('enforces the closed cardinalities: path ≤1, tag ≤3, like/date/size ≤1', () => {
    expect(
      validateParseOutput({
        predicates: [
          { type: 'path', value: '/a' },
          { type: 'path', value: '/b' },
        ],
      })
    ).toBeNull();
    expect(
      validateParseOutput({
        predicates: [
          { type: 'tag', value: 'a' },
          { type: 'tag', value: 'b' },
          { type: 'tag', value: 'c' },
          { type: 'tag', value: 'd' },
        ],
      })
    ).toBeNull();
    expect(
      validateParseOutput({
        predicates: [{ type: 'like' }, { type: 'like' }],
      })
    ).toBeNull();
  });

  it('accepts a valid parse with ZERO atoms (empty predicate list is a real result, not a failure)', () => {
    const result = validateParseOutput({ predicates: [], vector_query: null });
    expect(result).toEqual({ atoms: [], vectorQuery: null });
  });

  it('normalizes vector_query and drops an over-long refinement while keeping the atoms', () => {
    const result = validateParseOutput({
      predicates: [{ type: 'tag', value: 'pdf' }],
      vector_query: '  A   ReFinED   Query  ',
    });
    expect(result.vectorQuery).toBe('a refined query');

    const tooLong = validateParseOutput({
      predicates: [{ type: 'tag', value: 'pdf' }],
      vector_query: 'x'.repeat(201),
    });
    expect(tooLong).toEqual({ atoms: [{ type: 'tag', value: 'pdf' }], vectorQuery: null });
  });
});

describe('nlParser — request-side session state (field/value symbols only)', () => {
  it('canonicalizes a grammar-valid state array', () => {
    const atoms = validateSessionState([{ type: 'path', value: 'downloads' }]);
    expect(atoms).toEqual([{ type: 'path', value: 'downloads', prefix: '/downloads' }]);
  });

  it('discards malformed or grammar-violating state silently (never throws)', () => {
    expect(validateSessionState(undefined)).toEqual([]);
    expect(validateSessionState('path=/x')).toEqual([]);
    expect(validateSessionState([{ type: 'mime', value: 'pdf' }])).toEqual([]);
  });

  it('canonicalizes state through the shared grammar — non-grammar keys (vectors!) are dropped', () => {
    // Field/value only is enforced BY CONSTRUCTION: the engine's canonical atom
    // carries no foreign keys, so a vector riding in a state atom never persists.
    expect(validateSessionState([{ type: 'path', value: '/x', v: [1, 2, 3] }])).toEqual([
      { type: 'path', value: '/x', prefix: '/x' },
    ]);
  });
});

describe('nlParser — prompt (closed grammar, symbols only)', () => {
  const messages = buildParseMessages({
    normalizedQuery: 'pdfs from last year over 10mb',
    sessionAtoms: [{ type: 'path', value: '/downloads', prefix: '/downloads' }],
  });

  it('carries the enumerated atom-type list and cardinalities — a CLOSED grammar, no vocabulary', () => {
    const system = messages[0];
    expect(system.role).toBe('system');
    for (const type of ['path', 'tag', 'like', 'date', 'size']) {
      expect(system.content).toContain(type);
    }
    expect(system.content).toContain('JSON');
  });

  it('user message carries utterance + session predicate symbols ONLY — never ids, vectors or results', () => {
    const user = messages[1];
    expect(user.role).toBe('user');
    expect(user.content).toContain('pdfs from last year over 10mb');
    expect(user.content).toContain('/downloads');
  });

  it('omits the session-state block entirely when there is no state', () => {
    const bare = buildParseMessages({ normalizedQuery: 'mountains' });
    expect(bare[1].content).toBe('mountains');
  });

  it('ships the schema-forced output: closed object, both keys required, atom type enum, nullable fields', () => {
    const schema = buildParseSchema();
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(['predicates', 'vector_query']);
    expect(schema.properties.predicates.type).toBe('array');
    const atom = schema.properties.predicates.items;
    expect(atom.type).toBe('object');
    expect(atom.additionalProperties).toBe(false);
    expect([...atom.properties.type.enum].sort()).toEqual(['date', 'like', 'path', 'size', 'tag']);
    expect(typeof PARSE_MAX_TOKENS).toBe('number');
    expect(PARSE_MAX_TOKENS).toBeGreaterThan(0);
  });
});

describe('nlParser — parse envelope (the query_parses.predicates cache value)', () => {
  it('builds the nl1 envelope with atoms + nullable refined text', () => {
    const envelope = buildParseEnvelope([{ type: 'like' }], 'photos');
    expect(envelope).toEqual({
      grammar: PARSE_ENVELOPE_GRAMMAR,
      atoms: [{ type: 'like' }],
      vectorQuery: 'photos',
    });
  });

  it('reads back a valid nl1 envelope', () => {
    const stored = buildParseEnvelope([{ type: 'tag', value: 'pdf' }], null);
    const parsed = readParseEnvelope(stored);
    expect(parsed).not.toBeNull();
    expect(parsed.atoms).toEqual([{ type: 'tag', value: 'pdf' }]);
    expect(parsed.vectorQuery).toBeNull();
  });

  it('a []/null/undefined stored default is a cache MISS (never parsed)', () => {
    expect(readParseEnvelope([])).toBeNull();
    expect(readParseEnvelope(null)).toBeNull();
    expect(readParseEnvelope(undefined)).toBeNull();
  });

  it('a foreign grammar or a tampered envelope is a MISS (re-validation runs the shared grammar on read)', () => {
    expect(readParseEnvelope({ grammar: 'zz9', atoms: [], vectorQuery: null })).toBeNull();
    expect(
      readParseEnvelope({
        grammar: PARSE_ENVELOPE_GRAMMAR,
        atoms: [{ type: 'mime' }],
        vectorQuery: null,
      })
    ).toBeNull();
    expect(readParseEnvelope('not-an-envelope')).toBeNull();
  });
});
