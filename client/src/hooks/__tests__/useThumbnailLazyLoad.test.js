/**
 * useThumbnailLazyLoad tests.
 * @see docs/spec/client/hooks/useThumbnailLazyLoad.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThumbnailLazyLoad } from '../useThumbnailLazyLoad';

jest.mock('../../services/fileService', () => ({
  requestThumbnailsBatch: jest.fn(),
}));

import * as fileService from '../../services/fileService';

const imageFile = {
  nodeId: 101,
  path: '/photos/img.jpg',
  basename: 'img.jpg',
  type: 'file',
  mime: 'image/jpeg',
};
const textFile = { nodeId: 102, path: '/doc.txt', basename: 'doc.txt', type: 'file', mime: 'text/plain' };

describe('useThumbnailLazyLoad', () => {
  let mockObserve;
  let mockCallback;
  let observedElements;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    observedElements = [];

    global.IntersectionObserver = class MockIntersectionObserver {
      constructor(callback) {
        mockCallback = callback;
      }
      observe(el) {
        observedElements.push(el);
        mockObserve = () => {
          if (el && mockCallback) {
            mockCallback([{ isIntersecting: true, target: el }]);
          }
        };
      }
      disconnect() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  it('returns containerRef', () => {
    const { result } = renderHook(() => useThumbnailLazyLoad([], () => {}));

    expect(result.current.containerRef).toBeDefined();
    expect(result.current.containerRef.current).toBe(null);
  });

  it('does not call requestThumbnailsBatch when no image/video files', async () => {
    const div = document.createElement('div');
    div.setAttribute('data-file-node-id', '102');
    document.body.appendChild(div);

    renderHook(() => useThumbnailLazyLoad([textFile], jest.fn()));

    act(() => {
      jest.advanceTimersByTime(150);
    });

    if (observedElements.length > 0 && mockObserve) {
      act(() => {
        mockObserve();
      });
      act(() => {
        jest.advanceTimersByTime(250);
      });
    }

    expect(fileService.requestThumbnailsBatch).not.toHaveBeenCalled();
  });

  it('calls requestThumbnailsBatch and onThumbnailsLoaded when image file becomes visible', async () => {
    const onThumbnailsLoaded = jest.fn();
    fileService.requestThumbnailsBatch.mockResolvedValue({
      thumbnails: [{ nodeId: 101, thumbnailUrl: 'http://thumb/img.jpg' }],
    });

    const div = document.createElement('div');
    div.setAttribute('data-file-node-id', '101');
    document.body.appendChild(div);

    renderHook(() => useThumbnailLazyLoad([imageFile], onThumbnailsLoaded));

    act(() => {
      jest.advanceTimersByTime(150);
    });

    act(() => {
      if (mockObserve) mockObserve();
    });

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(fileService.requestThumbnailsBatch).toHaveBeenCalledWith(
        [101],
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(onThumbnailsLoaded).toHaveBeenCalled();
      const [thumbnailMap] = onThumbnailsLoaded.mock.calls[0];
      expect(thumbnailMap).toBeInstanceOf(Map);
      expect(thumbnailMap.get(101)).toBe('http://thumb/img.jpg');
    });
  });

  it('debounces rapid intersection: single requestThumbnailsBatch after DEBOUNCE_MS', async () => {
    const img1 = { nodeId: 201, path: '/a/img1.jpg', basename: 'img1.jpg', type: 'file', mime: 'image/jpeg' };
    const img2 = { nodeId: 202, path: '/a/img2.jpg', basename: 'img2.jpg', type: 'file', mime: 'image/jpeg' };
    fileService.requestThumbnailsBatch.mockResolvedValue({ thumbnails: [] });

    const div1 = document.createElement('div');
    div1.setAttribute('data-file-node-id', '201');
    const div2 = document.createElement('div');
    div2.setAttribute('data-file-node-id', '202');
    document.body.appendChild(div1);
    document.body.appendChild(div2);

    renderHook(() => useThumbnailLazyLoad([img1, img2], jest.fn()));

    act(() => {
      jest.advanceTimersByTime(150);
    });

    act(() => {
      if (mockObserve) mockCallback([{ isIntersecting: true, target: div1 }]);
    });
    act(() => {
      if (mockObserve) mockCallback([{ isIntersecting: true, target: div2 }]);
    });

    expect(fileService.requestThumbnailsBatch).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(fileService.requestThumbnailsBatch).toHaveBeenCalledTimes(1);
      const [nodeIds] = fileService.requestThumbnailsBatch.mock.calls[0];
      expect(nodeIds).toContain(201);
      expect(nodeIds).toContain(202);
    });
  });

  it('does not request same nodeId twice when element intersects multiple times', async () => {
    fileService.requestThumbnailsBatch.mockResolvedValue({ thumbnails: [] });

    const div = document.createElement('div');
    div.setAttribute('data-file-node-id', '101');
    document.body.appendChild(div);

    renderHook(() => useThumbnailLazyLoad([imageFile], jest.fn()));

    act(() => {
      jest.advanceTimersByTime(150);
    });

    act(() => {
      if (mockCallback) mockCallback([{ isIntersecting: true, target: div }]);
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(fileService.requestThumbnailsBatch).toHaveBeenCalledTimes(1);
    });

    act(() => {
      if (mockCallback) mockCallback([{ isIntersecting: true, target: div }]);
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(fileService.requestThumbnailsBatch).toHaveBeenCalledTimes(1);
  });

  it('passes options to requestThumbnailsBatch when shareToken provided', async () => {
    const onThumbnailsLoaded = jest.fn();
    fileService.requestThumbnailsBatch.mockResolvedValue({ thumbnails: [] });

    const div = document.createElement('div');
    div.setAttribute('data-file-node-id', '101');
    document.body.appendChild(div);

    renderHook(() =>
      useThumbnailLazyLoad([imageFile], onThumbnailsLoaded, { shareToken: 'token123' })
    );

    act(() => {
      jest.advanceTimersByTime(150);
    });
    act(() => {
      if (mockObserve) mockObserve();
    });
    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(fileService.requestThumbnailsBatch).toHaveBeenCalledWith(
        expect.any(Array),
        { shareToken: 'token123' }
      );
    });
  });
});
