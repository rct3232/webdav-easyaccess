'use strict';

/**
 * deltaStructuring unit tests — the §4.22/§2.9 utterance-merge rule table
 * (docs/spec/server/services/searchService.md §2.9). Pure module: no DB, no
 * provider, no clock.
 */
const { structureDelta, anchorPrefix } = require('../deltaStructuring');
const { parseDefinition } = require('../../collections/definitionEngine');

const LATEST_REF = 'sr1.0123456789abcdef';

describe('deltaStructuring — add / replace / exclude merge rules', () => {
  it('add APPENDS a new field constraint', () => {
    const result = structureDelta({
      delta: { add: [{ type: 'size', min: 10 }] },
      baseAtoms: [{ type: 'like' }],
    });
    expect(result.degraded).toBe(false);
    expect(result.atoms).toEqual([{ type: 'like' }, { type: 'size', min: 10 }]);
  });

  it('add overflow DROPS the oldest same-field atom (tag 3, path 1)', () => {
    const tags = structureDelta({
      delta: { add: [{ type: 'tag', value: 'd' }] },
      baseAtoms: [
        { type: 'tag', value: 'a' },
        { type: 'tag', value: 'b' },
        { type: 'tag', value: 'c' },
      ],
    });
    expect(tags.atoms).toEqual([
      { type: 'tag', value: 'b' },
      { type: 'tag', value: 'c' },
      { type: 'tag', value: 'd' },
    ]);

    const path = structureDelta({
      delta: { add: [{ type: 'path', value: 'new' }] },
      baseAtoms: [{ type: 'path', value: 'old' }],
      rootPath: '/alice',
    });
    expect(path.atoms).toEqual([{ type: 'path', value: '/alice/new', prefix: '/alice/new' }]);
  });

  it('replace removes ALL same-type base atoms, then adds the replacement', () => {
    const result = structureDelta({
      delta: {
        replace: [
          { type: 'tag', value: 'beach' },
          { type: 'tag', value: 'summer' },
        ],
      },
      baseAtoms: [
        { type: 'tag', value: 'old-a' },
        { type: 'size', min: 1 },
        { type: 'tag', value: 'old-b' },
        { type: 'tag', value: 'old-c' },
      ],
    });
    expect(result.atoms).toEqual([
      { type: 'size', min: 1 },
      { type: 'tag', value: 'beach' },
      { type: 'tag', value: 'summer' },
    ]);
  });

  it('exclude stays a SEPARATE subtraction list (never an atom type) and dedupes', () => {
    const result = structureDelta({
      delta: { exclude: [{ type: 'size', min: 10 }] },
      baseAtoms: [{ type: 'like' }],
      baseExcludes: [{ type: 'size', min: 10 }],
    });
    expect(result.atoms).toEqual([{ type: 'like' }]);
    expect(result.excludes).toEqual([{ type: 'size', min: 10 }]);
  });

  it('exclude_similar is sticky (OR across turns)', () => {
    expect(
      structureDelta({ delta: { excludeSimilar: true }, baseExcludeSimilar: false }).excludeSimilar
    ).toBe(true);
    expect(
      structureDelta({ delta: { excludeSimilar: false }, baseExcludeSimilar: true }).excludeSimilar
    ).toBe(true);
  });
});

describe('deltaStructuring — $ref binding', () => {
  it('binds ONLY the validated request result_ref for $ref:"latest"', () => {
    const result = structureDelta({
      delta: { ref: 'latest' },
      requestRef: LATEST_REF,
    });
    expect(result.degraded).toBe(false);
    expect(result.baseRef).toBe(LATEST_REF);
  });

  it('degrades when latest is requested without a valid request ref (never a server-global latest)', () => {
    expect(structureDelta({ delta: { ref: 'latest' } }).degraded).toBe(true);
    expect(structureDelta({ delta: { ref: 'latest' }, requestRef: 'sr1.cafe' }).degraded).toBe(
      true
    );
    expect(structureDelta({ delta: { ref: 'latest' }, requestRef: 'not-a-ref' }).degraded).toBe(
      true
    );
  });

  it('rejects a real ref string supplied by the model', () => {
    expect(
      structureDelta({ delta: { ref: 'sr1.0123456789abcdef' }, requestRef: LATEST_REF }).degraded
    ).toBe(true);
    expect(
      structureDelta({ delta: { $ref: 'sr1.0123456789abcdef' }, requestRef: LATEST_REF }).degraded
    ).toBe(true);
  });

  it('does NOT bind a request ref when the delta has no $ref', () => {
    const result = structureDelta({
      delta: { add: [{ type: 'like' }] },
      requestRef: LATEST_REF,
    });
    expect(result.baseRef).toBeNull();
  });
});

describe('deltaStructuring — path anchoring + validation', () => {
  it('anchors path atoms to the requester root display path, idempotently', () => {
    expect(anchorPrefix('/downloads', '/alice')).toBe('/alice/downloads');
    expect(anchorPrefix('/alice/downloads', '/alice')).toBe('/alice/downloads');
    expect(anchorPrefix('/', '/alice')).toBe('/alice');

    const result = structureDelta({
      delta: { add: [{ type: 'path', value: '/downloads' }] },
      rootPath: '/alice',
    });
    expect(result.atoms).toEqual([
      { type: 'path', value: '/alice/downloads', prefix: '/alice/downloads' },
    ]);
    const again = structureDelta({
      delta: { add: [{ type: 'path', value: '/alice/downloads' }] },
      rootPath: '/alice',
    });
    expect(again.atoms).toEqual([
      { type: 'path', value: '/alice/downloads', prefix: '/alice/downloads' },
    ]);
  });

  it('keeps the requester anchor when the shared grammar re-parses the atom', () => {
    const result = structureDelta({
      delta: { add: [{ type: 'path', value: 'downloads' }] },
      rootPath: '/alice',
    });
    expect(result.atoms).toEqual([
      { type: 'path', value: '/alice/downloads', prefix: '/alice/downloads' },
    ]);
    expect(parseDefinition({ kind: 'predicate', all_of: result.atoms }).allOf).toEqual([
      { type: 'path', value: '/alice/downloads', prefix: '/alice/downloads' },
    ]);
  });

  it('degrades a path delta without a requester root (cannot safely anchor)', () => {
    expect(
      structureDelta({
        delta: { add: [{ type: 'path', value: 'downloads' }] },
        rootPath: null,
      }).degraded
    ).toBe(true);
  });

  it('degrades on invalid atoms or an invalid delta shape', () => {
    expect(structureDelta({ delta: null }).degraded).toBe(true);
    expect(structureDelta({ delta: { add: [{ type: 'mime', value: 'pdf' }] } }).degraded).toBe(
      true
    );
    expect(structureDelta({ delta: { add: 'not-an-array' } }).degraded).toBe(true);
    expect(structureDelta({ delta: { excludeSimilar: 'yes' } }).degraded).toBe(true);
  });
});
