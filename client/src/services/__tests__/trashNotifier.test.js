/**
 * trashNotifier tests.
 * Verifies the pub-sub seam per spec: docs/spec/client/services/trashNotifier.md
 * @see docs/TESTING_STRATEGY.md
 */
import { notifyTrashChanged, subscribeToTrashChanged } from '../trashNotifier';

describe('trashNotifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('notifyTrashChanged invokes every subscriber exactly once per call', () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsub1 = subscribeToTrashChanged(first);
    subscribeToTrashChanged(second);

    notifyTrashChanged();
    notifyTrashChanged();

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    unsub1();
  });

  it('subscriber errors do not break fan-out', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failing = jest.fn(() => {
      throw new Error('boom');
    });
    const healthy = jest.fn();
    const unsubFail = subscribeToTrashChanged(failing);
    subscribeToTrashChanged(healthy);

    expect(() => notifyTrashChanged()).not.toThrow();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    unsubFail();
  });

  it('unsubscribe stops later notifications', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToTrashChanged(listener);

    unsubscribe();
    notifyTrashChanged();

    expect(listener).not.toHaveBeenCalled();
  });
});
