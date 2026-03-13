/**
 * useFileOperationProgress tests.
 * @see docs/spec/client/hooks/useFileOperationProgress.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useFileOperationProgress } from '../useFileOperationProgress';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

describe('useFileOperationProgress', () => {
  it('updateProgress adds item to progressItems', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({
        id: 'move_1',
        type: 'move',
        status: 'processing',
        name: 'Moving',
      });
    });

    expect(result.current.progressItems).toHaveLength(1);
    expect(result.current.progressItems[0]).toMatchObject({
      id: 'move_1',
      type: 'move',
      status: 'processing',
      name: 'Moving',
    });
  });

  it('updateProgress with same id updates existing item', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({ id: 'copy_1', status: 'processing', progress: 2, total: 5 });
    });
    act(() => {
      result.current.updateProgress({ id: 'copy_1', status: 'processing', progress: 4, total: 5 });
    });

    expect(result.current.progressItems).toHaveLength(1);
    expect(result.current.progressItems[0].progress).toBe(4);
    expect(result.current.progressItems[0].total).toBe(5);
  });

  it('updateProgress with remove:true removes item', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({ id: 'del_1', type: 'delete', status: 'completed' });
    });
    expect(result.current.progressItems).toHaveLength(1);

    act(() => {
      result.current.updateProgress({ id: 'del_1', remove: true });
    });

    expect(result.current.progressItems).toHaveLength(0);
  });

  it('merge preserves error status over completed', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({ id: 'op_1', status: 'error', error: 'Failed' });
    });
    act(() => {
      result.current.updateProgress({ id: 'op_1', status: 'completed' });
    });

    expect(result.current.progressItems[0].status).toBe('error');
  });

  it('merge preserves warning over completed', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({ id: 'op_2', status: 'warning', error: 'Partial' });
    });
    act(() => {
      result.current.updateProgress({ id: 'op_2', status: 'completed' });
    });

    expect(result.current.progressItems[0].status).toBe('warning');
  });

  it('fileItems delta merge for upload batch', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({
        id: 'upload_1',
        type: 'upload',
        status: 'processing',
        fileItems: [
          { fileName: 'a.txt', status: 'processing' },
          { fileName: 'b.txt', status: 'pending' },
        ],
      });
    });

    act(() => {
      result.current.updateProgress({
        id: 'upload_1',
        status: 'processing',
        updatedFileItem: { fileName: 'a.txt', status: 'completed' },
      });
    });

    expect(result.current.progressItems[0].fileItems).toHaveLength(2);
    const aItem = result.current.progressItems[0].fileItems.find((f) => f.fileName === 'a.txt');
    expect(aItem.status).toBe('completed');
  });

  it('clearAllProgress empties progressItems', () => {
    const { result } = renderHook(() => useFileOperationProgress());

    act(() => {
      result.current.updateProgress({ id: 'x', type: 'move' });
      result.current.updateProgress({ id: 'y', type: 'copy' });
    });
    expect(result.current.progressItems).toHaveLength(2);

    act(() => {
      result.current.clearAllProgress();
    });

    expect(result.current.progressItems).toHaveLength(0);
  });
});
