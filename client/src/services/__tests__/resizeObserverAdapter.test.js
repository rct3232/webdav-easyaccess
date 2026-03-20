import { observeElementWidth } from '../resizeObserverAdapter';

describe('resizeObserverAdapter', () => {
  const OriginalResizeObserver = global.ResizeObserver;

  afterEach(() => {
    global.ResizeObserver = OriginalResizeObserver;
    jest.clearAllMocks();
  });

  it('reports width changes from observer entries and disconnects only once', () => {
    const disconnect = jest.fn();
    let observerCallback;

    global.ResizeObserver = jest.fn(function MockResizeObserver(callback) {
      observerCallback = callback;
      this.observe = jest.fn();
      this.disconnect = disconnect;
    });

    const onWidthChange = jest.fn();
    const element = {
      getBoundingClientRect: () => ({ width: 120 }),
    };

    const cleanup = observeElementWidth(element, onWidthChange);

    expect(onWidthChange).toHaveBeenCalledWith(120);

    observerCallback([{ contentRect: { width: 240 } }]);
    expect(onWidthChange).toHaveBeenCalledWith(240);

    cleanup();
    cleanup();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op cleanup when no element is provided', () => {
    const cleanup = observeElementWidth(null, jest.fn());

    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('falls back to the current width when ResizeObserver is unavailable', () => {
    delete global.ResizeObserver;

    const onWidthChange = jest.fn();
    const cleanup = observeElementWidth(
      {
        getBoundingClientRect: () => ({ width: 80 }),
      },
      onWidthChange
    );

    expect(onWidthChange).toHaveBeenCalledWith(80);
    expect(typeof cleanup).toBe('function');
  });
});
