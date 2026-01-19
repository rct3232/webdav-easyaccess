const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createDirectory,
  deleteFile,
  getFileContents,
  listDirectory,
  pathExists,
  putFileContentsAdvanced,
} = require('../utils/webdav');
const { normalizeWebdavPath } = require('./metaPaths');

function getBackend() {
  const forced = (process.env.WEA_STORAGE_BACKEND || '').toLowerCase();
  if (forced === 'fs' || forced === 'filesystem') return 'fs';
  if (forced === 'webdav') return 'webdav';
  if (process.env.NODE_ENV === 'test') return 'fs';
  return 'webdav';
}

function getFsBaseDir() {
  const envDir = process.env.WEA_FS_DIR || process.env.WEA_METADATA_DIR;
  return envDir ? path.resolve(envDir) : path.join(os.tmpdir(), 'webdav-easyaccess-meta');
}

function webdavToFsPath(webdavPath) {
  const normalized = normalizeWebdavPath(webdavPath);
  const base = getFsBaseDir();
  // Drop leading slash to avoid absolute join
  const rel = normalized === '/' ? '' : normalized.substring(1);
  const joined = path.join(base, rel);
  // Safety: ensure path stays under base
  const resolved = path.resolve(joined);
  if (!resolved.startsWith(base)) {
    throw new Error(`Invalid path mapping for "${webdavPath}"`);
  }
  return resolved;
}

function makeStatusError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function ensureDir(dirPath) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(dirPath);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    await fsp.mkdir(local, { recursive: true });
    return;
  }
  // WebDAV MKCOL is not recursive; create step-by-step (mkdir -p)
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current + '/' + part;
    try {
      await createDirectory(current);
    } catch (e) {
      // Ignore "already exists" / conflicts. If a parent was missing, the next
      // iteration would still fail; later writes will surface a clear error.
    }
  }
}

async function exists(p) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    try {
      await fsp.access(local, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  return await pathExists(normalized);
}

async function readFile(p) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    return await fsp.readFile(local);
  }
  const buf = await getFileContents(normalized);
  return Buffer.from(buf);
}

async function writeFile(p, data, options = {}) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');

  const overwrite = options.overwrite !== undefined ? !!options.overwrite : true;
  const ifNoneMatchStar = !!options.ifNoneMatchStar;
  const contentType = options.contentType || 'application/octet-stream';

  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    await fsp.mkdir(path.dirname(local), { recursive: true });
    const flag = ifNoneMatchStar || !overwrite ? 'wx' : 'w';
    try {
      await fsp.writeFile(local, buf, { flag });
      return;
    } catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EISDIR')) {
        throw makeStatusError(412, `Precondition Failed: ${normalized} exists`);
      }
      throw e;
    }
  }

  const headers = {
    'Content-Type': contentType,
    ...(options.headers || {}),
  };
  if (ifNoneMatchStar) {
    headers['If-None-Match'] = '*';
  }

  // webdav putFileContents uses overwrite flag (client-side) + server-side conditional header
  await putFileContentsAdvanced(normalized, buf, {
    overwrite: ifNoneMatchStar ? false : overwrite,
    headers,
  });
}

async function deletePath(p) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(p);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    try {
      await fsp.rm(local, { recursive: true, force: true });
    } catch {
      // ignore
    }
    return;
  }
  try {
    await deleteFile(normalized);
  } catch {
    // ignore
  }
}

async function listDir(dirPath) {
  const backend = getBackend();
  const normalized = normalizeWebdavPath(dirPath);
  if (backend === 'fs') {
    const local = webdavToFsPath(normalized);
    try {
      const entries = await fsp.readdir(local, { withFileTypes: true });
      return entries.map((ent) => ({
        basename: ent.name,
        type: ent.isDirectory() ? 'directory' : 'file',
      }));
    } catch {
      return [];
    }
  }

  const items = await listDirectory(normalized);
  return items.map((it) => ({
    basename: it.basename,
    type: it.type,
  }));
}

module.exports = {
  getBackend,
  getFsBaseDir,
  ensureDir,
  exists,
  readFile,
  writeFile,
  deletePath,
  listDir,
};

