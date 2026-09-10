/**
 * useTrashOperations tests.
 * @see docs/spec/client/hooks/useTrashOperations.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import useTrashOperations from '../useTrashOperations';

import * as fileService from '../../../../services/fileService';
import { notifyTrashChanged } from '../../../../services/trashNotifier';

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});

jest.mock('../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

jest.mock('../../../../services/trashNotifier', () => ({
  notifyTrashChanged: jest.fn(),
}));

const mockShowError = jest.fn();
const mockRefreshNow = jest.fn();
const mockUpdateProgress = jest.fn();
const mockSetDropMessage = jest.fn();

function renderTrashOps() {
  return renderHook(() =>
    useTrashOperations({
      t: (key) => key,
      showError: mockShowError,
      refreshNow: mockRefreshNow,
      updateProgress: mockUpdateProgress,
      setDropMessage: mockSetDropMessage,
    })
  );
}

describe('useTrashOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    fileService.restoreTrashedItem.mockResolvedValue({ nodeId: 1 });
    fileService.purgeTrashedItem.mockResolvedValue({ nodeId: 1 });
    fileService.emptyTrash.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('handleTrashRestore restores the row node and refreshes without a confirm', async () => {
    const { result } = renderTrashOps();

    await act(async () => {
      await result.current.handleTrashRestore({ nodeId: 7 });
    });

    expect(fileService.restoreTrashedItem).toHaveBeenCalledWith(7);
    expect(mockRefreshNow).toHaveBeenCalled();
    expect(notifyTrashChanged).toHaveBeenCalled();
    expect(mockSetDropMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('handleTrashPurge purges the row node (executor only; caller owns the confirm)', async () => {
    const { result } = renderTrashOps();

    await act(async () => {
      await result.current.handleTrashPurge({ nodeId: 8 });
    });

    expect(fileService.purgeTrashedItem).toHaveBeenCalledWith(8);
    expect(mockRefreshNow).toHaveBeenCalled();
  });

  it('openPurgeConfirm -> confirmPurge purges each confirmed node id and closes the dialog', async () => {
    const { result } = renderTrashOps();

    act(() => {
      result.current.openPurgeConfirm([3, 4]);
    });
    expect(result.current.purgeConfirmState).toEqual({ nodeIds: [3, 4] });

    await act(async () => {
      await result.current.confirmPurge();
    });

    expect(fileService.purgeTrashedItem).toHaveBeenCalledWith(3);
    expect(fileService.purgeTrashedItem).toHaveBeenCalledWith(4);
    expect(result.current.purgeConfirmState).toBeNull();
    expect(mockRefreshNow).toHaveBeenCalled();
    expect(mockUpdateProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'purge' }));
  });

  it('openRestoreConfirm -> confirmRestore restores each node and closes the dialog', async () => {
    const { result } = renderTrashOps();

    act(() => {
      result.current.openRestoreConfirm([5, 6]);
    });
    expect(result.current.restoreConfirmState).toEqual({ nodeIds: [5, 6] });

    await act(async () => {
      await result.current.confirmRestore();
    });

    expect(fileService.restoreTrashedItem).toHaveBeenCalledWith(5);
    expect(fileService.restoreTrashedItem).toHaveBeenCalledWith(6);
    expect(result.current.restoreConfirmState).toBeNull();
  });

  it('confirmEmptyTrash calls emptyTrash once and refreshes', async () => {
    const { result } = renderTrashOps();

    act(() => {
      result.current.openEmptyTrashConfirm();
    });
    expect(result.current.emptyTrashConfirmOpen).toBe(true);

    await act(async () => {
      await result.current.confirmEmptyTrash();
    });

    expect(fileService.emptyTrash).toHaveBeenCalledTimes(1);
    expect(result.current.emptyTrashConfirmOpen).toBe(false);
    expect(mockRefreshNow).toHaveBeenCalled();
    expect(notifyTrashChanged).toHaveBeenCalled();
  });

  it('single-item purge failure surfaces the fallback error and skips success toast', async () => {
    fileService.purgeTrashedItem.mockRejectedValueOnce({ response: { data: null } });
    const { result } = renderTrashOps();

    await act(async () => {
      await result.current.handleTrashPurge({ nodeId: 8 });
    });

    expect(mockShowError).toHaveBeenCalled();
    expect(mockSetDropMessage).not.toHaveBeenCalled();
  });

  it('empty node id list is a no-op', async () => {
    const { result } = renderTrashOps();

    act(() => {
      result.current.openPurgeConfirm([]);
    });
    expect(result.current.purgeConfirmState).toBeNull();

    await act(async () => {
      await result.current.handleTrashRestore(null);
    });
    expect(fileService.restoreTrashedItem).not.toHaveBeenCalled();
  });
});
