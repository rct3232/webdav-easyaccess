'use strict';

/**
 * AiJobsRepository L2 conformance (docs/spec/server/store/aiJobsStore.md §2.9).
 * Runs against the ACTIVE backend via createTestDatabase() (sqlite default
 * leg; real PG adapter leg). Covers enqueue dedupe/generations, claim
 * semantics + ordering, the guarded status flips, the backoff ladder, stale
 * reap restart survival, enqueueMany, countByStatus/listFailed and the
 * node-purge cascade.
 */

const { createTestDatabase, createTestFileNode, dbQuery, dbRun } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createAiJobsRepository = require('@server/store/repositories/AiJobsRepository');

describe('AiJobsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createAiJobsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueNode = async (name) =>
    createTestFileNode({ name: name || `job-${Date.now()}-${(seq += 1)}.txt` });

  // The suite shares one DB; tests that assert an EMPTY/fully-controlled queue
  // wipe the table first (claimNext → null and reap-count assertions).
  const clearJobs = () => dbRun('DELETE FROM ai_jobs');

  const backdateNextRetry = async (jobId) => {
    await dbRun('UPDATE ai_jobs SET next_retry_at = ? WHERE id = ?', [
      new Date(Date.now() - 60_000).toISOString(),
      Number(jobId),
    ]);
  };

  const readRow = async (jobId) => {
    const { rows } = await dbQuery('SELECT * FROM ai_jobs WHERE id = ?', [Number(jobId)]);
    return rows[0] || null;
  };

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('enqueue inserts once; duplicate (node,kind,generation) → null, one row total', async () => {
    const node = await uniqueNode();
    const first = await repo.enqueue(node.nodeId, 'embed', 1, 'hash-a');
    expect(first).not.toBeNull();
    expect(Number(first.id)).toBeGreaterThan(0);

    const second = await repo.enqueue(node.nodeId, 'embed', 1, 'hash-a');
    expect(second).toBeNull();

    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM ai_jobs WHERE node_id = ? AND kind = ? AND generation = ?',
      [Number(node.nodeId), 'embed', 1]
    );
    expect(Number(rows[0].cnt)).toBe(1);
  });

  it('same (node,kind) with generation+1 → a NEW row (UNIQUE is per-generation)', async () => {
    const node = await uniqueNode();
    const one = await repo.enqueue(node.nodeId, 'embed', 1);
    const two = await repo.enqueue(node.nodeId, 'embed', 2);
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(Number(two.id)).not.toBe(Number(one.id));
  });

  it('enqueue on an unknown node rejects (FK enforced)', async () => {
    await expect(repo.enqueue(999999999, 'embed', 1)).rejects.toBeDefined();
  });

  it('claimNext on an empty queue → null', async () => {
    await clearJobs();
    await expect(repo.claimNext()).resolves.toBeNull();
  });

  it('claim moves pending → running with started_at set, oldest id first', async () => {
    const nodeA = await uniqueNode();
    const nodeB = await uniqueNode();
    const first = await repo.enqueue(nodeA.nodeId, 'embed', 1);
    const second = await repo.enqueue(nodeB.nodeId, 'embed', 1);

    const claim1 = await repo.claimNext();
    expect(claim1.id).toBe(Number(first.id));
    expect(claim1.status).toBe('running');
    expect(claim1.startedAt).toBeTruthy();
    expect(Number.isNaN(new Date(claim1.startedAt).getTime())).toBe(false);

    const claim2 = await repo.claimNext();
    expect(claim2.id).toBe(Number(second.id));
  });

  it('claimNext skips failed rows with a future next_retry_at and picks them once past it', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'features', 1);
    await repo.claimNext();
    await repo.markFailed(job.id, 'boom');

    // 30s ladder ⇒ still in the future: not claimable.
    await expect(repo.claimNext()).resolves.toBeNull();

    await backdateNextRetry(job.id);
    const claimed = await repo.claimNext();
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe(Number(job.id));
  });

  it('claimNext({ excludeKinds }) parks the listed kinds entirely (zero attempt inflation) and drains once the filter is removed', async () => {
    await clearJobs();
    const nodeA = await uniqueNode();
    const nodeB = await uniqueNode();
    const parkedJob = await repo.enqueue(nodeA.nodeId, 'embed', 1);

    // The excluded kind is fully parked: no claimable row.
    await expect(repo.claimNext({ excludeKinds: ['embed'] })).resolves.toBeNull();

    const drainJob = await repo.enqueue(nodeB.nodeId, 'features', 1);
    const claimed = await repo.claimNext({ excludeKinds: ['embed'] });
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe(Number(drainJob.id));
    expect(claimed.kind).toBe('features');

    // Park&drain: the parked kind's rows are untouched — no status flip,
    // no attempt inflation, no started_at.
    const parkedRow = await readRow(parkedJob.id);
    expect(parkedRow.status).toBe('pending');
    expect(parkedRow.attempt).toBe(0);
    expect(parkedRow.started_at).toBeNull();

    // Removing the filter drains the parked kind in id ASC order.
    const drained = await repo.claimNext();
    expect(drained).not.toBeNull();
    expect(drained.id).toBe(Number(parkedJob.id));
    expect(drained.kind).toBe('embed');
  });

  it('claimNext({ excludeKinds }) also parks due failed rows of the excluded kind (same untouched row)', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const failedJob = await repo.enqueue(node.nodeId, 'embed', 1);
    const claimed = await repo.claimNext();
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe(Number(failedJob.id));
    await repo.markFailed(claimed.id, 'transient');

    // Due again only after backoff; park it via the filter and read the row.
    await backdateNextRetry(failedJob.id);
    const parked = await repo.claimNext({ excludeKinds: ['embed'] });
    expect(parked).toBeNull();
    const row = await readRow(failedJob.id);
    expect(row.status).toBe('failed');
    expect(row.attempt).toBe(1);

    // Draining claims it immediately.
    const drained = await repo.claimNext();
    expect(drained).not.toBeNull();
    expect(drained.id).toBe(Number(failedJob.id));
    expect(drained.attempt).toBe(1);
  });

  it('claimNext({ excludeKinds: [] }) restores the exact zero-arg contract', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 1);
    const withEmptyFilter = await repo.claimNext({ excludeKinds: [] });
    expect(withEmptyFilter).not.toBeNull();
    expect(withEmptyFilter.id).toBe(Number(job.id));
    const row = await readRow(job.id);
    expect(row.status).toBe('running');
  });

  it('markDone / markFailed / markSkipped on a non-running row → { changes: 0 }', async () => {
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'caption', 1);

    await expect(repo.markDone(job.id)).resolves.toEqual({ changes: 0 });
    await expect(repo.markFailed(job.id, 'x')).resolves.toEqual({ changes: 0 });
    await expect(repo.markSkipped(job.id, 'y')).resolves.toEqual({ changes: 0 });
  });

  it('markDone finishes a running job; finished rows are never re-claimable', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'asr', 1);
    await repo.claimNext();

    const done = await repo.markDone(job.id);
    expect(done.changes).toBe(1);

    const row = await readRow(job.id);
    expect(row.status).toBe('done');
    expect(row.finished_at).toBeTruthy();

    await expect(repo.claimNext()).resolves.toBeNull();
  });

  it('markFailed increments attempt and pushes next_retry_at per the doubling ladder (cap 30min)', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 1);
    await repo.claimNext();

    const expected = [30_000, 60_000, 120_000];
    for (let i = 0; i < expected.length; i += 1) {
      // Re-arm: past retries are claimable again; claim keeps the row running.
      await backdateNextRetry(job.id);
      await repo.claimNext();
      const before = Date.now();
      await repo.markFailed(job.id, `fail-${i}`);
      const row = await readRow(job.id);
      expect(row.status).toBe('failed');
      expect(row.attempt).toBe(i + 1);
      const actual = new Date(row.next_retry_at).getTime();
      expect(actual).toBeGreaterThanOrEqual(before + expected[i] - 2000);
      expect(actual).toBeLessThanOrEqual(Date.now() + expected[i] + 2000);
    }

    // Deep into the ladder the cap holds at 30 min.
    await dbRun('UPDATE ai_jobs SET attempt = 20 WHERE id = ?', [Number(job.id)]);
    await backdateNextRetry(job.id);
    await repo.claimNext();
    await repo.markFailed(job.id, 'fail-cap');
    const row = await readRow(job.id);
    const actual = new Date(row.next_retry_at).getTime();
    expect(actual).toBeLessThanOrEqual(Date.now() + 1_800_000 + 2000);
    expect(actual).toBeGreaterThanOrEqual(Date.now() + 1_800_000 - 60_000);
  });

  it('markFailed truncates last_error to ≤1KB', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 1);
    await repo.claimNext();
    await repo.markFailed(job.id, 'x'.repeat(5000));
    const row = await readRow(job.id);
    expect(row.last_error.length).toBeLessThanOrEqual(1024);
  });

  it('markSkipped records the reason in last_error, finishes the row, never re-claims', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 1);
    await repo.claimNext();

    const skipped = await repo.markSkipped(job.id, 'content_hash_dedupe');
    expect(skipped.changes).toBe(1);

    const row = await readRow(job.id);
    expect(row.status).toBe('skipped');
    expect(row.last_error).toBe('content_hash_dedupe');
    expect(row.finished_at).toBeTruthy();
    await expect(repo.claimNext()).resolves.toBeNull();
  });

  it('restart survival: a claimed-then-abandoned running row is reaped → failed, immediately re-claimable; a late markDone is a no-op', async () => {
    await clearJobs();
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 1, 'hash-restart');
    const claimed = await repo.claimNext();
    expect(claimed.id).toBe(Number(job.id));

    // "Restart": fresh repository instances over the same persisted DB.
    const revivedRepo = createAiJobsRepository(storage.getExecutor());

    const reaped = await revivedRepo.recoverStaleRunning(0);
    expect(reaped.changes).toBe(1);

    const row = await readRow(job.id);
    expect(row.status).toBe('failed');
    expect(row.attempt).toBe(1);

    // A delayed worker's markDone after the reap must never resurrect the row.
    await expect(repo.markDone(job.id)).resolves.toEqual({ changes: 0 });

    const reclaim = await revivedRepo.claimNext();
    expect(reclaim).not.toBeNull();
    expect(reclaim.id).toBe(Number(job.id));
    expect(reclaim.contentHash).toBe('hash-restart');

    // End-to-end idempotency: re-enqueue for the same generation is still a dedupe hit.
    await expect(revivedRepo.enqueue(node.nodeId, 'embed', 1)).resolves.toBeNull();
  });

  it('enqueueMany seeds in one TX and counts only NEW inserts (partial duplicates)', async () => {
    const nodeA = await uniqueNode();
    const nodeB = await uniqueNode();
    await repo.enqueue(nodeA.nodeId, 'backfill', 1);

    const result = await repo.enqueueMany([
      { nodeId: nodeA.nodeId, kind: 'backfill', generation: 1 }, // duplicate
      { nodeId: nodeB.nodeId, kind: 'backfill', generation: 1 },
      { nodeId: nodeB.nodeId, kind: 'embed', generation: 1 },
    ]);
    expect(result.enqueued).toBe(2);

    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_jobs WHERE node_id = ?', [
      Number(nodeB.nodeId),
    ]);
    expect(Number(rows[0].cnt)).toBe(2);
  });

  it('countByStatus totals match seeded fixtures of every status incl. skipped', async () => {
    await clearJobs();
    const nodes = [];
    for (let i = 0; i < 5; i += 1) nodes.push(await uniqueNode());
    const jobs = [];
    for (const node of nodes) {
      jobs.push(await repo.enqueue(node.nodeId, 'embed', 1));
    }

    // Claims run id-ASC: j0 stays running, j1..j3 reach terminal states, j4 pending.
    const running = await repo.claimNext(); // j0
    const c1 = await repo.claimNext(); // j1
    await repo.markDone(c1.id);
    const c2 = await repo.claimNext(); // j2
    await repo.markFailed(c2.id, 'f');
    const c3 = await repo.claimNext(); // j3
    await repo.markSkipped(c3.id, 's');

    const counts = await repo.countByStatus();
    expect(counts).toMatchObject({
      pending: expect.any(Number),
      running: expect.any(Number),
      done: expect.any(Number),
      failed: expect.any(Number),
      skipped: expect.any(Number),
    });
    expect(counts.running).toBeGreaterThanOrEqual(1);
    expect(counts.done).toBeGreaterThanOrEqual(1);
    expect(counts.failed).toBeGreaterThanOrEqual(1);
    expect(counts.skipped).toBeGreaterThanOrEqual(1);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    const total = Number((await dbQuery('SELECT COUNT(*) AS cnt FROM ai_jobs')).rows[0].cnt);
    expect(counts.pending + counts.running + counts.done + counts.failed + counts.skipped).toBe(
      total
    );
    expect(running.id).toBe(Number(jobs[0].id));
  });

  it('listFailed returns recent failed rows newest first and honors the limit', async () => {
    const nodeA = await uniqueNode();
    const nodeB = await uniqueNode();
    await repo.enqueue(nodeA.nodeId, 'embed', 1);
    await repo.enqueue(nodeB.nodeId, 'embed', 1);
    const first = await repo.claimNext();
    await repo.markFailed(first.id, 'first');
    const second = await repo.claimNext();
    await repo.markFailed(second.id, 'second');

    const failed = await repo.listFailed();
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(failed[0].id).toBe(Number(second.id));
    expect(failed.every((job) => job.status === 'failed')).toBe(true);

    const limited = await repo.listFailed({ limit: 1 });
    expect(limited.length).toBe(1);
    expect(limited[0].id).toBe(Number(second.id));
  });

  it('getById and listByNode expose the full domain row shape (numbers, ISO stamps, null-vs-value)', async () => {
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 3, 'hash-shape');

    const byId = await repo.getById(job.id);
    expect(byId).toMatchObject({
      id: Number(job.id),
      nodeId: Number(node.nodeId),
      kind: 'embed',
      generation: 3,
      status: 'pending',
      attempt: 0,
      contentHash: 'hash-shape',
      lastError: null,
      nextRetryAt: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(typeof byId.createdAt).toBe('string');
    expect(Number.isNaN(new Date(byId.createdAt).getTime())).toBe(false);

    await expect(repo.getById(999999999)).resolves.toBeNull();

    const history = await repo.listByNode(node.nodeId);
    expect(history.map((j) => Number(j.id))).toEqual([Number(job.id)]);
    const filtered = await repo.listByNode(node.nodeId, { generation: 2 });
    expect(filtered).toEqual([]);
  });

  it('node purge cascades its job rows (any status)', async () => {
    const node = await uniqueNode();
    const job = await repo.enqueue(node.nodeId, 'embed', 1);
    await repo.claimNext();
    await repo.markDone(job.id);

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.deleteNodeTree([node.nodeId]);

    const { rows } = await dbQuery('SELECT COUNT(*) AS cnt FROM ai_jobs WHERE id = ?', [
      Number(job.id),
    ]);
    expect(Number(rows[0].cnt)).toBe(0);
  });
});
