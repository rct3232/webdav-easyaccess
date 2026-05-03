/**
 * Unit tests for shared path utilities.
 * Pure function testing — no mocks needed.
 * @see shared/pathUtils.js
 */
const {
  normalizePath,
  getParentPath,
  isRootPath,
  getBasename,
  isPathUnder,
  getParentPaths,
} = require('@webdav-easyaccess/shared/pathUtils');

describe('shared pathUtils', () => {
  describe('normalizePath', () => {
    it.each([
      [null, '/'],
      [undefined, '/'],
      ['', '/'],
      ['/', '/'],
    ])('returns / for falsy/root input (%p)', (input, expected) => {
      expect(normalizePath(input)).toBe(expected);
    });

    it.each([
      ['foo', '/foo'],
      ['a/b/c', '/a/b/c'],
      ['/foo', '/foo'],
    ])('ensures leading slash for %p → %s', (input, expected) => {
      expect(normalizePath(input)).toBe(expected);
    });

    it.each([
      ['//', '/'],
      ['/a//b///c', '/a/b/c'],
      ['////', '/'],
    ])('removes duplicate slashes for %p → %s', (input, expected) => {
      expect(normalizePath(input)).toBe(expected);
    });

    it.each([
      ['a\\b\\c', '/a/b/c'],
      ['C:\\Users\\file', '/C:/Users/file'],
    ])('replaces backslashes for %p → %s', (input, expected) => {
      expect(normalizePath(input)).toBe(expected);
    });

    it.each([
      ['/a/b/', '/a/b'],
      ['/foo/', '/foo'],
      ['/', '/'],
    ])('removes trailing slash for %p → %s', (input, expected) => {
      expect(normalizePath(input)).toBe(expected);
    });

    it.each([
      ['/a/b', { isDirectory: true }, '/a/b/'],
      ['/', { isDirectory: true }, '/'],
      ['foo', { isDirectory: true }, '/foo/'],
    ])('adds trailing slash with isDirectory for %p → %s', (input, options, expected) => {
      expect(normalizePath(input, options)).toBe(expected);
    });

    it.each([
      ['  /foo/bar  ', '/foo/bar'],
      ['   a/b   ', '/a/b'],
    ])('trims whitespace for %p → %s', (input, expected) => {
      expect(normalizePath(input)).toBe(expected);
    });

    it('handles mixed slashes and trailing slash', () => {
      expect(normalizePath('/a\\b//c/')).toBe('/a/b/c');
    });
  });

  describe('getParentPath', () => {
    it.each([
      ['/', '/'],
      ['/a', '/'],
      ['/foo', '/'],
    ])('returns / for root or single-segment %p → %s', (input, expected) => {
      expect(getParentPath(input)).toBe(expected);
    });

    it.each([
      ['/a/b', '/a'],
      ['/a/b/c', '/a/b'],
      ['/x/y/z/w', '/x/y/z'],
    ])('returns parent for %p → %s', (input, expected) => {
      expect(getParentPath(input)).toBe(expected);
    });

    it.each([
      ['/__shared__', '/', { treatAsRoot: ['/__shared__', '/__recent__'] }],
      ['/__recent__', '/', { treatAsRoot: ['/__shared__', '/__recent__'] }],
    ])('respects treatAsRoot for %p → %s', (input, expected, options) => {
      expect(getParentPath(input, options)).toBe(expected);
    });

    it('normalizes input before computing parent', () => {
      expect(getParentPath('a/b/c')).toBe('/a/b');
      expect(getParentPath('/a//b/')).toBe('/a');
    });
  });

  describe('isRootPath', () => {
    it.each([
      [null, undefined],
      ['', undefined],
      ['/', undefined],
    ])('returns true for root input (%p)', (input) => {
      expect(isRootPath(input)).toBe(true);
    });

    it.each([
      ['/__shared__', ['/__shared__', '/__recent__']],
      ['/__recent__', ['/__shared__', '/__recent__']],
    ])('returns true when path is in treatAsRoot (%p)', (input, treatAsRoot) => {
      expect(isRootPath(input, treatAsRoot)).toBe(true);
    });

    it.each([
      ['/foo'],
      ['/a/b/c'],
      ['random-path'],
    ])('returns false for normal path (%p)', (input) => {
      expect(isRootPath(input)).toBe(false);
    });

    it('returns false when treatAsRoot is not an array', () => {
      expect(isRootPath('/__shared__', '/__shared__')).toBe(false);
    });
  });

  describe('getBasename', () => {
    it.each([
      ['/', '/'],
      ['/foo', 'foo'],
      ['/a/b/c.txt', 'c.txt'],
      ['/a/b/', 'b'],
      ['no-leading-slash', 'no-leading-slash'],
      ['/single', 'single'],
    ])('returns basename for %p → %s', (input, expected) => {
      expect(getBasename(input)).toBe(expected);
    });
  });

  describe('isPathUnder', () => {
    it.each([
      ['/foo', '/'],
      ['/a/b/c', '/'],
    ])('returns true when parent is root (%p under /)', (input) => {
      expect(isPathUnder(input, '/')).toBe(true);
    });

    it.each([
      [['/a', '/a'], 'equal paths'],
      [['/a/b/c', '/a'], 'child under parent'],
      [['/a/b/c', '/a/b'], 'deep child under parent'],
    ])('returns true for %s: %p under %p', (paths) => {
      const [child, parent] = paths;
      expect(isPathUnder(child, parent)).toBe(true);
    });

    it.each([
      [['/a', '/b'], 'different siblings'],
      [['/a/b', '/a/b/c'], 'parent is not child'],
      [['/ab', '/a'], 'prefix but not child'],
      [['/abc', '/ab'], 'prefix mismatch'],
    ])('returns false for %s: %p not under %p', (paths) => {
      const [child, parent] = paths;
      expect(isPathUnder(child, parent)).toBe(false);
    });
  });

  describe('getParentPaths', () => {
    it.each([
      ['/', []],
      ['/a', ['/']],
      ['/a/b', ['/a', '/']],
      ['/a/b/c', ['/a/b', '/a', '/']],
      ['/x/y/z/w', ['/x/y/z', '/x/y', '/x', '/']],
    ])('returns parent chain for %p → %s', (input, expected) => {
      expect(getParentPaths(input)).toEqual(expected);
    });

    it('normalizes input before computing parents', () => {
      expect(getParentPaths('a/b/c')).toEqual(['/a/b', '/a', '/']);
      expect(getParentPaths('/a//b/')).toEqual(['/a', '/']);
    });
  });
});
