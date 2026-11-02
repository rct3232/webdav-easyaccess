'use strict';

/**
 * Text coverage scope + plan (aiJobService.md §2.4 / routes/admin.md §2.2.7).
 * Pure store-facade inputs: deterministic six-state-equivalent classification,
 * bounded samples, no names/paths in the returned scope.
 */

const { buildTextBackfillScope, planTextBackfill } = require('../textBackfillScope');

function fixtures() {
  const rows = [
    { nodeId: 1, type: 'file', name: 'a.txt', mimeType: 'text/plain' },
    { nodeId: 2, type: 'file', name: 'b.pdf', mimeType: 'application/pdf' },
    { nodeId: 3, type: 'file', name: 'c.txt', mimeType: 'text/plain' },
    { nodeId: 4, type: 'file', name: 'photo.jpg', mimeType: 'image/jpeg' },
    { nodeId: 5, type: 'file', name: 'stale.txt', mimeType: 'text/plain' },
    { nodeId: 6, type: 'directory', name: 'folder', mimeType: null },
  ];
  return {
    rows,
    fileNodesStore: {
      async getChildren() {
        return [{ id: 500 }];
      },
      async listSubtreeCacheRows() {
        return rows;
      },
    },
    embeddingsStore: {
      async getByNodeIds() {
        return [
          { nodeId: 1, modelId: 10, source: 'fulltext' },
          { nodeId: 2, modelId: 10, source: 'chunk_pool' },
          { nodeId: 5, modelId: 9, source: 'chunk_pool' },
        ];
      },
    },
  };
}

describe('textBackfillScope', () => {
  it('classifies live non-media file nodes against the active model', async () => {
    const { fileNodesStore, embeddingsStore } = fixtures();
    const scope = await buildTextBackfillScope({
      modelId: 10,
      fileNodesStore,
      embeddingsStore,
      sampleSize: 1,
    });

    expect(scope.totals).toEqual({ files: 4, embedded: 2, missing: 1, stale: 1 });
    expect(scope.bySource).toMatchObject({ fulltext: 1, chunk_pool: 1 });
    expect(scope.missingIds).toEqual([3]);
    expect(scope.staleIds).toEqual([5]);
    expect(scope.sampleMissing).toEqual([3]);
    expect(scope.sampleStale).toEqual([5]);
    expect(JSON.stringify(scope)).not.toContain('a.txt');
    expect(JSON.stringify(scope)).not.toContain('photo.jpg');
  });

  it('planTextBackfill returns missing ∪ stale id-ascending, caps by limit and enqueues nothing', () => {
    const scope = { missingIds: [8, 2], staleIds: [4] };
    expect(planTextBackfill({ scope })).toEqual([2, 4, 8]);
    expect(planTextBackfill({ scope, limit: 2 })).toEqual([2, 4]);
    expect(planTextBackfill({ scope, limit: 0 })).toEqual([]);
    expect(planTextBackfill({ scope: null })).toEqual([]);
  });

  it('scopes to one requester root when userId is provided', async () => {
    const rows = [{ nodeId: 11, type: 'file', name: 'x.txt', mimeType: 'text/plain' }];
    const fileNodesStore = {
      async getUserRootNode() {
        return { id: 700 };
      },
      async listSubtreeCacheRows(ancestorId) {
        expect(ancestorId).toBe(700);
        return rows;
      },
    };
    const scope = await buildTextBackfillScope({
      userId: 44,
      modelId: 10,
      fileNodesStore,
      embeddingsStore: {
        async getByNodeIds() {
          return [];
        },
      },
    });
    expect(scope.userId).toBe(44);
    expect(scope.missingIds).toEqual([11]);
  });
});
