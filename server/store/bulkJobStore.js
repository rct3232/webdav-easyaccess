const crypto = require('crypto');

const jobs = new Map();

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour for completed/cancelled/failed jobs

function generateJobId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function isJobExpired(job) {
  if (!job || !job.createdAt) return true;
  const terminal = ['completed', 'cancelled', 'failed'].includes(job.status);
  if (!terminal) return false;
  const age = Date.now() - new Date(job.createdAt).getTime();
  return age > JOB_TTL_MS;
}

/**
 * @param {string} userId
 * @param {'delete'|'move'|'copy'} operation
 * @param {{ paths?: string[], moves?: Array<{sourcePath, destinationPath}>, copies?: Array<{sourcePath, destinationPath}>, onConflict?: string }} payload
 * @returns {{ jobId: string, job: object }}
 */
function createJob(userId, operation, payload) {
  const jobId = generateJobId();
  const total = operation === 'delete'
    ? (payload.paths?.length ?? 0)
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
  jobs.set(jobId, job);
  return { jobId, job };
}

/**
 * @param {string} jobId
 * @returns {object|null} job or null if not found / expired
 */
function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (isJobExpired(job)) {
    jobs.delete(jobId);
    return null;
  }
  return job;
}

/**
 * @param {string} jobId
 * @returns {boolean} true if job was found and not yet cancelled
 */
function setJobCancelled(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.cancelled = true;
  return true;
}

/**
 * @param {string} jobId
 * @param {object} updates - fields to merge into job (status, progress, results, errorMessage, etc.)
 */
function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, updates);
}

module.exports = {
  createJob,
  getJob,
  setJobCancelled,
  updateJob,
};
