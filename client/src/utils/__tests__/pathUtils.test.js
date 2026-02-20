/**
 * Client pathUtils tests: getFolderName, getPathParts, joinPath, toFilesPath,
 * getParentPath (VIRTUAL_ROOTS), boundary values.
 * @see docs/spec/client/utils/pathUtils.md
 */
import * as fc from 'fast-check';
import {
  getFolderName,
  getPathParts,
  joinPath,
  toFilesPath,
  getParentPath,
  normalizePath,
  getBasename,
  isRootPath,
  getParentPaths,
  isSubPath,
} from '../pathUtils';

describe('getFolderName', () => {
  it('returns Root for empty or / without t', () => {
    expect(getFolderName('')).toBe('Root');
    expect(getFolderName('/')).toBe('Root');
    expect(getFolderName(null)).toBe('Root');
  });

  it('returns Shared for /__shared__ without t', () => {
    expect(getFolderName('/__shared__')).toBe('Shared');
  });

  it('returns Recent for /__recent__ without t', () => {
    expect(getFolderName('/__recent__')).toBe('Recent');
  });

  it('returns last segment for normal path without t', () => {
    expect(getFolderName('/a/b/c')).toBe('c');
  });

  it('uses t() when provided for root, shared, recent', () => {
    const t = (key) => `t(${key})`;
    expect(getFolderName('/', t)).toBe('t(nav.root)');
    expect(getFolderName('/__shared__', t)).toBe('t(nav.shared)');
    expect(getFolderName('/__recent__', t)).toBe('t(nav.recentShort)');
  });

  it('returns last segment for normal path with t', () => {
    const t = (key) => `t(${key})`;
    expect(getFolderName('/a/b/c', t)).toBe('c');
  });
});

describe('getPathParts', () => {
  it('splits path into parts', () => {
    expect(getPathParts('/a/b/c')).toEqual(['a', 'b', 'c']);
    expect(getPathParts('a/b/c')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty path', () => {
    expect(getPathParts('')).toEqual([]);
    expect(getPathParts(null)).toEqual([]);
  });

  it('returns single part for root-level path', () => {
    expect(getPathParts('/foo')).toEqual(['foo']);
  });
});

describe('joinPath', () => {
  it('joins parts with leading slash', () => {
    expect(joinPath('a', 'b', 'c')).toBe('/a/b/c');
  });

  it('handles leading/trailing slashes in parts', () => {
    expect(joinPath('/a/', '/b/', 'c')).toBe('/a/b/c');
  });

  it('filters empty parts', () => {
    expect(joinPath('a', '', 'b', 'c')).toBe('/a/b/c');
  });

  it('returns / for empty join', () => {
    expect(joinPath()).toBe('/');
    expect(joinPath('', '')).toBe('/');
  });
});

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

  it('returns / for virtual roots /__shared__ and /__recent__', () => {
    expect(getParentPath('/__shared__')).toBe('/');
    expect(getParentPath('/__recent__')).toBe('/');
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

describe('isRootPath', () => {
  it('returns true for empty, /, and virtual roots', () => {
    expect(isRootPath('')).toBe(true);
    expect(isRootPath('/')).toBe(true);
    expect(isRootPath('/__shared__')).toBe(true);
    expect(isRootPath('/__recent__')).toBe(true);
  });

  it('returns false for normal paths', () => {
    expect(isRootPath('/a')).toBe(false);
    expect(isRootPath('/a/b')).toBe(false);
  });
});

describe('getParentPaths', () => {
  it('returns parent chain from immediate parent to root', () => {
    expect(getParentPaths('/a/b/c')).toEqual(['/a/b', '/a', '/']);
  });

  it('returns empty for root', () => {
    expect(getParentPaths('/')).toEqual([]);
  });
});

describe('isSubPath', () => {
  it('returns true when child is under parent', () => {
    expect(isSubPath('/a/b/c', '/a')).toBe(true);
    expect(isSubPath('/a', '/')).toBe(true);
  });

  it('returns false when not under parent', () => {
    expect(isSubPath('/x', '/a')).toBe(false);
  });
});

describe('boundary and edge cases', () => {
  it('handles null/undefined/empty path inputs', () => {
    expect(getPathParts(null)).toEqual([]);
    expect(getPathParts(undefined)).toEqual([]);
    expect(getFolderName(null)).toBe('Root');
    expect(toFilesPath(null)).toBe('/files');
    expect(normalizePath(null)).toBe('/');
  });

  it('getPathParts handles single segment', () => {
    expect(getPathParts('/single')).toEqual(['single']);
  });

  it('joinPath with single part', () => {
    expect(joinPath('only')).toBe('/only');
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

    it('joinPath then getPathParts yields equivalent segments (joinPath normalizes slashes)', () => {
      // joinPath strips leading/trailing slashes from parts - use parts without slashes for round-trip
      const segment = fc.stringOf(
        fc.char().filter((c) => c !== '/' && c !== '\\'),
        { minLength: 1, maxLength: 10 }
      );
      fc.assert(
        fc.property(
          fc.array(segment, { minLength: 1, maxLength: 5 }),
          (parts) => {
            const joined = joinPath(...parts);
            const recovered = getPathParts(joined);
            expect(recovered).toEqual(parts);
          }
        )
      );
    });
});
