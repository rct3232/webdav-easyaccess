/**
 * useCollectionMemberships tests — batched files-surface membership read.
 * Verifies observable outcomes per spec:
 * docs/spec/client/hooks/useCollectionMemberships.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCollectionMemberships } from '../useCollectionMemberships';

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});

jest.mock('../../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  return {
    __esModule: true,
    default: createExplorerGatewayMock(),
  };
});

const COLLECTIONS = [
  { collection_id: 17, name: 'Beach', granted_role: null },
  { collection_id: 23, name: 'Work', granted_role: null },
  { collection_id: 29, name: 'Recipes', granted_role: 'editor' },
];

function createGateway(overrides = {}) {
  return {
    getMemberships: jest.fn(async (nodeIds) => ({
      memberships: nodeIds.map((nodeId) => ({ node_id: nodeId, collection_ids: [17] })),
    })),
    subscribeToCollections: jest.fn(() => jest.fn()),
    ...overrides,
  };
}

const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('useCollectionMemberships', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('empty id set ⇒ zero IO, empty map', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [], collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(result.current.membershipsByNodeId).toEqual({}));
    expect(gateway.getMemberships).not.toHaveBeenCalled();
  });

  it('de-dupes ids and resolves names in collections-list order', async () => {
    const gateway = createGateway({
      getMemberships: jest.fn(async (nodeIds) => ({
        memberships: [{ node_id: nodeIds[0], collection_ids: [23, 17] }],
      })),
    });
    const { result } = renderHook(() =>
      useCollectionMemberships({
        nodeIds: [900, 900, 901, 902],
        collections: COLLECTIONS,
        gateway,
      })
    );
    await waitFor(() => expect(result.current.membershipsByNodeId[900]).toBeDefined());
    expect(gateway.getMemberships).toHaveBeenCalledTimes(1);
    expect(gateway.getMemberships.mock.calls[0][0]).toEqual([900, 901, 902]);
    // 23 then 17 arrives REVERSED against the list order — chips follow the LIST
    expect(result.current.membershipsByNodeId[900]).toEqual([
      { id: 17, name: 'Beach' },
      { id: 23, name: 'Work' },
    ]);
    // nodes with no membership are ABSENT from the map
    expect(result.current.membershipsByNodeId[901]).toBeUndefined();
  });

  it('chunks at 100 ids per request (250 unique ids ⇒ 100/100/50)', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: ids(1, 250), collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.membershipsByNodeId[250]).toBeDefined());
    const sizes = gateway.getMemberships.mock.calls.map(([chunk]) => chunk.length);
    expect(sizes.sort((a, b) => b - a)).toEqual([100, 100, 50]);
    expect(Object.keys(result.current.membershipsByNodeId)).toHaveLength(250);
  });

  it('failed chunk is swallowed to no-chips (other chunks still land, no throw)', async () => {
    const gateway = createGateway({
      getMemberships: jest.fn(async (nodeIds) => {
        if (nodeIds.includes(150)) {
          // repository absorb contract: failure resolves to the fallback shape
          return { memberships: [] };
        }
        return {
          memberships: nodeIds.map((nodeId) => ({ node_id: nodeId, collection_ids: [17] })),
        };
      }),
    });
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: ids(1, 150), collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(result.current.membershipsByNodeId[1]).toBeDefined());
    expect(result.current.membershipsByNodeId[150]).toBeUndefined();
    expect(Object.keys(result.current.membershipsByNodeId)).toHaveLength(100);
  });

  it('defensive: a rejecting seam never propagates (chunk treated as empty)', async () => {
    const gateway = createGateway({
      getMemberships: jest.fn(async () => {
        throw new Error('contract violation');
      }),
    });
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [5], collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(result.current.membershipsByNodeId).toEqual({}));
  });

  it('unknown collection ids are dropped (no unresolvable name)', async () => {
    const gateway = createGateway({
      getMemberships: jest.fn(async (nodeIds) => ({
        memberships: [{ node_id: nodeIds[0], collection_ids: [17, 999] }],
      })),
    });
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [7], collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(result.current.membershipsByNodeId[7]).toBeDefined());
    expect(result.current.membershipsByNodeId[7]).toEqual([{ id: 17, name: 'Beach' }]);
  });

  it('notifier event triggers one re-read batch', async () => {
    const gateway = createGateway();
    let listener = null;
    gateway.subscribeToCollections.mockImplementation((cb) => {
      listener = cb;
      return jest.fn();
    });
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [42], collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(1));
    await act(async () => {
      listener();
    });
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(2));
    expect(result.current.membershipsByNodeId).toBeDefined();
  });

  it('same id set re-render does NOT re-read (deduped-set key)', async () => {
    const gateway = createGateway();
    const { rerender } = renderHook(
      ({ nodeIds }) => useCollectionMemberships({ nodeIds, collections: COLLECTIONS, gateway }),
      { initialProps: { nodeIds: [1, 2, 3] } }
    );
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(1));
    rerender({ nodeIds: [3, 2, 1] }); // reorder only — same deduped set
    rerender({ nodeIds: [1, 2, 3] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(gateway.getMemberships).toHaveBeenCalledTimes(1);
  });

  it('collections list change re-reads and re-resolves names', async () => {
    const gateway = createGateway({
      getMemberships: jest.fn(async (nodeIds) => ({
        memberships: [{ node_id: nodeIds[0], collection_ids: [17] }],
      })),
    });
    const { result, rerender } = renderHook(
      ({ collections }) => useCollectionMemberships({ nodeIds: [8], collections, gateway }),
      { initialProps: { collections: COLLECTIONS } }
    );
    await waitFor(() =>
      expect(result.current.membershipsByNodeId[8]).toEqual([{ id: 17, name: 'Beach' }])
    );
    const renamed = [{ collection_id: 17, name: 'Seaside', granted_role: null }];
    rerender({ collections: renamed });
    await waitFor(() =>
      expect(result.current.membershipsByNodeId[8]).toEqual([{ id: 17, name: 'Seaside' }])
    );
  });

  it('last-run-wins: a stale slow run never commits over a fresh one', async () => {
    let call = 0;
    const gateway = createGateway({
      getMemberships: jest.fn(async (nodeIds) => {
        call += 1;
        if (call === 1) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { memberships: [{ node_id: nodeIds[0], collection_ids: [17] }] };
        }
        return { memberships: [{ node_id: nodeIds[0], collection_ids: [23] }] };
      }),
    });
    const { result, rerender } = renderHook(
      ({ nodeIds }) => useCollectionMemberships({ nodeIds, collections: COLLECTIONS, gateway }),
      { initialProps: { nodeIds: [1] } }
    );
    rerender({ nodeIds: [2] }); // second run starts while the first is in flight
    await waitFor(() => expect(result.current.membershipsByNodeId[2]).toBeDefined());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    // the first (stale) run resolved late — it must NOT have re-added node 1
    expect(result.current.membershipsByNodeId[1]).toBeUndefined();
    expect(result.current.membershipsByNodeId[2]).toEqual([{ id: 23, name: 'Work' }]);
  });

  it('inert gateway (admin/share-link sessions): resolves the fallback with the seams it provides', async () => {
    const inert = {
      getMemberships: jest.fn(async () => ({ memberships: [] })),
      subscribeToCollections: jest.fn(() => jest.fn()),
    };
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [1, 2], collections: [], gateway: inert })
    );
    await waitFor(() => expect(result.current.membershipsByNodeId).toEqual({}));
    expect(result.current.membershipsByNodeId).toEqual({});
  });

  it('unmount unsubscribes the notifier', async () => {
    const unsubscribe = jest.fn();
    const gateway = createGateway({
      subscribeToCollections: jest.fn(() => unsubscribe),
    });
    const { unmount } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [1], collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('nullish ids are dropped before batching', async () => {
    const gateway = createGateway();
    const { result } = renderHook(() =>
      useCollectionMemberships({
        nodeIds: [null, 5, undefined, 5],
        collections: COLLECTIONS,
        gateway,
      })
    );
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(1));
    expect(gateway.getMemberships.mock.calls[0][0]).toEqual([5]);
    await waitFor(() =>
      expect(result.current.membershipsByNodeId[5]).toEqual([{ id: 17, name: 'Beach' }])
    );
  });

  it('nodes the response reports with empty collection_ids stay ABSENT from the map', async () => {
    const gateway = createGateway({
      getMemberships: jest.fn(async (nodeIds) => ({
        memberships: [{ node_id: nodeIds[0], collection_ids: [] }],
      })),
    });
    const { result } = renderHook(() =>
      useCollectionMemberships({ nodeIds: [9], collections: COLLECTIONS, gateway })
    );
    await waitFor(() => expect(gateway.getMemberships).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.membershipsByNodeId).toEqual({}));
  });
});
