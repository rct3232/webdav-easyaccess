/**
 * bulkJobPoller tests — useBulkOperations.md §2.6.1.
 * @see docs/TESTING_STRATEGY.md
 */
import { BULK_POLL_BACKOFF_MS, BULK_POLL_INTERVAL_MS, createBulkJobPoller } from '../bulkJobPoller';

const RUNNING = { status: 'running', progress: 1, total: 3, results: [] };
const COMPLETED = {
  status: 'completed',
  progress: 3,
  total: 3,
  results: [{ nodeId: 1, status: 'succeeded' }],
};

function createPoller(overrides = {}) {
  const fetchStatus = overrides.fetchStatus ?? jest.fn().mockResolvedValue(RUNNING);
  const poller = createBulkJobPoller({
    jobId: 'job-1',
    fetchStatus,
    onSnapshot: jest.fn(),
    onTerminal: jest.fn(),
    onStalled: jest.fn(),
    ...overrides,
  });
  return { poller, fetchStatus };
}

async function flushMicrotasks() {
  // The poller chains promise reads; a bounded flush is enough for the mocked
  // fetch seam (no real I/O in these tests).
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

async function tick(ms = 0) {
  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('bulkJobPoller scheduling', () => {
  it('reads immediately, reports every snapshot and stops on a terminal job', async () => {
    const onSnapshot = jest.fn();
    const onTerminal = jest.fn();
    const fetchStatus = jest.fn().mockResolvedValueOnce(RUNNING).mockResolvedValueOnce(COMPLETED);
    const { poller } = createPoller({ fetchStatus, onSnapshot, onTerminal });

    poller.start();
    await tick(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenLastCalledWith(RUNNING);

    await tick(BULK_POLL_INTERVAL_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith(COMPLETED);

    // Terminal stops the chain: no further reads no matter how long we wait.
    await tick(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('passes the explicit status timeout through the fetch seam', async () => {
    const { poller, fetchStatus } = createPoller();
    poller.start();
    await tick(0);

    const [, options] = fetchStatus.mock.calls[0];
    expect(options.timeout).toBe(10_000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('never overlaps requests (single in-flight guard)', async () => {
    let resolveFirst;
    const fetchStatus = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValue(COMPLETED);
    const { poller } = createPoller({ fetchStatus });

    poller.start();
    await tick(0);
    // A forced check and the interval tick while the first read is in flight.
    poller.checkNow();
    await tick(BULK_POLL_INTERVAL_MS * 10);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    resolveFirst(RUNNING);
    await tick(0);
    await tick(BULK_POLL_INTERVAL_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});

describe('bulkJobPoller failure budget', () => {
  it('stalls after five consecutive read failures with the documented backoff', async () => {
    const { poller, fetchStatus } = createPoller({
      fetchStatus: jest.fn().mockRejectedValue(new Error('network down')),
    });

    poller.start();
    await tick(0);
    expect(fetchStatus).toHaveBeenCalledTimes(1); // failure 1

    for (let i = 0; i < 4; i += 1) {
      await tick(BULK_POLL_BACKOFF_MS[i]);
    }
    expect(fetchStatus).toHaveBeenCalledTimes(5);
    expect(poller.isFinished()).toBe(true);

    await tick(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(5);
  });

  it('calls onStalled exactly once with the failures reason', async () => {
    const onStalled = jest.fn();
    const { poller } = createPoller({
      fetchStatus: jest.fn().mockRejectedValue(new Error('network down')),
      onStalled,
    });

    poller.start();
    await tick(0);
    for (let i = 0; i < 4; i += 1) {
      await tick(BULK_POLL_BACKOFF_MS[i]);
    }

    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(onStalled.mock.calls[0][0]).toMatchObject({ reason: 'failures' });
    expect(onStalled.mock.calls[0][0].failureCount).toBe(5);
  });

  it('resets the failure counter after a successful read', async () => {
    const fetchStatus = jest
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(RUNNING)
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'));
    const onStalled = jest.fn();
    const { poller } = createPoller({ fetchStatus, onStalled });

    poller.start();
    await tick(0);
    for (let i = 0; i < 4; i += 1) {
      await tick(BULK_POLL_BACKOFF_MS[i]);
    }
    // 4 failures + 1 success (the fifth fetch) — not stalled yet.
    expect(onStalled).not.toHaveBeenCalled();

    await tick(BULK_POLL_INTERVAL_MS);
    for (let i = 0; i < 4; i += 1) {
      await tick(BULK_POLL_BACKOFF_MS[i]);
    }
    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledTimes(10);
  });

  it('treats a 404 as an immediate expired stall (no retry)', async () => {
    const error = Object.assign(new Error('not found'), { response: { status: 404 } });
    const fetchStatus = jest.fn().mockRejectedValue(error);
    const onStalled = jest.fn();
    const { poller } = createPoller({ fetchStatus, onStalled });

    poller.start();
    await tick(0);

    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(onStalled.mock.calls[0][0]).toMatchObject({ reason: 'expired' });
    await tick(60_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('a throwing snapshot callback is not counted as a read failure', async () => {
    const fetchStatus = jest
      .fn()
      .mockResolvedValueOnce(RUNNING)
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(COMPLETED);
    const onSnapshot = jest.fn(() => {
      throw new Error('host callback bug');
    });
    const onStalled = jest.fn();
    const onTerminal = jest.fn();
    const { poller } = createPoller({ fetchStatus, onSnapshot, onStalled, onTerminal });

    poller.start();
    await tick(0);
    await tick(BULK_POLL_INTERVAL_MS);
    await tick(BULK_POLL_BACKOFF_MS[0]);

    expect(onStalled).not.toHaveBeenCalled();
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });
});

describe('bulkJobPoller forced check + dispose', () => {
  it('checkNow forces one immediate read without waiting for the interval', async () => {
    const fetchStatus = jest.fn().mockResolvedValueOnce(RUNNING).mockResolvedValueOnce(COMPLETED);
    const onTerminal = jest.fn();
    const { poller } = createPoller({ fetchStatus, onTerminal });

    poller.start();
    await tick(0);
    await poller.checkNow();

    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(onTerminal).toHaveBeenCalledWith(COMPLETED);
  });

  it('checkNow({ failFast }) turns one read failure into the stalled state', async () => {
    const onStalled = jest.fn();
    const { poller } = createPoller({
      fetchStatus: jest.fn().mockRejectedValue(new Error('down')),
      onStalled,
    });

    poller.start();
    await tick(0);
    // First read failed once; normally 4 more attempts are allowed.
    expect(onStalled).not.toHaveBeenCalled();

    await poller.checkNow({ failFast: true });
    expect(onStalled).toHaveBeenCalledTimes(1);
    expect(onStalled.mock.calls[0][0]).toMatchObject({ reason: 'failures' });
  });

  it('dispose stops the chain and aborts the in-flight request', async () => {
    let capturedSignal;
    const fetchStatus = jest.fn(
      (jobId, options) =>
        new Promise((_resolve) => {
          capturedSignal = options.signal;
        })
    );
    const onTerminal = jest.fn();
    const { poller } = createPoller({ fetchStatus, onTerminal });

    poller.start();
    await tick(0);
    expect(capturedSignal.aborted).toBe(false);

    poller.dispose();
    expect(capturedSignal.aborted).toBe(true);
    await tick(60_000);

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('a terminal job never re-fires from a later forced check', async () => {
    const onTerminal = jest.fn();
    const { poller } = createPoller({
      fetchStatus: jest.fn().mockResolvedValue(COMPLETED),
      onTerminal,
    });

    poller.start();
    await tick(0);
    await poller.checkNow();
    await poller.checkNow();

    expect(onTerminal).toHaveBeenCalledTimes(1);
  });
});
