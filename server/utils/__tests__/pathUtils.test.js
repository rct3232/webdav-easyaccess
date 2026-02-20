/**
 * Server pathUtils tests: shared pathUtils used by server (normalizePath, getParentPath,
 * getBasename, isPathUnder). Server imports from @webdav-easyaccess/shared/pathUtils.
 * @see docs/shared-contracts.md Path Rules
 * @see docs/spec/server/middleware/normalizePathParam.md
 */
const {
  normalizePath,
  getParentPath,
  getBasename,
  isPathUnder,
  isRootPath,
  getParentPaths,
} = require('@webdav-easyaccess/shared/pathUtils');

describe('pathUtils (shared, server usage)', () => {
  describe('normalizePath', () => {
    it('returns / for empty or null', () => {
      expect(normalizePath('')).toBe('/');
      expect(normalizePath(null)).toBe('/');
    });

    it('ensures leading slash', () => {
      expect(normalizePath('foo')).toBe('/foo');
      expect(normalizePath('a/b')).toBe('/a/b');
    });

    it('removes duplicate slashes', () => {
      expect(normalizePath('/a//b///c')).toBe('/a/b/c');
    });

    it('replaces backslashes with forward slashes', () => {
      expect(normalizePath('a\\b\\c')).toBe('/a/b/c');
    });

    it('removes trailing slash unless isDirectory', () => {
      expect(normalizePath('/a/b/')).toBe('/a/b');
      expect(normalizePath('/')).toBe('/');
    });

    it('adds trailing slash when isDirectory option is true', () => {
      expect(normalizePath('/a/b', { isDirectory: true })).toBe('/a/b/');
      expect(normalizePath('/', { isDirectory: true })).toBe('/');
    });

    it('trims whitespace', () => {
      expect(normalizePath('  /foo  ')).toBe('/foo');
    });
  });

  describe('getParentPath', () => {
    it('returns / for root', () => {
      expect(getParentPath('/')).toBe('/');
    });

    it('returns / for single-segment path', () => {
      expect(getParentPath('/a')).toBe('/');
    });

    it('returns parent for nested paths', () => {
      expect(getParentPath('/a/b')).toBe('/a');
      expect(getParentPath('/a/b/c')).toBe('/a/b');
    });

    it('respects treatAsRoot - parent of virtual root is /', () => {
      const VIRTUAL = ['/__shared__', '/__recent__'];
      expect(getParentPath('/__shared__', { treatAsRoot: VIRTUAL })).toBe('/');
      expect(getParentPath('/__recent__', { treatAsRoot: VIRTUAL })).toBe('/');
    });

    it('normalizes input path', () => {
      expect(getParentPath('a/b/c')).toBe('/a/b');
    });
  });

  describe('getBasename', () => {
    it('returns / for root', () => {
      expect(getBasename('/')).toBe('/');
    });

    it('returns last segment', () => {
      expect(getBasename('/foo')).toBe('foo');
      expect(getBasename('/a/b/c.txt')).toBe('c.txt');
    });

    it('handles trailing slash', () => {
      expect(getBasename('/a/b/')).toBe('b');
    });
  });

  describe('isPathUnder', () => {
    it('returns true when parent is root', () => {
      expect(isPathUnder('/foo', '/')).toBe(true);
      expect(isPathUnder('/a/b/c', '/')).toBe(true);
    });

    it('returns true when child equals parent', () => {
      expect(isPathUnder('/a', '/a')).toBe(true);
    });

    it('returns true when child is under parent', () => {
      expect(isPathUnder('/a/b/c', '/a')).toBe(true);
      expect(isPathUnder('/a/b/c', '/a/b')).toBe(true);
    });

    it('returns false when child is not under parent', () => {
      expect(isPathUnder('/a', '/b')).toBe(false);
      expect(isPathUnder('/a/b', '/a/b/c')).toBe(false);
      expect(isPathUnder('/ab', '/a')).toBe(false);
    });
  });

  describe('isRootPath', () => {
    it('returns true for empty or /', () => {
      expect(isRootPath('')).toBe(true);
      expect(isRootPath('/')).toBe(true);
    });

    it('returns true when path is in treatAsRoot', () => {
      expect(isRootPath('/__shared__', ['/__shared__', '/__recent__'])).toBe(true);
    });

    it('returns false for normal path', () => {
      expect(isRootPath('/foo')).toBe(false);
    });
  });

  describe('getParentPaths', () => {
    it('returns empty for root', () => {
      expect(getParentPaths('/')).toEqual([]);
    });

    it('returns parent chain from immediate to root', () => {
      expect(getParentPaths('/a/b/c')).toEqual(['/a/b', '/a', '/']);
    });

    it('returns single parent for one level', () => {
      expect(getParentPaths('/a')).toEqual(['/']);
    });
  });
});
