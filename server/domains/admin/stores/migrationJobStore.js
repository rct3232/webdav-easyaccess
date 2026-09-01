'use strict';

const crypto = require('crypto');

const MIGRATION_JOB_TTL_MS = 60 * 60 * 1000;
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

function MigrationJobStore() {
  this._jobs = new Map();
}

MigrationJobStore.prototype._isExpired = function (job) {
  if (!job || !job.createdAt) return true;
  const terminal = TERMINAL_STATUSES.includes(job.status);
  if (!terminal) return false;
  const base = job.completedAt || job.createdAt;
  return Date.now() - new Date(base).getTime() > MIGRATION_JOB_TTL_MS;
};

MigrationJobStore.prototype.create = function (fields = {}) {
  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  // Blob jobs keep the legacy scalar progress/count shape; metadata jobs carry
  // the extended { percent, currentLabel, counters? } payload (PLAN §5).
  const type = fields.type || 'blobs';
  const job = {
    jobId,
    type,
    direction: fields.direction || null,
    mode: fields.mode || 'dry-run',
    status: 'pending',
    stage: fields.stage || null,
    progress:
      fields.progress !== undefined
        ? fields.progress
        : type === 'metadata'
          ? { percent: 0, currentLabel: null }
          : 0,
    total: 0,
    current: null,
    results: { copied: 0, skipped: 0, failed: 0, errors: [] },
    errorMessage: null,
    configPersist: fields.configPersist || null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  this._jobs.set(jobId, job);
  return job;
};

MigrationJobStore.prototype.update = function (jobId, patch) {
  const job = this._jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  if (TERMINAL_STATUSES.includes(job.status) && !job.completedAt) {
    job.completedAt = new Date().toISOString();
  }
  return job;
};

MigrationJobStore.prototype.get = function (jobId) {
  const job = this._jobs.get(jobId);
  if (!job) return null;
  if (this._isExpired(job)) {
    this._jobs.delete(jobId);
    return null;
  }
  return job;
};

MigrationJobStore.prototype.cancel = function (jobId) {
  const job = this._jobs.get(jobId);
  if (!job || TERMINAL_STATUSES.includes(job.status)) return false;
  job.status = 'cancelled';
  job.completedAt = new Date().toISOString();
  return true;
};

MigrationJobStore.prototype.isTerminal = function (jobId) {
  const job = this._jobs.get(jobId);
  return Boolean(job && TERMINAL_STATUSES.includes(job.status));
};

MigrationJobStore.prototype.hasRunning = function () {
  for (const job of this._jobs.values()) {
    if (!TERMINAL_STATUSES.includes(job.status)) return true;
  }
  return false;
};

let _instance = null;

function createMigrationJobStore() {
  if (_instance) return _instance;
  _instance = new MigrationJobStore();
  return _instance;
}

function setInstance(instance) {
  _instance = instance;
}

module.exports = {
  MigrationJobStore,
  createMigrationJobStore,
  setInstance,
  MIGRATION_JOB_TTL_MS,
};
