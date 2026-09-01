'use strict';

/**
 * downloadService test scaffold.
 * Verifies nodeId-based multi-file ZIP download per spec.
 * @see docs/spec/server/services/downloadService.md
 */

// ─── Mock factories ────────────────────────────────────────────────

const {
  createFileNodeServiceMock,
  createAclServiceMock,
  createBlobStorageServiceMock,
} = require('@testing/mocks/serviceMocks');

// ─── Mock archiver ─────────────────────────────────────────────────

jest.mock('archiver', () => {
  const factory = jest.fn(() => {
    const entries = [];
    return {
      _entries: entries,
      append: jest.fn().mockImplementation((content, opts) => {
        entries.push({ content, name: opts.name });
        return factory();
      }),
      finalize: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      pipe: jest.fn(),
    };
  });
  return factory;
});

const archiver = require('archiver');
const { createDownloadService } = require('../downloadService');

// ─── downloadMultiple ──────────────────────────────────────────────

describe('downloadService', () => {
  describe('downloadMultiple', () => {
    it('assembles ZIP stream for valid nodeIds with read permission', async () => {
      const fileNodeService = createFileNodeServiceMock({
        getNodePath: jest.fn().mockResolvedValue('/files/doc.txt'),
      });
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10, 20], 'user-1', { id: 'user-1' });

      expect(result).toBeDefined();
      expect(result.totalFiles).toBe(2);
      expect(result.downloadId).toBeDefined();
      expect(result.errors).toEqual([]);
      expect(aclService.checkFilePermission).toHaveBeenCalledWith('user-1', 10, 'read');
      expect(aclService.checkFilePermission).toHaveBeenCalledWith('user-1', 20, 'read');
    });

    it('excludes files where user lacks read permission and records in errors[]', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10, 20], 'user-1', { id: 'user-1' });

      expect(result.totalFiles).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 20, reason: 'permission_denied' }),
        ])
      );
    });

    it('returns 403-style error when ALL files fail permission check', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      await expect(
        service.downloadMultiple([10, 20], 'user-1', { id: 'user-1' })
      ).rejects.toThrow();
    });

    it('performs async permission check per file (not sync checker)', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10, 20], 'user-1', { id: 'user-1' });

      expect(aclService.checkFilePermission).toHaveBeenCalledTimes(2);
      expect(aclService.checkFilePermission).toHaveBeenCalledWith('user-1', 10, 'read');
      expect(aclService.checkFilePermission).toHaveBeenCalledWith('user-1', 20, 'read');

      expect(result.totalFiles).toBe(2);
      expect(result.errors).toEqual([]);
      expect(result.downloadId).toBeDefined();
    });

    it('resolves blob content via correct backend (S3: object_map→s3_key; WebDAV: path resolution)', async () => {
      const fileNodeService = createFileNodeServiceMock({
        getNodePath: jest.fn().mockResolvedValue('/files/test.txt'),
      });
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      await service.downloadMultiple([10], 'user-1', { id: 'user-1' });

      expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(10);
    });

    it('generates downloadId for progress tracking', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10], 'user-1', { id: 'user-1' });

      expect(result.downloadId).toBeDefined();
      expect(typeof result.downloadId).toBe('string');
    });

    it('streams ZIP without buffering entire archive in memory', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10], 'user-1', { id: 'user-1' });

      expect(result.zipStream).toBeDefined();
      expect(archiver).toHaveBeenCalled();
    });

    it('skips directory nodes with reason directory_skipped and does not call downloadBlob', async () => {
      const fileNodeService = createFileNodeServiceMock({
        getNode: jest
          .fn()
          .mockImplementation(async (nodeId) =>
            nodeId === 10
              ? { id: 10, name: 'dir-10', type: 'directory' }
              : { id: nodeId, name: `file_${nodeId}.txt`, type: 'file' }
          ),
      });
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10, 20], 'user-1', { id: 'user-1' });

      expect(result.totalFiles).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 10, reason: 'directory_skipped' }),
        ])
      );
      expect(blobStorageService.downloadBlob).not.toHaveBeenCalledWith(10);
      expect(blobStorageService.downloadBlob).toHaveBeenCalledWith(20);
      expect(result.zipStream._entries).toEqual([expect.objectContaining({ name: 'file_20.txt' })]);
    });

    it('all-directory selection produces empty ZIP without hang', async () => {
      const fileNodeService = createFileNodeServiceMock({
        getNode: jest.fn().mockImplementation(async (nodeId) => ({
          id: nodeId,
          name: `dir-${nodeId}`,
          type: 'directory',
        })),
      });
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const result = await service.downloadMultiple([10, 20], 'user-1', { id: 'user-1' });

      expect(result.totalFiles).toBe(0);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: 10, reason: 'directory_skipped' }),
          expect.objectContaining({ nodeId: 20, reason: 'directory_skipped' }),
        ])
      );
      expect(blobStorageService.downloadBlob).not.toHaveBeenCalled();
      expect(result.zipStream).toBeDefined();
      expect(result.zipStream._entries).toEqual([]);
    });
  });

  // ─── getDownloadProgress ────────────────────────────────────────

  describe('getDownloadProgress', () => {
    it('returns { completed, total, percentage } for active downloadId', async () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock({
        checkFilePermission: jest.fn().mockResolvedValue(true),
      });

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const downloadResult = await service.downloadMultiple([10], 'user-1', { id: 'user-1' });
      const progress = service.getDownloadProgress(downloadResult.downloadId);

      expect(progress).toBeDefined();
      expect(progress.completed).toBeGreaterThanOrEqual(0);
      expect(progress.total).toBeGreaterThan(0);
      expect(typeof progress.percentage).toBe('number');
    });

    it('returns null for expired/unknown downloadId', () => {
      const fileNodeService = createFileNodeServiceMock();
      const blobStorageService = createBlobStorageServiceMock();
      const aclService = createAclServiceMock();

      const service = createDownloadService({ fileNodeService, blobStorageService, aclService });

      const progress = service.getDownloadProgress('non-existent-id');

      expect(progress).toBeNull();
    });
  });
});
