'use strict';

/**
 * AdminReportsRepository L2 conformance
 * (docs/spec/server/store/repository-contract.md). Runs against the ACTIVE
 * backend via createTestDatabase() (sqlite default leg; real PG adapter leg).
 *
 * The `admin_reports` table DDL is owned by T0.2 (§5,
 * 001_initial_normalized_schema.sql); the store/routes land with T0.8
 * (docs/spec/server/routes/admin.md §2.2.6).
 */

const { createTestDatabase } = require('@server/test-utils');
const storage = require('@server/store/storage');
const createAdminReportsRepository = require('@server/store/repositories/AdminReportsRepository');

describe('AdminReportsRepository conformance', () => {
  let dbCleanup;
  let repo;
  let seq = 0;

  beforeAll(async () => {
    const db = await createTestDatabase();
    dbCleanup = db.cleanup;
    repo = createAdminReportsRepository(storage.getExecutor());
  });

  afterAll(async () => {
    await dbCleanup();
  });

  const rowSpec = (kind, payload, createdAt, status = 'ok') => ({
    kind,
    status,
    payload,
    created_at: createdAt,
  });

  it('reports the active dialect', () => {
    expect(['sqlite', 'postgres']).toContain(repo.dialect);
  });

  it('insertReport round-trips kind/status/payload/created_at (domain shape)', async () => {
    seq += 1;
    const payload = {
      contentHashCompleteness: { nullCount: 3, checkedAt: '2026-09-22T00:00:00.000Z' },
    };
    const inserted = await repo.insertReport(
      rowSpec('failsafe', payload, '2026-09-22T10:00:00.000Z', 'partial')
    );

    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.kind).toBe('failsafe');
    expect(inserted.status).toBe('partial');
    expect(inserted.payload).toEqual(payload);
    expect(inserted.createdAt).toBe('2026-09-22T10:00:00.000Z');

    const fetched = await repo.getReport(inserted.id);
    expect(fetched).toEqual(inserted);
  });

  it('insertReport accepts a null payload', async () => {
    seq += 1;
    const inserted = await repo.insertReport(
      rowSpec('gc', null, `2026-09-22T10:00:0${seq % 10}.000Z`)
    );
    expect(inserted.payload).toBeNull();
    expect(await repo.getReport(inserted.id)).toEqual(inserted);
  });

  it('listReports is newest first (created_at desc, id desc tiebreak)', async () => {
    seq += 1;
    const older = await repo.insertReport(rowSpec('gc', { n: 1 }, '2026-09-22T09:00:00.000Z'));
    const newer = await repo.insertReport(rowSpec('gc', { n: 2 }, '2026-09-22T11:00:00.000Z'));
    const tieNew = await repo.insertReport(rowSpec('gc', { n: 3 }, '2026-09-22T09:00:00.000Z'));
    // older.id < tieNew.id share created_at; the tiebreak must put the higher id first.

    const list = await repo.listReports();
    const ids = list.map((r) => r.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(tieNew.id));
    expect(ids.indexOf(tieNew.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it('getReport returns null for an unknown id', async () => {
    await expect(repo.getReport(999999999)).resolves.toBeNull();
  });

  it('updateReport patches payload and status and returns the updated row', async () => {
    seq += 1;
    const inserted = await repo.insertReport(
      rowSpec(
        'failsafe',
        { contentHashCompleteness: { nullCount: 5 } },
        '2026-09-22T12:00:00.000Z',
        'partial'
      )
    );

    const payload = {
      contentHashCompleteness: {
        nullCount: 0,
        backfilled: 5,
        checkedAt: '2026-09-22T12:30:00.000Z',
      },
    };
    const updated = await repo.updateReport(inserted.id, { payload, status: 'ok' });

    expect(updated).toMatchObject({ id: inserted.id, kind: 'failsafe', status: 'ok' });
    expect(updated.payload).toEqual(payload);
    expect(await repo.getReport(inserted.id)).toEqual(updated);
  });

  it('updateReport patches only the provided fields', async () => {
    seq += 1;
    const inserted = await repo.insertReport(
      rowSpec('cleanup', { errors: [] }, '2026-09-22T12:10:00.000Z', 'ok')
    );

    const statusOnly = await repo.updateReport(inserted.id, { status: 'partial' });
    expect(statusOnly.status).toBe('partial');
    expect(statusOnly.payload).toEqual({ errors: [] });

    const payloadOnly = await repo.updateReport(inserted.id, { payload: { backfilled: 2 } });
    expect(payloadOnly.status).toBe('partial');
    expect(payloadOnly.payload).toEqual({ backfilled: 2 });
  });

  it('updateReport returns null for an unknown id', async () => {
    await expect(repo.updateReport(999999999, { status: 'ok' })).resolves.toBeNull();
  });
});
