'use strict';

const {
  createMigrationJobStore,
  setInstance,
  MIGRATION_JOB_TTL_MS,
} = require('../migrationJobStore');

describe('createMigrationJobStore', () => {
  let store;

  beforeEach(() => {
    setInstance(null);
    store = createMigrationJobStore();
  });

  it('create returns a job with a unique jobId, status pending, and documented defaults', () => {
    const job = store.create({ direction: 'webdav-to-s3', mode: 'dry-run' });
    expect(job.jobId).toBeDefined();
    expect(store.create({ direction: 's3-to-webdav' }).jobId).not.toBe(job.jobId);
    expect(job.direction).toBe('webdav-to-s3');
    expect(job.mode).toBe('dry-run');
    expect(job.status).toBe('pending');
    expect(job.progress).toBe(0);
    expect(job.total).toBe(0);
    expect(job.current).toBeNull();
    expect(job.results).toEqual({ copied: 0, skipped: 0, failed: 0, errors: [] });
    expect(job.errorMessage).toBeNull();
    expect(job.createdAt).toBeDefined();
    expect(job.completedAt).toBeNull();
  });

  it('update merges fields into the job and returns the job', () => {
    const job = store.create({ direction: 'webdav-to-s3' });
    const updated = store.update(job.jobId, {
      status: 'running',
      progress: 0.5,
      results: { copied: 1, skipped: 0, failed: 0, errors: [] },
    });
    expect(updated).toBe(job);
    expect(job.status).toBe('running');
    expect(job.progress).toBe(0.5);
    expect(job.results.copied).toBe(1);
  });

  it('update returns null for an unknown jobId', () => {
    expect(store.update('missing', { status: 'running' })).toBeNull();
  });

  it('get returns the job and null for unknown jobIds', () => {
    const job = store.create({ direction: 's3-to-webdav' });
    expect(store.get(job.jobId)).toBe(job);
    expect(store.get('missing')).toBeNull();
  });

  it('cancel marks a non-terminal job cancelled; false for terminal or unknown', () => {
    const job = store.create({ direction: 'webdav-to-s3' });
    expect(store.cancel(job.jobId)).toBe(true);
    expect(job.status).toBe('cancelled');
    expect(store.isTerminal(job.jobId)).toBe(true);
    expect(store.cancel(job.jobId)).toBe(false);
    expect(store.cancel('missing')).toBe(false);
  });

  it('isTerminal is true only for completed, failed, cancelled', () => {
    const pending = store.create({ direction: 'webdav-to-s3' });
    expect(store.isTerminal(pending.jobId)).toBe(false);

    const running = store.create({ direction: 'webdav-to-s3' });
    store.update(running.jobId, { status: 'running' });
    expect(store.isTerminal(running.jobId)).toBe(false);

    const completed = store.create({ direction: 'webdav-to-s3' });
    store.update(completed.jobId, { status: 'completed' });
    expect(store.isTerminal(completed.jobId)).toBe(true);

    const failed = store.create({ direction: 'webdav-to-s3' });
    store.update(failed.jobId, { status: 'failed' });
    expect(store.isTerminal(failed.jobId)).toBe(true);

    expect(store.isTerminal('missing')).toBe(false);
  });

  it('hasRunning is true while any non-terminal job exists', () => {
    store.create({ direction: 'webdav-to-s3' });
    expect(store.hasRunning()).toBe(true);

    const completed = store.create({ direction: 'webdav-to-s3' });
    store.update(completed.jobId, { status: 'completed' });
    expect(store.hasRunning()).toBe(true);
  });

  it('hasRunning is false when every job is terminal', () => {
    const job = store.create({ direction: 'webdav-to-s3' });
    store.update(job.jobId, { status: 'completed' });
    expect(store.hasRunning()).toBe(false);
  });

  it('a terminal job past TTL is treated as unknown and removed', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const job = store.create({ direction: 'webdav-to-s3' });
      store.update(job.jobId, { status: 'completed' });
      expect(store.get(job.jobId)).toBe(job);

      jest.setSystemTime(new Date(Date.now() + MIGRATION_JOB_TTL_MS + 1000));
      expect(store.get(job.jobId)).toBeNull();
      expect(store._jobs.has(job.jobId)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('non-terminal jobs are never expired', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const job = store.create({ direction: 'webdav-to-s3' });
      jest.setSystemTime(new Date(Date.now() + MIGRATION_JOB_TTL_MS + 1000));
      expect(store.get(job.jobId)).toBe(job);
    } finally {
      jest.useRealTimers();
    }
  });
});
