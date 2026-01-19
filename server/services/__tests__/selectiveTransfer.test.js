const { selectiveTransfer } = require('../selectiveTransfer');
const { normalizePath } = require('../../utils/pathUtils');

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

  function hasAnyChild(dir) {
    const d = normalizePath(dir);
    const prefix = d === '/' ? '/' : `${d}/`;
    for (const dd of dirSet) {
      if (dd !== d && dd.startsWith(prefix)) return true;
    }
    for (const ff of fileSet) {
      if (ff.startsWith(prefix)) return true;
    }
    return false;
  }

  return {
    async listDirectory(dir) {
      return listChildren(dir);
    },
    async createDirectory(dir) {
      dirSet.add(normalizePath(dir));
    },
    async pathExists(p) {
      const n = normalizePath(p);
      return dirSet.has(n) || fileSet.has(n);
    },
    async moveFile(src, dst) {
      const s = normalizePath(src);
      const d = normalizePath(dst);
      if (!fileSet.has(s)) throw new Error(`File not found: ${s}`);
      const parent = d.substring(0, d.lastIndexOf('/')) || '/';
      if (!dirSet.has(parent)) throw new Error(`Dest parent missing: ${parent}`);
      fileSet.delete(s);
      fileSet.add(d);
    },
    async copyFile(src, dst) {
      const s = normalizePath(src);
      const d = normalizePath(dst);
      if (!fileSet.has(s)) throw new Error(`File not found: ${s}`);
      const parent = d.substring(0, d.lastIndexOf('/')) || '/';
      if (!dirSet.has(parent)) throw new Error(`Dest parent missing: ${parent}`);
      fileSet.add(d);
    },
    async deleteFile(p) {
      const n = normalizePath(p);
      if (fileSet.has(n)) {
        fileSet.delete(n);
        return;
      }
      if (!dirSet.has(n)) throw new Error(`Not found: ${n}`);
      if (hasAnyChild(n)) {
        const err = new Error(`Directory not empty: ${n}`);
        err.status = 409;
        throw err;
      }
      dirSet.delete(n);
    },
    snapshot() {
      return {
        dirs: Array.from(dirSet).sort(),
        files: Array.from(fileSet).sort(),
      };
    },
  };
}

describe('selectiveTransfer (recursive_strict)', () => {
  it('selectively moves only permitted subtrees and leaves skipped ones', async () => {
    const webdav = makeFakeWebdav({
      dirs: ['/a', '/a/b', '/a/c'],
      files: ['/a/b/x.txt', '/a/c/y.txt'],
    });

    const canEnterDirectory = async (p) => {
      const n = normalizePath(p);
      if (n === '/a') return true;
      if (n === '/a/c') return true;
      return false;
    };
    const canTransferFile = async (parentDir) => canEnterDirectory(parentDir);

    const res = await selectiveTransfer({
      sourceRoot: '/a',
      destRoot: '/1/a',
      mode: 'move',
      canEnterDirectory,
      canTransferFile,
      webdav,
    });

    const snap = webdav.snapshot();
    expect(snap.files).toContain('/a/b/x.txt');
    expect(snap.files).toContain('/1/a/c/y.txt');
    expect(snap.files).not.toContain('/a/c/y.txt');

    expect(snap.dirs).not.toContain('/a/c');
    expect(snap.dirs).toContain('/a');

    expect(res.skippedPaths).toContain('/a/b');
    expect(res.movedDirMappings).toEqual(expect.arrayContaining([{ fromPrefix: '/a/c', toPrefix: '/1/a/c' }]));
    expect(res.createdDirs).toEqual(expect.arrayContaining(['/1/a', '/1/a/c']));
  });

  it('selectively copies only permitted subtrees and leaves source untouched', async () => {
    const webdav = makeFakeWebdav({
      dirs: ['/a', '/a/b', '/a/c'],
      files: ['/a/b/x.txt', '/a/c/y.txt'],
    });

    const canEnterDirectory = async (p) => {
      const n = normalizePath(p);
      if (n === '/a') return true;
      if (n === '/a/c') return true;
      return false;
    };
    const canTransferFile = async (parentDir) => canEnterDirectory(parentDir);

    const res = await selectiveTransfer({
      sourceRoot: '/a',
      destRoot: '/1/a',
      mode: 'copy',
      canEnterDirectory,
      canTransferFile,
      webdav,
    });

    const snap = webdav.snapshot();
    expect(snap.files).toContain('/a/c/y.txt');
    expect(snap.files).toContain('/1/a/c/y.txt');
    expect(snap.files).not.toContain('/1/a/b/x.txt');

    expect(res.skippedPaths).toContain('/a/b');
    expect(res.movedDirMappings).toEqual([]);
  });
});

