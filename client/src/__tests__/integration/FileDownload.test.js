import { downloadFile, downloadMultipleFiles } from '../../services/fileService';

// Mock the file service
jest.mock('../../services/fileService', () => ({
  downloadFile: jest.fn(),
  downloadMultipleFiles: jest.fn(),
}));

describe('File Download Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('downloadFile', () => {
    it('should download a single file', async () => {
      downloadFile.mockResolvedValue(undefined);

      await downloadFile('/test.txt');

      expect(downloadFile).toHaveBeenCalledWith('/test.txt');
    });

    it('should handle download errors', async () => {
      const error = new Error('Download failed');
      downloadFile.mockRejectedValue(error);

      await expect(downloadFile('/test.txt')).rejects.toThrow('Download failed');
    });

    it('should download files from different paths', async () => {
      downloadFile.mockResolvedValue(undefined);

      await downloadFile('/folder/file1.txt');
      await downloadFile('/another/file2.pdf');

      expect(downloadFile).toHaveBeenCalledTimes(2);
      expect(downloadFile).toHaveBeenCalledWith('/folder/file1.txt');
      expect(downloadFile).toHaveBeenCalledWith('/another/file2.pdf');
    });
  });

  describe('downloadMultipleFiles', () => {
    it('should download multiple files as zip', async () => {
      const filePaths = ['/file1.txt', '/file2.txt', '/file3.txt'];
      const mockProgressCallback = jest.fn();

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        onProgress({ status: 'preparing', current: 'Creating archive...' });
        onProgress({ status: 'downloading', current: 'Downloading...' });
        onProgress({ status: 'completed', zipName: 'files.zip' });
      });

      await downloadMultipleFiles(filePaths, mockProgressCallback);

      expect(downloadMultipleFiles).toHaveBeenCalledWith(filePaths, mockProgressCallback);
      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'preparing' })
      );
    });

    it('should track download progress', async () => {
      const filePaths = ['/file1.txt'];
      const progressUpdates = [];

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        onProgress({ type: 'download', status: 'preparing', progress: 0 });
        onProgress({ type: 'download', status: 'processing', progress: 50 });
        onProgress({ type: 'download', status: 'completed', progress: 100 });
      });

      await downloadMultipleFiles(filePaths, (progress) => {
        progressUpdates.push(progress);
      });

      expect(progressUpdates).toHaveLength(3);
      expect(progressUpdates[0].status).toBe('preparing');
      expect(progressUpdates[1].status).toBe('processing');
      expect(progressUpdates[2].status).toBe('completed');
    });

    it('should handle download errors', async () => {
      const filePaths = ['/file1.txt'];
      const error = new Error('Network error');

      downloadMultipleFiles.mockRejectedValue(error);

      await expect(downloadMultipleFiles(filePaths)).rejects.toThrow('Network error');
    });

    it('should handle empty file list', async () => {
      downloadMultipleFiles.mockResolvedValue(undefined);

      await downloadMultipleFiles([]);

      expect(downloadMultipleFiles).toHaveBeenCalledWith([]);
    });
  });

  describe('Download Progress States', () => {
    it('should report preparing state', async () => {
      const filePaths = ['/test.txt'];
      let preparingReported = false;

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        onProgress({ status: 'preparing', current: 'Preparing download...' });
      });

      await downloadMultipleFiles(filePaths, (progress) => {
        if (progress.status === 'preparing') {
          preparingReported = true;
        }
      });

      expect(preparingReported).toBe(true);
    });

    it('should report zip creation progress', async () => {
      const filePaths = ['/file1.txt', '/file2.txt'];
      const progressStates = [];

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        onProgress({ status: 'preparing', current: 'Creating ZIP archive...' });
        onProgress({ status: 'processing', current: 'Adding files...' });
        onProgress({ status: 'completed', zipName: 'download.zip' });
      });

      await downloadMultipleFiles(filePaths, (progress) => {
        progressStates.push(progress.status);
      });

      expect(progressStates).toContain('preparing');
      expect(progressStates).toContain('processing');
      expect(progressStates).toContain('completed');
    });

    it('should handle download cancellation', async () => {
      const filePaths = ['/file.txt'];
      const error = new Error('Download cancelled');

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        onProgress({ status: 'preparing' });
        throw error;
      });

      await expect(downloadMultipleFiles(filePaths, jest.fn())).rejects.toThrow('Download cancelled');
    });
  });

  describe('Directory Downloads', () => {
    it('should download directory as zip', async () => {
      const dirPath = '/folder';

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        onProgress({
          status: 'completed',
          zipName: 'folder.zip',
        });
      });

      await downloadMultipleFiles([dirPath], jest.fn());

      expect(downloadMultipleFiles).toHaveBeenCalledWith([dirPath], expect.any(Function));
    });

    it('should handle large directory downloads', async () => {
      const dirPath = '/large-folder';
      const progressUpdates = [];

      downloadMultipleFiles.mockImplementation(async (paths, onProgress) => {
        for (let i = 0; i <= 100; i += 25) {
          onProgress({
            status: i === 100 ? 'completed' : 'processing',
            progress: i,
            current: `Processing ${i}%...`,
          });
        }
      });

      await downloadMultipleFiles([dirPath], (progress) => {
        progressUpdates.push(progress.progress);
      });

      expect(progressUpdates).toContain(0);
      expect(progressUpdates).toContain(25);
      expect(progressUpdates).toContain(50);
      expect(progressUpdates).toContain(75);
      expect(progressUpdates).toContain(100);
    });
  });
});

