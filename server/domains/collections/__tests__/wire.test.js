/**
 * Collections wire serializers — snake_case contract units.
 * @see docs/spec/server/routes/collections.md (collection row, GET /:id/items)
 * @see docs/api.md
 */
const wire = require('../wire');

describe('wire.serializeItem', () => {
  it('maps the domain row to the snake_case item contract', () => {
    const item = wire.serializeItem({
      nodeId: 90210,
      name: 'poster.pdf',
      type: 'file',
      mimeType: 'application/pdf',
      membership: 'derived',
      published: false,
      addedBy: null,
      createdAt: '2026-09-13T10:00:00Z',
      state: 'normal',
      liked: true,
      reason: 'tag:poster',
      sharedExcluded: false,
    });
    expect(item).toEqual({
      node_id: 90210,
      name: 'poster.pdf',
      type: 'file',
      mime: 'application/pdf',
      membership: 'derived',
      published: false,
      added_by: null,
      created_at: '2026-09-13T10:00:00Z',
      state: 'normal',
      liked: true,
      reason: 'tag:poster',
      shared_excluded: false,
    });
  });

  it('renders mime as null for placeholder/absent values (P-3 one field)', () => {
    const item = wire.serializeItem({
      nodeId: 5,
      name: null,
      type: null,
      mimeType: undefined,
      membership: 'stored',
      state: 'revoked',
    });
    expect(item.mime).toBeNull();
    expect(item.name).toBeNull();
  });
});

describe('wire.serializeCollection', () => {
  const row = {
    id: 12,
    ownerId: 1,
    name: 'Roadtrip',
    origin: 'user',
    status: 'active',
    publishMode: 'ask',
    pinned: false,
    pinnedBy: null,
    nameLocked: false,
    createdAt: '2026-08-02T09:30:00Z',
    updatedAt: null,
    archivedAt: null,
    lastMemberChangeAt: null,
  };

  it('always carries preview_items mapped from the resolved member rows (P-3)', () => {
    const payload = wire.serializeCollection(row, {
      itemCount: 6,
      previewItems: [
        { nodeId: 44, name: 'beach.jpg', type: 'file', mimeType: 'image/jpeg' },
        { nodeId: 43, name: 'map.png', type: 'file', mimeType: null },
      ],
    });
    expect(payload.preview_items).toEqual([
      { node_id: 44, name: 'beach.jpg', type: 'file', mime: 'image/jpeg' },
      { node_id: 43, name: 'map.png', type: 'file', mime: null },
    ]);

    const empty = wire.serializeCollection(row, { itemCount: 0 });
    expect(empty.preview_items).toEqual([]);
  });

  it('keeps the existing row contract intact (granted_role, definition gate, cluster_index)', () => {
    const payload = wire.serializeCollection(
      { ...row, definition: { kind: 'predicate' }, clusterIndex: 2 },
      { grantedRole: null, itemCount: 3, includeDefinition: true, previewItems: [] }
    );
    expect(payload.collection_id).toBe(12);
    expect(payload.definition).toEqual({ kind: 'predicate' });
    expect(payload.cluster_index).toBe(2);
    expect(payload.granted_role).toBeNull();
    expect(payload.preview_items).toEqual([]);
  });
});

describe('wire.serializeSuggestion', () => {
  const row = {
    id: 88,
    aId: 17,
    bId: 23,
    score: 812,
    state: 'pending',
    dismissCount: 0,
    arbiterVerdict: null,
    arbiterReason: null,
    createdAt: '2026-09-16T03:00:00Z',
  };

  it('maps the suggestion row to the full snake_case card contract', () => {
    const payload = wire.serializeSuggestion(row, {
      aName: 'Europe',
      bName: '2025-trip',
      overlapCount: 41,
      mergedCount: 58,
      recommendation: null,
    });
    expect(payload).toMatchObject({
      suggestion_id: 88,
      a_id: 17,
      a_name: 'Europe',
      b_id: 23,
      b_name: '2025-trip',
      overlap_count: 41,
      merged_count: 58,
      score: 812,
      dismiss_count: 0,
      created_at: '2026-09-16T03:00:00Z',
      recommendation: null,
    });
    Object.keys(payload).forEach((key) => {
      expect(key).toMatch(/^[a-z0-9_]+$/);
    });
  });

  it('carries the compare-overlay sample fields (empty arrays when no samples given)', () => {
    const bare = wire.serializeSuggestion(row, {
      aName: 'A',
      bName: 'B',
      overlapCount: 0,
      mergedCount: 0,
    });
    expect(bare.overlap_sample).toEqual([]);
    expect(bare.a_unique_sample).toEqual([]);
    expect(bare.b_unique_sample).toEqual([]);

    const withSamples = wire.serializeSuggestion(row, {
      aName: 'A',
      bName: 'B',
      overlapCount: 1,
      mergedCount: 2,
      overlapSample: [{ a_node_id: 101, b_node_id: 101 }],
      aUniqueSample: [{ node_id: 110, name: 'beach.jpg' }],
      bUniqueSample: [{ node_id: 220, name: 'seville.jpg' }],
    });
    expect(withSamples.overlap_sample).toEqual([{ a_node_id: 101, b_node_id: 101 }]);
    expect(withSamples.a_unique_sample).toEqual([{ node_id: 110, name: 'beach.jpg' }]);
    expect(withSamples.b_unique_sample).toEqual([{ node_id: 220, name: 'seville.jpg' }]);
  });

  it('passes the arbiter recommendation through untouched (advisory prefill)', () => {
    const payload = wire.serializeSuggestion(row, {
      aName: 'A',
      bName: 'B',
      overlapCount: 2,
      mergedCount: 3,
      recommendation: { verdict: 'merge', reason: 'same theme twice' },
    });
    expect(payload.recommendation).toEqual({ verdict: 'merge', reason: 'same theme twice' });
  });
});
