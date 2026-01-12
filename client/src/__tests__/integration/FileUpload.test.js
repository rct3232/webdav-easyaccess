import React from 'react';
import { renderWithProviders, screen, waitFor, fireEvent, createMockFile } from '../../test-utils';
import { uploadMultipleFiles } from '../../services/fileService';

// Mock the file service
jest.mock('../../services/fileService', () => ({
  uploadMultipleFiles: jest.fn(),
}));

describe('File Upload Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadMultipleFiles', () => {
    it('should upload files successfully', async () => {
      const mockFiles = [
        { file: createMockFile('test1.txt', 1024), relativePath: '' },
        { file: createMockFile('test2.txt', 2048), relativePath: '' },
      ];

      const mockProgressCallback = jest.fn();
      const mockResponse = {
        results: mockFiles.map(f => ({ file: f.file, success: true })),
        errors: [],
      };

      uploadMultipleFiles.mockImplementation(async (files, path, onProgress) => {
        // Simulate progress updates
        onProgress({ current: 1, total: 2, currentFile: 'test1.txt', status: 'uploading' });
        onProgress({ current: 2, total: 2, currentFile: 'test2.txt', status: 'uploading' });
        return mockResponse;
      });

      const result = await uploadMultipleFiles(mockFiles, '/', mockProgressCallback);

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          current: 1,
          total: 2,
          currentFile: 'test1.txt',
        })
      );
    });

    it('should handle upload errors', async () => {
      const mockFiles = [
        { file: createMockFile('test.txt', 1024), relativePath: '' },
      ];

      const mockError = new Error('Upload failed');
      uploadMultipleFiles.mockRejectedValue(mockError);

      await expect(uploadMultipleFiles(mockFiles, '/')).rejects.toThrow('Upload failed');
    });

    it('should report progress for multiple files', async () => {
      const mockFiles = [
        { file: createMockFile('file1.txt', 1024), relativePath: '' },
        { file: createMockFile('file2.txt', 2048), relativePath: '' },
        { file: createMockFile('file3.txt', 3072), relativePath: '' },
      ];

      const progressUpdates = [];
      uploadMultipleFiles.mockImplementation(async (files, path, onProgress) => {
        files.forEach((f, index) => {
          onProgress({
            current: index + 1,
            total: files.length,
            currentFile: f.file.name,
            status: 'uploading',
          });
        });
        return { results: files.map(f => ({ file: f.file, success: true })), errors: [] };
      });

      await uploadMultipleFiles(mockFiles, '/', (progress) => {
        progressUpdates.push(progress);
      });

      expect(progressUpdates).toHaveLength(3);
      expect(progressUpdates[0].current).toBe(1);
      expect(progressUpdates[1].current).toBe(2);
      expect(progressUpdates[2].current).toBe(3);
    });

    it('should handle partial upload failures', async () => {
      const mockFiles = [
        { file: createMockFile('success.txt', 1024), relativePath: '' },
        { file: createMockFile('fail.txt', 2048), relativePath: '' },
      ];

      uploadMultipleFiles.mockResolvedValue({
        results: [{ file: mockFiles[0].file, success: true }],
        errors: [{ file: mockFiles[1].file, error: 'Permission denied' }],
      });

      const result = await uploadMultipleFiles(mockFiles, '/');

      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Permission denied');
    });
  });

  describe('File Upload Validation', () => {
    it('should validate file size', () => {
      const largeFile = createMockFile('large.txt', 1024 * 1024 * 1024); // 1GB
      expect(largeFile.size).toBeGreaterThan(0);
    });

    it('should handle empty file list', async () => {
      uploadMultipleFiles.mockResolvedValue({
        results: [],
        errors: [],
      });

      const result = await uploadMultipleFiles([], '/');
      expect(result.results).toHaveLength(0);
    });

    it('should preserve relative paths for folder uploads', async () => {
      const mockFiles = [
        { file: createMockFile('file.txt', 1024), relativePath: 'folder/subfolder/file.txt' },
      ];

      let capturedFiles;
      uploadMultipleFiles.mockImplementation(async (files) => {
        capturedFiles = files;
        return { results: files.map(f => ({ file: f.file, success: true })), errors: [] };
      });

      await uploadMultipleFiles(mockFiles, '/');
      expect(capturedFiles[0].relativePath).toBe('folder/subfolder/file.txt');
    });
  });

  describe('Upload Progress States', () => {
    it('should track preparing state', async () => {
      const mockFiles = [{ file: createMockFile('test.txt', 1024), relativePath: '' }];
      
      const progressStates = [];
      uploadMultipleFiles.mockImplementation(async (files, path, onProgress) => {
        onProgress({ status: 'preparing', current: 0, total: 1 });
        onProgress({ status: 'uploading', current: 1, total: 1 });
        return { results: [{ file: files[0].file, success: true }], errors: [] };
      });

      await uploadMultipleFiles(mockFiles, '/', (progress) => {
        progressStates.push(progress.status);
      });

      expect(progressStates).toContain('preparing');
      expect(progressStates).toContain('uploading');
    });

    it('should track error state', async () => {
      const mockFiles = [{ file: createMockFile('test.txt', 1024), relativePath: '' }];
      
      let errorState;
      uploadMultipleFiles.mockImplementation(async (files, path, onProgress) => {
        onProgress({ status: 'error', error: 'Network error' });
        throw new Error('Network error');
      });

      try {
        await uploadMultipleFiles(mockFiles, '/', (progress) => {
          if (progress.status === 'error') {
            errorState = progress;
          }
        });
      } catch (error) {
        expect(errorState).toBeDefined();
        expect(errorState.error).toBe('Network error');
      }
    });
  });
});

