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
  path: '/photos/img.jpg',
  basename: 'img.jpg',
  type: 'file',
  mime: 'image/jpeg',
};
const textFile = { path: '/doc.txt', basename: 'doc.txt', type: 'file', mime: 'text/plain' };

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
    div.setAttribute('data-file-path', '/doc.txt');
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
      thumbnails: [{ path: '/photos/img.jpg', thumbnailUrl: 'http://thumb/img.jpg' }],
    });

    const div = document.createElement('div');
    div.setAttribute('data-file-path', '/photos/img.jpg');
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
        ['/photos/img.jpg'],
        expect.any(Object)
      );
    });

    await waitFor(() => {
      expect(onThumbnailsLoaded).toHaveBeenCalled();
      const [thumbnailMap] = onThumbnailsLoaded.mock.calls[0];
      expect(thumbnailMap).toBeInstanceOf(Map);
      expect(thumbnailMap.get('/photos/img.jpg')).toBe('http://thumb/img.jpg');
    });
  });

  it('debounces rapid intersection: single requestThumbnailsBatch after DEBOUNCE_MS', async () => {
    const img1 = { path: '/a/img1.jpg', basename: 'img1.jpg', type: 'file', mime: 'image/jpeg' };
    const img2 = { path: '/a/img2.jpg', basename: 'img2.jpg', type: 'file', mime: 'image/jpeg' };
    fileService.requestThumbnailsBatch.mockResolvedValue({ thumbnails: [] });

    const div1 = document.createElement('div');
    div1.setAttribute('data-file-path', '/a/img1.jpg');
    const div2 = document.createElement('div');
    div2.setAttribute('data-file-path', '/a/img2.jpg');
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
      const [paths] = fileService.requestThumbnailsBatch.mock.calls[0];
      expect(paths).toContain('/a/img1.jpg');
      expect(paths).toContain('/a/img2.jpg');
    });
  });

  it('does not request same path twice when element intersects multiple times', async () => {
    fileService.requestThumbnailsBatch.mockResolvedValue({ thumbnails: [] });

    const div = document.createElement('div');
    div.setAttribute('data-file-path', '/photos/img.jpg');
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
    div.setAttribute('data-file-path', '/photos/img.jpg');
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
