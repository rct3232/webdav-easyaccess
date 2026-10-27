/**
 * useExplorerCommands tests.
 * @see docs/spec/client/hooks/useExplorerCommands.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';

import explorerGateway from '../../../../services/explorerGateway';
import { useBulkOperations } from '../useBulkOperations';
import { useFileOperations } from '../useFileOperations';
import { showErrorFromError } from '../../../../utils/errorUtils';
import { validateFileName } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../../../utils/validationMessage';
import { useExplorerCommands } from '../useExplorerCommands';

jest.mock('../../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  return {
    __esModule: true,
    default: createExplorerGatewayMock(),
  };
});

jest.mock('../useBulkOperations', () => ({
  useBulkOperations: jest.fn(),
}));

jest.mock('../useFileOperations', () => ({
  useFileOperations: jest.fn(),
}));

jest.mock('../../../../utils/errorUtils', () => {
  const { createErrorUtilsMock } = require('../../../../testing/mocks/serviceMocks');
  return createErrorUtilsMock({
    getServerErrorDisplay: jest.fn(() => 'server error'),
    showErrorFromError: jest.fn((error, showError) => {
      showError(error?.message || 'errors.unknown');
    }),
  });
});

jest.mock('@webdav-easyaccess/shared/validation', () => ({
  validateFileName: jest.fn(() => null),
}));

jest.mock('../../../../utils/validationMessage', () => ({
  getValidationMessage: jest.fn((error) => `validation:${error}`),
}));

function createBulkState(overrides = {}) {
  return {
    folderPickerOpen: false,
    folderPickerAction: null,
    progressItems: [],
    updateProgress: jest.fn(),
    handleBulkMove: jest.fn(),
    handleBulkCopy: jest.fn(),
    handleBulkDelete: jest.fn(),
    handleBulkDownload: jest.fn(),
    handleFolderPickerSelect: jest.fn(),
    handleRetry: jest.fn(),
    handleCancelBulkOperation: jest.fn(),
    dismissFailedItems: jest.fn(),
    setFolderPickerOpen: jest.fn(),
    setFolderPickerAction: jest.fn(),
    bulkConflictData: null,
    resolveBulkConflict: jest.fn(),
    setBulkConflictData: jest.fn(),
    ...overrides,
  };
}

function createFileOperationsState(overrides = {}) {
  return {
    handleFileDownload: jest.fn().mockResolvedValue(undefined),
    handleFileRename: jest.fn().mockResolvedValue(undefined),
    notifyUploadQueueDrained: jest.fn(),
    ...overrides,
  };
}

function createProps(overrides = {}) {
  const currentNodeIdRef = { current: 10 };
  return {
    t: (key) => key,
    user: null,
    isMobile: false,
    isShareLinkMode: false,
    shareToken: null,
    currentNodeId: 10,
    currentNodeIdRef,
    refreshNow: jest.fn(),
    getCurrentNodeIdNow: jest.fn(() => 10),
    hasWritePermission: true,
    selectedFiles: new Set([42]),
    sortedFiles: [],
    dismissFailedItems: jest.fn(),
    setTreeUpdateTrigger: jest.fn(),
    setDropMessage: jest.fn(),
    setSelectedFiles: jest.fn(),
    setSelectionMode: jest.fn(),
    showError: jest.fn(),
    closeUploadDialog: jest.fn(),
    closeBulkDeleteDialog: jest.fn(),
    closeRenameDialog: jest.fn(),
    closeActionSheet: jest.fn(),
    setActionSheetOpen: jest.fn(),
    setActionSheetFile: jest.fn(),
    actionSheetFile: { nodeId: 42, basename: 'a.txt', type: 'file' },
    mobileRenameFile: null,
    renameNewName: 'renamed.txt',
    setRenameError: jest.fn(),
    bulkDeleteFilePaths: [42],
    ...overrides,
  };
}

describe('useExplorerCommands', () => {
  let bulkState;
  let fileOperationsState;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    bulkState = createBulkState();
    fileOperationsState = createFileOperationsState();

    useBulkOperations.mockImplementation(() => bulkState);
    useFileOperations.mockImplementation(() => fileOperationsState);
    explorerGateway.checkConflicts.mockResolvedValue([]);
    explorerGateway.uploadToPath.mockResolvedValue({ errors: [] });
    validateFileName.mockReturnValue(null);
    getValidationMessage.mockImplementation((error) => `validation:${error}`);
    showErrorFromError.mockImplementation((error, showError) => {
      showError(error?.message || 'errors.unknown');
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('stores upload conflict data when conflict preflight finds duplicates', async () => {
    explorerGateway.checkConflicts.mockResolvedValue([{ fileName: 'dup.txt' }]);
    const props = createProps();
    const file = new File(['x'], 'dup.txt', { type: 'text/plain' });

    const { result } = renderHook(() => useExplorerCommands(props));

    await act(async () => {
      await result.current.handleUploadStart([file], 10);
    });

    expect(props.closeUploadDialog).toHaveBeenCalled();
    expect(explorerGateway.checkConflicts).toHaveBeenCalledWith(
      expect.objectContaining({ parentNodeId: 10 })
    );
    expect(result.current.uploadConflictData).toEqual(
      expect.objectContaining({
        parentNodeId: 10,
      })
    );
    expect(bulkState.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({ remove: true })
    );
  });

  it('replays conflicted upload with the chosen resolution and refresh completion wiring', async () => {
    explorerGateway.checkConflicts.mockResolvedValue([{ fileName: 'dup.txt' }]);
    const props = createProps();
    const file = new File(['x'], 'dup.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useExplorerCommands(props));

    await act(async () => {
      await result.current.handleUploadStart([file], 10);
    });

    await act(async () => {
      await result.current.resolveUploadConflict('skip');
    });

    expect(explorerGateway.uploadToPath).toHaveBeenCalledWith(
      expect.objectContaining({
        parentNodeId: 10,
        onConflict: 'skip',
      })
    );
    expect(props.refreshNow).toHaveBeenCalled();
    expect(props.setTreeUpdateTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'refresh' })
    );
    expect(result.current.uploadConflictData).toBe(null);
  });

  it('reports rename validation errors without calling file rename operations', async () => {
    const props = createProps({
      mobileRenameFile: { nodeId: 42, basename: 'a.txt', type: 'file' },
      renameNewName: '   ',
    });
    validateFileName.mockReturnValue('empty');
    getValidationMessage.mockReturnValue('name is invalid');

    const { result } = renderHook(() => useExplorerCommands(props));

    await act(async () => {
      await result.current.handleRename();
    });

    expect(props.setRenameError).toHaveBeenCalledWith('name is invalid');
    expect(fileOperationsState.handleFileRename).not.toHaveBeenCalled();
  });

  it('completes rename flow by clearing errors and closing rename surfaces', async () => {
    const props = createProps({
      actionSheetFile: { nodeId: 42, basename: 'a.txt', type: 'file' },
      renameNewName: 'renamed.txt',
    });

    const { result } = renderHook(() => useExplorerCommands(props));

    await act(async () => {
      await result.current.handleRename();
    });

    expect(props.setRenameError).toHaveBeenCalledWith('');
    expect(props.closeRenameDialog).toHaveBeenCalled();
    expect(props.closeActionSheet).toHaveBeenCalled();
    expect(result.current.renameLoading).toBe(false);
  });

  it('confirms bulk delete by clearing selection and delegating the delete command', () => {
    const props = createProps({
      bulkDeleteFilePaths: [42, 43],
    });

    const { result } = renderHook(() => useExplorerCommands(props));

    act(() => {
      result.current.handleBulkDeleteConfirm();
    });

    expect(props.closeBulkDeleteDialog).toHaveBeenCalled();
    expect(props.setSelectedFiles).toHaveBeenCalledWith(new Set());
    expect(props.setSelectionMode).toHaveBeenCalledWith(false);
  });

  it('surfaces command-style validation failures through the shared error surface and rethrows', async () => {
    const props = createProps();
    const file = { nodeId: 42, basename: 'a.txt', type: 'file' };
    validateFileName.mockReturnValue('invalid');
    getValidationMessage.mockReturnValue('rename failed');

    const { result } = renderHook(() => useExplorerCommands(props));

    await expect(result.current.renameEntry(file, '???')).rejects.toThrow('rename failed');

    expect(props.showError).toHaveBeenCalledWith('rename failed');
  });

  it('derives move/copy in-progress state from picker or active bulk progress items', () => {
    bulkState = createBulkState({
      progressItems: [{ type: 'move', status: 'processing' }],
    });
    useBulkOperations.mockImplementation(() => bulkState);

    const { result } = renderHook(() => useExplorerCommands(createProps()));

    expect(result.current.folderPickerMoveCopyInProgress).toBe(true);
  });

  it('exposes an operation completion handler that invokes refresh', () => {
    const props = createProps({
      getCurrentNodeIdNow: jest.fn(() => 10),
    });

    const { result } = renderHook(() => useExplorerCommands(props));

    act(() => {
      result.current.handleOperationComplete({
        opType: 'rename',
        startedNodeId: 10,
      });
    });

    expect(props.refreshNow).toHaveBeenCalledTimes(1);
  });
});

describe('useExplorerCommands upload-queue-drain hint (useFileOperations.md §3)', () => {
  const runBatch = async (files) => {
    const props = createProps();
    const { result } = renderHook(() => useExplorerCommands(props));
    await act(async () => {
      await result.current.handleUploadStart(files, 10);
    });
    return result;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useBulkOperations.mockImplementation(() => createBulkState());
    useFileOperations.mockImplementation(() => createFileOperationsState());
    explorerGateway.checkConflicts.mockResolvedValue([]);
    explorerGateway.uploadToPath.mockResolvedValue({ errors: [] });
    validateFileName.mockReturnValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('emits exactly one hint when a fully successful batch drains', async () => {
    const fileOperationsState = useFileOperations();
    useFileOperations.mockImplementation(() => fileOperationsState);

    const file = new File(['x'], 'ok.txt', { type: 'text/plain' });
    await runBatch([{ file }]);

    expect(fileOperationsState.notifyUploadQueueDrained).toHaveBeenCalledTimes(1);
  });

  it('emits exactly one hint when every item of the batch fails', async () => {
    const fileOperationsState = useFileOperations();
    useFileOperations.mockImplementation(() => fileOperationsState);
    explorerGateway.uploadToPath.mockImplementation(async ({ onProgress }) => {
      onProgress({ currentFile: 'bad.txt', status: 'error', error: 'boom', total: 1, current: 1 });
      return { errors: [{ relativePath: 'bad.txt', error: 'boom' }] };
    });

    const file = new File(['x'], 'bad.txt', { type: 'text/plain' });
    await runBatch([{ file }]);

    expect(fileOperationsState.notifyUploadQueueDrained).toHaveBeenCalledTimes(1);
  });

  it('emits exactly one hint when the whole batch errors out', async () => {
    const fileOperationsState = useFileOperations();
    useFileOperations.mockImplementation(() => fileOperationsState);
    explorerGateway.uploadToPath.mockRejectedValue(new Error('network down'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const file = new File(['x'], 'x.txt', { type: 'text/plain' });
    await runBatch([{ file }]);

    expect(fileOperationsState.notifyUploadQueueDrained).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('emits exactly one hint when the batch is cancelled mid-flight', async () => {
    const fileOperationsState = useFileOperations();
    useFileOperations.mockImplementation(() => fileOperationsState);
    const props = createProps();
    const file = new File(['x'], 'c.txt', { type: 'text/plain' });
    const { result } = renderHook(() => useExplorerCommands(props));
    // The batch is marked cancelled while in flight — the abandon path still drains.
    explorerGateway.uploadToPath.mockImplementation(async () => {
      const [progressId] = [...result.current.explorerUploadFilesRef.current.keys()];
      result.current.explorerUploadCancelAllRequestedRef.current.add(progressId);
      return { errors: [] };
    });

    await act(async () => {
      await result.current.handleUploadStart([{ file }], 10);
    });

    expect(fileOperationsState.notifyUploadQueueDrained).toHaveBeenCalledTimes(1);
  });

  it('never fires for an empty batch (empty mount)', async () => {
    const fileOperationsState = useFileOperations();
    useFileOperations.mockImplementation(() => fileOperationsState);

    await runBatch([]);

    expect(fileOperationsState.notifyUploadQueueDrained).not.toHaveBeenCalled();
    expect(explorerGateway.uploadToPath).not.toHaveBeenCalled();
  });
});
