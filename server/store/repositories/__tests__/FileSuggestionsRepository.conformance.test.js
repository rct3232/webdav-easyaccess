'use strict';

/**
 * FileSuggestionsRepository L2 conformance (docs/spec/server/store/
 * fileSuggestionsStore.md §2.6). Runs against the ACTIVE backend via
 * createTestDatabase() (sqlite default leg; real PG adapter leg). Covers the
 * persisted-suggestion row contract: insert id + reason JSON round-trip,
 * pending listing/ordering, user-scoped dismiss, TX-bound state flips
 * (accept/undo families), bounded expireStale retention, FK enforcement and
 * soft-delete survival vs hard-delete cascade.
 */

const { createTestDatabase, createUserRootNode, createTestFileNode, dbQuery } = require(
  '@server/test-utils'
);
const storage = require('@server/store/storage');
const createFileSuggestionsRepository = require('@server/store/repositories/FileSuggestionsRepository');

describe('FileSuggestionsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let user;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createFileSuggestionsRepository(storage.getExecutor());
    const User = require('@server/models/User');
    seq += 1;
    const stamp = `${Date.now()}-${seq}`;
    user = await User.create(`conf-fs-${stamp}`, `conf-fs-${stamp}@conf.test`, 'pw', false);
    await createUserRootNode({ userId: user.id });
  });

  afterAll(async () => {
    await dbCleanup();
  });

  async function freshNode(name) {
    seq += 1;
    return createTestFileNode({ name: `${name}-${seq}.bin`, type: 'file' });
  }

  async function insertRow(node, fields = {}) {
    return repo.insert({
      userId: user.id,
      nodeId: node.nodeId,
      kind: fields.kind || 'exact_dup',
      reason: fields.reason ?? { kind: fields.kind || 'exact_dup', keep_node_id: 1 },
      expiresAt: fields.expiresAt,
    });
  }

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('insert returns the generated id; the row round-trips through listPending', async () => {
    const node = await freshNode('roundtrip');
    const { id } = await insertRow(node, {
      reason: { kind: 'exact_dup', keep_node_id: 42, extra: ['a', 'ü'] },
    });
    expect(Number.isInteger(id)).toBe(true);

    const rows = await repo.listPending(user.id);
    const row = rows.find((r) => r.id === id);
    expect(row).toMatchObject({
      userId: Number(user.id),
      nodeId: Number(node.nodeId),
      kind: 'exact_dup',
      state: 'pending',
    });
    expect(row.reason).toEqual({ kind: 'exact_dup', keep_node_id: 42, extra: ['a', 'ü'] });
    expect(typeof row.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false);
    expect(row.expiresAt).toBeNull();
  });

  it('insert stores caller-provided expiresAt verbatim (ISO) and rejects unknown FKs', async () => {
    const node = await freshNode('expiry');
    const iso = '2099-01-01T00:00:00.000Z';
    const { id } = await insertRow(node, { expiresAt: iso });
    const row = (await repo.listPending(user.id)).find((r) => r.id === id);
    expect(Number.isNaN(Date.parse(row.expiresAt))).toBe(false);
    expect(Date.parse(row.expiresAt)).toBe(Date.parse(iso));

    await expect(repo.insert({ userId: user.id, nodeId: 999999999, kind: 'x' })).rejects.toBeDefined();
    await expect(
      repo.insert({ userId: 999999999, nodeId: node.nodeId, kind: 'x' })
    ).rejects.toBeDefined();
  });

  it('listPending orders by id and excludes every non-pending state', async () => {
    const a = await freshNode('order-a');
    const b = await freshNode('order-b');
    const c = await freshNode('order-c');
    const d = await freshNode('order-d');
    const idA = (await insertRow(a)).id;
    const idB = (await insertRow(b)).id;
    const idC = (await insertRow(c)).id;
    const idD = (await insertRow(d)).id;

    await repo.dismiss(user.id, idB);
    const queryable = storage.getExecutor();
    await repo.flipStatesTx(queryable, { ids: [idC], fromState: 'pending', toState: 'expired' });
    await repo.flipStatesTx(queryable, { ids: [idD], fromState: 'pending', toState: 'accepted' });

    const pending = await repo.listPending(user.id);
    const mine = pending.filter((r) => [idA, idB, idC, idD].includes(r.id));
    expect(mine.map((r) => r.id)).toEqual([idA]);

    const byNode = new Map((await repo.listKeys(user.id)).map((k) => [k.nodeId, k.state]));
    expect(byNode.get(Number(a.nodeId))).toBe('pending');
    expect(byNode.get(Number(b.nodeId))).toBe('dismissed');
    expect(byNode.get(Number(c.nodeId))).toBe('expired');
    expect(byNode.get(Number(d.nodeId))).toBe('accepted');
  });

  it('dismiss is pending-only and user-scoped', async () => {
    const node = await freshNode('dismiss');
    const { id } = await insertRow(node);

    await expect(repo.dismiss(999999, id)).resolves.toEqual({ changes: 0 });
    await expect(repo.dismiss(user.id, id)).resolves.toEqual({ changes: 1 });
    await expect(repo.dismiss(user.id, id)).resolves.toEqual({ changes: 0 });

    const row = (await repo.listKeys(user.id)).find((k) => k.nodeId === Number(node.nodeId));
    expect(row.state).toBe('dismissed');
  });

  it('listIdsByNodesTx + flipStatesTx run against a caller-owned queryable (executor as tx)', async () => {
    const node = await freshNode('flip');
    const other = await freshNode('flip-other');
    const { id } = await insertRow(node, { kind: 'exact_dup' });
    await insertRow(node, { kind: 'temp_pattern', reason: { kind: 'temp_pattern' } });
    const queryable = storage.getExecutor();

    const found = await repo.listIdsByNodesTx(queryable, user.id, [Number(node.nodeId)], 'pending');
    expect(found.map((f) => f.id)).toHaveLength(2);
    expect(found.every((f) => f.nodeId === Number(node.nodeId))).toBe(true);
    await expect(
      repo.listIdsByNodesTx(queryable, user.id, [Number(other.nodeId)], 'pending')
    ).resolves.toEqual([]);

    const ids = found.map((f) => f.id);
    await expect(
      repo.flipStatesTx(queryable, { ids, fromState: 'pending', toState: 'accepted' })
    ).resolves.toEqual({ changes: 2 });
    // The guard column makes a second pending→ flip a no-op; undo family re-flips.
    await expect(
      repo.flipStatesTx(queryable, { ids, fromState: 'pending', toState: 'accepted' })
    ).resolves.toEqual({ changes: 0 });
    await expect(
      repo.flipStatesTx(queryable, { ids, fromState: 'accepted', toState: 'pending' })
    ).resolves.toEqual({ changes: 2 });
    expect(id).toBeGreaterThan(0);
  });

  it('flips inside a real transaction commit atomically and roll back cleanly', async () => {
    const node = await freshNode('tx');
    const { id } = await insertRow(node);
    const executor = storage.getExecutor();

    await expect(
      executor.transaction(async (tx) => {
        await repo.flipStatesTx(tx, { ids: [id], fromState: 'pending', toState: 'accepted' });
        throw new Error('forced rollback');
      })
    ).rejects.toBeDefined();
    const after = (await repo.listKeys(user.id)).find((k) => k.nodeId === Number(node.nodeId));
    expect(after.state).toBe('pending');

    const committed = await executor.transaction(async (tx) => {
      const flip = await repo.flipStatesTx(tx, {
        ids: [id],
        fromState: 'pending',
        toState: 'accepted',
      });
      return flip;
    });
    expect(committed).toEqual({ changes: 1 });
    const flipped = (await repo.listKeys(user.id)).find((k) => k.nodeId === Number(node.nodeId));
    expect(flipped.state).toBe('accepted');
  });

  it('expireStale flips only pending rows past the cutoff, NULL expiresAt exempt, bounded by limit', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 600000).toISOString();
    const n1 = await freshNode('stale1');
    const n2 = await freshNode('stale2');
    const n3 = await freshNode('stale3');
    const n4 = await freshNode('stale4');
    const r1 = await insertRow(n1, { expiresAt: past });
    const r2 = await insertRow(n2, { expiresAt: past });
    const r3 = await insertRow(n3, { expiresAt: future });
    const r4 = await insertRow(n4); // NULL expiry never expires

    const cutoff = Date.now();
    const first = await repo.expireStale({ now: cutoff, limit: 1 });
    expect(first.changes).toBe(1);
    expect(first.ids).toHaveLength(1);

    const rest = await repo.expireStale({ now: cutoff, limit: 10 });
    expect(rest.changes).toBe(1);

    const again = await repo.expireStale({ now: cutoff, limit: 10 });
    expect(again).toEqual({ changes: 0, ids: [] });

    const states = Object.fromEntries(
      (await repo.listKeys(user.id))
        .filter((k) =>
          [n1, n2, n3, n4].some((n) => Number(n.nodeId) === k.nodeId)
        )
        .map((k) => [k.nodeId, k.state])
    );
    expect([states[Number(n1.nodeId)], states[Number(n2.nodeId)]].sort()).toEqual([
      'expired',
      'expired',
    ]);
    expect(states[Number(n3.nodeId)]).toBe('pending');
    expect(states[Number(n4.nodeId)]).toBe('pending');
    expect([r1.id, r2.id, r3.id, r4.id].every((x) => Number.isInteger(x))).toBe(true);
  });

  it('dismissed rows are visible through listKeys but never through listPending', async () => {
    const node = await freshNode('history');
    const { id } = await insertRow(node, { kind: 'old_installer' });
    await repo.dismiss(user.id, id);
    const pending = await repo.listPending(user.id);
    expect(pending.some((r) => r.id === id)).toBe(false);
    const keys = await repo.listKeys(user.id);
    expect(keys.some((k) => k.nodeId === Number(node.nodeId) && k.kind === 'old_installer')).toBe(
      true
    );
  });

  it('soft delete keeps rows, hard delete cascades them away', async () => {
    const node = await freshNode('cascade');
    const { id } = await insertRow(node);
    const fileNodesStore = require('@server/store/fileNodesStore').createFileNodesStore();

    await fileNodesStore.markSubtreeDeleted([Number(node.nodeId)]);
    expect((await repo.listPending(user.id)).some((r) => r.id === id)).toBe(true);

    await fileNodesStore.deleteNodeTree([Number(node.nodeId)]);
    expect((await repo.listKeys(user.id)).some((k) => k.nodeId === Number(node.nodeId))).toBe(
      false
    );
  });

  it('FK violation inside a transaction leaves no partial row', async () => {
    const executor = storage.getExecutor();
    const { rows: before } = await dbQuery('SELECT COUNT(*) AS cnt FROM file_suggestions', []);
    await expect(
      executor.transaction(async (tx) => {
        await repo.insert({ userId: user.id, nodeId: 999999998, kind: 'exact_dup' });
      })
    ).rejects.toBeDefined();
    const { rows: after } = await dbQuery('SELECT COUNT(*) AS cnt FROM file_suggestions', []);
    expect(Number(after[0].cnt)).toBe(Number(before[0].cnt));
  });
});
