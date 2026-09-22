'use strict';

/**
 * ActionJournalRepository L2 conformance
 * (docs/spec/server/store/actionJournalStore.md §2.8). Runs against the
 * ACTIVE backend via createTestDatabase() (sqlite default leg; real PG
 * adapter leg). Covers the repository CRUD surface plus the commitChange /
 * undoAction mechanics the T0.2 facade ships (chain_seq discipline, atomic
 * commit, undo guards, retention).
 */

const { createTestDatabase, dbQuery, isSqliteBackend } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createActionJournalRepository = require('@server/store/repositories/ActionJournalRepository');
const actionJournalStore = require('@server/store/actionJournalStore');

describe('ActionJournalRepository conformance', () => {
  let dbCleanup;
  let repo;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createActionJournalRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const SUBJECT = 'collection:424242';
  const OUTCOME_APPLIED = [{ applied: true }];
  const OUTCOME_CHANGED = [{ applied: false, reason: 'changed' }];
  const appliedRows = async (domain, subject) => {
    const { rows } = await dbQuery(
      'SELECT COUNT(*) AS cnt FROM action_journal WHERE domain = ? AND subject = ? AND status = ?',
      [domain, subject, 'applied']
    );
    return Number(rows[0].cnt);
  };

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('reads chain_seq read-your-writes inside a transaction and starts at 1', async () => {
    const executor = storage.getExecutor();
    const chain = await executor.transaction(async (tx) => {
      expect(await repo.getMaxChainSeq(tx, 'collection', SUBJECT)).toBe(0);
      const first = await repo.insertAction(tx, {
        domain: 'collection',
        subject: SUBJECT,
        subjectLabel: 'Test collection',
        actor: '1',
        action: 'create',
        payload: { inverse: { op: 'delete-collection', fingerprint: 'fp-1' } },
        chainSeq: (await repo.getMaxChainSeq(tx, 'collection', SUBJECT)) + 1,
        retentionDays: 30,
      });
      expect(await repo.getMaxChainSeq(tx, 'collection', SUBJECT)).toBe(1);
      await repo.insertAction(tx, {
        domain: 'collection',
        subject: SUBJECT,
        subjectLabel: 'Test collection',
        actor: '1',
        action: 'add-item',
        payload: { inverse: { op: 'remove-item' } },
        chainSeq: (await repo.getMaxChainSeq(tx, 'collection', SUBJECT)) + 1,
        retentionDays: 30,
      });
      return [first.chainSeq];
    });
    expect(chain).toEqual([1]);
    await expect(appliedRows('collection', SUBJECT)).resolves.toBe(2);
  });

  it('enforces UNIQUE(domain, subject, chain_seq)', async () => {
    const executor = storage.getExecutor();
    await expect(
      executor.transaction(async (tx) => {
        await repo.insertAction(tx, {
          domain: 'collection',
          subject: SUBJECT,
          actor: '1',
          action: 'dupe-a',
          payload: null,
          chainSeq: 1,
          retentionDays: 30,
        });
        await repo.insertAction(tx, {
          domain: 'collection',
          subject: SUBJECT,
          actor: '1',
          action: 'dupe-b',
          payload: null,
          chainSeq: 1,
          retentionDays: 30,
        });
      })
    ).rejects.toBeDefined();
  });

  it('round-trips the payload as a domain object on both dialects', async () => {
    const payload = {
      inverse: { op: 'remove-item', collectionId: 7, nodeId: 42 },
      items: [{ nodeId: 42, fingerprint: 'fp-item' }],
      fingerprint: 'fp-command',
      note: 'batch add',
    };
    let actionId;
    const executor = storage.getExecutor();
    await executor.transaction(async (tx) => {
      const row = await repo.insertAction(tx, {
        domain: 'batch',
        subject: 'batch:job-1',
        actor: '1',
        action: 'add-items',
        payload,
        chainSeq: 1,
        retentionDays: 30,
      });
      actionId = row.id;
    });
    const loaded = await repo.getAction(actionId);
    expect(loaded).not.toBeNull();
    expect(loaded.payload).toEqual(payload);
    expect(loaded.domain).toBe('batch');
    expect(loaded.subject).toBe('batch:job-1');
    expect(loaded.chainSeq).toBe(1);
    expect(loaded.status).toBe('applied');
    expect(loaded.undoneAt).toBeNull();
  });

  it('returns null for a missing action and strings for timestamps', async () => {
    expect(await repo.getAction(999999999)).toBeNull();
    const executor = storage.getExecutor();
    let actionId;
    await executor.transaction(async (tx) => {
      const row = await repo.insertAction(tx, {
        domain: 'collection',
        subject: 'collection:777',
        actor: 'system',
        action: 'auto-create',
        payload: { inverse: { op: 'noop' } },
        chainSeq: 1,
        retentionDays: 30,
      });
      actionId = row.id;
    });
    const loaded = await repo.getAction(actionId);
    expect(typeof loaded.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(loaded.createdAt))).toBe(false);
    expect(typeof loaded.expiresAt).toBe('string');
    expect(Number.isNaN(new Date(loaded.expiresAt).getTime())).toBe(false);
  });

  describe('commitChange (facade mechanics)', () => {
    it('returns { id, chainSeq } matching the stored row and lands exactly one row', async () => {
      const subject = `collection:${Date.now()}-cc-1`;
      const created = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'create', subjectLabel: 'Commit suite' },
        { inverse: { op: 'noop' } },
        async () => 'created'
      );
      expect(created.chainSeq).toBe(1);

      const loaded = await actionJournalStore.getAction(created.id);
      expect(loaded.subject).toBe(subject);
      expect(loaded.action).toBe('create');
      expect(loaded.subjectLabel).toBe('Commit suite');
      expect(loaded.status).toBe('applied');

      const second = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'add-item' },
        { inverse: { op: 'remove-item' } },
        async () => 'added'
      );
      expect(second.chainSeq).toBe(2);
      await expect(appliedRows('collection', subject)).resolves.toBe(2);
    });

    it('resolves function subjects inside the TX (create-flow subjects)', async () => {
      const created = await actionJournalStore.commitChange(
        'collection',
        (result) => `collection:${result.id}`,
        { actor: '1', action: 'create' },
        { inverse: { op: 'noop' } },
        async () => ({ id: 987654 })
      );
      const loaded = await actionJournalStore.getAction(created.id);
      expect(loaded.subject).toBe('collection:987654');
      expect(created.chainSeq).toBe(1);
    });

    it('rolls the mutation back when the journal insert fails (ONE tx)', async () => {
      const subject = `collection:${Date.now()}-cc-2`;
      // Forcing a journal-row failure: an invalid domain violates the journal's
      // CHECK constraint at INSERT time, AFTER the mutation's own write — so
      // the whole TX (change + journal row) must roll back.
      await expect(
        actionJournalStore.commitChange(
          'bogus-domain',
          subject,
          { actor: '1', action: 'add-item' },
          { inverse: { op: 'remove-item' } },
          async (tx) => {
            await tx.run("INSERT INTO settings (key, value) VALUES ('rollback-probe', ?)", [
              JSON.stringify({ rolledBack: true }),
            ]);
          }
        )
      ).rejects.toBeDefined();
      const { rows } = await dbQuery(
        "SELECT COUNT(*) AS cnt FROM settings WHERE key = 'rollback-probe'"
      );
      expect(Number(rows[0].cnt)).toBe(0); // the mutation's write was rolled back
      await expect(appliedRows('collection', subject)).resolves.toBe(0);
    });

    it('leaves zero rows when the mutation throws', async () => {
      const subject = `collection:${Date.now()}-cc-3`;
      await expect(
        actionJournalStore.commitChange(
          'collection',
          subject,
          { actor: '1', action: 'add-item' },
          { inverse: { op: 'remove-item' } },
          async () => {
            throw new Error('mutation blew up');
          }
        )
      ).rejects.toBeDefined();
      await expect(appliedRows('collection', subject)).resolves.toBe(0);
    });

    it('serializes concurrent commits to the SAME subject via the lock (gapless chain)', async () => {
      const subject = `collection:${Date.now()}-cc-4`;
      const commits = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          actionJournalStore.commitChange(
            'collection',
            subject,
            { actor: '1', action: `concurrent-${i}` },
            { inverse: { op: 'noop' } },
            async () => null
          )
        )
      );
      const seqs = commits.map((c) => c.chainSeq).sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5]); // gapless, no duplicate slots
      await expect(
        actionJournalStore.listBySubject('collection', subject).then((rows) => rows.length)
      ).resolves.toBe(5);
    });

    it('commits to two different subjects concurrently without blocking each other', async () => {
      const subjectA = `collection:${Date.now()}-cc-5a`;
      const subjectB = `collection:${Date.now()}-cc-5b`;
      const [a, b] = await Promise.all([
        actionJournalStore.commitChange(
          'collection',
          subjectA,
          { actor: '1', action: 'create' },
          { inverse: { op: 'noop' } },
          async () => null
        ),
        actionJournalStore.commitChange(
          'collection',
          subjectB,
          { actor: '2', action: 'create' },
          { inverse: { op: 'noop' } },
          async () => null
        ),
      ]);
      expect(a.chainSeq).toBe(1);
      expect(b.chainSeq).toBe(1);
      expect((await actionJournalStore.getAction(a.id)).subject).toBe(subjectA);
      expect((await actionJournalStore.getAction(b.id)).subject).toBe(subjectB);
    });
  });

  describe('undo mechanics', () => {
    beforeEach(() => {
      actionJournalStore.registerUndoExecutor('collection', async () => OUTCOME_APPLIED);
    });

    it('tip undo flips applied → undone and records undone_at without a new journal row', async () => {
      const subject = `collection:${Date.now()}-u1`;
      const first = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'create' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      const { rows: before } = await dbQuery('SELECT COUNT(*) AS cnt FROM action_journal');

      const result = await actionJournalStore.undoAction(first.id);
      expect(result).toEqual({ undone: 1, skipped: [], undoneIds: [first.id] });

      const loaded = await actionJournalStore.getAction(first.id);
      expect(loaded.status).toBe('undone');
      expect(loaded.undoneAt).not.toBeNull();
      const { rows: after } = await dbQuery('SELECT COUNT(*) AS cnt FROM action_journal');
      expect(Number(after[0].cnt)).toBe(Number(before[0].cnt));
    });

    it('reports journal_not_found / journal_already_undone as typed results', async () => {
      await expect(actionJournalStore.undoAction(999999999)).resolves.toEqual({
        code: 'journal_not_found',
      });

      const subject = `collection:${Date.now()}-u2`;
      const row = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'create' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      await actionJournalStore.undoAction(row.id);
      await expect(actionJournalStore.undoAction(row.id)).resolves.toEqual({
        code: 'journal_already_undone',
      });
    });

    it('rejects undo of an expired row (payload NULLed)', async () => {
      const subject = `collection:${Date.now()}-u3`;
      const row = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'create' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      await actionJournalStore.expireJournalRows(new Date(Date.now() + 31 * 24 * 3600 * 1000));
      const loaded = await actionJournalStore.getAction(row.id);
      expect(loaded.status).toBe('expired');
      expect(loaded.payload).toBeNull();
      await expect(actionJournalStore.undoAction(row.id)).resolves.toEqual({
        code: 'journal_expired',
      });
    });

    it('non-tip undo requires cascade; cascade:true undoes tip..target LIFO', async () => {
      const subject = `collection:${Date.now()}-u4`;
      const one = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'create' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      const two = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'add-item' },
        { inverse: { op: 'remove-item' } },
        async () => null
      );

      await expect(
        actionJournalStore.countLaterChanges('collection', subject, one.chainSeq)
      ).resolves.toBe(1);
      const cascadeRequired = await actionJournalStore.undoAction(one.id);
      expect(cascadeRequired).toEqual({ code: 'journal_cascade_required', laterCount: 1 });

      const undoneRows = [];
      actionJournalStore.registerUndoExecutor('collection', async ({ row }) => {
        undoneRows.push(row.chainSeq);
        return OUTCOME_APPLIED;
      });

      const result = await actionJournalStore.undoAction(one.id, { cascade: true });
      expect(result).toEqual({ undone: 2, skipped: [], undoneIds: [two.id, one.id] });
      // LIFO: tip (chain 2) first, then the target (chain 1).
      expect(undoneRows).toEqual([two.chainSeq, one.chainSeq]);
      expect((await actionJournalStore.getAction(two.id)).status).toBe('undone');
      expect((await actionJournalStore.getAction(one.id)).status).toBe('undone');
    });

    it('per-item fingerprint mismatch skips the item but still commits the undo', async () => {
      const subject = `collection:${Date.now()}-u5`;
      const row = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'add-items' },
        { inverse: { op: 'noop' }, items: [{ nodeId: 1 }, { nodeId: 2 }] },
        async () => null
      );
      actionJournalStore.registerUndoExecutor('collection', async () => OUTCOME_CHANGED);
      const result = await actionJournalStore.undoAction(row.id);
      expect(result).toEqual({ undone: 0, skipped: [{ reason: 'changed' }], undoneIds: [row.id] });
      expect((await actionJournalStore.getAction(row.id)).status).toBe('undone');
    });
  });

  it('journal rows outlive their subject (no FK)', async () => {
    const subject = 'collection:654321-no-such-row';
    const row = await actionJournalStore.commitChange(
      'collection',
      subject,
      { actor: 'system', action: 'auto-archive' },
      { inverse: { op: 'noop' } },
      async () => null
    );
    const loaded = await actionJournalStore.getAction(row.id);
    expect(loaded).not.toBeNull();
    expect(loaded.subject).toBe(subject);
  });

  it("purgeSubject removes only that subject's rows", async () => {
    const subject = `collection:${Date.now()}-p1`;
    const other = `collection:${Date.now()}-p2`;
    await actionJournalStore.commitChange(
      'collection',
      subject,
      { actor: '1', action: 'create' },
      { inverse: { op: 'noop' } },
      async () => null
    );
    await actionJournalStore.commitChange(
      'collection',
      other,
      { actor: '1', action: 'create' },
      { inverse: { op: 'noop' } },
      async () => null
    );

    const purged = await actionJournalStore.purgeSubject('collection', subject);
    expect(purged.changes).toBeGreaterThanOrEqual(1);
    await expect(appliedRows('collection', subject)).resolves.toBe(0);
    await expect(appliedRows('collection', other)).resolves.toBe(1);
  });

  describe('feed & retention', () => {
    beforeEach(() => {
      actionJournalStore.registerUndoExecutor('collection', async () => OUTCOME_APPLIED);
    });

    it('expireJournalRows expires applied past-expiry rows, keeps undone payloads, keeps counts', async () => {
      const subject = `collection:${Date.now()}-e1`;
      const undoneSubject = `collection:${Date.now()}-e2`;
      const row = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: 'system', action: 'auto-create' },
        { inverse: { op: 'noop' }, note: 'digest me' },
        async () => null
      );
      const keepRow = await actionJournalStore.commitChange(
        'collection',
        undoneSubject,
        { actor: '1', action: 'create' },
        { inverse: { op: 'keep-me' } },
        async () => null
      );
      await actionJournalStore.undoAction(keepRow.id);

      const { rows: countBefore } = await dbQuery('SELECT COUNT(*) AS cnt FROM action_journal');
      await actionJournalStore.expireJournalRows(new Date(Date.now() + 40 * 24 * 3600 * 1000));

      const expired = await actionJournalStore.getAction(row.id);
      expect(expired.status).toBe('expired');
      expect(expired.payload).toBeNull();

      const undone = await actionJournalStore.getAction(keepRow.id);
      expect(undone.status).toBe('undone');
      expect(undone.payload).toEqual({ inverse: { op: 'keep-me' } });

      const { rows: countAfter } = await dbQuery('SELECT COUNT(*) AS cnt FROM action_journal');
      expect(Number(countAfter[0].cnt)).toBe(Number(countBefore[0].cnt));

      // The feed still lists the expired row's surviving columns.
      const feed = await actionJournalStore.listFeed({ actor: 'system' });
      const expiredFeedRow = feed.find((r) => r.id === row.id);
      expect(expiredFeedRow).toBeDefined();
      expect(expiredFeedRow.action).toBe('auto-create');
    });

    it('listFeed drops rows expired more than 30 days ago but keeps recent expired rows', async () => {
      const oldSubject = `collection:${Date.now()}-e3`;
      const freshSubject = `collection:${Date.now()}-e4`;
      const oldRow = await actionJournalStore.commitChange(
        'collection',
        oldSubject,
        { actor: 'system', action: 'old-act' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      const freshRow = await actionJournalStore.commitChange(
        'collection',
        freshSubject,
        { actor: 'system', action: 'fresh-act' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      await actionJournalStore.expireJournalRows(new Date(Date.now() + 40 * 24 * 3600 * 1000));

      // Backdate one row beyond the 30-day feed window.
      if (isSqliteBackend()) {
        await dbQuery(
          "UPDATE action_journal SET created_at = datetime('now', '-40 days') WHERE id = ?",
          [oldRow.id]
        );
      } else {
        await dbQuery(
          "UPDATE action_journal SET created_at = NOW() - INTERVAL '40 days' WHERE id = $1",
          [oldRow.id]
        );
      }

      const feed = await actionJournalStore.listFeed({ actor: 'system' });
      const ids = feed.map((r) => r.id);
      expect(ids).not.toContain(oldRow.id);
      expect(ids).toContain(freshRow.id);
    });

    it('listFeed filters by actor and lists newest first; listBySubject chains newest first', async () => {
      const subject = `collection:${Date.now()}-e5`;
      const first = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '1', action: 'create' },
        { inverse: { op: 'noop' } },
        async () => null
      );
      const second = await actionJournalStore.commitChange(
        'collection',
        subject,
        { actor: '2', action: 'add-item' },
        { inverse: { op: 'remove-item' } },
        async () => null
      );

      const bySubject = await actionJournalStore.listBySubject('collection', subject);
      expect(bySubject.map((r) => r.id)).toEqual([second.id, first.id]);

      const actorTwo = await actionJournalStore.listFeed({ actor: '2' });
      expect(actorTwo.some((r) => r.id === second.id)).toBe(true);
      expect(actorTwo.some((r) => r.id === first.id)).toBe(false);
    });
  });
});
