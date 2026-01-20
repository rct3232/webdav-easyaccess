import { renderHook, act } from '@testing-library/react';
import { useFileOperationProgress } from '../useFileOperationProgress';

describe('useFileOperationProgress', () => {
  describe('Initial State', () => {
    it('should initialize with empty progressItems', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      expect(result.current.progressItems).toEqual([]);
      expect(typeof result.current.updateProgress).toBe('function');
      expect(typeof result.current.clearAllProgress).toBe('function');
    });
  });

  describe('updateProgress', () => {
    it('should add a new progress item', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      const progressItem = {
        id: 'test-1',
        type: 'move',
        status: 'processing',
        progress: 1,
        total: 10,
        current: '(1/10) 이동중...',
        name: '10개 항목 이동',
      };

      act(() => {
        result.current.updateProgress(progressItem);
      });

      expect(result.current.progressItems).toHaveLength(1);
      expect(result.current.progressItems[0]).toEqual(progressItem);
    });

    it('should update an existing progress item', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      const initialItem = {
        id: 'test-1',
        type: 'copy',
        status: 'preparing',
        progress: 0,
        total: 5,
        current: '준비 중...',
        name: '5개 항목 복사',
      };

      act(() => {
        result.current.updateProgress(initialItem);
      });

      expect(result.current.progressItems).toHaveLength(1);

      const updatedItem = {
        id: 'test-1',
        type: 'copy',
        status: 'processing',
        progress: 3,
        total: 5,
        current: '(3/5) 복사중...',
        name: '5개 항목 복사',
      };

      act(() => {
        result.current.updateProgress(updatedItem);
      });

      expect(result.current.progressItems).toHaveLength(1);
      expect(result.current.progressItems[0]).toEqual(updatedItem);
      expect(result.current.progressItems[0].progress).toBe(3);
      expect(result.current.progressItems[0].status).toBe('processing');
    });

    it('should handle multiple progress items', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      const item1 = {
        id: 'move-1',
        type: 'move',
        status: 'processing',
        progress: 5,
        total: 10,
      };

      const item2 = {
        id: 'copy-1',
        type: 'copy',
        status: 'preparing',
        progress: 0,
        total: 20,
      };

      act(() => {
        result.current.updateProgress(item1);
        result.current.updateProgress(item2);
      });

      expect(result.current.progressItems).toHaveLength(2);
      expect(result.current.progressItems[0].id).toBe('move-1');
      expect(result.current.progressItems[1].id).toBe('copy-1');
    });

    it('should remove progress item when remove flag is true', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      const item = {
        id: 'delete-1',
        type: 'delete',
        status: 'completed',
        progress: 10,
        total: 10,
      };

      act(() => {
        result.current.updateProgress(item);
      });

      expect(result.current.progressItems).toHaveLength(1);

      act(() => {
        result.current.updateProgress({ id: 'delete-1', remove: true });
      });

      expect(result.current.progressItems).toHaveLength(0);
    });

    it('should only remove the specified item', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      act(() => {
        result.current.updateProgress({ id: 'item-1', type: 'move', status: 'processing' });
        result.current.updateProgress({ id: 'item-2', type: 'copy', status: 'processing' });
        result.current.updateProgress({ id: 'item-3', type: 'delete', status: 'processing' });
      });

      expect(result.current.progressItems).toHaveLength(3);

      act(() => {
        result.current.updateProgress({ id: 'item-2', remove: true });
      });

      expect(result.current.progressItems).toHaveLength(2);
      expect(result.current.progressItems.find(i => i.id === 'item-1')).toBeDefined();
      expect(result.current.progressItems.find(i => i.id === 'item-2')).toBeUndefined();
      expect(result.current.progressItems.find(i => i.id === 'item-3')).toBeDefined();
    });

    it('should union skippedPaths and keep warning over completed', () => {
      const { result } = renderHook(() => useFileOperationProgress());

      act(() => {
        result.current.updateProgress({
          id: 'op-1',
          type: 'move',
          status: 'warning',
          error: '권한으로 제외된 항목: 1개',
          skippedPaths: ['/a/b'],
          skippedCount: 2,
          skippedTruncated: true,
        });
      });

      act(() => {
        // Later update tries to mark completed and adds another skipped path
        result.current.updateProgress({
          id: 'op-1',
          status: 'completed',
          skippedPaths: ['/a/c'],
          skippedCount: 1,
        });
      });

      expect(result.current.progressItems).toHaveLength(1);
      const item = result.current.progressItems[0];
      expect(item.status).toBe('warning');
      expect(item.skippedPaths.sort()).toEqual(['/a/b', '/a/c'].sort());
      expect(item.skippedCount).toBe(2);
      expect(item.skippedTruncated).toBe(true);
    });
  });

  describe('clearAllProgress', () => {
    it('should clear all progress items', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      act(() => {
        result.current.updateProgress({ id: 'item-1', type: 'move' });
        result.current.updateProgress({ id: 'item-2', type: 'copy' });
        result.current.updateProgress({ id: 'item-3', type: 'delete' });
      });

      expect(result.current.progressItems).toHaveLength(3);

      act(() => {
        result.current.clearAllProgress();
      });

      expect(result.current.progressItems).toHaveLength(0);
    });

    it('should work when progress items is already empty', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      expect(result.current.progressItems).toHaveLength(0);

      act(() => {
        result.current.clearAllProgress();
      });

      expect(result.current.progressItems).toHaveLength(0);
    });
  });

  describe('Progress Lifecycle', () => {
    it('should handle a complete operation lifecycle', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      // Start operation
      act(() => {
        result.current.updateProgress({
          id: 'upload-1',
          type: 'upload',
          status: 'preparing',
          progress: 0,
          total: 3,
          current: '준비 중...',
          name: '3개 파일 업로드',
        });
      });

      expect(result.current.progressItems).toHaveLength(1);
      expect(result.current.progressItems[0].status).toBe('preparing');

      // Update progress
      act(() => {
        result.current.updateProgress({
          id: 'upload-1',
          type: 'upload',
          status: 'processing',
          progress: 1,
          total: 3,
          current: '(1/3) 업로드중...',
          name: '3개 파일 업로드',
        });
      });

      expect(result.current.progressItems[0].status).toBe('processing');
      expect(result.current.progressItems[0].progress).toBe(1);

      // Complete operation
      act(() => {
        result.current.updateProgress({
          id: 'upload-1',
          type: 'upload',
          status: 'completed',
          progress: 3,
          total: 3,
          current: '완료',
          name: '3개 파일 업로드',
        });
      });

      expect(result.current.progressItems[0].status).toBe('completed');
      expect(result.current.progressItems[0].progress).toBe(3);

      // Remove after completion
      act(() => {
        result.current.updateProgress({ id: 'upload-1', remove: true });
      });

      expect(result.current.progressItems).toHaveLength(0);
    });

    it('should handle error state', () => {
      const { result } = renderHook(() => useFileOperationProgress());
      
      act(() => {
        result.current.updateProgress({
          id: 'failed-op',
          type: 'move',
          status: 'error',
          progress: 5,
          total: 10,
          error: '권한 오류',
          name: '파일 이동',
        });
      });

      expect(result.current.progressItems[0].status).toBe('error');
      expect(result.current.progressItems[0].error).toBe('권한 오류');
    });
  });
});

