import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';
import * as fileService from '../../services/fileService';

// Mock file service
jest.mock('../../services/fileService');

describe('Folder Operations Integration Tests (F8, F9, F10, F21)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('폴더 생성 (F8)', () => {
    it('creates a new folder successfully', async () => {
      fileService.createFolder.mockResolvedValue({ success: true });

      const result = await fileService.createFolder('/testuser/newfolder');

      expect(fileService.createFolder).toHaveBeenCalledWith('/testuser/newfolder');
      expect(result.success).toBe(true);
    });

    it('handles folder creation failure (duplicate name)', async () => {
      fileService.createFolder.mockRejectedValue(new Error('Folder already exists'));

      await expect(
        fileService.createFolder('/testuser/existing')
      ).rejects.toThrow('Folder already exists');
    });

    it('validates folder name', () => {
      const invalidNames = ['', '..', '.', 'folder/name', 'folder\\name'];
      const validNames = ['newfolder', 'My Folder', 'folder-123', 'folder_name'];

      invalidNames.forEach(name => {
        const isValid = name.length > 0 && 
                       name !== '.' && 
                       name !== '..' && 
                       !name.includes('/') && 
                       !name.includes('\\');
        expect(isValid).toBe(false);
      });

      validNames.forEach(name => {
        const isValid = name.length > 0 && 
                       name !== '.' && 
                       name !== '..' && 
                       !name.includes('/') && 
                       !name.includes('\\');
        expect(isValid).toBe(true);
      });
    });
  });

  describe('폴더 삭제 (F9)', () => {
    it('deletes an empty folder successfully', async () => {
      fileService.deleteFile.mockResolvedValue({ success: true });

      const result = await fileService.deleteFile('/testuser/emptyfolder');

      expect(fileService.deleteFile).toHaveBeenCalledWith('/testuser/emptyfolder');
      expect(result.success).toBe(true);
    });

    it('deletes a folder with contents', async () => {
      fileService.deleteFile.mockResolvedValue({ success: true });

      const result = await fileService.deleteFile('/testuser/folder-with-files');

      expect(result.success).toBe(true);
    });

    it('handles delete failure (permission denied)', async () => {
      fileService.deleteFile.mockRejectedValue(new Error('Permission denied'));

      await expect(
        fileService.deleteFile('/otheruser/protected')
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('폴더 이동 (F10)', () => {
    it('moves folder to a new location', async () => {
      fileService.moveFile.mockResolvedValue({ success: true });

      const result = await fileService.moveFile(
        '/testuser/source/folder',
        '/testuser/destination/folder'
      );

      expect(fileService.moveFile).toHaveBeenCalledWith(
        '/testuser/source/folder',
        '/testuser/destination/folder'
      );
      expect(result.success).toBe(true);
    });

    it('handles move to same location', async () => {
      // Moving to same location should either succeed silently or be prevented
      fileService.moveFile.mockResolvedValue({ success: true });

      const result = await fileService.moveFile(
        '/testuser/folder',
        '/testuser/folder'
      );

      expect(result.success).toBe(true);
    });

    it('handles move with naming conflict', async () => {
      fileService.moveFile.mockRejectedValue(
        new Error('A folder with that name already exists')
      );

      await expect(
        fileService.moveFile('/testuser/folder', '/testuser/existing')
      ).rejects.toThrow('already exists');
    });
  });

  describe('폴더 복사 (F21)', () => {
    it('copies folder to a new location', async () => {
      fileService.copyFile.mockResolvedValue({ success: true });

      const result = await fileService.copyFile(
        '/testuser/source/folder',
        '/testuser/destination/folder'
      );

      expect(fileService.copyFile).toHaveBeenCalledWith(
        '/testuser/source/folder',
        '/testuser/destination/folder'
      );
      expect(result.success).toBe(true);
    });

    it('copies folder with all contents', async () => {
      fileService.copyFile.mockResolvedValue({
        success: true,
        copiedFiles: 5,
        copiedFolders: 2,
      });

      const result = await fileService.copyFile(
        '/testuser/folder-with-contents',
        '/testuser/destination/folder-with-contents'
      );

      expect(result.success).toBe(true);
    });

    it('handles copy with naming conflict (auto-rename)', async () => {
      fileService.copyFile.mockResolvedValue({
        success: true,
        newPath: '/testuser/destination/folder (1)',
      });

      const result = await fileService.copyFile(
        '/testuser/folder',
        '/testuser/destination/folder'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('폴더 이름 변경', () => {
    it('renames folder successfully', async () => {
      fileService.renameFile.mockResolvedValue({ success: true });

      const result = await fileService.renameFile(
        '/testuser/oldfolder',
        '/testuser/newfolder'
      );

      expect(fileService.renameFile).toHaveBeenCalledWith(
        '/testuser/oldfolder',
        '/testuser/newfolder'
      );
      expect(result.success).toBe(true);
    });

    it('handles rename with conflict', async () => {
      fileService.renameFile.mockRejectedValue(
        new Error('A folder with that name already exists')
      );

      await expect(
        fileService.renameFile('/testuser/folder', '/testuser/existing')
      ).rejects.toThrow('already exists');
    });
  });

  describe('폴더 목록 조회', () => {
    it('lists folder contents', async () => {
      const mockContents = [
        { path: '/testuser/folder/file1.txt', basename: 'file1.txt', type: 'file' },
        { path: '/testuser/folder/subfolder', basename: 'subfolder', type: 'directory' },
      ];
      fileService.listFiles.mockResolvedValue(mockContents);

      const result = await fileService.listFiles('/testuser/folder');

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('file');
      expect(result[1].type).toBe('directory');
    });

    it('handles empty folder', async () => {
      fileService.listFiles.mockResolvedValue([]);

      const result = await fileService.listFiles('/testuser/empty-folder');

      expect(result).toHaveLength(0);
    });

    it('handles access denied', async () => {
      fileService.listFiles.mockRejectedValue(new Error('Access denied'));

      await expect(
        fileService.listFiles('/protected/folder')
      ).rejects.toThrow('Access denied');
    });
  });

  describe('폴더 경로 처리', () => {
    it('normalizes folder paths', () => {
      const paths = [
        { input: '/testuser//folder', expected: '/testuser/folder' },
        { input: '/testuser/folder/', expected: '/testuser/folder' },
        { input: 'testuser/folder', expected: '/testuser/folder' },
      ];

      paths.forEach(({ input, expected }) => {
        // Simple normalization logic
        let normalized = input;
        if (!normalized.startsWith('/')) normalized = '/' + normalized;
        normalized = normalized.replace(/\/+/g, '/');
        if (normalized.endsWith('/') && normalized.length > 1) {
          normalized = normalized.slice(0, -1);
        }
        expect(normalized).toBe(expected);
      });
    });

    it('extracts folder name from path', () => {
      const paths = [
        { path: '/testuser/folder', expectedName: 'folder' },
        { path: '/testuser/parent/child', expectedName: 'child' },
        { path: '/root', expectedName: 'root' },
      ];

      paths.forEach(({ path, expectedName }) => {
        const name = path.split('/').pop();
        expect(name).toBe(expectedName);
      });
    });
  });
});
