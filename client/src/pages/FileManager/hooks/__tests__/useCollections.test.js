/**
 * useCollections tests — list state, CRUD wrappers, merge data, notifier refresh.
 * @see docs/spec/client/hooks/useCollections.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCollections } from '../useCollections';

import explorerGateway from '../../../../services/explorerGateway';

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

const mockShowError = jest.fn();
const mockOnUndoable = jest.fn();

function baseProps(overrides = {}) {
  return {
    showError: mockShowError,
    onUndoable: mockOnUndoable,
    ...overrides,
  };
}

function collectionsPage(rows) {
  return { collections: rows };
}

const ROW_A = { collection_id: 1, name: 'A', granted_role: null };
const ROW_B = { collection_id: 2, name: 'B', granted_role: null };

describe('useCollections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    explorerGateway.loadCollections.mockResolvedValue(collectionsPage([ROW_A, ROW_B]));
    explorerGateway.getMergeSuggestions.mockResolvedValue({ suggestions: [] });
    explorerGateway.subscribeToCollections.mockImplementation(() => jest.fn());
    explorerGateway.updateCollection.mockResolvedValue({ undo: { action_id: 1 } });
    explorerGateway.archiveCollection.mockResolvedValue({ undo: { action_id: 2 } });
    explorerGateway.restoreCollection.mockResolvedValue({ undo: { action_id: 3 } });
    explorerGateway.deleteCollection.mockResolvedValue(true);
    explorerGateway.mergeCollections.mockResolvedValue({ undo: { action_id: 4 } });
    explorerGateway.dismissMerge.mockResolvedValue({ state: 'dismissed' });
    explorerGateway.rejectMerge.mockResolvedValue({ state: 'rejected' });
  });

  it('mounts with mine,shared default and sort=activity; exposes the contract surface', async () => {
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(explorerGateway.loadCollections).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'activity', include: 'mine,shared' })
    );
    expect(result.current.collections).toEqual([ROW_A, ROW_B]);
    expect(result.current.sort).toBe('activity');
    expect(result.current.include).toBe('mine,shared');
    expect(result.current.suggestions).toEqual([]);
    expect(typeof result.current.setSort).toBe('function');
    expect(typeof result.current.refresh).toBe('function');
    expect(typeof result.current.renameCollection).toBe('function');
    expect(typeof result.current.setPinned).toBe('function');
    expect(typeof result.current.setPublishMode).toBe('function');
    expect(typeof result.current.archiveCollection).toBe('function');
    expect(typeof result.current.restoreCollection).toBe('function');
    expect(typeof result.current.deleteCollectionPermanent).toBe('function');
    expect(typeof result.current.mergePair).toBe('function');
    expect(typeof result.current.dismissMergeSuggestion).toBe('function');
    expect(typeof result.current.rejectMergeSuggestion).toBe('function');
  });

  it('archive virtual route loads mine,archived via the include prop', async () => {
    renderHook(() => useCollections(baseProps({ include: 'mine,archived' })));

    await waitFor(() => {
      expect(explorerGateway.loadCollections).toHaveBeenCalledWith(
        expect.objectContaining({ include: 'mine,archived' })
      );
    });
  });

  it('setSort re-fetches with the new sort and rows pass cluster_index through untouched', async () => {
    explorerGateway.loadCollections.mockResolvedValue({
      collections: [{ ...ROW_A, cluster_index: 0 }],
    });
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setSort('similar');
    });

    expect(explorerGateway.loadCollections).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'similar', include: 'mine,shared' })
    );
    expect(result.current.collections[0].cluster_index).toBe(0);
  });

  it('a successful archive refreshes and forwards the payload to onUndoable', async () => {
    const payload = { collection: { collection_id: 1 }, undo: { action_id: 42 } };
    explorerGateway.archiveCollection.mockResolvedValue(payload);
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let out;
    await act(async () => {
      out = await result.current.archiveCollection(1);
    });

    expect(explorerGateway.archiveCollection).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ onError: expect.any(Function) })
    );
    expect(out).toEqual(payload);
    expect(mockOnUndoable).toHaveBeenCalledWith(payload, expect.any(String));
    expect(explorerGateway.loadCollections.mock.calls.length).toBeGreaterThan(1);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('an absorbed failure routes to showError and never to onUndoable', async () => {
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // the repository absorbs the failure and hands the envelope to onError
    // before returning null; the hook branches on null and shows the mapped message
    explorerGateway.archiveCollection.mockImplementation(async (_id, options) => {
      options?.onError?.({ errorCode: 'serverErrors.collections.notArchived', params: {} });
      return null;
    });

    await act(async () => {
      await result.current.archiveCollection(1);
    });

    expect(mockOnUndoable).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalled();
    expect(mockShowError.mock.calls[0][0]).toMatch(/notArchived|This collection is not archived/);
  });

  it('deleteCollectionPermanent returns true on success, never triggers undo', async () => {
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let out;
    await act(async () => {
      out = await result.current.deleteCollectionPermanent(1);
    });

    expect(out).toBe(true);
    expect(explorerGateway.deleteCollection).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ onError: expect.any(Function) })
    );
    expect(mockOnUndoable).not.toHaveBeenCalled();
  });

  it('notifier events refresh the list; unsubscribe runs on unmount', async () => {
    const unsubscribe = jest.fn();
    let notifyCb;
    explorerGateway.subscribeToCollections.mockImplementation((cb) => {
      notifyCb = cb;
      return unsubscribe;
    });

    const { result, unmount } = renderHook(() => useCollections(baseProps()));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callsBefore = explorerGateway.loadCollections.mock.calls.length;
    await act(async () => {
      notifyCb();
    });
    expect(explorerGateway.loadCollections.mock.calls.length).toBeGreaterThan(callsBefore);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('merge suggestions populate state and refresh with the list', async () => {
    explorerGateway.getMergeSuggestions.mockResolvedValue({
      suggestions: [{ suggestion_id: 88, a_id: 1, b_id: 2, score: 812 }],
    });
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => {
      expect(result.current.suggestions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refresh();
    });
    expect(explorerGateway.getMergeSuggestions).toHaveBeenCalledTimes(2);
  });

  it('suggestions stay an empty array on read failure', async () => {
    explorerGateway.getMergeSuggestions.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.suggestions).toEqual([]);
  });

  it('mergePair refreshes and forwards undo on success', async () => {
    const payload = { survivor: { collection_id: 1 }, absorbed_id: 2, undo: { action_id: 7 } };
    explorerGateway.mergeCollections.mockResolvedValue(payload);
    const { result } = renderHook(() => useCollections(baseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.mergePair(1, 2);
    });

    expect(explorerGateway.mergeCollections).toHaveBeenCalledWith(
      1,
      2,
      expect.objectContaining({ onError: expect.any(Function) })
    );
    expect(mockOnUndoable).toHaveBeenCalledWith(payload, expect.any(String));
  });

  it('dismiss/reject do not produce undo affordances', async () => {
    const { result } = renderHook(() => useCollections(baseProps()));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.dismissMergeSuggestion(1, 2);
      await result.current.rejectMergeSuggestion(1, 2);
    });

    expect(mockOnUndoable).not.toHaveBeenCalled();
    expect(explorerGateway.dismissMerge).toHaveBeenCalledWith(1, 2);
    expect(explorerGateway.rejectMerge).toHaveBeenCalledWith(1, 2);
  });
});