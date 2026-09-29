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
