'use strict';

const crypto = require('crypto');
const { createCacheAdapter } = require('../../../infrastructure/adapters/cache');

const DOWNLOAD_PROGRESS_TTL_MS = 5 * 60 * 1000;
const PREVIEW_TICKET_TTL_MS = parseInt(process.env.WEA_PREVIEW_TICKET_TTL_MS, 10) || 120000;
const BULK_JOB_TTL_MS = 60 * 60 * 1000;

function OperationProgressStore(downloadCache, previewTicketCache, bulkJobCache) {
  this.downloadCache = downloadCache;
  this.previewTicketCache = previewTicketCache;
  this.bulkJobCache = bulkJobCache;
}

OperationProgressStore.prototype.setDownloadProgress = function (id, state) {
  this.downloadCache.set(`dp:${id}`, state);
};

OperationProgressStore.prototype.getDownloadProgress = function (id) {
  return this.downloadCache.get(`dp:${id}`);
};

OperationProgressStore.prototype.cleanupDownloadProgress = function (id, ttlMs) {
  setTimeout(() => {
    this.downloadCache.delete(`dp:${id}`);
  }, ttlMs || DOWNLOAD_PROGRESS_TTL_MS);
};

OperationProgressStore.prototype.issuePreviewTicket = function (principalId, fileNodeId, ttlMs) {
  const ticket = crypto.randomBytes(32).toString('hex');
  this.previewTicketCache.set(
    `pt:${ticket}`,
    { principalId, fileNodeId },
    ttlMs || PREVIEW_TICKET_TTL_MS
  );
  return ticket;
};

OperationProgressStore.prototype.readPreviewTicket = function (ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  const entry = this.previewTicketCache.get(`pt:${ticket}`);
  if (!entry) return null;
  return { principalId: entry.principalId, fileNodeId: entry.fileNodeId };
};

OperationProgressStore.prototype.createJob = function (userId, operation, payload) {
  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const total = operation === 'delete'
    ? (payload.nodeIds?.length ?? payload.paths?.length ?? 0)
    : (payload.moves?.length ?? payload.copies?.length ?? 0);
  const job = {
    jobId,
    userId,
    operation,
    payload,
    status: 'pending',
    results: [],
    progress: 0,
    total,
    cancelled: false,
    createdAt: new Date().toISOString(),
    errorMessage: null,
  };
  this.bulkJobCache.set(`bj:${jobId}`, job);
  return { jobId, job };
};

OperationProgressStore.prototype.getJob = function (jobId) {
  const job = this.bulkJobCache.get(`bj:${jobId}`);
  if (!job) return null;
  if (this._isJobExpired(job)) {
    this.bulkJobCache.delete(`bj:${jobId}`);
    return null;
  }
  return job;
};

OperationProgressStore.prototype.setJobCancelled = function (jobId) {
  const job = this.bulkJobCache.get(`bj:${jobId}`);
  if (!job) return false;
  job.cancelled = true;
  return true;
};

OperationProgressStore.prototype.updateJob = function (jobId, updates) {
  const job = this.bulkJobCache.get(`bj:${jobId}`);
  if (!job) return;
  Object.assign(job, updates);
};

OperationProgressStore.prototype._isJobExpired = function (job) {
  if (!job || !job.createdAt) return true;
  const terminal = ['completed', 'cancelled', 'failed'].includes(job.status);
  if (!terminal) return false;
  return Date.now() - new Date(job.createdAt).getTime() > BULK_JOB_TTL_MS;
};

let _instance = null;

function createOperationProgressStore() {
  if (_instance) return _instance;
  _instance = new OperationProgressStore(
    createCacheAdapter(),
    createCacheAdapter(),
    createCacheAdapter()
  );
  return _instance;
}

function setInstance(instance) {
  _instance = instance;
}

module.exports = {
  OperationProgressStore,
  createOperationProgressStore,
  setInstance,
};
