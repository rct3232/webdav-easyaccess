/**
 * Unit tests for pathUtils
 * Tests all path manipulation functions including edge cases
 */

const {
  normalizePath,
  getParentPath,
  getBasename,
  isPathUnder,
  getParentPaths
} = require('../pathUtils');

describe('pathUtils', () => {
  describe('normalizePath', () => {
    it('should normalize simple paths', () => {
      expect(normalizePath('/folder/file.txt')).toBe('/folder/file.txt');
      expect(normalizePath('folder/file.txt')).toBe('/folder/file.txt');
      expect(normalizePath('/folder')).toBe('/folder');
    });

    it('should handle root path', () => {
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('')).toBe('/');
      expect(normalizePath('   ')).toBe('/');
    });

    it('should remove trailing slashes except for root', () => {
      expect(normalizePath('/folder/')).toBe('/folder');
      expect(normalizePath('/folder/subfolder/')).toBe('/folder/subfolder');
      expect(normalizePath('/')).toBe('/');
    });

    it('should add leading slash if missing', () => {
      expect(normalizePath('folder')).toBe('/folder');
      expect(normalizePath('folder/file.txt')).toBe('/folder/file.txt');
    });

    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('\\folder\\file.txt')).toBe('/folder/file.txt');
      expect(normalizePath('folder\\subfolder\\file.txt')).toBe('/folder/subfolder/file.txt');
    });

    it('should remove duplicate slashes', () => {
      expect(normalizePath('//folder///file.txt')).toBe('/folder/file.txt');
      expect(normalizePath('/folder//subfolder///file.txt')).toBe('/folder/subfolder/file.txt');
    });

    it('should handle complex cases', () => {
      expect(normalizePath('\\\\folder///subfolder\\\\')).toBe('/folder/subfolder');
      expect(normalizePath('  /folder/  ')).toBe('/folder');
    });

    it('should handle null and undefined', () => {
      expect(normalizePath(null)).toBe('/');
      expect(normalizePath(undefined)).toBe('/');
    });
  });

  describe('normalizePath with isDirectory option', () => {
    it('should normalize path with trailing slash when isDirectory is true', () => {
      expect(normalizePath('/folder', { isDirectory: true })).toBe('/folder/');
      expect(normalizePath('/folder/subfolder', { isDirectory: true })).toBe('/folder/subfolder/');
    });

    it('should handle root path specially', () => {
      expect(normalizePath('/', { isDirectory: true })).toBe('/');
      expect(normalizePath('', { isDirectory: true })).toBe('/');
    });

    it('should not double-add trailing slash', () => {
      expect(normalizePath('/folder/', { isDirectory: true })).toBe('/folder/');
      expect(normalizePath('/folder/subfolder/', { isDirectory: true })).toBe('/folder/subfolder/');
    });

    it('should handle paths without leading slash', () => {
      expect(normalizePath('folder', { isDirectory: true })).toBe('/folder/');
      expect(normalizePath('folder/subfolder', { isDirectory: true })).toBe('/folder/subfolder/');
    });

    it('should handle complex cases with normalization', () => {
      expect(normalizePath('//folder///subfolder//', { isDirectory: true })).toBe('/folder/subfolder/');
      expect(normalizePath('\\folder\\subfolder', { isDirectory: true })).toBe('/folder/subfolder/');
    });

    it('should not add trailing slash when isDirectory is false or omitted', () => {
      expect(normalizePath('/folder')).toBe('/folder');
      expect(normalizePath('/folder', { isDirectory: false })).toBe('/folder');
    });
  });

  describe('getParentPath', () => {
    it('should return parent path', () => {
      expect(getParentPath('/folder/file.txt')).toBe('/folder');
      expect(getParentPath('/folder/subfolder/file.txt')).toBe('/folder/subfolder');
    });

    it('should handle root level folders', () => {
      expect(getParentPath('/folder')).toBe('/');
    });

    it('should return root for root path', () => {
      expect(getParentPath('/')).toBe('/');
    });

    it('should handle paths without leading slash', () => {
      expect(getParentPath('folder/file.txt')).toBe('/folder');
      expect(getParentPath('folder')).toBe('/');
    });

    it('should handle complex paths', () => {
      expect(getParentPath('/a/b/c/d/e')).toBe('/a/b/c/d');
      expect(getParentPath('//folder///subfolder//file.txt')).toBe('/folder/subfolder');
    });
  });

  describe('getBasename', () => {
    it('should return basename of path', () => {
      expect(getBasename('/folder/file.txt')).toBe('file.txt');
      expect(getBasename('/folder/subfolder/document.pdf')).toBe('document.pdf');
    });

    it('should handle folder paths', () => {
      expect(getBasename('/folder/subfolder')).toBe('subfolder');
      expect(getBasename('/folder')).toBe('folder');
    });

    it('should handle root path', () => {
      expect(getBasename('/')).toBe('/');
    });

    it('should handle paths without leading slash', () => {
      expect(getBasename('folder/file.txt')).toBe('file.txt');
      expect(getBasename('file.txt')).toBe('file.txt');
    });

    it('should handle complex filenames', () => {
      expect(getBasename('/folder/my.file.name.txt')).toBe('my.file.name.txt');
      expect(getBasename('/folder/名前.txt')).toBe('名前.txt');
    });
  });

  describe('isPathUnder', () => {
    it('should return true for child paths', () => {
      expect(isPathUnder('/folder/subfolder', '/folder')).toBe(true);
      expect(isPathUnder('/folder/subfolder/file.txt', '/folder')).toBe(true);
      expect(isPathUnder('/a/b/c', '/a/b')).toBe(true);
    });

    it('should return true for same path', () => {
      expect(isPathUnder('/folder', '/folder')).toBe(true);
      expect(isPathUnder('/folder/subfolder', '/folder/subfolder')).toBe(true);
    });

    it('should return false for non-child paths', () => {
      expect(isPathUnder('/folder1', '/folder2')).toBe(false);
      expect(isPathUnder('/folder', '/folder2')).toBe(false);
    });

    it('should return false for parent paths', () => {
      expect(isPathUnder('/folder', '/folder/subfolder')).toBe(false);
    });

    it('should handle root parent path', () => {
      expect(isPathUnder('/folder', '/')).toBe(true);
      expect(isPathUnder('/any/path', '/')).toBe(true);
    });

    it('should handle similar named paths correctly', () => {
      expect(isPathUnder('/folder', '/fold')).toBe(false);
      expect(isPathUnder('/folder123', '/folder')).toBe(false);
    });

    it('should normalize paths before comparing', () => {
      expect(isPathUnder('//folder///subfolder//', '/folder')).toBe(true);
      expect(isPathUnder('folder/subfolder', '/folder/')).toBe(true);
    });
  });

  describe('getParentPaths', () => {
    it('should return all parent paths', () => {
      expect(getParentPaths('/a/b/c/d')).toEqual([
        '/a/b/c',
        '/a/b',
        '/a',
        '/'
      ]);
    });

    it('should return parents for simple path', () => {
      expect(getParentPaths('/folder/file.txt')).toEqual([
        '/folder',
        '/'
      ]);
    });

    it('should return empty array for root', () => {
      expect(getParentPaths('/')).toEqual([]);
    });

    it('should return only root for top-level path', () => {
      expect(getParentPaths('/folder')).toEqual(['/']);
    });

    it('should normalize path before processing', () => {
      expect(getParentPaths('//folder///subfolder//file.txt')).toEqual([
        '/folder/subfolder',
        '/folder',
        '/'
      ]);
    });

    it('should handle paths without leading slash', () => {
      expect(getParentPaths('folder/subfolder/file.txt')).toEqual([
        '/folder/subfolder',
        '/folder',
        '/'
      ]);
    });

    it('should handle deep nested paths', () => {
      const result = getParentPaths('/a/b/c/d/e/f');
      expect(result).toHaveLength(6);
      expect(result[0]).toBe('/a/b/c/d/e');
      expect(result[result.length - 1]).toBe('/');
    });
  });

  describe('Edge Cases and Integration', () => {
    it('should handle empty strings consistently', () => {
      expect(normalizePath('')).toBe('/');
      expect(normalizePath('', { isDirectory: true })).toBe('/');
      expect(getParentPath('')).toBe('/');
      expect(getParentPaths('')).toEqual([]);
    });

    it('should handle whitespace consistently', () => {
      expect(normalizePath('   ')).toBe('/');
      expect(normalizePath('   ', { isDirectory: true })).toBe('/');
    });

    it('should handle very long paths', () => {
      const longPath = '/a'.repeat(100);
      const normalized = normalizePath(longPath);
      expect(normalized).toContain('/a');
      expect(normalized.split('/').filter(Boolean).length).toBe(100);
    });

    it('should handle special characters in paths', () => {
      expect(normalizePath('/folder/file name with spaces.txt')).toBe('/folder/file name with spaces.txt');
      expect(normalizePath('/folder/файл.txt')).toBe('/folder/файл.txt');
      expect(getBasename('/folder/file-name_2023.txt')).toBe('file-name_2023.txt');
    });

    it('should work correctly in combination', () => {
      const path = 'folder/subfolder/file.txt';
      const normalized = normalizePath(path);
      const parent = getParentPath(normalized);
      const basename = getBasename(normalized);
      
      expect(normalized).toBe('/folder/subfolder/file.txt');
      expect(parent).toBe('/folder/subfolder');
      expect(basename).toBe('file.txt');
      expect(isPathUnder(normalized, parent)).toBe(true);
    });
  });
});

