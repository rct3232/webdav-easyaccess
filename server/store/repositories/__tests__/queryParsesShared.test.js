'use strict';

/**
 * Shared-mapper coverage for the `query_parses` boundary
 * (docs/spec/server/store/queryParsesStore.md §2.3). The malformed-string
 * branch is a SQLite raw-row/legacy case: PostgreSQL JSONB rejects malformed
 * input at write time, so the postgres twin never observes it.
 */
const { mapQueryParseRow, serializePredicates } = require('../queryParsesShared');

const baseRow = {
  normalized_query: 'cache key',
  predicates: '[]',
  vector: null,
  hit_count: 0,
  created_at: null,
};

describe('queryParsesShared', () => {
  describe('mapQueryParseRow', () => {
    it('maps valid JSON text to the parsed value', () => {
      const envelope = {
        grammar: 'nl1',
        atoms: [{ type: 'like' }],
        vectorQuery: null,
      };
      expect(
        mapQueryParseRow({ ...baseRow, predicates: JSON.stringify(envelope), hit_count: '2' })
      ).toEqual({
        normalizedQuery: 'cache key',
        predicates: envelope,
        vector: null,
        hitCount: 2,
        createdAt: null,
      });
    });

    it('maps malformed stored TEXT to null (SQLite raw-row case)', () => {
      expect(mapQueryParseRow({ ...baseRow, predicates: '{not-json' }).predicates).toBeNull();
    });

    it('maps an absent/null predicates value to null', () => {
      expect(mapQueryParseRow({ ...baseRow, predicates: null }).predicates).toBeNull();
    });

    it('normalizes a postgres Date to an ISO string and passes sqlite TEXT through', () => {
      const instant = new Date('2026-10-29T00:00:00.000Z');
      expect(mapQueryParseRow({ ...baseRow, created_at: instant }).createdAt).toBe(
        '2026-10-29T00:00:00.000Z'
      );
      expect(mapQueryParseRow({ ...baseRow, created_at: '2026-10-29 00:00:00' }).createdAt).toBe(
        '2026-10-29 00:00:00'
      );
    });
  });

  describe('serializePredicates', () => {
    it('defaults undefined/null to the empty array', () => {
      expect(serializePredicates(undefined)).toBe('[]');
      expect(serializePredicates(null)).toBe('[]');
    });

    it('serializes a parse envelope verbatim', () => {
      const envelope = { grammar: 'nl1', atoms: [], vectorQuery: 'refined' };
      expect(serializePredicates(envelope)).toBe(JSON.stringify(envelope));
    });
  });
});
