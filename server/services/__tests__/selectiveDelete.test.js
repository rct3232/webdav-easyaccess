const { selectiveDelete } = require('../selectiveDelete');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');

function makeFakeWebdav({ dirs = [], files = [], recursiveDirDelete = false } = {}) {
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

  function deleteDirRecursive(dir) {
    const d = normalizePath(dir);
    const prefix = d === '/' ? '/' : `${d}/`;
    for (const ff of Array.from(fileSet)) {
      if (ff.startsWith(prefix)) fileSet.delete(ff);
    }
    for (const dd of Array.from(dirSet)) {
      if (dd !== d && dd.startsWith(prefix)) dirSet.delete(dd);
    }
    dirSet.delete(d);
  }

  return {
    async listDirectory(dir) {
      return listChildren(dir);
    },
    async deleteFile(p) {
      const n = normalizePath(p);
      if (fileSet.has(n)) {
        fileSet.delete(n);
        return;
      }
      if (!dirSet.has(n)) throw new Error(`Not found: ${n}`);
      if (hasAnyChild(n) && !recursiveDirDelete) {
        const err = new Error(`Directory not empty: ${n}`);
        err.status = 409;
        throw err;
      }
      if (recursiveDirDelete) {
        deleteDirRecursive(n);
      } else {
        dirSet.delete(n);
      }
    },
    snapshot() {
      return {
        dirs: Array.from(dirSet).sort(),
        files: Array.from(fileSet).sort(),
      };
    },
  };
}

describe('selectiveDelete (recursive_strict)', () => {
  it('deletes only permitted subtrees and leaves skipped ones', async () => {
    const webdav = makeFakeWebdav({
      dirs: ['/a', '/a/b', '/a/c'],
      files: ['/a/b/x.txt', '/a/c/y.txt'],
      // Simulate servers that recursively delete directories
      recursiveDirDelete: true,
    });

    const canEnterDirectory = async (p) => {
      const n = normalizePath(p);
      if (n === '/a') return true;
      if (n === '/a/c') return true;
      return false;
    };
    const canDeleteFileByParent = async (filePath) => canEnterDirectory(getParentPath(filePath));

    const res = await selectiveDelete({
      rootPath: '/a',
      canEnterDirectory,
      canDeleteFileByParent,
      webdav,
    });

    const snap = webdav.snapshot();

    // Skipped subtree remains
    expect(snap.dirs).toContain('/a/b');
    expect(snap.files).toContain('/a/b/x.txt');

    // Permitted subtree deleted
    expect(snap.files).not.toContain('/a/c/y.txt');
    expect(snap.dirs).not.toContain('/a/c');

    // Root stays because /a/b remains
    expect(snap.dirs).toContain('/a');

    expect(res.skippedPaths).toContain('/a/b');
    expect(res.deletedDirPrefixes).toContain('/a/c');
    expect(res.deletedDirPrefixes).not.toContain('/a');
  });
});

