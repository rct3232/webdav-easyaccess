'use strict';

/**
 * aiJobsStore facade test (docs/spec/server/store/aiJobsStore.md §2.1).
 * L1: the facade is a thin dialect dispatch — observable behavior only.
 * Includes the restart-survival scenario with a REAL persistence boundary:
 * the sqlite handle is closed and lazily reopened (the process-level state a
 * restart drops), and the queue must still resume exactly (aiJobsStore §1
 * "DB-backed only: jobs survive restarts, the worker is stateless").
 */

const { createTestDatabase, createTestFileNode, isSqliteBackend } = require('@server/test-utils');
const storage = require('@server/store/storage');
const aiJobsStore = require('@server/store/aiJobsStore');

describe('aiJobsStore facade', () => {
  let dbCleanup;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueNode = (name) =>
    createTestFileNode({ name: name || `facade-job-${Date.now()}-${Math.random()}.txt` });

  it('delegates the full lifecycle: enqueue → claim → markDone', async () => {
    const node = await uniqueNode();

    const enqueued = await aiJobsStore.enqueue(node.nodeId, 'embed', 1, 'hash-facade');
    expect(enqueued).not.toBeNull();

    // Dedupe contract surfaces through the facade unchanged.
    await expect(aiJobsStore.enqueue(node.nodeId, 'embed', 1)).resolves.toBeNull();

    const job = await aiJobsStore.claimNext();
    expect(job).toMatchObject({ nodeId: Number(node.nodeId), kind: 'embed', status: 'running' });

    await expect(aiJobsStore.markDone(job.id)).resolves.toEqual({ changes: 1 });

    const counts = await aiJobsStore.countByStatus();
    expect(counts).toMatchObject({
      pending: expect.any(Number),
      running: expect.any(Number),
      done: expect.any(Number),
      failed: expect.any(Number),
      skipped: expect.any(Number),
    });

    const history = await aiJobsStore.listByNode(node.nodeId);
    expect(history.map((entry) => entry.id)).toContain(job.id);
    await expect(aiJobsStore.getById(job.id)).resolves.toMatchObject({ status: 'done' });
  });

  it('restart survival: jobs persist across a closed/reopened database and resume via recoverStaleRunning', async () => {
    const node = await uniqueNode();
    const enqueued = await aiJobsStore.enqueue(node.nodeId, 'embed', 1, 'hash-restart');
    const claimed = await aiJobsStore.claimNext();
    expect(claimed.id).toBe(Number(enqueued.id));

    if (isSqliteBackend()) {
      // Simulate the restart: drop the process-level DB handle; the next
      // store call reopens the SAME persisted file.
      await storage.closeSqliteDb();
    }

    // The abandoned running row survives and is reaped → failed, re-claimable.
    const reaped = await aiJobsStore.recoverStaleRunning(0);
    expect(reaped.changes).toBe(1);

    const resumed = await aiJobsStore.claimNext();
    expect(resumed).not.toBeNull();
    expect(resumed.id).toBe(Number(enqueued.id));
    expect(resumed.contentHash).toBe('hash-restart');

    // Idempotent enqueue after the restart: dedupe holds (exactly-once per generation).
    await expect(aiJobsStore.enqueue(node.nodeId, 'embed', 1)).resolves.toBeNull();

    await aiJobsStore.markDone(resumed.id);
    const failed = await aiJobsStore.listFailed({ limit: 5 });
    expect(failed.every((entry) => entry.status === 'failed')).toBe(true);
  });

  it('markSkipped and markFailed honor the guarded-flip contract through the facade', async () => {
    const node = await uniqueNode();
    await aiJobsStore.enqueue(node.nodeId, 'caption', 1);
    const job = await aiJobsStore.claimNext();

    await expect(aiJobsStore.markSkipped(job.id, 'overlength_skip')).resolves.toEqual({
      changes: 1,
    });
    await expect(aiJobsStore.getById(job.id)).resolves.toMatchObject({
      status: 'skipped',
      lastError: 'overlength_skip',
    });

    // Non-running flips are no-ops.
    await expect(aiJobsStore.markFailed(job.id, 'late')).resolves.toEqual({ changes: 0 });
  });
});
