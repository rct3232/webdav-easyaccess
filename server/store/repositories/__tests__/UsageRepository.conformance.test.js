'use strict';

/**
 * UsageRepository L2 conformance (docs/spec/server/store/usageStore.md §2.7).
 * Runs against the ACTIVE backend via createTestDatabase() (sqlite default
 * leg; real PG adapter leg). Exercises the §3.4 rollup semantics directly on
 * the twins: watermark consumption, accumulator counts/score, idempotent
 * re-run, retention roll-off and FK/cascade parity.
 */

const {
  createTestDatabase,
  createUserRootNode,
  dbQuery,
} = require('@server/test-utils');
const storage = require('@server/store/storage');
const createUsageRepository = require('@server/store/repositories/UsageRepository');

const DAY_MS = 86400000;

describe('UsageRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createUsageRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const uniqueUser = async () => {
    seq += 1;
    const stamp = `${Date.now()}-${seq}`;
    const User = require('@server/models/User');
    const user = await User.create(`conf-usage-${stamp}`, `conf-usage-${stamp}@conf.test`, 'pw', false);
    await createUserRootNode({ userId: user.id });
    return user;
  };

  const uniqueNode = async (name) => {
    const { createTestFileNode } = require('@server/test-utils');
    return createTestFileNode({ name });
  };

  const insertEvent = (userId, nodeId, action, atMs) =>
    repo.insertUsageEvent({ userId, nodeId, action, at: new Date(atMs) });

  const zeroCounts = () => ({ open: 0, download: 0, preview: 0, search_hit: 0, like: 0 });

  const activityRow = async (userId, nodeId) => {
    const { rows } = await dbQuery(
      'SELECT opens, downloads, previews, search_hits, likes, score, last_seen_at, updated_at FROM node_activity WHERE user_id = ? AND node_id = ?',
      [Number(userId), Number(nodeId)]
    );
    return rows[0] || null;
  };

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('insertUsageEvent round-trips a §3.4 event; unknown node rejects on the FK', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-1.txt`);

    const result = await repo.insertUsageEvent({
      userId: user.id,
      nodeId: node.nodeId,
      action: 'open',
      at: new Date(Date.UTC(2026, 8, 1)),
    });
    expect(result.changes).toBe(1);

    const { rows } = await dbQuery('SELECT user_id, node_id, action FROM usage_events', []);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].user_id)).toBe(Number(user.id));
    expect(Number(rows[0].node_id)).toBe(Number(node.nodeId));
    expect(rows[0].action).toBe('open');

    await expect(
      repo.insertUsageEvent({ userId: user.id, nodeId: 999999999, action: 'open' })
    ).rejects.toBeDefined();
  });

  it('rolls up fresh events: weighted score, lifetime counts, last_seen_at, updated_at', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-2.txt`);
    const now = Date.UTC(2026, 8, 22, 3, 0, 0);

    // 2 opens + 1 download + 1 like = 2·1 + 3 + 5 = 10
    await insertEvent(user.id, node.nodeId, 'open', now - 3 * DAY_MS);
    await insertEvent(user.id, node.nodeId, 'open', now - 2 * DAY_MS);
    await insertEvent(user.id, node.nodeId, 'download', now - 1 * DAY_MS);
    await insertEvent(user.id, node.nodeId, 'like', now);

    const upsert = await repo.upsertNodeActivity(
      (await repo.readRollupGroups()).map((group) => ({
        userId: group.userId,
        nodeId: group.nodeId,
        counts: {
          open: (group.prevCounts?.open || 0) + group.counts.open,
          download: (group.prevCounts?.download || 0) + group.counts.download,
          preview: (group.prevCounts?.preview || 0) + group.counts.preview,
          search_hit: (group.prevCounts?.search_hit || 0) + group.counts.search_hit,
          like: (group.prevCounts?.like || 0) + group.counts.like,
        },
        lastSeenAtMs: group.lastSeenAtMs,
        score: group.prevScore * Math.pow(2, -(now - group.prevUpdatedAtMs) / (30 * DAY_MS)) +
          group.counts.open * 1 +
          group.counts.download * 3 +
          group.counts.like * 5,
        updatedAtMs: now,
      }))
    );

    expect(upsert.changes).toBe(1);
    const row = await activityRow(user.id, node.nodeId);
    expect(row).not.toBeNull();
    expect(Number(row.opens)).toBe(2);
    expect(Number(row.downloads)).toBe(1);
    expect(Number(row.likes)).toBe(1);
    expect(Number(row.score)).toBeCloseTo(10, 6);
    // last_seen_at = latest consumed event
    expect(new Date(row.last_seen_at).getTime()).toBeCloseTo(now, 4);
    expect(new Date(row.updated_at).getTime()).toBeCloseTo(now, 4);
  });

  it('decays a pre-existing accumulator row by the 30d half-life and accumulates counts', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-3.txt`);
    const now = Date.UTC(2026, 8, 22, 3, 0, 0);
    const thirtyDaysAgo = now - 30 * DAY_MS;

    // Seed an accumulator as if a previous rollup ran 30d ago (score 5).
    await dbQuery(
      'INSERT INTO node_activity (user_id, node_id, opens, downloads, previews, search_hits, likes, score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [Number(user.id), Number(node.nodeId), 1, 0, 1, 0, 1, 5, new Date(thirtyDaysAgo).toISOString()]
    );
    await insertEvent(user.id, node.nodeId, 'download', now - DAY_MS);

    const groups = await repo.readRollupGroups();
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.prevScore).toBeCloseTo(5, 6);
    expect(group.prevUpdatedAtMs).toBeCloseTo(thirtyDaysAgo, 4);
    expect(group.counts).toEqual({ open: 0, download: 1, preview: 0, search_hit: 0, like: 0 });

    // S_k = 5·2^(−1) + 3 = 5.5 (H=30d); counts accumulate lifetime totals.
    const result = await repo.upsertNodeActivity([
      {
        userId: group.userId,
        nodeId: group.nodeId,
        counts: {
          open: (group.prevCounts?.open || 0) + group.counts.open,
          download: (group.prevCounts?.download || 0) + group.counts.download,
          preview: (group.prevCounts?.preview || 0) + group.counts.preview,
          search_hit: (group.prevCounts?.search_hit || 0) + group.counts.search_hit,
          like: (group.prevCounts?.like || 0) + group.counts.like,
        },
        lastSeenAtMs: group.lastSeenAtMs,
        score: group.prevScore * Math.pow(2, -(now - group.prevUpdatedAtMs) / (30 * DAY_MS)) +
          group.counts.download * 3,
        updatedAtMs: now,
      },
    ]);
    expect(result.changes).toBe(1);

    const row = await activityRow(user.id, node.nodeId);
    expect(Number(row.opens)).toBe(0);
    expect(Number(row.previews)).toBe(1);
    expect(Number(row.downloads)).toBe(1);
    expect(Number(row.likes)).toBe(1);
    expect(Number(row.score)).toBeCloseTo(5.5, 6);
  });

  it('is idempotent: an immediate re-run consumes nothing; a newer event is consumed', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-3b.txt`);
    const now = Date.UTC(2026, 8, 22, 3, 0, 0);

    await insertEvent(user.id, node.nodeId, 'open', now - DAY_MS);
    let groups = await repo.readRollupGroups();
    expect(groups).toHaveLength(1);
    await repo.upsertNodeActivity([
      {
        userId: groups[0].userId,
        nodeId: groups[0].nodeId,
        counts: {
          open: (groups[0].prevCounts?.open || 0) + groups[0].counts.open,
          download: (groups[0].prevCounts?.download || 0) + groups[0].counts.download,
          preview: (groups[0].prevCounts?.preview || 0) + groups[0].counts.preview,
          search_hit: (groups[0].prevCounts?.search_hit || 0) + groups[0].counts.search_hit,
          like: (groups[0].prevCounts?.like || 0) + groups[0].counts.like,
        },
        lastSeenAtMs: groups[0].lastSeenAtMs,
        score: groups[0].counts.open * 1,
        updatedAtMs: now,
      },
    ]);

    // Idempotent re-run inside the same interval: nothing to consume.
    expect(await repo.readRollupGroups()).toEqual([]);

    // A NEW event (created after updated_at) is consumed on the next run.
    const later = now + DAY_MS;
    await insertEvent(user.id, node.nodeId, 'like', later);
    groups = await repo.readRollupGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].counts).toEqual({ open: 0, download: 0, preview: 0, search_hit: 0, like: 1 });
    expect(groups[0].prevScore).toBeCloseTo(1, 6);
    expect(groups[0].lastSeenAtMs).toBeCloseTo(later, 4);
  });

  it('deleteUsageEventsOlderThan removes only rows older than the cutoff', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-4.txt`);
    const now = Date.UTC(2026, 8, 22, 3, 0, 0);

    await insertEvent(user.id, node.nodeId, 'open', now - 100 * DAY_MS);
    await insertEvent(user.id, node.nodeId, 'preview', now - 89 * DAY_MS);

    const deleted = await repo.deleteUsageEventsOlderThan(now - 90 * DAY_MS);
    expect(deleted.changes).toBe(1);

    const { rows } = await dbQuery('SELECT action FROM usage_events', []);
    expect(rows.map((r) => r.action)).toEqual(['preview']);
  });

  it('purging the node cascades both the accumulator and the raw events away', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-4b.txt`);
    await insertEvent(user.id, node.nodeId, 'open', Date.UTC(2026, 8, 1));

    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();
    await fileNodesStore.deleteNodeTree([node.nodeId]);

    const events = await dbQuery('SELECT COUNT(*) AS cnt FROM usage_events', []);
    expect(Number(events.rows[0].cnt)).toBe(0);
    expect(await activityRow(user.id, node.nodeId)).toBeNull();
  });

  it('CURRENT_TIMESTAMP-defaulted and ISO-bound timestamps compare correctly (watermark parity)', async () => {
    const user = await uniqueUser();
    const node = await uniqueNode(`usage-${Date.now()}-5.txt`);
    const now = Date.UTC(2026, 8, 22, 3, 0, 0);

    // Row written by the driver default (CURRENT_TIMESTAMP on sqlite / NOW() on PG).
    await dbQuery(
      'INSERT INTO usage_events (user_id, node_id, action) VALUES (?, ?, ?)',
      [Number(user.id), Number(node.nodeId), 'open']
    );
    // Seed the accumulator as if rolled up NOW — the default-written event is
    // (slightly) older, so it must NOT be re-consumed after this rollup stamp.
    await dbQuery(
      'INSERT INTO node_activity (user_id, node_id, score, updated_at) VALUES (?, ?, ?, ?)',
      [Number(user.id), Number(node.nodeId), 1, new Date(now).toISOString()]
    );

    const groups = await repo.readRollupGroups();
    // The default-timestamp event predates the rollup stamp → filtered out.
    expect(groups).toEqual([]);
  });
});