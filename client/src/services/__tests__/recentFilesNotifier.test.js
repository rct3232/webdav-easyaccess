/**
 * recentFilesNotifier tests.
 */
import {
  onRecentFilesChange,
  notifyRecentFilesChange,
} from '../recentFilesNotifier';

describe('recentFilesNotifier', () => {
  let unsubscribeFns = [];

  beforeEach(() => {
    unsubscribeFns = [];
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    unsubscribeFns.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // ignore
      }
    });
    unsubscribeFns = [];
    console.error.mockRestore?.();
  });

  it('registers a listener and unsubscribe removes it', () => {
    const cb = jest.fn();
    const unsub = onRecentFilesChange(cb);
    unsubscribeFns.push(unsub);

    notifyRecentFilesChange();
    expect(cb).toHaveBeenCalledTimes(1);

    cb.mockClear();
    unsub();

    notifyRecentFilesChange();
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe is safe to call twice', () => {
    const cb = jest.fn();
    const unsub = onRecentFilesChange(cb);
    unsubscribeFns.push(unsub);

    unsub();
    expect(() => unsub()).not.toThrow();

    notifyRecentFilesChange();
    expect(cb).not.toHaveBeenCalled();
  });

  it('invokes all subscribers', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const unsub1 = onRecentFilesChange(cb1);
    const unsub2 = onRecentFilesChange(cb2);
    unsubscribeFns.push(unsub1, unsub2);

    notifyRecentFilesChange();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('one subscriber throwing does not break others', () => {
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();

    const unsubBad = onRecentFilesChange(bad);
    const unsubGood = onRecentFilesChange(good);
    unsubscribeFns.push(unsubBad, unsubGood);

    notifyRecentFilesChange();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

