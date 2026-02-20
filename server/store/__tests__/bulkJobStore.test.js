/**
 * bulkJobStore tests.
 * Verifies createJob, getJob, setJobCancelled, updateJob.
 */
const bulkJobStore = require('../bulkJobStore');

describe('bulkJobStore', () => {
  describe('createJob', () => {
    it('creates job and returns jobId and job', () => {
      const { jobId, job } = bulkJobStore.createJob('user1', 'move', {
        moves: [{ sourcePath: '/a', destinationPath: '/b' }],
      });
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(job).toMatchObject({
        userId: 'user1',
        operation: 'move',
        status: 'pending',
        progress: 0,
        total: 1,
        cancelled: false,
      });
      expect(job.jobId).toBe(jobId);
    });
  });

  describe('getJob', () => {
    it('returns job when exists', () => {
      const { jobId, job } = bulkJobStore.createJob('u', 'delete', { paths: ['/x'] });
      const retrieved = bulkJobStore.getJob(jobId);
      expect(retrieved).toEqual(job);
    });

    it('returns null when job does not exist', () => {
      const retrieved = bulkJobStore.getJob('nonexistent-job-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('setJobCancelled', () => {
    it('sets cancelled to true and returns true', () => {
      const { jobId } = bulkJobStore.createJob('u', 'copy', { copies: [] });
      const ok = bulkJobStore.setJobCancelled(jobId);
      expect(ok).toBe(true);
      const job = bulkJobStore.getJob(jobId);
      expect(job.cancelled).toBe(true);
    });

    it('returns false when job does not exist', () => {
      const ok = bulkJobStore.setJobCancelled('nonexistent');
      expect(ok).toBe(false);
    });
  });

  describe('updateJob', () => {
    it('merges updates into job', () => {
      const { jobId } = bulkJobStore.createJob('u', 'move', {
        moves: [{ sourcePath: '/a', destinationPath: '/b' }],
      });
      bulkJobStore.updateJob(jobId, { status: 'completed', progress: 1 });
      const job = bulkJobStore.getJob(jobId);
      expect(job.status).toBe('completed');
      expect(job.progress).toBe(1);
    });
  });
});
