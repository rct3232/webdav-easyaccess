'use strict';

/**
 * backfill pipeline (aiJobService.md §2.4): a claimed `backfill` row asks the
 * active vectorStore seam for ONE shadow rebuild, then marks the job done. No
 * provider calls and no enqueues; failures go through the shared drain catch
 * (markFailed → backoff) and a re-run after success finds nothing claimable.
 */

const { runPendingBackfillJobs } = require('../pipelines/backfill');

function makeJobs(rows = []) {
  const queue = [...rows];
  return {
    claimNext: jest.fn(async () => queue.shift() || null),
    markDone: jest.fn(async () => ({ changes: 1 })),
    markFailed: jest.fn(async () => ({ changes: 1 })),
    enqueue: jest.fn(async () => null),
  };
}

describe('backfill pipeline (§2.4)', () => {
  it('one claimed backfill job → rebuildShadow once + markDone, no provider calls/enqueues', async () => {
    const jobs = makeJobs([{ id: 11, kind: 'backfill', nodeId: 90 }]);
    const vectorStore = { rebuildShadow: jest.fn(async () => undefined) };
    const adapter = { embed: jest.fn(), chat: jest.fn() };

    const done = await runPendingBackfillJobs({ aiJobsStore: jobs, vectorStore, adapter });

    expect(done).toBe(1);
    expect(vectorStore.rebuildShadow).toHaveBeenCalledTimes(1);
    expect(jobs.markDone).toHaveBeenCalledWith(11);
    expect(jobs.markFailed).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(adapter.embed).not.toHaveBeenCalled();
    expect(adapter.chat).not.toHaveBeenCalled();
  });

  it('a rebuild throw → markFailed (backoff armed), never markDone, and the drain continues', async () => {
    const jobs = makeJobs([
      { id: 21, kind: 'backfill' },
      { id: 22, kind: 'backfill' },
    ]);
    let call = 0;
    const vectorStore = {
      rebuildShadow: jest.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('shadow rebuild exploded');
      }),
    };
    const warn = jest.fn();

    const done = await runPendingBackfillJobs({
      aiJobsStore: jobs,
      vectorStore,
      log: { warn },
    });

    expect(done).toBe(1);
    expect(vectorStore.rebuildShadow).toHaveBeenCalledTimes(2);
    expect(jobs.markFailed).toHaveBeenCalledTimes(1);
    expect(jobs.markFailed).toHaveBeenCalledWith(21, 'shadow rebuild exploded');
    expect(jobs.markDone).toHaveBeenCalledWith(22);
    expect(warn).toHaveBeenCalled();
  });

  it('re-running after success does nothing new (no claimable row → zero rebuilds)', async () => {
    const jobs = makeJobs([{ id: 31, kind: 'backfill' }]);
    const vectorStore = { rebuildShadow: jest.fn(async () => undefined) };

    expect(await runPendingBackfillJobs({ aiJobsStore: jobs, vectorStore })).toBe(1);
    expect(await runPendingBackfillJobs({ aiJobsStore: jobs, vectorStore })).toBe(0);
    expect(vectorStore.rebuildShadow).toHaveBeenCalledTimes(1);
    expect(jobs.markDone).toHaveBeenCalledTimes(1);
  });

  it('no installed vectorStore ⇒ the kind parks (no claim, no attempt inflation)', async () => {
    const jobs = makeJobs([{ id: 41, kind: 'backfill' }]);
    expect(await runPendingBackfillJobs({ aiJobsStore: jobs, vectorStore: null })).toBe(0);
    expect(jobs.claimNext).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });
});
