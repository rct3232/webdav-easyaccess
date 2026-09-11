/**
 * Client pathUtils tests: toFilesPath, getParentPath (VIRTUAL_ROOTS),
 * normalizePath/getBasename re-exports, boundary values.
 * @see docs/spec/client/utils/pathUtils.md
 */
import * as fc from 'fast-check';
import { toFilesPath, getParentPath, normalizePath, getBasename } from '../pathUtils';

describe('toFilesPath', () => {
  it('converts file path to /files/... route', () => {
    expect(toFilesPath('/foo')).toBe('/files/foo');
    expect(toFilesPath('/foo/bar')).toBe('/files/foo/bar');
  });

  it('returns /files for empty or invalid input', () => {
    expect(toFilesPath('')).toBe('/files');
    expect(toFilesPath(null)).toBe('/files');
    expect(toFilesPath(undefined)).toBe('/files');
    expect(toFilesPath(123)).toBe('/files');
  });

  it('normalizes path before converting', () => {
    expect(toFilesPath('foo/bar')).toBe('/files/foo/bar');
  });
});

describe('getParentPath with VIRTUAL_ROOTS', () => {
  it('returns / for root', () => {
    expect(getParentPath('/')).toBe('/');
  });

  it('returns / for virtual roots /__shared__, /__recent__ and /__trash__ (A20)', () => {
    expect(getParentPath('/__shared__')).toBe('/');
    expect(getParentPath('/__recent__')).toBe('/');
    expect(getParentPath('/__trash__')).toBe('/');
  });

  it('returns parent for normal paths', () => {
    expect(getParentPath('/a')).toBe('/');
    expect(getParentPath('/a/b')).toBe('/a');
    expect(getParentPath('/a/b/c')).toBe('/a/b');
  });
});

describe('normalizePath (re-export)', () => {
  it('returns / for empty path', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath(null)).toBe('/');
  });

  it('ensures leading slash', () => {
    expect(normalizePath('foo')).toBe('/foo');
  });

  it('removes duplicate slashes', () => {
    expect(normalizePath('/a//b///c')).toBe('/a/b/c');
  });

  it('replaces backslashes with forward slashes', () => {
    expect(normalizePath('a\\b\\c')).toBe('/a/b/c');
  });

  it('removes trailing slash for files', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b');
  });
});

describe('getBasename', () => {
  it('returns last segment', () => {
    expect(getBasename('/a/b/c')).toBe('c');
    expect(getBasename('/foo')).toBe('foo');
  });

  it('returns / for root', () => {
    expect(getBasename('/')).toBe('/');
  });
});

describe('boundary and edge cases', () => {
  it('handles null/undefined/empty path inputs', () => {
    expect(toFilesPath(null)).toBe('/files');
    expect(normalizePath(null)).toBe('/');
  });
});

describe('property-based (fast-check)', () => {
  it('normalizePath output always starts with /', () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const result = normalizePath(path);
        expect(result.startsWith('/')).toBe(true);
      })
    );
  });

  it('normalizePath has no duplicate slashes', () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const result = normalizePath(path);
        expect(result).not.toMatch(/\/{2,}/);
      })
    );
  });
});
