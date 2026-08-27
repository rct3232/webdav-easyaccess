/**
 * migrationService tests.
 * Verifies public API: correct endpoints and return shapes per PLAN.md module E.
 * @see docs/spec/client/services/migrationService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get, post } from '../apiClient';

import {
  getMigrationInfo,
  startBlobMigration,
  getBlobMigrationStatus,
  cancelBlobMigration,
} from '../migrationService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

describe('migrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMigrationInfo', () => {
    it('GETs /admin/migration/info and returns { source, direction }', async () => {
      const info = { source: 'webdav', direction: 'webdav-to-s3' };
      get.mockResolvedValueOnce({ data: info });

      const result = await getMigrationInfo();

      expect(get).toHaveBeenCalledWith('/admin/migration/info');
      expect(result).toEqual(info);
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('direction');
    });

    it('rejects when the request fails', async () => {
      get.mockRejectedValueOnce(new Error('Request failed'));

      await expect(getMigrationInfo()).rejects.toThrow();
    });
  });

  describe('startBlobMigration', () => {
    it('POSTs /admin/migration/blobs with payload and returns { jobId }', async () => {
      post.mockResolvedValueOnce({ data: { jobId: 'mig-1' } });

      const payload = {
        mode: 'dry-run',
        force: false,
        dest: { type: 's3', bucket: 'bucket-1', accessKey: 'AK', secretKey: 'SK' },
      };
      const result = await startBlobMigration(payload);

      expect(post).toHaveBeenCalledWith('/admin/migration/blobs', payload);
      expect(result).toEqual({ jobId: 'mig-1' });
      expect(result).toHaveProperty('jobId');
    });

    it('rejects when the request fails', async () => {
      post.mockRejectedValueOnce(new Error('Request failed'));

      await expect(startBlobMigration({})).rejects.toThrow();
    });
  });

  describe('getBlobMigrationStatus', () => {
    it('GETs /admin/migration/jobs/:jobId and returns the job', async () => {
      const job = {
        jobId: 'mig-1',
        direction: 'webdav-to-s3',
        mode: 'dry-run',
        status: 'running',
        progress: 3,
        total: 10,
        current: '/testuser/docs/a.txt',
        results: { copied: 2, skipped: 1, failed: 0, errors: [] },
        errorMessage: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      get.mockResolvedValueOnce({ data: job });

      const result = await getBlobMigrationStatus('mig-1');

      expect(get).toHaveBeenCalledWith('/admin/migration/jobs/mig-1');
      expect(result).toEqual(job);
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('progress');
    });

    it('rejects when the request fails', async () => {
      get.mockRejectedValueOnce(new Error('Request failed'));

      await expect(getBlobMigrationStatus('mig-1')).rejects.toThrow();
    });
  });

  describe('cancelBlobMigration', () => {
    it('POSTs /admin/migration/jobs/:jobId/cancel and returns the response', async () => {
      post.mockResolvedValueOnce({ data: { messageCode: 'serverMessages.admin.migrationCancelled', jobId: 'mig-1' } });

      const result = await cancelBlobMigration('mig-1');

      expect(post).toHaveBeenCalledWith('/admin/migration/jobs/mig-1/cancel');
      expect(result).toEqual({ messageCode: 'serverMessages.admin.migrationCancelled', jobId: 'mig-1' });
    });
  });
});
