import { normalizePath, getParentPath, isRootPath, getFolderName } from '../pathUtils';

describe('pathUtils', () => {
  describe('normalizePath', () => {
    it('ensures leading slash', () => {
      expect(normalizePath('test')).toBe('/test');
    });

    it('removes trailing slash', () => {
      expect(normalizePath('/test/')).toBe('/test');
    });

    it('replaces backslashes', () => {
      expect(normalizePath('\\test\\sub')).toBe('/test/sub');
    });

    it('removes duplicate slashes', () => {
      expect(normalizePath('//test///sub')).toBe('/test/sub');
    });

    it('handles root', () => {
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('')).toBe('/');
    });
  });

  describe('getParentPath', () => {
    it('returns parent directory', () => {
      expect(getParentPath('/a/b/c')).toBe('/a/b');
      expect(getParentPath('/a')).toBe('/');
      expect(getParentPath('/')).toBe('/');
    });
  });

  describe('isRootPath', () => {
    it('identifies root paths', () => {
      expect(isRootPath('/')).toBe(true);
      expect(isRootPath('/__shared__')).toBe(true);
      expect(isRootPath('/test')).toBe(false);
    });
  });

  describe('getFolderName', () => {
    it('extracts last segment', () => {
      expect(getFolderName('/a/b/c')).toBe('c');
      expect(getFolderName('/')).toBe('Root');
      expect(getFolderName('/__shared__')).toBe('공유됨');
    });
  });
});
