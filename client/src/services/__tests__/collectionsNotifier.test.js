/**
 * collectionsNotifier tests.
 * @see docs/spec/client/services/collectionsNotifier.md
 */
import { onCollectionsChange, notifyCollectionsChange } from '../collectionsNotifier';

describe('collectionsNotifier', () => {
  it('registers a listener and returns an unsubscribe function that removes it', () => {
    const callback = jest.fn();
    const unsubscribe = onCollectionsChange(callback);

    expect(typeof unsubscribe).toBe('function');
    notifyCollectionsChange();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyCollectionsChange();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stays safe when invoked twice', () => {
    const callback = jest.fn();
    const unsubscribe = onCollectionsChange(callback);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    notifyCollectionsChange();
    expect(callback).not.toHaveBeenCalled();
  });

  it('invokes multiple subscribers on notify', () => {
    const a = jest.fn();
    const b = jest.fn();
    const unsubA = onCollectionsChange(a);
    const unsubB = onCollectionsChange(b);

    notifyCollectionsChange();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();

    notifyCollectionsChange();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('one subscriber throwing does not break fan-out', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const bad = jest.fn(() => {
      throw new Error('subscriber boom');
    });
    const good = jest.fn();
    const unsubBad = onCollectionsChange(bad);
    const unsubGood = onCollectionsChange(good);

    expect(() => notifyCollectionsChange()).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();

    unsubBad();
    unsubGood();
    consoleError.mockRestore();
  });
});
