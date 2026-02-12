const { selectiveCollectFiles } = require('../selectiveDownload');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');

function makeFakeWebdav({ dirs = [], files = [] } = {}) {
  const dirSet = new Set(dirs.map((d) => normalizePath(d)));
  dirSet.add('/');
  const fileSet = new Set(files.map((f) => normalizePath(f)));

  function listChildren(dir) {
    const d = normalizePath(dir);
    if (!dirSet.has(d)) throw new Error(`Dir not found: ${d}`);
    const prefix = d === '/' ? '/' : `${d}/`;
    const children = new Map();

    for (const dd of dirSet) {
      if (dd === d) continue;
      if (!dd.startsWith(prefix)) continue;
      const rest = dd.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      children.set(rest, 'directory');
    }
    for (const ff of fileSet) {
      if (!ff.startsWith(prefix)) continue;
      const rest = ff.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      children.set(rest, 'file');
    }

    return Array.from(children.entries()).map(([basename, type]) => ({ basename, type }));
  }

  return {
    async listDirectory(dir) {
      return listChildren(dir);
    },
  };
}

describe('selectiveCollectFiles (recursive_strict)', () => {
  it('collects only permitted subtree files and records skipped directories', async () => {
    const webdav = makeFakeWebdav({
      dirs: ['/a', '/a/b', '/a/c'],
      files: ['/a/b/x.txt', '/a/c/y.txt', '/a/c/z.txt'],
    });

    const canEnterDirectory = async (p) => {
      const n = normalizePath(p);
      if (n === '/a') return true;
      if (n === '/a/c') return true;
      return false;
    };
    const canIncludeFile = async (filePath) => canEnterDirectory(getParentPath(filePath));

    const res = await selectiveCollectFiles({
      rootPath: '/a',
      basePath: 'a',
      canEnterDirectory,
      canIncludeFile,
      webdav,
    });

    expect(res.skippedPaths).toContain('/a/b');
    expect(res.files.map((f) => f.path)).toEqual(expect.arrayContaining(['/a/c/y.txt', '/a/c/z.txt']));
    expect(res.files.map((f) => f.path)).not.toContain('/a/b/x.txt');
    expect(res.files.map((f) => f.relativePath)).toEqual(expect.arrayContaining(['a/c/y.txt', 'a/c/z.txt']));
  });

  it('returns root in skippedPaths when root is not enterable', async () => {
    const webdav = makeFakeWebdav({
      dirs: ['/a'],
      files: ['/a/x.txt'],
    });

    const res = await selectiveCollectFiles({
      rootPath: '/a',
      basePath: 'a',
      canEnterDirectory: async () => false,
      canIncludeFile: async () => false,
      webdav,
    });

    expect(res.files).toEqual([]);
    expect(res.skippedPaths).toEqual(['/a']);
  });
});

